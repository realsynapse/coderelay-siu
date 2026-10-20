(function(){document.querySelectorAll("[data-split]").forEach(function(el){var t=el.textContent.trim(),m=el.dataset.split,f=document.createDocumentFragment();
if(m==="chars"){t.split("").forEach(function(c,i){var s=document.createElement("span");s.textContent=c;s.style.setProperty("--i",i);f.appendChild(s);});}
else{t.split(" ").forEach(function(w,i){var s=document.createElement("span");s.className="w";s.textContent=w;s.style.setProperty("--i",i);f.appendChild(s);});}
el.textContent="";el.appendChild(f);});
document.querySelectorAll(".splash-credit .w").forEach(function(w){if(/^(Crown|Lab|Team)$/.test(w.textContent))w.classList.add("accent");});})();

(() => {
const $ = id => document.getElementById(id);
const { highlight, detectLanguage } = window.CRHL;
const CROT = window.CROT;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const socket = io();
function ident() { return {}; }   // who you are comes from your session cookie, not from the page
let curUser = null;
const otc = new CROT.Client({
  rev: 0,
  send: (rev, op) => socket.emit("op", { id: roomId, rev, op }),
  apply: op => {
    const ta = $("code"), a = CROT.transformIndex(ta.selectionStart, op, false), b = CROT.transformIndex(ta.selectionEnd, op, false), top = ta.scrollTop;
    shadow = CROT.apply(shadow, op); ta.value = shadow; ta.setSelectionRange(a, b); ta.scrollTop = top;
    updateCount(); scheduleHighlight(); schedulePreview(); $("syncState").textContent = isLocked && !isOwner ? "Read-only · copying allowed" : "Live update received";
  }
});
let shadow = "", roomId = null, creating = false, isOwner = false, isLocked = false;
const OWNER_KEYS_STORAGE = "coderelay-owner-keys-v1";
const MAX_CODE_LENGTH = 80000;

/* ---------- splash ---------- */
function endSplash() {
  const splash = $("splash");
  if (!splash) return;
  splash.classList.add("leaving");
  document.body.classList.remove("booting");
  document.body.classList.add("ready");
  setTimeout(() => splash.remove(), reduceMotion ? 50 : 1000);
}
window.addEventListener("load", () => setTimeout(endSplash, reduceMotion ? 150 : 3000));

/* ---------- button feel: ripple + label swap ---------- */
document.addEventListener("pointerdown", e => {
  const btn = e.target.closest("button");
  if (!btn || btn.disabled || reduceMotion) return;
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 2;
  const r = document.createElement("span");
  r.className = "ripple";
  r.style.width = r.style.height = size + "px";
  r.style.left = (e.clientX - rect.left - size / 2) + "px";
  r.style.top = (e.clientY - rect.top - size / 2) + "px";
  btn.appendChild(r);
  r.addEventListener("animationend", () => r.remove());
});
function setLabel(btn, text) {
  const label = btn.querySelector(".label");
  if (!label || label.textContent === text) return;
  if (reduceMotion) { label.textContent = text; return; }
  label.classList.add("swap");
  setTimeout(() => { label.textContent = text; label.classList.remove("swap"); }, 170);
}
function flashLabel(btn, text, ms = 1600) {
  const label = btn.querySelector(".label");
  const original = btn.dataset.label || (btn.dataset.label = label.textContent);
  setLabel(btn, text);
  clearTimeout(btn._flash);
  btn._flash = setTimeout(() => setLabel(btn, original), ms);
}

/* ---------- owner key storage ---------- */
function getOwnerKey(id) {
  try { return JSON.parse(localStorage.getItem(OWNER_KEYS_STORAGE) || "{}")[id] || ""; } catch { return ""; }
}
function saveOwnerKey(id, token) {
  try { const keys = JSON.parse(localStorage.getItem(OWNER_KEYS_STORAGE) || "{}"); keys[id] = token; localStorage.setItem(OWNER_KEYS_STORAGE, JSON.stringify(keys)); } catch {}
}

/* ---------- UI state ---------- */
function applyPermissions() {
  const readOnly = isLocked && !isOwner;
  $("code").readOnly = readOnly;
  $("language").disabled = readOnly;
  $("lockBtn").classList.toggle("hidden", !isOwner);
  $("deleteRoom").classList.toggle("hidden", !(isOwner && roomId));
  setLabel($("lockBtn"), isLocked ? "Unlock editing" : "Lock editing");
  $("lockBtn").dataset.label = isLocked ? "Unlock editing" : "Lock editing";
  $("lockIndicator").classList.toggle("hidden", !readOnly);
  $("editorCard").classList.toggle("is-readonly", readOnly);
  if (readOnly) $("syncState").textContent = "Read-only · copying allowed";
}
function setStatus(text, connected) {
  $("status").textContent = text;
  $("statusDot").classList.toggle("off", !connected);
}
function showNotice(text, type = "") {
  const n = $("notice");
  n.className = "notice" + (type ? " " + type : "");
  n.textContent = text;
  void n.offsetWidth;
  n.classList.add("pop");
}
function updateCount() { $("charCount").textContent = $("code").value.length.toLocaleString() + " characters"; }
function updateUrl() {
  if (!roomId) return;
  const url = location.origin + "/room/" + roomId;
  $("shareLink").value = url;
  $("roomPill").textContent = "Room " + roomId.slice(0, 7);
  $("roomPill").classList.add("live");
  const qr = $("qr");
  const src = "/api/qr?url=" + encodeURIComponent(url);
  if (qr.getAttribute("src") !== src) {
    qr.classList.remove("pop");
    qr.src = src;
    qr.onload = () => { void qr.offsetWidth; qr.classList.add("pop"); };
  }
  qr.classList.remove("hidden");
  $("qrPlaceholder").classList.add("hidden");
}
function setCreating(on) {
  creating = on;
  $("createRoom").disabled = on;
  $("createRoom").classList.toggle("is-loading", on);
}

/* ---------- rooms ---------- */
async function createRoom() {
  if (creating) return;
  if (!curUser) { openNameDialog(); return; }
  setCreating(true);
  try {
    const response = await fetch("/api/rooms", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({code: $("code").value, language: $("language").value})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not create workspace.");
    roomId = data.id;
    isOwner = true;
    saveOwnerKey(roomId, data.ownerToken);
    history.replaceState({}, "", "/room/" + roomId);
    updateUrl();
    socket.emit("join-room", {...ident(), id: roomId, ownerToken: data.ownerToken});
    showNotice("Workspace created and saved. Share the QR or link. You can lock editing at any time.", "good");
  } catch (error) {
    showNotice(error.message, "bad");
  } finally {
    setCreating(false);
  }
}
function joinFromPath() {
  const match = location.pathname.match(/^\/room\/([A-Za-z0-9_-]+)$/);
  if (!match) return false;
  roomId = match[1];
  updateUrl();
  socket.emit("join-room", {...ident(), id: roomId, ownerToken: getOwnerKey(roomId)});
  return true;
}
$("createRoom").addEventListener("click", createRoom);
$("newRoom").addEventListener("click", () => {
  roomId = null;
  isOwner = false; isLocked = false; applyPermissions();
  history.replaceState({}, "", "/");
  $("shareLink").value = "";
  $("qr").classList.add("hidden");
  $("qr").removeAttribute("src");
  $("qrPlaceholder").classList.remove("hidden");
  $("roomPill").textContent = "New workspace";
  $("roomPill").classList.remove("live");
  renderPeers([]);
  showNotice("Your current text remains in the editor. Create a new workspace when ready.");
  setStatus("Not connected", false);
});
$("code").addEventListener("input", () => {
  updateCount();
  const ta = $("code"), next = ta.value;
  if (next.length > MAX_CODE_LENGTH) { ta.value = shadow; showNotice("Maximum code length is 80,000 characters.", "bad"); return; }
  const op = CROT.fromDiff(shadow, next); shadow = next;
  if (!roomId) { $("syncState").textContent = "Not shared yet"; return; }
  if (isLocked && !isOwner) return;
  $("syncState").textContent = "Syncing…";
  otc.local(op);
});
$("language").addEventListener("change", () => {
  if (roomId && (!isLocked || isOwner)) socket.emit("language", {id: roomId, language: $("language").value});
});
$("copyLink").addEventListener("click", async () => {
  if (!$("shareLink").value) return showNotice("Create a workspace first.");
  try { await navigator.clipboard.writeText($("shareLink").value); flashLabel($("copyLink"), "Copied"); showNotice("Workspace link copied.", "good"); }
  catch { $("shareLink").select(); showNotice("Select and copy the link manually."); }
});
$("copyCode").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("code").value); flashLabel($("copyCode"), "Copied"); showNotice("Code copied to clipboard.", "good"); }
  catch { $("code").focus(); $("code").select(); showNotice("Code selected. Copy it with Ctrl+C (or Cmd+C on Mac)."); }
});
$("lockBtn").addEventListener("click", () => {
  if (!roomId || !isOwner) return;
  socket.emit("set-lock", {...ident(), id: roomId, ownerToken: getOwnerKey(roomId), locked: !isLocked});
});

