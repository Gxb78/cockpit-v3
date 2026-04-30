// ---------- Tags input ----------

function bindTagsInput() {
  const wrap  = $("#tagsInput");
  const input = $("#tagsInputField");
  if (!wrap || !input) return;
  wrap.addEventListener("click", () => input.focus());
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const v = input.value.trim().replace(/^#/, "");
      if (v) addTag(v);
      input.value = "";
    } else if (e.key === "Backspace" && input.value === "") {
      const pills = wrap.querySelectorAll(".tag-pill");
      if (pills.length) pills[pills.length - 1].remove();
    }
  });
}

function addTag(value) {
  const wrap = $("#tagsInput");
  if (!wrap) return;
  const existing = [...wrap.querySelectorAll(".tag-pill")].map(p => p.dataset.value);
  if (existing.includes(value)) return;
  const pill     = document.createElement("span");
  pill.className = "tag-pill";
  pill.dataset.value = value;
  pill.innerHTML = `#${escapeHtml(value)} <span class="x">✕</span>`;
  pill.querySelector(".x").addEventListener("click", () => pill.remove());
  wrap.insertBefore(pill, $("#tagsInputField"));
}

function getTags() {
  return [...($("#tagsInput")?.querySelectorAll(".tag-pill") || [])].map(p => p.dataset.value);
}

