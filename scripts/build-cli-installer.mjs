import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const cliExe = path.join(root, 'release', 'agent-team-cli.exe');
const nsiScript = path.join(root, 'build', 'cli-installer.nsi');

if (!fs.existsSync(cliExe)) {
  console.error('Error: release/agent-team-cli.exe not found. Run `npm run build:cli` first.');
  process.exit(1);
}

function findMakeNsis() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const ebCache = path.join(localAppData, 'electron-builder', 'Cache');
  const candidates = [
    'C:\\Program Files (x86)\\NSIS\\makensis.exe',
    'C:\\Program Files\\NSIS\\makensis.exe',
  ];

  if (fs.existsSync(ebCache)) {
    const walk = (dir, depth = 0) => {
      if (depth > 3) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, depth + 1);
        else if (entry.name.toLowerCase() === 'makensis.exe') candidates.unshift(full);
      }
    };
    walk(ebCache);
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'makensis.exe';
}

const makensis = findMakeNsis();
console.log(`Building Pure CLI Installer with ${makensis}...`);

const res = spawnSync(
  makensis,
  ['/INPUTCHARSET', 'UTF8', `/DAPP_VERSION=${pkg.version}`, nsiScript],
  { cwd: root, stdio: 'inherit' }
);

if (res.status !== 0) {
  console.error(`makensis failed with exit code ${res.status}`);
  process.exit(res.status || 1);
}

const outPath = path.join(root, 'release', `Agent_Team-CLI-Setup-v${pkg.version}.exe`);
if (fs.existsSync(outPath)) {
  const mb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
  console.log(`Successfully built Pure CLI Installer: ${outPath} (${mb} MB)`);
}
