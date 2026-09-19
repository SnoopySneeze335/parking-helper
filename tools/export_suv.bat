@echo off
setlocal
rem ---------------------------------------------------------------------------
rem Re-export the SUV GLB from assets\SUV.blend in one double-click.
rem
rem Runs Blender headless with tools\export_suv_glb.py, which writes
rem   assets\models\suv.glb               (the model)
rem   assets\models\model-manifest.js     (versioned URL for cache-busting)
rem then keeps the window open so you can read the log.
rem
rem Any extra arguments are passed through to the script, e.g.
rem   export_suv.bat --manifest-only
rem ---------------------------------------------------------------------------

set "BLENDER=C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"

if not exist "%BLENDER%" (
  echo Blender was not found at:
  echo   %BLENDER%
  echo Edit the BLENDER line in %~nx0 to point at your blender.exe.
  pause
  exit /b 1
)

rem Run from the repository root (one folder up from this .bat).
pushd "%~dp0.."
echo Exporting SUV from assets\SUV.blend ...
echo.
rem --python-exit-code 1 makes Blender return a failure code if the script raises.
"%BLENDER%" -b --python-exit-code 1 --python tools\export_suv_glb.py -- %*
set "RESULT=%ERRORLEVEL%"
popd

echo.
if not "%RESULT%"=="0" (
  echo *** EXPORT FAILED ^(exit code %RESULT%^) - read the messages above. ***
) else (
  echo Export finished. In the browser press Ctrl+Shift+R to see the new model.
)
pause
exit /b %RESULT%
