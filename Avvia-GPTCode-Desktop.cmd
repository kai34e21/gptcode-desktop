@echo off
pwsh.exe -NoLogo -NoProfile -File "%~dp0Avvia-GPTCode-Desktop.ps1" %*
if errorlevel 1 pause
