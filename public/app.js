import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, deleteUser, reauthenticateWithPopup } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where, orderBy, limit, limitToLast, startAt, endAt, startAfter, onSnapshot, getDocs, writeBatch, serverTimestamp, Bytes, Timestamp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

const fb = initializeApp(firebaseConfig), auth = getAuth(fb), db = getFirestore(fb);
const $ = id => document.getElementById(id);
let me, profile, admin = false, current, chatUser, openClear, links = [], stops = [], stopChat;
const users = {};
const isQuota = e => e?.code === "resource-exhausted" || /quota/i.test(e?.message || "");
function banner() {
  if (document.getElementById("quotaBanner")) return;
  const b = document.createElement("div"); b.id = "quotaBanner";
  b.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:99999;background:#14213d;color:#fca311;padding:10px 12px;text-align:center;font:600 14px system-ui,sans-serif;display:flex;gap:10px;justify-content:center;align-items:center;flex-wrap:wrap";
  const t = document.createElement("span"); t.textContent = "Kushhook is very busy right now. Please try again in a little while.";
  const r = document.createElement("button"); r.textContent = "Try again"; r.onclick = () => location.reload();
  r.style.cssText = "background:#fca311;color:#14213d;border:0;border-radius:8px;padding:6px 12px;font-weight:700";
  b.append(t, r); document.body.append(b);
}
const fail = e => { console.error(e); if (isQuota(e)) return banner(); alert("That didn't work. " + e.message); };
addEventListener("unhandledrejection", ev => { if (isQuota(ev.reason)) { ev.preventDefault(); banner(); } });
const el = (tag, text = "", cls = "") => Object.assign(document.createElement(tag), { textContent: text, className: cls });
const button = (text, fn) => { const b = el("button", text); b.onclick = () => Promise.resolve(fn()).catch(fail); return b; };
// Safe links: text is never treated as HTML
function rich(node, text) {
  for (const part of text.split(/(https?:\/\/\S+)/)) {
    if (/^https?:\/\//.test(part)) node.append(Object.assign(el("a", part), { href: part, target: "_blank", rel: "noopener noreferrer" }));
    else node.append(part);
  }
  return node;
}
// Avatars are tiny codes ("colour.symbol") drawn in the browser: no image uploads, no storage
const palette = [["#7c52f0","#b18cff"],["#ff7a18","#ffb000"],["#e5484d","#ff8a8a"],["#0fa968","#6ee7b7"],["#0891b2","#67e8f9"],["#2563eb","#93c5fd"],["#c026d3","#f0abfc"],["#db2777","#f9a8d4"],["#475569","#94a3b8"],["#65a30d","#bef264"],["#d97706","#fcd34d"],["#0f766e","#5eead4"]];
const symbols = ["🦊","🐼","🐯","🦁","🐸","🐙","🦄","🐧","🐢","🦉","🐬","🦋","🐝","🦖","🚀","🌙","⭐","🔥","🍀","🍉","🎧","🎮","⚡","🌈"];
const avatar = (u, big) => {
  const [c, s] = (u?.avatar || "").split(".").map(Number), col = palette[c] || palette[(u?.username?.length || 0) % palette.length];
  const a = el("span", symbols[s] || (u?.name || "?")[0].toUpperCase(), "avatar" + (big ? " big" : ""));
  a.style.background = `linear-gradient(135deg, ${col[0]}, ${col[1]})`;
  return a;
};
const nameBlock = (u, bio) => { const s = el("span", "", "pname"); s.append(el("b", u.name), el("small", "@" + u.username)); if (bio && u.bio) s.append(el("small", u.bio, "bio")); return s; };
// "14:05", "Yesterday 14:05", "Tue 14:05", "12 Nov 14:05"
const clock = t => {
  const d = new Date(t), n = new Date(), hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  return days <= 0 ? hm : days === 1 ? "Yesterday " + hm : days < 7 ? d.toLocaleDateString([], { weekday: "short" }) + " " + hm : d.toLocaleDateString([], { day: "numeric", month: "short" }) + " " + hm;
};
// Reports go to the admin. One report per person, message or post.
async function report(kind, key, against, ref, sample = "") {
  if (!against || against === me.uid) return;
  const what = kind === "message" ? "this message. The sender's username and the message text will be sent to the admin" : kind === "post" ? "this post" : "this person";
  const reason = prompt(`Report ${what}.\n\nWhat is wrong? (optional)`);
  if (reason === null) return;
  try {
    await setDoc(doc(db, "reports", `${me.uid}_${kind}_${key}`), { by: me.uid, against, kind, key, ref, reason: reason.trim().slice(0, 300), sample: sample.slice(0, 500), at: serverTimestamp() });
    alert("Thank you. The admin has been told.");
  } catch (e) { console.error(e); alert("Could not send the report. You may have already reported this."); }
}
const getUser = async id => users[id] ??= (await getDoc(doc(db, "users", id))).data();
const pair = id => [me.uid, id].sort().join("_");

// ---- Private chats: end-to-end encryption ----
// Your key is made in your browser and locked with your passphrase. Only the locked copy is stored online.
const ECDH = { name: "ECDH", namedCurve: "P-256" }, enc = new TextEncoder(), dec = new TextDecoder();
let myKey, ckey, partnerPub;
const b64 = u => btoa(String.fromCharCode(...u)), unb64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
async function seal(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12)), ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out;
}
const unseal = async (key, u8) => new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: u8.subarray(0, 12) }, key, u8.subarray(12)));
const sha = async t => [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(t)))].map(x => x.toString(16).padStart(2, "0")).join("");
const idb = (mode, fn) => new Promise((ok, no) => {
  const r = indexedDB.open("kushhook", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("k");
  r.onerror = () => no(r.error);
  r.onsuccess = () => { const t = r.result.transaction("k", mode), q = fn(t.objectStore("k")); t.oncomplete = () => ok(q?.result); t.onerror = () => no(t.error); };
});
async function passKey(pass, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function keep(pkcs8) {
  myKey = await crypto.subtle.importKey("pkcs8", pkcs8, ECDH, false, ["deriveBits"]);
  await idb("readwrite", s => s.put({ key: myKey, pub: profile.pub }, me.uid)).catch(() => {});
}
async function createKeys(pass) {
  if (pass.length < 8) throw new Error("Use at least 8 characters.");
  const kp = await crypto.subtle.generateKey(ECDH, true, ["deriveBits"]), j = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey)), pub = JSON.stringify({ kty: j.kty, crv: j.crv, x: j.x, y: j.y });
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await setDoc(doc(db, "keys", me.uid), { salt: b64(salt), wrapped: b64(await seal(await passKey(pass, salt), pkcs8)) });
  await updateDoc(doc(db, "users", me.uid), { pub });
  profile = { ...profile, pub }; users[me.uid] = profile;
  await keep(pkcs8);
}
async function unlockKeys(pass) {
  const k = (await getDoc(doc(db, "keys", me.uid))).data();
  let pkcs8; try { pkcs8 = await unseal(await passKey(pass, unb64(k.salt)), unb64(k.wrapped)); } catch { throw new Error("Wrong passphrase."); }
  await keep(pkcs8);
}
function askPass(mode) {
  return new Promise(ok => {
    const box = $("lockbox"), err = $("lockError");
    $("lockTitle").textContent = mode === "create" ? "Create your chat passphrase" : "Unlock your chats";
    $("lockText").textContent = mode === "create"
      ? "Your messages and files are locked so only you and your friend can read them. Choose a passphrase of at least 8 characters. Nobody can recover it for you, so remember it."
      : "Enter your chat passphrase to read your messages on this device.";
    $("pass").value = $("pass2").value = ""; err.textContent = "";
    $("pass2").hidden = !(mode === "create"); $("pass2").required = mode === "create"; $("resetKeys").hidden = mode !== "unlock";
    if (!box.open) box.showModal();
    $("lockForm").onsubmit = async e => {
      e.preventDefault(); err.textContent = "Working...";
      try {
        if (mode === "create") { if ($("pass").value !== $("pass2").value) throw new Error("The two passphrases don't match."); await createKeys($("pass").value); }
        else await unlockKeys($("pass").value);
        box.close(); ok();
      } catch (x) { err.textContent = x.message; }
    };
    $("resetKeys").onclick = () => { if (confirm("Reset encryption? Your old messages will become unreadable. Only do this if you forgot your passphrase.")) askPass("create").then(ok); };
  });
}
$("lockbox").oncancel = e => e.preventDefault();
async function setupKeys() {
  const has = (await getDoc(doc(db, "keys", me.uid))).exists() && profile.pub;
  const saved = await idb("readonly", s => s.get(me.uid)).catch(() => null);
  if (has && saved?.pub === profile.pub) { myKey = saved.key; return; }
  await askPass(has ? "unlock" : "create");
}
async function chatKeyFor(pub, chatId) {
  const theirs = await crypto.subtle.importKey("jwk", JSON.parse(pub), ECDH, false, []);
  const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: theirs }, myKey, 256);
  const base = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: enc.encode("kushhook"), info: enc.encode(chatId) }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function readMsg(m) {
  if (!m.e) return m; // sent before encryption was added
  try {
    const plain = dec.decode(await unseal(ckey, unb64(m.text)));
    if (!m.path) return { ...m, text: plain };
    const meta = JSON.parse(plain); return { ...m, text: "", name: meta.n, type: meta.t };
  } catch { return { ...m, text: "🔒 Can't unlock this message", path: undefined }; }
}

