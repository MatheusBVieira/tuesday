@echo off
rem Hooks do Claude Code no tuesday instalado: roda o executavel do app como Node.
setlocal
set ELECTRON_RUN_AS_NODE=1
set TUESDAY_RUNTIME=desktop
"%~dp0..\tuesday.exe" "%~dp0..\resources\app\hook.mjs" %*
