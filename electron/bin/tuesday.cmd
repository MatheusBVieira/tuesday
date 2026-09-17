@echo off
rem CLI do tuesday instalado (init, brief, note, steps, check, todos). Coloque esta pasta no PATH para usar de qualquer lugar.
setlocal
set ELECTRON_RUN_AS_NODE=1
set TUESDAY_RUNTIME=desktop
"%~dp0..\tuesday.exe" "%~dp0..\resources\app\cli.mjs" %*
