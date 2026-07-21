// ================= FiveM Clothing Tracker - frontend =================
const $ = (id) => document.getElementById(id);

const CLOTHING_CATS = [
  'Masks (berd)', 'Scarves & Chains (teef)', 'Jackets (jbib)', 'Shirts (accs)',
  'Body Armour (task)', 'Bags & Parachutes (hand)', 'Legs (lowr)', 'Shoes (feet)',
  'Decals (decl)', 'Hair', 'Hats (props)', 'Glasses (props)', 'Ears (props)',
  'Watches (props)', 'Bracelets (props)', 'Other',
];

const CATEGORIES = {
  male: CLOTHING_CATS,
  female: CLOTHING_CATS,
  factions: CLOTHING_CATS,
  paid: CLOTHING_CATS,
  gang: CLOTHING_CATS,
  ped: ['Story Peds', 'Freemode Peds', 'Animals', 'Custom / Addon Peds', 'Gang Peds', 'Job Peds', 'Other'],
};

const SECTION_LABEL = { male: 'male clothing', female: 'female clothing', factions: 'faction clothing', paid: 'paid clothing', gang: 'gang clothing', ped: 'ped' };
const SECTION_NAME = { male: 'Male', female: 'Female', factions: 'Factions', paid: 'Paid', gang: 'Gang', ped: 'Peds' };

// tabs that combine male+female items from one pack (shown via Male/Female sub-tabs)
const VIRTUAL_PACK = { factions: 'Factions', paid: 'Paid', gang: 'Gang' };
let currentGender = 'male'; // active sub-tab inside virtual sections

// inline SVG icons (no emojis)
const ICON_IMG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15.5l-4.5-4.5L6 21.5"/></svg>';
const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 3 21l.5-4.5z"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2m1 0v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6"/></svg>';

let me = null;              // { id, username }
let currentSection = 'home';
let items = [];             // items for current section
let editingId = null;       // item id being edited, or null = adding
let pendingImage = '';      // data URL / URL for the modal
let refreshTimer = null;
const expandedCats = new Set(); // categories the user has opened (reset per section)

// ---------------- API helper ----------------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

// ---------------- Auth screen ----------------
let authMode = 'login';

function setAuthMode(mode) {
  authMode = mode;
  $('tab-login').classList.toggle('active', mode === 'login');
  $('tab-register').classList.toggle('active', mode === 'register');
  $('auth-submit').textContent = mode === 'login' ? 'Log in' : 'Create account';
  $('auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('auth-error').classList.add('hidden');
}

$('tab-login').onclick = () => setAuthMode('login');
$('tab-register').onclick = () => setAuthMode('register');

$('auth-form').onsubmit = async (e) => {
  e.preventDefault();
  $('auth-error').classList.add('hidden');
  try {
    const data = await api(`/api/${authMode === 'login' ? 'login' : 'register'}`, {
      method: 'POST',
      body: { username: $('auth-username').value, password: $('auth-password').value },
    });
    me = data;
    showApp();
  } catch (err) {
    $('auth-error').textContent = err.message;
    $('auth-error').classList.remove('hidden');
  }
};

$('logout-btn').onclick = async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  me = null;
  clearInterval(refreshTimer);
  $('app-screen').classList.add('hidden');
  $('auth-screen').classList.remove('hidden');
  $('auth-password').value = '';
};

// ---------------- Sections & toolbar ----------------
function setSection(section) {
  document.querySelectorAll('.section-tab').forEach((b) =>
    b.classList.toggle('active', b.dataset.section === section));
  currentSection = section;
  const isHome = section === 'home';
  $('toolbar').classList.toggle('hidden', isHome);
  $('home-view').classList.toggle('hidden', !isHome);
  $('list-view').classList.toggle('hidden', isHome);
  if (isHome) {
    $('empty-state').classList.add('hidden');
    loadHome();
    return;
  }
  $('search').value = '';
  $('status-filter').value = '';
  $('status-filter').classList.toggle('hidden', section === 'ped');
  // Factions/Paid/Gang get a Male/Female sub-tab
  $('gender-tabs').classList.toggle('hidden', !VIRTUAL_PACK[section]);
  setGender('male');
  expandedCats.clear(); // every category starts closed when opening a section
  buildCategoryFilter();
  loadItems();
}

