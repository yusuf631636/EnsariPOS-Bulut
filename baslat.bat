@echo off
title Ensari POS Bulut
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

if not exist "data\cloud.db" (
  echo.
  echo Ilk calistirma - once bir yonetici hesabi olusturmaniz gerekiyor.
  set /p ADMIN_EMAIL="Yonetici e-postasi: "
  set /p ADMIN_PASS="Yonetici sifresi: "
  node bootstrap-admin.js %ADMIN_EMAIL% %ADMIN_PASS%
)

echo.
echo ================================================
echo  Ensari POS Bulut baslatiliyor...
echo  Adres: http://localhost:8888
echo  Kapatmak icin bu pencereyi kapatin (Ctrl+C).
echo ================================================
echo.
node server.js
pause
