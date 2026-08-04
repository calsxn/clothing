// FiveM Texture Optimizer - zero-dependency Node.js tool
// Scans a folder for textures used by cars, clothing and MLOs, reports the ones
// that waste VRAM (too big, uncompressed, or missing mipmaps) and rebuilds them
// as properly compressed DDS with a full mip chain using Microsoft's texconv.
//
// Uses only built-in Node modules (fs, path, https, child_process, readline).
// The heavy image work is done by texconv.exe (auto-downloaded on Windows).
//
//   node optimize.js <folder> [options]
//
// Run with --help for the full option list.

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawnSync } = require('node:child_process');

const ROOT = __dirname;
const BIN_DIR = path.join(ROOT, 'bin');
const TEXCONV = path.join(BIN_DIR, 'texconv.exe');
// DirectXTex ships texconv.exe as a release asset. "latest" always resolves.
const TEXCONV_URL = process.env.TEXCONV_URL ||
  'https://github.com/microsoft/DirectXTex/releases/latest/download/texconv.exe';

const IMAGE_EXTS = new Set(['.dds', '.png', '.jpg', '.jpeg', '.tga', '.bmp']);
const UNCOMPRESSED_EXTS = new Set(['.png', '.jpg', '.jpeg', '.tga', '.bmp']);

// ---------- YTD tool (CodeWalker / GTAUtil) ----------
// Optimizing packed .ytd archives (cars/clothing/MLO) needs an external tool
// that can unpack and repack them. GTAUtil (built on CodeWalker's core) has a
// command line that does exactly this. The path and the exact commands are
// configurable in config.json so it keeps working across tool versions.
const CONFIG_PATH = path.join(ROOT, 'config.json');
const DEFAULT_CONFIG = {
  ytd: {
    // Full path to gtautil.exe (or a compatible CodeWalker CLI). Set via the UI.
    toolPath: '',
    // {in}=source .ytd  {outdir}=where to extract   {indir}=folder to pack  {out}=output dir
    extractArgs: ['extractytd', '--input', '{in}', '--output', '{outdir}'],
    createArgs: ['createytd', '--input', '{indir}', '--output', '{outdir}'],
  },
};

