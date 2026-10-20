require("dotenv").config();
const express = require("express");
const http = require("http");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");
const QRCode = require("qrcode");
const { createClient } = require("@supabase/supabase-js");
const OT = require("./public/ot.js");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// ---------- limits ----------
const MAX_CODE_LENGTH = 80000;
const SAVE_DELAY_MS = 500;
const EVICT_AFTER_MS = 5 * 60 * 1000;
const ROOM_ID_RE = /^[A-Za-z0-9_-]{6,40}$/;
const CLIENT_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const MAX_PARTICIPANTS = 30;
const LOG_KEEP = 1000;          // ops kept to merge late edits
const HISTORY_MEMORY = 300;     // entries kept in memory per room
const HISTORY_KEEP_DB = 1000;   // entries kept in the database per room
const HISTORY_FIRST_PAGE = 50;
const COALESCE_MS = 8000;       // typing by one person within this window becomes one history entry
const SNIPPET_MAX_CHARS = 4000;
const SNIPPET_MAX_LINES = 60;
const ROLES = ["admin", "moderator"];                       // the only roles that can be given; "developer" is never a role
const roleOf = (id, role) => (Number(id) === DEV_ID ? null : ROLES.includes(role) ? role : null);
const DEV_ID = Number(process.env.DEVELOPER_USER_ID || 1);   // the developer account (user #1 unless you change it in .env)
const PALETTE = ["#e8a33d", "#3fb8af", "#6fa8ff", "#b58cff", "#7bd88f", "#ff7eb6", "#d4d46a", "#f08a5d"];

