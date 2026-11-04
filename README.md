# MethodMesh Desktop — framework prototype

A cross-platform desktop host with a module registry and working local-first capability modules:

- **Trusted timestamp**: creates a FreeTSA RFC 3161 proof bundle. Only a SHA-256 message imprint is sent; source bytes remain local.
- **Image redaction**: choose or drag in an image, draw permanent black redaction regions, and export a new PNG.
- **Audio recording**: explicitly request microphone permission, capture local WebM/Ogg audio, review it and export it without upload.
- **Local signing**: create a portable RSA-PSS signature bundle over a file SHA-256 digest. This is a local-key signature, not a certificate-backed identity claim.

## Run it

Install Node.js 20 or newer, then from this directory:

```bash
npm install
npm start
```

`npm run check` performs a syntax check of the application JavaScript.

## Build packages

The project is configured for native macOS and Windows distribution builds:

```bash
npm run package:mac
npm run package:win
```

`npm run package:dir` creates an unpacked smoke-test build for the current
platform. Release builds must be signed and, on macOS, notarised using the
organisation's distribution credentials. The GitHub Actions workflow runs
contract tests and an unsigned package smoke build on both operating systems.

## Framework boundary

The desktop host discovers manifests, validates declared settings and execution input/output contracts, persists presets/protocols/schedules, and resolves saved workflows into validated launch plans. Protocols begin in guided mode so a capability retains ownership of its own interactive input and output handling. Every installed module declares a module-relative `rendererEntry`, which the host loads generically; it then registers its own capabilities through the module registry without any capability-specific branch in the shell.

Modules commit a versioned result envelope (`status`, summary, outputs, evidence and `artifact://` references). This is the shared provenance boundary used by guided protocols: after a capability reports a successful result, the runner can open the next validated step. A `prior-output` protocol rail is accepted only when the preceding capability declares an output the next capability accepts.

## Module renderer migration

Every installed module now declares a renderer entry and registers its own capabilities through the generic module registry. The current renderer implementations remain in a compatibility library while they are extracted one-by-one into their respective `modules/<id>/renderer.js` files; this preserves the mature Timestamp and Redaction flows throughout the migration. The application shell does not contain capability IDs or capability-specific branches.

`src/renderer/modules.js` currently contains the capability renderer registry. A module declares adapter requirements (`file`, `evidence`, `capture`, `network`, or `device`) and receives only the host API it needs. It does not import Electron or contain OS-specific code. Moving these renderer implementations into their individual module directories is the next architectural hardening step.

The Electron main process owns native file dialogs and writing output. This is the first platform adapter; future Mac/Windows-specific integrations should be added there rather than leaking into modules.

The default TSA is `https://freetsa.org/tsr`, matching the existing MethodMesh capability. The bundle retains the RFC 3161 request and response (`.tsq` and `.tsr`), published FreeTSA certificate files, and proof metadata. A timestamp proves the exact bytes existed no later than the authority's certified time; it does not prove authorship, original creation time, or legal validity.

## Manually confirming a timestamp

1. Preserve the original file exactly as it was when timestamped.
2. Calculate its SHA-256 digest.
3. Verify `timestamp.tsr` using an RFC 3161-compatible verifier and the included TSA certificate material.
4. Confirm that the timestamp token's message imprint equals the original file's SHA-256 digest.
5. Read the token generation time. This is the certified latest time at which those exact bytes existed.

The desktop verifier performs the source-hash and token-signature checks and reports the proof generation time directly. Every proof bundle also includes these manual-verification notes. A folder-manifest proof additionally includes the exact `manifest.json` that was timestamped.
