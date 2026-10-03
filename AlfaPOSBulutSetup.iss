; AlfaPOS Bulut - UC MODULU TEK KURULUMDA birlestiren "sarmalayici" installer.
; Gercek kaynak kodu DEGISTIRMEZ/KOPYALAMAZ - dogrudan iki ayrı, halihazirda
; calisan projenin kendi dosyalarini paketler (Kurye Bulut + QR Menü zaten
; ayni ajanin icinde; Patron Raporu ayri bir proje). Boylece TEK sihirbaz,
; TEK SQL bilgisi, TEK aktivasyon anahtariyla ucu de kurulur - musteriye
; ayrica "simdi de Patron'u kur" diye tekrar gidilmesi gerekmez.
;
; 30.09.2026: Patron kismi artik C# (Patron\install-services.ps1 C# servisini kurar, Node gerekmez).
; (degistirilmedi) - bu script zaten $PSScriptRoot'a gore calisiyor, o yuzden
; {app}\Kurye ve {app}\Patron altina kopyalaninca oldugu gibi calismaya
; devam eder. Iki proje TAMAMEN BAGIMSIZ servisler kurar (KuryeBulutAjan +
; EnsariPatron/EnsariPatronTunnel) - biri digerine dokunmaz.
#define AppName "AlfaPOS Bulut (Kurye + Patron + QR Menü)"
#define AppVersion "1.2.0"
#define AppPublisher "AlfaPOS"
; 29.09.2026: klasorler C:\Projeler altina tasindi - yollar bu .iss'e gore GORECELI
; (Kurye ajani: 1-Bulut\KuryeBulut\kurye-bulut-ajan, Patron: C:\Projeler\7-Patron-Raporu)
#define KuryeSrc "KuryeBulut\kurye-bulut-ajan"
#define PatronSrc "..\7-Patron-Raporu"
; 30.09.2026: Patron artik C# (Node.js gerekmez) - servis 9-CSharp-Projeler\Patron-Raporu-CSharp'tan, sayfalar 7-Patron-Raporu\public'ten
#define PatronCs "..\9-CSharp-Projeler\Patron-Raporu-CSharp"
#define Ortak "..\9-CSharp-Projeler\ortak"

