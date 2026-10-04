$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath $PSScriptRoot
try {
    & node (Join-Path $PSScriptRoot 'src\cli.js') preview @args
} finally {
    Pop-Location
}
