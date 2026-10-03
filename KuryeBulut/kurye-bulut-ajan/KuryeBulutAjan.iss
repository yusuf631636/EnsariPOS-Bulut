; AlfaPOS Kurye Bulut - Inno Setup 6 ile kurulum programi uretir.
; Musterinin bilgisayarina kurulan TEK sey budur: web sunucusu YOK, tunel YOK -
; sadece SambaPOS'u okuyup buluta WebSocket ile baglanan tek bir servis.
#define AppName "AlfaPOS Kurye Bulut"
#define AppVersion "1.4.0"
#define AppPublisher "AlfaPOS"
#define AppExeName "KuryeBulutAjan"

[Setup]
AppId={{9F3C2A11-7B4E-4A9D-8C1F-KURYEBULUT001}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\EnsariPOS\KuryeBulutAjan
OutputDir=dist
OutputBaseFilename=KuryeBulutAjanSetup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
SetupIconFile=assets\alfapos.ico
UninstallDisplayIcon={app}\assets\alfapos.ico

[Files]
Source: "agent.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "sql.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "sambapos.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "updater.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "menu-sambapos.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "menu-agent.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "menu-push-once.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "Menu-Gonder.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "package-lock.json"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "nssm.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "install-requirements.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "install-services.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "remove-services.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "Servisi-Yeniden-Kur.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "Servisi-Durdur.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "config.example.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "assets\*"; DestDir: "{app}\assets"; Flags: ignoreversion recursesubdirs createallsubdirs

[Tasks]
Name: "desktopicon"; Description: "Masaüstüne kısayol oluştur"; GroupDescription: "Ek kısayollar:"

[Icons]
Name: "{group}\Servisi Yeniden Kur"; Filename: "{app}\Servisi-Yeniden-Kur.cmd"; WorkingDir: "{app}"
Name: "{group}\Servisi Durdur"; Filename: "{app}\Servisi-Durdur.cmd"; WorkingDir: "{app}"
Name: "{group}\Menüyü Buluta Gönder"; Filename: "{app}\Menu-Gonder.bat"; WorkingDir: "{app}"
Name: "{autodesktop}\Kurye Bulut - Servisi Yeniden Kur"; Filename: "{app}\Servisi-Yeniden-Kur.cmd"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{autodesktop}\Kurye Bulut - Servisi Durdur"; Filename: "{app}\Servisi-Durdur.cmd"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{autodesktop}\Kurye Bulut - Menüyü Buluta Gönder"; Filename: "{app}\Menu-Gonder.bat"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\install-requirements.ps1"""; StatusMsg: "Gereksinimler kuruluyor (Node.js)..."; Flags: waituntilterminated runhidden
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\install-services.ps1"""; StatusMsg: "Servis kuruluyor ve başlatılıyor..."; Flags: waituntilterminated
Filename: "https://app.ornek-alanadi.com/customer"; Description: "Müşteri (Restoran) panelini aç"; Flags: postinstall shellexec skipifsilent nowait
Filename: "https://app.ornek-alanadi.com/courier"; Description: "Kurye panelini aç"; Flags: postinstall shellexec skipifsilent nowait

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\remove-services.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveServices"

[Code]
var
  DBPage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  DBPage := CreateInputQueryPage(wpSelectDir,
    'SQL Server ve Bulut Bağlantısı',
    'SambaPOS veritabanı bilgileri ve bulut aktivasyon anahtarınız',
    'Bu bilgiler kurulum sonunda config.json dosyasına otomatik yazılacak. ' +
    'Aktivasyon anahtarını AlfaPOS Bulut yönetim panelinden aldınız.');
  DBPage.Add('SQL Server adresi  (ör: DESKTOP-ADI veya localhost):', False);
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
  if (PageID = DBPage.ID) and FileExists(ExpandConstant('{app}\config.json')) then
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
  ConfigPath: String;
  JsonContent: String;
begin
  if CurStep = ssPostInstall then
  begin
    ConfigPath := ExpandConstant('{app}\config.json');
    if not FileExists(ConfigPath) then
    begin
      JsonContent :=
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
      SaveStringToFile(ConfigPath, JsonContent, False);
    end;
  end;
end;
