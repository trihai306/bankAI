@echo off
echo ========================================
echo   Bank AI Auto - Installer
echo ========================================
echo.

set "INSTALL_DIR=C:\BankAI"

:: Ask user for install directory
set /p "INSTALL_DIR=Install directory [%INSTALL_DIR%]: "

echo.
echo Installing to: %INSTALL_DIR%
echo This may take a few minutes...
echo.

:: Create directory
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

:: Copy files from win-unpacked (same directory as this script)
set "SCRIPT_DIR=%~dp0"
xcopy "%SCRIPT_DIR%win-unpacked\*" "%INSTALL_DIR%\" /E /I /H /Y /Q

:: Create Desktop shortcut with app icon
echo Creating shortcuts...
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Bank AI Auto.lnk'); $s.TargetPath = '%INSTALL_DIR%\Bank AI Auto.exe'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.IconLocation = '%INSTALL_DIR%\Bank AI Auto.exe,0'; $s.Description = 'Bank AI Auto'; $s.Save()"

:: Create Start Menu shortcut with app icon
set "START_MENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs"
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%START_MENU%\Bank AI Auto.lnk'); $s.TargetPath = '%INSTALL_DIR%\Bank AI Auto.exe'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.IconLocation = '%INSTALL_DIR%\Bank AI Auto.exe,0'; $s.Description = 'Bank AI Auto'; $s.Save()"

echo.
echo ========================================
echo   Installation Complete!
echo ========================================
echo.
echo App installed to: %INSTALL_DIR%
echo Desktop shortcut created.
echo.
echo You can now run "Bank AI Auto" from the Desktop.
echo.
pause
