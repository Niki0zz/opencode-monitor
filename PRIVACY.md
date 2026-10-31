# Privacy

OpenCode Monitor is a local desktop application. This document describes exactly what it reads, what it stores and where data can go.

## What the app reads

- **OpenCode database** at `~/.local/share/opencode/opencode.db` (or `OPENCODE_DB`), opened with SQLite `readOnly: true` and `PRAGMA query_only = 1`.
- From `session_message` rows of type `assistant`: session ID, timestamp and the usage fields `model`, `tokens` and `cost`. These are extracted **inside SQLite** with `json_extract`; message text, prompts, tool output and file contents are not loaded into the app process.
- From `session_v2` (or `session`): the session **title**, used in the Activity list.
- The **local OpenCode CLI** (`opencode api get /api/experimental/usage/limits`) to obtain Go limits and the Console URL.

Message text, tool output, prompts, project directories and file contents are never displayed, logged, stored or returned by the local API. Project directories were explicitly removed from API responses.

At runtime the limits response contains your workspace name and Console URL (which includes the workspace ID). That value is kept in memory, shown only in the local UI, and used only when you click **Console ↗**. It is never written to disk or sent anywhere by the app.

## What the app stores

Only a small settings file in Electron's user-data directory (`settings.json`):

```json
{
  "width": 420,
  "height": 700,
  "x": 1200,
  "y": 24,
  "opacity": 0.97,
  "pinned": true,
  "mini": false
}
```

No usage history, session titles, tokens or costs are copied to disk. Aggregates and limits are kept in memory and disappear when the app exits.

## Network activity

- **No outbound requests.** No telemetry, crash reporting, update checks, analytics, accounts or cloud sync.
- The UI is served by a loopback HTTP server on a random port (`MONITOR_PORT` can pin it). The server binds to `127.0.0.1` only.
- The only external action is a user click on **Console ↗**, which opens the corresponding `https://opencode.ai/console/...` page in your default browser.

## Local API protections

The loopback server is deliberately small:

- `Host` header allowlist (`127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>`) to block DNS-rebinding attacks.
- No `Access-Control-Allow-Origin` header, so web pages from other origins cannot read responses.
- `GET`/`HEAD` only; there are no state-changing endpoints.
- The UI is served from the same origin as the API, with a strict Content-Security-Policy.
- Static file serving is restricted to `ui/` and rejects path traversal.
- Responses omit database paths, project directories and session IDs. `/api/health` reports only whether the database is available.

### Threat model

The server is reachable by any process running as the same operating-system user. This is inherent to a local UI and is why the API is read-only and minimal. If you need isolation from other local processes, run the app in a separate OS account. A per-launch access token is a possible future hardening step.

## Repository hygiene

- `.gitignore` excludes the database, settings, logs, `node_modules` and build output.
- The repository contains no workspace or organization identifiers, no absolute user paths and no real usage data.
- The README screenshot is generated from `?demo=1` sample data.

## Changes

If a future version changes any of the above, this document and the release notes will say so.

Questions or corrections: open an issue **without personal data**, or use the private channel in [SECURITY.md](SECURITY.md).
