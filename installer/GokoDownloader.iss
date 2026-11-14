; Goko Downloader native helper installer (per-user, no admin rights)
#ifndef ExtensionId
  #define ExtensionId "ckhglpifnfloifbggnfbgecaeiaacjbf"
#endif
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define HostName "com.goko.downloader"

[Setup]
AppId={{7D1B6E52-3C8A-4F0E-9B47-5A2E8C61D0F3}
AppName=Goko Downloader
AppVersion={#AppVersion}
AppPublisher=Goko
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\GokoDownloader
DisableDirPage=yes
DisableProgramGroupPage=yes
OutputDir=output
OutputBaseFilename=GokoDownloaderSetup
SetupIconFile=goko.ico
UninstallDisplayIcon={app}\GokoHost.exe
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
CloseApplicationsFilter=*.exe

[Languages]
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
turkish.FinishedLabel=Goko Downloader yardımcı uygulaması bilgisayarınıza kuruldu.%n%nTarayıcınızı yeniden başlatın ve Goko Downloader eklentisini kullanın.
english.FinishedLabel=The Goko Downloader helper has been installed.%n%nRestart your browser and use the Goko Downloader extension.

[InstallDelete]
; 1.0.0 pre-release builds named the helper host.exe
Type: files; Name: "{app}\host.exe"

[Files]
Source: "..\helper\dist\GokoHost\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\helper\vendor\yt-dlp.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\helper\vendor\ffmpeg.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\helper\vendor\ffprobe.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\helper\vendor\deno.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

[Registry]
Root: HKCU; Subkey: "Software\Google\Chrome\NativeMessagingHosts\{#HostName}"; ValueType: string; ValueName: ""; ValueData: "{app}\{#HostName}.json"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Microsoft\Edge\NativeMessagingHosts\{#HostName}"; ValueType: string; ValueName: ""; ValueData: "{app}\{#HostName}.json"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\{#HostName}"; ValueType: string; ValueName: ""; ValueData: "{app}\{#HostName}.json"; Flags: uninsdeletekey

[UninstallDelete]
Type: files; Name: "{app}\{#HostName}.json"
Type: filesandordirs; Name: "{localappdata}\GokoDownloader"

[Code]
procedure KillHost;
var
  ResultCode: Integer;
begin
  { GokoHost.exe may still be running while the browser is open }
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /T /IM GokoHost.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(500);
end;

{ JSON string escape; non-ASCII as \uXXXX so the file is pure ASCII (valid UTF-8, no BOM issues) }
function JsonEscape(const S: String): String;
var
  I, C: Integer;
begin
  Result := '';
  for I := 1 to Length(S) do
  begin
    C := Ord(S[I]);
    if C = 92 then
      Result := Result + Chr(92) + Chr(92)
    else if C = 34 then
      Result := Result + Chr(92) + Chr(34)
    else if (C < 32) or (C > 126) then
      Result := Result + Chr(92) + 'u' + Lowercase(Format('%.4x', [C]))
    else
      Result := Result + S[I];
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  KillHost;
  Result := '';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Json: String;
begin
  if CurStep = ssPostInstall then
  begin
    Json := '{' + #13#10 +
      '  "name": "{#HostName}",' + #13#10 +
      '  "description": "Goko Downloader native helper",' + #13#10 +
      '  "path": "' + JsonEscape(ExpandConstant('{app}\GokoHost.exe')) + '",' + #13#10 +
      '  "type": "stdio",' + #13#10 +
      '  "allowed_origins": ["chrome-extension://{#ExtensionId}/"]' + #13#10 +
      '}' + #13#10;
    SaveStringToFile(ExpandConstant('{app}\{#HostName}.json'), Json, False);
  end;
end;

function InitializeUninstall(): Boolean;
begin
  KillHost;
  Result := True;
end;
