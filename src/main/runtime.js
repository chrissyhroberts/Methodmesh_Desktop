const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const MATURITY = new Set(["incoming", "development", "experimental", "production"]);

/** Module-neutral persistence and manifest discovery boundary. */
class DesktopRuntime {
  constructor({ app, modulesDirectory }) {
    this.app = app;
    this.modulesDirectory = modulesDirectory;
    this.statePath = path.join(app.getPath("userData"), "methodmesh-runtime.json");
    this.state = { version: 1, presets: [], protocols: [], schedules: [], favourites: [], executions: [] };
    this.modules = [];
    this.writeQueue = Promise.resolve();
  }

  async initialise() {
    this.modules = await this.discoverModules();
    try {
      const loaded = JSON.parse(await fs.readFile(this.statePath, "utf8"));
      this.state = { ...this.state, ...loaded, version: 1 };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  async discoverModules() {
    const entries = await fs.readdir(this.modulesDirectory, { withFileTypes: true });
    const modules = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(this.modulesDirectory, entry.name, "manifest.json");
      try {
        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        validateModuleManifest(manifest, manifestPath);
        modules.push(manifest);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (!modules.length) throw new Error("No MethodMesh module manifests were discovered.");
    const ids = modules.map(module => module.id);
    if (new Set(ids).size !== ids.length) throw new Error("MethodMesh module IDs must be unique.");
    const capabilityIds = modules.flatMap(module => module.capabilities.map(capability => capability.id));
    if (new Set(capabilityIds).size !== capabilityIds.length) throw new Error("MethodMesh capability IDs must be unique.");
    return modules.sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  catalogue() { return this.modules; }
  publicState() { const { executions, ...state } = this.state; return state; }
  executionHistory() { return this.state.executions; }

  /** Resolve persisted work into a capability-neutral launch plan.
   * The host does not infer inputs or settings: every step remains owned by
   * its module manifest and the saved preset that selected it. */
  launchPlan({ targetType, targetId }) {
    if (!new Set(["preset", "protocol"]).has(targetType)) throw new Error("A launch target must be a preset or protocol.");
    const presets = new Map(this.state.presets.map(preset => [preset.id, preset]));
    const makeStep = (preset, position = 1, policy = {}) => {
      if (!preset) throw new Error("The saved preset is unavailable.");
      const capability = this.capability(preset.targetId);
      if (!capability || capability.version !== preset.capabilityVersion) throw new Error(`Preset '${preset.name}' requires an unavailable or incompatible capability.`);
      validateSettings(capability.settings || [], preset.settings || {});
      return { id: crypto.randomUUID(), position, presetId: preset.id, presetName: preset.name, capabilityId: capability.id, capabilityName: capability.displayName, settings: preset.settings || {}, inputBinding: policy.inputBinding || "user-selection", outputLifecycle: policy.outputLifecycle || "persistent", failurePolicy: policy.failurePolicy || "stop" };
    };
    if (targetType === "preset") return { id: crypto.randomUUID(), targetType, targetId, createdAt: new Date().toISOString(), steps: [makeStep(presets.get(targetId))] };
    const protocol = this.state.protocols.find(item => item.id === targetId);
    if (!protocol) throw new Error("The selected protocol is unavailable.");
    const steps = protocol.steps.map((step, index) => makeStep(presets.get(step.presetId), index + 1, step));
    for (let index = 1; index < steps.length; index += 1) {
      if (steps[index].inputBinding !== "prior-output") continue;
      const prior = this.capability(steps[index - 1].capabilityId), next = this.capability(steps[index].capabilityId);
      const outputs = new Set(prior.execution?.outputs || []), inputs = next.execution?.inputs || [];
      if (!inputs.some(input => outputs.has(input))) throw new Error(`Protocol step ${index + 1} cannot accept an output from step ${index}.`);
    }
    return { id: crypto.randomUUID(), targetType, targetId, protocolName: protocol.name, createdAt: new Date().toISOString(), steps };
  }

  dueSchedules(now = new Date()) {
    return this.state.schedules.filter(schedule => {
      if (!schedule.enabled || schedule.status === "completed" || schedule.startPolicy === "manual") return false;
      if (!schedule.startsAt) return schedule.startPolicy === "start-now";
      return new Date(schedule.startsAt) <= now;
    });
  }

  async saveState(next) {
    this.state = {
      ...this.state,
      presets: Array.isArray(next.presets) ? next.presets : [],
      protocols: Array.isArray(next.protocols) ? next.protocols : [],
      schedules: Array.isArray(next.schedules) ? next.schedules : [],
      favourites: Array.isArray(next.favourites) ? next.favourites : []
    };
    await this.persist();
    return this.publicState();
  }

  async savePreset({ name, capabilityId, settings = {}, description = "", presentation = "interactive", outputPreference = "export" }) {
    const capability = this.capability(capabilityId);
    if (!capability) throw new Error(`The capability '${capabilityId}' is not installed.`);
    const cleanName = String(name || "").trim();
    if (!cleanName) throw new Error("A preset name is required.");
    validateSettings(capability.settings || [], settings);
    const preset = {
      id: crypto.randomUUID(), name: cleanName, description: String(description || ""), targetId: capability.id, targetName: capability.displayName,
      capabilityVersion: capability.version, settings, presentation, outputPreference, createdAt: new Date().toISOString()
    };
    this.state.presets.push(preset);
    await this.persist();
    return preset;
  }

  async saveProtocol({ name, description = "", steps }) {
    const cleanName = String(name || "").trim();
    if (!cleanName) throw new Error("A protocol name is required.");
    if (!Array.isArray(steps) || !steps.length) throw new Error("A protocol needs at least one preset step.");
    const presets = new Map(this.state.presets.map(preset => [preset.id, preset]));
    const allowedBindings = new Set(["no-input", "user-selection", "prior-output", "explicit-artifact"]);
    const allowedLifecycles = new Set(["transient", "session", "persistent", "export"]);
    const allowedFailures = new Set(["stop", "request-user-decision", "continue-if-independent"]);
    const normalized = steps.map((step, index) => {
      const preset = presets.get(step.presetId);
      if (!preset) throw new Error(`Protocol step ${index + 1} references an unavailable preset.`);
      const inputBinding = step.inputBinding || "no-input", outputLifecycle = step.outputLifecycle || "persistent", failurePolicy = step.failurePolicy || "stop";
      if (!allowedBindings.has(inputBinding) || !allowedLifecycles.has(outputLifecycle) || !allowedFailures.has(failurePolicy)) throw new Error(`Protocol step ${index + 1} has an invalid execution policy.`);
      if (inputBinding === "prior-output" && index === 0) throw new Error("The first protocol step cannot use a prior output.");
      return { id: crypto.randomUUID(), position: index + 1, presetId: preset.id, presetName: preset.name, inputBinding, outputLifecycle, failurePolicy };
    });
    const protocol = { id: crypto.randomUUID(), name: cleanName, description: String(description || ""), version: 1, steps: normalized, createdAt: new Date().toISOString() };
    this.state.protocols.push(protocol);
    await this.persist();
    return protocol;
  }

  async saveSchedule({ name, targetType, targetId, timezone, startPolicy = "manual", startsAt = null, recurrence = "once", intervalMinutes = null, interactionPolicy = "manual-only", enabled = false }) {
    const cleanName = String(name || "").trim();
    if (!cleanName) throw new Error("A schedule name is required.");
    if (!new Set(["preset", "protocol"]).has(targetType)) throw new Error("A schedule must target a preset or protocol.");
    const records = targetType === "preset" ? this.state.presets : this.state.protocols;
    if (!records.some(record => record.id === targetId)) throw new Error("The selected schedule target is unavailable.");
    if (!new Set(["manual", "start-now", "absolute-time"]).has(startPolicy)) throw new Error("Invalid schedule start policy.");
    if (startPolicy === "absolute-time" && !startsAt) throw new Error("An absolute schedule requires a start time.");
    if (!new Set(["once", "interval"]).has(recurrence)) throw new Error("Invalid schedule recurrence.");
    if (recurrence === "interval" && (!Number.isInteger(Number(intervalMinutes)) || Number(intervalMinutes) < 1)) throw new Error("An interval schedule needs a positive interval in minutes.");
    if (!new Set(["headless-safe", "notify-and-open", "manual-only"]).has(interactionPolicy)) throw new Error("Invalid schedule interaction policy.");
    const schedule = { id: crypto.randomUUID(), name: cleanName, targetType, targetId, timezone: timezone || "local", startPolicy, startsAt, recurrence, intervalMinutes: recurrence === "interval" ? Number(intervalMinutes) : null, interactionPolicy, enabled: Boolean(enabled), status: "planned", createdAt: new Date().toISOString() };
    this.state.schedules.push(schedule);
    await this.persist();
    return schedule;
  }

  configurationBundle() {
    const payload = { version: 1, presets: this.state.presets, protocols: this.state.protocols, schedules: this.state.schedules };
    const canonical = canonicalJson(payload);
    return { ...payload, exportedAt: new Date().toISOString(), integrity: { algorithm: "sha256", value: crypto.createHash("sha256").update(canonical).digest("hex") } };
  }

  async importConfiguration(bundle) {
    if (!bundle || bundle.version !== 1 || !bundle.integrity || bundle.integrity.algorithm !== "sha256") throw new Error("Unsupported MethodMesh configuration bundle.");
    const payload = { version: 1, presets: bundle.presets || [], protocols: bundle.protocols || [], schedules: bundle.schedules || [] };
    const hash = crypto.createHash("sha256").update(canonicalJson(payload)).digest("hex");
    if (hash !== bundle.integrity.value) throw new Error("Configuration bundle integrity check failed.");
    for (const preset of payload.presets) {
      const capability = this.capability(preset.targetId);
      if (!capability || capability.version !== preset.capabilityVersion) throw new Error(`Preset '${preset.name}' requires an unavailable or incompatible capability.`);
      validateSettings(capability.settings || [], preset.settings || {});
    }
    const presetIds = new Set(payload.presets.map(preset => preset.id));
    for (const protocol of payload.protocols) for (const step of protocol.steps || []) if (!presetIds.has(step.presetId) && !this.state.presets.some(preset => preset.id === step.presetId)) throw new Error(`Protocol '${protocol.name}' references a missing preset.`);
    const unique = (existing, incoming) => [...existing, ...incoming.filter(record => !existing.some(item => item.id === record.id))];
    this.state.presets = unique(this.state.presets, payload.presets);
    this.state.protocols = unique(this.state.protocols, payload.protocols);
    this.state.schedules = unique(this.state.schedules, payload.schedules);
    await this.persist();
    return { presets: payload.presets.length, protocols: payload.protocols.length, schedules: payload.schedules.length };
  }

  async recordExecution({ capabilityId, action, status = "succeeded", details = {}, startedAt, finishedAt }) {
    const capability = this.capability(capabilityId);
    if (!capability) throw new Error(`Unknown capability '${capabilityId}'.`);
    const record = {
      id: crypto.randomUUID(), status, action, startedAt: startedAt || new Date().toISOString(), finishedAt: finishedAt || new Date().toISOString(),
      capability: { id: capability.id, name: capability.displayName, version: capability.version, maturity: capability.maturity },
      module: { id: capability.module.id, name: capability.module.displayName, version: capability.module.version, maturity: capability.module.maturity },
      details: redactPaths(details)
    };
    this.state.executions.unshift(record);
    this.state.executions = this.state.executions.slice(0, 1000);
    await this.persist();
    return record;
  }

  /** Canonical module result envelope for direct runs and future protocol steps. */
  async commitResult({ capabilityId, action, result, startedAt, finishedAt }) {
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("A capability result must be an object.");
    const status = result.status || "succeeded";
    if (!new Set(["succeeded", "failed", "cancelled"]).has(status)) throw new Error("A capability result has an invalid status.");
    const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
    for (const artifact of artifacts) {
      if (!artifact || typeof artifact !== "object" || typeof artifact.ref !== "string" || !artifact.ref.startsWith("artifact://")) throw new Error("Result artifacts must use artifact:// references.");
    }
    return this.recordExecution({ capabilityId, action, status, startedAt, finishedAt, details: {
      result: { version: 1, status, summary: String(result.summary || ""), artifacts, evidence: result.evidence || {}, outputs: result.outputs || {} }
    } });
  }

  capability(id) { return this.modules.flatMap(module => module.capabilities.map(item => ({ ...item, module }))).find(item => item.id === id); }

  async persist() {
    this.writeQueue = this.writeQueue.then(async () => {
      const temporary = `${this.statePath}.${process.pid}.tmp`;
      await fs.mkdir(path.dirname(this.statePath), { recursive: true });
      await fs.writeFile(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 });
      await fs.rename(temporary, this.statePath);
    });
    return this.writeQueue;
  }
}

function validateModuleManifest(module, source) {
  const requireText = (value, name) => { if (typeof value !== "string" || !value.trim()) throw new Error(`${source}: ${name} must be a nonblank string.`); };
  ["id", "displayName", "summary", "version", "maturity"].forEach(name => requireText(module[name], name));
  if (module.rendererEntry !== undefined) {
    requireText(module.rendererEntry, "rendererEntry");
    if (module.rendererEntry.includes("..") || path.isAbsolute(module.rendererEntry)) throw new Error(`${source}: rendererEntry must be a module-relative path.`);
  }
  if (!MATURITY.has(module.maturity)) throw new Error(`${source}: invalid module maturity '${module.maturity}'.`);
  if (!Array.isArray(module.capabilities) || !module.capabilities.length) throw new Error(`${source}: capabilities must be a non-empty array.`);
  for (const capability of module.capabilities) {
    ["id", "displayName", "summary", "version", "maturity", "presentation"].forEach(name => requireText(capability[name], name));
    if (!MATURITY.has(capability.maturity)) throw new Error(`${source}: invalid capability maturity '${capability.maturity}'.`);
    if (!Array.isArray(capability.adapters)) throw new Error(`${source}: ${capability.id}.adapters must be an array.`);
    if (!Array.isArray(capability.settings || [])) throw new Error(`${source}: ${capability.id}.settings must be an array.`);
    if (capability.execution !== undefined) {
      if (!capability.execution || typeof capability.execution !== "object") throw new Error(`${source}: ${capability.id}.execution must be an object.`);
      if (!Array.isArray(capability.execution.inputs || []) || !Array.isArray(capability.execution.outputs || [])) throw new Error(`${source}: ${capability.id}.execution must declare input and output arrays.`);
    }
    for (const setting of capability.settings || []) {
      if (!setting || typeof setting !== "object") throw new Error(`${source}: ${capability.id}.settings entries must be objects.`);
      requireText(setting.id, `${capability.id}.setting.id`); requireText(setting.type, `${capability.id}.setting.type`);
    }
  }
}

function redactPaths(value) {
  if (Array.isArray(value)) return value.map(redactPaths);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /path/i.test(key) ? "[redacted path]" : redactPaths(item)]));
}

function validateSettings(schema, settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("Preset settings must be an object.");
  const declared = new Map(schema.map(setting => [setting.id, setting]));
  for (const [id, value] of Object.entries(settings)) {
    const setting = declared.get(id);
    if (!setting) throw new Error(`'${id}' is not a declared capability setting.`);
    if (setting.type === "integer") {
      const number = Number(value);
      if (!Number.isInteger(number) || (setting.minimum !== undefined && number < setting.minimum) || (setting.maximum !== undefined && number > setting.maximum)) throw new Error(`'${id}' must be an integer within its declared range.`);
    }
    if (setting.type === "choice" && !setting.choices?.includes(value)) throw new Error(`'${id}' must be one of the declared choices.`);
    if (setting.type === "text" && typeof value !== "string") throw new Error(`'${id}' must be text.`);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

module.exports = { DesktopRuntime };