function setGender(gender) {
  currentGender = gender;
  document.querySelectorAll('.gender-tab').forEach((b) =>
    b.classList.toggle('active', b.dataset.gender === gender));
}

document.querySelectorAll('.section-tab').forEach((btn) => {
  btn.onclick = () => setSection(btn.dataset.section);
});
document.querySelectorAll('.gender-tab').forEach((btn) => {
  btn.onclick = () => {
    setGender(btn.dataset.gender);
    expandedCats.clear();
    renderList();
  };
});
document.querySelectorAll('.stat-tile').forEach((tile) => {
  tile.onclick = () => setSection(tile.dataset.goto);
});

// ---------------- Info board ----------------
let boardEditing = false;

async function loadBoard() {
  if (boardEditing) return; // don't clobber the textarea while someone is typing
  try {
    const { board } = await api('/api/board');
    const content = $('board-content');
    if (board.content) {
      content.textContent = board.content;
      content.classList.remove('board-empty');
    } else {
      content.textContent = 'Nothing here yet - hit the pencil to add rules, updates or anything important.';
      content.classList.add('board-empty');
    }
    const meta = $('board-meta');
    if (board.updated_by) {
      meta.textContent = `Last updated by ${board.updated_by} · ${timeAgo(board.updated_at)}`;
      meta.classList.remove('hidden');
    } else {
      meta.classList.add('hidden');
    }
    content.dataset.raw = board.content || '';
  } catch { /* not fatal */ }
}

$('board-edit').onclick = () => {
  boardEditing = true;
  $('board-text').value = $('board-content').dataset.raw || '';
  $('board-content').classList.add('hidden');
  $('board-meta').classList.add('hidden');
  $('board-editor').classList.remove('hidden');
  $('board-text').focus();
};

function closeBoardEditor() {
  boardEditing = false;
  $('board-editor').classList.add('hidden');
  $('board-content').classList.remove('hidden');
}

$('board-cancel').onclick = () => { closeBoardEditor(); loadBoard(); };
$('board-save').onclick = async () => {
  try {
    await api('/api/board', { method: 'PUT', body: { content: $('board-text').value.trim() } });
    closeBoardEditor();
    loadHome();
  } catch (err) {
    alert(err.message);
  }
};

// ---------------- Home dashboard ----------------
async function loadHome() {
  loadCounts();
  loadSidebar();
  loadBoard();
  try {
    const { entries } = await api('/api/activity');
    $('home-activity-count').textContent = entries.length;
    const wrap = $('home-activity');
    wrap.innerHTML = '';
    if (!entries.length) {
      const e = document.createElement('div');
      e.className = 'panel-empty';
      e.textContent = 'No activity yet - changes people make will show up here.';
      wrap.appendChild(e);
    }
    entries.forEach((en) => {
      const row = document.createElement('div');
      row.className = 'home-activity-row';
      const text = document.createElement('div');
      text.className = 'activity-text';
      const b = document.createElement('b');
      b.textContent = en.username;
      const act = document.createElement('span');
      act.className = 'act-' + en.action;
      act.textContent = ` ${en.action} `;
      const item = document.createElement('b');
      item.textContent = en.item_name;
      const suffix = en.section === 'board' ? '' : ` ${en.action === 'deleted' ? 'from' : 'in'} ${SECTION_NAME[en.section] || en.section}`;
      text.append(b, act, item, suffix);
      const time = document.createElement('span');
      time.className = 'home-activity-time';
      time.textContent = timeAgo(en.created_at);
      row.append(text, time);
      wrap.appendChild(row);
    });
  } catch { /* not fatal */ }
}