// ---------- encryption at rest (AES-256-GCM) ----------
const DEV_MEMORY = process.env.DEV_MEMORY_DB === "1";
function loadKey() {
  const raw = (process.env.ENCRYPTION_KEY || "").trim();
  if (!raw) return null;
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : null;
}
let KEY = loadKey();
if (!KEY) {
  if (DEV_MEMORY) {
    KEY = crypto.randomBytes(32);
    console.warn("[CodeRelay] DEV mode: using a temporary encryption key. Data is kept in memory only.");
  } else {
    console.error("\n[CodeRelay] ENCRYPTION_KEY is missing or not 32 bytes. Refusing to start without encryption at rest.");
    console.error("[CodeRelay] Create one with:  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"");
    console.error("[CodeRelay] Put it in .env (or your host's environment variables) as ENCRYPTION_KEY, and keep a backup: lost key = unreadable workspaces.\n");
    process.exit(1);
  }
}
const PREFIX = "enc:v1:";
function seal(text, aad) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
function open(text, aad) {
  if (typeof text !== "string" || !text.startsWith(PREFIX)) return text || ""; // rows saved before encryption was added
  const buf = Buffer.from(text.slice(PREFIX.length), "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, buf.subarray(0, 12));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

// ---------- database (Supabase, or memory for local development) ----------
const isMissingTable = e => Boolean(e) && (e.code === "PGRST205" || e.code === "42P01" || /schema cache|does not exist/i.test(e.message || ""));
let warnedHistory = false;
function warnHistoryMissing() {
  if (warnedHistory) return; warnedHistory = true;
  console.error("\n[CodeRelay] The table public.room_history does not exist yet, so change history is not being saved.");
  console.error("[CodeRelay] Fix: Supabase > SQL Editor > paste supabase/schema.sql > Run. Your workspaces keep working meanwhile.\n");
}
function supabaseDb() {
  const c = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const chk = ({ error, data }) => { if (error) throw error; return data; };
  return {
    async getRoom(id) { return chk(await c.from("rooms").select("*").eq("id", id).maybeSingle()); },
    async upsertRoom(row) { chk(await c.from("rooms").upsert(row)); },
    async listHistory(id, beforeMs, limit) {
      let q = c.from("room_history").select("*").eq("room_id", id).order("ts", { ascending: false }).limit(limit);
      if (beforeMs) q = q.lt("ts", new Date(beforeMs).toISOString());
      const { data, error } = await q;
      if (error) { if (isMissingTable(error)) { warnHistoryMissing(); return []; } throw error; }
      return data || [];
    },
    async upsertHistory(rows) { if (rows.length) chk(await c.from("room_history").upsert(rows)); },
    async getUserByHash(h) { return chk(await c.from("users").select("id,name,role").eq("token_hash", h).maybeSingle()); },
    async getUserById(id) { return chk(await c.from("users").select("id,name,role").eq("id", id).maybeSingle()); },
    async setUserRole(id, role) { chk(await c.from("users").update({ role }).eq("id", id)); },
    async searchUsers(q) {
      const rows = new Map(), add = d => (d || []).forEach(r => rows.set(Number(r.id), r));
      if (/^#?\d{1,15}$/.test(q)) add(chk(await c.from("users").select("id,name,role").eq("id", Number(q.replace("#", ""))).limit(1)));
      add(chk(await c.from("users").select("id,name,role").ilike("name", "%" + q.replace(/[\\%_]/g, "\\$&") + "%").order("id").limit(10)));
      return [...rows.values()].slice(0, 10);
    },
    async createUser(h, name) {
      const { data, error } = await c.from("users").insert({ token_hash: h, name }).select("id,name,role").single();
      if (error) { if (error.code === "23505") throw Object.assign(new Error("taken"), { taken: true }); throw error; }
      return data;
    },
    async nameTaken(name) {
      // PostgREST treats "*" as a wildcard, so "No*" would match "Noitsnot". Match "*" as any one character, then confirm an exact (case-insensitive) match here.
      const pat = name.replace(/[\\%_]/g, "\\$&").replace(/\*/g, "_");
      const rows = chk(await c.from("users").select("name").ilike("name", pat).limit(50));
      const k = name.toLowerCase();
      return rows.some(r => String(r.name).toLowerCase() === k);
    },
    async deleteRoom(id) {
      chk(await c.from("rooms").delete().eq("id", id));
      const h = await c.from("room_history").delete().eq("room_id", id);
      if (h.error && !isMissingTable(h.error)) throw h.error;
    },
    async pruneHistory(id, keep) {
      const r = await c.from("room_history").select("id").eq("room_id", id).order("ts", { ascending: false }).range(keep, keep + 499);
      if (r.error) { if (isMissingTable(r.error)) return; throw r.error; }
      if (r.data.length) chk(await c.from("room_history").delete().in("id", r.data.map(x => x.id)));
    }
  };
}
function memoryDb() {
  const rooms = new Map(), hist = new Map(), users = new Map(); let nextUser = 1;
  return {
    async getRoom(id) { return rooms.get(id) || null; },
    async upsertRoom(row) { rooms.set(row.id, { ...row }); },
    async listHistory(id, beforeMs, limit) {
      return [...(hist.get(id) || new Map()).values()].filter(r => !beforeMs || new Date(r.ts).getTime() < beforeMs)
        .sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, limit);
    },
    async upsertHistory(rows) { for (const r of rows) { if (!hist.has(r.room_id)) hist.set(r.room_id, new Map()); hist.get(r.room_id).set(r.id, { ...r }); } },
    async getUserByHash(h) { return users.get(h) || null; },
    async getUserById(id) { return [...users.values()].find(u => u.id === id) || null; },
    async setUserRole(id, role) { const u = [...users.values()].find(x => x.id === id); if (u) u.role = role; },
    async searchUsers(q) {
      const k = q.toLowerCase(), n = /^#?\d{1,15}$/.test(q) ? Number(q.replace("#", "")) : null;
      return [...users.values()].filter(u => u.id === n || u.name.toLowerCase().includes(k)).slice(0, 10).map(u => ({ id: u.id, name: u.name, role: u.role || null }));
    },
    async nameTaken(name) { return [...users.values()].some(u => u.name.toLowerCase() === name.toLowerCase()); },
    async createUser(h, name) {
      if (await this.nameTaken(name)) throw Object.assign(new Error("taken"), { taken: true });
      const row = { id: nextUser++, name, role: null }; users.set(h, row); return row;
    },
    async pruneHistory() {},
    async deleteRoom(id) { rooms.delete(id); hist.delete(id); }
  };
}
const db = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseDb() : DEV_MEMORY ? memoryDb() : null;
if (!db) {
  console.error("\n[CodeRelay] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.");
  console.error("[CodeRelay] Copy .env.example to .env and fill them in. Workspaces cannot be created until then.\n");
}

// ---------- hardening: proxy, https, headers ----------
app.disable("x-powered-by");
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);
else if (process.env.RENDER) app.set("trust proxy", 1);   // on Render every request comes through its proxy; without this all visitors share one rate-limit bucket
app.use((req, res, next) => {
  if (process.env.FORCE_HTTPS === "1" && !req.secure) return res.redirect(308, "https://" + req.headers.host + req.originalUrl);
  next();
});
const hostOk = h => /^[A-Za-z0-9.\-:\[\]]{1,255}$/.test(h || "");
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",               // room links are secrets; never leak them in Referer
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin"
  });
  if (req.secure) res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (req.path === "/runner") {
    // The runner executes teammates' code. It is sandboxed into an opaque origin: no cookies,
    // no localStorage, no access to this site, and no network except the Python runtime CDN.
    res.set({
      "X-Frame-Options": "SAMEORIGIN",
      "Content-Security-Policy": [
        "sandbox allow-scripts", "default-src 'none'",
        "script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net",
        "worker-src blob:", "connect-src https://cdn.jsdelivr.net", "style-src 'unsafe-inline'",
        "img-src data: blob: https:", "font-src data:", "frame-src about: blob: data:", "frame-ancestors 'self'"
      ].join("; ")
    });
  } else {
    const h = hostOk(req.headers.host) ? req.headers.host : "localhost";
    res.set({
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": [
        "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:", `connect-src 'self' ws://${h} wss://${h}`,
        "frame-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"
      ].join("; ")
    });
  }
  next();
});
app.use(express.json({ limit: "100kb" }));

