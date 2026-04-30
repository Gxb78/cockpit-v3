// ---------- Pills ----------

function bindPills() {
  $$(".pills").forEach(group => {
    group.addEventListener("click", (e) => {
      const btn = e.target.closest(".pill-choice");
      if (!btn) return;
      const wasActive = btn.classList.contains("active");
      group.querySelectorAll(".pill-choice").forEach(p => p.classList.remove("active"));
      if (!wasActive) btn.classList.add("active");
      if (group.dataset.pills === "direction") setTimeout(updateRRPreview, 0);
    });
  });
}

function setPill(group, value) {
  const c = document.querySelector(`.pills[data-pills="${group}"]`);
  if (!c) return;
  if (group === "strategy" && value && !findPillByValue(c, value)) {
    appendStrategyPill(c, {
      value,
      label: STRATEGY_LABELS[value] || prettify(value),
    }, { dynamic: true });
  }
  c.querySelectorAll(".pill-choice").forEach(p =>
    p.classList.toggle("active", p.dataset.value === value)
  );
}

function getPill(group) {
  const a = document.querySelector(`.pills[data-pills="${group}"] .pill-choice.active`);
  return a ? a.dataset.value : null;
}

