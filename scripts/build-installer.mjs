// scripts/build-installer.mjs - Builds the standard Windows setup wizard (Tracker-Setup.exe)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function step(title) {
  console.log(`\n\x1b[36m=== ${title} ===\x1b[0m`);
}

function run(cmd, args, description) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    console.error(`\x1b[31mError during: ${description}\x1b[0m`);
    process.exit(result.status ?? 1);
  }
}

function findISCC() {
  const candidatePaths = [
    'iscc',
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env['ProgramFiles(x86)'] ?? '', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env.ProgramFiles ?? '', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Antigravity IDE', 'resources', 'app', 'node_modules', 'innosetup', 'bin', 'ISCC.exe')
  ];

  for (const p of candidatePaths) {
    if (p === 'iscc') {
      const check = spawnSync('where', ['iscc'], { shell: true, stdio: 'pipe' });
      if (check.status === 0) return 'iscc';
    } else if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

console.log('\x1b[32m====================================================\x1b[0m');
console.log('\x1b[32m      Building Windows Setup Wizard (.exe)          \x1b[0m');
console.log('\x1b[32m====================================================\x1b[0m');

// 1. Build frontend
step('1. Building Frontend (Vite)');
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], 'Building web frontend');

// 2. Publish Desktop executable
step('2. Publishing Tracker.exe (.NET)');
run('dotnet', ['publish', '-c', 'Release', '-o', 'desktop/app/publish', '--nologo', '-v', 'q', 'desktop/app/Tracker.csproj'], 'Publishing Tracker.exe');

// 3. Locate Inno Setup Compiler
step('3. Locating Inno Setup Compiler (ISCC)');
const iscc = findISCC();
if (!iscc) {
  console.error('\x1b[31mInno Setup 6 (ISCC.exe) was not found.\x1b[0m');
  console.error('Please install Inno Setup 6 via: winget install JRSoftware.InnoSetup');
  process.exit(1);
}
console.log(`Found Inno Setup compiler: ${iscc}`);

// 4. Compile Installer
step('4. Compiling Installer Package');
const issFile = path.join(root, 'desktop', 'installer.iss');
run(iscc, [issFile], 'Compiling Inno Setup script');

step('Done!');
const distDir = path.join(root, 'dist-installer');
if (fs.existsSync(distDir)) {
  const files = fs.readdirSync(distDir).filter(f => f.endsWith('.exe'));
  for (const f of files) {
    const full = path.join(distDir, f);
    const sizeMB = (fs.statSync(full).size / (1024 * 1024)).toFixed(2);
    console.log(`\x1b[32mCreated Installer: ${full} (${sizeMB} MB)\x1b[0m`);
  }
}
