# Changelog

## [0.1.2] - 2026-10-04

- Steam's normal Play button is now the default route. Installation configures it automatically for the most recently used Steam account.
- Installer Play and desktop shortcuts launch through Steam too. The helper runs only when Steam invokes the configured wrapper.
- Setup preserves existing game arguments, backs up Steam settings, refuses conflicting custom launchers, and requires Steam and Idleon to be closed.
- Uninstall restores recorded launch settings without replacing unrelated Steam data. Missing recovery data or edited Card Profiles commands block removal.
- Added real player screenshots for preset naming, saving groups, and inspecting groups in the README.

Live verification: installation configured Steam, preserved existing profiles, and launched a visible Idleon window through Steam with Card Profiles connected. First-time installation on a clean Windows account and interactive uninstall still need verification.

## [0.1.1] - 2026-10-04

- Simplified setup to Install, then Play or Later. Installation never starts the game automatically.
- Made Steam launch-option setup optional instead of the first screen after installing.
- Moved installation paths and technical details behind an Installation details link.
- Added a direct installer download and three-step player instructions.

This remains an unsigned test build. The new setup screens were checked offline; the live verification limits below still apply.

## [0.1.0]

Initial test build. No public release has been published.

### Added

- Editable native card preset names, scoped to each character and slot.
- Shared local saved groups containing complete preset rows, names, ordered cards, and empty positions.
- Explicit group updates, expandable details, selection-based loading, and confirmed deletion.
- Per-character recovery snapshots, atomic local storage, backups, and interrupted-load reconciliation.
- Compatibility checks that refuse unknown game bundles and mismatched preset or equipment counts.
- Standalone helper with an isolated offline preview and automated source and browser checks.
- Per-user Windows x64 installer with bundled Node.js 24.14.0, desktop and Start menu shortcuts, tray settings, disconnect controls, and uninstall support.
- Optional guided Steam launch option that forwards the original game executable and arguments without patching game files or editing Steam settings.

### Fixed

- The launched game window is visible while the packaged helper remains hidden.
- Native window closure releases the debugger connection and stops the helper.
- Launcher cleanup tolerates repeated tray disposal and game startup navigation.
- Preset labels align with the native card interface; saved groups start collapsed and require selection before loading.

### Verification limits

Installed direct launch and native window closure have been exercised in the real game. Actual Steam Play after setup, live tray interactions, interactive uninstall, and full live card loading, recovery, and restart persistence remain unverified.
