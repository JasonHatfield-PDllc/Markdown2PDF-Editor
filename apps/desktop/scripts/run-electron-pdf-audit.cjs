/**
 * Build desktop → preview on :4174 → Electron printToPDF audit → exit code.
 */
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '../../..');
const PORT = 4174;
const HOST = '127.0.0.1';
const ELECTRON = require('electron');

function waitForUrl(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error(`Timeout waiting for ${url}`));
        else setTimeout(tick, 400);
      });
    };
    tick();
  });
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...opts,
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`));
    });
    child.on('error', reject);
  });
}

async function main() {
  await run('npm', ['run', 'build:desktop']);

  const preview = spawn(
    'npm',
    ['run', 'preview', '-w', 'markdown2pdf-desktop', '--', '--host', HOST, '--port', String(PORT)],
    { cwd: ROOT, stdio: 'pipe', shell: true },
  );

  let previewLog = '';
  preview.stdout?.on('data', (d) => {
    previewLog += d.toString();
  });
  preview.stderr?.on('data', (d) => {
    previewLog += d.toString();
  });

  const killPreview = () => {
    if (preview.killed || preview.exitCode != null) return;
    if (process.platform === 'win32' && preview.pid) {
      try {
        spawn('taskkill', ['/pid', String(preview.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        /* ignore */
      }
    } else {
      try {
        preview.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
  };

  try {
    await waitForUrl(`http://${HOST}:${PORT}/`, 120_000);
    await run(ELECTRON, [path.join(__dirname, 'electron-pdf-audit.cjs')], {
      env: { ...process.env, M2PDF_AUDIT_URL: `http://${HOST}:${PORT}/` },
      shell: false,
    });
  } finally {
    killPreview();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
