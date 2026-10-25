; Inno Setup Script for Tracker
#define MyAppName "Tracker"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "Robert Built"
#define MyAppExeName "Tracker.exe"

[Setup]
AppId={{8B237F5D-6238-4F44-93C0-B9557D84CA4D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist-installer
OutputBaseFilename=Tracker-Setup-{#MyAppVersion}
SetupIconFile=app\tracker.ico
UninstallDisplayIcon={app}\desktop\app\publish\{#MyAppExeName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "startupentry"; Description: "Start Tracker tray automatically on Windows login"; GroupDescription: "Windows Startup:"

[Files]
; Root configuration and metadata
Source: "..\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\package-lock.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion

; Desktop wrapper and published executable
Source: "app\publish\*"; DestDir: "{app}\desktop\app\publish"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "app\tracker.ico"; DestDir: "{app}\desktop\app"; Flags: ignoreversion
Source: "start-tray.vbs"; DestDir: "{app}\desktop"; Flags: ignoreversion
Source: "tray.ps1"; DestDir: "{app}\desktop"; Flags: ignoreversion

; Server, shared schemas, scripts, and MCP
Source: "..\server\*"; DestDir: "{app}\server"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\shared\*"; DestDir: "{app}\shared"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\scripts\*"; DestDir: "{app}\scripts"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\mcp\*"; DestDir: "{app}\mcp"; Flags: ignoreversion recursesubdirs createallsubdirs

; Built Web UI
Source: "..\web\dist\*"; DestDir: "{app}\web\dist"; Flags: ignoreversion recursesubdirs createallsubdirs

; Node modules
Source: "..\node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: ".bin,*.log"

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\desktop\app\publish\{#MyAppExeName}"; IconFilename: "{app}\desktop\app\tracker.ico"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\desktop\app\publish\{#MyAppExeName}"; IconFilename: "{app}\desktop\app\tracker.ico"; Tasks: desktopicon
Name: "{userstartup}\{#MyAppName}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\desktop\start-tray.vbs"""; IconFilename: "{app}\desktop\app\tracker.ico"; Tasks: startupentry

[Run]
; Run setup script to configure MCP integrations for Antigravity & Claude Code
Filename: "node.exe"; Parameters: """{app}\scripts\antigravity-setup.mjs"" install"; StatusMsg: "Configuring Antigravity MCP integration..."; Flags: runhidden
; Launch app post-install
Filename: "{app}\desktop\app\publish\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "node.exe"; Parameters: """{app}\scripts\uninstall.mjs"""; Flags: runhidden

[Code]
function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  Result := True;
  if not Exec('cmd.exe', '/c where node', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
  begin
    MsgBox('Warning: Node.js (version 20 or higher) was not detected in your PATH.' + #13#10 + #13#10 +
           'Tracker requires Node.js to run its local server.' + #13#10 +
           'You can continue installing now, but please install Node.js from https://nodejs.org before running Tracker.', mbInformation, MB_OK);
  end;
end;
