// FiveM Texture Optimizer - local web UI server (zero npm dependencies)
// Wraps the optimize.js engine in a friendly browser page so a whole team can
// use it without touching the command line. Runs on http://localhost:3001
//
//   node server.js
//
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const { spawnSync, spawn } = require('node:child_process');

const E = require('./optimize.js'); // the shared engine

const PORT = process.env.PORT || 3001;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');

// ---------- helpers ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.png': 'image/png',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// Read just the header of an image (fast) plus its real size on disk.
function fastInfo(file) {
  let fd, size;
  try {
    size = fs.statSync(file).size;
    fd = fs.openSync(file, 'r');
    const len = Math.min(size, 65536);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 0);
    const info = E.readImageInfo(file, buf);
    return info ? { info, size } : null;
  } catch { return null; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}

// Turn raw request options into resolved engine options + validation.
function buildOpts(q) {
  const type = ['cars', 'clothing', 'mlo', 'auto'].includes(q.type) ? q.type : 'auto';
  const format = ['BC1', 'BC3', 'BC7'].includes(q.format) ? q.format : null;
  const max = q.max ? parseInt(q.max, 10) : null;
  const aggressive = q.aggressive === true || q.aggressive === 'true' || q.aggressive === '1';
  const skipLiveries = !(q.skipLiveries === 'false' || q.skipLiveries === false);
  return E.resolveOpts({ type, format, max: Number.isFinite(max) ? max : null, aggressive, skipLiveries });
}

// Scan a folder and build the list of jobs + YTD report. Shared by both endpoints.
function scan(folder, opts) {
  const files = E.walk(folder, []);
  const { images, ytds } = E.classify(files);

  const jobs = [];
  for (const f of images) {
    const r = fastInfo(f);
    if (!r || !r.info.width || !r.info.height) continue;
    const p = E.plan(f, r.info, opts);
    jobs.push({
      file: f,
      rel: path.relative(folder, f),
      cur: `${r.info.width}x${r.info.height}`,
      tgt: `${p.tw}x${p.th}`,
      fmt: p.fmt,
      reasons: p.reasons,
      size: r.size,
      skip: p.skip,
    });
  }
  const todo = jobs.filter(j => !j.skip);
  const liveries = jobs.filter(j => j.skip && j.reasons.some(r => r.startsWith('livery'))).length;

  const ytdList = ytds.map(f => {
    let s = 0; try { s = fs.statSync(f).size; } catch {}
    return { name: path.relative(folder, f), size: s };
  }).sort((a, b) => b.size - a.size);
  const ytdTotal = ytdList.reduce((a, b) => a + b.size, 0);

  return { jobs, todo, skipped: jobs.length - todo.length, liveries, ytdList, ytdTotal };
}

// ---------- routes ----------
async function handleScan(req, res) {
  const q = await readBody(req);
  const folder = (q.folder || '').trim();
  if (!folder) return sendJson(res, 400, { error: 'Please enter a folder path.' });
  let st;
  try { st = fs.statSync(folder); } catch { return sendJson(res, 400, { error: 'Folder not found: ' + folder }); }
  if (!st.isDirectory()) return sendJson(res, 400, { error: 'That path is not a folder.' });

  const opts = buildOpts(q);
  const { jobs, todo, skipped, liveries, ytdList, ytdTotal } = scan(folder, opts);
  const totalToOpt = todo.reduce((a, b) => a + b.size, 0);
  const ytdReady = !!E.findYtdTool();

  // How much of the pack is already in good shape (drives the gauge).
  const found = jobs.length;
  const optimisedPct = found ? Math.round(((found - todo.length) / found) * 100)
                             : (ytdList.length ? 0 : 100);

  // Estimate the folder's texture weight now vs after optimizing, and turn that
  // into a rough "how long it takes to load into FiveM" number. LOAD_MBPS is an
  // approximate rate for streaming assets into the game (disk + decompress + VRAM).
  const LOAD_MBPS = 50;
  const looseNow = jobs.reduce((a, b) => a + b.size, 0);
  let looseAfter = 0;
  for (const j of jobs) {
    if (j.skip) { looseAfter += j.size; continue; } // kept as-is (already good / livery)
    const [tw, th] = j.tgt.split('x').map(Number);
    const bpp = j.fmt === 'BC1' ? 0.5 : 1;           // BC1 = 0.5 B/px, BC3/BC7 = 1 B/px
    looseAfter += Math.round(tw * th * bpp * 4 / 3); // + ~1/3 for the mip chain
  }
  const currentBytes = looseNow + ytdTotal;
  const projectedBytes = looseAfter + (ytdReady ? Math.round(ytdTotal * 0.55) : ytdTotal);

  sendJson(res, 200, {
    folder,
    settings: { type: opts.type, maxSize: opts.maxSize, format: opts.format, presetLabel: opts.presetLabel },
    counts: { found: jobs.length, toOptimize: todo.length, alreadyGood: skipped, liveries },
    totalToOptimizeBytes: totalToOpt,
    optimisedPct,
    load: { mbps: LOAD_MBPS, currentBytes, projectedBytes },
    jobs: todo,
    ytd: { count: ytdList.length, totalBytes: ytdTotal, files: ytdList.slice(0, 50) },
    platform: process.platform,
    texconvReady: fs.existsSync(E.TEXCONV),
    ytdToolReady: ytdReady,
  });
}

