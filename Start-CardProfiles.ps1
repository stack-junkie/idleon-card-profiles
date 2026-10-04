$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath $PSScriptRoot
try {
    & node (Join-Path $PSScriptRoot 'src\cli.js') launch --live @args
} finally {
    Pop-Location
}
