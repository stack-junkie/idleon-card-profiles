# Contributing

Keep changes focused on native card preset naming, saved groups, recovery, and the Windows launcher. Include the problem, resulting behavior, and checks performed in a pull request. State which results came from mocks, the offline preview, or a real game session.

## Local setup and checks

Use Node.js 22 or newer. The source has no npm runtime dependencies and does not require Python. Enable the repository hooks after cloning:

```powershell
git config core.hooksPath .githooks
npm run version:check
node --test
```

The default suite uses temporary data and simulated game behavior. The installed-source fixture is skipped unless explicitly enabled. On Windows with the supported game installed, this optional check reads installation files without connecting to the game:

```powershell
$env:IDLEON_TEST_INSTALLED_FIXTURE = '1'
node --test
Remove-Item Env:IDLEON_TEST_INSTALLED_FIXTURE
```

For interface changes, use `node src/cli.js preview`. The optional browser check requires an existing Playwright installation: set `PLAYWRIGHT_MODULE` to its absolute module directory and, when needed, `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a headless Chromium executable, then run `node scripts/verify-preview.mjs`. It uses isolated preview data and does not connect to the game. Its native-font assertion requires the supported installed game fixture.

For installer changes, use Windows x64, Node.js 24.14.0, and the .NET Framework 4 compiler described in the [README](README.md):

```powershell
.\scripts\build-installer.ps1
.\packaging\test-packaging.ps1
```

Run checks relevant to the change and the repository's required checks. CI must use synthetic fixtures and must never launch or attach to a real game.

## Versioning

Use `npm run version:bump -- <version>` to update the version files together. Update [CHANGELOG.md](CHANGELOG.md) with the resulting behavior and run `npm run version:check` before committing. A version change does not by itself mean a tested release has been published.

## Live verification

Preserve active play sessions. Do not attach to, reload, close, or restart somebody's game without their explicit readiness for that test. The player must save and exit normally before a new add-on session is launched. Do not force-stop game processes to make a test pass.

Before testing a profile load, back up the profile directory and record the destination setup. Verify complete-row loading, unchanged card-set bonus, Restore, character switching, and persistence after a normal restart. Record unverified steps. Mock tests or a visible overlay alone do not establish correct live card saving.

Keep unsupported game updates blocked until their bundle and runtime structures have been inspected and the relevant behavior verified. Do not remove compatibility checks merely to accept a new hash.

## Data and distribution

Do not commit profile databases, game files, extracted fonts, account details, private logs, machine-specific paths, or generated installers. Use synthetic examples and redact reports. Preserve local backups and account isolation when changing storage.

The bundled Node runtime must keep its matching license. If changing the runtime, verify the upstream license and update build validation together. Game assets remain in the user's existing installation. See [ATTRIBUTION.md](ATTRIBUTION.md).

Use [SECURITY.md](SECURITY.md) for suspected vulnerabilities. For ordinary bugs, include the add-on version, Windows version, supported bundle status, reproduction steps, and whether the problem occurs in preview or the real game.
