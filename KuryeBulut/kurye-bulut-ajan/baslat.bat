@echo off
title Kurye Bulut Ajani
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js bulunamadi. Once https://nodejs.org adresinden Node.js LTS kurun.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Bagimliliklar kuruluyor, bir kez calisir...
  call npm install
)

if not exist "config.json" (
  echo.
  echo config.json bulunamadi. "config.example.json" dosyasini "config.json"
  echo olarak kopyalayip SQL bilgilerinizi ve aktivasyon anahtarinizi yazin,
  echo sonra bu dosyayi tekrar calistirin.
  pause
  exit /b 1
)

echo.
echo ================================================
echo  Kurye Bulut Ajani baslatiliyor...
echo  Kapatmak icin bu pencereyi kapatin (Ctrl+C).
echo ================================================
echo.
node agent.js
pause
