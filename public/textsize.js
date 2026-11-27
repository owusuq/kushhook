// Text size: the Aa button opens a slider. The choice is remembered on this device.
(function () {
  var KEY = "kh_textsize", root = document.documentElement;
  function load() { try { var v = parseInt(localStorage.getItem(KEY), 10); return v >= 85 && v <= 150 ? v : 100; } catch (e) { return 100; } }
  var size = load();
  root.style.setProperty("--ts", size / 100);
  function init() {
    var box = document.getElementById("textbox"), range = document.getElementById("tsrange"),
        reset = document.getElementById("tsreset"), label = document.getElementById("tsvalue"),
        buttons = document.querySelectorAll(".aa");
    if (!box || !range) return;
    function set(v) {
      size = v; root.style.setProperty("--ts", v / 100); range.value = v; label.textContent = v + "%";
      try { localStorage.setItem(KEY, String(v)); } catch (e) {}
    }
    function close() { box.hidden = true; buttons.forEach(function (b) { b.setAttribute("aria-expanded", "false"); }); }
    range.value = size; label.textContent = size + "%";
    range.addEventListener("input", function () { set(parseInt(range.value, 10)); });
    reset.addEventListener("click", function () { set(100); });
    buttons.forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        var open = box.hidden; close();
        if (open) { box.hidden = false; b.setAttribute("aria-expanded", "true"); }
      });
    });
    box.addEventListener("click", function (e) { e.stopPropagation(); });
    document.addEventListener("click", close);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
