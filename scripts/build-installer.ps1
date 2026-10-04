param(
    [string]$NodePath = (Get-Command node -ErrorAction Stop).Source
)
$ErrorActionPreference = 'Stop'
$addonRoot = Split-Path -Parent $PSScriptRoot
$packagingRoot = Join-Path $addonRoot 'packaging'
$outputDirectory = Join-Path (Split-Path -Parent $addonRoot) 'output'
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$package = Get-Content -LiteralPath (Join-Path $addonRoot 'package.json') -Raw | ConvertFrom-Json
if ($package.version -notmatch '^(\d+\.\d+\.\d+)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$') { throw 'Package version must be a semantic version.' }
$assemblyVersion = $Matches[1] + '.0'
$nodeVersion = (& $NodePath --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -ne 'v24.14.0') { throw 'This package includes the Node 24.14.0 license. Use Node 24.14.0 or update and verify its license before building.' }
$license = Join-Path $packagingRoot 'node-LICENSE.txt'
if ((Get-FileHash -LiteralPath $license -Algorithm SHA256).Hash -ne '4573185D56580DA2B890BA34A85A409257640F1C5632EADE4300137266194D18') { throw 'The Node runtime license did not match the verified upstream license.' }
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$build = Join-Path $packagingRoot ('build-' + [Guid]::NewGuid().ToString('N'))
$payload = Join-Path $build 'payload'
New-Item -ItemType Directory -Path (Join-Path $payload 'runtime') -Force | Out-Null
Copy-Item -LiteralPath $NodePath -Destination (Join-Path $payload 'runtime\node.exe')
Copy-Item -LiteralPath $license -Destination (Join-Path $payload 'runtime\LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $addonRoot 'src') -Destination $payload -Recurse
Copy-Item -LiteralPath (Join-Path $addonRoot 'package.json') -Destination $payload
foreach ($notice in @('LICENSE', 'ATTRIBUTION.md')) { Copy-Item -LiteralPath (Join-Path $addonRoot $notice) -Destination $payload }
$launcherSource = Join-Path $packagingRoot 'Launcher.cs'
$setupSource = Join-Path $packagingRoot 'Setup.cs'
$manifest = Join-Path $packagingRoot 'app.manifest'
$assemblyInfo = Join-Path $build 'AssemblyInfo.cs'
@"
using System.Reflection;
[assembly: AssemblyTitle("Idleon Card Profiles")]
[assembly: AssemblyProduct("Idleon Card Profiles")]
[assembly: AssemblyVersion("$assemblyVersion")]
[assembly: AssemblyFileVersion("$assemblyVersion")]
"@ | Set-Content -LiteralPath $assemblyInfo -Encoding UTF8
$references = @('/r:System.dll', '/r:System.Core.dll', '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.IO.Compression.dll', '/r:System.IO.Compression.FileSystem.dll', '/r:System.Web.Extensions.dll', '/r:Microsoft.CSharp.dll')
$common = @('/nologo', '/target:winexe', '/platform:x64', '/optimize+', "/win32manifest:$manifest") + $references
& $compiler @common /main:Launcher "/out:$(Join-Path $payload 'IdleonCardProfiles.exe')" $launcherSource $assemblyInfo
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
& $compiler @common /main:Setup "/out:$(Join-Path $payload 'Uninstall.exe')" $launcherSource $setupSource $assemblyInfo
if ($LASTEXITCODE -ne 0) { throw 'Maintenance compilation failed.' }
$payloadFiles = @(Get-ChildItem -LiteralPath $payload -File -Recurse | Sort-Object FullName | ForEach-Object {
    [ordered]@{ path = $_.FullName.Substring($payload.Length + 1).Replace('\', '/'); size = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
})
[ordered]@{ product = 'IdleonCardProfiles'; version = $package.version; runtime = $nodeVersion; files = $payloadFiles } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $payload 'manifest.json') -Encoding UTF8
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = Join-Path $outputDirectory "idleon-card-profiles-$($package.version)-win-x64.zip"
$stagedArchive = Join-Path $build 'payload.zip'
[System.IO.Compression.ZipFile]::CreateFromDirectory($payload, $stagedArchive, [System.IO.Compression.CompressionLevel]::Optimal, $false)
$stagedSetup = Join-Path $build 'IdleonCardProfiles-Setup.exe'
& $compiler @common /main:Setup "/resource:$stagedArchive,payload.zip" "/out:$stagedSetup" $launcherSource $setupSource $assemblyInfo
if ($LASTEXITCODE -ne 0) { throw 'Setup compilation failed.' }
Copy-Item -LiteralPath $stagedArchive -Destination $archive -Force
Copy-Item -LiteralPath $stagedSetup -Destination (Join-Path $outputDirectory 'IdleonCardProfiles-Setup.exe') -Force
# Keep only compilation inputs in this build folder. All removal targets are verified beneath packaging.
$resolvedBuild = [IO.Path]::GetFullPath($build)
$allowedPrefix = [IO.Path]::GetFullPath($packagingRoot).TrimEnd('\') + '\'
if (-not $resolvedBuild.StartsWith($allowedPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected build directory.' }
Remove-Item -LiteralPath $resolvedBuild -Recurse -Force
Get-Item -LiteralPath $archive, (Join-Path $outputDirectory 'IdleonCardProfiles-Setup.exe') | Select-Object FullName, Length
