# Security Policy

## Supported versions

The latest `1.x` release receives security fixes. Older releases are not supported.

## Reporting a vulnerability

Please **do not open a public issue** for a vulnerability. Use GitHub's private vulnerability reporting:

https://github.com/Niki0zz/opencode-monitor/security/advisories/new

Include:

- a description of the issue and its impact;
- steps to reproduce (a proof of concept if possible);
- the app version and platform;
- any suggested fix.

You can expect an acknowledgement within a few days. Please give a reasonable amount of time for a fix before public disclosure.

## Scope

In scope:

- data exfiltration from the local collector (CORS bypass, DNS rebinding, path traversal, XSS);
- reading or writing files outside the intended database and UI directories;
- privilege escalation through Electron, IPC or the preload bridge;
- command injection through `OPENCODE_CLI`, `OPENCODE_DB` or model data;
- supply-chain issues in the build and release workflow.

Out of scope:

- access by another process running under the same OS user (inherent to a local UI; see [PRIVACY.md](PRIVACY.md));
- physical access to an unlocked machine;
- issues in OpenCode itself — report those to the OpenCode project;
- unsigned-build warnings from SmartScreen or Gatekeeper (code signing is on the roadmap).
