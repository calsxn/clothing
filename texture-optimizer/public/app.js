// sxn opti - desktop UI logic (sidebar tool layout)
'use strict';

const $ = (id) => document.getElementById(id);
let optimizeType = 'auto';   // remembered choice for the Optimize section
let currentType = 'auto';    // active preset used for scans
let lastScan = null;
let running = false;
let ytdReady = false;

// ---------- helpers ----------
function human(bytes) {
  if (bytes == null) return '–';
  if (bytes < 1024) return bytes + ' B';
  const u = ['KB', 'MB', 'GB'];
  let i = -1, n = bytes;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return n.toFixed(n < 10 ? 1 : 0) + ' ' + u[i];
}
function esc(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function cssEsc(s) { return String(s).replace(/["\\\]]/g, '\\$&'); }

// ---------- sidebar navigation ----------
const SECTIONS = {
  optimize: { title: 'Optimize', sub: 'Optimize any folder of textures — cars, clothing and MLO together.', type: null },
  vehicles: { title: 'Vehicles', sub: 'Optimize vehicle textures (loose files and .ytd packs).', type: 'cars', chip: 'Preset: Cars' },
  clothing: { title: 'Clothing', sub: 'Optimize clothing & ped textures.', type: 'clothing', chip: 'Preset: Clothing' },
  mlo:      { title: 'MLO', sub: 'Optimize MLO / interior textures.', type: 'mlo', chip: 'Preset: MLO' },
  settings: { title: 'Settings', sub: 'Connect your .ytd tool and view info.', type: 'settings' },
};

function setSection(name) {
  const s = SECTIONS[name]; if (!s) return;
  document.querySelectorAll('.navitem').forEach(b => b.classList.toggle('active', b.dataset.section === name));
  $('sectionTitle').textContent = s.title;
  $('sectionSub').textContent = s.sub;

  if (name === 'settings') {
    $('panel-work').classList.add('hidden');
    $('panel-settings').classList.remove('hidden');
    $('presetChip').classList.add('hidden');
    return;
  }
  $('panel-settings').classList.add('hidden');
  $('panel-work').classList.remove('hidden');

  if (s.type === null) { // Optimize: user picks the type
    $('typeSegWrap').classList.remove('hidden');
    $('presetChip').classList.add('hidden');
    currentType = optimizeType;
  } else { // fixed-preset sections
    $('typeSegWrap').classList.add('hidden');
    $('presetChip').textContent = s.chip;
    $('presetChip').classList.remove('hidden');
    currentType = s.type;
  }
  // Reset the preview when switching, since the preset changed.
  lastScan = null;
  $('results').classList.add('hidden');
  $('progress').classList.add('hidden');
  $('scanError').classList.add('hidden');
}

document.querySelectorAll('.navitem').forEach(b => b.addEventListener('click', () => setSection(b.dataset.section)));

// ---------- option controls ----------
$('typeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-type]');
  if (!b) return;
  optimizeType = currentType = b.dataset.type;
  [...$('typeSeg').children].forEach(x => x.classList.toggle('on', x === b));
});
$('advToggle').addEventListener('click', () => $('advanced').classList.toggle('hidden'));

function settings() {
  return {
    folder: $('folder').value.trim().replace(/^["']|["']$/g, ''),
    type: currentType,
    aggressive: $('aggressive').checked,
    format: $('format').value || null,
    max: $('max').value ? parseInt($('max').value, 10) : null,
  };
}

try { $('folder').value = localStorage.getItem('to_folder') || ''; } catch {}

// ---------- settings: the YTD tool ----------
function renderToolStatus(d) {
  ytdReady = !!d.ready;
  $('toolPath').value = d.toolPath || '';
  const side = $('sideToolStat');
  side.classList.toggle('ok', ytdReady);
  side.querySelector('.txt').textContent = ytdReady ? 'tool: connected' : 'tool: not set up';
  $('toolStatus').innerHTML = ytdReady
    ? `✓ Ready — using <code>${esc(d.detected)}</code>`
    : 'Not connected yet — .ytd packs will be skipped until you set this.';
}
async function loadSettings() {
  try { renderToolStatus(await (await fetch('/api/settings')).json()); } catch {}
}
loadSettings();

$('saveTool').addEventListener('click', async () => {
  const btn = $('saveTool'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await fetch('/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolPath: $('toolPath').value.trim() }),
    });
    const d = await res.json();
    if (!res.ok) $('toolStatus').innerHTML = `<span style="color:var(--err)">${esc(d.error || 'Could not save.')}</span>`;
    else { renderToolStatus(d); if (lastScan) applyYtdAvailability(); }
  } catch { $('toolStatus').textContent = 'Could not reach the tool.'; }
  finally { btn.disabled = false; btn.textContent = 'Save'; }
});

// ---------- Scan ----------
$('scanBtn').addEventListener('click', doScan);
$('folder').addEventListener('keydown', (e) => { if (e.key === 'Enter') doScan(); });

async function doScan() {
  const s = settings();
  $('scanError').classList.add('hidden');
  if (!s.folder) { showScanError('Please paste a folder path first.'); return; }
  try { localStorage.setItem('to_folder', s.folder); } catch {}

  $('scanBtn').disabled = true; $('scanBtn').textContent = 'Scanning…';
  try {
    const res = await fetch('/api/scan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    });
    const data = await res.json();
    if (!res.ok) { showScanError(data.error || 'Scan failed.'); return; }
    lastScan = data;
    renderResults(data);
  } catch {
    showScanError('Could not reach the tool. Is the app still running?');
  } finally {
    $('scanBtn').disabled = false; $('scanBtn').textContent = 'Scan';
  }
}
function showScanError(msg) {
  const el = $('scanError'); el.textContent = msg; el.classList.remove('hidden');
  $('results').classList.add('hidden');
}

// ---------- Results ----------
function renderResults(d) {
  $('results').classList.remove('hidden');
  $('progress').classList.add('hidden');
  $('scanned').textContent = `Scanned ${d.folder} — preset: ${d.settings.type}, max ${d.settings.maxSize}px.`;

  $('sFound').textContent = d.counts.found;
  $('sTodo').textContent = d.counts.toOptimize;
  $('sGood').textContent = d.counts.alreadyGood;
  $('sSize').textContent = human(d.totalToOptimizeBytes);

  applyYtdAvailability();

  $('tableCount').textContent = d.jobs.length;
  $('tbody').innerHTML = d.jobs.map(j => `<tr>
      <td>${esc(j.cur)}</td><td class="arrow">→</td><td>${esc(j.tgt)}</td>
      <td class="fmt">${esc(j.fmt)}</td><td class="why">${esc(j.reasons.join(', '))}</td>
      <td class="file" title="${esc(j.rel)}">${esc(j.rel)}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="muted">Nothing to optimize — these textures are already in good shape. 🎉</td></tr>';

  const applyBtn = $('applyBtn');
  if (d.counts.toOptimize === 0 && !(ytdReady && d.ytd.count)) {
    applyBtn.disabled = true; applyBtn.textContent = 'Nothing to optimize';
  } else if (d.platform !== 'win32' && !d.texconvReady) {
    applyBtn.disabled = true; applyBtn.textContent = 'Windows only';
  } else {
    applyBtn.disabled = false; applyBtn.textContent = 'Optimize now';
  }
  $('results').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Enable/disable the ".ytd" toggle and show the right note.
function applyYtdAvailability() {
  const d = lastScan; if (!d) return;
  const yn = $('ytdNote');
  const wrap = $('ytdToggleWrap').parentElement;
  const box = $('ytd');
  const hint = $('ytdHint');

  if (!d.ytd.count) { yn.classList.add('hidden'); wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  const top = d.ytd.files.slice(0, 4).map(f => `${esc(f.name)} (${human(f.size)})`).join(', ');

  if (ytdReady) {
    yn.classList.add('hidden');
    wrap.classList.remove('disabled');
    box.disabled = false;
    hint.innerHTML = `${d.ytd.count} pack(s), ${human(d.ytd.totalBytes)} total. Biggest: ${top}.`;
  } else {
    yn.classList.remove('hidden');
    yn.innerHTML = `<b>${d.ytd.count} .ytd pack(s)</b> found (${human(d.ytd.totalBytes)} total) — the packed ` +
      `car/clothing/MLO textures. To optimize these <b>automatically</b>, ` +
      `<button class="link inline" id="openSetup">connect CodeWalker / GTAUtil ▸</button>. Biggest: ${top}.`;
    wrap.classList.add('disabled');
    box.disabled = true; box.checked = false;
    hint.textContent = 'Tool not set up — these will be skipped.';
    const os = $('openSetup');
    if (os) os.onclick = () => setSection('settings');
  }
}

// ---------- Apply (live progress via SSE) ----------
$('applyBtn').addEventListener('click', doApply);

function doApply() {
  if (running || !lastScan) return;
  const willYtd = $('ytd').checked && !$('ytd').disabled;
  const n = lastScan.counts.toOptimize + (willYtd ? lastScan.ytd.count : 0);
  if (!confirm(`Optimize ${n} item(s) in this folder?\n\n` +
      ($('backup').checked ? 'Originals will be backed up first.' : 'WARNING: backup is OFF.'))) return;

  running = true;
  $('applyBtn').disabled = true;
  $('progress').classList.remove('hidden');
  $('doneBox').classList.add('hidden');
  $('log').innerHTML = '';
  $('progTitle').textContent = 'Optimizing…';
  $('barFill').style.width = '0%';
  $('progress').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const s = settings();
  const params = new URLSearchParams({
    folder: s.folder, type: s.type,
    aggressive: String(s.aggressive), backup: String($('backup').checked),
    ytd: String(willYtd),
  });
  if (s.format) params.set('format', s.format);
  if (s.max) params.set('max', String(s.max));

  const es = new EventSource('/api/optimize-stream?' + params.toString());
  es.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'start') { $('progText').textContent = `0 of ${m.total} done…`; }
    else if (m.type === 'file') { setPct(m.index, m.total); addLog(m); }
    else if (m.type === 'ytd-start') { setPct(m.index - 1, m.total); addRaw('bad', `📦 ${m.rel} — working…`, 'ytd-' + m.rel); }
    else if (m.type === 'ytd-log') { updateRaw('ytd-' + m.rel, `📦 ${m.rel} — ${m.message}`); }
    else if (m.type === 'ytd') {
      setPct(m.index, m.total);
      if (m.ok) updateRaw('ytd-' + m.rel, `✓ ${m.rel} — ${m.changed}/${m.textures} textures (${human(m.before)} → ${human(m.after)})`, 'ok');
      else updateRaw('ytd-' + m.rel, `✗ ${m.rel} — ${m.message}`, 'bad');
    }
    else if (m.type === 'note') { addRaw('bad', 'ℹ ' + m.message); }
    else if (m.type === 'done') { finish(m); es.close(); }
    else if (m.type === 'error') {
      $('progTitle').textContent = 'Could not optimize';
      addRaw('bad', '✗ ' + m.message);
      es.close(); running = false; $('applyBtn').disabled = false;
    }
  };
  es.onerror = () => {
    if (running) addRaw('bad', 'Connection lost. Is the app still running?');
    es.close(); running = false; $('applyBtn').disabled = false;
  };
}

function setPct(i, t) {
  $('barFill').style.width = Math.round((i / t) * 100) + '%';
  $('progText').textContent = `${i} of ${t} done…`;
}
function addLog(m) {
  addRaw(m.ok ? 'ok' : 'bad',
    m.ok ? `✓ ${m.rel}  (${human(m.before)} → ${human(m.after)}${m.kept ? ', original kept' : ''})`
         : `✗ ${m.rel}${m.message ? '  — ' + m.message : ''}`);
}
function addRaw(cls, text, key) {
  const log = $('log');
  const div = document.createElement('div');
  div.className = 'row ' + cls; div.textContent = text;
  if (key) div.dataset.key = key;
  log.appendChild(div); log.scrollTop = log.scrollHeight;
}
function updateRaw(key, text, cls) {
  const row = $('log').querySelector(`.row[data-key="${cssEsc(key)}"]`);
  if (!row) return addRaw(cls || 'bad', text, key);
  row.textContent = text; if (cls) row.className = 'row ' + cls;
}
function finish(m) {
  running = false;
  $('barFill').style.width = '100%';
  $('progTitle').textContent = 'All done!';
  $('progText').textContent = `${m.ok} optimized, ${m.fail} failed.`;
  const saved = (m.before || 0) - (m.after || 0);
  const pct = m.before ? Math.round((saved / m.before) * 100) : 0;
  const box = $('doneBox');
  box.classList.remove('hidden');
  box.innerHTML = m.ok
    ? `Optimized <b>${m.ok}</b> item(s). Size went from <b>${human(m.before)}</b> to <b>${human(m.after)}</b> — ` +
      `you saved <b>${human(saved)} (${pct}%)</b>.` + (m.fail ? ` ${m.fail} failed (see the list above).` : '') +
      `<br><span class="muted small">Originals are in the tool's <code>_backup_textures</code> folder.</span>`
    : `No files were changed. ${m.fail ? m.fail + ' failed.' : ''}`;
  $('applyBtn').disabled = false; $('applyBtn').textContent = 'Optimize again';
}

// start on the Optimize section
setSection('optimize');