function buildCategoryFilter() {
  const sel = $('category-filter');
  sel.innerHTML = '<option value="">All categories</option>';
  const present = [...new Set(items.map((i) => i.category))];
  const all = [...CATEGORIES[currentSection]];
  present.forEach((c) => { if (!all.includes(c)) all.push(c); });
  all.forEach((c) => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  });
}

$('search').oninput = renderList;
$('category-filter').onchange = renderList;
$('status-filter').onchange = renderList;

// ---------------- Load & render ----------------
async function loadCounts() {
  try {
    const { counts } = await api('/api/counts');
    document.querySelectorAll('[data-count]').forEach((el) => {
      el.textContent = counts[el.dataset.count] ?? 0;
    });
  } catch { /* not fatal */ }
}

async function loadItems() {
  try {
    const data = await api(`/api/items?section=${currentSection}`);
    items = data.items;
    const catSel = $('category-filter');
    const keep = catSel.value;
    buildCategoryFilter();
    catSel.value = keep;
    renderList();
    loadCounts();
    loadSidebar();
  } catch (err) {
    if (err.message === 'Not logged in') location.reload();
  }
}

// ---------------- Sidebar: online users & activity ----------------
function timeAgo(sqlDate) {
  if (!sqlDate) return 'never';
  const then = new Date(sqlDate.replace(' ', 'T') + 'Z').getTime();
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

async function loadSidebar() {
  try {
    const [{ users }, { entries }] = await Promise.all([api('/api/online'), api('/api/activity')]);

    const onlineCount = users.filter((u) => u.online).length;
    $('online-count').textContent = `${onlineCount}/${users.length}`;
    const ol = $('online-list');
    ol.innerHTML = '';
    users.forEach((u) => {
      const row = document.createElement('div');
      row.className = 'online-row' + (u.online ? '' : ' offline');
      const dot = document.createElement('span');
      dot.className = 'dot ' + (u.online ? 'on' : 'off');
      const info = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'online-name';
      name.textContent = u.username;
      if (me && u.username === me.username) {
        name.innerHTML = '';
        name.append(u.username, ' ');
        const you = document.createElement('span');
        you.className = 'you';
        you.textContent = '(you)';
        name.appendChild(you);
      }
      const sub = document.createElement('div');
      sub.className = 'online-sub';
      sub.textContent = u.online ? 'Online now' : `Last online ${timeAgo(u.last_seen)}`;
      info.append(name, sub);
      row.append(dot, info);
      ol.appendChild(row);
    });

    $('activity-count').textContent = entries.length;
    const al = $('activity-list');
    al.innerHTML = '';
    if (!entries.length) {
      const e = document.createElement('div');
      e.className = 'panel-empty';
      e.textContent = 'No activity yet.';
      al.appendChild(e);
    }
    const secName = SECTION_NAME;
    entries.forEach((en) => {
      const row = document.createElement('div');
      row.className = 'activity-row';
      const text = document.createElement('div');
      text.className = 'activity-text';
      const b = document.createElement('b');
      b.textContent = en.username;
      const act = document.createElement('span');
      act.className = 'act-' + en.action;
      act.textContent = ` ${en.action} `;
      const item = document.createElement('b');
      item.textContent = en.item_name;
      const suffix = en.section === 'board' ? '' : ` ${en.action === 'deleted' ? 'from' : 'in'} ${secName[en.section] || en.section}`;
      text.append(b, act, item, suffix);
      const sub = document.createElement('div');
      sub.className = 'activity-sub';
      sub.textContent = timeAgo(en.created_at);
      row.append(text, sub);
      al.appendChild(row);
    });
  } catch { /* not fatal */ }
}

function catOrder(cat) {
  const idx = CATEGORIES[currentSection].indexOf(cat);
  return idx === -1 ? 999 : idx;
}

function statusClass(s) {
  const t = (s || '').toLowerCase();
  if (t === 'good') return 'status-good';
  if (t === 'vacant') return 'status-vacant';
  if (t.includes('approval') || t.includes('pending')) return 'status-warn';
  return 'status-bad';
}

function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const cat = $('category-filter').value;
  const status = $('status-filter').value;
  const isVirtual = !!VIRTUAL_PACK[currentSection];
  const list = $('list');
  list.innerHTML = '';

  if (isVirtual) {
    $('gender-count-male').textContent = items.filter((it) => it.section === 'male').length;
    $('gender-count-female').textContent = items.filter((it) => it.section === 'female').length;
  }

  const filtered = items.filter((it) =>
    (!isVirtual || it.section === currentGender) &&
    (!cat || it.category === cat) &&
    (!status || (it.status || '').toLowerCase() === status.toLowerCase()) &&
    (!q || [it.name, it.category, it.drawable, it.texture, it.gang, it.pack, it.status, it.notes, it.added_by]
      .join(' ').toLowerCase().includes(q))
  );

  $('empty-state').classList.toggle('hidden', filtered.length > 0);
  $('result-info').textContent = filtered.length
    ? `${filtered.length} item${filtered.length === 1 ? '' : 's'}${filtered.length !== items.length ? ` (of ${items.length})` : ''}`
    : '';

  // group by category, in the defined order
  const groups = new Map();
  filtered.forEach((it) => {
    if (!groups.has(it.category)) groups.set(it.category, []);
    groups.get(it.category).push(it);
  });
  const sortedCats = [...groups.keys()].sort((a, b) => catOrder(a) - catOrder(b) || a.localeCompare(b));

  // while searching/filtering, open all groups so matches are visible;
  // otherwise categories stay closed until the user opens them
  const filtersActive = !!(q || cat || status);

  sortedCats.forEach((catName) => {
    const group = document.createElement('div');
    const open = filtersActive || expandedCats.has(catName);
    group.className = 'cat-group' + (open ? '' : ' collapsed');

    const head = document.createElement('button');
    head.className = 'cat-head';
    head.type = 'button';
    const rows = groups.get(catName);
    head.innerHTML = `<span class="chev">▼</span><span></span><span class="cat-count"></span>`;
    head.children[1].textContent = catName;
    head.children[2].textContent = rows.length;
    head.onclick = () => {
      expandedCats.has(catName) ? expandedCats.delete(catName) : expandedCats.add(catName);
      group.classList.toggle('collapsed');
    };
    group.appendChild(head);

    const rowsWrap = document.createElement('div');
    rowsWrap.className = 'cat-rows';
    rows.forEach((it) => {
      rowsWrap.appendChild(makeRow(it));
      rowsWrap.appendChild(makeDetail(it));
    });
    group.appendChild(rowsWrap);
    list.appendChild(group);
  });
}