[Setup]
AppId={{7C1B9E20-4F3D-4A8E-9C2A-ALFAPOSBULUT01}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\AlfaPOS\Bulut
OutputDir=dist
OutputBaseFilename=AlfaPOSBulutSetup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
SetupIconFile={#KuryeSrc}\assets\alfapos.ico
UninstallDisplayIcon={app}\Kurye\assets\alfapos.ico

[Files]
; ---- Kurye Bulut + QR Menü (ayni ajan) ----
Source: "{#KuryeSrc}\agent.js"; DestDir: "{app}\Kurye"; Flags: ignoreversion
Source: "{#KuryeSrc}\sql.js"; DestDir: "{app}\Kurye"; Flags: ignoreversion
Source: "{#KuryeSrc}\sambapos.js"; DestDir: "{app}\Kurye"; Flags: ignoreversion
Source: "{#KuryeSrc}\updater.js"; DestDir: "{app}\Kurye"; Flags: ignoreversion
Source: "{#KuryeSrc}\menu-sambapos.js"; DestDir: "{app}\Kurye"; Flags: ignoreversion
Source: "{#KuryeSrc}\menu-agent.js"; DestDir: "{app}\Kurye"; Flags: ignoreversion
Source: "{#KuryeSrc}\menu-push-once.js"; DestDir: "{app}\Kurye"; Flags: ignoreversion
Source: "{#KuryeSrc}\Menu-Gonder.bat"; DestDir: "{app}\Kurye"; Flags: ignoreversion
Source: "{#KuryeSrc}\package.json"; DestDir: "{app}\Kurye"; Flags: ignoreversion
Source: "{#KuryeSrc}\package-lock.json"; DestDir: "{app}\Kurye"; Flags: ignoreversion skipifsourcedoesntexist
Source: "{#KuryeSrc}\nssm.exe"; DestDir: "{app}\Kurye"; Flags: ignoreversion
Source: "{#KuryeSrc}\install-requirements.ps1"; DestDir: "{app}\Kurye"; Flags: ignoreversion
Source: "{#KuryeSrc}\install-services.ps1"; DestDir: "{app}\Kurye"; Flags: ignoreversion
Source: "{#KuryeSrc}\remove-services.ps1"; DestDir: "{app}\Kurye"; Flags: ignoreversion
Source: "{#KuryeSrc}\config.example.json"; DestDir: "{app}\Kurye"; Flags: ignoreversion
Source: "{#KuryeSrc}\node_modules\*"; DestDir: "{app}\Kurye\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#KuryeSrc}\assets\*"; DestDir: "{app}\Kurye\assets"; Flags: ignoreversion recursesubdirs createallsubdirs

; ---- Patron Raporu (C# surum, 30.09.2026) ----
; Kurulumda Windows'un kendi csc.exe'si derler (derlenemezse hazir PatronSrv.prebuilt.exe); "EnsariPatron" servisi.
; install-services.ps1 = C# servisini + cloudflared tunel servisini (NSSM) kuran sim - "Yeniden Kur" kisayolu da bunu calistirir.
Source: "{#PatronCs}\kaynak\*.cs"; DestDir: "{app}\Patron\kur\kaynak"; Flags: ignoreversion
Source: "{#PatronCs}\kaynak\alfapos.ico"; DestDir: "{app}\Patron\kur\kaynak"; Flags: ignoreversion
Source: "{#Ortak}\*.cs"; DestDir: "{app}\Patron\kur\ortak"; Flags: ignoreversion
Source: "{#PatronCs}\PatronSrv.exe"; DestDir: "{app}\Patron\kur"; DestName: "PatronSrv.prebuilt.exe"; Flags: ignoreversion
Source: "{#PatronCs}\kur\Patron_Kurulum.ps1"; DestDir: "{app}\Patron\kur"; Flags: ignoreversion
Source: "{#PatronCs}\kur\kaldir.ps1"; DestDir: "{app}\Patron\kur"; Flags: ignoreversion
Source: "{#PatronCs}\kur\yeniden-baslat.bat"; DestDir: "{app}\Patron\kur"; Flags: ignoreversion
Source: "{#PatronCs}\kur\install-services.ps1"; DestDir: "{app}\Patron"; Flags: ignoreversion
Source: "{#PatronCs}\surum.txt"; DestDir: "{app}\Patron"; Flags: ignoreversion
Source: "{#PatronSrc}\nssm.exe"; DestDir: "{app}\Patron"; Flags: ignoreversion
Source: "{#PatronSrc}\remove-services.ps1"; DestDir: "{app}\Patron"; Flags: ignoreversion
Source: "{#PatronSrc}\show-link.ps1"; DestDir: "{app}\Patron"; Flags: ignoreversion
Source: "{#PatronSrc}\public\*"; DestDir: "{app}\Patron\public"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PatronSrc}\config.example.json"; DestDir: "{app}\Patron"; Flags: ignoreversion
Source: "{#PatronSrc}\database-template.sql"; DestDir: "{app}\Patron"; Flags: ignoreversion
Source: "{#PatronSrc}\README-KURULUM.txt"; DestDir: "{app}\Patron"; Flags: ignoreversion
Source: "{#PatronSrc}\install-requirements.ps1"; DestDir: "{app}\Patron"; Flags: ignoreversion
Source: "{#PatronSrc}\ddns.example.json"; DestDir: "{app}\Patron"; Flags: ignoreversion
Source: "{#PatronSrc}\ddns.example.json"; DestDir: "{app}\Patron"; DestName: "ddns.json"; Flags: onlyifdoesntexist
Source: "{#PatronSrc}\tailscale.example.json"; DestDir: "{app}\Patron"; Flags: ignoreversion
Source: "{#PatronSrc}\tailscale.example.json"; DestDir: "{app}\Patron"; DestName: "tailscale.json"; Flags: onlyifdoesntexist

[InstallDelete]
; eski Node Patron dosyalari (config.json, nssm.exe, bin\cloudflared.exe KALIR - tunel servisi kullanir)
Type: files; Name: "{app}\Patron\server.js"
Type: files; Name: "{app}\Patron\patron-cloud.js"
Type: files; Name: "{app}\Patron\tunnel-watch.js"
Type: files; Name: "{app}\Patron\updater.js"
Type: files; Name: "{app}\Patron\package.json"
Type: files; Name: "{app}\Patron\package-lock.json"
Type: filesandordirs; Name: "{app}\Patron\node_modules"

[Icons]
Name: "{group}\AlfaPOS Kurye Yönetim"; Filename: "https://kuryebulut.ornek-alanadi.com"
Name: "{group}\AlfaPOS Patron"; Filename: "http://127.0.0.1:8787/patron"
Name: "{group}\QR Menü Paneli"; Filename: "https://app.ornek-alanadi.com/qrmenu/"
Name: "{group}\Kurye Servisini Yeniden Kur"; Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\Kurye\install-services.ps1"""
Name: "{group}\Patron Servislerini Yeniden Kur"; Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\Patron\install-services.ps1"""

[Run]
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\Kurye\install-requirements.ps1"""; StatusMsg: "Gereksinimler kuruluyor (Node.js)..."; Flags: waituntilterminated runhidden
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\Patron\install-requirements.ps1"""; StatusMsg: "Gereksinimler kontrol ediliyor (cloudflared, caddy)..."; Flags: waituntilterminated runhidden
Filename: "netsh.exe"; Parameters: "advfirewall firewall add rule name=""AlfaPOS Patron (Panel)"" dir=in action=allow protocol=TCP localport=8787"; Flags: runhidden; StatusMsg: "Güvenlik duvarı kuralları ekleniyor..."
Filename: "netsh.exe"; Parameters: "advfirewall firewall add rule name=""AlfaPOS Patron (Sabit IP HTTPS)"" dir=in action=allow protocol=TCP localport=80,443"; Flags: runhidden
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\Kurye\install-services.ps1"""; StatusMsg: "Kurye Bulut servisi kuruluyor..."; Flags: waituntilterminated
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\Patron\install-services.ps1"""; StatusMsg: "Patron Raporu servisleri kuruluyor..."; Flags: waituntilterminated
Filename: "https://kuryebulut.ornek-alanadi.com"; Description: "Kurye panelini aç"; Flags: postinstall shellexec skipifsilent nowait
Filename: "https://patron2.ornek-alanadi.com"; Description: "Patron / satış özetini aç"; Flags: postinstall shellexec skipifsilent nowait
Filename: "https://app.ornek-alanadi.com/qrmenu/"; Description: "QR Menü panelini aç"; Flags: postinstall shellexec skipifsilent nowait

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\Kurye\remove-services.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveKurye"
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\Patron\kur\kaldir.ps1"" -Silent"; Flags: runhidden waituntilterminated; RunOnceId: "RemovePatronCs"
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\Patron\remove-services.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "RemovePatron"
Filename: "netsh.exe"; Parameters: "advfirewall firewall delete rule name=""AlfaPOS Patron (Panel)"""; Flags: runhidden; RunOnceId: "DelFwPanel"
Filename: "netsh.exe"; Parameters: "advfirewall firewall delete rule name=""AlfaPOS Patron (Sabit IP HTTPS)"""; Flags: runhidden; RunOnceId: "DelFwHttps"

[Code]
var
  DBPage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  DBPage := CreateInputQueryPage(wpSelectDir,
    'SQL Server ve Bulut Bağlantısı',
    'Bu bilgiler HEM Kurye Bulut HEM Patron Raporu için kullanılacak',
    'Aynı SambaPOS veritabanı bilgileri ve TEK aktivasyon anahtarınız yeterli - ' +
    'ikisi de aynı anda kurulup buluta bağlanacak. Aktivasyon anahtarını ' +
    'AlfaPOS Bulut yönetim panelinden aldınız.');
  DBPage.Add('SQL Server adresi  (ör: localhost veya DESKTOP-ADI):', False);
  DBPage.Add('Veritabanı adı:', False);
  DBPage.Add('SQL kullanıcı adı  (boş = Windows kimlik doğrulama):', False);
  DBPage.Add('SQL şifresi:', True);
  DBPage.Add('Bulut aktivasyon anahtarı:', False);

  DBPage.Values[0] := 'localhost';
  DBPage.Values[1] := 'SAMBAPOS5';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  { Her iki config.json da zaten varsa (guncelleme kurulumu) tekrar sorma. }
  if (PageID = DBPage.ID) and FileExists(ExpandConstant('{app}\Kurye\config.json')) and FileExists(ExpandConstant('{app}\Patron\config.json')) then
    Result := True;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = DBPage.ID then
  begin
    if Trim(DBPage.Values[0]) = '' then
    begin
      MsgBox('SQL sunucu adresi boş bırakılamaz.', mbError, MB_OK);
      Result := False;
    end
    else if Trim(DBPage.Values[1]) = '' then
    begin
      MsgBox('Veritabanı adı boş bırakılamaz.', mbError, MB_OK);
      Result := False;
    end
    else if Trim(DBPage.Values[4]) = '' then
    begin
      MsgBox('Bulut aktivasyon anahtarı boş bırakılamaz - yönetim panelinden alın.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

function JsonEscape(S: String): String;
begin
  StringChangeEx(S, '\', '\\', True);
  StringChangeEx(S, '"', '\"', True);
  Result := S;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  KuryeConfigPath, PatronConfigPath: String;
  KuryeJson, PatronJson: String;
begin
  if CurStep = ssPostInstall then
  begin
    KuryeConfigPath := ExpandConstant('{app}\Kurye\config.json');
    if not FileExists(KuryeConfigPath) then
    begin
      KuryeJson :=
        '{' + #13#10 +
        '  "server": "' + JsonEscape(DBPage.Values[0]) + '",' + #13#10 +
        '  "database": "' + JsonEscape(DBPage.Values[1]) + '",' + #13#10 +
        '  "user": "' + JsonEscape(DBPage.Values[2]) + '",' + #13#10 +
        '  "password": "' + JsonEscape(DBPage.Values[3]) + '",' + #13#10 +
        '  "options": {' + #13#10 +
        '    "encrypt": false,' + #13#10 +
        '    "trustServerCertificate": true' + #13#10 +
        '  },' + #13#10 +
        '  "activationKey": "' + JsonEscape(Trim(DBPage.Values[4])) + '",' + #13#10 +
        '  "cloudServerUrl": "https://app.ornek-alanadi.com"' + #13#10 +
        '}';
      SaveStringToFile(KuryeConfigPath, KuryeJson, False);
    end;

    PatronConfigPath := ExpandConstant('{app}\Patron\config.json');
    if not FileExists(PatronConfigPath) then
    begin
      PatronJson :=
        '{' + #13#10 +
        '  "appName": "AlfaPOS Patron",' + #13#10 +
        '  "server": "' + JsonEscape(DBPage.Values[0]) + '",' + #13#10 +
        '  "database": "' + JsonEscape(DBPage.Values[1]) + '",' + #13#10 +
        '  "user": "' + JsonEscape(DBPage.Values[2]) + '",' + #13#10 +
        '  "password": "' + JsonEscape(DBPage.Values[3]) + '",' + #13#10 +
        '  "options": {' + #13#10 +
        '    "encrypt": false,' + #13#10 +
        '    "trustServerCertificate": true' + #13#10 +
        '  },' + #13#10 +
        '  "port": 8787,' + #13#10 +
        '  "cloudActivationKey": "' + JsonEscape(Trim(DBPage.Values[4])) + '",' + #13#10 +
        '  "cloudServerUrl": "https://app.ornek-alanadi.com"' + #13#10 +
        '}';
      SaveStringToFile(PatronConfigPath, PatronJson, False);
    end;
  end;
end;
