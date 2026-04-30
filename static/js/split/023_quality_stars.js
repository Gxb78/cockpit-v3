// ---------- Quality stars ----------

function bindQuality() {
  const c = $("#qualityRating");
  if (!c) return;
  c.addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const q   = Number(btn.dataset.q);
    const cur = Number($("#executionQuality").value || 0);
    setQuality(cur === q ? 0 : q);
  });
  c.addEventListener("mouseover", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const q = Number(btn.dataset.q);
    c.querySelectorAll("button").forEach(b => b.classList.toggle("on", Number(b.dataset.q) <= q));
  });
  c.addEventListener("mouseleave", () => setQuality(Number($("#executionQuality").value || 0)));
}

function setQuality(q) {
  $("#executionQuality").value = q || "";
  $$("#qualityRating button").forEach(b =>
    b.classList.toggle("on", Number(b.dataset.q) <= (q || 0))
  );
}