function loadConfig() {
  let user = {};
  try { user = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  return { ytd: { ...DEFAULT_CONFIG.ytd, ...(user.ytd || {}) } };
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// Locate a usable YTD tool: configured path first, then env var, then common spots.
function findYtdTool(cfg) {
  cfg = cfg || loadConfig();
  const cands = [
    cfg.ytd && cfg.ytd.toolPath,
    process.env.GTAUTIL, process.env.YTD_TOOL,
    path.join(BIN_DIR, 'gtautil.exe'),
    'C:\\Program Files\\GTAUtil\\gtautil.exe',
    'C:\\GTAUtil\\gtautil.exe',
  ];
  for (const c of cands) {
    try { if (c && fs.existsSync(c) && fs.statSync(c).isFile()) return c; } catch {}
  }
  return null;
}

// ---------- Presets ----------
// maxSize = longest side allowed (bigger textures get scaled down to a power of
// two <= maxSize). These are safe defaults that keep quality while cutting the
// worst VRAM hogs. --aggressive halves them; --max overrides everything.
const PRESETS = {
  cars:     { maxSize: 2048, label: 'Vehicles (YTD)' },
  clothing: { maxSize: 2048, label: 'Clothing / peds (YTD)' },
  mlo:      { maxSize: 2048, label: 'MLO / interiors (YTD)' },
  auto:     { maxSize: 2048, label: 'Mixed / auto-detect' },
};
const AGGRESSIVE = { cars: 1024, clothing: 1024, mlo: 1024, auto: 1024 };

// ---------- Argument parsing ----------
function parseArgs(argv) {
  const a = {
    folder: null, type: 'auto', apply: false, aggressive: false,
    max: null, format: null, backup: true, replace: false, quiet: false,
    help: false, interactive: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    switch (t) {
      case '--help': case '-h': a.help = true; break;
      case '--apply': a.apply = true; break;
      case '--aggressive': a.aggressive = true; break;
      case '--no-backup': a.backup = false; break;
      case '--replace': a.replace = true; break;
      case '--quiet': a.quiet = true; break;
      case '--type': a.type = (argv[++i] || 'auto').toLowerCase(); break;
      case '--max': a.max = parseInt(argv[++i], 10); break;
      case '--format': a.format = (argv[++i] || '').toUpperCase(); break;
      default:
        if (t.startsWith('--type=')) a.type = t.slice(7).toLowerCase();
        else if (t.startsWith('--max=')) a.max = parseInt(t.slice(6), 10);
        else if (t.startsWith('--format=')) a.format = t.slice(9).toUpperCase();
        else if (!t.startsWith('-')) rest.push(t);
    }
  }
  if (rest.length) a.folder = rest.join(' '); // tolerate unquoted paths with spaces
  if (!PRESETS[a.type]) a.type = 'auto';
  if (a.format && !['BC1', 'BC3', 'BC7'].includes(a.format)) a.format = null;
  return a;
}

// ---------- Image header parsers (no external tools needed) ----------
// Each returns { width, height, mips, hasAlpha, compressed } or null on failure.
function readImageInfo(file, buf) {
  const ext = path.extname(file).toLowerCase();
  try {
    if (ext === '.dds') return parseDDS(buf);
    if (ext === '.png') return parsePNG(buf);
    if (ext === '.jpg' || ext === '.jpeg') return parseJPEG(buf);
    if (ext === '.tga') return parseTGA(buf);
    if (ext === '.bmp') return parseBMP(buf);
  } catch { /* fall through */ }
  return null;
}

function parsePNG(b) {
  if (b.length < 33 || b.readUInt32BE(0) !== 0x89504e47) return null;
  const width = b.readUInt32BE(16);
  const height = b.readUInt32BE(20);
  const colorType = b[25];
  let hasAlpha = colorType === 4 || colorType === 6;
  if (colorType === 3) hasAlpha = b.includes(Buffer.from('tRNS')); // palette + transparency
  return { width, height, mips: 1, hasAlpha, compressed: false };
}

function parseJPEG(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i < b.length - 8) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    // SOF0..SOF15 hold the frame size (skip DHT=C4, JPG=C8, DAC=CC and RSTn)
    if (marker >= 0xc0 && marker <= 0xcf &&
        marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = b.readUInt16BE(i + 5);
      const width = b.readUInt16BE(i + 7);
      return { width, height, mips: 1, hasAlpha: false, compressed: false };
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    i += 2 + b.readUInt16BE(i + 2); // skip this segment
  }
  return null;
}

function parseTGA(b) {
  if (b.length < 18) return null;
  const width = b.readUInt16LE(12);
  const height = b.readUInt16LE(14);
  const bpp = b[16];
  return { width, height, mips: 1, hasAlpha: bpp === 32, compressed: false };
}

function parseBMP(b) {
  if (b[0] !== 0x42 || b[1] !== 0x4d) return null;
  const width = b.readInt32LE(18);
  const height = Math.abs(b.readInt32LE(22));
  const bpp = b.readUInt16LE(28);
  return { width, height, mips: 1, hasAlpha: bpp === 32, compressed: false };
}

const DDPF_ALPHAPIXELS = 0x1, DDPF_FOURCC = 0x4;
function fourCC(b, off) { return b.toString('ascii', off, off + 4); }

function parseDDS(b) {
  if (b.length < 128 || fourCC(b, 0) !== 'DDS ') return null;
  const height = b.readUInt32LE(12);
  const width = b.readUInt32LE(16);
  const mips = Math.max(1, b.readUInt32LE(28));
  const pfFlags = b.readUInt32LE(80);
  const cc = fourCC(b, 84);
  let compressed = false, hasAlpha = false;
  if (pfFlags & DDPF_FOURCC) {
    compressed = cc === 'DXT1' || cc === 'DXT2' || cc === 'DXT3' ||
                 cc === 'DXT4' || cc === 'DXT5' || cc === 'DX10' ||
                 cc === 'BC4U' || cc === 'BC5U' || cc === 'ATI2';
    if (cc === 'DXT2' || cc === 'DXT3' || cc === 'DXT4' || cc === 'DXT5') hasAlpha = true;
    if (cc === 'DX10' && b.length >= 148) {
      const dxgi = b.readUInt32LE(128); // BC2/3=74-78, BC7=98-99 carry alpha
      hasAlpha = [74, 75, 76, 77, 78, 98, 99].includes(dxgi);
    }
  } else {
    hasAlpha = (pfFlags & DDPF_ALPHAPIXELS) !== 0 && b.readUInt32LE(104) !== 0;
  }
  return { width, height, mips, hasAlpha, compressed };
}

// ---------- Optimization decisions ----------
function nearestPow2(n) {
  const p = Math.pow(2, Math.round(Math.log2(n)));
  return Math.max(4, p);
}

// Longest side capped to maxSize, aspect preserved, both sides snapped to POT.
function targetDims(w, h, maxSize) {
  const scale = Math.min(1, maxSize / Math.max(w, h));
  let tw = Math.min(nearestPow2(Math.round(w * scale)), maxSize);
  let th = Math.min(nearestPow2(Math.round(h * scale)), maxSize);
  return [tw, th];
}

function chooseFormat(info, override) {
  if (override) return override;
  return info.hasAlpha ? 'BC3' : 'BC1'; // DXT5 for alpha, DXT1 for opaque (4:1)
}

// Decide whether a file is worth reprocessing and why.
function plan(file, info, opts) {
  const [tw, th] = targetDims(info.width, info.height, opts.maxSize);
  const fmt = chooseFormat(info, opts.format);
  const reasons = [];
  if (tw < info.width || th < info.height) reasons.push('oversized');
  if (!info.compressed) reasons.push('uncompressed');
  if (info.mips <= 1) reasons.push('no mipmaps');
  const isDDS = path.extname(file).toLowerCase() === '.dds';
  // Already-good DDS (compressed, in-size, mipped) => nothing to gain.
  if (isDDS && info.compressed && info.mips > 1 &&
      tw >= info.width && th >= info.height && !opts.format) {
    return { skip: true, reasons: ['already optimized'], tw, th, fmt };
  }
  if (!reasons.length) reasons.push('recompress');
  return { skip: false, reasons, tw, th, fmt };
}

// ---------- File scanning ----------
function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'bin' && dir === ROOT) continue;      // our texconv folder
      if (e.name.startsWith('_backup_textures')) continue; // our own backups
      if (e.name === '.ytd_work') continue;                // our temp unpack area
      walk(full, out);
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}