function makeRow(it) {
  const row = document.createElement('div');
  row.className = 'item-row';

  // thumbnail
  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  if (it.image) {
    const img = document.createElement('img');
    img.src = it.image;
    img.loading = 'lazy';
    img.onerror = () => { thumb.innerHTML = ICON_IMG; };
    thumb.appendChild(img);
  } else {
    thumb.innerHTML = ICON_IMG;
  }
  row.appendChild(thumb);

  // slot chip
  const slot = document.createElement('span');
  slot.className = 'slot-chip' + (it.drawable ? '' : ' empty');
  slot.textContent = it.drawable ? `[${it.drawable}]` : '—';
  row.appendChild(slot);

  // name + sub
  const main = document.createElement('div');
  main.className = 'item-main';
  const name = document.createElement('div');
  name.className = 'item-name';
  name.textContent = it.name;
  main.appendChild(name);
  if (it.notes) {
    const sub = document.createElement('div');
    sub.className = 'item-sub';
    sub.textContent = it.notes;
    main.appendChild(sub);
  }
  row.appendChild(main);

  // chips
  const chips = document.createElement('div');
  chips.className = 'chips';
  if (it.gang) chips.appendChild(makeChip(it.gang, 'chip gang'));
  if (it.texture) chips.appendChild(makeChip(currentSection === 'ped' ? it.texture : `${it.texture} tex`, 'chip tex'));
  if (it.status) chips.appendChild(makeChip(it.status, 'status-chip ' + statusClass(it.status)));
  row.appendChild(chips);

  // added by
  const by = document.createElement('span');
  by.className = 'added-by';
  by.textContent = it.added_by;
  by.title = `Added by ${it.added_by}`;
  row.appendChild(by);

  // actions
  const actions = document.createElement('div');
  actions.className = 'row-actions';
  if (me && it.added_by === me.username) {
    const editBtn = document.createElement('button');
    editBtn.className = 'icon-btn';
    editBtn.innerHTML = ICON_EDIT;
    editBtn.title = 'Edit';
    editBtn.onclick = (e) => { e.stopPropagation(); openModal(it); };
    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn danger';
    delBtn.innerHTML = ICON_TRASH;
    delBtn.title = 'Delete';
    delBtn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${it.name}"?`)) return;
      await api(`/api/items/${it.id}`, { method: 'DELETE' }).catch((er) => alert(er.message));
      loadItems();
    };
    actions.append(editBtn, delBtn);
  }
  row.appendChild(actions);

  row.onclick = () => row.classList.toggle('expanded');
  return row;
}

