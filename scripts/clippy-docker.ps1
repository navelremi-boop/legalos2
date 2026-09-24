# LEGAL OS — clippy/tests dans le conteneur Rust (WDAC 4551 dans l'agent Cursor).
# Docker/apt écrivent sur stderr (debconf) : ne pas interrompre sur NativeCommandError.
$ErrorActionPreference = "Continue"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$inner =
  "export PATH=/usr/local/cargo/bin:`$PATH; " +
  "apt-get update -qq && apt-get install -y -qq libpq-dev pkg-config >/dev/null && " +
  "cargo fmt --all -- --check && " +
  "cargo clippy --workspace --all-targets -- -D warnings && " +
  "cargo test --workspace && " +
  "cargo run -p xtask -- check-contracts"
& docker run --rm --entrypoint bash -v "${root}:/work" -w /work rust:1.85.0-bookworm -lc "$inner"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
