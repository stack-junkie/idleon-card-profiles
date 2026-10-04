# Changelog

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
