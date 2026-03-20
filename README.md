# @jordyvd/pi-openai-compaction

A distributable Pi extension package that replays **OpenAI native standalone compaction** windows without patching Pi core.

This package preserves the raw compacted window returned by OpenAI's compact endpoint, stores it in Pi compaction entry details, and rewrites later supported OpenAI Responses requests to:

- fresh current prompt envelope
- stored opaque compacted window
- live post-compaction tail

## Supported scope

This package is intentionally narrow.

- **Providers:** `openai`, `openai-codex`
- **APIs:** `openai-responses`, `openai-codex-responses`
- **Failure mode:** fail open back to normal Pi behavior
- **Persistence model:** store the raw compacted window in `CompactionEntry.details`

## How it works

The extension uses two hooks:

1. `session_before_compact`
   - serialize the current Pi session into an OpenAI Responses-compatible compact request
   - call the compact endpoint
   - persist the returned compacted window in the compaction entry details
2. `before_provider_request`
   - intercept the next supported Responses request
   - replace Pi's summary-oriented replay with native replay

## Install

From a local checkout:

```bash
cd ~/workspace/personal
pi install ./pi-openai-compaction
```

Try without installing:

```bash
pi -e ~/workspace/personal/pi-openai-compaction
```

After installation, run:

```text
/reload
```

## Configuration

Settings resolve in this order, with later layers overriding earlier ones:

1. package-local `settings.json`
2. global `~/.pi/agent/settings.json` under `openaiNativeCompaction`
3. project `<cwd>/.pi/settings.json` under `openaiNativeCompaction`
4. environment variables with the `PI_OPENAI_NATIVE_COMPACTION_` prefix

Default package settings:

```json
{
  "enabled": true,
  "debug": false,
  "logProviderPayloads": false,
  "logCompactResponses": false,
  "redactSensitiveData": true,
  "artifactRoot": "~/.pi/agent/artifacts/openai-native-compaction",
  "supportedProviders": ["openai", "openai-codex"],
  "supportedApis": ["openai-responses", "openai-codex-responses"],
  "notifyOnLoad": false
}
```

Useful global override example:

```json
{
  "openaiNativeCompaction": {
    "enabled": true,
    "debug": true,
    "logProviderPayloads": true,
    "logCompactResponses": true,
    "redactSensitiveData": true
  }
}
```

Available environment overrides:

- `PI_OPENAI_NATIVE_COMPACTION_ENABLED`
- `PI_OPENAI_NATIVE_COMPACTION_DEBUG`
- `PI_OPENAI_NATIVE_COMPACTION_LOG_PROVIDER_PAYLOADS`
- `PI_OPENAI_NATIVE_COMPACTION_LOG_COMPACT_RESPONSES`
- `PI_OPENAI_NATIVE_COMPACTION_REDACT_SENSITIVE_DATA`
- `PI_OPENAI_NATIVE_COMPACTION_ARTIFACT_ROOT`
- `PI_OPENAI_NATIVE_COMPACTION_SUPPORTED_PROVIDERS`
- `PI_OPENAI_NATIVE_COMPACTION_SUPPORTED_APIS`
- `PI_OPENAI_NATIVE_COMPACTION_NOTIFY_ON_LOAD`

## Debug artifacts

Artifacts are written per session under:

```text
~/.pi/agent/artifacts/openai-native-compaction/sessions/<session-id>/
```

Subdirectories:

- `provider-requests/`
- `compact-responses/`
- `compaction-events/`
- `lifecycle/`

Recommended troubleshooting flow:

1. enable `debug: true`
2. enable `logProviderPayloads: true`
3. keep `redactSensitiveData: true`
4. `/reload`
5. run `/compact` and then send a follow-up message
6. inspect the newest artifact in the session directory

## Package structure

```text
pi-openai-compaction/
├── index.ts                    # package entrypoint declared in package.json
├── settings.json               # package-local defaults
├── src/
│   ├── extension-runtime.ts    # hook registration and top-level wiring
│   ├── settings.ts             # layered settings loader + env overrides
│   ├── debug.ts                # artifact writing + redaction helpers
│   ├── runtime.ts              # provider/api/model/baseUrl/apiKey resolution
│   ├── supported-environment.ts
│   ├── types.ts                # settings + persisted native-compaction types
│   ├── details-store.ts        # latest-valid native compaction lookup helpers
│   ├── serializer.ts           # compaction input serialization helpers
│   ├── compact-client.ts       # compact endpoint client
│   └── payload-rewrite.ts      # native replay rewrite logic
├── src/unit.test.ts
├── src/validation.test.ts
└── test/pi-smoke.test.ts
```

## Tests

```bash
cd ~/workspace/personal/pi-openai-compaction
bun test
bun test --coverage --coverage-reporter=text --coverage-reporter=lcov
bun test ./test/pi-smoke.test.ts
```
