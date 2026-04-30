function wizSetDir(btn) {
  document.querySelectorAll('.wiz-dir-btn').forEach(function(b) {
    b.classList.remove('active-long','active-short');
  });
  var dir = btn.dataset.dir;
  btn.classList.add(dir === 'long' ? 'active-long' : 'active-short');
  if (wizState) wizState.data.direction = dir;
}

function wizUpdateRR() {
  var entry = +(_q('#wizEntry')?.value || 0);
  var stop  = +(_q('#wizStop')?.value  || 0);
  var tp    = +(_q('#wizTarget')?.value || 0);
  var dir   = (wizState && wizState.data.direction) || _wizActiveDir();
  var prev  = document.getElementById('wizRrPreview');
  if (!prev) return;
  if (!entry || !stop || !tp) { prev.innerHTML = ''; return; }
  var rr  = _calcRR(entry, stop, tp, dir);
  var col = rr >= 2 ? 'var(--win)' : rr >= 1.5 ? 'var(--cyan)' : 'var(--text-muted)';
  prev.innerHTML = '<div class="wiz-rr-preview" style="color:' + col + '">R:R ' + rr.toFixed(2) + '</div>';
}

function _calcRR(entry, stop, tp, dir) {
  if (!dir) dir = tp > entry ? 'long' : 'short';
  var risk   = Math.abs(entry - stop);
  var reward = dir === 'long' ? (tp - entry) : (entry - tp);
  if (!risk) return 0;
  return reward / risk;
}

// ── Screenshots ──

function _wizStepScreenshots() {
  var d      = wizState.data;
  var thumbs = (d.screenshots || []).map(function(s, i) {
    var src = s.dataUrl || s.url || s;
    return '<div class="wiz-thumb"><img src="' + src + '" alt=""><button class="wiz-thumb-del" onclick="wizRemoveScreenshot(' + i + ')" title="Supprimer">x</button></div>';
  }).join('');

  return '<div class="wiz-question">Screenshots</div>'
    + '<div class="wiz-hint">Capturez votre setup. (Optionnel)</div>'
    + '<div class="wiz-upload-zone" id="wizDropZone" onclick="document.getElementById(\'wizFileInput\').click()">'
    +   '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>'
    +   '<p>Glissez ou cliquez pour ajouter</p><small>PNG, JPG, WebP</small>'
    + '</div>'
    + '<input type="file" id="wizFileInput" accept="image/*" multiple style="display:none">'
    + '<div class="wiz-thumbs" id="wizThumbs">' + thumbs + '</div>';
}

function wizRemoveScreenshot(idx) {
  if (!wizState) return;
  wizState.data.screenshots.splice(idx, 1);
  _wizRender();
}

// ── Recap ──

function _wizFieldEmpty(value) {
  return value == null || String(value).trim() === '';
}

function _wizCollectMissingFields(data) {
  var d = data || {};
  var missing = [];

  function ask(field, question, step) {
    if (_wizFieldEmpty(d[field])) {
      missing.push({ field: field, question: question, step: step });
    }
  }

  ask('strategy', 'Challenge: quelle strategie as-tu executee ?', 'strategy');
  ask('direction', 'Challenge: direction finale long ou short ?', 'levels');
  ask('entry_price', 'Challenge: quel est ton prix d\'entree exact ?', 'levels');
  ask('stop_loss', 'Challenge: ou est place ton stop loss ?', 'levels');
  ask('take_profit', 'Challenge: quel est ton take-profit principal ?', 'levels');

  if (d.strategy === 'midnight_model') {
    ask('stdv_level', 'Challenge Midnight: quel niveau STDV a ete touche ?', 'levels');
    ask('why_entry', 'Challenge Midnight: trigger au contact (IFVG, breaker, ou les deux) ?', 'why_entry');
  }

  return missing;
}