// ---------- texconv ----------
function ensureTexconv() {
  if (fs.existsSync(TEXCONV)) return true;
  if (process.platform !== 'win32') return false;
  fs.mkdirSync(BIN_DIR, { recursive: true });
  process.stdout.write('  Downloading texconv.exe (one-time, ~1 MB)... ');
  try {
    downloadSync(TEXCONV_URL, TEXCONV);
    console.log('done.');
    return true;
  } catch (err) {
    console.log('failed.');
    console.log('  ' + err.message);
    return false;
  }
}

// Synchronous download via Windows PowerShell (present on every modern Windows,
// follows redirects itself). Only ever called on win32.
function downloadSync(url, dest) {
  const tmp = dest + '.part';
  const ps = `$ErrorActionPreference='Stop';` +
    `[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;` +
    `Invoke-WebRequest -UseBasicParsing -Uri '${url}' -OutFile '${tmp}'`;
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps],
    { encoding: 'utf8' });
  if (r.error) throw new Error('could not run PowerShell: ' + r.error.message);
  if (r.status !== 0) throw new Error((r.stderr || 'download failed').trim().split('\n').pop());
  if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 100000) {
    try { fs.unlinkSync(tmp); } catch {}
    throw new Error('downloaded file looks wrong; place texconv.exe in ./bin/ manually');
  }
  fs.renameSync(tmp, dest);
}

function runTexconv(file, p, outDir) {
  const fmtMap = { BC1: 'BC1_UNORM', BC3: 'BC3_UNORM', BC7: 'BC7_UNORM' };
  const args = [
    '-nologo', '-y', '-o', outDir, '-ft', 'dds',
    '-f', fmtMap[p.fmt], '-w', String(p.tw), '-h', String(p.th),
    '-m', '0', // full mip chain
    file,
  ];
  const r = spawnSync(TEXCONV, args, { encoding: 'utf8' });
  if (r.error) return { ok: false, msg: r.error.message };
  if (r.status !== 0) return { ok: false, msg: (r.stderr || r.stdout || '').trim().split('\n').pop() };
  return { ok: true };
}

// ---------- Reporting helpers ----------
function human(bytes) {
  if (bytes < 1024) return bytes + ' B';
  const u = ['KB', 'MB', 'GB'];
  let i = -1, n = bytes;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return n.toFixed(n < 10 ? 1 : 0) + ' ' + u[i];
}
const pad = (s, n) => String(s).padEnd(n).slice(0, n);