$("login").onclick = () => signInWithPopup(auth, new GoogleAuthProvider()).catch(e => $("error").textContent = e.message);
$("logout").onclick = () => purgeMine(current).then(() => signOut(auth)).then(() => location.reload());
onAuthStateChanged(auth, async user => {
  if (!user) return;
  me = user;
  const ban = await getDoc(doc(db, "banned", me.uid)).then(d => d.data(), () => null);
  if (ban) {
    $("error").textContent = ban.kind === "removed" ? "This account has been removed from Kushhook." : "This account is suspended. Please contact the admin.";
    $("login").hidden = false; $("setup").hidden = true; await signOut(auth); return;
  }
  profile = (await getDoc(doc(db, "users", me.uid))).data();
  $("login").hidden = true;
  if (profile) return start();
  $("setup").hidden = false;
  $("name").value = (me.displayName || "").slice(0, 40);
});
$("setup").onsubmit = async e => {
  e.preventDefault();
  const name = $("name").value.trim(), username = $("username").value;
  const data = { name, username, nameLower: name.toLowerCase(), adult: true };
  const batch = writeBatch(db);
  batch.set(doc(db, "usernames", username), { uid: me.uid });
  batch.set(doc(db, "users", me.uid), data);
  try { await batch.commit(); profile = data; start(); }
  catch { $("error").textContent = "Could not create profile. Try another username."; }
};

