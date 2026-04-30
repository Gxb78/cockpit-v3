function wizSkip() {
  if (!wizState) return;
  if (wizState.stepIdx < wizState.steps.length - 1) {
    wizState.stepIdx++;
    _wizRender();
  } else {
    _wizSubmit();
  }
}

function wizGoTo(idx) {
  if (!wizState) return;
  wizState.stepIdx = idx;
  _wizRender();
}

// ─── Save current step values ──────────────────────────────

function _wizSaveCurrentStep() {
  if (!wizState) return;
  const step = wizState.steps[wizState.stepIdx];
  const d    = wizState.data;

  switch (step) {
    case 'date':
      d.date = _q('#wizDate')?.value || d.date;
      break;
    case 'day_context':
      d.htf_bias      = _wizActivePill('.wiz-bias')         || d.htf_bias;
      d.htf_context   = _q('#wizHtfContext')?.value         || d.htf_context;
      d.daily_notes   = _q('#wizDailyNotes')?.value         || d.daily_notes;
      break;
    case 'why_trade':
      d.why_trade = _q('#wizWhyTrade')?.value || d.why_trade;
      break;
    case 'why_entry':
      d.why_entry = _q('#wizWhyEntry')?.value || d.why_entry;
      break;
    case 'why_stop_tp':
      d.why_stop = _q('#wizWhyStop')?.value || d.why_stop;
      d.why_tp   = _q('#wizWhyTp')?.value   || d.why_tp;
      break;
    case 'levels':
      d.direction    = _wizActiveDir()               || d.direction;
      d.entry_price  = _q('#wizEntry')?.value        || d.entry_price;
      d.stop_loss    = _q('#wizStop')?.value         || d.stop_loss;
      d.take_profit  = _q('#wizTarget')?.value       || d.take_profit;
      d.stdv_level   = _q('#wizStdv')?.value         || d.stdv_level;
      break;
    case 'pm_exit':
      d.exit_price  = _q('#wizExitPrice')?.value    || d.exit_price;

      break;
    case 'pm_lessons':
      d.lessons = _q('#wizLessons')?.value || d.lessons;
      break;
    case 'recap':
      d.missing_chat_text = _q('#wizMissingChat')?.value || '';
      break;
  }
}

function _q(sel) { return document.querySelector(sel); }

function _wizActivePill(cls) {
  return document.querySelector(cls + '.active')?.dataset.value || '';
}

function _wizActiveDir() {
  const el = document.querySelector('.wiz-dir-btn[class*="active-"]');
  return el ? el.dataset.dir : '';
}

// ─── Render ────────────────────────────────────────────────

function _wizRender() {
  if (!wizState) return;
  const step  = wizState.steps[wizState.stepIdx];
  const total = wizState.steps.length;
  const idx   = wizState.stepIdx;

  // Progress bar
  const fill = document.getElementById('wizProgressFill');
  if (fill) fill.style.transform = 'scaleX(' + (((idx + 1) / total)) + ')';

  // Step indicator
  const indicator = document.getElementById('wizStepIndicator');
  if (indicator) indicator.textContent = (idx + 1) + ' / ' + total;

  // Back button
  const backBtn = document.getElementById('wizBackBtn');
  if (backBtn) backBtn.classList.toggle('invisible', idx === 0);

  // Body
  const body = document.getElementById('wizBody');
  if (body) body.innerHTML = _wizStepHtml(step);

  // Footer
  _wizRenderFooter(step, idx, total);

  // Post-render
  _wizAfterRender(step);
}

function _wizRenderFooter(step, idx, total) {
  const isLast    = idx === total - 1;
  const skippable = !isLast;
  const skipBtn   = document.getElementById('wizSkipBtn');
  const nextBtn   = document.getElementById('wizNextBtn');

  if (skipBtn) skipBtn.classList.toggle('invisible', !skippable);

  if (nextBtn) {
    if (isLast) {
      nextBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Enregistrer';
    } else {
      nextBtn.innerHTML = 'Suivant <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>';
    }
  }
}

// ─── Step HTML ─────────────────────────────────────────────

function _wizStepHtml(step) {
  switch (step) {
    case 'date':        return _wizStepDate();
    case 'instrument':  return _wizStepInstrument();
    case 'strategy':    return _wizStepStrategy();
    case 'day_context': return _wizStepDayContext();
    case 'why_trade':   return _wizStepWhyTrade();
    case 'why_entry':   return _wizStepWhyEntry();
    case 'why_stop_tp': return _wizStepWhyStopTp();
    case 'levels':      return _wizStepLevels();
    case 'screenshots': return _wizStepScreenshots();
    case 'recap':       return _wizStepRecap();
    case 'pm_exit':     return _wizStepPmExit();
    case 'pm_quality':  return _wizStepPmQuality();
    case 'pm_lessons':  return _wizStepPmLessons();
    default:            return '<p>Etape inconnue</p>';
  }
}

function _wizChip() {
  const strat = wizState.data.strategy;
  if (!strat) return '';
  return '<div class="wiz-strategy-chip"><span class="wiz-strategy-chip-dot"></span>' + prettify(strat) + '</div>';
}

// ── Date ──

function _wizStepDate() {
  const d       = wizState.data;
  const today   = todayKey();
  const yest    = (function() { var dt = new Date(); dt.setDate(dt.getDate()-1); return dt.toISOString().slice(0,10); })();
  var draftHtml = '';

  if (wizState.hasDraft && wizState._draft) {
    var dd = wizState._draft.data;
    draftHtml = '<div class="wiz-draft-banner">'
      + '<div class="wiz-draft-banner-text">Brouillon : ' + (dd.date||'') + ' ' + (wizInstrumentLabel(dd.instrument)||'') + ' ' + prettify(dd.strategy||'')
      + '  <span class="wiz-draft-yes" onclick="wizResumeDraft()">Reprendre</span>'
      + '  <span class="wiz-draft-no"  onclick="wizDiscardDraft()">Ignorer</span>'
      + '</div></div>';
  }

  return draftHtml
    + '<div class="wiz-question">Quelle date ?</div>'
    + '<div class="wiz-hint">Date du trade (YYYY-MM-DD)</div>'
    + '<input type="date" class="wiz-input" id="wizDate" value="' + (d.date||today) + '">'
    + '<div class="wiz-date-shortcuts">'
    + '<button class="wiz-date-btn' + (d.date===today?' active':'') + '" onclick="wizSetDate(\'' + today + '\')">Aujourd\'hui</button>'
    + '<button class="wiz-date-btn' + (d.date===yest?' active':'') + '" onclick="wizSetDate(\'' + yest  + '\')">Hier</button>'
    + '</div>';
}

