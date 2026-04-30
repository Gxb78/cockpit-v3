// ---- 057_debug_labels.js ----
// Affiche des labels sur chaque composant avec data-name.
// Activer: localStorage.DEBUG_LABELS = "1" puis reload.
// Desactiver: localStorage.removeItem("DEBUG_LABELS") puis reload.

if (localStorage.DEBUG_LABELS === "1") {
document.addEventListener("DOMContentLoaded", function () {
  var labels = document.querySelectorAll("[data-name]");
  labels.forEach(function (el) {
    var name = el.getAttribute("data-name");
    if (!name) return;
    var badge = document.createElement("span");
    badge.textContent = name;
    badge.style.cssText =
      "position:fixed;bottom:10px;right:10px;z-index:999999;" +
      "padding:3px 9px;border-radius:6px;" +
      "background:rgba(0,0,0,0.50);color:rgba(255,255,255,0.55);" +
      "font-family:'JetBrains Mono',monospace;font-size:9px;" +
      "letter-spacing:0.04em;pointer-events:none;" +
      "opacity:0;transition:opacity 0.2s ease;";
    badge.className = "hermes-debug-label";
    el.appendChild(badge);
    el.addEventListener("mouseenter", function () { badge.style.opacity = "1"; });
    el.addEventListener("mouseleave", function () { badge.style.opacity = "0"; });
  });
});
}
