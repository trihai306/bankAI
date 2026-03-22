@echo off
setlocal enabledelayedexpansion

echo ========================================
echo   Bank AI Auto - Installer
echo ========================================
echo.

:: ---- Locate source ----
set "SCRIPT_DIR=%~dp0"
set "SOURCE_DIR=!SCRIPT_DIR!win-unpacked"

if not exist "!SOURCE_DIR!\Bank AI Auto.exe" (
    echo [ERROR] Cannot find "win-unpacked" folder next to this script.
    echo Expected: !SOURCE_DIR!
    echo.
    echo Please run this script from the release folder.
    echo.
    pause
    exit /b 1
)

:: ---- Ask for install directory ----
set "INSTALL_DIR=C:\BankAI"
set /p "INSTALL_DIR=Install directory [!INSTALL_DIR!]: "

echo.
echo Source:  !SOURCE_DIR!
echo Target:  !INSTALL_DIR!
echo.

:: Create target directory
if not exist "!INSTALL_DIR!" mkdir "!INSTALL_DIR!"

:: ---- Install using robocopy ----
if exist "!INSTALL_DIR!\Bank AI Auto.exe" (
    echo [UPGRADE] Existing installation detected - preserving user data...
    echo.

    :: robocopy /XD excludes directories by name
    robocopy "!SOURCE_DIR!" "!INSTALL_DIR!" /E /IS /IT /XD ref_audio outputs /NFL /NDL /NJH /NJS /NC /NS
    
    :: robocopy exit codes: 0-7 = success, 8+ = error
    if !ERRORLEVEL! GEQ 8 (
        echo [WARNING] Some files may not have been copied. Error level: !ERRORLEVEL!
    )

    :: Ensure user data directories still exist
    if not exist "!INSTALL_DIR!\resources\python\ref_audio" mkdir "!INSTALL_DIR!\resources\python\ref_audio"
    if not exist "!INSTALL_DIR!\resources\python\outputs" mkdir "!INSTALL_DIR!\resources\python\outputs"

    echo.
    echo [OK] Updated app files. User data preserved: ref_audio, outputs
) else (
    echo [FRESH] First-time installation...
    echo.

    robocopy "!SOURCE_DIR!" "!INSTALL_DIR!" /E /IS /IT /NFL /NDL /NJH /NJS /NC /NS

    if !ERRORLEVEL! GEQ 8 (
        echo [WARNING] Some files may not have been copied. Error level: !ERRORLEVEL!
    )

    echo.
    echo [OK] Installation complete.
)

:: ---- Create shortcuts ----
echo.
echo Creating shortcuts...

:: Desktop shortcut
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Bank AI Auto.lnk'); $s.TargetPath = '!INSTALL_DIR!\Bank AI Auto.exe'; $s.WorkingDirectory = '!INSTALL_DIR!'; $s.IconLocation = '!INSTALL_DIR!\Bank AI Auto.exe,0'; $s.Description = 'Bank AI Auto'; $s.Save()"

:: Start Menu shortcut
set "START_MENU=!APPDATA!\Microsoft\Windows\Start Menu\Programs"
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('!START_MENU!\Bank AI Auto.lnk'); $s.TargetPath = '!INSTALL_DIR!\Bank AI Auto.exe'; $s.WorkingDirectory = '!INSTALL_DIR!'; $s.IconLocation = '!INSTALL_DIR!\Bank AI Auto.exe,0'; $s.Description = 'Bank AI Auto'; $s.Save()"

echo.
echo ========================================
echo   Installation Complete!
echo ========================================
echo.
echo App installed to: !INSTALL_DIR!
echo Desktop shortcut created.
echo.
echo You can now run "Bank AI Auto" from the Desktop.
echo.

endlocal
pause