function makeDetail(it) {
  const d = document.createElement('div');
  d.className = 'item-detail';
  if (it.image) {
    const img = document.createElement('img');
    img.src = it.image;
    img.loading = 'lazy';
    d.appendChild(img);
  }
  const text = document.createElement('div');
  text.className = 'detail-text';
  const parts = [];
  if (it.drawable) parts.push(`${currentSection === 'ped' ? 'Model' : 'File / drawable'}: ${it.drawable}`);
  if (it.texture) parts.push(`Textures: ${it.texture}`);
  if (it.status) parts.push(`Status: ${it.status}`);
  if (it.gang) parts.push(`Gang: ${it.gang}`);
  if (it.pack) parts.push(`Pack: ${it.pack}`);
  parts.push(`Added by ${it.added_by} on ${(it.created_at || '').slice(0, 10)}`);
  if (it.notes) parts.push('', it.notes);
  text.textContent = parts.join('\n');
  d.appendChild(text);
  return d;
}

function makeChip(text, cls) {
  const b = document.createElement('span');
  b.className = cls;
  b.textContent = text;
  return b;
}

// ---------------- Add / edit modal ----------------
function openModal(item) {
  editingId = item ? item.id : null;
  const isPed = currentSection === 'ped';
  const isGang = currentSection === 'gang';
  const isVirtual = !!VIRTUAL_PACK[currentSection]; // Factions / Paid tabs
  $('modal-title').textContent = `${item ? 'Edit' : 'Add'} ${SECTION_LABEL[currentSection]}`;
  $('drawable-label').textContent = isPed ? 'Model name / hash' : 'File / Drawable #';
  $('item-drawable').placeholder = isPed ? 'e.g. a_c_husky' : 'e.g. 015';
  $('texture-wrap').style.display = isPed ? 'none' : '';
  $('status-wrap').style.display = isPed ? 'none' : '';
  $('gang-wrap').style.display = isGang ? '' : 'none';
  $('gender-wrap').style.display = isVirtual ? '' : 'none';
  $('item-gender').value = item ? item.section : currentGender;

  const modalCats = CATEGORIES[currentSection];

  const sel = $('item-category');
  sel.innerHTML = '';
  modalCats.forEach((c) => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  });
  const custom = document.createElement('option');
  custom.value = '__custom__'; custom.textContent = 'Custom category...';
  sel.appendChild(custom);
  $('item-category-custom').classList.add('hidden');
  $('item-category-custom').value = '';

  $('item-name').value = item ? item.name : '';
  $('item-drawable').value = item ? item.drawable : '';
  $('item-texture').value = item ? item.texture : '';
  $('item-status').value = item ? item.status : (isPed ? '' : 'Good');
  $('item-gang').value = item ? item.gang : '';
  $('item-notes').value = item ? item.notes : '';
  $('item-image-url').value = '';
  $('item-image-file').value = '';
  $('item-error').classList.add('hidden');
  pendingImage = item ? item.image : '';

  if (item) {
    if (modalCats.includes(item.category)) {
      sel.value = item.category;
    } else {
      sel.value = '__custom__';
      $('item-category-custom').classList.remove('hidden');
      $('item-category-custom').value = item.category;
    }
  } else {
    // default to the currently filtered category
    const filterCat = $('category-filter').value;
    if (filterCat && modalCats.includes(filterCat)) sel.value = filterCat;
  }
  updateImagePreview();
  $('modal-backdrop').classList.remove('hidden');
  $('item-name').focus();
}

