@echo off
setlocal
call "C:\Program Files\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=amd64
cd /d "%~dp0.."
cargo fmt --all -- --check
if errorlevel 1 exit /b 1
cargo clippy --workspace --all-targets -- -D warnings
if errorlevel 1 exit /b 1
cargo test --workspace
if errorlevel 1 exit /b 1
cargo run -p xtask -- check-contracts
exit /b %errorlevel%
