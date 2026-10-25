# Tracker tray: runs the tracker server hidden, shows a tray icon, and notifies you when the agent needs you.
# Started by desktop\start-tray.vbs (at logon, or from the Start menu). -Open also opens the tracker window.
param([switch]$Open)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$Root = Split-Path -Parent $PSScriptRoot
$Port = if ($env:TRACKER_PORT) { [int]$env:TRACKER_PORT } else { 4317 }
$Url = "http://127.0.0.1:$Port"
$DataDir = Join-Path $env:APPDATA 'Tracker'
New-Item -ItemType Directory -Force $DataDir | Out-Null
$Log = Join-Path $DataDir 'server.log'

function Open-Window {
  # The Tracker app (desktop\app, built by npm run desktop:install) has its own taskbar icon; Edge app mode is the fallback.
  $app = Join-Path $PSScriptRoot 'app\publish\Tracker.exe'
  if (Test-Path $app) { Start-Process $app; return }
  $edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($edge) { Start-Process $edge "--app=$Url" } else { Start-Process $Url }
}

# One tray per user. A second start just opens the window.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\TrackerTray', [ref]$created)
if (-not $created) { Open-Window; exit 0 }

function Test-Server {
  try { Invoke-RestMethod "$Url/api/agent/status" -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}

$script:server = $null
function Start-Server {
  if (Test-Server) { return }
  # start.mjs rebuilds the web app if its sources changed, then runs the server.
  $script:server = Start-Process node -ArgumentList '"scripts\start.mjs"', '--no-open' -WorkingDirectory $Root `
    -WindowStyle Hidden -PassThru -RedirectStandardOutput $Log -RedirectStandardError "$Log.err"
}
function Stop-Server {
  if ($script:server -and -not $script:server.HasExited) { & taskkill /PID $script:server.Id /T /F | Out-Null }
  $script:server = $null
}

# The icon: the tracker's blue tick, drawn here so there's no image file to ship.
function New-TrackerIcon {
  $bmp = New-Object System.Drawing.Bitmap 32, 32
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $r = 12
  $path.AddArc(0, 0, $r, $r, 180, 90); $path.AddArc(31 - $r, 0, $r, $r, 270, 90)
  $path.AddArc(31 - $r, 31 - $r, $r, $r, 0, 90); $path.AddArc(0, 31 - $r, $r, $r, 90, 90); $path.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(52, 81, 209))), $path)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 4
  $g.DrawLines($pen, [System.Drawing.Point[]]@((New-Object System.Drawing.Point 8, 17), (New-Object System.Drawing.Point 13, 22), (New-Object System.Drawing.Point 24, 10)))
  $g.Dispose()
  [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = New-TrackerIcon
$tray.Text = 'Tracker'
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$menu.Items.Add('Open Tracker', $null, { Open-Window }) | Out-Null
$menu.Items.Add('Open agent folder', $null, {
  try { Invoke-RestMethod "$Url/api/agent/open-folder" -Method Post | Out-Null } catch { Start-Process (Join-Path $env:USERPROFILE 'Tracker\agent') }
}) | Out-Null
$menu.Items.Add('-') | Out-Null
$menu.Items.Add('Restart server', $null, { Stop-Server; Start-Sleep -Milliseconds 500; Start-Server }) | Out-Null
$menu.Items.Add('Quit', $null, { $timer.Stop(); Stop-Server; $tray.Visible = $false; [System.Windows.Forms.Application]::Exit() }) | Out-Null
$tray.ContextMenuStrip = $menu
$tray.add_MouseClick({ param($s, $e) if ($e.Button -eq 'Left') { Open-Window } })
$tray.add_BalloonTipClicked({ Open-Window })

Start-Server
if ($Open) {
  for ($i = 0; $i -lt 40 -and -not (Test-Server); $i++) { Start-Sleep -Milliseconds 500 }
  Open-Window
}

# Every 15 s: restart a crashed server, and notify when the agent adds questions or a file waits for review.
$script:last = $null
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 15000
$timer.add_Tick({
  if ($script:server -and $script:server.HasExited -and -not (Test-Server)) { Start-Server; return }
  try {
    $questions = @(Invoke-RestMethod "$Url/api/questions?status=open" -TimeoutSec 3).Count
    $pending = @(Invoke-RestMethod "$Url/api/inbox?status=pending" -TimeoutSec 3).Count
    $replies = @(Invoke-RestMethod "$Url/api/messages?status=handled" -TimeoutSec 3 | Where-Object { $_.author -eq 'agent' }).Count
  } catch { return }
  $tray.Text = "Tracker: $questions question(s), $pending to review"
  if ($script:last) {
    $news = @()
    if ($questions -gt $script:last.q) { $news += "The agent asked $($questions - $script:last.q) new question(s)." }
    if ($pending -gt $script:last.p) { $news += "$($pending - $script:last.p) update file(s) wait for your review." }
    if ($replies -gt $script:last.r) { $news += "The agent replied to $($replies - $script:last.r) of your notes." }
    if ($news.Count) { $tray.ShowBalloonTip(8000, 'Tracker', ($news -join ' '), 'Info') }
  }
  $script:last = @{ q = $questions; p = $pending; r = $replies }
})
$timer.Start()

[System.Windows.Forms.Application]::Run()
$mutex.ReleaseMutex()
