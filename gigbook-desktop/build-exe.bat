@echo off
set PATH=%PATH%;C:\Program Files\nodejs
cd /d "%~dp0"
mkdir dist 2>nul
node node_modules\pkg\lib-es5\bin.js server-app.js --targets node18-win-x64 --output dist\GigBook-Server.exe
if errorlevel 1 (
    echo Error en build
) else (
    echo Build exitoso: dist\GigBook-Server.exe
)
pause
