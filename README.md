# Idleon Card Profiles

Give your card presets names and save whole groups of card setups to use across your characters.

For **Idleon on Steam, Windows x64**. Version **0.1.1**, unofficial test build.

## Setup

1. [Download the installer](https://github.com/stack-junkie/idleon-card-profiles/releases/download/v0.1.1/IdleonCardProfiles-Setup.exe).
2. Exit Idleon normally and keep Steam open.
3. Run the installer and click **Install**. If already installed, click **Repair / update**.
4. Click **Play**. Next time, use the **Idleon Card Profiles** desktop shortcut.

Everything needed is included. No commands or separate software installs.

The installer is unsigned, so Windows may show a warning. Only download it from this repository. The new installer flow still needs an end-to-end test; in-game use has been reported working.

<details>
<summary>Optional: launch through Steam's normal Play button</summary>

1. After installation, click **Optional: use Steam's Play button**.
2. Click **Copy launch option**.
3. In Steam, right-click **Idleon > Properties > General**.
4. Paste into **Launch Options**. Keep `%command%` exactly as shown.

If you already use custom launch options, do not overwrite them blindly. The desktop shortcut works without this setting. This optional Steam route still needs live verification.

</details>

## How to use

Open **Codex > Cards** in the game.

- **Name a preset:** Double-click its name above the preset row. Type a name and press **Enter**. **Escape** cancels. Each character keeps its own names.
- **Save a group:** Click the **floppy disk** on the right. Give the group a name and save. A group includes **all available card presets**, their names, and their cards.
- **Load a group:** Click the **folder** on the left. Select a group, then click **Load [group name]**. This replaces the current character's preset names and cards. The card-set bonus stays unchanged.
- **See what's inside:** Click the arrow beside a saved group to expand its details.
- **Undo a load:** Click **Restore** in the Load window. It restores that character's previous setup, retained across restarts until another load or restore replaces it.
- **Delete a group:** Click its trash icon and confirm. This deletes the saved group, not setups already loaded onto characters.

Use the **?** button for extra help. Saved groups are shared between compatible characters on your account, but stay on this PC.

<details>
<summary>Game updates, saved data, and uninstalling</summary>

An unsupported game update blocks the add-on. You can still play normally through Steam; first clear the Card Profiles Launch Option if you set it.

Saved names and groups live in `%LOCALAPPDATA%\IdleonCardProfiles`. Back up that folder to keep a copy. They do not sync through Steam Cloud.

To uninstall, clear the optional Steam Launch Option if you used it, then uninstall **Idleon Card Profiles** through Windows Apps. Saved profiles are kept.

</details>

[Technical details and test status](docs/technical-notes.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Security](SECURITY.md) · [License](LICENSE)
