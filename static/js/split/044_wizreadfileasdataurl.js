function _wizReadFileAsDataUrl(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) { resolve(e.target.result); };
    reader.onerror = function() { reject(new Error('Lecture image impossible')); };
    reader.readAsDataURL(file);
  });
}

async function _wizHandleFiles(files) {
  if (!wizState || !files || files.length === 0) return;
  var imageFiles = Array.from(files).filter(function(file) {
    return !!file && file.type && file.type.startsWith('image/');
  });
  if (!imageFiles.length) return;

  for (const file of imageFiles) {
    try {
      const dataUrl = await _wizReadFileAsDataUrl(file);
      if (!wizState) return;
      wizState.data.screenshots.push({ dataUrl: dataUrl, name: file.name });
    } catch (_err) {}
  }

  if (wizState && wizState.steps[wizState.stepIdx] === 'screenshots') {
    _wizRender();
  }
}

function _wizFollowUpQuestionsFromParse(data) {
  var raw = Array.isArray(data?._follow_up_questions) ? data._follow_up_questions : [];
  return raw.map(function(item) {
    if (typeof item === 'string') return { field: '', question: item };
    return {
      field: String(item?.field || ''),
      question: String(item?.question || ''),
    };
  }).filter(function(item) { return !!item.question.trim(); });
}

function _wizApplyParseResult(data) {
  if (!wizState || !data) return;
  var d = wizState.data;

  if (data.strategy) d.strategy = String(data.strategy);
  if (data.direction) d.direction = String(data.direction);
  if (data._htf_bias) d.htf_bias = String(data._htf_bias);

  if (data.why_trade) d.why_trade = String(data.why_trade);
  if (data.why_entry) d.why_entry = String(data.why_entry);
  if (data.scenario) d.scenario = String(data.scenario);
  if (data.why_stop) d.why_stop = String(data.why_stop);
  if (data.why_tp) d.why_tp = String(data.why_tp);

  if (data.entry_price != null) d.entry_price = String(data.entry_price);
  if (data.stop_loss != null) d.stop_loss = String(data.stop_loss);
  if (data.take_profit != null) d.take_profit = String(data.take_profit);
  if (data.stdv_level != null) d.stdv_level = String(data.stdv_level);
  if (data.pnl != null) d.pnl = String(data.pnl);
  if (data.rr != null) d.rr = String(data.rr);
  if (data.is_win != null) d.is_win = data.is_win ? '1' : '0';

  d.missing_followups = _wizFollowUpQuestionsFromParse(data);
}

async function wizAnalyzeMissingChat() {
  if (!wizState) return;
  _wizSaveCurrentStep();

  var textarea = document.getElementById('wizMissingChat');
  var analyzeBtn = document.getElementById('wizMissingAnalyzeBtn');
  var text = String(textarea?.value || '').trim();
  if (!text) {
    if (typeof toast === 'function') toast("Ecris ta reponse avant l'application", "error");
    return;
  }

  if (analyzeBtn) {
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = "Application...";
  }

  try {
    var parsed = await api('/api/parse-trade', {
      method: 'POST',
      body: JSON.stringify({ text: text }),
    });
    _wizApplyParseResult(parsed);
    _wizSaveDraft();
    _wizRender();
    var followUps = _wizFollowUpQuestionsFromParse(parsed);
    if (followUps.length) {
      if (typeof toast === 'function') toast("Challenge rapide partiel: complete les points restants si besoin", "error");
    } else if (typeof toast === 'function') {
      toast("Reponse appliquee a la fiche", "success");
    }
  } catch (err) {
    if (typeof toast === 'function') toast("Erreur analyse : " + err.message, "error");
  } finally {
    if (analyzeBtn) {
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = "Appliquer ma reponse";
    }
  }
}

// ─── Submit ────────────────────────────────────────────────