/* ---------- socket events ---------- */
socket.on("connect", () => {
  setStatus("Connected", true);
  if (roomId) socket.emit("join-room", {...ident(), id: roomId, ownerToken: getOwnerKey(roomId)});
});
socket.on("disconnect", () => { setStatus("Reconnecting…", false); renderPeers([]); });
socket.on("room-state", state => loadState(state));
socket.on("resync", state => { loadState(state); showNotice("Your last change could not be merged, so the latest saved version was loaded.", "bad"); });
function loadState(state) {
  roomId = state.id; isOwner = Boolean(state.isOwner); isLocked = Boolean(state.locked);
  shadow = state.code; $("code").value = state.code; $("language").value = state.language || "Plain text";
  otc.reset(state.rev);
  updateCount(); updateUrl(); applyPermissions(); scheduleHighlight();
  setStatus(state.peers.length + " connected", true); renderPeers(state.peers);
  if (!isLocked) showNotice(isOwner ? "Owner workspace connected. You can share the QR/link and control editing access." : "Connected to shared workspace. Edits sync live and are saved.", "good");
}
socket.on("presence", data => { setStatus(data.peers.length + " connected", true); renderPeers(data.peers); });
socket.on("op", d => otc.remote(d.rev, d.op));
socket.on("ack", d => { otc.ack(d.rev); if (!otc.inflight) $("syncState").textContent = "Synced and saved"; });
socket.on("language", d => { $("language").value = d.language || "Plain text"; scheduleHighlight(); });
socket.on("lock-state", data => {
  isLocked = Boolean(data.locked);
  if (typeof data.isOwner === "boolean") isOwner = data.isOwner;
  applyPermissions();
  if (isOwner) showNotice(isLocked ? "Editing locked. Visitors can view and copy code; only you can edit." : "Editing unlocked. Everyone with the link can edit again.", "good");
});
$("deleteRoom").addEventListener("click", () => {
  if (!roomId || !isOwner) return;
  $("delConfirm").classList.remove("is-loading"); $("delDlg").showModal();
});
$("delCancel").addEventListener("click", () => $("delDlg").close());
$("delConfirm").addEventListener("click", () => {
  if (!roomId || !isOwner) return;
  $("delConfirm").classList.add("is-loading");
  socket.emit("delete-room", { id: roomId, ownerToken: getOwnerKey(roomId) });
});
socket.on("permission-error", () => { if ($("delDlg").open) { $("delDlg").close(); } });
socket.on("room-deleted", () => {
  if ($("delDlg").open) $("delDlg").close();
  try { const k = JSON.parse(localStorage.getItem(OWNER_KEYS_STORAGE) || "{}"); delete k[roomId]; localStorage.setItem(OWNER_KEYS_STORAGE, JSON.stringify(k)); } catch {}
  otc.reset(0); $("newRoom").click();
  showNotice("This workspace was deleted. Its link no longer works. The text is still in your editor.", "bad");
});
socket.on("permission-error", message => showNotice(message, "bad"));
socket.on("room-error", message => {
  showNotice(message, "bad");
  setStatus("Room unavailable", false);
});


