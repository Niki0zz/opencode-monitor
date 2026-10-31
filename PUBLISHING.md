# Publishing

This checklist keeps releases reproducible and prevents personal data from slipping into the public repository.

## Pre-flight

```bash
npm run check
npm test
npm run dist:dir        # packaging smoke test
```

Then verify the privacy baseline:

```bash
git status --short      # only intended files
git grep -nE 'org_[A-Za-z0-9]{10,}|C:.Users|/Users/|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}'
```

The grep must return nothing. Never stage `opencode.db`, `settings.json`, logs, screenshots of real sessions or `node_modules`.

Screenshots for the README must come from demo mode:

```text
ui/index.html?demo=1&lang=en
```

## Version and changelog

1. Update `version` in `package.json`.
2. Add a `CHANGELOG.md` section for the version.
3. Commit with a clear message.

## First public release

```bash
gh repo create Niki0zz/opencode-monitor --public --source=. --remote=origin --push
git push origin main
```

Then push the tag that matches `package.json`:

```bash
git tag -a v1.0.0 -m "OpenCode Monitor 1.0.0"
git push origin v1.0.0
```

The `Release` workflow builds Windows, macOS and Linux artifacts and creates a **draft** GitHub release. Review the draft, then publish it manually.

## Subsequent releases

```bash
git tag -a v1.0.1 -m "OpenCode Monitor 1.0.1"
git push origin main
git push origin v1.0.1
```

## Trust and signing

Builds are currently unsigned. Before calling a release production-ready:

- Windows: Authenticode certificate, then verify SmartScreen reputation.
- macOS: Developer ID certificate, hardened runtime and notarization.
- Keep the release draft hidden until the artifacts install and launch cleanly.

## Security checklist

- The collector requires `MONITOR_TOKEN`; never commit a token.
- API routes stay loopback-only, same-origin and read-only.
- No telemetry, analytics, remote fonts or CDN assets.
- No workspace, organization or user identifiers in source, screenshots or test fixtures.
- Update `PRIVACY.md` if what the app reads, stores or sends changes.
