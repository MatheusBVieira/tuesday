@echo off
rem CLI do tuesday instalado (init, brief, note, steps, check, todos). Coloque esta pasta no PATH para usar de qualquer lugar.
setlocal
set ELECTRON_RUN_AS_NODE=1
set TUESDAY_RUNTIME=desktop
rem Sem isto, "tuesday setup" registraria o MCP num caminho que não existe (resources\mcp.mjs).
set TUESDAY_APP_DIR=%~dp0..\resources\app
"%~dp0..\tuesday.exe" "%~dp0..\resources\app\cli.mjs" %*