const hlCode = document.querySelector("#hl code");
let hlFrame = 0;
function syncScroll() {
  hlCode.style.transform = `translate(${-$("code").scrollLeft}px, ${-$("code").scrollTop}px)`;
}
function renderHighlight() {
  hlFrame = 0;
  const code = $("code").value;
  let name = $("language").value;
  if (name === "Auto detect") name = detectLanguage(code);
  hlCode.innerHTML = highlight(code, name) + "\n";
  syncScroll();
}
function scheduleHighlight() { if (!hlFrame) hlFrame = requestAnimationFrame(renderHighlight); }
$("code").addEventListener("input", scheduleHighlight);
$("code").addEventListener("scroll", syncScroll, { passive: true });
$("language").addEventListener("change", scheduleHighlight);
if (window.ResizeObserver) new ResizeObserver(syncScroll).observe($("code"));

/* ---------- terms dialog ---------- */
const terms = $("terms");
$("termsBtn").addEventListener("click", () => terms.showModal());
/* ---------- play phonk: public for everyone; a floating player you can drag, minimize and close without stopping the music ---------- */
/* Songs come from two places: your own files (/phonk/phonks.json -> /phonk/<name>.mp3) and an online search through this server (Audius). */
const pw = $("phonkWin"), phonkList = $("phonkList"), phonkResults = $("phonkResults"), phonkMsg = $("phonkMsg"), phonkPlayer = $("phonkPlayer"), phonkBubble = $("phonkBubble"), phonkBar = $("phonkBar");
let phonkNames = null, phonkNow = null, phonkItem = null, pwOpen = false, pwPos = null, pwDrag = null, phonkSeq = 0, phonkTimer = 0, phonkFirst = true;
const phonkRows = new Map();                                              // key -> <li>
const fmtT = t => (isFinite(t) && t > 0) ? Math.floor(t / 60) + ":" + String(Math.floor(t % 60)).padStart(2, "0") : "0:00";
const phonkIsPlaying = () => phonkNow !== null && !phonkPlayer.paused && !phonkPlayer.ended;
function phonkNote(t, bad) { phonkMsg.textContent = t || ""; phonkMsg.classList.toggle("bad", Boolean(bad)); }
function phonkSync() {
  const playing = phonkIsPlaying();
  for (const [k, li] of phonkRows) { li.classList.toggle("active", k === phonkNow); li.classList.toggle("playing", k === phonkNow && playing); li.setAttribute("aria-pressed", String(k === phonkNow && playing)); }
  $("phonkBtn").classList.toggle("playing", playing); pw.classList.toggle("playing", playing);
  $("phonkBtn").querySelector(".label").textContent = playing ? "Now playing" : "Play phonk";
  phonkBubble.classList.toggle("show", !pwOpen && phonkNow !== null); phonkBubble.classList.toggle("playing", playing);
  $("phonkNowName").textContent = phonkItem ? phonkItem.title : "Nothing playing";
  $("phonkToggle").disabled = $("phonkStop").disabled = phonkNow === null;
}
function phonkProgress() {
  const d = phonkPlayer.duration, t = phonkPlayer.currentTime, pct = d > 0 ? Math.min(100, t / d * 100) : 0;
  $("phonkFill").style.width = pct + "%"; $("phonkProg").setAttribute("aria-valuenow", String(Math.round(pct)));
  $("phonkTime").textContent = phonkNow === null ? "0:00" : fmtT(t) + (d > 0 && isFinite(d) ? " / " + fmtT(d) : "");
}
function phonkToggle() {
  if (phonkNow === null) return;
  if (phonkPlayer.paused) { if (phonkPlayer.ended) phonkPlayer.currentTime = 0; phonkPlayer.play().catch(() => {}); } else phonkPlayer.pause();
}
function phonkPlay(item) {
  if (phonkNow === item.key) { phonkToggle(); return; }                  // same one: pause / resume
  phonkNow = item.key; phonkItem = item; phonkNote(""); phonkPlayer.src = item.src;
  phonkPlayer.play().catch(() => {}); phonkSync(); phonkProgress();
  if ("mediaSession" in navigator && window.MediaMetadata) navigator.mediaSession.metadata = new MediaMetadata({ title: item.title, artist: item.artist || "CodeRelay" });
}
function phonkStop() { phonkPlayer.pause(); phonkPlayer.removeAttribute("src"); phonkPlayer.load(); phonkNow = null; phonkItem = null; phonkSync(); phonkProgress(); }
for (const ev of ["play", "pause", "ended"]) phonkPlayer.addEventListener(ev, phonkSync);
for (const ev of ["timeupdate", "loadedmetadata", "durationchange"]) phonkPlayer.addEventListener(ev, phonkProgress);
phonkPlayer.addEventListener("error", () => {
  if (phonkNow === null || !phonkPlayer.getAttribute("src")) return;
  const it = phonkItem; phonkNow = null; phonkItem = null; phonkSync(); phonkProgress();
  phonkNote(it && it.online ? "Couldn\u2019t play \u201c" + it.title + "\u201d. Try another song." : "Couldn\u2019t play \u201c" + (it ? it.title : "") + "\u201d. Check that " + (it ? it.title : "") + ".mp3 is in the phonk folder.", true);
});
if ("mediaSession" in navigator) { try { navigator.mediaSession.setActionHandler("play", phonkToggle); navigator.mediaSession.setActionHandler("pause", phonkToggle); navigator.mediaSession.setActionHandler("stop", phonkStop); } catch {} }

