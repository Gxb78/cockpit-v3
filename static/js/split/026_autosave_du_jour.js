// ---------- Autosave du jour ----------

let _autosaveTimer = null;
let _autosaveState = "idle";
const AUTOSAVE_DELAY = 1800;

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
  // On écoute uniquement les champs du formulaire du jour
  $("#dayForm")?.addEventListener("input", triggerDayAutosave);
  $("#dayForm")?.addEventListener("click", e => {
    if (e.target.closest(".pill-choice")) setTimeout(triggerDayAutosave, 50);
  });
}

function triggerDayAutosave() {
  if (!dayFormChanged()) return;
  setAutosaveState("dirty");
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(() => {
    if (activeDayFormId()) {
      saveDayContext(false);
    } else if (dayFormHasMeaningfulContent()) {
      saveDayContext(true);
    }
  }, AUTOSAVE_DELAY);
}

function dayFormHasMeaningfulContent() {
  const p = buildDayPayload();
  return !!(p.htf_bias || p.htf_context || p.daily_notes);
}

