// npm run desktop:install  - build the Tracker app (desktop/app, needs the .NET 8 SDK), add a Start menu shortcut to it,
//                            and start the tray when you log on to Windows.
// npm run desktop:remove   - remove the shortcuts.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  console.log('The tray and shortcuts are for Windows. Elsewhere, run npm start.');
  process.exit(0);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const vbs = path.join(root, 'desktop', 'start-tray.vbs');
const appDir = path.join(root, 'desktop', 'app');
const exe = path.join(appDir, 'publish', 'Tracker.exe');
const programs = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
const desktopDir = process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Desktop') : null;
const shortcuts = [
  { file: path.join(programs, 'Tracker.lnk'), args: '/open', what: 'Start menu shortcut', app: true },
  ...(desktopDir ? [{ file: path.join(desktopDir, 'Tracker.lnk'), args: '/open', what: 'Desktop shortcut', app: true }] : []),
  { file: path.join(programs, 'Startup', 'Tracker.lnk'), args: '', what: 'start at logon' },
];

/** Builds Tracker.exe. Without the .NET SDK, the Start menu shortcut falls back to the tray opening an Edge window. */
function buildApp() {
  const r = spawnSync('dotnet', ['publish', '-c', 'Release', '-o', 'publish', '--nologo', '-v', 'q'], { cwd: appDir, stdio: 'inherit', shell: true });
  if (r.status === 0 && fs.existsSync(exe)) return true;
  console.log('Could not build the Tracker app (it needs the .NET 8 SDK). The Start menu shortcut opens an Edge window instead.');
  return false;
}

function makeShortcut(file, args, useApp) {
  const target = useApp
    ? ['$s.TargetPath = $env:EXE', '$s.Arguments = ""', '$s.WorkingDirectory = Split-Path $env:EXE', '$s.IconLocation = "$env:EXE,0"']
    : [
        '$s.TargetPath = "$env:WINDIR\\System32\\wscript.exe"',
        '$s.Arguments = "`"$env:VBS`" $env:ARGS"',
        '$s.WorkingDirectory = $env:ROOT',
        '$s.IconLocation = "$env:WINDIR\\System32\\imageres.dll,109"',
      ];
  const ps = ['$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK)', ...target, '$s.Description = "Tracker"', '$s.Save()'].join('; ');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
    env: { ...process.env, LNK: file, VBS: vbs, ARGS: args, ROOT: root, EXE: exe },
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error(`Could not create ${file}`);
}

const mode = process.argv[2];
if (mode === 'install') {
  const hasApp = buildApp();
  for (const s of shortcuts) {
    makeShortcut(s.file, s.args, hasApp && s.app);
    console.log(`Added ${s.what}: ${s.file}`);
  }
  console.log('Start it now from the Start menu (Tracker), or run: wscript desktop\\start-tray.vbs /open');
  if (hasApp) console.log('To pin it to the taskbar: open Tracker, right-click its taskbar icon and choose "Pin to taskbar".');
} else if (mode === 'remove') {
  for (const s of shortcuts) {
    if (fs.existsSync(s.file)) fs.rmSync(s.file);
    console.log(`Removed ${s.what}`);
  }
} else {
  console.log('Use: node scripts/desktop.mjs install | remove');
  process.exit(1);
}