function phonkRow(item, i) {
  const li = document.createElement("li"); li.className = "phonk-row"; li.tabIndex = 0; li.setAttribute("role", "button"); li.style.setProperty("--i", Math.min(i, 12));
  const eq = document.createElement("span"); eq.className = "eq"; eq.setAttribute("aria-hidden", "true"); eq.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
  const t = document.createElement("span"); t.className = "pn";
  const ti = document.createElement("span"); ti.className = "pt"; ti.textContent = item.title; t.append(ti);
  if (item.artist) { const ar = document.createElement("small"); ar.className = "pa"; ar.textContent = item.artist; t.append(ar); }
  li.append(eq, t);
  if (item.duration) { const d = document.createElement("span"); d.className = "pd"; d.textContent = fmtT(item.duration); li.append(d); }
  li.addEventListener("click", () => phonkPlay(item));
  li.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); phonkPlay(item); } });
  phonkRows.set(item.key, li); return li;
}
async function phonkLoad() {
  if (phonkNames) return;
  try {
    const r = await fetch("/phonk/phonks.json"); if (!r.ok) throw 0;
    const d = await r.json(); phonkNames = (Array.isArray(d) ? d : []).map(String).map(x => x.trim()).filter(Boolean).slice(0, 200);
  } catch { phonkNames = []; }
  phonkList.textContent = "";
  phonkNames.forEach((n, i) => phonkList.append(phonkRow({ key: "local:" + n, title: n, src: "/phonk/" + encodeURIComponent(n) + ".mp3" }, i)));
  $("phonkMineH").classList.toggle("hidden", !phonkNames.length);
  phonkSync();
  if (phonkFirst) { phonkFirst = false; phonkSearch("phonk", true); }       // show something to play right away
}
/* online search */
function phonkSkeleton() { phonkResults.textContent = ""; for (let i = 0; i < 4; i++) { const li = document.createElement("li"); li.className = "phonk-row skel"; li.style.setProperty("--i", i); phonkResults.append(li); } $("phonkResH").classList.remove("hidden"); }
async function phonkSearch(q, quiet) {
  q = String(q || "").trim(); const seq = ++phonkSeq;
  for (const [k] of phonkRows) if (k.startsWith("audius:")) phonkRows.delete(k);
  if (!q) { phonkResults.textContent = ""; $("phonkResH").classList.add("hidden"); phonkNote(""); return; }
  phonkNote(""); phonkSkeleton(); $("phonkSearch").classList.add("busy");
  try {
    const r = await fetch("/api/music/search?q=" + encodeURIComponent(q)), d = await r.json().catch(() => ({}));
    if (seq !== phonkSeq) return;
    if (!r.ok) throw new Error(d.error || (r.status === 429 ? "Too many searches. Wait a moment." : "Search isn\u2019t available right now."));
    phonkResults.textContent = "";
    const tracks = Array.isArray(d.tracks) ? d.tracks : [];
    tracks.forEach((t, i) => phonkResults.append(phonkRow({ key: "audius:" + t.id, title: t.title, artist: t.artist, duration: t.duration, online: true, src: "/api/music/stream/" + encodeURIComponent(t.id) }, i)));
    $("phonkResH").classList.toggle("hidden", !tracks.length);
    phonkNote(tracks.length ? "" : "No songs found for \u201c" + q + "\u201d.");
    phonkSync();
  } catch (e) {
    if (seq !== phonkSeq) return;
    phonkResults.textContent = ""; $("phonkResH").classList.add("hidden"); if (!quiet) phonkNote(e.message, true);
  } finally { if (seq === phonkSeq) $("phonkSearch").classList.remove("busy"); }
}
$("phonkSearch").addEventListener("submit", e => { e.preventDefault(); clearTimeout(phonkTimer); phonkSearch($("phonkQ").value); });
$("phonkQ").addEventListener("input", () => { clearTimeout(phonkTimer); const v = $("phonkQ").value.trim(); phonkTimer = setTimeout(() => { if (v.length >= 2 || !v) phonkSearch(v || "phonk"); }, 550); });

/* window: open / close / minimize / drag. Closing only hides the window; the <audio> lives outside it, so the music keeps going. */
function pwApply(x, y) {
  const w = pw.offsetWidth, h = pw.offsetHeight;
  x = Math.min(Math.max(8, x), Math.max(8, innerWidth - w - 8)); y = Math.min(Math.max(8, y), Math.max(8, innerHeight - h - 8));
  pwPos = { x, y }; pw.classList.add("free"); pw.style.setProperty("--x", x + "px"); pw.style.setProperty("--y", y + "px");
}
function pwShow(open) {
  pwOpen = open; pw.classList.toggle("show", open); pw.inert = !open; pw.setAttribute("aria-hidden", String(!open));
  $("phonkBtn").setAttribute("aria-expanded", String(open)); phonkSync();
  if (open) { phonkLoad(); if (pwPos) pwApply(pwPos.x, pwPos.y); }
}
function pwMin(min) { pw.classList.toggle("min", min); $("phonkFold").inert = min; $("phonkMin").setAttribute("aria-expanded", String(!min)); $("phonkMin").setAttribute("aria-label", min ? "Expand" : "Minimize"); }
$("phonkBtn").addEventListener("click", () => pwShow(!pwOpen));
phonkBubble.addEventListener("click", () => pwShow(true));
$("phonkX").addEventListener("click", () => { pwShow(false); $("phonkBtn").focus({ preventScroll: true }); });
$("phonkMin").addEventListener("click", () => pwMin(!pw.classList.contains("min")));
$("phonkToggle").addEventListener("click", phonkToggle);
$("phonkStop").addEventListener("click", phonkStop);
pw.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); pwShow(false); $("phonkBtn").focus({ preventScroll: true }); } });
phonkBar.addEventListener("dblclick", e => { if (!e.target.closest("button")) pwMin(!pw.classList.contains("min")); });
phonkBar.addEventListener("pointerdown", e => {
  if (e.button !== 0 || e.target.closest("button")) return;
  const r = pw.getBoundingClientRect(); pwApply(r.left, r.top);
  pwDrag = { dx: e.clientX - r.left, dy: e.clientY - r.top }; pw.classList.add("dragging"); phonkBar.setPointerCapture(e.pointerId);
});
phonkBar.addEventListener("pointermove", e => { if (pwDrag) pwApply(e.clientX - pwDrag.dx, e.clientY - pwDrag.dy); });
for (const ev of ["pointerup", "pointercancel"]) phonkBar.addEventListener(ev, () => { pwDrag = null; pw.classList.remove("dragging"); });
addEventListener("resize", () => { if (pwPos) pwApply(pwPos.x, pwPos.y); });
if (window.ResizeObserver) new ResizeObserver(() => { if (pwPos && !pwDrag) pwApply(pwPos.x, pwPos.y); }).observe(pw);   // keeps it on screen when it grows or shrinks

