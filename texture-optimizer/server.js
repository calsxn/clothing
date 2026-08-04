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
const { spawnSync } = require('node:child_process');

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
  return E.resolveOpts({ type, format, max: Number.isFinite(max) ? max : null, aggressive });
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

  const ytdList = ytds.map(f => {
    let s = 0; try { s = fs.statSync(f).size; } catch {}
    return { name: path.relative(folder, f), size: s };
  }).sort((a, b) => b.size - a.size);
  const ytdTotal = ytdList.reduce((a, b) => a + b.size, 0);

  return { jobs, todo, skipped: jobs.length - todo.length, ytdList, ytdTotal };
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
  const { jobs, todo, skipped, ytdList, ytdTotal } = scan(folder, opts);
  const totalToOpt = todo.reduce((a, b) => a + b.size, 0);

  sendJson(res, 200, {
    folder,
    settings: { type: opts.type, maxSize: opts.maxSize, format: opts.format, presetLabel: opts.presetLabel },
    counts: { found: jobs.length, toOptimize: todo.length, alreadyGood: skipped },
    totalToOptimizeBytes: totalToOpt,
    jobs: todo,
    ytd: { count: ytdList.length, totalBytes: ytdTotal, files: ytdList.slice(0, 50) },
    platform: process.platform,
    texconvReady: fs.existsSync(E.TEXCONV),
  });
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

  const { todo } = scan(folder, opts);
  if (!todo.length) { send({ type: 'done', ok: 0, fail: 0, before: 0, after: 0 }); return res.end(); }

  if (!E.ensureTexconv()) {
    send({ type: 'error', message: process.platform === 'win32'
      ? 'Could not download texconv.exe. Check your internet, or place texconv.exe in the tool\'s bin folder.'
      : 'texconv.exe only runs on Windows. Run this tool on your Windows/FiveM machine to apply changes.' });
    return res.end();
  }

  send({ type: 'start', total: todo.length });

  let ok = 0, fail = 0, before = 0, after = 0, i = 0;
  // Process one file per tick so progress streams smoothly to the browser.
  const step = () => {
    if (i >= todo.length) {
      send({ type: 'done', ok, fail, before, after });
      return res.end();
    }
    const j = todo[i++];
    const dir = path.dirname(j.file);
    const isDDS = path.extname(j.file).toLowerCase() === '.dds';
    const outDds = path.join(dir, path.basename(j.file, path.extname(j.file)) + '.dds');

    if (backup) E.backup(folder, j.file);
    const r = E.runTexconv(j.file, { tw: parseInt(j.tgt), th: parseInt(j.tgt.split('x')[1]), fmt: j.fmt }, dir);

    if (!r.ok) {
      fail++;
      send({ type: 'file', ok: false, rel: j.rel, message: r.msg, index: i, total: todo.length });
    } else {
      let newSize = 0; try { newSize = fs.statSync(outDds).size; } catch {}
      before += j.size; after += newSize; ok++;
      if (!isDDS && replace) { try { fs.unlinkSync(j.file); } catch {} }
      send({
        type: 'file', ok: true, rel: j.rel, before: j.size, after: newSize,
        kept: (!isDDS && !replace), index: i, total: todo.length,
      });
    }
    setImmediate(step);
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
  if (req.method === 'GET' && pathname === '/api/optimize-stream') return handleOptimizeStream(req, res, parsed.query);
  if (req.method === 'GET') return serveStatic(req, res, pathname);

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log('');
  console.log('  FiveM Texture Optimizer UI is running.');
  console.log('  Open this in your browser:  http://localhost:' + PORT);
  console.log('');
  console.log('  Keep this window open while you use it. Close it to stop.');
  // Best-effort: open the default browser on Windows.
  if (process.platform === 'win32') {
    try { spawnSync('cmd', ['/c', 'start', '', 'http://localhost:' + PORT], { stdio: 'ignore' }); } catch {}
  }
});
