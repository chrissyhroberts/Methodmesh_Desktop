const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const asn1js = require("asn1js");
const pkijs = require("pkijs");
const JSZip = require("jszip");
const { DesktopRuntime } = require("./runtime");
const { ArtifactService } = require("./artifacts");
const { adapterInventory } = require("./adapters");
const FREETSA_SIGNER_FILE_SHA256 = "8bfb0305bb64e2571ca507552ef3245cb1c2fee8728e0ff8689225081ea13467";
const FREETSA_ROOT_FILE_SHA256 = "2151b61137ffa86bf664691ba67e7da0b19f98c758e3d228d5d8ebf27e044438";
const FOLDER_MAX_FILES = 10_000;
const FOLDER_MAX_BYTES = 512 * 1024 * 1024;
const timestampControllers = new Map();

// PKIjs needs an explicit Web Crypto provider in Electron's Node main process.
pkijs.setEngine("MethodMeshDesktop", crypto.webcrypto, new pkijs.CryptoEngine({
  name: "MethodMeshDesktop",
  crypto: crypto.webcrypto,
  subtle: crypto.webcrypto.subtle
}));

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#101615",
    icon: path.join(__dirname, "../../assets/methodmesh-icon.webp"),
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.loadFile(path.join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(() => {
  const runtime = new DesktopRuntime({ app, modulesDirectory: path.join(__dirname, "../../modules") });
  const artifacts = new ArtifactService({ app });
  return Promise.all([runtime.initialise(), artifacts.initialise()]).then(() => {
  ipcMain.handle("runtime:catalogue", () => runtime.catalogue());
  ipcMain.handle("adapters:inventory", () => adapterInventory());
  ipcMain.handle("runtime:state", () => runtime.publicState());
  ipcMain.handle("runtime:save-state", (_event, state) => runtime.saveState(state));
  ipcMain.handle("runtime:record-execution", (_event, execution) => runtime.recordExecution(execution));
  ipcMain.handle("runtime:commit-result", (_event, execution) => runtime.commitResult(execution));
  ipcMain.handle("runtime:executions", () => runtime.executionHistory());
  ipcMain.handle("runtime:launch-plan", (_event, target) => runtime.launchPlan(target));
  ipcMain.handle("runtime:due-schedules", () => runtime.dueSchedules());
  ipcMain.handle("presets:save", (_event, preset) => runtime.savePreset(preset));
  ipcMain.handle("protocols:save", (_event, protocol) => runtime.saveProtocol(protocol));
  ipcMain.handle("schedules:save", (_event, schedule) => runtime.saveSchedule(schedule));
  ipcMain.handle("configuration:export", () => runtime.configurationBundle());
  ipcMain.handle("configuration:import", (_event, bundle) => runtime.importConfiguration(bundle));
  ipcMain.handle("artifacts:list", () => artifacts.list());
  ipcMain.handle("artifacts:export", async (_event, { ref, name }) => {
    const result = await dialog.showSaveDialog({ title: "Export managed artifact", defaultPath: name });
    if (result.canceled || !result.filePath) return null;
    await artifacts.export(ref, result.filePath);
    return result.filePath;
  });
  ipcMain.handle("files:open", async (_event, options = {}) => {
    const result = await dialog.showOpenDialog({
      title: options.title || "Choose a file",
      properties: ["openFile"],
      filters: options.filters || [{ name: "All files", extensions: ["*"] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const data = await fs.readFile(filePath);
    return {
      name: path.basename(filePath),
      path: filePath,
      bytes: data.toString("base64"),
      mimeType: mimeFor(path.extname(filePath))
    };
  });

  ipcMain.handle("files:open-folder", async () => {
    const result = await dialog.showOpenDialog({ title: "Choose a folder", properties: ["openDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    const folder = result.filePaths[0]; const files = []; let totalBytes = 0;
    async function visit(directory) { for (const entry of await fs.readdir(directory, { withFileTypes: true })) { if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue; const full = path.join(directory, entry.name); if (entry.isDirectory()) await visit(full); else if (entry.isFile()) { if (files.length >= FOLDER_MAX_FILES) throw new Error(`Folder selection exceeds the ${FOLDER_MAX_FILES.toLocaleString()} file safety limit.`); const stat = await fs.stat(full); totalBytes += stat.size; if (totalBytes > FOLDER_MAX_BYTES) throw new Error("Folder selection exceeds the 512 MB in-memory safety limit. Select a smaller folder or use a future streaming module."); const data = await fs.readFile(full); files.push({ name: path.relative(folder, full), path: full, bytes: data.toString("base64"), mimeType: mimeFor(path.extname(entry.name)) }); } } }
    await visit(folder); return { name: path.basename(folder), path: folder, files };
  });

  ipcMain.handle("files:save", async (_event, { name, bytes, encoding = "base64", defaultPath }) => {
    const result = await dialog.showSaveDialog({ title: "Save MethodMesh output", defaultPath: defaultPath || name });
    if (result.canceled || !result.filePath) return null;
    const content = Buffer.from(bytes, encoding);
    await fs.writeFile(result.filePath, content);
    const artifact = await artifacts.store({ name: path.basename(result.filePath), bytes: content.toString("base64"), mediaType: mimeFor(path.extname(result.filePath)), operation: "explicit-export" });
    return { filePath: result.filePath, artifact };
  });

  ipcMain.handle("timestamp:request", async (_event, { bytes, name, tsaUrl = "https://freetsa.org/tsr", timeoutMs = 10000, requestId = crypto.randomUUID() }) => {
    const endpoint = tsaUrl.trim() || "https://freetsa.org/tsr";
    if (endpoint !== "https://freetsa.org/tsr") throw new Error("Custom TSAs are not enabled yet: this desktop build currently verifies only the pinned FreeTSA trust registry.");
    const timeout = Math.max(1000, Math.min(30000, Number(timeoutMs) || 10000));
    const controller = new AbortController();
    timestampControllers.set(requestId, controller);
    try {
    const source = Buffer.from(bytes, "base64");
    const digest = crypto.createHash("sha256").update(source).digest();
    const nonce = crypto.randomBytes(16);
    const request = makeTimestampRequest(digest, nonce);
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/timestamp-query", accept: "application/timestamp-reply" }, body: request, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]) });
    if (!response.ok) throw new Error(`FreeTSA returned ${response.status} ${response.statusText}.`);
    const responseDer = Buffer.from(await response.arrayBuffer());
    const certificateResponses = await Promise.all([fetch("https://freetsa.org/files/tsa.crt"), fetch("https://freetsa.org/files/cacert.pem")]);
    if (!certificateResponses.every((item) => item.ok)) throw new Error("Could not retrieve FreeTSA certificate material.");
    const signerBytes = Buffer.from(await certificateResponses[0].arrayBuffer());
    const rootBytes = Buffer.from(await certificateResponses[1].arrayBuffer());
    if (sha256(signerBytes) !== FREETSA_SIGNER_FILE_SHA256 || sha256(rootBytes) !== FREETSA_ROOT_FILE_SHA256) throw new Error("FreeTSA certificate material did not match the pinned MethodMesh trust registry. Timestamp proof was not saved.");
    const verification = await verifyResponse(responseDer, source, digest, nonce, signerBytes);
    return { source: { name, sha256: digest.toString("hex"), sizeBytes: source.length }, tsaUrl: endpoint, timeoutMs: timeout, request: request.toString("base64"), response: responseDer.toString("base64"), signer: signerBytes.toString("base64"), root: rootBytes.toString("base64"), trust: "FreeTSA signer and root certificate files matched the pinned MethodMesh registry; the token signer matched the pinned signer.", ...verification };
    } finally { timestampControllers.delete(requestId); }
  });
  ipcMain.handle("timestamp:cancel", (_event, requestId) => { timestampControllers.get(requestId)?.abort(); return true; });

  ipcMain.handle("timestamp:save-proof", async (_event, evidence) => {
    const zip = new JSZip();
    zip.file("timestamp.tsq", evidence.request, { base64: true }); zip.file("timestamp.tsr", evidence.response, { base64: true });
    zip.file("tsa-signing-cert.crt", evidence.signer, { base64: true }); zip.file("tsa-root.pem", evidence.root, { base64: true });
    zip.file("proof.json", JSON.stringify({ type: "methodmesh.rfc3161-proof", version: 1, authority: "FreeTSA", authorityUrl: "https://freetsa.org/tsr", source: evidence.source, timestamp: evidence.timestamp, serial: evidence.serial, tokenSha256: evidence.tokenSha256, verification: evidence.verification, trust: evidence.trust }, null, 2));
    if (evidence.manifest) zip.file("manifest.json", evidence.manifest);
    zip.file("verify.py", pythonVerifier());
    zip.file("README.txt", proofReadme());
    const fallback = `${path.parse(evidence.source.name).name}.timestamp-proof.zip`;
    const defaultPath = evidence.sourcePath ? `${evidence.sourcePath}.timestamp-proof.zip` : fallback;
    const result = await dialog.showSaveDialog({ title: "Save RFC 3161 proof", defaultPath });
    if (result.canceled || !result.filePath) return null;
    const content = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    await fs.writeFile(result.filePath, content);
    const artifact = await artifacts.store({ name: path.basename(result.filePath), bytes: content.toString("base64"), mediaType: "application/zip", operation: "trusted-timestamp.proof" });
    return { filePath: result.filePath, artifact };
  });

  ipcMain.handle("timestamp:save-in-place", async (_event, { evidence, sourcePath, manifestFolder }) => {
    const zip = new JSZip(); zip.file("timestamp.tsq", evidence.request, { base64: true }); zip.file("timestamp.tsr", evidence.response, { base64: true }); zip.file("tsa-signing-cert.crt", evidence.signer, { base64: true }); zip.file("tsa-root.pem", evidence.root, { base64: true }); zip.file("proof.json", JSON.stringify({ source: evidence.source, timestamp: evidence.timestamp, tokenSha256: evidence.tokenSha256, trust: evidence.trust }, null, 2)); if (evidence.manifest) zip.file("manifest.json", evidence.manifest); zip.file("verify.py", pythonVerifier()); zip.file("README.txt", proofReadme());
    const output = manifestFolder ? path.join(manifestFolder, "folder-manifest-timestamp-proof.zip") : `${sourcePath}.timestamp-proof.zip`;
    const content = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    await fs.writeFile(output, content); const artifact = await artifacts.store({ name: path.basename(output), bytes: content.toString("base64"), mediaType: "application/zip", operation: "trusted-timestamp.proof" }); return { filePath: output, artifact };
  });

  ipcMain.handle("timestamp:verify", async (_event, { source, proof, certificate }) => {
    const sourceBytes = Buffer.from(source.bytes, "base64");
    let response = Buffer.from(proof.bytes, "base64");
    let bundledCertificate = certificate ? Buffer.from(certificate.bytes, "base64") : null;
    let bundledRoot = null;
    if (proof.name.toLowerCase().endsWith(".zip")) {
      const bundle = await JSZip.loadAsync(response);
      const token = bundle.file("timestamp.tsr");
      if (!token) throw new Error("That ZIP is not a MethodMesh timestamp proof: timestamp.tsr is missing.");
      response = await token.async("nodebuffer");
      if (!bundledCertificate) { const signer = bundle.file("tsa-signing-cert.pem") || bundle.file("tsa-signing-cert.crt"); if (signer) bundledCertificate = await signer.async("nodebuffer"); }
      const root = bundle.file("tsa-root.pem"); if (root) bundledRoot = await root.async("nodebuffer");
    }
    if (!bundledCertificate) throw new Error("A FreeTSA signer certificate is required. Provide a proof ZIP or the matching TSA .pem/.crt file.");
    if (sha256(bundledCertificate) !== FREETSA_SIGNER_FILE_SHA256) throw new Error("The supplied TSA signer certificate is not the pinned FreeTSA signer certificate.");
    if (bundledRoot && sha256(bundledRoot) !== FREETSA_ROOT_FILE_SHA256) throw new Error("The bundled TSA root certificate is not the pinned FreeTSA root certificate.");
    const digest = crypto.createHash("sha256").update(sourceBytes).digest();
    const details = await verifyResponse(response, sourceBytes, digest, null, bundledCertificate);
    return { valid: true, source: { name: source.name, sha256: digest.toString("hex"), sizeBytes: sourceBytes.length }, proof: proof.name, certificateSupplied: Boolean(bundledCertificate), trust: "Token signer certificate matched the pinned FreeTSA signer registry.", ...details };
  });

  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

function mimeFor(extension) {
  return ({ ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" })[extension.toLowerCase()] || "application/octet-stream";
}

function makeTimestampRequest(digest, nonce) {
  const oid = Buffer.from("0609608648016503040201", "hex");
  const algorithm = der(0x30, Buffer.concat([oid, Buffer.from([0x05, 0x00])]));
  const imprint = der(0x30, Buffer.concat([algorithm, der(0x04, digest)]));
  return der(0x30, Buffer.concat([Buffer.from([0x02, 0x01, 0x01]), imprint, der(0x02, positive(nonce)), Buffer.from([0x01, 0x01, 0xff])]));
}
function der(tag, body) { const length = body.length < 128 ? Buffer.from([body.length]) : Buffer.from([0x81, body.length]); return Buffer.concat([Buffer.from([tag]), length, body]); }
function positive(bytes) { return bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes; }
function sha256(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function proofReadme() {
  return `RFC 3161 timestamp proof bundle

This folder contains a signed FreeTSA timestamp response (timestamp.tsr), its
request (timestamp.tsq), certificate material, proof metadata, and verify.py.
The original source is deliberately not included.

Quick Python verification
-------------------------
1. Unzip this proof bundle into an empty folder.
2. Copy the unchanged original file into that same folder. Do not rename or
   modify timestamp.tsr, the certificate files, or verify.py.
3. Open a terminal in that folder.
4. Run:  python3 verify.py "your-original-file.ext"

The helper uses the locally installed OpenSSL command-line tool to validate the
RFC 3161 signature and to check that the token's message imprint is the SHA-256
digest of the original file. It prints the certificate generation time from the
token. A successful result means these exact bytes existed no later than that
time.

You need Python 3 and OpenSSL available on your PATH. The desktop app's
Verify timestamp capability performs the same source/token checks without a
terminal. A timestamp does not prove authorship, original creation time, or
legal validity.
`;
}
function pythonVerifier() {
  return `#!/usr/bin/env python3
"""Verify this RFC 3161 proof against an unchanged original file."""
from pathlib import Path
import hashlib
import shutil
import subprocess
import sys

if len(sys.argv) != 2:
    raise SystemExit("Usage: python3 verify.py <original-file>")

original = Path(sys.argv[1])
if not original.is_file():
    raise SystemExit(f"Original file not found: {original}")
openssl = shutil.which("openssl")
if not openssl:
    raise SystemExit("OpenSSL was not found on PATH. Install it, then run this command again.")

digest = hashlib.sha256(original.read_bytes()).hexdigest()
print(f"Original SHA-256: {digest}")
command = [openssl, "ts", "-verify", "-data", str(original), "-in", "timestamp.tsr", "-CAfile", "tsa-root.pem", "-untrusted", "tsa-signing-cert.crt"]
verified = subprocess.run(command, text=True, capture_output=True)
if verified.returncode:
    print(verified.stdout, end="")
    print(verified.stderr, end="", file=sys.stderr)
    raise SystemExit("INVALID: the signature or file imprint did not verify.")
print("VALID: signature and original file imprint match.")
details = subprocess.run([openssl, "ts", "-reply", "-in", "timestamp.tsr", "-text"], text=True, capture_output=True)
for line in details.stdout.splitlines():
    if "Time stamp:" in line or "Serial number:" in line:
        print(line.strip())
`;
}
async function verifyResponse(responseDer, source, expectedDigest, nonce, expectedSigner) {
  const parsed = asn1js.fromBER(responseDer); if (parsed.offset === -1) throw new Error("FreeTSA returned invalid ASN.1.");
  const fields = parsed.result.valueBlock.value; const status = fields[0]?.valueBlock.value[0]?.valueBlock.valueDec;
  if (status !== 0 && status !== 1) throw new Error(`FreeTSA declined the timestamp request (PKI status ${status ?? "unknown"}).`);
  const signedData = new pkijs.SignedData({ schema: new pkijs.ContentInfo({ schema: fields[1] }).content });
  const content = signedData.encapContentInfo.eContent?.valueBlock.valueHexView; if (!content) throw new Error("The timestamp token contains no TSTInfo.");
  const info = asn1js.fromBER(content).result.valueBlock.value; const imprint = info[2]?.valueBlock.value;
  if (!Buffer.from(imprint?.[1]?.valueBlock.valueHexView || []).equals(expectedDigest)) throw new Error("Timestamp token message imprint does not match the selected file.");
  if (nonce) { const tokenNonce = info.find((field, index) => index > 4 && field.idBlock.tagClass === 1 && field.idBlock.tagNumber === 2); if (!tokenNonce || !Buffer.from(tokenNonce.valueBlock.valueHexView).equals(positive(nonce))) throw new Error("Timestamp token nonce does not match this request."); }
  if (!await signedData.verify({ signer: 0, data: source, checkChain: false })) throw new Error("Timestamp token signature verification failed.");
  if (expectedSigner && !signedDataHasCertificate(signedData, expectedSigner)) throw new Error("Timestamp token signer does not match the supplied or pinned TSA signing certificate.");
  const generated = info[4];
  const timestamp = generated?.toDate ? generated.toDate().toISOString() : (generated?.valueBlock?.value || "RFC 3161 token");
  return { timestamp, serial: Buffer.from(info[3]?.valueBlock.valueHexView || []).toString("hex"), tokenSha256: crypto.createHash("sha256").update(responseDer).digest("hex"), verification: nonce ? "Cryptographically verified: TSA signature, SHA-256 message imprint, nonce and pinned signer." : `Cryptographically verified: TSA signature and SHA-256 message imprint${expectedSigner ? ", with supplied signer certificate" : ""}.` };
}

function signedDataHasCertificate(signedData, expectedCertificate) {
  const raw = pemOrDer(expectedCertificate);
  const parsed = asn1js.fromBER(raw);
  if (parsed.offset === -1) throw new Error("The TSA signing certificate is not valid DER or PEM.");
  const expected = Buffer.from(parsed.result.toBER(false));
  return (signedData.certificates || []).some(certificate => Buffer.from(certificate.toSchema().toBER(false)).equals(expected));
}

function pemOrDer(value) {
  const bytes = Buffer.from(value);
  const text = bytes.toString("utf8").trim();
  if (!text.startsWith("-----BEGIN")) return bytes;
  const body = text.replace(/-----BEGIN[^-]+-----/g, "").replace(/-----END[^-]+-----/g, "").replace(/\s+/g, "");
  return Buffer.from(body, "base64");
}
