const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { ArtifactService } = require("../src/main/artifacts");

(async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "methodmesh-artifacts-"));
  const service = new ArtifactService({ app: { getPath: () => temporary } });
  await service.initialise();
  const artifact = await service.store({ name: "result.txt", bytes: Buffer.from("evidence").toString("base64"), mediaType: "text/plain", operation: "fixture" });
  assert.match(artifact.ref, /^artifact:\/\/[a-f0-9]{64}$/);
  assert.equal(service.list().length, 1);
  const destination = path.join(temporary, "exported.txt");
  await service.export(artifact.ref, destination);
  assert.equal(await fs.readFile(destination, "utf8"), "evidence");
  await fs.rm(temporary, { recursive: true, force: true });
  console.log("artifact contract tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