/* seek bar */
const prog = $("phonkProg");
function seekAt(e) { const r = prog.getBoundingClientRect(), d = phonkPlayer.duration; if (phonkNow !== null && d > 0) { phonkPlayer.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * d; phonkProgress(); } }
let seeking = false;
prog.addEventListener("pointerdown", e => { seeking = true; prog.setPointerCapture(e.pointerId); seekAt(e); });
prog.addEventListener("pointermove", e => { if (seeking) seekAt(e); });
for (const ev of ["pointerup", "pointercancel"]) prog.addEventListener(ev, () => { seeking = false; });
phonkSync(); phonkProgress();

/* ---------- feedback: sent to the developer's Discord by the server ---------- */
const fbDlg = $("feedbackDlg"), fbText = $("fbText"), fbMsg = $("fbMsg");
let fbKind = "idea", fbBusy = false;
function fbNote(t, kind) { fbMsg.textContent = t || ""; fbMsg.className = "fb-msg" + (kind ? " " + kind : ""); }
function closeFb() {
  if (reduceMotion) return fbDlg.close();
  fbDlg.classList.add("closing");
  setTimeout(() => { fbDlg.close(); fbDlg.classList.remove("closing"); }, 220);
}
$("feedbackBtn").addEventListener("click", () => {
  if (!curUser) { openNameDialog(); return; }                       // feedback needs a name so it is clear who sent it
  fbNote(""); fbDlg.showModal(); fbText.focus();
});
$("fbKinds").addEventListener("click", e => {
  const c = e.target.closest(".fb-chip"); if (!c) return;
  fbKind = c.dataset.kind;
  $("fbKinds").querySelectorAll(".fb-chip").forEach(x => { const on = x === c; x.classList.toggle("on", on); x.setAttribute("aria-checked", String(on)); });
});
fbText.addEventListener("input", () => { $("fbCount").textContent = fbText.value.length + " / 1000"; fbNote(""); });
$("fbCancel").addEventListener("click", closeFb);
fbDlg.addEventListener("cancel", e => { e.preventDefault(); if (!fbBusy) closeFb(); });
fbDlg.addEventListener("click", e => { if (e.target === fbDlg && !fbBusy) closeFb(); });
$("fbSend").addEventListener("click", async () => {
  if (fbBusy) return;
  const message = fbText.value.trim();
  if (message.length < 20) { fbNote("Please write at least 20 characters so we can understand (" + message.length + "/20).", "bad"); fbText.focus(); return; }
  fbBusy = true; $("fbSend").disabled = true; $("fbSend").classList.add("is-loading"); fbNote("Sending\u2026");
  try {
    const r = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: fbKind, message }) }), d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Couldn't send your feedback. Please try again.");
    fbText.value = ""; $("fbCount").textContent = "0 / 1000"; fbNote("Thank you! Your feedback was sent.", "ok");
    flashLabel($("feedbackBtn"), "Thanks!", 2200);
    setTimeout(() => { if (fbDlg.open) closeFb(); }, 1100);
  } catch (e) { fbNote(e.message, "bad"); }
  finally { fbBusy = false; $("fbSend").disabled = false; $("fbSend").classList.remove("is-loading"); }
});

function closeTerms() {
  if (reduceMotion) return terms.close();
  terms.classList.add("closing");
  setTimeout(() => { terms.close(); terms.classList.remove("closing"); }, 220);
}
$("closeTerms").addEventListener("click", closeTerms);
terms.addEventListener("cancel", e => { e.preventDefault(); closeTerms(); });
terms.addEventListener("click", e => { if (e.target === terms) closeTerms(); });

/* ---------- footer credit: split into words for the reveal ---------- */
(() => {
  const el = $("crown");
  el.innerHTML = el.textContent.split(" ").map((w, i) => `<span class="w" style="--i:${i}">${w}</span>`).join(" ");
})();

