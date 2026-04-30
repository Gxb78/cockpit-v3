// ---------- AI panel ----------

const AI_PANEL_OPEN_KEY = "cockpit:aiPanelOpen:v1";

function setAiPanelOpen(open, persist = true) {
  document.body.classList.toggle("ai-panel-open", !!open);
  const btn = $("#aiPanelToggle");
  if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
  if (persist) {
    try { localStorage.setItem(AI_PANEL_OPEN_KEY, open ? "1" : "0"); } catch (_) {}
  }
}

function bindAiPanelToggle() {
  const btn = $("#aiPanelToggle");
  if (!btn) return;
  let saved = null;
  try { saved = localStorage.getItem(AI_PANEL_OPEN_KEY); } catch (_) {}
  setAiPanelOpen(saved === "1", false);
  btn.addEventListener("click", () => {
    const next = !document.body.classList.contains("ai-panel-open");
    setAiPanelOpen(next, true);
  });
}
