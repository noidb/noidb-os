@echo off
rem NOID-B: register the Hanjin print Chrome link (run once per PC).
rem The real folder path is written into the registry on purpose: Windows misreads %LOCALAPPDATA% when it runs a link command.
reg add "HKCU\Software\Classes\hanjinprint" /ve /t REG_SZ /d "URL:Hanjin Print Chrome" /f >nul
reg add "HKCU\Software\Classes\hanjinprint" /v "URL Protocol" /t REG_SZ /d "" /f >nul
reg add "HKCU\Software\Classes\hanjinprint\shell\open\command" /ve /t REG_SZ /d "cmd /c start \"\" \"C:\Program Files\Google\Chrome\Application\chrome.exe\" --user-data-dir=\"%USERPROFILE%\AppData\Local\HanjinPrintChrome\" --disable-extensions --disable-background-networking https://focus.hanjin.com/" /f >nul
if errorlevel 1 (
  echo FAILED. The Hanjin print link was not registered.
) else (
  echo OK. The Hanjin print link is registered. You can close this window.
)
pause
