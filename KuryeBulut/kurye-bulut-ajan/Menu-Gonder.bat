@echo off
chcp 1254 >nul
cd /d "%~dp0"
echo Menu buluta gonderiliyor, lutfen bekleyin...
node menu-push-once.js
pause
