// FiveM Texture Optimizer - browser UI logic
'use strict';

const $ = (id) => document.getElementById(id);
let currentType = 'auto';
let lastScan = null;
let running = false;

// ---------- small helpers ----------
function human(bytes) {
  if (bytes == null) return '–';
  if (bytes < 1024) return bytes + ' B';
  const u = ['KB', 'MB', 'GB'];
  let i = -1, n = bytes;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return n.toFixed(n < 10 ? 1 : 0) + ' ' + u[i];
}
function esc(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

// remember the last folder locally so teammates don't retype it
try { $('folder').value = localStorage.getItem('to_folder') || ''; } catch {}

// ---------- option controls ----------
$('typeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-type]');
  if (!b) return;
  currentType = b.dataset.type;
  [...$('typeSeg').children].forEach(x => x.classList.toggle('on', x === b));
});
$('advToggle').addEventListener('click', () => $('advanced').classList.toggle('hidden'));

// ---------- settings: the YTD tool (CodeWalker / GTAUtil) ----------
let ytdReady = false;

function renderToolStatus(d) {
  ytdReady = !!d.ready;
  $('toolPath').value = d.toolPath || '';
  const badge = $('setupBadge');
  badge.className = 'badge ' + (d.ready ? 'ok' : 'no');
  badge.textContent = d.ready ? 'connected' : 'not set up';
  const st = $('toolStatus');
  if (d.ready) st.innerHTML = `✓ Ready — using <code>${esc(d.detected)}</code>`;
  else st.textContent = 'Not connected yet — .ytd packs will be skipped until you set this.';
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
    if (!res.ok) { $('toolStatus').innerHTML = `<span style="color:var(--err)">${esc(d.error || 'Could not save.')}</span>`; }
    else { renderToolStatus(d); if (lastScan) applyYtdAvailability(); }
  } catch { $('toolStatus').textContent = 'Could not reach the tool.'; }
  finally { btn.disabled = false; btn.textContent = 'Save'; }
});

function settings() {
  return {
    folder: $('folder').value.trim().replace(/^["']|["']$/g, ''),
    type: currentType,
    aggressive: $('aggressive').checked,
    format: $('format').value || null,
    max: $('max').value ? parseInt($('max').value, 10) : null,
  };
}

// ---------- Step 1: scan ----------
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
  } catch (err) {
    showScanError('Could not reach the tool. Is the black window still open?');
  } finally {
    $('scanBtn').disabled = false; $('scanBtn').textContent = 'Scan';
  }
}

function showScanError(msg) {
  const el = $('scanError');
  el.textContent = msg; el.classList.remove('hidden');
  $('results').classList.add('hidden');
}

// ---------- Step 2: render results ----------
function renderResults(d) {
  $('results').classList.remove('hidden');
  $('progress').classList.add('hidden');
  $('scanned').textContent =
    `Scanned ${esc(d.folder)} — preset: ${d.settings.type}, max ${d.settings.maxSize}px.`;

  $('sFound').textContent = d.counts.found;
  $('sTodo').textContent = d.counts.toOptimize;
  $('sGood').textContent = d.counts.alreadyGood;
  $('sSize').textContent = human(d.totalToOptimizeBytes);

  // YTD note + toggle availability
  applyYtdAvailability();

  // table
  $('tableCount').textContent = d.jobs.length;
  const rows = d.jobs.map(j => `<tr>
      <td>${esc(j.cur)}</td><td class="arrow">→</td><td>${esc(j.tgt)}</td>
      <td class="fmt">${esc(j.fmt)}</td><td class="why">${esc(j.reasons.join(', '))}</td>
      <td class="file" title="${esc(j.rel)}">${esc(j.rel)}</td>
    </tr>`).join('');
  $('tbody').innerHTML = rows || '<tr><td colspan="6" class="muted">Nothing to optimize — these textures are already in good shape. 🎉</td></tr>';

  // apply availability
  const applyBtn = $('applyBtn');
  if (d.counts.toOptimize === 0) {
    applyBtn.disabled = true; applyBtn.textContent = 'Nothing to optimize';
  } else if (d.platform !== 'win32' && !d.texconvReady) {
    applyBtn.disabled = true; applyBtn.textContent = 'Windows only';
    yn.classList.remove('hidden');
    yn.innerHTML = 'Rewriting textures uses <b>texconv.exe</b>, which is Windows-only. ' +
      'Run this tool on your Windows / FiveM machine to actually optimize. (Scanning works anywhere.)';
  } else {
    applyBtn.disabled = false; applyBtn.textContent = `Optimize ${d.counts.toOptimize} texture(s) now`;
  }

  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Show the .ytd note and enable/disable the "also optimize .ytd" toggle based on
// whether any .ytd packs exist and whether the CodeWalker/GTAUtil tool is set up.
function applyYtdAvailability() {
  const d = lastScan; if (!d) return;
  const yn = $('ytdNote');
  const wrap = $('ytdToggleWrap').parentElement; // .ytdopt
  const box = $('ytd');
  const hint = $('ytdHint');

  if (!d.ytd.count) {
    yn.classList.add('hidden');
    wrap.classList.add('hidden');
    return;
  }
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
      `<button class="link inline" id="openSetup">connect CodeWalker / GTAUtil ▸</button>. ` +
      `Biggest: ${top}.`;
    wrap.classList.add('disabled');
    box.disabled = true; box.checked = false;
    hint.textContent = 'Tool not set up — these will be skipped.';
    const os = $('openSetup');
    if (os) os.onclick = () => { $('setup').open = true; $('setup').scrollIntoView({ behavior: 'smooth' }); $('toolPath').focus(); };
  }
}

