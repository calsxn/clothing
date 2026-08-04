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

  // YTD note
  const yn = $('ytdNote');
  if (d.ytd.count) {
    const top = d.ytd.files.slice(0, 5).map(f => `${esc(f.name)} (${human(f.size)})`).join(', ');
    yn.innerHTML = `<b>${d.ytd.count} .ytd pack(s)</b> found (${human(d.ytd.totalBytes)} total). ` +
      `These hold packed car/clothing/MLO textures and must be opened in OpenIV or CodeWalker to ` +
      `optimize — this tool can't repack them directly. Biggest: ${top}.`;
    yn.classList.remove('hidden');
  } else yn.classList.add('hidden');

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
      const pct = Math.round((m.index / m.total) * 100);
      $('barFill').style.width = pct + '%';
      $('progText').textContent = `${m.index} of ${m.total} done…`;
      addLog(m);
    } else if (m.type === 'done') {
      finish(m);
      es.close();
    } else if (m.type === 'error') {
      $('progTitle').textContent = 'Could not optimize';
      addLog({ ok: false, rel: m.message });
      es.close(); running = false; $('applyBtn').disabled = false;
    }
  };
  es.onerror = () => {
    if (running) { addLog({ ok: false, rel: 'Connection lost. Is the tool window still open?' }); }
    es.close(); running = false; $('applyBtn').disabled = false;
  };
}

function addLog(m) {
  const div = document.createElement('div');
  div.className = 'row ' + (m.ok ? 'ok' : 'bad');
  if (m.ok) {
    div.textContent = `✓ ${m.rel}  (${human(m.before)} → ${human(m.after)}${m.kept ? ', original kept' : ''})`;
  } else {
    div.textContent = `✗ ${m.rel}${m.message ? '  — ' + m.message : ''}`;
  }
  const log = $('log');
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
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
    ? `Optimized <b>${m.ok}</b> texture(s). Size went from <b>${human(m.before)}</b> to ` +
      `<b>${human(m.after)}</b> — you saved <b>${human(saved)} (${pct}%)</b>.` +
      (m.fail ? ` ${m.fail} file(s) failed (see the list above).` : '') +
      `<br><span class="muted small">Originals are in the tool's <code>_backup_textures</code> folder.</span>`
    : `No files were changed. ${m.fail ? m.fail + ' failed.' : ''}`;
  $('applyBtn').disabled = false;
  $('applyBtn').textContent = 'Optimize again';
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
