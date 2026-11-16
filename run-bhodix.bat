@echo off
rem Launches the Bhodhix OS desktop app (engine runs inside the app; no console stays open).
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
