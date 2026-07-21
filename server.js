// FiveM Clothing Tracker - zero-dependency Node.js server
// Uses built-in node:http, node:sqlite and node:crypto (no npm packages needed)
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');

// ---------- Database ----------
// DB_PATH lets cloud hosts (e.g. Render persistent disks) store the DB elsewhere
const db = new DatabaseSync(process.env.DB_PATH || path.join(ROOT, 'data.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    section TEXT NOT NULL CHECK (section IN ('male','female','gang','ped')),
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    drawable TEXT DEFAULT '',
    texture TEXT DEFAULT '',
    pack TEXT DEFAULT '',
    status TEXT DEFAULT '',
    gang TEXT DEFAULT '',
    image TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS board (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    content TEXT NOT NULL DEFAULT '',
    updated_by INTEGER,
    updated_at TEXT
  );
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    item_name TEXT NOT NULL,
    section TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migration: older DBs lack users.last_seen
{
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('last_seen')) {
    db.exec("ALTER TABLE users ADD COLUMN last_seen TEXT DEFAULT ''");
  }
}

// Migration: older DBs lack pack/status/gang and the 'gang' section
{
  const cols = db.prepare('PRAGMA table_info(items)').all().map((c) => c.name);
  if (!cols.includes('pack')) {
    db.exec(`
      BEGIN;
      ALTER TABLE items RENAME TO items_old;
      CREATE TABLE items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        section TEXT NOT NULL CHECK (section IN ('male','female','gang','ped')),
        category TEXT NOT NULL,
        name TEXT NOT NULL,
        drawable TEXT DEFAULT '',
        texture TEXT DEFAULT '',
        pack TEXT DEFAULT '',
        status TEXT DEFAULT '',
        gang TEXT DEFAULT '',
        image TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO items (id, user_id, section, category, name, drawable, texture, image, notes, created_at)
        SELECT id, user_id, section, category, name, drawable, texture, image, notes, created_at FROM items_old;
      DROP TABLE items_old;
      COMMIT;
    `);
  }
}

// ---------- Auth helpers ----------
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  return token;
}

