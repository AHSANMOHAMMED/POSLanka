@echo off
rem skyERPOS printer setup for Windows 10/11 - download, double-click, done.
rem Served as /print-agent/skyERPOS-Printer-Setup.cmd with the app address filled in.
rem Uses only curl.exe and tar.exe (built into Windows 10 1803+ / 11): no PowerShell, no admin.
rem Installs a private Node.js and the print agent into %LOCALAPPDATA%\skyERPOS, starts it
rem hidden now and at every logon. Run again to update; run with /uninstall to remove.
setlocal EnableExtensions
title skyERPOS printer setup

set "ORIGIN=__SKYERPOS_ORIGIN__"
set "NODEVER=v22.12.0"
set "BASE=%LOCALAPPDATA%\skyERPOS"
set "DIR=%BASE%\print-agent"
set "NODEDIR=%BASE%\node"
set "NODE=%NODEDIR%\node.exe"
rem A renamed copy of node.exe, so updates can stop exactly this program and nothing else
set "AGENTEXE=%NODEDIR%\skyerpos-print-agent.exe"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%STARTUP%\skyERPOS print agent.vbs"
set "HEALTH=http://127.0.0.1:9123/health"

set "ARCH=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=arm64"
if /i "%PROCESSOR_ARCHITECTURE%"=="x86" if not defined PROCESSOR_ARCHITEW6432 set "ARCH=x86"

echo.
echo   skyERPOS printer setup
echo   ----------------------
echo   Connects the label / receipt printers of this PC to %ORIGIN%
echo.

call :stop_agent
if /i "%~1"=="/uninstall" goto :uninstall

where curl.exe >nul 2>nul || goto :old_windows
where tar.exe >nul 2>nul || goto :old_windows
if not exist "%BASE%" mkdir "%BASE%"
if not exist "%DIR%" mkdir "%DIR%"

rem ---------------------------------------------------------------- Node.js (private copy)
if exist "%NODE%" "%NODE%" -e "process.exit(+process.versions.node.split('.')[0] >= 20 ? 0 : 1)" >nul 2>nul && goto :have_node
echo [1/4] Downloading Node.js %NODEVER% (about 30 MB, one time)...
curl.exe -fL --retry 3 --progress-bar -o "%TEMP%\skyerpos-node.zip" "https://nodejs.org/dist/%NODEVER%/node-%NODEVER%-win-%ARCH%.zip" || goto :download_failed
if exist "%TEMP%\skyerpos-node" rd /s /q "%TEMP%\skyerpos-node"
mkdir "%TEMP%\skyerpos-node"
tar.exe -xf "%TEMP%\skyerpos-node.zip" -C "%TEMP%\skyerpos-node" || goto :unzip_failed
if exist "%NODEDIR%" rd /s /q "%NODEDIR%"
move "%TEMP%\skyerpos-node\node-%NODEVER%-win-%ARCH%" "%NODEDIR%" >nul || goto :unzip_failed
del /q "%TEMP%\skyerpos-node.zip" >nul 2>nul
rd /s /q "%TEMP%\skyerpos-node" >nul 2>nul
:have_node
copy /y "%NODE%" "%AGENTEXE%" >nul || goto :unzip_failed
echo [1/4] Node.js ready.

rem ---------------------------------------------------------------- print agent
echo [2/4] Downloading the skyERPOS print agent...
curl.exe -fsSL --retry 3 -o "%DIR%\index.new.mjs" "%ORIGIN%/print-agent/index.mjs" || goto :download_failed
"%NODE%" --check "%DIR%\index.new.mjs" || goto :download_failed
move /y "%DIR%\index.new.mjs" "%DIR%\index.mjs" >nul
"%NODE%" "%DIR%\index.mjs" --allow-origin %ORIGIN% >nul 2>nul

rem ---------------------------------------------------------------- start at every logon (hidden)
echo [3/4] Setting it to start with Windows...
if not exist "%STARTUP%" mkdir "%STARTUP%"
rem older PowerShell installs used a shortcut; one launcher is enough
if exist "%STARTUP%\skyERPOS print agent.lnk" del /q "%STARTUP%\skyERPOS print agent.lnk"
> "%VBS%" echo Set sh = CreateObject("WScript.Shell")
>> "%VBS%" echo sh.CurrentDirectory = "%DIR%"
>> "%VBS%" echo sh.Run """%AGENTEXE%"" ""%DIR%\index.mjs""", 0, False

rem ---------------------------------------------------------------- start now + check
echo [4/4] Starting the print agent...
start "" wscript.exe "%VBS%"
set /a TRIES=0
:wait_agent
timeout /t 1 /nobreak >nul
curl.exe -sf -m 2 -o nul "%HEALTH%" && goto :done
set /a TRIES+=1
if %TRIES% lss 15 goto :wait_agent
rem Windows Script Host may be switched off (company PCs): start it in a minimised window instead
if %TRIES% equ 15 start "skyERPOS print agent - keep this open" /min "%AGENTEXE%" "%DIR%\index.mjs"
if %TRIES% lss 30 goto :wait_agent
goto :start_failed

:done
echo.
echo   DONE - the skyERPOS print agent is running and starts with Windows.
echo.
echo   Next: in skyERPOS open  Barcode ^& Labels ^> Print Barcode,
echo   press Refresh in the green "Print directly" box and pick your printer.
echo.
pause
exit /b 0

rem ================================================================ helpers / errors
:stop_agent
taskkill /f /im skyerpos-print-agent.exe >nul 2>nul
rem agents installed by the older PowerShell installer ran as node.exe from %LOCALAPPDATA%\skyERPOS
powershell.exe -NoProfile -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*skyERPOS*' } | Stop-Process -Force -ErrorAction SilentlyContinue" >nul 2>nul
timeout /t 1 /nobreak >nul
exit /b 0

:uninstall
if exist "%VBS%" del /q "%VBS%"
if exist "%STARTUP%\skyERPOS print agent.lnk" del /q "%STARTUP%\skyERPOS print agent.lnk"
if exist "%BASE%" rd /s /q "%BASE%"
echo   The skyERPOS print agent was removed from this PC.
pause
exit /b 0

:old_windows
echo   This Windows is too old for automatic setup (curl.exe / tar.exe are missing).
echo   Update Windows 10 to the latest version, or in skyERPOS use
echo   "Connect USB label printer" on the Print Barcode page instead.
pause
exit /b 1

:download_failed
echo.
echo   Could not download the files. Check that this PC is online (open %ORIGIN% in the browser),
echo   then run this setup again. If a firewall or antivirus asks, allow curl.exe.
pause
exit /b 1

:unzip_failed
echo.
echo   Could not unpack Node.js into %NODEDIR%. Close other skyERPOS windows and run this setup again.
pause
exit /b 1

:start_failed
echo.
echo   The print agent did not start. Another program may be using port 9123,
echo   or antivirus blocked "%AGENTEXE%" - allow it and run this setup again.
pause
exit /b 1
