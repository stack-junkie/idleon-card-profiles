# Working on Card Profiles

- Keep changes scoped to the add-on. Preserve unrelated work and active game sessions.
- Match Idleon's established UI inside the game. Keep explanations behind help and details controls.
- Use Node.js for development checks. Runtime dependencies are intentionally limited to Node built-ins.
- Run `npm test` and `npm run version:check` for source changes. For launcher or installer changes, also build and run `packaging/test-packaging.ps1` on Windows.
- Live testing needs the player's agreement. Never attach to an existing game, terminate it, or modify installed game files automatically.
- Preserve per-account/character isolation and the selected card-set bonus. Reject unsupported builds and incompatible profiles before writes.
- Never commit profile data, extracted game assets, binaries, logs, personal paths, or local planning records.
- For material changes, bump the version with `npm run version:bump -- <version>` and document the behavior in CHANGELOG.md before committing. Keep code, VERSION, package metadata, and README synchronized.
- Treat the installer as a test build until the remaining live checks in the README are complete. Do not claim that a passing mock test establishes live-game behavior.
- Write plainly. Do not use em dashes.
