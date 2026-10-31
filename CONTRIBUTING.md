# Contributing

Thanks for taking the time to improve OpenCode Monitor.

## Setup

```bash
git clone https://github.com/Niki0zz/opencode-monitor.git
cd opencode-monitor
npm install
npm start
```

`npm run demo` runs the UI with deterministic sample data, so you do not need an OpenCode installation to work on the interface.

## Before you open a pull request

```bash
npm run check
npm test
```

`npm run check` validates every JavaScript file and the JSON files. `npm test` runs the unit tests in `test/`.

## Project layout

| Path | Purpose |
| --- | --- |
| `main.js` | Electron lifecycle, window, tray, IPC |
| `preload.js` | The `window.monitor` bridge (context-isolated) |
| `collector.js` | Loopback HTTP server, SQLite queries, CLI limits, static UI |
| `lib/usage.js` | Pure pricing, range and time-bucket helpers |
| `lib/pricing.json` | Prices and monthly model caps |
| `ui/` | Dependency-free UI (HTML/CSS/JS) |
| `test/` | `node:test` unit tests |

No bundler, transpiler or UI framework. Keep it that way unless there is a strong reason.

## Code style

- CommonJS, `'use strict'`, two-space indentation.
- Prefer small pure functions in `lib/` when logic can be tested without Electron or SQLite.
- Keep the renderer free of Node.js APIs; everything goes through the preload bridge.
- Do not add runtime dependencies without discussing it first.
- New strings in the UI must be added to **both** `en` and `ru` dictionaries in `ui/i18n.js`.

## Privacy rules for test data

This is a privacy-first project:

- Never commit a real `opencode.db`, `settings.json`, logs or screenshots of real usage.
- Use `?demo=1` for screenshots and bug reports.
- Do not add analytics, telemetry, crash reporting or remote fonts/CDNs.
- Do not add workspace, organization or user identifiers to the source. The Console URL must be derived at runtime.
- Do not broaden the local API: keep it read-only, loopback-only and same-origin.
- If you change what the app reads or stores, update [PRIVACY.md](PRIVACY.md).

## Pull requests

- Describe the user-visible change and how you tested it.
- Keep the diff focused; separate refactors from behavior changes.
- Add or update tests for logic in `lib/usage.js`.
- For UI changes, attach a demo-mode screenshot.
- Mention platform testing (Windows, macOS, Linux).

For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a public issue. Maintainers preparing a release should follow [PUBLISHING.md](PUBLISHING.md).
