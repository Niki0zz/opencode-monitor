# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-31

First public release.

### Added

- Always-on-top Electron overlay with Go limits (rolling, weekly, monthly), spend, tokens, hourly/daily chart, per-model usage and recent activity.
- Mini mode with the full Go limits card, system tray, `Alt+Shift+O` global shortcut and start-at-login for installed builds.
- English and Russian UI selected from the system language.
- Demo mode (`npm run demo`) with deterministic sample data.
- Cross-platform packaging with electron-builder, GitHub Actions CI and a tag-driven release workflow.

### Changed

- The collector now runs on Electron's bundled Node (`ELECTRON_RUN_AS_NODE`), so installed builds no longer require Node.js.
- The UI is served by the loopback collector on a random port, replacing the fixed `20177` file:// setup.
- Day buckets and labels use local calendar dates instead of UTC.
- Model limit percentages use month-to-date estimates, not the selected range.
- Settings, position and tray state are restored consistently.

### Security

- Removed the hard-coded organization identifier; the Console link is derived at runtime from the local CLI response.
- Removed `Access-Control-Allow-Origin: *`; the API is same-origin only.
- Added a `Host` header allowlist, CSP, `nosniff`, `no-referrer` and path-traversal protection.
- The local API no longer returns database paths, project directories or session IDs.
- Database access is read-only with `query_only`.
- Removed absolute user paths from `start.vbs`.
- Enabled Electron sandboxing, blocked new windows and external navigation.
- Added `.gitignore` rules for databases, settings, logs and build output.

[1.0.0]: https://github.com/Niki0zz/opencode-monitor/releases/tag/v1.0.0
