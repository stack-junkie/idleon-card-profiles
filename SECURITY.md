# Security

Idleon Card Profiles is an experimental local Windows add-on. Version 0.1.0 is a test build; there is no long-term support policy or guaranteed response time.

## Report a vulnerability

Use [GitHub's private vulnerability reporting form](https://github.com/stack-junkie/idleon-card-profiles/security/advisories/new). Private reporting is enabled for this repository.

Do not include exploit instructions, profile databases, authentication material, personal paths, or other sensitive details in a public issue.

A useful private report includes the affected version, Windows version, reproduction steps, expected impact, and a synthetic example where possible. Ordinary compatibility failures and interface bugs can use the normal issue tracker.

## Local boundaries

The helper starts a new game session with a loopback debugger and refuses already-running games. Do not expose that debugger or the preview server to a network. Compatibility checks reject unknown game bundles before launch.

Profile files and backups are stored locally under `%LOCALAPPDATA%\IdleonCardProfiles`. They do not contain account passwords or authentication tokens, but may contain character names and saved setup details. Review logs, screenshots, and files before sharing them.

The installer is unsigned. Installer extraction validates payload paths and hashes; that validation does not establish the identity of whoever supplied an installer. Build from source or use a distribution whose origin you trust.
