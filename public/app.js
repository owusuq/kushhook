import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where, orderBy, limit, limitToLast, startAt, endAt, startAfter, onSnapshot, getDocs, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";
import { firebaseConfig } from "./config.js";

const fb = initializeApp(firebaseConfig), auth = getAuth(fb), db = getFirestore(fb), storage = getStorage(fb);
const $ = id => document.getElementById(id);
let me, profile, admin = false, current, chatUser, openClear, links = [], stops = [], stopChat;
const users = {};
const fail = e => { console.error(e); alert("That didn't work. " + e.message); };
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
const getUser = async id => users[id] ??= (await getDoc(doc(db, "users", id))).data();
const pair = id => [me.uid, id].sort().join("_");

$("login").onclick = () => signInWithPopup(auth, new GoogleAuthProvider()).catch(e => $("error").textContent = e.message);
$("logout").onclick = () => signOut(auth).then(() => location.reload());
onAuthStateChanged(auth, async user => {
  if (!user) return;
  me = user;
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
  if (admin) { $("type").add(new Option("Bet odds (18+)", "odds")); $("adminTab").hidden = false; }
  stops.push(onSnapshot(query(collection(db, "friends"), where("users", "array-contains", me.uid)), async s => {
    links = s.docs.map(d => ({ id: d.id, ...d.data() }));
    await drawChats(); search(); if (admin) drawMembers();
    if (current && !links.some(l => l.id === current && l.status === "accepted")) closeChat();
    else if (current && links.find(l => l.id === current)?.clear?.[me.uid]?.toMillis?.() !== openClear) openChat(current, chatUser);
  }, fail));
  stops.push(onSnapshot(query(collection(db, "posts"), orderBy("at", "desc"), limit(50)), s => {
    $("posts").replaceChildren(...s.docs.map(d => {
      const p = d.data(), box = el("div", "", "post");
      box.append(el("b", "@" + p.username + "  "));
      if (p.type === "odds") box.append(el("span", "Bet odds, 18+ only\n", "odds")); else box.append("\n");
      rich(box, p.text);
      if (admin || p.uid === me.uid) box.append("\n", button("Delete", () => deleteDoc(d.ref)));
      return box;
    }));
  }, fail));
  tab("chats");
}

async function drawChats() {
  const rows = await Promise.all(links.filter(l => l.status !== "blocked").map(async l => {
    const u = await getUser(l.users.find(x => x !== me.uid)), row = el("div", "", "row");
    row.append(el("span", `${u.name} (@${u.username})`));
    if (l.status === "accepted") row.append(button("Open", () => openChat(l.id, u)));
    else if (l.from !== me.uid) row.append(button("Accept", () => updateDoc(doc(db, "friends", l.id), { status: "accepted" })));
    else row.append(el("small", "Requested"));
    return row;
  }));
  $("chats").replaceChildren(...(rows.length ? rows : [el("p", "No chats yet. Open People to add someone.")]));
}

let searchRun = 0;
async function search() {
  const run = ++searchRun, term = $("search").value.trim().toLowerCase().replace(/^@/, ""), found = new Map();
  for (const field of ["username", "nameLower"]) {
    const s = await getDocs(query(collection(db, "users"), orderBy(field), startAt(term), endAt(term + "\uf8ff"), limit(20)));
    s.forEach(d => found.set(d.id, d.data()));
  }
  if (run !== searchRun) return;
  $("results").replaceChildren(...[...found].filter(([id]) => id !== me.uid && !links.some(l => l.id === pair(id))).map(([id, u]) => {
    const row = el("div", "", "row");
    row.append(el("span", `${u.name} (@${u.username})`), button(admin ? "Connect" : "Add", () => setDoc(doc(db, "friends", pair(id)), { users: [me.uid, id].sort(), from: me.uid, status: admin ? "accepted" : "pending" })));
    return row;
  }));
}
let timer;
$("search").oninput = () => { clearTimeout(timer); timer = setTimeout(() => search().catch(fail), 300); };

function openChat(id, u) {
  stopChat?.(); current = id; chatUser = u;
  const cleared = links.find(l => l.id === id)?.clear?.[me.uid];
  openClear = cleared?.toMillis?.();
  $("who").textContent = u.name; $("send").hidden = $("block").hidden = $("clear").hidden = false; $("app").classList.add("open");
  const msgs = collection(db, "friends", id, "messages");
  const q = cleared ? query(msgs, orderBy("at"), startAfter(cleared), limitToLast(100)) : query(msgs, orderBy("at"), limitToLast(100));
  stopChat = onSnapshot(q, s => {
    $("messages").replaceChildren(...s.docs.map(d => {
      const m = d.data(), mine = m.from === me.uid, bubble = el("div", "", "bubble" + (mine ? " me" : ""));
      if (m.path) bubble.append(media(m));
      rich(bubble, m.text);
      if (mine || admin) {
        bubble.append("\n", button("Delete", async () => {
          if (!confirm("Delete this message for everyone?")) return;
          await deleteDoc(d.ref);
          if (m.path) deleteObject(ref(storage, m.path)).catch(() => {});
        }));
        bubble.lastChild.className = "del";
      }
      return bubble;
    }));
    $("messages").scrollTop = $("messages").scrollHeight;
  }, fail);
}
function closeChat() {
  stopChat?.(); current = null; $("messages").replaceChildren(); $("who").textContent = "Choose a chat";
  $("send").hidden = $("block").hidden = $("clear").hidden = true; $("app").classList.remove("open");
}
$("clear").onclick = () => confirm("Clear this chat for you? The other person keeps their copy.") && updateDoc(doc(db, "friends", current), { ["clear." + me.uid]: serverTimestamp() }).catch(fail);
$("back").onclick = () => $("app").classList.remove("open");
$("block").onclick = () => confirm("Block this person?") && updateDoc(doc(db, "friends", current), { status: "blocked", blockedBy: me.uid }).catch(fail);
$("send").onsubmit = e => {
  e.preventDefault();
  const text = $("msg").value.trim();
  if (!text || !current) return;
  $("msg").value = "";
  addDoc(collection(db, "friends", current, "messages"), { from: me.uid, text, at: serverTimestamp() }).catch(fail);
};
$("emojis").hidden = true;
$("smile").onclick = () => $("emojis").hidden = !$("emojis").hidden;
for (const x of ["😀","😂","😍","😎","😢","🙏","👍","🔥","❤️","🎉"]) {
  const b = button(x, () => $("msg").value += x); b.type = "button"; $("emojis").append(b);
}
$("postForm").onsubmit = e => {
  e.preventDefault();
  const text = $("postText").value.trim();
  if (text) addDoc(collection(db, "posts"), { uid: me.uid, username: profile.username, type: $("type").value, text, at: serverTimestamp() })
    .then(() => $("postText").value = "").catch(fail);
};
function tab(name) {
  for (const b of document.querySelectorAll("nav button")) { b.classList.toggle("on", b.dataset.tab === name); $(b.dataset.tab).hidden = b.dataset.tab !== name; }
  if (name === "people") search().catch(fail);
  if (name === "admin") loadMembers().catch(fail);
}
document.querySelectorAll("nav button").forEach(b => b.onclick = () => tab(b.dataset.tab));

let allUsers = [];
async function loadMembers() {
  const s = await getDocs(query(collection(db, "users"), orderBy("username"), limit(300)));
  allUsers = s.docs.map(d => ({ id: d.id, ...d.data() }));
  drawMembers();
}
function drawMembers() {
  const term = $("adminSearch").value.trim().toLowerCase().replace(/^@/, "");
  const list = allUsers.filter(u => u.id !== me.uid && (u.username.includes(term) || u.nameLower.includes(term)));
  $("members").replaceChildren(el("p", `${allUsers.length} members`), ...list.map(u => {
    const row = el("div", "", "row"), link = links.find(l => l.id === pair(u.id));
    row.append(el("span", `${u.name} (@${u.username})`));
    if (link) row.append(el("small", link.status === "accepted" ? "Connected" : link.status === "pending" ? "Pending" : "Blocked"));
    else row.append(button("Connect", () => setDoc(doc(db, "friends", pair(u.id)), { users: [me.uid, u.id].sort(), from: me.uid, status: "accepted" })));
    return row;
  }));
}
$("adminSearch").oninput = drawMembers;

// ---- Photos, videos and files ----
const urls = {};
const setStatus = t => $("status").textContent = t;
function media(m) {
  const box = el("div", "Loading...", "media");
  (urls[m.path] ??= getDownloadURL(ref(storage, m.path))).then(url => {
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
const allowed = ["application/pdf", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
async function sendFile(chat, f) {
  let blob = f, kind = "file", type = f.type, name = f.name;
  if (f.type.startsWith("image/")) { setStatus("Preparing photo..."); blob = await shrinkImage(f); kind = "image"; type = "image/jpeg"; name = name.replace(/\.[^.]+$/, "") + ".jpg"; }
  else if (f.type.startsWith("video/")) { blob = await shrinkVideo(f); kind = "video"; type = "video/mp4"; name = name.replace(/\.[^.]+$/, "") + ".mp4"; }
  else if (!allowed.includes(f.type)) throw new Error("You can send photos, videos, PDF, Word and text files.");
  else if (f.size > 5 * 1024 * 1024) throw new Error("Files must be under 5 MB.");
  if (blob.size > 25 * 1024 * 1024) throw new Error("That file is still too big after shrinking.");
  setStatus("Uploading...");
  const path = `chats/${chat}/${me.uid}/${Date.now()}_${name.replace(/[^\w.-]/g, "_")}`;
  await uploadBytes(ref(storage, path), blob, { contentType: type });
  await addDoc(collection(db, "friends", chat, "messages"), { from: me.uid, text: "", at: serverTimestamp(), kind, path, name: name.slice(0, 100) });
  setStatus("");
}
$("attach").onclick = () => $("file").click();
$("file").onchange = async () => {
  const f = $("file").files[0]; $("file").value = "";
  if (!f || !current) return;
  try { await sendFile(current, f); }
  catch (e) { console.error(e); setStatus(e.code === "storage/unauthorized" || e.code === "storage/unknown" ? "Upload failed. Storage may not be set up yet." : e.message); }
};