async function start() {
  $("auth").hidden = true; $("app").hidden = false;
  admin = me.email === "daakyehenefoundation@gmail.com" || (await getDoc(doc(db, "admins", me.uid))).exists();
  $("postForm").hidden = !admin;
  if (admin) { $("type").add(new Option("Bet odds (18+)", "odds")); $("adminTab").hidden = false; }
  if (!admin) stops.push(onSnapshot(doc(db, "banned", me.uid), s => { if (s.exists()) { alert("Your account has been suspended."); signOut(auth).then(() => location.reload()); } }, () => {}));
  loadRead(); await setupKeys().catch(fail); beat();
  idleWatch(); callWatch();
  stops.push(onSnapshot(query(collection(db, "friends"), where("users", "array-contains", me.uid)), async s => {
    links = s.docs.map(d => ({ id: d.id, ...d.data() }));
    watchLatest(links.filter(l => l.status === "accepted").map(l => l.id));
    await drawChats(); search(); if (admin) drawMembers();
    if (current && !links.some(l => l.id === current && l.status === "accepted")) closeChat();
    else if (current && links.find(l => l.id === current)?.clear?.[me.uid]?.toMillis?.() !== openClear) openChat(current, chatUser);
  }, fail));
  stops.push(onSnapshot(query(collection(db, "posts"), orderBy("at", "desc"), limit(50)), s => {
    $("posts").replaceChildren(...s.docs.map(d => {
      const p = d.data(), box = el("div", "", "post");
      box.append(el("b", "@" + p.username), el("small", p.at?.toMillis ? clock(p.at.toMillis()) : "", "time"));
      if (p.type === "odds") box.append(el("span", "Bet odds, 18+ only\n", "odds")); else box.append("\n");
      const url = p.title ? (p.text.match(/https?:\/\/[^\s<>"]+/i) || [])[0] : null;
      if (url) {
        let host = ""; try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { host = ""; }
        const a = Object.assign(document.createElement("a"), { href: url, target: "_blank", rel: "noopener noreferrer", className: "linkcard" });
        a.append(el("b", p.title), el("small", host ? "Opens " + host : "Tap to open"), el("span", "↗", "go"));
        box.append(a);
        const rest = p.text.replace(url, "").trim(); if (rest) rich(box, rest);
      } else {
        if (p.title) box.append(el("b", p.title, "ptitle"), "\n");
        rich(box, p.text);
      }
      const foot = el("div", "", "foot");
      if (admin || p.uid === me.uid) foot.append(Object.assign(button("Delete", () => deleteDoc(d.ref)), { className: "del" }));
      if (p.uid !== me.uid) foot.append(Object.assign(button("Report", () => report("post", d.id, p.uid, "posts/" + d.id, p.text)), { className: "del" }));
      if (foot.childNodes.length) box.append(foot);
      return box;
    }));
  }, fail));
  if (admin) stops.push(onSnapshot(query(collection(db, "reports"), orderBy("at", "desc"), limit(50)), s => {
    reports = s.docs.map(d => ({ id: d.id, ...d.data(), at: d.data().at?.toMillis?.() || Date.now() }));
    const bd = document.querySelector("#adminTab .badge"); bd.hidden = !reports.length; bd.textContent = reports.length;
    drawReports().catch(() => {});
  }, () => {}));
  tab("chats"); drawMe(); if (!profile.avatar) openProfile();
}

// ---- New-message dots (remembered on this device) ----
let readAt = {}, latest = {}, watching = {}, firstRun = false;
const readKey = () => "kh_read_" + me.uid;
const loadRead = () => { try { const t = localStorage.getItem(readKey()); firstRun = t === null; readAt = JSON.parse(t || "{}"); } catch { readAt = {}; } };
const saveRead = () => { try { localStorage.setItem(readKey(), JSON.stringify(readAt)); } catch {} };
const viewing = id => current === id && $("app").classList.contains("open") && document.visibilityState === "visible";
const unread = id => { const m = latest[id]; return !!m && m.from !== me.uid && m.at > (readAt[id] || 0); };
function markRead(id) { const m = latest[id]; if (m && m.at > (readAt[id] || 0)) { readAt[id] = m.at; saveRead(); drawChats().catch(() => {}); } }
function watchLatest(ids) {
  for (const id of Object.keys(watching)) if (!ids.includes(id)) { watching[id](); delete watching[id]; delete latest[id]; }
  for (const id of ids) if (!watching[id]) watching[id] = onSnapshot(query(collection(db, "friends", id, "messages"), orderBy("at", "desc"), limit(1)), s => {
    const d = s.docs[0]?.data(), at = d?.at?.toMillis?.();
    if (!at) return;
    latest[id] = { at, from: d.from };
    if (firstRun && readAt[id] === undefined) { readAt[id] = at; saveRead(); }
    if (viewing(id) && at > (readAt[id] || 0)) { readAt[id] = at; saveRead(); }
    drawChats().catch(() => {});
  }, () => {});
}
addEventListener("visibilitychange", () => { if (me && current && viewing(current)) markRead(current); });

async function drawChats() {
  const found = await Promise.all(links.filter(l => l.status === "accepted" || l.status === "pending").map(async l => ({ l, u: await getUser(l.users.find(x => x !== me.uid)) })));
  const all = found.filter(x => x.u && !x.u.suspended), card = ({ l, u }, ...btns) => { const row = el("div", "", "row"); row.append(avatar(u), nameBlock(u, l.status === "pending"), ...btns); return row; };
  const ghost = (text, fn) => Object.assign(button(text, fn), { className: "ghost" });
  const chats = all.filter(x => x.l.status === "accepted").sort((a, b) => (latest[b.l.id]?.at || 0) - (latest[a.l.id]?.at || 0)).map(x => {
    const r = card(x, button("Open", () => openChat(x.l.id, x.u))), m = latest[x.l.id];
    if (m) r.querySelector(".pname").append(el("small", (m.from === me.uid ? "You · " : "") + clock(m.at), "when"));
    if (unread(x.l.id)) { r.classList.add("new"); r.querySelector(".pname b").append(el("i", "", "dot")); }
    return r;
  });
  const n = all.filter(x => x.l.status === "accepted" && unread(x.l.id)).length, cb = document.querySelector('nav [data-tab="chats"] .badge');
  cb.hidden = !n; cb.textContent = n; document.title = n ? `(${n}) Kushhook` : "Kushhook";
  $("chats").replaceChildren(...(chats.length ? chats : [el("p", "No chats yet. Open People to send a request.")]));
  const incoming = all.filter(x => x.l.status === "pending" && x.l.from !== me.uid), sent = all.filter(x => x.l.status === "pending" && x.l.from === me.uid);
  $("requests").replaceChildren(
    el("h3", `Requests for you (${incoming.length})`),
    ...(incoming.length ? incoming.map(x => card(x, button("Accept", () => updateDoc(doc(db, "friends", x.l.id), { status: "accepted" })), ghost("Decline", () => deleteDoc(doc(db, "friends", x.l.id))))) : [el("p", "No new requests.")]),
    el("h3", `Sent by you (${sent.length})`),
    ...(sent.length ? sent.map(x => card(x, ghost("Cancel", () => deleteDoc(doc(db, "friends", x.l.id))))) : [el("p", "Nothing waiting.")]));
  { const bd = $("reqTab").querySelector(".badge"); bd.hidden = !incoming.length; bd.textContent = incoming.length; }
}

let searchRun = 0, pool = null, poolAt = 0;
// Members are loaded once (and refreshed every minute) so every letter you type filters instantly
async function loadPool() {
  if (pool && Date.now() - poolAt < 60000) return pool;
  const s = await getDocs(query(collection(db, "users"), orderBy("nameLower"), limit(500)));
  pool = s.docs.map(d => ({ id: d.id, ...d.data() })); poolAt = Date.now(); return pool;
}
async function search() {
  const run = ++searchRun, term = $("search").value.trim().toLowerCase().replace(/^@/, ""), all = await loadPool();
  if (run !== searchRun) return;
  // best matches first: username starts with it, name starts with it, a word or the initials start with it, then anywhere
  const rank = u => {
    const n = u.nameLower || "", un = u.username || "", words = n.split(/\s+/).filter(Boolean);
    if (!term) return 5;
    if (un.startsWith(term)) return 0;
    if (n.startsWith(term)) return 1;
    if (words.some(w => w.startsWith(term)) || words.map(w => w[0]).join("").startsWith(term)) return 2;
    return un.includes(term) || n.includes(term) ? 3 : -1;
  };
  const list = all.filter(u => !u.suspended && u.id !== me.uid && links.find(l => l.id === pair(u.id))?.status !== "blocked").map(u => [rank(u), u]).filter(x => x[0] >= 0)
    .sort((a, b) => a[0] - b[0] || (a[1].nameLower || "").localeCompare(b[1].nameLower || "")).slice(0, 50);
  $("results").replaceChildren(
    ...(list.length ? [el("p", term ? `${list.length} found` : `${list.length} people`, "count")] : [el("p", term ? "No one matches that. Try fewer letters." : "No one to add yet.")]),
    ...list.map(([, u]) => {
      const row = el("div", "", "row");
      const l = links.find(x => x.id === pair(u.id));
      row.append(avatar(u), nameBlock(u, true), l?.status === "accepted" ? button("Message", () => { document.querySelector('nav [data-tab="chats"]')?.click(); openChat(l.id, u); }) : l ? el("small", "Pending") : button(admin ? "Connect" : "Send request", () => setDoc(doc(db, "friends", pair(u.id)), { users: [me.uid, u.id].sort(), from: me.uid, status: admin ? "accepted" : "pending" })));
      return row;
    }));
}
let timer;
$("search").oninput = () => { clearTimeout(timer); timer = setTimeout(() => search().catch(fail), 80); };

let lastSnap, renderRun = 0, stopKeys, stopPresence, seen, lastType = 0, keyReady = Promise.resolve();
function openChat(id, u) {
  stopChat?.(); stopKeys?.(); stopPresence?.(); const prev = current; current = id; chatUser = u;
  if (prev !== id) { if (prev) { purgeMine(prev); clearUrls(); } purgeMine(id); }
  const cleared = links.find(l => l.id === id)?.clear?.[me.uid];
  openClear = cleared?.toMillis?.();
  const label = el("span", "", "whotext"), pr = Object.assign(el("small", "", "presence"), { id: "presence" });
  label.append(el("span", u.name, "wname"), pr); $("who").replaceChildren(avatar(u), label);
  $("send").hidden = $("block").hidden = $("clear").hidden = $("lock").hidden = $("report").hidden = $("more").hidden = $("call").hidden = false; $("app").classList.add("open"); markRead(id);
  // wait for the other person's public key, then lock and unlock messages with the key you share
  const other = id.split("_").find(x => x !== me.uid); let first, done = false;
  ckey = null; partnerPub = null; lastSnap = null; seen = null; keyReady = new Promise(r => first = r);
  stopKeys = onSnapshot(doc(db, "users", other), async s => {
    const pub = s.data()?.pub || null;
    if (done && pub === partnerPub) return;
    done = true; partnerPub = pub;
    const k = pub ? await chatKeyFor(pub, id).catch(() => null) : null;
    if (current !== id) return;
    ckey = k; first(); setStatus(ckey ? "" : `${u.name} hasn't turned on encryption yet.`); render();
  }, () => first());
  stopPresence = onSnapshot(doc(db, "presence", other), s => { seen = s.data() || null; drawPresence(); }, () => {});
  const msgs = collection(db, "friends", id, "messages");
  const q = cleared ? query(msgs, orderBy("at"), startAfter(cleared), limitToLast(100)) : query(msgs, orderBy("at"), limitToLast(100));
  let swept = false;
  stopChat = onSnapshot(q, s => { lastSnap = s; render(); if (!swept) { swept = true; sweepOld(s); } }, fail);
}
// Your own messages older than 30 days are removed when you open the chat. This keeps the free storage small.
const MSG_DAYS = 30;
function sweepOld(s) {
  const cutoff = Date.now() - MSG_DAYS * 864e5;
  s.docs.forEach(d => { const m = d.data(), t = m.at?.toMillis?.(); if (m.from === me.uid && t && t < cutoff) removeMessage(d.ref, m).catch(() => {}); });
}
async function render() {
  const run = ++renderRun, s = lastSnap, cid = current;
  if (!s) return;
  await keyReady;
  const rows = await Promise.all(s.docs.map(async d => {
    const raw = d.data(), m = await readMsg(raw), mine = raw.from === me.uid, bubble = el("div", "", "bubble" + (mine ? " me" : ""));
    if (m.path) bubble.append(media(m, d.ref));
    rich(bubble, m.text);
    const at = raw.at?.toMillis?.(), foot = el("div", "", "foot");
    foot.append(el("small", at ? clock(at) : "sending…", "time"));
    if (mine || admin) foot.append(Object.assign(button(mine ? "Unsend" : "Delete", async () => {
      if (!confirm(mine ? "Unsend this message? It will be removed for both of you." : "Delete this message for everyone?")) return;
      await removeMessage(d.ref, raw);
    }), { className: "del" }));
    if (!mine) foot.append(Object.assign(button("Report", () => report("message", d.id, raw.from, `friends/${cid}/messages/${d.id}`, m.text || m.name || "")), { className: "del" }));
    bubble.append(foot);
    return bubble;
  }));
  if (run !== renderRun) return;
  $("messages").replaceChildren(...rows);
  $("messages").scrollTop = $("messages").scrollHeight;
}
function closeChat() {
  stopChat?.(); stopKeys?.(); stopPresence?.(); typing(false); purgeMine(current); clearUrls(); current = null; ckey = null; lastSnap = null;
  $("messages").replaceChildren(); $("who").textContent = "Choose a chat"; setStatus("");
  $("send").hidden = $("block").hidden = $("clear").hidden = $("lock").hidden = $("report").hidden = $("more").hidden = $("call").hidden = true; $("chatMenu").hidden = true; $("app").classList.remove("open");
}
$("report").onclick = () => { const other = current.split("_").find(x => x !== me.uid); report("user", other, other, "users/" + other); };
$("clear").onclick = () => confirm("Clear this chat for you? The other person keeps their copy.") && updateDoc(doc(db, "friends", current), { ["clear." + me.uid]: serverTimestamp() }).catch(fail);
$("back").onclick = () => { $("app").classList.remove("open"); purgeMine(current); typing(false); };
$("block").onclick = () => confirm("Block this person?") && updateDoc(doc(db, "friends", current), { status: "blocked", blockedBy: me.uid }).catch(fail);
$("lock").onclick = async () => {
  if (!ckey) return alert(`${chatUser.name} hasn't turned on encryption yet.`);
  const code = (await sha([profile.pub, partnerPub].sort().join("|"))).slice(0, 24).match(/.{4}/g).join(" ");
  alert(`Messages and files in this chat are end-to-end encrypted.\n\nSafety code:\n${code}\n\nAsk ${chatUser.name} to open the lock too. If the codes match, nobody is listening in between.`);
};
$("send").onsubmit = async e => {
  e.preventDefault();
  const text = $("msg").value.trim(), chat = current;
  if (!text || !chat) return;
  if (!ckey) return setStatus(`${chatUser.name} hasn't turned on encryption yet.`);
  $("msg").value = ""; typing(false);
  try { await addDoc(collection(db, "friends", chat, "messages"), { from: me.uid, text: b64(await seal(ckey, enc.encode(text))), at: serverTimestamp(), e: 1 }); }
  catch (err) { fail(err); }
};
// ---- Online and typing ----
const beat = () => { if (me && document.visibilityState === "visible") setDoc(doc(db, "presence", me.uid), { at: serverTimestamp() }, { merge: true }).catch(() => {}); };
const typing = on => { if (me) setDoc(doc(db, "presence", me.uid), on ? { typing: current, typingAt: serverTimestamp() } : { typing: null }, { merge: true }).catch(() => {}); };
const ago = t => { const m = Math.max(1, Math.round((Date.now() - t) / 60000)); return m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago"; };
function drawPresence() {
  const p = $("presence"); if (!p) return;
  const t = seen?.typingAt?.toMillis?.(), a = seen?.at?.toMillis?.();
  const text = seen?.typing === current && t && Date.now() - t < 7000 ? "typing…" : a && Date.now() - a < 180000 ? "online" : a ? "last seen " + ago(a) : "";
  p.textContent = text; p.classList.toggle("on", text === "online" || text === "typing…");
}
setInterval(drawPresence, 3000); setInterval(beat, 90000); addEventListener("visibilitychange", beat);
$("msg").oninput = () => { if (current && Date.now() - lastType > 2500) { lastType = Date.now(); typing(true); } };
$("emojis").hidden = true;
$("smile").onclick = () => $("emojis").hidden = !$("emojis").hidden;
for (const x of ["😀","😂","😍","😎","😢","🙏","👍","🔥","❤️","🎉"]) {
  const b = button(x, () => $("msg").value += x); b.type = "button"; $("emojis").append(b);
}
$("postForm").onsubmit = e => {
  e.preventDefault();
  const text = $("postText").value.trim();
  const title = $("postTitle").value.trim();
  if (text) addDoc(collection(db, "posts"), { uid: me.uid, username: profile.username, type: $("type").value, text, ...(title ? { title } : {}), at: serverTimestamp() })
    .then(() => { $("postText").value = ""; $("postTitle").value = ""; }).catch(fail);
};
function tab(name) {
  for (const b of document.querySelectorAll("nav button")) { b.classList.toggle("on", b.dataset.tab === name); $(b.dataset.tab).hidden = b.dataset.tab !== name; }
  if (name === "people") search().catch(fail);
  if (name === "admin") loadMembers().catch(fail);
}
document.querySelectorAll("nav button").forEach(b => b.onclick = () => tab(b.dataset.tab));

let reports = [];
async function drawReports() {
  const rows = await Promise.all(reports.map(async r => {
    const [by, against] = await Promise.all([getUser(r.by), getUser(r.against)]), row = el("div", "", "report");
    row.append(el("b", r.kind === "user" ? "Person reported" : r.kind === "post" ? "Post reported" : "Message reported"),
      el("small", `${clock(r.at)} · by @${by?.username || "deleted"} · about @${against?.username || "deleted"}`));
    if (r.reason) row.append(el("p", r.reason));
    if (r.sample) row.append(el("small", "Text shared by the reporter:"), el("p", r.sample, "sample"));
    const acts = el("div", "", "foot");
    if (r.kind === "post") acts.append(button("Delete post", async () => { await deleteDoc(doc(db, r.ref)).catch(() => {}); await deleteDoc(doc(db, "reports", r.id)); }));
    if (against && !against.suspended && r.against !== me.uid) acts.append(Object.assign(button("Suspend person", async () => { await setSuspended({ id: r.against, ...against }, true); await deleteDoc(doc(db, "reports", r.id)); }), { className: "danger" }));
    acts.append(Object.assign(button("Dismiss", () => deleteDoc(doc(db, "reports", r.id))), { className: "ghost" }));
    row.append(acts); return row;
  }));
  $("reports").replaceChildren(el("h3", `Reports (${reports.length})`), ...(rows.length ? rows : [el("p", "No reports. All calm.")]));
}
let allUsers = [];
let removed = [];
let adminIds = new Set();
const isOwner = () => me.email === "daakyehenefoundation@gmail.com";
async function loadMembers() {
  const s = await getDocs(query(collection(db, "users"), orderBy("username"), limit(1000)));
  allUsers = s.docs.map(d => ({ id: d.id, ...d.data() }));
  removed = (await getDocs(collection(db, "banned")).catch(() => ({ docs: [] }))).docs.map(d => ({ id: d.id, ...d.data() })).filter(x => x.kind === "removed");
  adminIds = new Set((await getDocs(collection(db, "admins")).catch(() => ({ docs: [] }))).docs.map(d => d.id));
  drawMembers();
}
// Make or remove an admin.
async function setAdmin(u, on) {
  if (!confirm(on ? `Make @${u.username} an admin? They can post links, remove posts and manage members.` : `Remove admin from @${u.username}?`)) return;
  try {
    if (on) await setDoc(doc(db, "admins", u.id), { at: serverTimestamp(), by: me.uid }); else await deleteDoc(doc(db, "admins", u.id));
    if (on) adminIds.add(u.id); else adminIds.delete(u.id);
    drawMembers();
  } catch (e) { fail(e); }
}
// Suspend: hidden from everyone and locked out until you restore them.
async function setSuspended(u, on) {
  if (on && !confirm(`Suspend @${u.username}? They are signed out and hidden from everyone until you restore them.`)) return;
  const batch = writeBatch(db);
  if (on) batch.set(doc(db, "banned", u.id), { at: serverTimestamp(), by: me.uid, name: u.username, kind: "suspended" }); else batch.delete(doc(db, "banned", u.id));
  batch.update(doc(db, "users", u.id), { suspended: on });
  await batch.commit();
  u.suspended = on; if (users[u.id]) users[u.id].suspended = on; pool = null; drawMembers();
}
// Remove: deletes their profile and posts, frees the username and locks the account out for good.
async function removeMember(u) {
  if (prompt(`Remove @${u.username} for good? Their profile and posts are deleted and they cannot come back unless you restore them.\n\nType REMOVE to confirm.`) !== "REMOVE") return;
  const batch = writeBatch(db);
  batch.set(doc(db, "banned", u.id), { at: serverTimestamp(), by: me.uid, name: u.username, kind: "removed" });
  batch.delete(doc(db, "users", u.id)); batch.delete(doc(db, "usernames", u.username));
  await batch.commit();
  for (const d of (await getDocs(query(collection(db, "posts"), where("uid", "==", u.id)))).docs) await deleteDoc(d.ref).catch(() => {});
  allUsers = allUsers.filter(x => x.id !== u.id); removed.push({ id: u.id, name: u.username, kind: "removed" }); delete users[u.id]; pool = null; drawMembers();
}
function drawMembers() {
  const term = $("adminSearch").value.trim().toLowerCase().replace(/^@/, "");
  const list = allUsers.filter(u => u.id !== me.uid && ((u.username || "").includes(term) || (u.nameLower || "").includes(term)));
  const off = allUsers.filter(u => u.suspended).length;
  $("members").replaceChildren(el("p", `${allUsers.length} members${off ? ` · ${off} suspended` : ""}`, "count"), ...list.map(u => {
    const row = el("div", "", "row" + (u.suspended ? " off" : "")), link = links.find(l => l.id === pair(u.id));
    row.append(avatar(u), nameBlock(u, true));
    if (adminIds.has(u.id)) row.append(el("small", "Admin", "isadmin"));
    if (u.suspended) row.append(el("small", "Suspended", "tag"));
    else if (link) row.append(el("small", link.status === "accepted" ? "Connected" : link.status === "pending" ? "Pending" : "Blocked"));
    else row.append(button("Connect", () => setDoc(doc(db, "friends", pair(u.id)), { users: [me.uid, u.id].sort(), from: me.uid, status: "accepted" })));
    const foot = el("div", "", "foot");
    if (!adminIds.has(u.id)) foot.append(button("Make admin", () => setAdmin(u, true)));
    else if (isOwner()) foot.append(Object.assign(button("Remove admin", () => setAdmin(u, false)), { className: "ghost" }));
    foot.append(u.suspended ? button("Restore", () => setSuspended(u, false)) : Object.assign(button("Suspend", () => setSuspended(u, true)), { className: "ghost" }),
      Object.assign(button("Remove", () => removeMember(u)), { className: "danger" }));
    row.append(foot);
    return row;
  }), ...(removed.length ? [el("h3", `Removed (${removed.length})`), ...removed.map(x => {
    const row = el("div", "", "row off"); row.append(el("span", "@" + x.name, "pname"), button("Restore", async () => { await deleteDoc(doc(db, "banned", x.id)); removed = removed.filter(y => y.id !== x.id); drawMembers(); }));
    return row;
  })] : []));
}
$("adminSearch").oninput = drawMembers;

// ---- Profile: username and avatar ----
let pick;
const drawMe = () => $("me").replaceChildren(avatar(profile));
function drawPick() {
  $("preview").replaceChildren(avatar({ avatar: pick.c + "." + pick.s }, true));
  $("colors").replaceChildren(...palette.map((p, i) => {
    const b = el("button", "", "swatch" + (i === pick.c ? " on" : "")); b.type = "button"; b.setAttribute("aria-label", "Colour " + (i + 1));
    b.style.background = `linear-gradient(135deg, ${p[0]}, ${p[1]})`; b.onclick = () => { pick.c = i; drawPick(); }; return b;
  }));
  $("symbols").replaceChildren(...symbols.map((x, i) => {
    const b = el("button", x, "sym" + (i === pick.s ? " on" : "")); b.type = "button"; b.onclick = () => { pick.s = i; drawPick(); }; return b;
  }));
}
let nameWait = 0;
function openProfile() {
  const [c, s] = (profile.avatar || "").split(".").map(Number);
  pick = { c: palette[c] ? c : Math.floor(Math.random() * palette.length), s: symbols[s] ? s : Math.floor(Math.random() * symbols.length) };
  nameWait = (profile.usernameChangedAt?.toMillis?.() || 0) + 14 * 864e5 - Date.now();
  $("bio").value = profile.bio || ""; $("newName").value = profile.username; $("newName").readOnly = nameWait > 0; $("profileError").textContent = ""; $("cancelProfile").hidden = !profile.avatar;
  $("nameHint").textContent = nameWait > 0 ? `You can change your username again in ${Math.ceil(nameWait / 864e5)} day(s).` : "a-z, 0-9 and _ only, 3 to 20 characters. You can change it once every 14 days.";
  $("deleteAccount").hidden = admin;
  drawPick(); $("profile").showModal();
}
$("me").onclick = openProfile;
$("cancelProfile").onclick = () => $("profile").close();
$("profile").oncancel = e => { if (!profile.avatar) e.preventDefault(); };
$("profileForm").onsubmit = async e => {
  e.preventDefault();
  const name = $("newName").value.trim(), code = pick.c + "." + pick.s, changed = name !== profile.username;
  if (!/^[a-z0-9_]{3,20}$/.test(name)) { $("profileError").textContent = "Username: 3 to 20 characters, a-z, 0-9 or _"; return; }
  if (changed && nameWait > 0) { $("profileError").textContent = "You changed your username recently. Try again later."; return; }
  const batch = writeBatch(db), data = { username: name, avatar: code, bio: $("bio").value.trim().slice(0, 140) };
  if (changed) { data.usernameChangedAt = serverTimestamp(); batch.set(doc(db, "usernames", name), { uid: me.uid }); batch.delete(doc(db, "usernames", profile.username)); }
  batch.update(doc(db, "users", me.uid), data);
  try { await batch.commit(); }
  catch (err) { console.error(err); $("profileError").textContent = changed ? "Could not save. That username may already be taken." : "Could not save. Try again."; return; }
  profile = { ...profile, username: name, avatar: code, bio: data.bio, ...(changed ? { usernameChangedAt: Timestamp.now() } : {}) }; users[me.uid] = profile;
  $("profile").close(); drawMe();
};
// Delete account: removes your messages, posts, keys and profile, then your sign-in
$("deleteAccount").onclick = async () => {
  if (prompt("This permanently deletes your account, messages and posts. Type DELETE to confirm.") !== "DELETE") return;
  try {
    await reauthenticateWithPopup(me, new GoogleAuthProvider());
    stops.forEach(f => f()); stopChat?.(); stopKeys?.(); stopPresence?.(); current = null;
    for (const l of links) {
      try { for (const d of (await getDocs(query(collection(db, "friends", l.id, "messages"), where("from", "==", me.uid)))).docs) await removeMessage(d.ref, d.data()).catch(() => {}); } catch {}
      await deleteDoc(doc(db, "friends", l.id)).catch(() => {});
    }
    for (const d of (await getDocs(query(collection(db, "posts"), where("uid", "==", me.uid)))).docs) await deleteDoc(d.ref);
    await deleteDoc(doc(db, "keys", me.uid)).catch(() => {}); await deleteDoc(doc(db, "presence", me.uid)).catch(() => {});
    const batch = writeBatch(db); batch.delete(doc(db, "users", me.uid)); batch.delete(doc(db, "usernames", profile.username)); await batch.commit();
    await idb("readwrite", s => s.delete(me.uid)).catch(() => {});
    await deleteUser(me).catch(() => signOut(auth));
    location.reload();
  } catch (err) { fail(err); }
};

// ---- Photos, videos and files ----
const urls = {};
const setStatus = t => $("status").textContent = t;
const clearUrls = () => { for (const k in urls) { urls[k].then(u => URL.revokeObjectURL(u)).catch(() => {}); delete urls[k]; } };
// Photos, videos and files are temporary: removed from the database when the chat is closed
// Files vanish 10 minutes after sending (and when the chat closes), so they never fill the free storage.
const FILE_TTL = 10 * 60 * 1000;
async function removeMessage(mr, m) {
  const batch = writeBatch(db);
  if (m.path && m.parts) for (let i = 0; i < m.parts; i++) batch.delete(doc(db, mr.path, "chunks", String(i).padStart(3, "0")));
  else if (m.path) (await getDocs(collection(db, mr.path, "chunks"))).forEach(c => batch.delete(c.ref));
  batch.delete(mr);
  await batch.commit();
}
// Auto logout after 10 min of no activity. Runs in the browser only, so it costs nothing.
const IDLE_MS = 10 * 60 * 1000;
let lastActive = Date.now(), idleOn = false;
function idleWatch() {
  if (idleOn) return; idleOn = true;
  const touch = () => { lastActive = Date.now(); };
  ["pointerdown", "keydown", "scroll", "touchstart"].forEach(e => addEventListener(e, touch, { passive: true }));
  const check = () => { if (!inCall && Date.now() - lastActive > IDLE_MS) $("logout").click(); };
  setInterval(check, 15000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
}
async function purgeMine(chat) {
  if (!chat) return;
  try {
    const s = await getDocs(query(collection(db, "friends", chat, "messages"), where("from", "==", me.uid)));
    for (const d of s.docs) if (d.data().path) await removeMessage(d.ref, d.data());
  } catch (e) { console.error(e); }
}
addEventListener("pagehide", () => purgeMine(current));
function media(m, mr) {
  const box = el("div", "Loading...", "media");
  (urls[m.path] ??= getDocs(collection(db, mr.path, "chunks")).then(async s => {
    const joined = new Uint8Array(await new Blob(s.docs.map(c => c.data().d.toUint8Array())).arrayBuffer());
    return URL.createObjectURL(new Blob([m.e ? await unseal(ckey, joined) : joined], { type: m.type || "" }));
  })).then(url => {
    let node;
    if (m.kind === "image") { node = Object.assign(el("img"), { src: url, alt: m.name || "Photo", loading: "lazy" }); node.onclick = () => window.open(url, "_blank", "noopener"); }
    else if (m.kind === "video") node = Object.assign(el("video"), { src: url, controls: true, preload: "metadata", playsInline: true });
    else node = Object.assign(el("a", m.name || "Download file"), { href: url, target: "_blank", rel: "noopener noreferrer" });
    box.replaceChildren(node);
  }).catch(() => { delete urls[m.path]; box.textContent = "File not available"; });
  return box;
}
async function shrinkImage(f) {
  const bmp = await createImageBitmap(f);
  const s = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * s), height: Math.round(bmp.height * s) });
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error("Could not read that photo.")), "image/jpeg", 0.8));
}
async function shrinkVideo(f) {
  if (typeof VideoEncoder === "undefined") throw new Error("This browser cannot shrink videos. Use an up-to-date Chrome, Edge or Safari.");
  setStatus("Loading video tools...");
  const { Input, Output, Conversion, BlobSource, BufferTarget, Mp4OutputFormat, ALL_FORMATS } = await import("https://cdn.jsdelivr.net/npm/mediabunny@1/+esm");
  const input = new Input({ source: new BlobSource(f), formats: ALL_FORMATS });
  if (await input.computeDuration() > 60) throw new Error("Videos can be 1 minute at most.");
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("No video found in that file.");
  const portrait = track.displayHeight > track.displayWidth, side = Math.min(track.displayWidth, track.displayHeight);
  const video = { bitrate: 700000, ...(side > 480 ? (portrait ? { width: 480 } : { height: 480 }) : {}) };
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const conversion = await Conversion.init({ input, output, video, audio: { bitrate: 64000 } });
  conversion.onProgress = p => setStatus("Shrinking video... " + Math.round(p * 100) + "%");
  await conversion.execute();
  return new Blob([output.target.buffer], { type: "video/mp4" });
}
async function sendFile(chat, f) {
  if (!ckey) throw new Error(`${chatUser.name} hasn't turned on encryption yet.`);
  let blob = f, kind = "file", type = f.type || "application/octet-stream", name = f.name;
  if (f.type.startsWith("image/")) { setStatus("Preparing photo..."); blob = await shrinkImage(f); kind = "image"; type = "image/jpeg"; name = name.replace(/\.[^.]+$/, "") + ".jpg"; }
  else if (f.type.startsWith("video/")) { blob = await shrinkVideo(f); kind = "video"; type = "video/mp4"; name = name.replace(/\.[^.]+$/, "") + ".mp4"; }
  else if (f.size > 5 * 1024 * 1024) throw new Error("Files must be under 5 MB.");
  if (blob.size > 25 * 1024 * 1024) throw new Error("That file is still too big after shrinking.");
  setStatus("Encrypting and uploading...");
  const path = `chats/${chat}/${me.uid}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const mref = doc(collection(db, "friends", chat, "messages")), bytes = await seal(ckey, new Uint8Array(await blob.arrayBuffer())), size = 800000, parts = Math.ceil(bytes.length / size);
  const meta = b64(await seal(ckey, enc.encode(JSON.stringify({ n: name.slice(0, 100), t: type }))));
  for (let i = 0; i < parts; i++) await setDoc(doc(db, mref.path, "chunks", String(i).padStart(3, "0")), { d: Bytes.fromUint8Array(bytes.subarray(i * size, (i + 1) * size)), by: me.uid });
  await setDoc(mref, { from: me.uid, text: meta, at: serverTimestamp(), e: 1, kind, path, name: "", type: "application/octet-stream", parts });
  setStatus("");
  setTimeout(() => removeMessage(mref, { path, parts }).catch(e => console.error(e)), FILE_TTL);
}
$("attach").onclick = () => $("file").click();
$("file").onchange = async () => {
  const f = $("file").files[0]; $("file").value = "";
  if (!f || !current) return;
  // check the size first, before any shrinking, so a big file never slows the app
  const MB = 1024 * 1024, limit = f.type.startsWith("image/") ? 15 : f.type.startsWith("video/") ? 30 : 5;
  if (f.size > limit * MB) {
    const what = limit === 15 ? "Photos" : limit === 30 ? "Videos" : "Files";
    return alert(`This file is too big (${(f.size / MB).toFixed(1)} MB). ${what} must be ${limit} MB or smaller. Please pick a smaller one.`);
  }
  try { await sendFile(current, f); }
  catch (e) { console.error(e); if (isQuota(e)) { setStatus(""); return banner(); } setStatus(e.code === "permission-denied" ? "Upload failed. Publish the latest firestore.rules." : e.message); }
};

// chat menu (clear, report, block)
$("more").onclick = e => { e.stopPropagation(); const open = $("chatMenu").hidden; $("chatMenu").hidden = !open; $("more").setAttribute("aria-expanded", open); };
$("chatMenu").onclick = () => { $("chatMenu").hidden = true; $("more").setAttribute("aria-expanded", false); };
document.addEventListener("click", () => { $("chatMenu").hidden = true; });

// text size: 90% to 150%, remembered on this phone
const SIZES = [0.9, 1, 1.15, 1.3, 1.5];
let sizeAt = 1;
try { const v = Number(localStorage.getItem("kushhook-text")); if (v >= 0 && v < SIZES.length && Number.isInteger(v)) sizeAt = v; } catch {}
function applySize() {
  document.documentElement.style.setProperty("--ts", SIZES[sizeAt]);
  $("sizeNow").textContent = Math.round(SIZES[sizeAt] * 100) + "%";
  $("smaller").disabled = sizeAt === 0; $("bigger").disabled = sizeAt === SIZES.length - 1;
  try { localStorage.setItem("kushhook-text", sizeAt); } catch {}
}
$("smaller").onclick = () => { if (sizeAt > 0) { sizeAt--; applySize(); } };
$("bigger").onclick = () => { if (sizeAt < SIZES.length - 1) { sizeAt++; applySize(); } };
applySize();

// ---------- voice calls (voice only) ----------
// The audio goes straight between the two phones, so it uses none of your free Firebase limits.
// Only a tiny "ringing" note is written to Firestore to set the call up. Both people need the app open.
const ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] };
let call = null, inCall = false;
const iceDone = pc => new Promise(ok => {
  if (pc.iceGatheringState === "complete") return ok();
  const t = setTimeout(ok, 4000);
  pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); ok(); } });
});
async function mic() {
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error("Calls are not supported in this browser.");
  try { return await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); }
  catch { throw new Error("Please allow the microphone to make calls."); }
}
function callUI(state, o = {}) {
  $("callBox").hidden = false; $("callState").textContent = state;
  $("callAnswer").hidden = !o.answer; $("callMute").hidden = !o.mute; $("callRetry").hidden = !o.retry;
  $("callEnd").textContent = o.end || "End call"; $("callTime").hidden = !o.time;
}
function showCall(user, state, o) {
  const a = avatar(user); a.classList.add("big");
  $("callAvatar").replaceChildren(a); $("callName").textContent = user.name; $("callMute").textContent = "Mute"; callUI(state, o);
}
function peer(stream) {
  const pc = new RTCPeerConnection(ICE);
  stream.getTracks().forEach(t => pc.addTrack(t, stream));
  pc.ontrack = e => { $("callAudio").srcObject = e.streams[0]; $("callAudio").play?.().catch(() => {}); };
  pc.onconnectionstatechange = () => {
    if (!call || call.pc !== pc) return;
    if (pc.connectionState === "connected") { clearTimeout(call.drop); connected(); }
    else if (pc.connectionState === "failed") failed();
    else if (pc.connectionState === "disconnected") call.drop = setTimeout(() => { if (call?.pc === pc && pc.connectionState !== "connected") failed(); }, 8000);
  };
  return pc;
}
function connected() {
  if (call.started) return;
  ringtone(false); clearTimeout(call.ring); call.started = Date.now();
  callUI("Connected", { mute: true, time: true });
  call.tick = setInterval(() => { const t = Math.floor((Date.now() - call.started) / 1000); $("callTime").textContent = String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"); }, 500);
}
function teardown() {
  ringtone(false);
  if (!call) return;
  clearTimeout(call.ring); clearTimeout(call.drop); clearInterval(call.tick);
  call.unsub?.(); call.pc?.close(); call.stream?.getTracks().forEach(t => t.stop());
  $("callAudio").srcObject = null; call.unsub = call.pc = call.stream = null;
}
const callDoc = () => doc(db, "calls", call.role === "caller" ? call.other : me.uid);
function finish(msg, retry = false) {
  if (!call || call.dead) return;
  teardown(); deleteDoc(callDoc()).catch(() => {});
  call.dead = true; inCall = false;
  callUI(msg, { retry: retry && call.role === "caller", end: "Close" });
}
function closeCall() { teardown(); call = null; inCall = false; $("callBox").hidden = true; }
function hangup() {
  if (!call) return;
  if (call.dead) return closeCall();
  if (call.role === "callee" && !call.accepted) updateDoc(callDoc(), { status: "declined" }).catch(() => {});
  else deleteDoc(callDoc()).catch(() => {});
  closeCall();
}
const failed = () => finish(call?.role === "caller" ? "Couldn't connect. Try again." : "Couldn't connect. Ask them to call again.", true);
function callError(e) {
  if (isQuota(e)) { closeCall(); return banner(); }
  const msg = e.message === "busy" ? "They are busy right now. Try again later." : /microphone|supported/.test(e.message) ? e.message : "Couldn't connect. Try again.";
  console.error(e); finish(msg, true);
}
async function startCall(chat, other, user) {
  if (call && !call.dead) return;
  if (call) closeCall();
  call = { role: "caller", chat, other, user }; inCall = true;
  showCall(user, "Starting voice call...", { end: "Cancel" });
  try {
    call.stream = await mic();
    const pc = call.pc = peer(call.stream);
    await pc.setLocalDescription(await pc.createOffer());
    await iceDone(pc);
    const ref = doc(db, "calls", other), data = { caller: me.uid, callee: other, status: "ringing", offer: { type: pc.localDescription.type, sdp: pc.localDescription.sdp }, at: serverTimestamp() };
    try { await setDoc(ref, data); }
    catch (e) {
      if (e.code !== "permission-denied") throw e;
      await deleteDoc(ref).catch(() => {});
      await setDoc(ref, data).catch(() => { throw new Error("busy"); });
    }
    if (!call || call.pc !== pc) return;
    call.unsub = onSnapshot(ref, async s => {
      if (!call || call.pc !== pc || call.dead) return;
      const d = s.data();
      if (!s.exists()) { if (call.answered) finish("Call ended."); return; }
      if (d.caller !== me.uid) return finish("They took another call.", true);
      if (d.status === "declined") return finish("Call declined.");
      if (d.status === "busy") return finish("They are on another call. Try again later.", true);
      if (d.status === "accepted" && d.answer && !call.answered) {
        call.answered = true; ringtone(false); clearTimeout(call.ring); callUI("Connecting...", { end: "Cancel" });
        call.ring = setTimeout(() => { if (call?.pc === pc && !call.started) failed(); }, 20000);
        try { await pc.setRemoteDescription(d.answer); } catch (e) { callError(e); }
      }
    }, callError);
    callUI("Calling... voice only", { end: "Cancel" }); ringtone(true, true);
    call.ring = setTimeout(() => { if (call?.pc === pc && !call.answered) finish("No answer. Try again.", true); }, 45000);
  } catch (e) { callError(e); }
}
function callWatch() {
  stops.push(onSnapshot(doc(db, "calls", me.uid), async s => {
    if (!s.exists()) {
      if (call?.role === "callee" && !call.dead) { if (call.accepted) finish("Call ended."); else { closeCall(); } }
      return;
    }
    const d = s.data();
    if (d.caller === me.uid || d.status !== "ringing") return;
    if (Date.now() - (d.at?.toMillis?.() ?? Date.now()) > 60000) return;
    if (!links.some(l => l.id === pair(d.caller) && l.status === "accepted")) return;
    if (call && !call.dead) { if (call.role === "callee" && call.other === d.caller && !call.accepted) call.offer = d.offer; else updateDoc(s.ref, { status: "busy" }).catch(() => {}); return; }
    const user = await getUser(d.caller);
    if (!user || user.suspended) return;
    if (call && !call.dead) return;
    if (call) closeCall();
    call = { role: "callee", other: d.caller, user, offer: d.offer, accepted: false }; inCall = true;
    showCall(user, "Incoming voice call", { answer: true, end: "Decline" });
    navigator.vibrate?.([300, 200, 300]); ringtone(true);
    call.ring = setTimeout(() => { if (call && !call.accepted && !call.dead) hangup(); }, 50000);
  }, () => {}));
}
$("call").onclick = () => { if (current && chatUser) startCall(current, current.split("_").find(x => x !== me.uid), chatUser); };
$("callEnd").onclick = hangup;
$("callRetry").onclick = () => { const { chat, other, user } = call; closeCall(); startCall(chat, other, user); };
$("callMute").onclick = () => {
  const t = call?.stream?.getAudioTracks()[0]; if (!t) return;
  t.enabled = !t.enabled; $("callMute").textContent = t.enabled ? "Mute" : "Unmute";
};
$("callAnswer").onclick = async () => {
  if (!call || call.role !== "callee" || call.accepted) return;
  ringtone(false); clearTimeout(call.ring); call.accepted = true; callUI("Connecting...", { end: "Cancel" });
  try {
    call.stream = await mic();
    const pc = call.pc = peer(call.stream);
    await pc.setRemoteDescription(call.offer);
    await pc.setLocalDescription(await pc.createAnswer());
    await iceDone(pc);
    await updateDoc(doc(db, "calls", me.uid), { status: "accepted", answer: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
    call.ring = setTimeout(() => { if (call?.pc === pc && !call.started) failed(); }, 20000);
  } catch (e) { callError(e); }
};
addEventListener("pagehide", () => { if (call && !call.dead) hangup(); });

// ---------- ringtone (made in the browser, no sound files) ----------
let actx, ringTimer;
const unlockAudio = () => { try { actx ??= new (window.AudioContext || window.webkitAudioContext)(); actx.resume?.(); } catch {} };
["pointerdown", "keydown", "touchstart"].forEach(e => addEventListener(e, unlockAudio, { passive: true }));
function beep(freq, ms) {
  if (!actx || actx.state !== "running") return;
  const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
  o.type = "sine"; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  o.connect(g).connect(actx.destination); o.start(t); o.stop(t + ms / 1000 + 0.05);
}
function ringtone(on, outgoing) {
  clearInterval(ringTimer); ringTimer = null;
  if (!on) return;
  const play = () => outgoing ? beep(425, 450) : [[880, 0], [660, 220], [880, 600], [660, 820]].forEach(([f, d]) => setTimeout(() => beep(f, 180), d));
  play(); ringTimer = setInterval(play, outgoing ? 3000 : 2200);
}

// ---------- theme: auto, light or dark ----------
let themePick = "auto";
try { const v = localStorage.getItem("kushhook-theme"); if (["light", "dark"].includes(v)) themePick = v; } catch {}
function applyTheme() {
  if (themePick === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.dataset.theme = themePick;
  document.querySelectorAll("[data-theme-pick]").forEach(b => b.classList.toggle("on", b.dataset.themePick === themePick));
  try { localStorage.setItem("kushhook-theme", themePick); } catch {}
}
document.querySelectorAll("[data-theme-pick]").forEach(b => b.onclick = () => { themePick = b.dataset.themePick; applyTheme(); });
applyTheme();
