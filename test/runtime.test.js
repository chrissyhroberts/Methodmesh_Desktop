const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DesktopRuntime } = require("../src/main/runtime");

(async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "methodmesh-runtime-"));
  const runtime = new DesktopRuntime({
    app: { getPath: () => temporary },
    modulesDirectory: path.join(__dirname, "..", "modules")
  });
  await runtime.initialise();
  assert.equal(runtime.catalogue().length, 4);
  assert.equal(runtime.catalogue().flatMap(module => module.capabilities).length, 5);
  const preset = await runtime.savePreset({ name: "Fast FreeTSA", capabilityId: "trusted-timestamp", settings: { tsaUrl: "https://freetsa.org/tsr", timeoutMs: 5000 } });
  assert.equal(preset.capabilityVersion, "1.0.0");
  await assert.rejects(() => runtime.savePreset({ name: "Bad setting", capabilityId: "trusted-timestamp", settings: { unknown: true } }));
  const protocol = await runtime.saveProtocol({ name: "Timestamp evidence", steps: [{ presetId: preset.id, inputBinding: "user-selection", outputLifecycle: "persistent", failurePolicy: "stop" }] });
  assert.equal(protocol.steps[0].position, 1);
  const plan = runtime.launchPlan({ targetType: "protocol", targetId: protocol.id });
  assert.equal(plan.steps[0].capabilityId, "trusted-timestamp");
  await assert.rejects(() => runtime.saveProtocol({ name: "Bad protocol", steps: [{ presetId: "missing" }] }));
  const schedule = await runtime.saveSchedule({ name: "Evidence check", targetType: "protocol", targetId: protocol.id, recurrence: "once", interactionPolicy: "manual-only" });
  assert.equal(schedule.status, "planned");
  await assert.rejects(() => runtime.saveSchedule({ name: "Impossible", targetType: "preset", targetId: "missing" }));
  const bundle = runtime.configurationBundle();
  assert.equal(bundle.integrity.algorithm, "sha256");
  const imported = new DesktopRuntime({ app: { getPath: () => path.join(temporary, "imported") }, modulesDirectory: path.join(__dirname, "..", "modules") });
  await imported.initialise();
  await imported.importConfiguration(bundle);
  assert.equal(imported.publicState().protocols.length, 1);
  bundle.presets[0].name = "tampered";
  await assert.rejects(() => imported.importConfiguration(bundle));
  await runtime.saveState({ favourites: ["capability:trusted-timestamp"], presets: [], protocols: [], schedules: [] });
  const execution = await runtime.recordExecution({ capabilityId: "trusted-timestamp", action: "contract fixture", details: { sourcePath: "/private/source.txt", sha256: "abc" } });
  assert.equal(execution.capability.version, "1.0.0");
  assert.equal(execution.details.sourcePath, "[redacted path]");
  assert.equal(runtime.executionHistory().length, 1);
  const completed = await runtime.commitResult({ capabilityId: "image-redaction", action: "fixture result", result: { summary: "Exported image", artifacts: [{ ref: "artifact://abc" }], evidence: { sha256: "abc" } } });
  assert.equal(completed.details.result.version, 1);
  await assert.rejects(() => runtime.commitResult({ capabilityId: "image-redaction", action: "bad result", result: { artifacts: [{ ref: "file:///private/output" }] } }));
  await fs.rm(temporary, { recursive: true, force: true });
  console.log("runtime contract tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