$('item-category').onchange = () => {
  const isCustom = $('item-category').value === '__custom__';
  $('item-category-custom').classList.toggle('hidden', !isCustom);
  if (isCustom) $('item-category-custom').focus();
};

$('add-btn').onclick = () => openModal(null);
$('modal-cancel').onclick = () => $('modal-backdrop').classList.add('hidden');
$('modal-backdrop').onclick = (e) => {
  if (e.target === $('modal-backdrop')) $('modal-backdrop').classList.add('hidden');
};

// Image handling: file -> resized data URL, or plain URL
$('item-image-file').onchange = () => {
  const file = $('item-image-file').files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    const MAX = 700;
    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    pendingImage = canvas.toDataURL('image/jpeg', 0.85);
    $('item-image-url').value = '';
    updateImagePreview();
  };
  img.onerror = () => alert('Could not read that image file');
  img.src = URL.createObjectURL(file);
};

$('item-image-url').oninput = () => {
  pendingImage = $('item-image-url').value.trim();
  updateImagePreview();
};

$('img-remove').onclick = () => {
  pendingImage = '';
  $('item-image-file').value = '';
  $('item-image-url').value = '';
  updateImagePreview();
};

function updateImagePreview() {
  const has = !!pendingImage;
  $('img-preview-wrap').classList.toggle('hidden', !has);
  if (has) $('img-preview').src = pendingImage;
}

$('item-form').onsubmit = async (e) => {
  e.preventDefault();
  let category = $('item-category').value;
  if (category === '__custom__') category = $('item-category-custom').value.trim();
  const isVirtual = !!VIRTUAL_PACK[currentSection];
  // pack follows the tab: Male/Female = Base, Factions/Paid tabs = that pack
  const pack = isVirtual ? VIRTUAL_PACK[currentSection]
    : (currentSection === 'male' || currentSection === 'female') ? 'Base' : '';
  const body = {
    section: isVirtual ? $('item-gender').value : currentSection,
    name: $('item-name').value.trim(),
    category,
    drawable: $('item-drawable').value.trim(),
    texture: $('item-texture').value.trim(),
    status: $('item-status').value,
    gang: $('item-gang').value.trim(),
    pack,
    image: pendingImage,
    notes: $('item-notes').value.trim(),
  };
  try {
    if (editingId) {
      await api(`/api/items/${editingId}`, { method: 'PUT', body });
    } else {
      await api('/api/items', { method: 'POST', body });
    }
    $('modal-backdrop').classList.add('hidden');
    loadItems();
  } catch (err) {
    $('item-error').textContent = err.message;
    $('item-error').classList.remove('hidden');
  }
};

// ---------------- Startup ----------------
function refresh() {
  if (currentSection === 'home') loadHome();
  else loadItems();
}

function showApp() {
  $('auth-screen').classList.add('hidden');
  $('app-screen').classList.remove('hidden');
  $('whoami').textContent = me.username;
  setSection('home');
  // keep everyone in sync: re-fetch every 15s and when the tab regains focus
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (!document.hidden && $('modal-backdrop').classList.contains('hidden')) refresh();
  }, 15000);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && me) refresh();
});

(async () => {
  try {
    const data = await api('/api/me');
    if (data.user) {
      me = { username: data.user.username, id: data.user.id };
      showApp();
      return;
    }
  } catch { /* fall through to login */ }
  $('auth-screen').classList.remove('hidden');
})();
