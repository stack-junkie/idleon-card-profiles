@echo off
cd /d "%~dp0"
title Idleon Card Profiles Helper
node src/cli.js launch --live
if errorlevel 1 pause
