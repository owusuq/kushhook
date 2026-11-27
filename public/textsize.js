// Text size: the Aa button opens a slider and your choice is remembered on this device.
// It reads the app's own stylesheet and scales every text size in it, so no other file needs editing.
(function () {
  var KEY = "kh_textsize", MIN = 85, MAX = 150, root = document.documentElement, size = 100, styleEl;
  try { var saved = parseInt(localStorage.getItem(KEY), 10); if (saved >= MIN && saved <= MAX) size = saved; } catch (e) {}
  root.style.setProperty("--ts", String(size / 100));

  var SKIP = /\.logo|\.small\b|\.avatar|\.sym\b|\.badge|nav button|\.aa\b|#textbox|\.tsa|#ts/;

  var UI_CSS = [
    "#textbox{position:fixed;z-index:80;top:calc(var(--hh,64px) + 6px);right:12px;display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:22px;background:var(--glass2,var(--card));color:var(--ink);border:1px solid var(--rim,var(--line));-webkit-backdrop-filter:blur(22px) saturate(1.8);backdrop-filter:blur(22px) saturate(1.8);box-shadow:0 12px 34px var(--shade,rgba(0,0,0,.2))}",
    "#textbox[hidden]{display:none}",
    ".tsa{font-weight:800;line-height:1}.tsa.s{font-size:13px}.tsa.l{font-size:22px}",
    "#tsrange{width:min(46vw,190px);min-height:32px;padding:0;margin:0;border:0;background:none;box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none;accent-color:var(--btn)}",
    "#tsvalue{min-width:3.2em;text-align:right;font-weight:700;font-size:13px;color:var(--muted)}",
    "#tsreset{min-height:34px;padding:4px 12px;font-size:13px;border:1px solid var(--rim,var(--line))}",
    ".aa b{font-size:15px;font-weight:800;letter-spacing:-.02em}",
    "@media(max-width:420px){#chat>header{gap:2px;padding-left:8px;padding-right:8px}#chat>header .icon{width:36px;height:36px}}"
  ].join("\n");

  function walk(rules, out) {
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      try {
        if (r.type === 1) {
          var px = /^(\d*\.?\d+)px$/.exec(r.style.fontSize || "");
          if (!px || SKIP.test(r.selectorText)) continue;
          var v = "calc(" + px[1] + "px*var(--ts,1))";
          if (+px[1] >= 16 && /input|textarea|select/.test(r.selectorText)) v = "max(16px," + v + ")";
          out.push(r.selectorText + "{font-size:" + v + "!important}");
        } else if (r.cssRules && (r.type === 4 || r.type === 12)) {
          var inner = [];
          walk(r.cssRules, inner);
          if (inner.length) out.push("@" + (r.type === 4 ? "media " + r.media.mediaText : "supports " + r.conditionText) + "{" + inner.join("") + "}");
        }
      } catch (e) {}
    }
  }

  function build() {
    var out = [];
    for (var i = 0; i < document.styleSheets.length; i++) {
      var sh = document.styleSheets[i], rules;
      if (styleEl && sh.ownerNode === styleEl) continue;
      try { rules = sh.cssRules; } catch (e) { continue; }
      if (rules) walk(rules, out);
    }
    if (!styleEl) { styleEl = document.createElement("style"); document.head.appendChild(styleEl); }
    styleEl.textContent = out.join("\n") + "\n" + UI_CSS;
  }

  function init() {
    build();
    var box = document.createElement("div");
    box.id = "textbox"; box.hidden = true; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Text size");
    box.innerHTML = '<span class="tsa s">A</span><input id="tsrange" type="range" min="' + MIN + '" max="' + MAX + '" step="5" aria-label="Text size"><span class="tsa l">A</span><span id="tsvalue" aria-live="polite"></span><button type="button" id="tsreset" class="ghost">Reset</button>';
    document.body.appendChild(box);
    var range = document.getElementById("tsrange"), label = document.getElementById("tsvalue"), reset = document.getElementById("tsreset"), buttons = [];

    function makeButton() {
      var b = document.createElement("button");
      b.type = "button"; b.className = "icon aa"; b.title = "Text size";
      b.setAttribute("aria-label", "Text size"); b.setAttribute("aria-expanded", "false");
      b.innerHTML = "<b>Aa</b>"; buttons.push(b); return b;
    }
    var side = document.querySelector("aside > header"), out = document.getElementById("logout");
    if (side && out) side.insertBefore(makeButton(), out);
    var top = document.querySelector("#chat > header"), more = document.getElementById("more");
    if (top && more) top.insertBefore(makeButton(), more);

    function set(v) {
      size = v; root.style.setProperty("--ts", String(v / 100)); range.value = v; label.textContent = v + "%";
      try { localStorage.setItem(KEY, String(v)); } catch (e) {}
    }
    function close() { box.hidden = true; buttons.forEach(function (b) { b.setAttribute("aria-expanded", "false"); }); }
    range.value = size; label.textContent = size + "%";
    range.addEventListener("input", function () { set(parseInt(range.value, 10)); });
    reset.addEventListener("click", function () { set(100); });
    buttons.forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        var wasClosed = box.hidden; close();
        if (wasClosed) { box.hidden = false; b.setAttribute("aria-expanded", "true"); }
      });
    });
    box.addEventListener("click", function (e) { e.stopPropagation(); });
    document.addEventListener("click", close);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    window.addEventListener("load", build);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();