# Idleon Card Profiles

Name your native card presets and save complete groups of card setups to a shared local library. Load a saved group onto another compatible character, or restore that character's previous setup.

Built for the **Windows x64 Steam client** of Legends of Idleon. This is an unofficial, unsigned **0.1.1 test build**.

## Get started

1. [Download the Windows installer](https://github.com/stack-junkie/idleon-card-profiles/releases/download/v0.1.1/IdleonCardProfiles-Setup.exe).
2. Exit Idleon, keep Steam open, and run the installer. Click **Install**.
3. Click **Play**. Next time, use the **Idleon Card Profiles** desktop shortcut.

No commands, separate software installs, or Steam settings needed for this route. In the game, open **Codex > Cards** and double-click a preset name to edit it.

Windows may warn because the installer is unsigned. Check that your download comes from this repository. [Test status and limitations](#compatibility-and-test-status).

## What it does

- Gives each character's native card preset slots their own editable names.
- Saves the whole unlocked preset row, including names, card order, and empty positions.
- Shares saved groups between compatible characters on the same account.
- Keeps a local recovery snapshot before loading a group.
- Adds a Windows installer, desktop shortcut, tray controls, and optional Steam launch integration.

The add-on does not change card quantities, star levels, progression, or the selected card-set bonus. It does not patch installed game files or distribute game assets.

## Install and play

The installer includes everything the add-on needs. Its final screen has **Play** and **Later** buttons; installing never starts the game automatically.

Setup installs for the current Windows user under `%LOCALAPPDATA%\Programs\IdleonCardProfiles`. It includes Node.js 24.14.0 and keeps saved profiles in a separate data folder.

To use Steam's normal **Play** button, choose **Optional: use Steam's Play button** after installation, or open the tray's **Settings** window. Copy the displayed launch option into **Idleon > Properties > General > Launch Options**. This is a one-time manual setting. Keep `%command%` exactly as shown, and reconcile any existing custom options before replacing them. Setup does not edit Steam settings.

While playing, use **Disconnect add-on** in the tray menu to remove the add-on while leaving the game running. Closing the game also releases the helper. Before uninstalling through the Start menu or Windows Apps, clear the Card Profiles Steam launch option. Uninstall preserves saved profiles.

## Use the Cards screen

- **Rename:** Double-click the label above the preset row. Enter or clicking outside saves; Escape cancels. Changing character, preset, or menu cancels an unfinished edit. Blank names use the native slot number. Names allow up to 32 characters supported by the game's font.
- **Save:** Capture the current character's complete unlocked preset row as a named group. The current slot includes unswitched card edits. Choose a new title or explicitly update an existing group.
- **Load:** Select a saved group, then click **Load [group name]**. Expand a group's arrow to inspect its source, date, preset names, and cards. Loading replaces the current character's complete compatible row and keeps the current slot selected.
- **Restore:** Return to the recovery snapshot from the most recent load for this character. One local backup is retained across restarts until another load or restore replaces it.
- **Delete:** Use a group's trash button and confirm its name. This removes the library entry without deleting loaded character setups or recovery snapshots.

The circled question mark provides help in the group dialog. Profiles with different available preset or equipment counts are rejected as a whole.

## Compatibility and test status

The launcher checks the installed game bundle before starting a session. **Unknown game updates block integration.** If that happens, clear the Card Profiles Steam launch option to play normally and wait for compatibility support. The helper refuses to attach to an already-running game.

The supported bundle SHA-256 is:

```text
49a106e5ea60bd6eb3ec36173b7f43720a2805329d1fe08a4fada822c617165c
```

This bundle was observed in Steam build `25394689`. Run the read-only `inspect` command below to check your installation.

Automated storage, recovery, interface, launcher, and packaging checks have passed. The installed desktop launcher has initialized the add-on in the real game, and closing the game's native window has been verified to stop the game and its helpers. Actual Steam **Play** after setting its launch option, live tray interactions, the interactive uninstall flow, and full live card loading, recovery, and restart persistence still need verification. Offline checks do not establish those live results.

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
- `idleon-card-profiles-0.1.1-win-x64.zip`

The packaging checks extract the installer and exercise simulated installation and launcher behavior. They do not launch Steam or the game, or verify the interactive installation flow.

See [Contributing](CONTRIBUTING.md) for additional checks, [Changelog](CHANGELOG.md) for changes, [Security](SECURITY.md) for reporting guidance, and [Attribution](ATTRIBUTION.md) for third-party notices.
