// Run from your kushhook project folder:  node fix.js
const fs = require("fs");
const { spawnSync } = require("child_process");

const read = f => fs.readFileSync(f, "utf8");
const stop = msg => { console.error("\nSTOP: " + msg); process.exit(1); };

for (const f of ["public/styles.css", "public/index.html", "public/app.js", "firebase.json"])
  if (!fs.existsSync(f)) stop(f + " not found. Run this from inside the kushhook project folder.");

// 1. app.js must be the new version (temporary files stored in Firestore)
if (!read("public/app.js").includes("purgeMine"))
  stop("public/app.js is still the old version. Unzip the new kushhook.zip over this folder first.");

// 2. phone fix: photos and videos get a fixed width
let css = read("public/styles.css");
if (!css.includes("width:240px")) {
  const old = "display:block;max-width:100%;max-height:320px";
  if (!css.includes(old)) stop("Could not find the media style line in styles.css.");
  css = css.replace(old, "display:block;width:240px;max-width:100%;max-height:320px");
  fs.writeFileSync("public/styles.css", css);
  console.log("Patched styles.css");
} else console.log("styles.css already patched");

// 3. make phones load the new files after every deploy (no stale cache)
const v = Date.now();
let html = read("public/index.html");
html = html.replace(/href="styles\.css(\?v=\d+)?"/, `href="styles.css?v=${v}"`)
           .replace(/src="app\.js(\?v=\d+)?"/, `src="app.js?v=${v}"`);
fs.writeFileSync("public/index.html", html);
console.log("Cache version set: " + v);

// 4. make sure the deploy no longer touches Firebase Storage
const cfg = JSON.parse(read("firebase.json"));
if (cfg.storage) { delete cfg.storage; fs.writeFileSync("firebase.json", JSON.stringify(cfg, null, 2) + "\n"); console.log("Removed storage from firebase.json"); }
if (fs.existsSync("storage.rules")) { fs.unlinkSync("storage.rules"); console.log("Deleted storage.rules"); }

// 5. deploy
if (process.argv.includes("--no-deploy")) { console.log("Skipping deploy."); process.exit(0); }
console.log("\nDeploying...\n");
const r = spawnSync("npx", ["firebase-tools", "deploy", "--project", "kushhook"], { stdio: "inherit", shell: true });
if (r.status !== 0) stop("Deploy failed. Copy the error above and send it to me.");
console.log("\nDone. On your phone, open https://kushhook.web.app and refresh.");
