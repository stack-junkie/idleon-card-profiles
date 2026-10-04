$ErrorActionPreference = 'Stop'
$addonRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path (Split-Path -Parent $addonRoot) 'output'
$version = (Get-Content -LiteralPath (Join-Path $addonRoot 'package.json') -Raw | ConvertFrom-Json).version
$archive = Join-Path $outputDirectory "idleon-card-profiles-$version-source.zip"
$items = @('src', 'preview', 'test', 'scripts', '.github', '.githooks', '.gitignore', '.gitattributes', '.secret-allowlist', 'AGENTS.md', 'VERSION', 'package.json', 'README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'LICENSE', 'ATTRIBUTION.md', 'Preview.ps1', 'Start-CardProfiles.ps1', 'Start-CardProfiles.cmd')
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$stage = Join-Path $outputDirectory ('.source-package-' + [Guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $stage | Out-Null
    foreach ($item in $items) { Copy-Item -LiteralPath (Join-Path $addonRoot $item) -Destination $stage -Recurse }
    $packaging = Join-Path $stage 'packaging'
    New-Item -ItemType Directory -Path $packaging | Out-Null
    foreach ($file in @('Launcher.cs', 'Setup.cs', 'PackagingTests.cs', 'LauncherLifecycleTests.cs', 'app.manifest', 'node-LICENSE.txt', 'test-packaging.ps1')) {
        Copy-Item -LiteralPath (Join-Path $addonRoot ('packaging\' + $file)) -Destination $packaging
    }
    Compress-Archive -LiteralPath @(Get-ChildItem -LiteralPath $stage | ForEach-Object FullName) -DestinationPath $archive -Force
} finally {
    if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($stage)) -ne [IO.Path]::GetFullPath($outputDirectory)) { throw 'Unexpected source package staging directory.' }
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
Get-Item -LiteralPath $archive | Select-Object FullName, Length