// ---------- Main flow ----------
function help() {
  console.log(`
sxn opti - FiveM Texture Optimizer
==================================
Scans a folder of FiveM resources and rebuilds bloated textures as compressed
DDS with mipmaps, so cars, clothing and MLOs use less VRAM and stream cleanly.

USAGE
  node optimize.js <folder> [options]

OPTIONS
  --type <cars|clothing|mlo|auto>   Preset (mainly picks the size cap). Default: auto
  --max <pixels>                    Force a max texture size (e.g. 1024, 2048)
  --format <BC1|BC3|BC7>            Force a compression format for every texture
                                    (default: BC1 opaque / BC3 alpha; BC7 = best quality)
  --aggressive                      Halve the size cap (1024) for maximum savings
  --apply                           Actually rewrite files (without this it's a dry run)
  --no-backup                       Skip copying originals to _backup_textures/
  --replace                         When a PNG/JPG/TGA becomes a DDS, remove the original
  --quiet                           Only print the summary
  --help                            Show this help

WHAT IT TOUCHES
  Loose textures  (.dds .png .jpg .tga .bmp)  -> resized + BC-compressed + mipmapped
  .ytd archives   (vehicles/clothing/MLO)     -> reported by size (see notes below)

Actual compression needs texconv.exe (Microsoft DirectXTex). On Windows it is
downloaded automatically the first time; otherwise drop texconv.exe in ./bin/.
`);
}

function classify(files) {
  const images = [], ytds = [];
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (IMAGE_EXTS.has(ext)) images.push(f);
    else if (ext === '.ytd') ytds.push(f);
  }
  return { images, ytds };
}

