# LEGAL OS — clippy workspace (MSVC). À lancer dans un shell où link.exe est disponible.
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$vsDevCmd = "C:\Program Files\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat"
if (-not (Test-Path $vsDevCmd)) {
    Write-Error "VsDevCmd introuvable. Installez la charge « Développement Desktop en C++ » (VCTools) via Visual Studio Installer."
}

$env:CARGO_TARGET_DIR = Join-Path (Get-Location) "target"
cmd /c "`"$vsDevCmd`" -arch=amd64 && cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace && cargo run -p xtask -- check-contracts"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