async function _wizSubmit() {
  _wizSaveCurrentStep();

  if (wizState.mode === 'postmortem') {
    return _wizSubmitPM();
  }

  var d = wizState.data;
  if (!d.date) d.date = todayKey();
  var instrument = wizCanonicalInstrument(d.instrument) || wizDefaultInstrument();
  if (!WIZ_INSTRUMENTS.includes(instrument)) {
    instrument = wizDefaultInstrument();
  }
  d.instrument = instrument;

  try {
    // 1. Find or create day
    var dayId = d.dayId;
    if (!dayId) {
      var lookupRes = await fetch('/api/days/lookup?date=' + d.date + '&instrument=' + encodeURIComponent(instrument));
      if (lookupRes.ok) {
        var existing = await lookupRes.json();
        if (existing && existing.id) dayId = existing.id;
      }
    }

    if (!dayId) {
      var dayRes = await fetch('/api/days', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date:          d.date,
          instrument:    instrument,
          htf_bias:      d.htf_bias,
          htf_context:   d.htf_context,
          daily_notes:   d.daily_notes,
          tags:          d.tags,
        })
      });
      if (!dayRes.ok) throw new Error('Erreur creation du jour');
      var day = await dayRes.json();
      dayId = day.id;
    } else if (d.htf_bias || d.htf_context || d.daily_notes) {
      await fetch('/api/days/' + dayId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          htf_bias: d.htf_bias,
          htf_context: d.htf_context,
          daily_notes: d.daily_notes,
        })
      });
    }

    // 2. Create trade
    var tradeRes = await fetch('/api/days/' + dayId + '/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        strategy:     d.strategy,
        direction:    d.direction,
        entry_price:  d.entry_price  ? +d.entry_price  : null,
        stop_loss:    d.stop_loss    ? +d.stop_loss    : null,
        take_profit:  d.take_profit  ? +d.take_profit  : null,
        stdv_level:   d.stdv_level   ? +d.stdv_level   : null,
        scenario:     d.scenario,
        why_trade:    d.why_trade,
        why_entry:    d.why_entry,
        why_stop:     d.why_stop,
        why_tp:       d.why_tp,
      })
    });
    if (!tradeRes.ok) throw new Error('Erreur creation du trade');
    var trade   = await tradeRes.json();
    var tradeId = trade.id;

    // 3. Upload screenshots
    for (var si = 0; si < (d.screenshots || []).length; si++) {
      var s = d.screenshots[si];
      if (!s.dataUrl) continue;
      var blob = await (await fetch(s.dataUrl)).blob();
      var form = new FormData();
      form.append('file', blob, s.name || 'screenshot.png');
      await fetch('/api/trades/' + tradeId + '/screenshots', { method: 'POST', body: form });
    }

    _wizClearDraft();
    wizClose();
    if (typeof toast    === 'function') toast("Trade enregistre", "success");
    if (typeof loadAll === 'function') loadAll();

  } catch(err) {
    console.error(err);
    if (typeof toast === 'function') toast("Erreur : " + err.message, "error");
  }
}

async function _wizSubmitPM() {
  var d = wizState.data;
  if (!d.tradeId) {
    if (typeof toast === 'function') toast("Trade introuvable", "error");
    return;
  }
  try {
    var res = await fetch('/api/trades/' + d.tradeId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        exit_price:        d.exit_price   ? +d.exit_price : null,

        execution_quality: d.exit_quality || null,
        lessons_learned:   d.lessons,
      })
    });
    if (!res.ok) throw new Error('Erreur mise a jour trade');
    wizClose();
    if (typeof toast    === 'function') toast("Post-mortem enregistre", "success");
    if (typeof loadAll === 'function') loadAll();
  } catch(err) {
    if (typeof toast === 'function') toast("Erreur : " + err.message, "error");
  }
}

// ─── Keyboard ──────────────────────────────────────────────

function _wizKeydown(e) {
  if (!wizState) return;
  if (e.key === 'Escape') { e.preventDefault(); wizBack(); return; }
  if (e.key === 'Enter') {
    var activeEl = document.activeElement;
    var isTextarea = activeEl && activeEl.tagName === 'TEXTAREA';
    if (isTextarea && !e.ctrlKey) return;
    e.preventDefault();
    wizNext();
  }
}

// ─── Bind ──────────────────────────────────────────────────