function reportYtd(ytds, quiet) {
  if (!ytds.length) return;
  let total = 0;
  const sized = ytds.map(f => {
    let s = 0; try { s = fs.statSync(f).size; } catch {}
    total += s; return { f, s };
  }).sort((a, b) => b.s - a.s);
  console.log(`\n.YTD ARCHIVES  ${ytds.length} files, ${human(total)} total`);
  console.log('  These hold the packed textures for vehicles, clothing and MLOs.');
  console.log('  This tool cannot repack .ytd directly - use OpenIV or CodeWalker to');
  console.log('  export the textures, run this tool on them, then re-import. Biggest first:');
  if (!quiet) {
    for (const { f, s } of sized.slice(0, 12)) {
      const flag = s > 16 * 1024 * 1024 ? '  <-- very large' : s > 6 * 1024 * 1024 ? '  <-- large' : '';
      console.log(`    ${pad(human(s), 9)} ${path.basename(f)}${flag}`);
    }
    if (sized.length > 12) console.log(`    ...and ${sized.length - 12} more`);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { help(); return; }
  if (!opts.folder) { interactive(opts); return; }
  run(opts);
}

function resolveOpts(opts) {
  const preset = PRESETS[opts.type];
  let maxSize = opts.max || preset.maxSize;
  if (opts.aggressive && !opts.max) maxSize = AGGRESSIVE[opts.type];
  return { ...opts, maxSize, presetLabel: preset.label };
}

function run(rawOpts) {
  const opts = resolveOpts(rawOpts);
  const folder = path.resolve(opts.folder);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    console.error(`Folder not found: ${folder}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nsxn opti`);
  console.log(`  Folder : ${folder}`);
  console.log(`  Preset : ${opts.type} (${opts.presetLabel})`);
  console.log(`  Max    : ${opts.maxSize}px   Format: ${opts.format || 'BC1 opaque / BC3 alpha'}`);
  console.log(`  Mode   : ${opts.apply ? 'APPLY (files will be rewritten)' : 'DRY RUN (no changes)'}`);

  const files = walk(folder, []);
  const { images, ytds } = classify(files);

  // Build the plan for every loose texture.
  const jobs = [];
  for (const f of images) {
    let buf;
    try { buf = fs.readFileSync(f); } catch { continue; }
    const info = readImageInfo(f, buf);
    if (!info || !info.width || !info.height) continue;
    const p = plan(f, info, opts);
    jobs.push({ f, size: buf.length, info, p });
  }

  const todo = jobs.filter(j => !j.p.skip);
  const skipped = jobs.length - todo.length;

  if (!opts.quiet) {
    console.log(`\nLOOSE TEXTURES  ${jobs.length} found, ${todo.length} to optimize, ${skipped} already good\n`);
    console.log(`  ${pad('current', 12)}${pad('->', 4)}${pad('target', 12)}${pad('fmt', 5)}why / file`);
    console.log('  ' + '-'.repeat(74));
    for (const j of todo.slice(0, 60)) {
      const cur = `${j.info.width}x${j.info.height}`;
      const tgt = `${j.p.tw}x${j.p.th}`;
      console.log(`  ${pad(cur, 12)}${pad('->', 4)}${pad(tgt, 12)}${pad(j.p.fmt, 5)}${j.p.reasons.join(', ')} - ${path.relative(folder, j.f)}`);
    }
    if (todo.length > 60) console.log(`  ...and ${todo.length - 60} more`);
  }

  reportYtd(ytds, opts.quiet);

  if (!opts.apply) {
    console.log(`\nDRY RUN complete. Re-run with --apply to rewrite the ${todo.length} loose texture(s) above.`);
    return;
  }
  if (!todo.length) { console.log('\nNothing to optimize. Done.'); return; }

  // Apply: need texconv.
  if (!ensureTexconv()) {
    console.error('\ntexconv.exe is required to rewrite textures but is not available.');
    console.error('On Windows it downloads automatically; otherwise place texconv.exe in ./bin/.');
    process.exitCode = 1;
    return;
  }

  let before = 0, after = 0, ok = 0, fail = 0;
  console.log('');
  for (const j of todo) {
    const dir = path.dirname(j.f);
    const outDds = path.join(dir, path.basename(j.f, path.extname(j.f)) + '.dds');
    const isDDS = path.extname(j.f).toLowerCase() === '.dds';

    if (opts.backup) backup(folder, j.f);
    const res = runTexconv(j.f, j.p, dir);
    if (!res.ok) {
      fail++;
      if (!opts.quiet) console.log(`  FAIL  ${path.relative(folder, j.f)}  (${res.msg})`);
      continue;
    }
    before += j.size;
    let newSize = 0; try { newSize = fs.statSync(outDds).size; } catch {}
    after += newSize;
    ok++;
    // A converted PNG/JPG leaves both the .dds and the original behind.
    if (!isDDS && opts.replace) { try { fs.unlinkSync(j.f); } catch {} }
    if (!opts.quiet) {
      const note = (!isDDS && !opts.replace) ? '  (kept original)' : '';
      console.log(`  OK    ${pad(human(j.size), 9)} -> ${pad(human(newSize), 9)}  ${path.relative(folder, outDds)}${note}`);
    }
  }

  console.log(`\nDONE  ${ok} optimized, ${fail} failed`);
  if (before) {
    const saved = before - after;
    const pct = before ? Math.round((saved / before) * 100) : 0;
    console.log(`  ${human(before)} -> ${human(after)}   saved ${human(saved)} (${pct}%)`);
  }
  if (opts.backup) console.log('  Originals copied to _backup_textures/ next to this tool.');
}

function backup(folder, file) {
  try {
    const rel = path.relative(folder, file);
    const dest = path.join(ROOT, '_backup_textures', rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest)) fs.copyFileSync(file, dest);
  } catch { /* best effort */ }
}

// ---------- Interactive (double-click) mode ----------
function interactive(opts) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(r => rl.question(q, a => r(a.trim())));
  console.log('\n=== sxn opti - FiveM Texture Optimizer ===');
  console.log('Optimizes textures for cars, clothing and MLOs (resize + compress + mipmaps).\n');
  (async () => {
    let folder = await ask('Folder to scan (drag it onto this window, or paste the path): ');
    folder = folder.replace(/^["']|["']$/g, '');
    if (!folder) { console.log('No folder given. Closing.'); rl.close(); return; }
    let type = (await ask('Type? [1] cars  [2] clothing  [3] mlo  [4] mixed  (default 4): ')) || '4';
    const map = { '1': 'cars', '2': 'clothing', '3': 'mlo', '4': 'auto' };
    const aggr = /^y/i.test(await ask('Aggressive (smaller, 1024px cap)? y/N: '));
    rl.close();
    // First a dry run so they can see what would change.
    run({ ...opts, folder, type: map[type] || 'auto', aggressive: aggr, apply: false });
    const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
    const go = await new Promise(r => rl2.question('\nApply these changes now? (originals are backed up) y/N: ', a => r(a.trim())));
    rl2.close();
    if (/^y/i.test(go)) {
      run({ ...opts, folder, type: map[type] || 'auto', aggressive: aggr, apply: true });
    } else {
      console.log('No changes made.');
    }
  })().catch(e => { console.error(e.message); rl.close(); });
}

// ---------- YTD optimization (unpack -> optimize -> repack) ----------
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} }
function subArgs(args, vars) {
  return args.map(a => a.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : '{' + k + '}')));
}
function runTool(tool, args) {
  const r = spawnSync(tool, args, { encoding: 'utf8' });
  if (r.error) return { ok: false, msg: r.error.message };
  if (r.status !== 0) {
    const line = ((r.stderr || r.stdout || '').trim().split('\n').pop()) || ('exit code ' + r.status);
    return { ok: false, msg: line };
  }
  return { ok: true, out: r.stdout || '' };
}

