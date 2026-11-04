# MethodMesh Desktop implementation roadmap

**Authority:** `METHODMESH_DESKTOP_MASTER_BOOK.md` governs this roadmap.  
**Migration input:** `android_modules/` contains 81 Android module templates. It is reference material, not source code to copy into the desktop runtime.

## Outcome

Deliver a macOS/Windows, local-first MethodMesh host where capabilities run through one canonical contract; presets configure them; protocols compose them; schedules decide when to launch them; artifacts flow between them; and provenance is an optional export.

## Guiding migration rule

Port the **method**, contract, algorithms, documentation, test cases and evidence semantics—not Android UI, Android storage paths, intents, ODK examples, or Android hardware APIs.

Every Android module receives one of these dispositions before any code is written:

| Disposition | Meaning | Examples |
| --- | --- | --- |
| Direct | File, data or computation capability with no material platform dependency | `filelab`, `texttools`, `conversions`, `fieldstats` |
| Adapter port | Same capability, but the input/output layer changes for desktop | `acoustics`, `documentscanner`, `qrcode`, `speechtranscription` |
| External-device port | Valid only when a supported Bluetooth/USB/serial/MIDI device is present | `bluetoothprinter`, `hamradio`, `sensorread` |
| Deferred | Android/ODK/mobile-radio feature with no truthful baseline desktop equivalent | `odkformlauncher`, `espmesh`, `sms`, `compass`, `nfc` |

## Phase 0 — Stabilise the host

**Goal:** make the current shell a safe base for every later module.

- Replace the in-renderer registry with manifest discovery from `modules/<id>/manifest.json`.
- Enforce host ignorance: no capability ID, settings field, icon, output field or capability-specific execution branch may live outside a module directory.
- Create the module-neutral `ModuleRegistry`, `CapabilityExecutor`, `ArtifactService`, `PresetRepository`, `ProtocolRepository`, `ProtocolRunner`, `ScheduleRepository`, `Scheduler`, `ExecutionRepository`, and `ConfigurationBundleService` interfaces before adding UI.
- Define TypeScript interfaces for capability, artifact, execution result, preset, protocol, schedule and adapter.
- Add a persistent local data store with versioned migrations.
- Implement the `file`, `evidence`, `network`, `secureStore`, and `notification` host adapters.
- Establish module test fixtures and a sample capability used only for contract testing.
- Preserve the existing Image Redaction and Trusted Timestamp modules as the acceptance fixtures.

**Exit criteria:** a module can be installed/discovered, run through a test harness, return a versioned execution result, and export optional provenance without depending on renderer-local state; adding a contract-test module requires no host code change.

**Progress (desktop prototype):** manifest discovery, persisted state, artifacts, execution history, adapter inventory and validated protocol launch plans are implemented. Renderer implementations still need to be moved from the shared registry into module directories, and the next milestone is a versioned executor result envelope that can advance guided protocol runs safely.

## Phase 1 — Artifacts and execution

**Goal:** introduce the shared substrate before adding more modules.

- Implement opaque `artifact://` references and the managed artifact store.
- Support external, managed and bundled origins; transient, session and persistent lifecycles.
- Implement content hashing, parent/derivative links, explicit import/export and retention.
- Add the Files surface and execution history.
- Move image redaction output and FreeTSA proof bundles onto the artifact store.
- Freeze capability version, settings snapshot and input/output hashes in every committed execution.

**Exit criteria:** a redacted image and timestamp proof can be traced, re-exported, and used by a subsequent capability without modules exchanging private paths.

## Phase 2 — Presets

**Goal:** saved reusable work, using capability-owned configuration.

- Add a settings-schema renderer so presets use each capability’s actual options.
- Persist preset name, description, capability/version constraint, configuration, presentation preference and output preference.
- Add validation, duplicate, edit, run, export/import and unavailable-module states.
- Begin direct migrations: `filelab`, `texttools`, `conversions`, `cryptography`, `attestation`, `qrcode`, `datatools`.

**Exit criteria:** a preset runs exactly the same canonical capability as a direct run and produces equivalent results/provenance.

## Phase 3 — Protocols and pipes

**Goal:** make multi-step work real rather than a list of menu entries.

- Implement protocol step records, artifact input bindings, output lifecycle and failure policy.
- Provide a visual step editor and protocol-runner rail.
- Support `prior output`, `user selection`, `explicit artifact` and `no input` bindings.
- Implement a final protocol result and optional evidence-bundle export.
- Add the first reference protocol: import image → redact → FreeTSA timestamp → export proof bundle.

**Exit criteria:** the reference protocol runs end-to-end, shows all step states, retains selected outputs, and stops safely on failure.

## Phase 4 — Schedules and notifications

**Goal:** durable local scheduling with truthful interaction rules.

