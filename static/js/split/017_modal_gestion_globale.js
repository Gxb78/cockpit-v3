// ---------- Modal : gestion globale ----------

var _lastFocused = null; // element qui a ouvert la modale (pour restauration)
var _modalScrollPerfTimer = null;

function bindModalScrollPerf() {
  const modal = $("#entryModal");
  const scroller = modal?.querySelector(".modal-scroll");
  if (!modal || !scroller || scroller.dataset.perfBound === "1") return;

  const markScrolling = () => {
    modal.classList.add("is-scrolling");
    if (_modalScrollPerfTimer) clearTimeout(_modalScrollPerfTimer);
    _modalScrollPerfTimer = setTimeout(() => {
      modal.classList.remove("is-scrolling");
      _modalScrollPerfTimer = null;
    }, 120);
  };

  scroller.addEventListener("scroll", markScrolling, { passive: true });
  scroller.addEventListener("wheel", markScrolling, { passive: true });
  scroller.addEventListener("touchmove", markScrolling, { passive: true });
  scroller.dataset.perfBound = "1";
}

function sanitizeEntryModalSticky() {
  const modal = $("#entryModal");
  if (!modal) return;
  const body = modal.querySelector(".modal-body");
  const scroll = modal.querySelector(".modal-scroll");
  const sticky = modal.querySelector(".modal-sticky");
  if (!sticky) return;

  // Ne garder dans la zone sticky que le panel narration et le header des trades.
  const keep = new Set(["narrationPanel", "tradesSectionHeader"]);
  [...sticky.children].forEach((node) => {
    if (!keep.has(node.id)) node.remove();
  });

  // Defense en profondeur: supprimer toute section trades dupliquee hors zone scroll.
  const keepFirst = (selector) => {
    const nodes = [...modal.querySelectorAll(selector)];
    nodes.slice(1).forEach((n) => n.remove());
  };
  keepFirst(".trades-section-header");
  keepFirst("#tradesList");
  keepFirst("#tradeFormSection");
  keepFirst("#addTradeBtn");

  modal.querySelectorAll(".trades-section-header, #tradesList, #tradeFormSection, #addTradeBtn")
    .forEach((node) => { if (!scroll && !sticky || (scroll && !scroll.contains(node) && sticky && !sticky.contains(node))) node.remove(); });

  // Nettoie aussi les anciens footers (version legacy) si presents.
  if (body) {
    body.querySelectorAll("button").forEach((btn) => {
      const label = (btn.textContent || "").trim().toLowerCase();
      const isHeaderClose = !!btn.closest(".modal-header");
      const isTradeFormAction = !!btn.closest("#tradeFormSection");
      if (isHeaderClose || isTradeFormAction) return;
      if (label === "fermer" || label.includes("supprimer le jour") || label.includes("supprimer ce jour")) {
        btn.remove();
      }
    });
  }
}

function setModalTradeFocus(enabled) {
  const modal = $("#entryModal");
  if (!modal) return;
  modal.classList.toggle("modal-trade-focus", !!enabled);
}

/**
 * Piege le focus clavier a l interieur d un conteneur.
 * Appele sur keydown du document quand la modale est ouverte.
 */
function _trapFocus(e, containerId) {
  var container = document.getElementById(containerId);
  if (!container || container.classList.contains("hidden")) return;
  var focusable = container.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (focusable.length === 0) return;
  var first = focusable[0];
  var last  = focusable[focusable.length - 1];
  if (e.key === "Tab") {
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

function bindModal() {
  sanitizeEntryModalSticky();
  bindModalScrollPerf();

  // Focus trap quand la modale est ouverte
  document.addEventListener("keydown", function (e) {
    if (e.key === "Tab") _trapFocus(e, "entryModal");
  });

  // Délégation : un seul listener pour tous les [data-close]
  $("#entryModal")?.addEventListener("click", function(e) {
    if (e.target.closest("[data-close]")) closeModal();
  });
  // Delete day
  $("#deleteBtn")?.addEventListener("click", deleteDay);
  // Add trade button
  $("#addTradeBtn")?.addEventListener("click", () => openTradeForm(null));
  // Trade form
  $("#tradeForm")?.addEventListener("submit", submitTrade);
  $("#deleteTradeBtn")?.addEventListener("click", deleteTrade);
  $("#cancelTradeBtn")?.addEventListener("click", closeTradeForm);
  $("#closeTradeFormBtn")?.addEventListener("click", closeTradeForm);
  // Screenshots
  const zone  = $("#uploadZone");
  const input = $("#fileInput");
  if (zone && input) {
    zone.addEventListener("click", () => input.click());
    input.addEventListener("change", e => handleFiles(e.target.files));
    ["dragenter","dragover"].forEach(ev =>
      zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add("dragover"); }));
    ["dragleave","drop"].forEach(ev =>
      zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove("dragover"); }));
    zone.addEventListener("drop", e => handleFiles(e.dataTransfer.files));
  }
  // Paste screenshot (Ctrl+V) anywhere in the trade wizard
  window.addEventListener("paste", onClipboardImagePaste, true);
  // Lightbox
  $("#lightbox")?.addEventListener("click", function () {
    $("#lightbox").classList.add("hidden");
    if (_lastFocused) { _lastFocused.focus(); _lastFocused = null; }
  });
}