// Optimize one .ytd in place. Returns { ok, before, after, changed, total } or
// { ok:false, msg }. `log(text)` is an optional progress callback.
// Every texture the archive contained is carried into the repack (optimized or
// copied as-is) so the rebuilt .ytd is never missing textures.
function optimizeYtd(folder, file, opts, cfg, tool, log) {
  const name = path.basename(file, path.extname(file));
  const work = path.join(ROOT, '.ytd_work');
  const exdir = path.join(work, name + '__ex');
  const indir = path.join(work, name); // createytd names the archive after this folder
  const outdir = path.join(work, name + '__out');
  rmrf(exdir); rmrf(indir); rmrf(outdir);
  fs.mkdirSync(exdir, { recursive: true });
  fs.mkdirSync(indir, { recursive: true });
  fs.mkdirSync(outdir, { recursive: true });
  try {
    if (log) log('unpacking ' + path.basename(file));
    let r = runTool(tool, subArgs(cfg.ytd.extractArgs, { in: file, outdir: exdir }));
    if (!r.ok) return { ok: false, msg: 'unpack failed: ' + r.msg };

    const imgs = walk(exdir, []).filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()));
    if (!imgs.length) return { ok: false, msg: 'no textures found after unpack (is the tool set up right?)' };

    let changed = 0;
    for (const img of imgs) {
      const base = path.basename(img);
      let info = null;
      try { info = readImageInfo(img, fs.readFileSync(img)); } catch {}
      if (!info) { safeCopy(img, path.join(indir, base)); continue; } // unknown -> keep as-is
      const p = plan(img, info, opts);
      if (p.skip) { safeCopy(img, path.join(indir, base)); continue; } // already fine -> keep
      const res = runTexconv(img, p, indir); // writes <base>.dds into indir
      if (!res.ok) { safeCopy(img, path.join(indir, base)); continue; } // fall back to original
      changed++;
    }

    if (log) log('optimized ' + changed + ' of ' + imgs.length + ' textures, repacking');
    r = runTool(tool, subArgs(cfg.ytd.createArgs, { indir: indir, outdir: outdir }));
    if (!r.ok) return { ok: false, msg: 'repack failed: ' + r.msg };

    const produced = walk(outdir, []).find(f => path.extname(f).toLowerCase() === '.ytd') ||
                     walk(work, []).find(f => path.extname(f).toLowerCase() === '.ytd' && f !== file);
    if (!produced) return { ok: false, msg: 'repack did not produce a .ytd (check the tool commands)' };

    let before = 0; try { before = fs.statSync(file).size; } catch {}
    if (opts.backup !== false) backup(folder, file);
    fs.copyFileSync(produced, file);
    let after = 0; try { after = fs.statSync(file).size; } catch {}
    return { ok: true, before, after, changed, total: imgs.length };
  } finally {
    rmrf(exdir); rmrf(indir); rmrf(outdir);
  }
}
function safeCopy(src, dest) { try { fs.copyFileSync(src, dest); } catch {} }

// Run the CLI only when invoked directly; when required (by server.js) just
// expose the engine so the web UI can reuse the exact same logic.
if (require.main === module) main();

module.exports = {
  ROOT, PRESETS, AGGRESSIVE, TEXCONV, CONFIG_PATH,
  resolveOpts, walk, classify, readImageInfo, plan, targetDims, chooseFormat,
  ensureTexconv, runTexconv, backup, human,
  loadConfig, saveConfig, findYtdTool, optimizeYtd,
};