// ---------- Step 3: apply with live progress ----------
$('applyBtn').addEventListener('click', doApply);

function doApply() {
  if (running || !lastScan) return;
  if (!confirm(`Optimize ${lastScan.counts.toOptimize} texture(s) in this folder?\n\n` +
      (($('backup').checked) ? 'Originals will be backed up first.' : 'WARNING: backup is OFF.'))) return;

  running = true;
  $('applyBtn').disabled = true;
  $('progress').classList.remove('hidden');
  $('doneBox').classList.add('hidden');
  $('log').innerHTML = '';
  $('progTitle').textContent = 'Optimizing…';
  $('barFill').style.width = '0%';

  const s = settings();
  const params = new URLSearchParams({
    folder: s.folder, type: s.type,
    aggressive: String(s.aggressive), backup: String($('backup').checked),
    ytd: String($('ytd').checked && !$('ytd').disabled),
  });
  if (s.format) params.set('format', s.format);
  if (s.max) params.set('max', String(s.max));

  const es = new EventSource('/api/optimize-stream?' + params.toString());
  let total = 0;

  es.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'start') {
      total = m.total;
      $('progText').textContent = `0 of ${total} done…`;
    } else if (m.type === 'file') {
      setPct(m.index, m.total);
      addLog(m);
    } else if (m.type === 'ytd-start') {
      setPct(m.index - 1, m.total);
      addRaw('bad', `📦 ${m.rel} — working…`, 'ytd-' + m.rel);
    } else if (m.type === 'ytd-log') {
      updateRaw('ytd-' + m.rel, `📦 ${m.rel} — ${m.message}`);
    } else if (m.type === 'ytd') {
      setPct(m.index, m.total);
      if (m.ok) updateRaw('ytd-' + m.rel, `✓ ${m.rel} — ${m.changed}/${m.textures} textures (${human(m.before)} → ${human(m.after)})`, 'ok');
      else updateRaw('ytd-' + m.rel, `✗ ${m.rel} — ${m.message}`, 'bad');
    } else if (m.type === 'note') {
      addRaw('bad', 'ℹ ' + m.message);
    } else if (m.type === 'done') {
      finish(m);
      es.close();
    } else if (m.type === 'error') {
      $('progTitle').textContent = 'Could not optimize';
      addRaw('bad', '✗ ' + m.message);
      es.close(); running = false; $('applyBtn').disabled = false;
    }
  };
  function setPct(i, t) {
    $('barFill').style.width = Math.round((i / t) * 100) + '%';
    $('progText').textContent = `${i} of ${t} done…`;
  }
  es.onerror = () => {
    if (running) { addLog({ ok: false, rel: 'Connection lost. Is the tool window still open?' }); }
    es.close(); running = false; $('applyBtn').disabled = false;
  };
}

function addLog(m) {
  addRaw(m.ok ? 'ok' : 'bad',
    m.ok ? `✓ ${m.rel}  (${human(m.before)} → ${human(m.after)}${m.kept ? ', original kept' : ''})`
         : `✗ ${m.rel}${m.message ? '  — ' + m.message : ''}`);
}

// Append a log line. If `key` is given the row can be updated later (used for
// .ytd packs, which show "working…" then get rewritten with the result).
function addRaw(cls, text, key) {
  const log = $('log');
  const div = document.createElement('div');
  div.className = 'row ' + cls;
  div.textContent = text;
  if (key) div.dataset.key = key;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}
function updateRaw(key, text, cls) {
  const row = $('log').querySelector(`.row[data-key="${cssEsc(key)}"]`);
  if (!row) return addRaw(cls || 'bad', text, key);
  row.textContent = text;
  if (cls) row.className = 'row ' + cls;
}
function cssEsc(s) { return String(s).replace(/["\\\]]/g, '\\$&'); }

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
    ? `Optimized <b>${m.ok}</b> texture(s). Size went from <b>${human(m.before)}</b> to ` +
      `<b>${human(m.after)}</b> — you saved <b>${human(saved)} (${pct}%)</b>.` +
      (m.fail ? ` ${m.fail} file(s) failed (see the list above).` : '') +
      `<br><span class="muted small">Originals are in the tool's <code>_backup_textures</code> folder.</span>`
    : `No files were changed. ${m.fail ? m.fail + ' failed.' : ''}`;
  $('applyBtn').disabled = false;
  $('applyBtn').textContent = 'Optimize again';
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