function openNewDay(dateKey) {
  _lastFocused = document.activeElement; // memoriser l'element qui a ouvert
  sanitizeEntryModalSticky();
  setModalTradeFocus(false);
  closeDayPicker();
  state.currentDayId   = null;
  state.currentTradeId = null;
  state.isSavingDay    = false;
  state.isSavingTrade  = false;
  state.modalDataDirty = false;

  resetDayForm();
  resetTradeForm();
  closeTradeFormUI();

  $("#dayId").value           = "";
  $("#entryDate").value       = dateKey;
  $("#entryInstrument").value = _lastInstrument();
  $("#modalTitle").textContent = "Nouvelle journee";
  $("#deleteBtn")?.classList.add("hidden");
  $("#tradesList").innerHTML = "";
  var _addBtn = $("#addTradeBtn");
  if (_addBtn) { _addBtn.disabled = false; _addBtn.title = ""; }

  state.initialDayPayload = buildDayPayload();
  state.initialDayState = snapshotDayForm();
  $("#entryModal").classList.remove("hidden");
  if (typeof syncDayContextMidnightVisibility === "function") syncDayContextMidnightVisibility();
  setTimeout(() => { enhanceSelects($("#entryModal")); }, 0);
}

function openExistingDay(day) {
  sanitizeEntryModalSticky();
  setModalTradeFocus(false);
  closeDayPicker();
  state.currentDayId   = day.id;
  state.currentTradeId = null;
  state.isSavingDay    = false;
  state.isSavingTrade  = false;
  state.modalDataDirty = false;

  resetDayForm();
  resetTradeForm();
  closeTradeFormUI();

  // Remplir le formulaire du jour
  $("#dayId").value     = day.id;
  $("#entryDate").value = day.date;
  $("#entryInstrument").value = day.instrument;
  $("#htfContext").value    = day.htf_context  ?? "";
  $("#dailyNotes").value    = day.daily_notes   ?? "";
  setPill("htf_bias", day.htf_bias);

  $("#modalTitle").textContent = `${day.instrument} - ${day.date}`;
  $("#deleteBtn")?.classList.remove("hidden");
  var _ab2 = $("#addTradeBtn");
  if (_ab2) _ab2.disabled = false;

  renderTradesList(day.trades || []);

  state.initialDayPayload = buildDayPayload();
  state.initialDayState = snapshotDayForm();
  $("#entryModal").classList.remove("hidden");
  if (typeof syncDayContextMidnightVisibility === "function") syncDayContextMidnightVisibility();
  setTimeout(() => { enhanceSelects($("#entryModal")); }, 0);
}

async function closeModal() {
  if (state.isSavingDay || state.isSavingTrade) return;
  // Autosave du jour si modifie
  if (dayFormChanged() && $("#dayId").value) {
    await saveDayContext(false);
  }
  closeModalDirect();
}

function closeModalDirect() {
  closeDayPicker();
  setModalTradeFocus(false);
  $("#entryModal").classList.add("hidden");
  const shouldRefresh = !!state.modalDataDirty;
  state.currentDayId   = null;
  state.currentTradeId = null;
  state.isSavingDay    = false;
  state.isSavingTrade  = false;
  state.modalDataDirty = false;
  state.initialDayState = null;
  state.initialDayPayload = null;
  // Restaurer le focus sur l'element qui a ouvert la modale
  if (_lastFocused) { _lastFocused.focus(); _lastFocused = null; }
  if (shouldRefresh) {
    document.dispatchEvent(new CustomEvent("trade:saved"));
    loadAll();
  } else if (typeof renderTodayContextWidget === "function") {
    renderTodayContextWidget(true);
  }
}

