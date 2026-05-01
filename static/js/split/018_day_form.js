// ---------- Day form ----------

  function resetDayForm() {
    $("#dayForm").reset();
    $$(".pills[data-pills='htf_bias'] .pill-choice").forEach(p => p.classList.remove("active"));
    setAutosaveState("idle");
}

function buildDayPayload() {
  return {
    date:         $("#entryDate").value,
    instrument:   $("#entryInstrument").value,
    htf_bias:     getPill("htf_bias"),
    htf_context:  $("#htfContext").value || null,
    daily_notes:  $("#dailyNotes").value || null,
  };
}

function dayPayloadEquals(a, b) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

function dayPayloadDiff(prev, next) {
  const base = prev || {};
  const cur = next || {};
  const diff = {};
  Object.keys(cur).forEach((k) => {
    const pv = base[k] ?? null;
    const nv = cur[k] ?? null;
    if (pv !== nv) diff[k] = cur[k];
  });
  return diff;
}

function snapshotDayForm() { return JSON.stringify(buildDayPayload()); }
function dayFormChanged()   {
  if (!state.initialDayPayload) return false;
  return !dayPayloadEquals(buildDayPayload(), state.initialDayPayload);
}

function activeDayFormId() {
  return state.currentDayId || $("#dayId")?.value || null;
}

function _dayFieldGlow(fields) {
  if (!fields || !Object.keys(fields).length) return;
  var map = {
    date:        '.day-inline-date',
    instrument:  '.day-inline-instrument',
    htf_bias:    '.today-context-bias .pills',
    htf_context: '#htfContext',
    daily_notes: '#dailyNotes',
  };
  Object.keys(fields).forEach(function (key) {
    var sel = map[key];
    if (!sel) return;
    var el = document.querySelector(sel);
    if (!el) return;
    el.classList.add('day-field-glow');
    setTimeout(function () { el.classList.remove('day-field-glow'); }, 1000);
  });
}

async function saveDayContext(isNew) {
  if (state.isSavingDay) return null;
  state.isSavingDay = true;
  setAutosaveState("saving");
  const fullPayload = buildDayPayload();
  const activeId = activeDayFormId();
  const isCreate = isNew || !activeId;
  let payload = fullPayload;
  let changedFields = null;
  if (!isCreate) {
    payload = dayPayloadDiff(state.initialDayPayload, fullPayload);
    changedFields = Object.keys(payload);
    if (Object.keys(payload).length === 0) {
      setAutosaveState("idle");
      return null;
    }
  }
  try {
    let saved;
    if (isCreate) {
      saved = await api("/api/days", { method: "POST", body: JSON.stringify(payload) });
      state.currentDayId = saved.id;
      $("#dayId").value  = saved.id;
      $("#deleteBtn")?.classList.remove("hidden");
      var _ab = $("#addTradeBtn");
      if (_ab) { _ab.disabled = false; _ab.title = ""; }
      if ($("#entryModal") && !$("#entryModal").classList.contains("hidden")) {
        $("#modalTitle").textContent = `${saved.instrument} - ${saved.date}`;
      }
      // Pour une création, tous les champs sont "changés"
      changedFields = Object.keys(fullPayload).filter(function(k) { return fullPayload[k] != null && fullPayload[k] !== ''; });
    } else {
      saved = await api(`/api/days/${activeId}`,
        { method: "PUT", body: JSON.stringify(payload) });
      if (payload.date || payload.instrument) {
if ($("#entryModal") && !$("#entryModal").classList.contains("hidden") && (payload.date || payload.instrument)) {
        const curDate = $("#entryDate").value;
        const curInstr = $("#entryInstrument").value;
        $("#modalTitle").textContent = `${curInstr} - ${curDate}`;
      }
      }
    }
    state.modalDataDirty = true;
    // Mutation locale + re-render si update simple (pas de changement date/instrument)
    if (!isCreate && !payload.date && !payload.instrument) {
      // Patcher localement state.days pour eviter un loadAll()
      if (state.days) {
        for (var _i = 0; _i < state.days.length; _i++) {
          if (state.days[_i].id === (saved && saved.id != null ? saved.id : activeId)) {
            Object.assign(state.days[_i], saved || payload);
            break;
          }
        }
      }
      if (state.currentPage === "today" && typeof renderToday === "function") renderToday();
      if (state._stats && typeof renderKPIs === "function") renderKPIs(state._stats);
    } else {
      // Changement structurel (create, date, instrument) -> rechargement complet
      if (typeof loadAll === "function") {
        setTimeout(loadAll, 100);
      }
    }
    state.initialDayPayload = buildDayPayload();
    state.initialDayState = snapshotDayForm();
    setAutosaveState("saved");
    // Glow sur les champs modifiés
    if (changedFields && changedFields.length) {
      var glowFields = {};
      changedFields.forEach(function(k) { glowFields[k] = true; });
      _dayFieldGlow(glowFields);
    }
    setTimeout(() => { if (_autosaveState === "saved") setAutosaveState("idle"); }, 2200);
    return saved;
  } catch (err) {
    setAutosaveState("error", err.message?.slice(0,30) || "Erreur");
    // Rouge persistant sur les champs modifiés
    if (changedFields && changedFields.length) {
      var errFields = {};
      changedFields.forEach(function(k) { errFields[k] = true; });
      Object.keys(errFields).forEach(function (key) {
        var sel = {date:'.day-inline-date',instrument:'.day-inline-instrument',htf_bias:'.today-context-bias .pills',htf_context:'#htfContext',daily_notes:'#dailyNotes'}[key];
        if (!sel) return;
        var el = document.querySelector(sel);
        if (el) el.classList.add('day-field-error');
      });
    }
    toast(err.message, "error");
    return null;
  } finally {
    state.isSavingDay = false;
  }
}

async function deleteDay() {
  if (!state.currentDayId) return;
  const tradesCount = (state.allDays.find(d => d.id === state.currentDayId)?.trades || []).length;
  const msg = tradesCount > 0
    ? `Supprimer ce jour ET ses ${tradesCount} trade(s) ?`
    : "Supprimer ce jour ?";
  if (!confirm(msg)) return;
  try {
    await api(`/api/days/${state.currentDayId}`, { method: "DELETE" });
    state.modalDataDirty = true;
    toast("Journée supprimée", "success");
    closeModalDirect();
  } catch (err) { toast(err.message, "error"); }
}

