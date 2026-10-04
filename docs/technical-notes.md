# Technical notes

## Compatibility and test status

The launcher checks the installed game bundle before starting a session. **Unknown game updates block integration.** If that happens, clear the Card Profiles Steam launch option to play normally and wait for compatibility support. The helper refuses to attach to an already-running game.

The supported bundle SHA-256 is:

```text
49a106e5ea60bd6eb3ec36173b7f43720a2805329d1fe08a4fada822c617165c
```

This bundle was observed in Steam build `25394689`. Run the read-only `inspect` command below to check your installation.

Automated storage, recovery, interface, launcher, and packaging checks have passed. The installed desktop launcher has initialized the add-on in the real game, and closing the game's native window has been verified to stop the game and its helpers.

On October 4, 2026, the player reported successful in-game use, including loading a group on another character, Restore, and names/cards persisting after restart. These are player-reported results.

The published 0.1.1 installer was downloaded from GitHub, its checksum verified, and its actual **Repair / update > Play** buttons exercised. Installed file hashes matched the package, existing profile data stayed unchanged during installation, and Play opened a visible game window with the add-on connected. Clicking the game's native close button stopped the game, launcher, and helper normally.

Version 0.1.2 replaces optional manual configuration with automatic Steam setup. The installer requires Steam and Idleon closed, scopes changes to the most recently used account's Idleon LaunchOptions, preserves ordinary existing arguments, and records the original setting in `steam-setup.json` under the add-on data directory. Full config backups remain beside Steam's localconfig.vdf. Restore edits only the managed setting; it preserves unrelated later Steam changes. Unknown VDF syntax, conflicting launchers, ambiguous accounts, and missing recovery information block the operation.

A first-time install on a clean Windows account, the new automatic Steam setup and Steam **Play** route, live tray interactions, and interactive uninstall remain unverified. The earlier successful 0.1.1 update does not establish those 0.1.2 results.

This is an unofficial client modification, with no affiliation with Lavaflame2 or account-safety guarantee. It is not a Steam Workshop package.

## Your saved data

Live profiles are stored in `%LOCALAPPDATA%\IdleonCardProfiles\profiles.json`. The last validated storage version is kept in `profiles.json.bak`. Back up that directory to preserve the library and recovery data. There are no import/export controls in the current interface.

Names and saved groups stay local and do not follow Steam Cloud or appear on mobile or browser clients. Native card saving remains the game's responsibility.

The add-on does not store account passwords or authentication tokens. Account grouping uses a hash of the first character's name; character assignments use a hash of roster position and character name. Renaming characters can require a local data migration. Stored group details can include character names, so review data and logs before sharing them.

## Develop and build

Source development requires **Node.js 22 or newer**. There are no npm runtime dependencies. From the repository root:

```powershell
node --test
node src/cli.js preview
```

`preview` prints a local browser URL and uses sample characters with separate `.preview-data` storage. It does not connect to the game. Native preview fonts are read into memory from a supported local game installation when available; otherwise it uses a text fallback.

On Windows with Idleon installed:

```powershell
node src/cli.js inspect
```

`inspect` reads installation files and process names without making a live connection. After you have saved and exited the game normally, you can launch a new add-on session with Steam running:

```powershell
node src/cli.js launch --live
```

`Start-CardProfiles.cmd`, `Start-CardProfiles.ps1`, and `Preview.ps1` provide equivalent shortcuts. Keep the source helper running while playing; Ctrl+C disconnects it and leaves the game open. The launcher starts a new game with a loopback debugger and may reload that newly launched page once during initialization. A custom installation can be supplied with `--game-dir "D:\SteamLibrary\steamapps\common\Legends of Idleon"`.

Building the installer requires Windows x64, **Node.js 24.14.0**, and the .NET Framework 4 C# compiler at `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`. The runtime version is pinned to the included upstream license.

```powershell
.\scripts\build-installer.ps1 -NodePath 'C:\Program Files\nodejs\node.exe'
.\packaging\test-packaging.ps1
```

Outputs are written to `../output/`, beside the repository:

- `IdleonCardProfiles-Setup.exe`
- `idleon-card-profiles-0.1.2-win-x64.zip`

The packaging checks extract the installer and exercise simulated installation and launcher behavior. They do not launch Steam or the game, or verify the interactive installation flow.

See [Contributing](../CONTRIBUTING.md) for additional checks, [Changelog](../CHANGELOG.md) for changes, [Security](../SECURITY.md) for reporting guidance, and [Attribution](../ATTRIBUTION.md) for third-party notices.