// ---------- settings (YTD tool path) ----------
function handleGetSettings(req, res) {
  const cfg = E.loadConfig();
  const found = E.findYtdTool(cfg);
  sendJson(res, 200, { toolPath: cfg.ytd.toolPath || '', detected: found || '', ready: !!found });
}

async function handleSetSettings(req, res) {
  const q = await readBody(req);
  const p = (q.toolPath || '').trim().replace(/^["']|["']$/g, '');
  if (p) {
    let ok = false;
    try { ok = fs.existsSync(p) && fs.statSync(p).isFile(); } catch {}
    if (!ok) return sendJson(res, 400, { error: 'That file does not exist: ' + p });
  }
  const cfg = E.loadConfig();
  cfg.ytd.toolPath = p;
  try { E.saveConfig(cfg); } catch (e) { return sendJson(res, 500, { error: 'Could not save settings: ' + e.message }); }
  const found = E.findYtdTool(cfg);
  sendJson(res, 200, { toolPath: p, detected: found || '', ready: !!found });
}

// SSE: live progress while optimizing.
function handleOptimizeStream(req, res, q) {
  const folder = (q.folder || '').trim();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  let st;
  try { st = fs.statSync(folder); } catch { st = null; }
  if (!st || !st.isDirectory()) { send({ type: 'error', message: 'Folder not found.' }); return res.end(); }

  const opts = buildOpts(q);
  const backup = !(q.backup === 'false' || q.backup === false);
  const replace = q.replace === 'true' || q.replace === true;
  const doYtd = q.ytd === 'true' || q.ytd === true;

  const { todo } = scan(folder, opts);

  // Gather .ytd files if the user asked to optimize the packs too.
  const cfg = E.loadConfig();
  const ytdTool = doYtd ? E.findYtdTool(cfg) : null;
  const ytds = ytdTool ? E.classify(E.walk(folder, [])).ytds : [];
  if (doYtd && !ytdTool) {
    send({ type: 'note', message: 'YTD tool (CodeWalker / GTAUtil) is not set up, so .ytd packs were skipped. Set it in Settings.' });
  }

  const totalTasks = todo.length + ytds.length;
  if (totalTasks === 0) { send({ type: 'done', ok: 0, fail: 0, before: 0, after: 0 }); return res.end(); }

  if (!E.ensureTexconv()) {
    send({ type: 'error', message: process.platform === 'win32'
      ? 'Could not download texconv.exe. Check your internet, or place texconv.exe in the tool\'s bin folder.'
      : 'texconv.exe only runs on Windows. Run this tool on your Windows/FiveM machine to apply changes.' });
    return res.end();
  }

  send({ type: 'start', total: totalTasks });

  let ok = 0, fail = 0, before = 0, after = 0, done = 0, i = 0, y = 0;
  const ytdOpts = { ...opts, backup };

  // Phase 1: loose textures (one per tick), then Phase 2: .ytd packs.
  const step = () => {
    if (i < todo.length) {
      const j = todo[i++]; done++;
      const dir = path.dirname(j.file);
      const isDDS = path.extname(j.file).toLowerCase() === '.dds';
      const outDds = path.join(dir, path.basename(j.file, path.extname(j.file)) + '.dds');
      if (backup) E.backup(folder, j.file);
      const r = E.runTexconv(j.file, { tw: parseInt(j.tgt), th: parseInt(j.tgt.split('x')[1]), fmt: j.fmt }, dir);
      if (!r.ok) {
        fail++;
        send({ type: 'file', ok: false, rel: j.rel, message: r.msg, index: done, total: totalTasks });
      } else {
        let newSize = 0; try { newSize = fs.statSync(outDds).size; } catch {}
        before += j.size; after += newSize; ok++;
        if (!isDDS && replace) { try { fs.unlinkSync(j.file); } catch {} }
        send({ type: 'file', ok: true, rel: j.rel, before: j.size, after: newSize,
               kept: (!isDDS && !replace), index: done, total: totalTasks });
      }
      return setImmediate(step);
    }

    if (y < ytds.length) {
      const yf = ytds[y++]; done++;
      const rel = path.relative(folder, yf);
      send({ type: 'ytd-start', rel, index: done, total: totalTasks });
      const r = E.optimizeYtd(folder, yf, ytdOpts, cfg, ytdTool,
        (txt) => send({ type: 'ytd-log', rel, message: txt }));
      if (!r.ok) {
        fail++;
        send({ type: 'ytd', ok: false, rel, message: r.msg, index: done, total: totalTasks });
      } else {
        before += r.before; after += r.after; ok++;
        send({ type: 'ytd', ok: true, rel, before: r.before, after: r.after,
               changed: r.changed, textures: r.total, index: done, total: totalTasks });
      }
      return setImmediate(step);
    }

    send({ type: 'done', ok, fail, before, after });
    return res.end();
  };
  setImmediate(step);
}

function serveStatic(req, res, pathname) {
  let file = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (req.method === 'POST' && pathname === '/api/scan') return handleScan(req, res);
  if (req.method === 'GET' && pathname === '/api/settings') return handleGetSettings(req, res);
  if (req.method === 'POST' && pathname === '/api/settings') return handleSetSettings(req, res);
  if (req.method === 'GET' && pathname === '/api/optimize-stream') return handleOptimizeStream(req, res, parsed.query);
  if (req.method === 'GET') return serveStatic(req, res, pathname);

  res.writeHead(404); res.end('Not found');
});

// --- Opening the app ---
// "--app" launches a dedicated desktop window using the Edge/Chrome engine that
// ships with Windows (looks and behaves like a native app - no browser tabs or
// address bar). Closing that window quits the program. Without "--app" it just
// opens the default web browser.
const APP_MODE = process.argv.includes('--app');

function findAppBrowser() {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pfx = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const la = process.env['LOCALAPPDATA'] || '';
  const cands = [
    [pf, 'Microsoft\\Edge\\Application\\msedge.exe'],
    [pfx, 'Microsoft\\Edge\\Application\\msedge.exe'],
    [pf, 'Google\\Chrome\\Application\\chrome.exe'],
    [pfx, 'Google\\Chrome\\Application\\chrome.exe'],
    [la, 'Google\\Chrome\\Application\\chrome.exe'],
  ].map(([a, b]) => (a ? path.join(a, b) : null));
  for (const c of cands) { try { if (c && fs.existsSync(c)) return c; } catch {} }
  return null;
}

function openInWindow(url) {
  const exe = findAppBrowser();
  if (!exe) return false;
  const child = spawn(exe, [
    '--app=' + url,
    '--window-size=1200,900',
    '--user-data-dir=' + path.join(ROOT, '.app_profile'), // own window + lifetime
    '--no-first-run', '--no-default-browser-check',
  ], { stdio: 'ignore' });
  // When the user closes the app window, shut the whole thing down.
  child.on('exit', () => { try { server.close(); } catch {} process.exit(0); });
  child.on('error', () => {});
  return true;
}

function openInBrowser(url) {
  try { spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' }); } catch {}
}

// If it's already running (double-clicked twice), just open a window and leave.
server.on('error', (e) => {
  const url = 'http://localhost:' + PORT;
  if (e.code === 'EADDRINUSE') {
    console.log('  Already running - opening the app window...');
    if (!(APP_MODE && process.platform === 'win32' && openInWindow(url))) openInBrowser(url);
    setTimeout(() => process.exit(0), 400);
  } else {
    console.error('  Could not start: ' + e.message);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  const url = 'http://localhost:' + PORT;
  console.log('');
  console.log('  sxn opti is running.');
  if (process.platform === 'win32' && APP_MODE) {
    console.log('  Opening the app window... (you can minimize this window)');
    if (!openInWindow(url)) {
      console.log('  (No Edge/Chrome found for the app window - opening your browser instead.)');
      openInBrowser(url);
      console.log('  Keep this window open while you use it. Close it to stop.');
    }
  } else if (process.platform === 'win32') {
    console.log('  Opening in your browser:  ' + url);
    openInBrowser(url);
    console.log('  Keep this window open while you use it. Close it to stop.');
  } else {
    console.log('  Open this in your browser:  ' + url);
  }
});
