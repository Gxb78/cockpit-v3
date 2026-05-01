// ---------- Autosave du jour ----------

let _autosaveState = "idle";

function _nowHHMM() {
  var d = new Date();
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

var _autosaveSavedTimer = null;

function setAutosaveState(s, msg) {
  _autosaveState = s;
  const el = $("#autosaveInd");
  const t  = $("#autosaveText");
  if (!el || !t) return;
  el.dataset.state = s;
  var labels = {
    idle: "Auto-save",
    dirty: "Modif…",
    saving: "Sauvegarde…",
    saved: msg || ("Sauvegardé à " + _nowHHMM()),
    error: msg || "Erreur",
  };
  t.textContent = labels[s] || s;
  // Retour automatique a idle apres 3s pour l etat saved
  if (s === "saved") {
    clearTimeout(_autosaveSavedTimer);
    _autosaveSavedTimer = setTimeout(function () {
      setAutosaveState("idle");
    }, 3000);
  }
}

function bindAutosave() {
  // Sauvegarde à la sortie d'un champ (focusout) avec debounce
  var _autosaveTimer = null;
  $("#dayForm")?.addEventListener("focusout", function () {
    clearTimeout(_autosaveTimer);
    _autosaveTimer = setTimeout(triggerDayAutosave, 200);
  });
  $("#dayForm")?.addEventListener("click", e => {
    if (e.target.closest(".pill-choice")) setTimeout(triggerDayAutosave, 50);
  });
}

function triggerDayAutosave() {
  if (!dayFormChanged()) return;
  setAutosaveState("dirty");
  if (activeDayFormId()) {
    saveDayContext(false);
  } else if (dayFormHasMeaningfulContent()) {
    saveDayContext(true);
  }
}

function dayFormHasMeaningfulContent() {
  const p = buildDayPayload();
  return !!(p.htf_bias || p.htf_context || p.daily_notes);
}