- Implement local plan storage, timezone, start policy, recurrence, termination and enabled/paused state.
- Implement desktop notification and restart recovery adapters.
- Require an explicit interaction policy: headless-safe, notify-and-open, or manual-only.
- Add missed-run handling and run history.
- Start with `time_tools`, then schedule protocol/preset targets rather than cloning their settings.

**Exit criteria:** a schedule targets a preset/protocol by ID, survives a restart, never misreports an interactive task as completed, and can be paused/stopped.

## Phase 5 — Capture and desktop hardware adapters

**Goal:** unlock valid desktop equivalents without pretending every laptop has every sensor.

- `capture.microphone`: `acoustics`, `soundgenerator`, `speechtranscription`, `music`, `media`.
- `capture.camera`: `documentscanner`, `qrcode`, `apriltag`, `magnifier`, `mlkitvision`, `scaledphoto`.
- `location`: imported/entered coordinates first; OS or external GNSS as optional sources.
- `device.bluetooth`, `device.usb`, `device.serial`, `device.midi`: feature-detected and separately permissioned.
- Record selected hardware, source, accuracy and calibration in results where material.

**Exit criteria:** modules offer a file/import fallback wherever meaningful and clearly say when required hardware is unavailable.

## Phase 6 — Module migration tranches

### Tranche A: evidence and documents

`filelab`, `cryptography`, `trustedtimestamp`, `digitalsigning`, `attestation`, `imageredaction`, `documentscanner`, `textdocuments`, `texttools`, `referencelibrary`, `qrcode`, `svgselector`.

### Tranche B: data, calculation and planning

`datatools`, `fieldstats`, `sampling`, `scoring`, `conversions`, `choiceexperiment`, `expenses`, `labbench`, `electrical`, `spatialgeometry`, `randomnumber`, `chance`, `multicounter`, `tabletoputilities`.

### Tranche C: audio, visual and language

`acoustics`, `speechtranscription`, `soundgenerator`, `music`, `media`, `conversationtranslate`, `livestreamtranslate`, `mlkittranslate`, `mlkitvision`, `apriltag`, `star_spectrum`.

### Tranche D: desktop-adapted field tools

`astronomy`, `earthscience`, `surveying`, `weather`, `aviation`, `geocaching`, `gpstargetnavigator`, `pluscodecapture`, `hamradio`, `networktools`, `externaldisplay`.

### Tranche E: optional external devices

`bluetoothinspector`, `bluetoothprinter`, `clinicalinstruments`, `sensorread`, `signals`.

### Deferred by default

`odkformlauncher`, `providercommands`, `appinspector`, `espmesh`, `sensorfirmwareinstaller`, `sensorprovisioner`, `sms`, `nfc`, `compass`, and mobile-only portions of `diving`, `calibratedscale` and `visualacuity`.

## Module translation checklist

For each folder in `android_modules/<module>/`, create `modules/<module>/` only after completing this checklist:

1. Read module README, implementation plan, method definitions and tests.
2. Extract the canonical capability IDs, input/output fields, algorithms, validation rules and evidence claims.
3. List Android dependencies and map each to a desktop adapter, file import alternative or explicit deferral.
4. Write a desktop manifest and settings schema.
5. Define artifact inputs, outputs, lifecycle defaults and derivative behaviour.
6. Port pure logic with tests before creating UI.
7. Build capability-owned UI, then preset projection, protocol bindings and schedule eligibility.
8. Add migration notes explaining deliberate behaviour changes.
9. Add fixtures proving direct, preset and protocol runs return compatible results.
10. Add a module review record under `modules/<module>/docs/`.

## First six-week sequence

| Week | Deliverable |
| --- | --- |
| 1 | Typed core models, manifest format, module loader, persistent store |
| 2 | Artifact store, Files screen, execution result/provenance model |
| 3 | Rework timestamp/redaction as proper host modules; implement preset schema and persistence |
| 4 | Protocol runner and the redaction → timestamp reference protocol |
| 5 | Scheduler plan model, notifications and `time_tools` pilot |
| 6 | `filelab`, `texttools` and `qrcode` migration pilots; cross-platform smoke tests |

## Definition of done for a desktop module

A module is not complete when its screen renders. It is complete when it:

- is discovered through its manifest;
- runs via the canonical contract;
- declares and handles unavailable adapters honestly;
- uses artifacts rather than private paths;
- supports direct run and preset run;
- declares protocol/schedule eligibility;
- returns a versioned execution result;
- has migration notes, fixtures and automated tests;
- exports provenance only as an explicit optional result.

## Decisions to make before Phase 0 closes

1. Choose the durable host storage engine and migration tooling.
2. Choose the package/distribution path for signed macOS and Windows builds.
3. Define the first-party module signing/trust policy, if modules will later be installed from outside this repository.
4. Choose supported FreeTSA/other TSA trust-registry maintenance process.
5. Set a retention/default storage policy for managed artifacts and logs.
