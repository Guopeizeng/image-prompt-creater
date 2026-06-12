@echo off
setlocal EnableExtensions
pushd "%~dp0" || (
  echo [PVOS] Cannot enter the extracted folder.
  pause
  exit /b 1
)
set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS_EXE%" set "PS_EXE=powershell.exe"
"%PS_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start_local_windows.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
popd
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [PVOS START FAILED] Please read the error message above.
  echo You can also open OPEN_ME_FIRST.txt for troubleshooting.
  pause
)
exit /b %EXIT_CODE%