// ---------- rate limiting (no extra dependency) ----------
const mkBucket = (rate, burst) => ({ rate, burst, tokens: burst, last: Date.now() });
function take(b) {
  const now = Date.now();
  b.tokens = Math.min(b.burst, b.tokens + ((now - b.last) / 1000) * b.rate);
  b.last = now;
  if (b.tokens >= 1) { b.tokens -= 1; return true; }
  return false;
}
const ipBuckets = new Map();
function ipLimit(name, rate, burst) {
  return (req, res, next) => {
    const k = name + ":" + req.ip;
    let e = ipBuckets.get(k);
    if (!e) ipBuckets.set(k, e = { b: mkBucket(rate, burst), seen: Date.now() });
    e.seen = Date.now();
    if (!take(e.b)) return res.status(429).json({ error: "Too many requests. Please wait a moment and try again." });
    next();
  };
}
setInterval(() => { const cut = Date.now() - 10 * 60 * 1000; for (const [k, e] of ipBuckets) if (e.seen < cut) ipBuckets.delete(k); }, 60000).unref();

// ---------- favicon (auto-detected from ./favicon) ----------
const FAVICON_DIR = path.join(__dirname, "favicon");
const FAVICON_TYPES = { ".ico": "image/x-icon", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const DEFAULT_FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#1f1f23"/><g fill="none" stroke="#d9303e" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M25 20 13 32l12 12"/><path d="M39 20l12 12-12 12"/></g></svg>`;
function findFavicon() {
  try {
    const files = fs.readdirSync(FAVICON_DIR)
      .filter(f => !f.startsWith(".") && FAVICON_TYPES[path.extname(f).toLowerCase()])
      .sort((a, b) => Number(b.toLowerCase().startsWith("favicon")) - Number(a.toLowerCase().startsWith("favicon")) || a.localeCompare(b));
    return files.length ? path.join(FAVICON_DIR, files[0]) : null;
  } catch { return null; }
}
app.get(["/favicon", "/favicon.ico"], (_req, res) => {
  res.set("Cache-Control", "no-cache");
  const file = findFavicon();
  if (file) return res.type(FAVICON_TYPES[path.extname(file).toLowerCase()]).sendFile(file);
  res.type("image/svg+xml").send(DEFAULT_FAVICON);
});
app.get("/runner", (_req, res) => { res.set("Cache-Control", "no-store"); res.sendFile(path.join(__dirname, "views", "runner.html")); });
app.use(express.static(path.join(__dirname, "public"), { index: "index.html" }));

// ---------- helpers ----------
const rooms = new Map();
const loading = new Map();
const tokenHash = token => crypto.createHash("sha256").update(String(token || "")).digest();
function isOwnerToken(room, token) {
  if (!room || typeof token !== "string" || !token || token.length > 200) return false;
  const actual = tokenHash(token);
  return actual.length === room.ownerTokenHash.length && crypto.timingSafeEqual(actual, room.ownerTokenHash);
}
const lineIndex = (doc, pos) => { let n = 0, i = -1; while ((i = doc.indexOf("\n", i + 1)) !== -1 && i < pos) n++; return n; };
const cleanName = s => String(s || "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 24);
const aidOf = (clientId, roomId) => crypto.createHash("sha256").update(clientId + ":" + roomId).digest("hex").slice(0, 10);

function pickColor(room, clientId) {
  const used = new Set([...room.sockets].map(s => io.sockets.sockets.get(s)?.data.author?.color));
  let h = 0; for (const ch of clientId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  for (let i = 0; i < PALETTE.length; i++) { const c = PALETTE[(h + i) % PALETTE.length]; if (!used.has(c)) return c; }
  return PALETTE[h % PALETTE.length];
}
function peersOf(room) {
  const out = [];
  for (const sid of room.sockets) {
    const s = io.sockets.sockets.get(sid);
    if (s && s.data.author) out.push({ pid: sid, aid: s.data.author.aid, uid: s.data.author.uid, dev: Number(s.data.author.uid) === DEV_ID, role: roleOf(s.data.author.uid, s.data.author.role), name: s.data.author.name, color: s.data.author.color, owner: Boolean(s.data.isOwner), cursor: s.data.cursor || null });
  }
  return out;
}
const entryOut = e => ({ id: e.id, ts: e.ts, aid: e.aid, author: e.author, color: e.color, kind: e.kind, start: e.start, end: e.end, before: e.before, after: e.after, trunc: e.trunc, reverted: e.reverted || false });
function publicState(id, room, socket) {
  return {
    id, code: room.code, language: room.language, rev: room.rev, locked: room.locked,
    isOwner: Boolean(socket.data.isOwner), you: { pid: socket.id, aid: socket.data.author.aid, name: socket.data.author.name, color: socket.data.author.color, dev: Number(socket.data.author.uid) === DEV_ID, role: roleOf(socket.data.author.uid, socket.data.author.role) },
    peers: peersOf(room), history: room.history.slice(-HISTORY_FIRST_PAGE).map(entryOut).reverse(), historyTotal: room.history.length
  };
}

// ---------- persistence ----------
const rowToEntry = r => {
  let p = {}; try { p = JSON.parse(open(r.payload || "", r.room_id + ":h") || "{}"); } catch { p = {}; }
  return { id: r.id, ts: new Date(r.ts).getTime(), aid: r.author_id, author: r.author, color: r.color, kind: r.kind, start: r.start_line, end: r.end_line,
    before: p.before || "", after: p.after || "", trunc: Boolean(p.trunc), reverted: Boolean(p.reverted) };
};
const entryToRow = (roomId, e) => ({
  id: e.id, room_id: roomId, ts: new Date(e.ts).toISOString(), author: e.author, author_id: e.aid, color: e.color, kind: e.kind,
  start_line: e.start, end_line: e.end, payload: seal(JSON.stringify({ before: e.before, after: e.after, trunc: e.trunc, reverted: e.reverted || false }), roomId + ":h"),
  updated_at: new Date().toISOString()
});

async function loadRoom(id) {
  if (rooms.has(id)) return rooms.get(id);
  if (!db || !ROOM_ID_RE.test(id)) return null;
  if (loading.has(id)) return loading.get(id);
  const job = (async () => {
    const data = await db.getRoom(id);
    if (!data) return null;
    const cached = rooms.get(id); if (cached) return cached;
    const hist = (await db.listHistory(id, null, HISTORY_MEMORY)).map(rowToEntry).sort((a, b) => a.ts - b.ts);
    const room = {
      code: open(data.code, id), language: data.language, locked: data.locked,
      ownerTokenHash: Buffer.from(data.owner_token_hash, "hex"), createdAt: new Date(data.created_at).getTime(),
      rev: 0, log: [], lens: [], logStart: 0, sockets: new Set(), history: hist, open: null, entrySeq: 0, newEntries: 0,
      dirty: false, dirtyEntries: new Map(), pendingBroadcast: new Map(), histTimer: null, saveTimer: null, evictTimer: null
    };
    rooms.set(id, room);
    return room;
  })().finally(() => loading.delete(id));
  loading.set(id, job);
  return job;
}
const newRoomObject = (code, language, ownerToken) => ({
  code, language, ownerTokenHash: tokenHash(ownerToken), locked: false, createdAt: Date.now(),
  rev: 0, log: [], lens: [], logStart: 0, sockets: new Set(), history: [], open: null, entrySeq: 0, newEntries: 0,
  dirty: false, dirtyEntries: new Map(), pendingBroadcast: new Map(), histTimer: null, saveTimer: null, evictTimer: null
});
async function saveRoom(id, room) {
  await db.upsertRoom({
    id, code: seal(room.code, id), language: room.language, locked: room.locked,
    owner_token_hash: room.ownerTokenHash.toString("hex"), updated_at: new Date().toISOString()
  });
}
function scheduleSave(id, room, delay = SAVE_DELAY_MS) {
  if (!db) return;
  room.dirty = true;
  clearTimeout(room.saveTimer);
  room.saveTimer = setTimeout(() => flushRoom(id, room), delay);
}
async function flushRoom(id, room) {
  clearTimeout(room.saveTimer);
  if (room.deleted || !db || (!room.dirty && room.dirtyEntries.size === 0)) return;
  const entries = [...room.dirtyEntries.values()], wasDirty = room.dirty;
  room.dirty = false; room.dirtyEntries = new Map();
  let retry = false;
  if (wasDirty) {
    try { await saveRoom(id, room); }
    catch (err) { console.error(`[CodeRelay] Save failed for room ${id}:`, err.message || err); room.dirty = true; retry = true; }
  }
  if (entries.length) {
    try { await db.upsertHistory(entries.map(e => entryToRow(id, e))); if (room.newEntries >= 40) { room.newEntries = 0; await db.pruneHistory(id, HISTORY_KEEP_DB); } }
    catch (err) {
      if (isMissingTable(err)) warnHistoryMissing();      // history can't be stored yet; the workspace itself still saves
      else { console.error(`[CodeRelay] History save failed for room ${id}:`, err.message || err); for (const e of entries) room.dirtyEntries.set(e.id, e); retry = true; }
    }
  }
  if (retry) room.saveTimer = setTimeout(() => flushRoom(id, room), 3000);
}
function maybeEvict(id, room) {
  clearTimeout(room.evictTimer);
  if (room.sockets.size > 0) return;
  room.evictTimer = setTimeout(async () => {
    if (room.sockets.size > 0) return;
    await flushRoom(id, room);
    if (!room.dirty && room.dirtyEntries.size === 0 && room.sockets.size === 0) rooms.delete(id);
  }, EVICT_AFTER_MS);
}
const flushAll = () => Promise.all([...rooms].map(([id, room]) => flushRoom(id, room)));

// ---------- history ----------
function snippet(doc, from, to) {
  const lines = doc.split("\n").slice(from, to + 1);
  let trunc = false;
  if (lines.length > SNIPPET_MAX_LINES) { lines.length = SNIPPET_MAX_LINES; trunc = true; }
  let s = lines.join("\n");
  if (s.length > SNIPPET_MAX_CHARS) { s = s.slice(0, SNIPPET_MAX_CHARS); trunc = true; }
  return { text: s, trunc };
}
// Lines of `after` that differ from `base`, expanded to whole lines.
function region(base, after) {
  const [h] = OT.hunks(base, OT.fromDiff(base, after));
  if (!h) return null;
  const bFrom = lineIndex(base, h.pos), bTo = lineIndex(base, h.pos + h.del.length);
  const aFrom = lineIndex(after, h.pos), aTo = lineIndex(after, h.pos + h.ins.length);
  const b = snippet(base, bFrom, bTo), a = snippet(after, aFrom, aTo);
  return { start: aFrom + 1, end: aTo + 1, before: b.text, after: a.text, trunc: b.trunc || a.trunc };
}
function touch(room, e) {
  room.entrySeq++; e.seq = room.entrySeq; e.updated = Date.now();
  room.dirtyEntries.set(e.id, e);
}
function addEntry(room, e) {
  room.history.push(e);
  if (room.history.length > HISTORY_MEMORY) room.history.shift();
  room.newEntries++;
  touch(room, e);
}
function closeOpen(room) { if (room.open) { delete room.open.base; room.open = null; } }
function recordEdit(id, room, author, oldDoc, op) {
  let cur = oldDoc;
  for (const h of OT.hunks(oldDoc, op)) {
    const next = cur.slice(0, h.pos) + h.ins + cur.slice(h.pos + h.del.length);
    const now = Date.now(), open = room.open;
    const first = lineIndex(cur, h.pos), last = lineIndex(cur, h.pos + h.del.length);   // 0-based lines touched
    const mergeable = open && open.aid === author.aid && open.seq === room.entrySeq && now - open.updated <= COALESCE_MS &&
      first <= open.end + 1 && last >= open.start - 3;                                  // within 2 lines of that entry
    if (mergeable) {
      const r = region(open.base, next);
      if (!r) { // typed and deleted again: nothing changed overall
        room.history = room.history.filter(x => x !== open); room.dirtyEntries.delete(open.id);
        room.pendingBroadcast.set(open.id, { id: open.id, gone: true });
        room.open = null; room.entrySeq++;
      } else { Object.assign(open, r); touch(room, open); queueHistory(id, room, open); }
    } else {
      closeOpen(room);
      const r = region(cur, next);
      if (r) {
        const e = { id: crypto.randomUUID(), ts: now, aid: author.aid, author: author.name, color: author.color, kind: "edit", base: cur, ...r };
        addEntry(room, e); room.open = e; queueHistory(id, room, e);
      }
    }
    cur = next;
  }
}
// History updates are sent at most every 400 ms per workspace, so fast typing doesn't flood everyone.
function queueHistory(id, room, entry) {
  room.pendingBroadcast.set(entry.id, entry);
  if (room.histTimer) return;
  room.histTimer = setTimeout(() => {
    room.histTimer = null;
    const items = [...room.pendingBroadcast.values()]; room.pendingBroadcast = new Map();
    for (const e of items) io.to(id).emit(e.gone ? "history-gone" : "history-entry", e.gone ? { id: e.id } : entryOut(e));
  }, 400);
}
function systemEntry(room, author, kind, before, after) {
  const e = { id: crypto.randomUUID(), ts: Date.now(), aid: author.aid, author: author.name, color: author.color, kind, start: 0, end: 0, before: before || "", after: after || "", trunc: false };
  closeOpen(room); addEntry(room, e);
  return e;
}

// ---------- applying operations ----------
function commitOp(id, room, author, op, exceptSocket) {
  const oldDoc = room.code;
  const newDoc = OT.apply(oldDoc, op);
  room.code = newDoc;
  room.log.push(op); room.lens.push(oldDoc.length); room.rev++;
  if (room.log.length > LOG_KEEP) { room.log.shift(); room.lens.shift(); room.logStart++; }
  for (const sid of room.sockets) {
    const s = io.sockets.sockets.get(sid);
    if (s && s.data.cursor) s.data.cursor = { a: OT.transformIndex(s.data.cursor.a, op, false), b: OT.transformIndex(s.data.cursor.b, op, false) };
  }
  recordEdit(id, room, author, oldDoc, op);
  scheduleSave(id, room);
  const payload = { rev: room.rev, op, pid: exceptSocket ? exceptSocket.id : null, aid: author.aid };
  if (exceptSocket) exceptSocket.to(id).emit("op", payload); else io.to(id).emit("op", payload);
  return room.rev;
}
function broadcastHistory(id, entry) { queueHistory(id, rooms.get(id), entry); }

// ---------- HTTP API ----------
app.get("/health", (_req, res) => res.json({ ok: true }));
app.post("/api/rooms", ipLimit("create", 20 / 3600, 10), async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!db) return res.status(503).json({ error: "Database is not configured on the server." });
  const code = typeof req.body.code === "string" ? req.body.code : "";
  const language = typeof req.body.language === "string" ? req.body.language.slice(0, 60) : "Plain text";
  if (code.length > MAX_CODE_LENGTH) return res.status(413).json({ error: "Code is too large. Maximum is 80,000 characters." });
  const id = crypto.randomBytes(16).toString("base64url");
  const ownerToken = crypto.randomBytes(32).toString("base64url");
  const room = newRoomObject(code, language, ownerToken);
  try { await saveRoom(id, room); }
  catch (err) { console.error("[CodeRelay] Create failed:", err.message || err); return res.status(500).json({ error: "Could not save the workspace. Please try again." }); }
  rooms.set(id, room);
  res.json({ id, ownerToken, shareUrl: `/room/${id}` });
});
app.get("/api/qr", ipLimit("qr", 2, 20), async (req, res) => {
  const target = String(req.query.url || "");
  try {
    const parsed = new URL(target);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.host !== req.get("host")) return res.status(400).json({ error: "Invalid workspace URL." });
    const svg = await QRCode.toString(target, { type: "svg", margin: 1, width: 240, color: { dark: "#161618", light: "#ffffff" } });
    res.set("Cache-Control", "no-store").type("image/svg+xml").send(svg);
  } catch { res.status(400).json({ error: "Could not create QR code." }); }
});
// ---------- users: no login, just a name and a long-lived session cookie ----------
function parseCookies(h) { const o = {}; String(h || "").split(";").forEach(p => { const i = p.indexOf("="); if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }); return o; }
const userCache = new Map();
async function userFromCookie(header) {
  const t = parseCookies(header).cr_session;
  if (!db || !t || !/^[A-Za-z0-9_-]{40,60}$/.test(t)) return null;
  const h = tokenHash(t).toString("hex");
  if (userCache.has(h)) return userCache.get(h);
  const row = await db.getUserByHash(h);
  if (!row) return null;
  const u = { id: Number(row.id), name: row.name, dev: Number(row.id) === DEV_ID, role: roleOf(row.id, row.role) };
  if (userCache.size > 5000) userCache.clear();
  userCache.set(h, u);
  return u;
}
const sameOrigin = req => { const o = req.headers.origin; if (!o) return true; try { return new URL(o).host === req.headers.host; } catch { return false; } };
app.get("/api/me", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try { res.json({ user: await userFromCookie(req.headers.cookie) }); } catch { res.status(500).json({ error: "Could not load your profile." }); }
});
app.get("/api/name-available", ipLimit("namecheck", 5, 20), async (req, res) => {
  res.set("Cache-Control", "no-store");
  const name = cleanName(req.query.name);
  if (!name) return res.json({ valid: false, available: false });
  try { res.json({ valid: true, available: !(await db.nameTaken(name)) }); } catch { res.status(500).json({ error: "Could not check that name." }); }
});
app.post("/api/me", ipLimit("user", 20 / 3600, 10), async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!db) return res.status(503).json({ error: "Database is not configured on the server." });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Not allowed." });
  try {
    if (await userFromCookie(req.headers.cookie)) return res.status(409).json({ error: "You already have a name. Names can't be changed." });
    const name = cleanName(req.body && req.body.name);
    if (!name) return res.status(400).json({ error: "Please enter a name." });
    if (await db.nameTaken(name)) return res.status(409).json({ error: "That name is already taken. Please choose another.", taken: true });
    const token = crypto.randomBytes(32).toString("base64url");
    const row = await db.createUser(tokenHash(token).toString("hex"), name);
    res.append("Set-Cookie", `cr_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=315360000${req.secure ? "; Secure" : ""}`);
    res.json({ user: { id: Number(row.id), name: row.name, dev: Number(row.id) === DEV_ID, role: roleOf(row.id, row.role) } });
  } catch (err) {
    if (err && err.taken) return res.status(409).json({ error: "That name is already taken. Please choose another.", taken: true });
    console.error("[CodeRelay] Create user failed:", err.message || err); res.status(500).json({ error: "Could not save your name. Please try again." }); }
});
// ---------- roles: only the developer can give or remove them ----------
const notFound = res => res.status(404).type("text/plain").send("Not found");
async function developerOnly(req, res) {
  const u = await userFromCookie(req.headers.cookie).catch(() => null);
  if (!u || !u.dev) { notFound(res); return null; }
  return u;
}
function applyRoleLive(id, role) {
  for (const u of userCache.values()) if (u.id === id) u.role = role;                 // later requests see the new role
  const touched = new Set();
  for (const s of io.sockets.sockets.values()) {
    if (s.data.uid !== id && !(s.data.author && s.data.author.uid === id)) continue;
    if (s.data.author) s.data.author.role = role;
    s.emit("me-updated", { user: { id, name: s.data.author ? s.data.author.name : undefined, dev: false, role } });
    if (s.data.roomId) touched.add(s.data.roomId);
  }
  for (const rid of touched) { const room = rooms.get(rid); if (room) io.to(rid).emit("presence", { peers: peersOf(room) }); }
}
app.get("/api/roles", ipLimit("roles-find", 2, 20), async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!(await developerOnly(req, res))) return;
  const q = cleanName(req.query.q);
  if (!q) return res.json({ users: [] });
  try { res.json({ users: (await db.searchUsers(q)).map(u => ({ id: Number(u.id), name: u.name, dev: Number(u.id) === DEV_ID, role: roleOf(u.id, u.role) })) }); }
  catch (err) { console.error("[CodeRelay] Role search failed:", err.message || err); res.status(500).json({ error: "Could not search users." }); }
});
app.post("/api/roles", ipLimit("roles", 1, 40), async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!(await developerOnly(req, res))) return;
  if (!sameOrigin(req)) return res.status(403).json({ error: "Not allowed." });
  const { userNumber, role } = req.body || {};
  if (!Number.isInteger(userNumber) || userNumber < 1) return res.status(400).json({ error: "Enter a valid user number." });
  if (role !== null && !ROLES.includes(role)) return res.status(400).json({ error: "Role must be admin, moderator, or none." });
  if (userNumber === DEV_ID) return res.status(403).json({ error: "The developer account can't be changed." });
  try {
    const target = await db.getUserById(userNumber);
    if (!target) return res.status(404).json({ error: "No user has that number." });
    await db.setUserRole(userNumber, role);
    applyRoleLive(userNumber, role);
    res.json({ user: { id: userNumber, name: target.name, dev: false, role } });
  } catch (err) { console.error("[CodeRelay] Role change failed:", err.message || err); res.status(500).json({ error: "Could not change the role." }); }
});
app.get("/room/:id", (_req, res) => { res.set("Cache-Control", "no-store"); res.sendFile(path.join(__dirname, "public", "index.html")); });
app.use((_req, res) => res.status(404).type("text/plain").send("Not found"));
app.use((err, _req, res, _next) => { console.error("[CodeRelay] Request error:", err.message || err); res.status(err.status || 500).json({ error: "Something went wrong." }); });

