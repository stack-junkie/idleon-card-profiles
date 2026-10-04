$ErrorActionPreference = 'Stop'
$addonRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path (Split-Path -Parent $addonRoot) 'output'
$setup = Join-Path $outputDirectory 'IdleonCardProfiles-Setup.exe'
$testRoot = Join-Path $PSScriptRoot ('test-output-' + [Guid]::NewGuid().ToString('N'))
$extracted = Join-Path $testRoot 'extracted'
New-Item -ItemType Directory -Path $testRoot | Out-Null
$process = Start-Process -FilePath $setup -ArgumentList @('--extract-only', ('"' + $extracted + '"')) -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Extract-only failed: $($process.ExitCode)" }
$manifest = Get-Content -LiteralPath (Join-Path $extracted 'manifest.json') -Raw | ConvertFrom-Json
foreach ($file in $manifest.files) {
    $path = Join-Path $extracted $file.path
    if ((Get-Item -LiteralPath $path).Length -ne $file.size -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $file.sha256) { throw "Extraction mismatch: $($file.path)" }
}
if ((Get-ChildItem -LiteralPath $extracted -File -Recurse).Count -ne ($manifest.files.Count + 1)) { throw 'Unexpected extracted files.' }
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$testExe = Join-Path $testRoot 'PackagingTests.exe'
& $compiler /nologo /target:exe /platform:x64 /main:PackagingTests "/out:$testExe" /r:System.dll /r:System.Core.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll /r:System.Web.Extensions.dll /r:Microsoft.CSharp.dll (Join-Path $PSScriptRoot 'Launcher.cs') (Join-Path $PSScriptRoot 'Setup.cs') (Join-Path $PSScriptRoot 'PackagingTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Packaging test compilation failed.' }
& $testExe (Join-Path $testRoot 'checks') (Join-Path $extracted 'runtime\node.exe')
if ($LASTEXITCODE -ne 0) { throw 'Packaging checks failed.' }
$lifecycleExe = Join-Path $testRoot 'LauncherLifecycleTests.exe'
& $compiler /nologo /target:exe /platform:x64 /main:LauncherLifecycleTests "/out:$lifecycleExe" /r:System.dll /r:System.Core.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll (Join-Path $PSScriptRoot 'Launcher.cs') (Join-Path $PSScriptRoot 'LauncherLifecycleTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher lifecycle test compilation failed.' }
& $lifecycleExe (Join-Path $extracted 'runtime\node.exe')
if ($LASTEXITCODE -ne 0) { throw 'Launcher lifecycle checks failed.' }
[ordered]@{ passed = $true; timestamp = [DateTime]::UtcNow.ToString('o'); setupSha256 = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash; payloadFiles = $manifest.files.Count; gameOrSteamLaunched = $false; liveInstallTested = $false; testRoot = $testRoot } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $testRoot 'result.json') -Encoding UTF8
Get-Content -LiteralPath (Join-Path $testRoot 'result.json')
