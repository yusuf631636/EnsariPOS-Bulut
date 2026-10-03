# Kurye Bulut Ajani - NSSM servisini kaldirir (kaldirma/guncelleme oncesi).
$ErrorActionPreference = 'SilentlyContinue'
Set-Location $PSScriptRoot
$nssm = Join-Path $PSScriptRoot 'nssm.exe'
if (Get-Service -Name 'KuryeBulutAjan' -ErrorAction SilentlyContinue) {
  & $nssm stop 'KuryeBulutAjan' | Out-Null
  & $nssm remove 'KuryeBulutAjan' confirm | Out-Null
  Write-Host 'KuryeBulutAjan kaldirildi.' -ForegroundColor Yellow
}