/* ---------- console: runs JavaScript and Python in a sandboxed page ---------- */
const RUNTIME = { JavaScript: "js", TypeScript: "ts", Python: "py", SQL: "sql", Lua: "lua", HTML: "html", CSS: "css" };
let view = "code", previewFrame = null, previewTimer = 0;
let runner = null, runnerReady = null, runSeq = 0, activeRun = null;
const out = $("consoleOut");
function addLine(kind, text, line) {
  const hint = out.querySelector(".cl-hint"); if (hint) hint.remove();
  const row = document.createElement("div"); row.className = "cl cl-" + kind;
  const span = document.createElement("span"); span.textContent = text; row.appendChild(span);
  if (line) { const b = document.createElement("button"); b.className = "cl-line"; b.textContent = "line " + line; b.addEventListener("click", () => jumpToLine(line)); row.appendChild(b); }
  out.appendChild(row); out.scrollTop = out.scrollHeight;
}
function jumpToLine(n) {
  const ta = $("code"), lines = ta.value.split("\n"); let start = 0;
  for (let i = 0; i < Math.min(n - 1, lines.length - 1); i++) start += lines[i].length + 1;
  const end = start + (lines[Math.min(n, lines.length) - 1] || "").length;
  ta.focus(); ta.setSelectionRange(start, end);
  ta.scrollTo({ top: Math.max(0, (n - 4) * 21.45), behavior: reduceMotion ? "auto" : "smooth" });
}
function resolvedLanguage() { const v = $("language").value; return v === "Auto detect" ? detectLanguage($("code").value) : v; }
function ensureRunner() {
  if (runnerReady) return runnerReady;
  runner = document.createElement("iframe");
  runner.src = "/runner"; runner.className = "runner-frame"; runner.title = "Sandboxed code runner";
  runner.setAttribute("sandbox", "allow-scripts");
  runnerReady = new Promise((res, rej) => { runner._ready = res; setTimeout(() => rej(new Error("The code runner did not start. Check your connection and try again.")), 20000); });
  document.body.appendChild(runner);
  return runnerReady;
}
function setRunning(on) {
  $("runBtn").disabled = on; $("runBtn").classList.toggle("is-loading", on); $("stopBtn").classList.toggle("hidden", !on);
}
window.addEventListener("message", e => {
  const m = e.data || {};
  if (previewFrame && e.source === previewFrame.contentWindow) { if (m.type === "ready") previewFrame._res(); return; }
  if (!runner || e.source !== runner.contentWindow) return;      // only our own sandboxed frames
  if (m.type === "ready" && runner._ready) runner._ready();
  else if (m.type === "out" && activeRun && m.id === activeRun.id) addLine(["log", "error", "info"].includes(m.t) ? m.t : "log", String(m.text), Number(m.line) || 0);
  else if (m.type === "phase" && activeRun && m.id === activeRun.id) armWatchdog(m.id, m.phase === "loading" ? 30 * 60 * 1000 : 45000);
  else if (m.type === "pystate" && !activeRun) { if (m.state === "loading") addLine("info", "Downloading Python in the background (first time only, about 10 MB)…"); else if (m.state === "ready") addLine("info", "Python is ready."); else if (m.state === "error") addLine("error", String(m.text || "Couldn’t download Python.")); }
  else if (m.type === "done" && activeRun && m.id === activeRun.id) {
    clearTimeout(activeRun.wd);
    addLine(m.ok ? "meta" : "error", (m.ok ? "Finished in " : m.stopped ? "Stopped after " : "Failed after ") + (m.ms || 0) + " ms");
    activeRun = null; setRunning(false);
  }
});
function destroyRunner() { if (runner) runner.remove(); runner = null; runnerReady = null; pyPreloaded = false; }
function previewHtml() {
  const name = resolvedLanguage(), code = $("code").value;
  if (name === "HTML") return code;
  if (name === "CSS") return '<!doctype html><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;padding:24px}</style><style>' + code.replace(/<\/style/gi, "") + '</style><h1>Heading</h1><p>A paragraph with a <a href="#">link</a>.</p><button>Button</button><ul><li>One</li><li>Two</li></ul>';
  return null;
}
async function renderPreview() {
  const html = previewHtml();
  if (!previewFrame) {
    previewFrame = document.createElement("iframe");
    previewFrame.src = "/runner"; previewFrame.className = "preview-frame"; previewFrame.title = "Sandboxed preview";
    previewFrame.setAttribute("sandbox", "allow-scripts");
    previewFrame._ready = new Promise(r => { previewFrame._res = r; });
    $("previewBox").appendChild(previewFrame);
  }
  $("previewHint").classList.toggle("hidden", html !== null); previewFrame.classList.toggle("hidden", html === null);
  if (html === null) return;
  await previewFrame._ready;
  previewFrame.contentWindow.postMessage({ type: "preview", html }, "*");
}
function schedulePreview() { if (view !== "preview") return; clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 350); }
function showView(v) {
  view = v;
  $("viewCode").setAttribute("aria-pressed", String(v === "code")); $("viewPreview").setAttribute("aria-pressed", String(v === "preview"));
  document.querySelector(".editor-wrap").classList.toggle("hidden", v !== "code"); $("previewBox").classList.toggle("hidden", v !== "preview");
  if (v === "preview") renderPreview();
}
$("viewCode").addEventListener("click", () => showView("code"));
$("viewPreview").addEventListener("click", () => showView("preview"));
$("code").addEventListener("input", schedulePreview);
$("language").addEventListener("change", () => { if (view === "preview") renderPreview(); });
/* Start downloading Python as soon as the code looks like Python, so it is usually ready before Run is pressed. */
let pyPreloaded = false, preloadTimer = 0;
function maybePreloadPython() {
  if (pyPreloaded || activeRun || navigator.connection && navigator.connection.saveData) return;
  if (resolvedLanguage() !== "Python" || $("code").value.trim().length < 8) return;
  pyPreloaded = true;
  ensureRunner().then(() => { if (runner) runner.contentWindow.postMessage({ type: "preload", lang: "py" }, "*"); }).catch(() => { pyPreloaded = false; });
}
const schedulePreload = () => { clearTimeout(preloadTimer); preloadTimer = setTimeout(maybePreloadPython, 1200); };
$("code").addEventListener("input", schedulePreload);
$("language").addEventListener("change", schedulePreload);
async function runCode() {
  if (activeRun) return;
  const code = $("code").value, name = resolvedLanguage(), rt = RUNTIME[name];
  $("consoleLang").textContent = name;
  if (!code.trim()) { addLine("info", "Nothing to run yet. Write some code first."); return; }
  if (rt === "html" || rt === "css") { showView("preview"); addLine("meta", name + " preview updated."); return; }
  if (!rt) { addLine("info", name + " can't run in the browser console. You can run JavaScript, TypeScript, Python, SQL and Lua, and preview HTML and CSS."); return; }
  setRunning(true);
  try { await ensureRunner(); } catch (err) { addLine("error", err.message); setRunning(false); return; }
  const id = ++runSeq; activeRun = { id };
  addLine("meta", "Running " + name + "…");
  const fast = rt === "js" || rt === "ts" || rt === "lua";
  runner.contentWindow.postMessage({ type: "run", id, lang: rt, code, timeout: fast ? 5000 : 30000 }, "*");
  armWatchdog(id, rt === "js" ? 7000 : rt === "py" ? 45000 : 75000);
}
/* If the runner goes silent we stop it. While Python is downloading it tells us (phase "loading"), and we wait for as long as it takes. */
function armWatchdog(id, ms) {
  if (!activeRun || activeRun.id !== id) return;
  clearTimeout(activeRun.wd);
  activeRun.wd = setTimeout(() => { if (activeRun && activeRun.id === id) { destroyRunner(); addLine("error", "Stopped: the runner stopped responding."); activeRun = null; setRunning(false); } }, ms);
}
$("runBtn").addEventListener("click", runCode);
$("stopBtn").addEventListener("click", () => {
  if (!runner || !activeRun) return;
  const id = activeRun.id; runner.contentWindow.postMessage({ type: "stop" }, "*");
  setTimeout(() => { if (activeRun && activeRun.id === id) { destroyRunner(); addLine("error", "Stopped."); activeRun = null; setRunning(false); } }, 1500);
});
$("clearBtn").addEventListener("click", () => { out.textContent = ""; });
$("language").addEventListener("change", () => { $("consoleLang").textContent = resolvedLanguage(); });
document.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); runCode(); } });

