# MethodMesh Desktop Master Book

**Status:** foundational architecture and governance reference  
**Scope:** MethodMesh Desktop for macOS and Windows  
**Derived from:** the MethodMesh Android Master Book, with Android, ODK/XLSForm and mobile-only transport contracts deliberately removed unless reintroduced by a desktop adapter.

## 1. Purpose and authority

This is the sole project-wide architecture authority for MethodMesh Desktop. It defines the product model, module contract, persistence model, execution rules, and desktop-platform boundaries. A module-level document may add detail, but may not contradict this book.

The normative terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are used in their usual standards sense.

MethodMesh Desktop is a local-first, modular workbench for evidence, files, practical methods, observations, and repeatable workflows. It gives small tools a common home without forcing every activity into a permanent project or cloud service.

## 2. Product model

The desktop product has six first-class concepts:

| Concept | Responsibility | Must not do |
| --- | --- | --- |
| Capability | One canonical operation with declared inputs, settings, outputs and UI | Hide platform dependencies or invent a second private contract |
| Preset | Saved configuration for one capability | Reimplement the capability |
| Protocol | Ordered chain of presets/capabilities with explicit output handling | Copy capability settings into an incompatible workflow format |
| Schedule | Decides **when** a preset or protocol is launched | Define the work itself |
| Artifact | Identifies a source, output or derivative file independently of its location | Imply persistent storage merely by existing |
| Execution result | Immutable record of one completed or failed run | Be altered by a later module upgrade |

The governing rule is:

> Presets and protocols own **what** happens. Schedules own **when** it happens.

Provenance is a property of an execution result. It is not a competing top-level workflow model and is exported only on request or when a workflow explicitly requires it.

## 3. Desktop product surfaces

The desktop host MUST expose these surfaces:

- **Dashboard** — a concise control centre for recent work, runnable presets, active schedules, and available capabilities.
- **Capabilities** — discover and run installed modules.
- **Presets** — create, edit, duplicate, run, export and delete saved capability configurations.
- **Protocols** — author and run ordered workflows with explicit rails between steps.
- **Schedules** — author, activate, pause, inspect and stop planned preset/protocol runs.
- **Files** — persistent view of managed artifacts, logs and exported bundles.
- **Settings** — host, storage, security, network and adapter preferences.

The desktop product does **not** include ODK Forms, Collect contracts, Android intents, app widgets, or Android background-service semantics.

## 4. Capability contract

### Host ignorance is mandatory

The desktop host MUST know nothing about individual capabilities. It MUST NOT contain capability IDs, capability-specific settings, result fields, icons, execution branches, UI labels, output paths, or migration tables. A host release can add a new module without changing host source code.

The host owns only generic mechanisms: module discovery, contract validation, adapter brokering, artifact identity/storage, execution envelopes, generic settings rendering, preset/protocol/schedule repositories, orchestration, result projection, search and optional export.

A module owns its method IDs, manifest, descriptors, settings schema, input/output declarations, UI, icon hint, docs, examples, tests, dependencies, version, maturity, connectivity and all capability-specific behaviour. Generic host surfaces consume this module-owned metadata; they do not maintain parallel capability catalogues.

The resulting dependency direction is one-way:

```text
desktop host / core runtime  <-  module manifests + modules
generic surfaces             <-  core repositories + module metadata
presets / protocols / schedules -> canonical capability executor
```

No module may import another module directly. Cross-capability work is represented by artifact/result bindings in a protocol, never by a hard-coded call from one capability to another.

Every capability has one stable identifier and one canonical contract. It MAY be presented through a dashboard, preset, protocol, schedule or command-line/automation adapter, but all routes MUST call the same operation.

```ts
type CapabilityManifest = {
  id: string;
  version: string;
  displayName: string;
  summary: string;
  maturity: "incoming" | "development" | "experimental" | "production";
  adapters: AdapterRequirement[];
  inputs: InputDeclaration[];
  settings: SettingsSchema;
  outputs: OutputDeclaration[];
  presentation: "interactive" | "headless" | "both";
  run(context: ExecutionContext): Promise<ExecutionResult>;
};
```

### Module runtime metadata and catalogue presentation

The desktop capability catalogue is **module first**. The host renders generic
collapsible module sections from module-owned metadata; it does not maintain a
second list of capability names or module-specific UI branches. Each section
shows the module summary, version, maturity and capability count. A search
temporarily expands matching sections. Favourites belong to individual
capabilities, not to modules, presets or a host-maintained shortcut list.

The catalogue runtime summary reports the installed capability count and module
count, matching the Android runtime's core inventory indicators. Module state
(for example whether a catalogue section is expanded) is local host UI state;
it is not part of a capability contract or execution record.

```ts
type ModuleManifest = {
  id: string;
  displayName: string;
  summary: string;
  version: string;
  maturity: "incoming" | "development" | "experimental" | "production";
  iconHint?: string;
  capabilities: CapabilityManifest[];
};
```

A capability MUST:

1. declare inputs, fixed settings, runtime settings, outputs and required adapters;
2. return a structured result even on a handled failure;
3. identify its own version and maturity in every execution result;
4. declare derivatives rather than overwriting an input artifact;
5. run without knowing whether it was launched directly, from a preset, protocol or schedule.

A capability MUST NOT access Electron, macOS, Windows APIs or arbitrary module-private paths directly. It uses host adapters and artifact references.

## 5. Host adapters and cross-platform boundary

The host owns operating-system integration. A module asks for an abstract capability; a macOS or Windows implementation fulfils it.

| Adapter | Examples | Availability rule |
| --- | --- | --- |
| `file` | choose, read, write, export, batch folder selection | required baseline |
| `evidence` | hashes, receipts, signed result metadata | required baseline |
| `network` | FreeTSA, APIs, weather, translation | permissioned; module must handle offline failure |
| `capture.microphone` | audio recording and acoustic analysis | optional hardware |
| `capture.camera` | webcam capture, QR, visual analysis | optional hardware |
| `location` | OS location, imported coordinates, external GNSS | source and accuracy MUST be recorded |
| `device.bluetooth`, `device.usb`, `device.serial` | printers, instruments, MIDI, external GNSS | optional and platform-dependent |
| `secureStore` | credentials and keys | maps to Keychain / Credential Manager or equivalent |
| `notification` | scheduled reminders and completed-run notices | host-owned |

An unavailable optional adapter MUST produce a clear unavailable state or allow a file/import alternative. MethodMesh Desktop MUST NOT simulate compass, GPS, calibration or sensor readings it cannot acquire.

## 6. Artifacts and Files

An artifact is an opaque identity, not a raw file path:

```ts
type ArtifactRef = `artifact://${string}`;
type Artifact = {
  ref: ArtifactRef;
  displayName: string;
  mediaType: string;
  contentHash?: string;
  origin: "bundled" | "managed" | "external";
  lifecycle: "persistent" | "session" | "transient";
  parent?: ArtifactRef;
  operation?: string;
};
```

- **External** artifacts are selected by the user and remain outside MethodMesh control.
- **Managed** artifacts are imported or produced by a module.
- **Bundled** artifacts ship with the application and are read-only.
- **Transient** artifacts may pass between protocol steps and need not appear in Files.
- **Session** artifacts remain available only for the current run.
- **Persistent** artifacts appear in Files and have explicit retention rules.

Selecting or producing an artifact MUST NOT silently persist it. Import, save, pin, export and delete are explicit actions. A derivative records its parent and producing operation. Source files are never overwritten unless the user performs an explicit save-overwrite action outside the canonical run result.

## 7. Execution and results

An execution is the attempt to run one capability with a fixed configuration and input set. It has a status of `succeeded`, `failed`, `cancelled` or `needs-input`.

`Commit` is the finalisation boundary for interactive work. Before commit, previews and live measurements are mutable. After commit, the output artifact set and execution result are immutable. A new edit produces a new execution/derivative.

```ts
type ExecutionResult = {
  id: string;
  status: "succeeded" | "failed" | "cancelled" | "needs-input";
  capability: { id: string; version: string; maturity: string };
  startedAt: string;
  finishedAt?: string;
  inputs: ArtifactRef[];
  outputs: ArtifactRef[];
  values: Record<string, unknown>;
  provenance: ExecutionProvenance;
  error?: { code: string; message: string };
};
```

The result retains the producing capability identity/version. Regenerating an export later MUST NOT claim that a newer application version produced historic output.

## 8. Presets

A preset is a saved setup over a canonical capability contract. It stores:

- capability ID and compatible version range;
- fixed configuration/settings;
- optional name, description and tags;
- presentation preference (`interactive`, `headless where supported`);
- output preference (transient, persistent log, export prompt).

Preset authoring MUST render the capability’s real configuration schema. It MUST NOT reduce a capable UI into a second, inferior set of generic text boxes.

A preset run resolves the currently installed capability, validates stored settings against its schema, records the preset identity in the execution provenance, and invokes the canonical capability. A missing/incompatible capability makes the preset unavailable; it does not silently substitute another module.

## 9. Protocols and pipes

A protocol is an ordered list of steps. A step references a preset by ID or, for a deliberately unsaved one-off, a capability plus explicit settings. The normal path is preset-backed.

Each step declares:

- the target preset/capability;
- its input binding(s): explicit artifact, prior output, user selection, or no artifact;
- presentation rail: use preset default, force interactive if permitted, or headless if supported;
- output lifecycle: transient, session, persistent, or export;
- failure policy: stop, request user decision, or continue only where the next step does not need the failed output.

Protocols MUST show the user where they are, what input a step receives, what was produced, and what happens next. A protocol must not silently discard a step result required by a later step.

The final protocol result is a structured summary of every child execution and explicitly retained artifacts. It may be exported as a bundle.

## 10. Schedules

Schedules are local plans targeting a preset or protocol by ID. They never copy target settings; resolving the target at dispatch time preserves the canonical model.

A schedule plan stores:

- target type and ID;
- timezone;
- activation/start policy (`manual`, `start now`, `absolute time`);
- recurrence (`once`, interval, calendar rule);
- termination (`occurrences`, end date, `forever`);
- enabled/paused state;
- interaction policy and notification policy.

Desktop schedules MUST be explicit about whether the target requires interaction. A target that needs a human, file picker, camera permission, or unconnected device MUST notify and wait; it MUST NOT pretend it completed headlessly.

The host scheduler owns timing, persistence, missed-run policy, notification delivery, and restart recovery. Schedules are local to the machine unless exported/imported through an explicit deterministic format.

## 11. Provenance and optional export

Provenance explains the origin and lineage of results. It includes capability identity/version, input/output hashes where available, settings excluding secrets, adapter/source declarations, time evidence, parent artifact links, and protocol/schedule context.

It MUST NOT contain passwords, private keys, access tokens, or arbitrary filesystem paths unless a user explicitly chooses an export format that includes paths.

Every execution has provenance in the internal result model. Exporting `provenance.json` is optional. A module may additionally export a human-readable report, receipt, signed bundle, or standards-specific proof (for example an RFC 3161 timestamp proof).

## 12. Security, privacy and trust

MethodMesh Desktop is local-first. Source data remains local unless a capability declares a network request and the user initiates it.

- Network capabilities MUST name the recipient/service and the data class sent.
- Trusted timestamping hashes source bytes locally and sends the message imprint, nonce and protocol metadata—not the source bytes.
- Secure credentials use the `secureStore` adapter; they MUST NOT be written to preset, protocol, schedule, log or provenance JSON.
- External tools and device adapters are permissioned and discoverable in Settings.
- Cryptographic consistency, authority trust and legal validity are separate claims. UI and exports MUST label them separately.

## 13. Module discovery and lifecycle

Modules are self-contained packages with manifest, implementation, settings schema, UI contribution, tests, documentation and optional bundled resources. The host discovers manifests; it does not hard-code module-specific dashboard logic.

New modules enter an explicit lane: `incoming`, `development`, `experimental` or `production`. The host displays maturity and required adapters. A module cannot claim production merely because it is installed.

## 14. Data storage, backup and migration

The host stores module-neutral records for artifacts, presets, protocols, schedules and execution results. Module settings remain namespaced by capability ID/version.

Configuration export/import MUST be deterministic and integrity-checked. It includes presets, protocols, schedules and selected host settings, but excludes secrets and raw artifact bytes unless an explicit bundle format says otherwise. Schema migrations are versioned and reversible where practical.

### Backend architecture

The backend is a module-neutral core with these repositories/services:

| Service | Owns | Must not own |
| --- | --- | --- |
| `ModuleRegistry` | discovery, manifest validation, capability descriptors | module behaviour or special cases |
| `CapabilityExecutor` | canonical invocation, launch context, execution envelope | preset/protocol/schedule storage |
| `ArtifactService` | opaque refs, origins, lifecycle, byte resolution, derivatives | capability-specific folders |
| `PresetRepository` | preset records referencing capability IDs | duplicated capability settings semantics |
| `ProtocolRepository` | ordered steps, bindings, policies | direct module imports |
| `ProtocolRunner` | step state, output bindings, child-result collation | alternate capability implementation |
| `ScheduleRepository` | schedule plans and activation state | copied target settings |
| `Scheduler` | timing, dispatch, missed-run and notification policy | capability-specific timing logic |
| `ExecutionRepository` | immutable result history and provenance records | mutable live UI state |
| `ConfigurationBundleService` | deterministic export/import and integrity checking | secrets unless explicitly supported |

All persistent records reference stable IDs. Presets reference a capability ID; protocol steps reference a preset/capability ID; schedules reference a preset/protocol ID; artifacts reference parent artifacts; executions reference all of the above by snapshot plus stable ID. Deleting or upgrading one record MUST result in an explicit unavailable/migration state, never a silent substitution.

## 15. Current implementation boundary

The first desktop release implements:

- a host shell and discovered capability registry;
- local file selection/export;
- image redaction and FreeTSA RFC 3161 timestamp capabilities;
- a local workflow model for presets, protocols and schedules;
- explicit proof/provenance export.

The following are planned before calling the workflow layer complete:

1. persistent artifact store and Files surface;
2. capability settings schemas and preset editing;
3. executable protocol runner with artifact bindings;
4. durable schedule engine with notifications and missed-run handling;
5. import/export and migration of workflow configuration;
6. adapter registry for microphone, webcam, Bluetooth, USB/serial and secure storage.

## 16. Non-goals and deliberate exclusions

MethodMesh Desktop does not port Android code verbatim. It does not include ODK contracts, Collect integration, Android intents, SMS, NFC, ESP-NOW, mobile compass behaviour, or simulated sensors. Hardware-oriented capabilities may return in a later release only through truthful desktop adapters or supported external devices.
