import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where, orderBy, limit, limitToLast, startAt, endAt, onSnapshot, getDocs, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

const fb = initializeApp(firebaseConfig), auth = getAuth(fb), db = getFirestore(fb);
const $ = id => document.getElementById(id);
let me, profile, admin = false, current, links = [], stops = [], stopChat;
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
  if (admin) $("type").add(new Option("Bet odds (18+)", "odds"));
  stops.push(onSnapshot(query(collection(db, "friends"), where("users", "array-contains", me.uid)), async s => {
    links = s.docs.map(d => ({ id: d.id, ...d.data() }));
    await drawChats(); search();
    if (current && !links.some(l => l.id === current && l.status === "accepted")) closeChat();
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
  stopChat?.(); current = id;
  $("who").textContent = u.name; $("send").hidden = $("block").hidden = false; $("app").classList.add("open");
  stopChat = onSnapshot(query(collection(db, "friends", id, "messages"), orderBy("at"), limitToLast(100)), s => {
    $("messages").replaceChildren(...s.docs.map(d => rich(el("div", "", "bubble" + (d.data().from === me.uid ? " me" : "")), d.data().text)));
    $("messages").scrollTop = $("messages").scrollHeight;
  }, fail);
}
function closeChat() {
  stopChat?.(); current = null; $("messages").replaceChildren(); $("who").textContent = "Choose a chat";
  $("send").hidden = $("block").hidden = true; $("app").classList.remove("open");
}
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
}
document.querySelectorAll("nav button").forEach(b => b.onclick = () => tab(b.dataset.tab));
