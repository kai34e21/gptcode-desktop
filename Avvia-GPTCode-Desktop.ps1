param(
    [string]$Workspace = $PSScriptRoot,
    [string]$CliPath = 'C:\Users\Utente\.cline\data\workspaces\chat\gptcode\bin\gptcode.mjs',
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$bun = Join-Path (Split-Path $PSScriptRoot) '.gptcode-desktop-tools\bun-1.4.2\bun-windows-x64\bun.exe'
if (!(Test-Path -LiteralPath $bun)) { throw 'Bun 1.4.2 locale mancante. Vedi GPTCODE-DESKTOP.md.' }
if ((& $bun --version) -ne '1.4.2') { throw 'Bun 1.4.2 richiesto.' }
if (!(Test-Path -LiteralPath $CliPath -PathType Leaf)) { throw "GPTCode CLI non trovato: $CliPath" }
$cliRoot = Split-Path (Split-Path $CliPath)
$manifest = Get-Content (Join-Path $cliRoot 'package.json') -Raw | ConvertFrom-Json
if ($manifest.name -ne 'gptcode') { throw 'Il percorso non appartiene a GPTCode.' }
$env:GPTCODE_NODE_PATH = (Get-Command node.exe).Source
$env:GPTCODE_CLI_PATH = (Resolve-Path -LiteralPath $CliPath).Path
$env:GPTCODE_WORKSPACE_ROOT = (Resolve-Path -LiteralPath $Workspace).Path
$env:GPTCODE_DESKTOP = '1'
$env:GPTCODE_DESKTOP_RUNTIME = Join-Path $PSScriptRoot 'apps\examples\desktop-app\gptcode-runtime\worker.mjs'
$env:NEXT_PUBLIC_GPTCODE_DESKTOP = '1'
$env:PATH = (Split-Path $bun) + ';' + $env:PATH
if ($CheckOnly) {
    Write-Output "Bun 1.4.2; Node $(& $env:GPTCODE_NODE_PATH --version); GPTCode $($manifest.version)"
    Write-Output "Workspace: $env:GPTCODE_WORKSPACE_ROOT"
    exit 0
}
Push-Location (Join-Path $PSScriptRoot 'apps\examples\desktop-app')
try {
    & $bun run tauri dev --config src-tauri/tauri.gptcode.conf.json
    if ($LASTEXITCODE -ne 0) { throw "Avvio desktop fallito: $LASTEXITCODE" }
} finally { Pop-Location }
