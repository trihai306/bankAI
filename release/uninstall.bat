@echo off
echo ========================================
echo   Bank AI Auto - Uninstaller
echo ========================================
echo.

set "INSTALL_DIR=C:\BankAI"
set /p "INSTALL_DIR=Install directory to remove [%INSTALL_DIR%]: "

if not exist "%INSTALL_DIR%\Bank AI Auto.exe" (
    echo ERROR: Bank AI Auto not found in %INSTALL_DIR%
    pause
    exit /b 1
)

echo.
echo This will remove:
echo   - App files in %INSTALL_DIR%
echo   - Desktop shortcut
echo   - Start Menu shortcut
echo   - App data in %%APPDATA%%\bank-ai-auto
echo.
set /p "CONFIRM=Are you sure? (Y/N): "
if /i not "%CONFIRM%"=="Y" (
    echo Cancelled.
    pause
    exit /b 0
)

echo.
echo Removing app files...
rmdir /s /q "%INSTALL_DIR%"

echo Removing Desktop shortcut...
del "%USERPROFILE%\Desktop\Bank AI Auto.lnk" 2>nul
del "%PUBLIC%\Desktop\Bank AI Auto.lnk" 2>nul

echo Removing Start Menu shortcut...
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Bank AI Auto.lnk" 2>nul

echo Removing app data...
rmdir /s /q "%APPDATA%\bank-ai-auto" 2>nul

echo.
echo ========================================
echo   Uninstall Complete!
echo ========================================
echo.
pause
