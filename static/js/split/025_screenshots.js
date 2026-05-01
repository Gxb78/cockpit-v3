// ---------- Screenshots ----------

function getClipboardImageFiles(e) {
  const clipboard = e.clipboardData;
  if (!clipboard) return [];
  const directFiles = [...(clipboard.files || [])].filter(f => f?.type?.startsWith("image/"));
  if (directFiles.length) return directFiles;
  const items = [...(clipboard.items || [])];
  return items
    .filter(it => it?.kind === "file" && it?.type?.startsWith("image/"))
    .map(it => it.getAsFile())
    .filter(Boolean);
}

function getPasteMarkdownTarget(target) {
  if (!(target instanceof Element)) return null;
  const field = target.closest("textarea, input[type='text']");
  if (!field) return null;
  if (field.id === "tagsInputField") return null;
  return field;
}

function insertTextAtCursor(field, text) {
  if (!field) return;
  const start = field.selectionStart ?? field.value.length;
  const end   = field.selectionEnd ?? start;
  const before = field.value.slice(0, start);
  const after  = field.value.slice(end);
  const isSingleLine = field.tagName === "INPUT";
  const addLeadingNL  = !isSingleLine && before.length > 0 && !before.endsWith("\n");
  const addTrailingNL = !isSingleLine && after.length > 0 && !after.startsWith("\n");
  const payload = `${addLeadingNL ? "\n" : ""}${text}${addTrailingNL ? "\n" : ""}`;
  field.value = before + payload + after;
  const caret = before.length + payload.length;
  field.focus();
  field.setSelectionRange(caret, caret);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function buildMarkdownImageSnippet(shots, singleLine = false) {
  return (shots || [])
    .map((s, i) => `![Screenshot ${i + 1}](/screenshots/${s.filename})`)
    .join(singleLine ? " " : "\n");
}

function isWizardVisible() {
  const wiz = $("#wiz");
  return !!wiz && !wiz.classList.contains("hidden");
}

async function onClipboardImagePaste(e) {
  const files = getClipboardImageFiles(e);
  if (!files.length) return;

  if (isWizardVisible()) {
    e.preventDefault();
    await _wizHandleFiles(files);
    if (wizState) toast(`${files.length} image${files.length > 1 ? "s" : ""} ajoutee${files.length > 1 ? "s" : ""} au wizard`, "success");
    return;
  }

  e.preventDefault();
  const targetField = getPasteMarkdownTarget(e.target);
  const shots = await handleFiles(files);
  if (!targetField || !shots.length) return;
  const isSingleLine = targetField.tagName === "INPUT";
  insertTextAtCursor(targetField, buildMarkdownImageSnippet(shots, isSingleLine));
}

function renderShots(shots) {
  const list = $("#shotsList");
  if (!list) return;
  list.innerHTML = "";
  (shots || []).forEach(s => appendShot(s));
  if (typeof refreshTradeFlowNavState === "function") refreshTradeFlowNavState();
}

async function handleFiles(fileList) {
  if (!fileList || fileList.length === 0) return [];
  const files = [...fileList];
  const uploaded = [];

  // S'assurer que le jour existe
  if (!state.currentDayId) {
    const saved = await saveDayContext(true);
    if (!saved) return uploaded;
  }

  const tradeReady = await ensureTradeContextForUpload();
  if (!tradeReady) {
    return uploaded;
  }

  let ok = 0;
  for (const file of files) {
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`/api/trades/${state.currentTradeId}/screenshots`,
        { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast(err.error || `Upload échoué : ${file.name}`, "error");
        continue;
      }
      const s = await res.json();
      appendShot(s);
      uploaded.push(s);
      ok++;
    } catch (err) { toast("Erreur réseau : " + err.message, "error"); }
  }
  const input = $("#fileInput");
  if (input) input.value = "";
  if (ok > 0) toast(`${ok} screenshot${ok > 1 ? "s" : ""} ajouté${ok > 1 ? "s" : ""} ✓`, "success");
  if (ok > 0) {
    // Rafraîchir les cartes trades dans la modale pour que le hero media s'affiche
    if (state.currentDayId) {
      const day = await api(`/api/days/${state.currentDayId}`);
      if (typeof renderTradesList === "function") renderTradesList(day.trades || []);
    }
    state.modalDataDirty = true;
    if (typeof loadAll === "function") setTimeout(loadAll, 100);
  }
  return uploaded;
}

async function ensureTradeContextForUpload() {
  if (state.currentTradeId) return true;

  const tradeFormSection = $("#tradeFormSection");
  const tradeFormOpen = tradeFormSection && !tradeFormSection.classList.contains("hidden");
  if (!tradeFormOpen) {
    toast("Ouvre ou crée un trade pour lui attacher des screenshots", "error");
    return false;
  }

  try {
    const payload = buildTradePayload();
    const saved = await api(`/api/days/${state.currentDayId}/trades`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.currentTradeId = saved.id;
    if ($("#tradeId")) $("#tradeId").value = saved.id || "";
    state.modalDataDirty = true;
    if (typeof loadAll === "function") setTimeout(loadAll, 100);
    const day = await api(`/api/days/${state.currentDayId}`);
    if (typeof renderTradesList === "function") renderTradesList(day.trades || []);
    toast("Trade créé automatiquement pour ajouter le screenshot", "success");
    return true;
  } catch (err) {
    toast(err.message || "Impossible de préparer le trade pour l'upload", "error");
    return false;
  }
}

var _shotsDelegationBound = false;

function _bindShotsDelegation() {
  if (_shotsDelegationBound) return;
  var list = $("#shotsList");
  if (!list) return;
  _shotsDelegationBound = true;
  list.addEventListener("click", function (e) {
    var img = e.target.closest(".shot img");
    if (img) { openLightbox(img.src); return; }
    var del = e.target.closest(".shot-x");
    if (!del) return;
    var wrap = del.closest(".shot");
    if (!wrap) return;
    (async function () {
      if (!confirm("Supprimer ce screenshot ?")) return;
      try {
        await api("/api/screenshots/" + wrap.dataset.sid, { method: "DELETE" });
        wrap.remove();
        state.modalDataDirty = true;
        if (typeof loadAll === "function") setTimeout(loadAll, 100);
        // Rafraîchir les cartes trades dans la modale pour que le hero media soit mis à jour
        if (state.currentDayId) {
          const day = await api(`/api/days/${state.currentDayId}`);
          if (typeof renderTradesList === "function") renderTradesList(day.trades || []);
        }
        if (typeof refreshTradeFlowNavState === "function") refreshTradeFlowNavState();
      } catch (err) { toast(err.message, "error"); }
    })();
  });
}

function appendShot(s) {
  _bindShotsDelegation();
  var list = $("#shotsList");
  if (!list) return;
  var wrap = document.createElement("div");
  wrap.className = "shot";
  wrap.dataset.sid = s.id;
  wrap.innerHTML = `
    <img src="/screenshots/${s.filename}" alt="" />
    <button class="shot-x" type="button" title="Supprimer">✕</button>
  `;
  list.appendChild(wrap);
  if (typeof refreshTradeFlowNavState === "function") refreshTradeFlowNavState();
}

function openLightbox(src) {
  $("#lightboxImg").src = src;
  $("#lightbox").classList.remove("hidden");
}