function _wizStepRecap() {
  var d   = wizState.data;
  var idxMap = {};
  (wizState.steps || []).forEach(function(stepName, idx) { idxMap[stepName] = idx; });
  function idxOf(stepName, fallback) {
    return Number.isInteger(idxMap[stepName]) ? idxMap[stepName] : fallback;
  }
  var labels = { midnight_model:'Midnight Model', london_model:'London Model', ny_model:'NY Model' };
  var rows = [
    ['Date',       d.date         || '—', idxOf('date', 0)],
    ['Instrument', wizInstrumentLabel(d.instrument) || '—', idxOf('instrument', 1)],
    ['Strategie',  labels[d.strategy] || d.strategy || '—', idxOf('strategy', 2)],
    ['Biais',      d.htf_bias     || '—', idxOf('day_context', 3)],
    ['Direction',  d.direction    || '—', idxOf('levels', 7)],
    ['Entree',     d.entry_price  || '—', idxOf('levels', 7)],
    ['Stop',       d.stop_loss    || '—', idxOf('levels', 7)],
    ['TP',         d.take_profit  || '—', idxOf('levels', 7)],
  ];

  var tableRows = rows.filter(function(r) { return r[1] !== '—'; }).map(function(r) {
    var canEdit = r[2] >= 0;
    var editHtml = canEdit
      ? '<span class="wiz-recap-edit" onclick="wizGoTo(' + r[2] + ')">modifier</span>'
      : '<span class="wiz-recap-edit invisible">modifier</span>';
    return '<div class="wiz-recap-row">'
      + '<span class="wiz-recap-key">' + r[0] + '</span>'
      + '<span class="wiz-recap-val">' + r[1] + '</span>'
      + editHtml
      + '</div>';
  }).join('');

  var missing = _wizCollectMissingFields(d);
  var missingRows = missing.map(function(item) {
    var stepIdx = idxOf(item.step, -1);
    var edit = stepIdx >= 0
      ? '<button type="button" class="wiz-missing-edit" onclick="wizGoTo(' + stepIdx + ')">ouvrir</button>'
      : '';
    return '<div class="wiz-missing-row">'
      + '<span>' + escapeHtml(item.question) + '</span>'
      + edit
      + '</div>';
  }).join('');

  var followUps = (d.missing_followups || []).map(function(q) {
    var qq = String(q?.question || '').trim();
    if (!qq) return '';
    return '<div class="wiz-missing-row"><span>' + escapeHtml(qq) + '</span></div>';
  }).join('');

  var missingBlock = '';
  if (missing.length || followUps) {
    missingBlock = '<div class="wiz-missing-box">'
      + '<div class="wiz-missing-title">Challenge rapide final (optionnel)</div>'
      + '<div class="wiz-missing-list">' + missingRows + followUps + '</div>'
      + '<div class="wiz-missing-help">Tu peux ignorer et enregistrer, ou repondre ici pour auto-remplir la fiche.</div>'
      + '<textarea class="wiz-textarea" id="wizMissingChat" rows="4" placeholder="Ex: short, entree 18954, stop 18992, TP 18890, STDV 2, trigger IFVG en Premium avec SMT baissiere.">' + escapeHtml(d.missing_chat_text || '') + '</textarea>'
      + '<div class="wiz-missing-actions">'
      + '<button type="button" class="wiz-skip-btn" id="wizMissingAnalyzeBtn" onclick="wizAnalyzeMissingChat()">Appliquer ma reponse</button>'
      + '</div>'
      + '</div>';
  } else {
    missingBlock = '<div class="wiz-missing-box ok">'
      + '<div class="wiz-missing-title">Challenge valide</div>'
      + '<div class="wiz-missing-help">Toutes les infos clefs sont renseignees.</div>'
      + '</div>';
  }

  return '<div class="wiz-question">Recapitulatif</div>'
    + '<div class="wiz-hint">Verifie, puis enregistre. Rien n\'est obligatoire.</div>'
    + '<div class="wiz-recap-table">' + tableRows + '</div>'
    + missingBlock;
}

// ── PM Steps ──

function _wizStepPmExit() {
  var d = wizState.data;
  return '<div class="wiz-question">Cloture du trade</div>'
    + '<div class="wiz-hint">Prix de sortie.</div>'
    + '<div class="wiz-field"><label class="wiz-label">Prix de sortie</label>'
    + '<input type="number" class="wiz-input" id="wizExitPrice" value="' + (d.exit_price||'') + '" placeholder="0.00" step="0.25"></div>';
}

function _wizStepPmQuality() {
  var d = wizState.data;
  var q = d.exit_quality || 0;
  var stars = [1,2,3,4,5].map(function(n) {
    return '<button class="wiz-star' + (n<=q?' on':'') + '" data-n="' + n + '" onclick="wizSetStar(' + n + ')">'
      + '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
      + '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'
      + '</svg></button>';
  }).join('');

  return '<div class="wiz-question">Qualite de l\'execution</div>'
    + '<div class="wiz-hint">Comment avez-vous gere ce trade ? (sur 5)</div>'
    + '<div class="wiz-stars" id="wizStars">' + stars + '</div>';
}

function wizSetStar(n) {
  if (wizState) wizState.data.exit_quality = n;
  document.querySelectorAll('.wiz-star').forEach(function(s, i) {
    s.classList.toggle('on', i < n);
  });
}

function _wizStepPmLessons() {
  var d = wizState.data;
  return '<div class="wiz-question">Lecons &amp; notes</div>'
    + '<div class="wiz-hint">Que retenez-vous de ce trade ?</div>'
    + '<textarea class="wiz-textarea lg" id="wizLessons" placeholder="Observations, erreurs a eviter, ce qui a bien fonctionne...">' + (d.lessons||'') + '</textarea>';
}

// ─── After render hooks ────────────────────────────────────

function _wizAfterRender(step) {
  if (step === 'date') {
    var el = document.getElementById('wizDate');
    if (el) setTimeout(function() { el.focus(); }, 50);
  }
  if (step === 'why_trade' || step === 'why_entry' || step === 'pm_lessons') {
    var ta = document.querySelector('#wizBody textarea');
    if (ta) setTimeout(function() { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 50);
  }
  if (step === 'why_stop_tp') {
    var stop = document.getElementById('wizWhyStop');
    if (stop) setTimeout(function() { stop.focus(); }, 50);
  }
  if (step === 'levels') {
    var entry = document.getElementById('wizEntry');
    if (entry) setTimeout(function() { entry.focus(); }, 50);
  }
  if (step === 'screenshots') {
    _wizBindScreenshots();
  }
  if (step === 'recap') {
    var missingTa = document.getElementById('wizMissingChat');
    if (missingTa && !(wizState.data.missing_chat_text || '').trim()) {
      setTimeout(function() { missingTa.focus(); }, 50);
    }
  }
}

// ─── Screenshot drag-drop ──────────────────────────────────

function _wizBindScreenshots() {
  var zone  = document.getElementById('wizDropZone');
  var input = document.getElementById('wizFileInput');
  if (!zone || !input) return;

  zone.ondragover  = function(e) { e.preventDefault(); zone.classList.add('dragover'); };
  zone.ondragleave = function()  { zone.classList.remove('dragover'); };
  zone.ondrop      = function(e) {
    e.preventDefault();
    zone.classList.remove('dragover');
    _wizHandleFiles(e.dataTransfer.files);
  };
  input.onchange = function(e) { _wizHandleFiles(e.target.files); };
}

