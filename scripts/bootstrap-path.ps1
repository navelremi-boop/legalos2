# LEGAL OS — PATH session dev (sans droits admin). Dot-source : . .\scripts\bootstrap-path.ps1
$paths = @(
    "$env:USERPROFILE\.cargo\bin",
    "$env:LOCALAPPDATA\winlibs\mingw64\bin",
    "C:\Program Files\Docker\Docker\resources\bin",
    "C:\Program Files\Git\cmd",
    "${env:ProgramFiles(x86)}\Git\cmd",
    "C:\Program Files\GitHub CLI",
    "$env:LOCALAPPDATA\MinGit\cmd"
)
foreach ($p in $paths) {
    if (Test-Path $p) { $env:Path = "$p;$env:Path" }
}
$env:CARGO_TARGET_DIR = Join-Path (Split-Path $PSScriptRoot -Parent) "target"
