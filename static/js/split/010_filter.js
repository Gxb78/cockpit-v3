// ---------- Filter ----------

function bindFilter() {
  $("#instrList").addEventListener("click", (e) => {
    const btn = e.target.closest(".instr-chip");
    if (!btn) return;
    $$(".instr-chip").forEach(c => {
      c.classList.remove("active");
      c.setAttribute("aria-selected", "false");
    });
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    state.statsInstrument = btn.dataset.instr;
    loadAll();
  });
}