// ---------- realtime ----------
const extraOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
const io = new Server(server, {
  maxHttpBufferSize: 256 * 1024,
  allowRequest: (req, cb) => {
    const o = req.headers.origin;
    if (!o) return cb(null, true); // not a browser
    try { cb(null, extraOrigins.includes(o) || new URL(o).host === req.headers.host); } catch { cb(null, false); }
  }
});

io.on("connection", socket => {
  userFromCookie(socket.request.headers.cookie).then(u => { if (u) socket.data.uid = u.id; }).catch(() => {});
  const limits = { op: mkBucket(60, 120), cursor: mkBucket(40, 60), misc: mkBucket(8, 20) };
  let strikes = 0;
  const guard = (kind, fn) => async (...args) => {
    if (args[0] === null) args[0] = undefined;
    if (!take(limits[kind])) { if (++strikes > 300) socket.disconnect(true); return; }
    try { await fn(...args); } catch (err) { console.error("[CodeRelay] Handler error:", err.message || err); }
  };
  const inRoom = id => {
    const room = typeof id === "string" ? rooms.get(id) : null;
    return room && socket.data.roomId === id ? room : null;
  };

  socket.on("join-room", guard("misc", async ({ id, ownerToken, clientId, name } = {}) => {
    if (typeof id !== "string") return;
    const user = await userFromCookie(socket.request.headers.cookie).catch(() => null);
    if (!user) { socket.emit("need-user"); return; }
    let room;
    try { room = await loadRoom(id); }
    catch (err) { console.error("[CodeRelay] Load failed:", err.message || err); socket.emit("room-error", "Could not load this workspace right now. Please retry in a moment."); return; }
    if (!room) { socket.emit("room-error", "This workspace does not exist. Check the link or create a new one."); return; }
    const owner = isOwnerToken(room, ownerToken);
    if (room.sockets.size >= MAX_PARTICIPANTS && !room.sockets.has(socket.id) && !owner) { socket.emit("room-error", "This workspace is full right now."); return; }
    if (socket.data.roomId && socket.data.roomId !== id) {
      const old = rooms.get(socket.data.roomId);
      if (old) { old.sockets.delete(socket.id); io.to(socket.data.roomId).emit("presence", { peers: peersOf(old) }); maybeEvict(socket.data.roomId, old); }
      socket.leave(socket.data.roomId);
    }
    clearTimeout(room.evictTimer);
    socket.data.roomId = id; socket.data.isOwner = owner; socket.data.cursor = null;
    socket.data.author = { aid: "u" + user.id, uid: user.id, role: user.role, name: user.name, color: pickColor(room, "u" + user.id) };
    room.sockets.add(socket.id); socket.join(id);
    socket.emit("room-state", publicState(id, room, socket));
    socket.to(id).emit("presence", { peers: peersOf(room) });
  }));

  socket.on("op", guard("op", ({ id, rev, op } = {}) => {
    const room = inRoom(id);
    if (!room) return;
    const resync = () => socket.emit("resync", publicState(id, room, socket));
    if (room.locked && !socket.data.isOwner) { socket.emit("permission-error", "This workspace is locked by its owner. You can still view and copy the code."); return resync(); }
    if (!Number.isInteger(rev) || rev < 0 || rev > room.rev || room.rev - rev > room.log.length || rev < room.logStart) return resync();
    const lenAtRev = rev === room.rev ? room.code.length : room.lens[rev - room.logStart];
    if (!OT.validate(op, lenAtRev, MAX_CODE_LENGTH)) return resync();
    let o = op;
    for (let k = rev; k < room.rev; k++) o = OT.transform(o, room.log[k - room.logStart], "right");
    if (!OT.validate(o, room.code.length, MAX_CODE_LENGTH)) return resync();
    if (OT.apply(room.code, o).length > MAX_CODE_LENGTH) { socket.emit("permission-error", "Maximum code length is 80,000 characters."); return resync(); }
    if (!o.length) { socket.emit("ack", { rev: room.rev }); return; }
    const newRev = commitOp(id, room, socket.data.author, o, socket);
    socket.emit("ack", { rev: newRev });
  }));

  socket.on("cursor", guard("cursor", ({ id, a, b } = {}) => {
    const room = inRoom(id);
    if (!room || !Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a > room.code.length || b > room.code.length) return;
    socket.data.cursor = { a, b };
    socket.to(id).volatile.emit("cursor", { pid: socket.id, a, b });
  }));

  socket.on("language", guard("misc", ({ id, language } = {}) => {
    const room = inRoom(id);
    if (!room || typeof language !== "string") return;
    if (room.locked && !socket.data.isOwner) return;
    const lang = language.slice(0, 60);
    if (lang === room.language) return;
    const e = systemEntry(room, socket.data.author, "language", room.language, lang);
    room.language = lang; scheduleSave(id, room, 0);
    io.to(id).emit("language", { language: lang }); broadcastHistory(id, e);
  }));

  socket.on("set-lock", guard("misc", ({ id, ownerToken, locked } = {}) => {
    const room = inRoom(id);
    if (!room || !isOwnerToken(room, ownerToken)) { socket.emit("permission-error", "Only the workspace owner can change the editing lock."); return; }
    room.locked = Boolean(locked);
    scheduleSave(id, room, 0);
    const e = systemEntry(room, socket.data.author, room.locked ? "lock" : "unlock");
    for (const sid of room.sockets) {
      const peer = io.sockets.sockets.get(sid);
      if (peer) peer.emit("lock-state", { locked: room.locked, isOwner: Boolean(peer.data.isOwner) });
    }
    broadcastHistory(id, e);
  }));

  socket.on("delete-room", guard("misc", async ({ id, ownerToken } = {}) => {
    const room = inRoom(id);
    if (!room || !isOwnerToken(room, ownerToken)) { socket.emit("permission-error", "Only the workspace owner can delete the workspace."); return; }
    room.deleted = true; clearTimeout(room.saveTimer); clearTimeout(room.evictTimer); clearTimeout(room.histTimer);
    try { await db.deleteRoom(id); }
    catch (err) { room.deleted = false; console.error("[CodeRelay] Delete failed:", err.message || err); socket.emit("permission-error", "Could not delete the workspace. Please try again."); return; }
    setTimeout(() => db.deleteRoom(id).catch(() => {}), 3000).unref();   // catches a save that was already in flight
    rooms.delete(id);
    io.to(id).emit("room-deleted");
    for (const sid of room.sockets) { const s = io.sockets.sockets.get(sid); if (s) { s.leave(id); s.data.roomId = null; } }
  }));

  socket.on("revert", guard("misc", ({ id, entryId } = {}) => {
    const room = inRoom(id);
    if (!room) return;
    if (room.locked && !socket.data.isOwner) { socket.emit("permission-error", "This workspace is locked by its owner."); return; }
    const entry = room.history.find(h => h.id === entryId);
    if (!entry || entry.kind !== "edit" || entry.reverted) { socket.emit("history-error", "That change can't be reverted."); return; }
    if (entry.trunc) { socket.emit("history-error", "This change is too large to revert automatically."); return; }
    const first = room.code.indexOf(entry.after);
    if (first === -1 || first !== room.code.lastIndexOf(entry.after) || !entry.after) {
      socket.emit("history-error", "Those lines have changed since this edit, so it can't be reverted automatically."); return;
    }
    const next = room.code.slice(0, first) + entry.before + room.code.slice(first + entry.after.length);
    const op = OT.fromDiff(room.code, next);
    const author = socket.data.author;
    entry.reverted = true; room.dirtyEntries.set(entry.id, entry);
    closeOpen(room); room.entrySeq++;
    commitOp(id, room, author, op, null);   // everyone, including the sender, receives it as a normal change
    const rev = systemEntry(room, author, "revert", entry.after, entry.before);
    rev.start = lineIndex(next, first) + 1; rev.end = rev.start + entry.before.split("\n").length - 1;
    broadcastHistory(id, entry); broadcastHistory(id, rev);
  }));

  socket.on("history-page", guard("misc", async ({ id, before } = {}, cb) => {
    const room = inRoom(id);
    if (!room || typeof cb !== "function" || !Number.isFinite(before)) return;
    const memOld = room.history.filter(h => h.ts < before).sort((a, b) => b.ts - a.ts).slice(0, 50);
    if (memOld.length >= 50 || !db) return cb({ entries: memOld.map(entryOut) });
    const rows = await db.listHistory(id, before, 50);
    cb({ entries: rows.map(rowToEntry).map(entryOut) });
  }));

  socket.on("share-run", guard("misc", ({ id, lang, ok, ms, lines } = {}) => {
    const room = inRoom(id);
    if (!room || !Array.isArray(lines) || (room.locked && !socket.data.isOwner)) return;
    let total = 0; const out = [];
    for (const l of lines.slice(0, 200)) {
      if (!l || typeof l.text !== "string") continue;
      const text = l.text.slice(0, 500); total += text.length;
      if (total > 12000) break;
      out.push({ t: ["log", "error", "info"].includes(l.t) ? l.t : "log", text });
    }
    socket.to(id).emit("peer-run", { name: socket.data.author.name, color: socket.data.author.color, lang: String(lang || "").slice(0, 40), ok: Boolean(ok), ms: Number.isFinite(ms) ? Math.round(ms) : 0, lines: out });
  }));

  socket.on("disconnect", () => {
    const id = socket.data.roomId;
    const room = id && rooms.get(id);
    if (!room) return;
    room.sockets.delete(socket.id);
    io.to(id).emit("presence", { peers: peersOf(room) });
    if (room.sockets.size === 0) flushRoom(id, room).then(() => maybeEvict(id, room));
  });
});

let shuttingDown = false;
async function shutdown() { if (shuttingDown) return; shuttingDown = true; await flushAll(); process.exit(0); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

if (require.main === module) server.listen(PORT, () => console.log(`CodeRelay running at http://localhost:${PORT}`));
module.exports = { server, io, seal, open, db };