updateCount(); scheduleHighlight();

/* ---------- your name and number (no login; kept by a session cookie) ---------- */
const nameDlg = $("nameDlg");
const roleOf = p => (!p.dev && (p.role === "admin" || p.role === "moderator")) ? p.role : null;   // the server decides; this only picks the look
function showUser(u) {
  curUser = u; const c = $("userChip"), role = roleOf(u); c.textContent = "";
  c.classList.toggle("dev", Boolean(u.dev)); c.classList.remove("role-admin", "role-moderator"); if (role) c.classList.add("role-" + role);
  const b = document.createElement("b"); b.textContent = u.name; if (u.dev) b.className = "rainbow"; else if (role) b.className = "role-" + role;
  c.append(b, " · #" + u.id);
  if (u.dev) { const t = document.createElement("span"); t.className = "ptag dev-tag"; t.textContent = "developer"; c.append(t); }
  else if (role) { const t = document.createElement("span"); t.className = "ptag " + role + "-tag"; t.textContent = role; c.append(t); }
  c.classList.remove("hidden");
  $("rolesBtn").classList.toggle("hidden", !u.dev);
}
function openNameDialog() { if (!nameDlg.open) { nameMsg("", ""); $("nameSave").disabled = false; nameDlg.showModal(); $("nameInput").focus(); } }
nameDlg.addEventListener("cancel", e => e.preventDefault());   // a name is required
let nameTimer = 0, nameOk = false, nameSeq = 0;
function nameMsg(text, kind) {
  const e = $("nameErr"); e.textContent = text; e.classList.toggle("hidden", !text); e.classList.toggle("ok", kind === "ok");
  $("nameInput").classList.toggle("bad", kind === "bad"); $("nameInput").classList.toggle("good", kind === "ok");
}
$("nameInput").addEventListener("input", () => {            // tells you while you type if the name is free
  clearTimeout(nameTimer); nameOk = false; $("nameSave").disabled = true;
  const name = $("nameInput").value.trim().replace(/\s+/g, " ");
  if (!name) { nameMsg("", ""); return; }
  const seq = ++nameSeq;
  nameTimer = setTimeout(async () => {
    try {
      const r = await fetch("/api/name-available?name=" + encodeURIComponent(name)), d = await r.json().catch(() => ({}));
      if (seq !== nameSeq) return;
      if (!r.ok || typeof d.available !== "boolean") { nameOk = true; $("nameSave").disabled = false; nameMsg("Couldn't check this name right now. It will be checked when you continue.", ""); return; }   // never say "taken" unless the server said so
      nameOk = Boolean(d.available); $("nameSave").disabled = !nameOk;
      nameMsg(d.available ? "\u2713 \"" + name + "\" is available" : "That name is already taken. Please choose another.", d.available ? "ok" : "bad");
    } catch { nameOk = true; $("nameSave").disabled = false; nameMsg("", ""); }   // server decides on save
  }, 300);
});
async function saveName() {
  const name = $("nameInput").value.trim(), err = $("nameErr");
  if (!name) { nameMsg("Please enter a name.", "bad"); return; }
  if ($("nameInput").classList.contains("bad")) return;
  $("nameSave").disabled = true;
  try {
    const r = await fetch("/api/me", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const d = await r.json();
    if (!r.ok) { if (d.taken) nameOk = false; throw new Error(d.error || "Could not save your name."); }
    showUser(d.user); nameDlg.close();
    socket.disconnect(); socket.connect();            // reconnect so the server sees your new session
  } catch (e) { nameMsg(e.message, "bad"); }
  finally { $("nameSave").disabled = !nameOk && $("nameInput").classList.contains("bad"); }
}
$("nameSave").addEventListener("click", saveName);
$("nameInput").addEventListener("keydown", e => { if (e.key === "Enter") saveName(); });
socket.on("need-user", openNameDialog);
fetch("/api/me").then(r => r.json()).then(d => {
  if (d.user) showUser(d.user);
  else { const t = setInterval(() => { if (document.body.classList.contains("ready")) { clearInterval(t); if (!curUser) openNameDialog(); } }, 250); }
}).catch(() => {});
/* ---------- who's here ---------- */
const peerRows = new Map();
function renderPeers(peers) {
  const list = $("peerList"), byUser = new Map();
  for (const p of peers || []) { const k = String(p.uid ?? p.pid), e = byUser.get(k); if (e) e.n++; else byUser.set(k, { ...p, n: 1 }); }
  $("peerCount").textContent = byUser.size;
  list.querySelector(".peer-empty")?.remove();
  for (const [k, li] of peerRows) if (!byUser.has(k)) {                     // someone left
    peerRows.delete(k); li.classList.add("leaving"); setTimeout(() => li.remove(), reduceMotion ? 0 : 220);
  }
  for (const [k, p] of byUser) {
    let li = peerRows.get(k);
    if (!li) {
      li = document.createElement("li"); li.className = "peer enter";
      li.innerHTML = '<span class="pdot"></span><span class="pbody"><span class="pname"></span><span class="pmeta"></span></span><span class="ptags"></span>';
      peerRows.set(k, li); list.appendChild(li);
    }
    li.querySelector(".pdot").style.setProperty("--c", /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : "#9a9aa3");
    const role = roleOf(p), pn = li.querySelector(".pname");
    li.classList.toggle("dev", Boolean(p.dev)); pn.textContent = p.name; pn.classList.toggle("rainbow", Boolean(p.dev));
    for (const r of ["admin", "moderator"]) { li.classList.toggle("role-" + r, role === r); pn.classList.toggle("role-" + r, role === r); }
    li.querySelector(".pmeta").textContent = "#" + p.uid + (p.n > 1 ? " · " + p.n + " tabs" : "");
    const tags = li.querySelector(".ptags"); tags.textContent = "";
    const tag = (t, cls) => { const s = document.createElement("span"); s.className = "ptag" + (cls ? " " + cls : ""); s.textContent = t; tags.appendChild(s); };
    if (p.dev) tag("developer", "dev-tag"); else if (role) tag(role, role + "-tag");
    if (curUser && p.uid === curUser.id) tag("you");
    if (p.owner) tag("owner");
  }
  const av = $("avatars"); av.textContent = "";
  [...byUser.values()].slice(0, 5).forEach(p => {
    const s = document.createElement("span"); s.className = "av" + (p.dev ? " dev" : roleOf(p) ? " role-" + roleOf(p) : ""); s.textContent = (p.name || "?").trim().charAt(0).toUpperCase();
    s.style.setProperty("--c", /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : "#9a9aa3"); s.title = p.name + " (#" + p.uid + ")" + (curUser && p.uid === curUser.id ? " - you" : "");
    av.appendChild(s);
  });
  if (byUser.size > 5) { const s = document.createElement("span"); s.className = "av more"; s.textContent = "+" + (byUser.size - 5); av.appendChild(s); }
  if (!byUser.size && !list.querySelector(".peer-empty")) {
    const li = document.createElement("li"); li.className = "peer-empty";
    li.textContent = roomId ? "Connecting…" : "Open or create a workspace to see who is connected.";
    list.appendChild(li);
  }
}
socket.on("me-updated", d => { if (d && d.user && curUser && d.user.id === curUser.id) showUser({ ...curUser, ...d.user, name: curUser.name }); });

/* ---------- manage roles (the button is only shown to the developer; the server checks every request) ---------- */
const rolesDlg = $("rolesDlg"), rolesList = $("rolesList"), rolesMsg = $("rolesMsg");
let rolesTimer = 0, rolesSeq = 0;
function rolesNote(text, kind) { rolesMsg.textContent = text || ""; rolesMsg.className = "roles-msg" + (kind ? " " + kind : ""); }
function roleRow(u) {
  const li = document.createElement("li"); li.className = "roles-row";
  const nm = document.createElement("span"); nm.className = "rname"; nm.textContent = u.name;
  const num = document.createElement("small"); num.textContent = "#" + u.id; nm.append(num);
  li.append(nm);
  if (u.dev) { const t = document.createElement("span"); t.className = "ptag dev-tag"; t.textContent = "developer"; li.append(t); return li; }
  const sel = document.createElement("select"); sel.setAttribute("aria-label", "Role for " + u.name);
  [["", "None"], ["admin", "Admin"], ["moderator", "Moderator"]].forEach(([v, l]) => { const o = document.createElement("option"); o.value = v; o.textContent = l; sel.append(o); });
  sel.value = u.role || "";
  sel.addEventListener("change", async () => {
    sel.disabled = true; rolesNote("Saving…");
    try {
      const r = await fetch("/api/roles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userNumber: u.id, role: sel.value || null }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not change the role.");
      u.role = d.user.role; rolesNote(u.name + " is now " + (u.role || "a regular user") + ".", "ok");
    } catch (e) { sel.value = u.role || ""; rolesNote(e.message, "bad"); }
    finally { sel.disabled = false; }
  });
  li.append(sel); return li;
}
async function rolesSearch() {
  const q = $("rolesQ").value.trim(), seq = ++rolesSeq;
  if (!q) { rolesList.textContent = ""; rolesNote(""); return; }
  try {
    const r = await fetch("/api/roles?q=" + encodeURIComponent(q));
    if (!r.ok) throw new Error("Could not search.");
    const d = await r.json(); if (seq !== rolesSeq) return;
    rolesList.textContent = ""; (d.users || []).forEach(u => rolesList.append(roleRow(u)));
    rolesNote(d.users && d.users.length ? "" : "No one found.");
  } catch (e) { if (seq === rolesSeq) rolesNote(e.message, "bad"); }
}
$("rolesBtn").addEventListener("click", () => { rolesList.textContent = ""; rolesNote(""); $("rolesQ").value = ""; rolesDlg.showModal(); $("rolesQ").focus(); });
$("rolesQ").addEventListener("input", () => { clearTimeout(rolesTimer); rolesTimer = setTimeout(rolesSearch, 300); });
$("rolesClose").addEventListener("click", () => rolesDlg.close());
renderPeers([]);
if (!joinFromPath()) setStatus("Not connected", false);
})();