function getUserFromRequest(req) {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/(?:^|;\s*)session=([a-f0-9]{64})/);
  if (!match) return null;
  const row = db.prepare(`
    SELECT u.id, u.username FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(match[1]);
  if (!row) return null;
  db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").run(row.id);
  return { id: row.id, username: row.username, token: match[1] };
}

function logActivity(userId, action, itemName, section) {
  db.prepare('INSERT INTO activity (user_id, action, item_name, section) VALUES (?, ?, ?, ?)')
    .run(userId, action, itemName, section);
}

// ---------- HTTP helpers ----------
function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 6 * 1024 * 1024) { // 6 MB cap (images are stored as data URLs)
        reject(new Error('too_large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('bad_json'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, urlPath) {
  let filePath = urlPath === '/' ? '/index.html' : urlPath;
  filePath = path.normalize(path.join(PUBLIC_DIR, filePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA-style fallback to index.html for unknown paths
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, index) => {
        if (err2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(index);
      });
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache', // always revalidate so UI updates reach everyone
    });
    res.end(data);
  });
}

const VALID_SECTIONS = ['male', 'female', 'gang', 'ped'];

function itemFields(b, fallback = {}) {
  return {
    category: String(b.category ?? fallback.category ?? '').trim(),
    name: String(b.name ?? fallback.name ?? '').trim(),
    drawable: String(b.drawable ?? fallback.drawable ?? '').trim(),
    texture: String(b.texture ?? fallback.texture ?? '').trim(),
    pack: String(b.pack ?? fallback.pack ?? '').trim(),
    status: String(b.status ?? fallback.status ?? '').trim(),
    gang: String(b.gang ?? fallback.gang ?? '').trim(),
    image: String(b.image ?? fallback.image ?? ''),
    notes: String(b.notes ?? fallback.notes ?? '').trim(),
  };
}

// ---------- Server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  try {
    // ----- Auth endpoints -----
    if (p === '/api/register' && req.method === 'POST') {
      const { username, password } = await readBody(req);
      const name = String(username || '').trim();
      if (name.length < 2 || name.length > 24 || !/^[\w .-]+$/.test(name)) {
        return sendJson(res, 400, { error: 'Username must be 2-24 characters (letters, numbers, spaces, . _ -)' });
      }
      if (!password || String(password).length < 4) {
        return sendJson(res, 400, { error: 'Password must be at least 4 characters' });
      }
      const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(name);
      if (exists) return sendJson(res, 409, { error: 'That username is already taken' });
      const salt = crypto.randomBytes(16).toString('hex');
      const info = db.prepare('INSERT INTO users (username, pass_hash, salt) VALUES (?, ?, ?)')
        .run(name, hashPassword(String(password), salt), salt);
      const token = createSession(Number(info.lastInsertRowid));
      return sendJson(res, 200, { username: name }, {
        'Set-Cookie': `session=${token}; HttpOnly; Path=/; Max-Age=31536000; SameSite=Lax`,
      });
    }

    if (p === '/api/login' && req.method === 'POST') {
      const { username, password } = await readBody(req);
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
      if (!user || hashPassword(String(password || ''), user.salt) !== user.pass_hash) {
        return sendJson(res, 401, { error: 'Wrong username or password' });
      }
      const token = createSession(user.id);
      return sendJson(res, 200, { username: user.username }, {
        'Set-Cookie': `session=${token}; HttpOnly; Path=/; Max-Age=31536000; SameSite=Lax`,
      });
    }

    if (p === '/api/logout' && req.method === 'POST') {
      const user = getUserFromRequest(req);
      if (user) db.prepare('DELETE FROM sessions WHERE token = ?').run(user.token);
      return sendJson(res, 200, { ok: true }, {
        'Set-Cookie': 'session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax',
      });
    }

    if (p === '/api/me' && req.method === 'GET') {
      const user = getUserFromRequest(req);
      return sendJson(res, 200, { user: user ? { id: user.id, username: user.username } : null });
    }

    // ----- Item / sidebar endpoints (require login) -----
    if (['/api/counts', '/api/online', '/api/activity', '/api/board'].includes(p) || p.startsWith('/api/items')) {
      const user = getUserFromRequest(req);
      if (!user) return sendJson(res, 401, { error: 'Not logged in' });

      if (p === '/api/board' && req.method === 'GET') {
        const row = db.prepare(`
          SELECT b.content, b.updated_at, u.username AS updated_by
          FROM board b LEFT JOIN users u ON u.id = b.updated_by
          WHERE b.id = 1
        `).get();
        return sendJson(res, 200, { board: row || { content: '', updated_at: null, updated_by: null } });
      }

      if (p === '/api/board' && req.method === 'PUT') {
        const b = await readBody(req);
        const content = String(b.content || '').slice(0, 5000);
        db.prepare(`
          INSERT INTO board (id, content, updated_by, updated_at) VALUES (1, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET content = excluded.content,
            updated_by = excluded.updated_by, updated_at = excluded.updated_at
        `).run(content, user.id);
        logActivity(user.id, 'updated', 'the info board', 'board');
        return sendJson(res, 200, { ok: true });
      }

      if (p === '/api/counts' && req.method === 'GET') {
        // Male/Female tabs only show Base items; Factions/Paid/Gang packs have their own tabs
        const counts = {
          male: db.prepare("SELECT COUNT(*) AS n FROM items WHERE section = 'male' AND pack NOT IN ('Factions','Paid','Gang')").get().n,
          female: db.prepare("SELECT COUNT(*) AS n FROM items WHERE section = 'female' AND pack NOT IN ('Factions','Paid','Gang')").get().n,
          factions: db.prepare("SELECT COUNT(*) AS n FROM items WHERE pack = 'Factions'").get().n,
          paid: db.prepare("SELECT COUNT(*) AS n FROM items WHERE pack = 'Paid'").get().n,
          gang: db.prepare("SELECT COUNT(*) AS n FROM items WHERE pack = 'Gang'").get().n,
          ped: db.prepare("SELECT COUNT(*) AS n FROM items WHERE section = 'ped'").get().n,
        };
        return sendJson(res, 200, { counts });
      }

      if (p === '/api/online' && req.method === 'GET') {
        const users = db.prepare(`
          SELECT username, last_seen,
            CASE WHEN last_seen >= datetime('now', '-2 minutes') THEN 1 ELSE 0 END AS online
          FROM users
          ORDER BY online DESC, last_seen DESC
        `).all();
        return sendJson(res, 200, { users });
      }

      if (p === '/api/activity' && req.method === 'GET') {
        const entries = db.prepare(`
          SELECT a.action, a.item_name, a.section, a.created_at, u.username
          FROM activity a JOIN users u ON u.id = a.user_id
          ORDER BY a.id DESC LIMIT 30
        `).all();
        return sendJson(res, 200, { entries });
      }

      if (p === '/api/items' && req.method === 'GET') {
        const section = url.searchParams.get('section');
        const VIRTUAL = { factions: 'Factions', paid: 'Paid', gang: 'Gang' };
        if (VIRTUAL[section]) {
          // virtual sections: all male + female items from that pack
          const items = db.prepare(`
            SELECT i.*, u.username AS added_by FROM items i
            JOIN users u ON u.id = i.user_id
            WHERE i.pack = ?
            ORDER BY i.section, i.category, i.drawable, i.name COLLATE NOCASE
          `).all(VIRTUAL[section]);
          return sendJson(res, 200, { items, me: user.id });
        }
        if (!VALID_SECTIONS.includes(section)) return sendJson(res, 400, { error: 'Bad section' });
        if (section === 'male' || section === 'female') {
          // Factions/Paid/Gang items live in their own tabs
          const items = db.prepare(`
            SELECT i.*, u.username AS added_by FROM items i
            JOIN users u ON u.id = i.user_id
            WHERE i.section = ? AND i.pack NOT IN ('Factions','Paid','Gang')
            ORDER BY i.category, i.drawable, i.name COLLATE NOCASE
          `).all(section);
          return sendJson(res, 200, { items, me: user.id });
        }
        const items = db.prepare(`
          SELECT i.*, u.username AS added_by FROM items i
          JOIN users u ON u.id = i.user_id
          WHERE i.section = ?
          ORDER BY i.category, i.drawable, i.name COLLATE NOCASE
        `).all(section);
        return sendJson(res, 200, { items, me: user.id });
      }

      if (p === '/api/items' && req.method === 'POST') {
        const b = await readBody(req);
        if (!VALID_SECTIONS.includes(b.section)) return sendJson(res, 400, { error: 'Bad section' });
        const f = itemFields(b);
        if (!f.name) return sendJson(res, 400, { error: 'Name is required' });
        if (!f.category) return sendJson(res, 400, { error: 'Category is required' });
        const info = db.prepare(`
          INSERT INTO items (user_id, section, category, name, drawable, texture, pack, status, gang, image, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(user.id, b.section, f.category, f.name, f.drawable, f.texture, f.pack, f.status, f.gang, f.image, f.notes);
        logActivity(user.id, 'added', f.name, b.section);
        return sendJson(res, 200, { id: Number(info.lastInsertRowid) });
      }

      const idMatch = p.match(/^\/api\/items\/(\d+)$/);
      if (idMatch) {
        const id = Number(idMatch[1]);
        const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
        if (!item) return sendJson(res, 404, { error: 'Item not found' });
        if (item.user_id !== user.id) return sendJson(res, 403, { error: 'You can only change items you added' });

        if (req.method === 'PUT') {
          const b = await readBody(req);
          const f = itemFields(b, item);
          const section = VALID_SECTIONS.includes(b.section) ? b.section : item.section;
          if (!f.name || !f.category) return sendJson(res, 400, { error: 'Name and category are required' });
          db.prepare(`
            UPDATE items SET section = ?, category = ?, name = ?, drawable = ?, texture = ?, pack = ?, status = ?, gang = ?, image = ?, notes = ?
            WHERE id = ?
          `).run(section, f.category, f.name, f.drawable, f.texture, f.pack, f.status, f.gang, f.image, f.notes, id);
          logActivity(user.id, 'edited', f.name, section);
          return sendJson(res, 200, { ok: true });
        }
        if (req.method === 'DELETE') {
          db.prepare('DELETE FROM items WHERE id = ?').run(id);
          logActivity(user.id, 'deleted', item.name, item.section);
          return sendJson(res, 200, { ok: true });
        }
      }
      return sendJson(res, 404, { error: 'Unknown API route' });
    }

    if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'Unknown API route' });

    // ----- Static files -----
    serveStatic(req, res, p);
  } catch (err) {
    if (err.message === 'too_large') return sendJson(res, 413, { error: 'Upload too large (max 6 MB) - use a smaller image' });
    if (err.message === 'bad_json') return sendJson(res, 400, { error: 'Bad request' });
    console.error(err);
    sendJson(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('==============================================');
  console.log('  FiveM Clothing Tracker is running!');
  console.log(`  Open:  http://localhost:${PORT}`);
  console.log('  Other people on your network can use your');
  console.log(`  PC's IP address, e.g. http://<your-ip>:${PORT}`);
  console.log('==============================================');
});
