// ---------- TradeEditorController — inline trade editor ----------
// Responsabilités:
//   - Ouvrir/fermer l'éditeur (drawer latéral)
//   - Collecter le payload du formulaire
//   - Sauvegarder via API (direct ou debounced)
//   - Recalculer les métriques (PnL, RR, is_win) avant save
//   - Afficher les warnings de validation
//   - Gérer le statut save (sauvegarde/sauvé/erreur)
//   - Rafraîchir l'UI après save
//
// Dépend de: deriveTradeMetrics(), journalShortText(), api(), fmtMoney(), escapeHtml(), prettify(), prettyDateKey(), computeMarginUsd(), computePositionSize()

var TradeEditorController = {};

// ---- State ----
TradeEditorController.activeTradeId = null;
TradeEditorController.saveTimers = {};
TradeEditorController.closeTime = 0;
TradeEditorController.justClosed = false;

// ---- Status management ----
TradeEditorController.setStatus = function (editor, state, text) {
  var saveBtn = editor && editor.querySelector('.jedit-save');
  if (!saveBtn) return;
  if (state === 'saving') {
    saveBtn.textContent = text || 'Sauvegarde...';
  } else if (state === 'saved') {
    saveBtn.textContent = text || 'Sauvegarde';
    setTimeout(function () { if (document.body.contains(saveBtn)) saveBtn.textContent = 'Sauver'; }, 2200);
  } else {
    saveBtn.textContent = 'Sauver';
  }
};

// ---- Payload collection ----
TradeEditorController.collectPayload = function (tid) {
  var tidStr = String(tid);
  var editor = document.querySelector('.journal-trade-editor[data-trade-id="' + tidStr + '"]');
  var trade  = _journalDayTradeCache[tidStr];
  if (!editor || !trade) return null;

  var patch = {};

  editor.querySelectorAll('.jedit-field').forEach(function (el) {
    var field = el.dataset.field;
    if (!field) return;
    var val = el.value;
    if (el.dataset.type === 'number') {
      patch[field] = val === '' ? null : Number(val);
    } else if (el.dataset.type === 'int') {
      patch[field] = val === '' ? null : Number(val);
    } else if (el.dataset.type === 'bool') {
      patch[field] = val === '' ? null : val;
    } else if (el.dataset.type === 'tags') {
      patch[field] = String(val || '')
        .split(',')
        .map(function (tag) { return tag.trim(); })
        .filter(Boolean);
    } else {
      patch[field] = val === '' ? null : val;
    }
  });

  editor.querySelectorAll('.jedit-pills').forEach(function (group) {
    var field = group.dataset.field;
    var active = group.querySelector('.jedit-pill.is-active');
    if (field) patch[field] = active ? active.dataset.value : '';
  });

  editor.querySelectorAll('.jedit-stars').forEach(function (group) {
    var field = group.dataset.field;
    if (field) {
      var starVal = group.dataset.value;
      if (starVal && starVal !== '0') patch[field] = starVal;
    }
  });

  return Object.assign({}, trade, patch);
};

// ---- Metrics recalculation before save ----
TradeEditorController.recalcMetrics = function (collected, originalTrade) {
  var entry  = collected.entry_price != null ? Number(collected.entry_price) : null;
  var exit_  = collected.exit_price != null ? Number(collected.exit_price) : null;
  var stop   = collected.stop_loss != null ? Number(collected.stop_loss) : null;
  var target = collected.take_profit != null ? Number(collected.take_profit) : null;
  var qtyRaw = collected.position_size != null ? Number(collected.position_size) : null;
  var qty    = qtyRaw && qtyRaw > 0 ? qtyRaw : 1;
  var dir    = (collected.direction || '').toLowerCase();
  if (!dir && entry != null && stop != null && stop !== entry) {
    dir = stop < entry ? 'long' : 'short';
  }

  // Recalc RR if entry + stop + target available
  if (entry != null && stop != null && target != null && stop !== entry) {
    collected.rr = Number((Math.abs(target - entry) / Math.abs(entry - stop)).toFixed(4));
  }

  // Recalc PnL from exit if user didn't explicitly change pnl
  var pnlExplicit = collected.hasOwnProperty('pnl') && collected.pnl !== (originalTrade && originalTrade.pnl);
  if (!pnlExplicit && dir && entry != null && exit_ != null) {
    collected.pnl = dir === 'long' ? (exit_ - entry) * qty : (entry - exit_) * qty;
  }

  // Infer is_win from pnl
  if (collected.is_win == null || collected.is_win === '') {
    var pnlNum = collected.pnl != null ? Number(collected.pnl) : null;
    if (pnlNum != null) {
      collected.is_win = pnlNum > 0 ? '1' : pnlNum < 0 ? '0' : '';
    }
  }
};

// ---- UI refresh after save ----
TradeEditorController.refreshUI = function (editor, trade) {
  if (!editor || !trade) return;

  // Update direction badge in topline
  var topline = editor.querySelector('.jedit-topline');
  if (topline) {
    var badges = topline.querySelectorAll('span');
    var dir = (trade.direction || '-').toUpperCase();
    if (badges.length >= 3) badges[2].textContent = dir;
  }

  // Le résumé (p) n'est plus refresh ici — le textarea contient déjà la donnée correcte.
  // L'ancienne version pouvait faire clignoter un texte d'un autre champ.
};

// ---- Inline warnings ----
TradeEditorController._warningSection = function (error) {
  var e = error.toLowerCase();
  if (e.indexOf('stop') >= 0 || e.indexOf('tp') >= 0 || e.indexOf("prix d'entree") >= 0) return 1; // Niveaux
  if (e.indexOf('pnl') >= 0) return 1;
  if (e.indexOf('these') >= 0 || e.indexOf('execution') >= 0 || e.indexOf('lecon') >= 0) return 3; // Review
  if (e.indexOf('plan') >= 0 || e.indexOf('override') >= 0) return 4; // Plan
  return 0;
};

TradeEditorController.showWarnings = function (editor, errorMsg) {
  TradeEditorController.clearWarnings(editor);
  if (!errorMsg) return;

  var errors = errorMsg.split('; ');
  errors.forEach(function (err) {
    err = err.trim();
    if (!err) return;
    var sectionIdx = TradeEditorController._warningSection(err);
    if (sectionIdx < 0) return;

    var sections = editor.querySelectorAll('.jedit-block');
    var target   = sections[sectionIdx];
    if (!target) return;

    var warn = document.createElement('div');
    warn.className = 'jedit-block-msg';
    warn.textContent = err;
    var title = target.querySelector('.jedit-block-title');
    if (title) title.parentNode.insertBefore(warn, title.nextSibling);
  });
};

TradeEditorController.clearWarnings = function (editor) {
  if (!editor) return;
  editor.querySelectorAll('.jedit-block-msg').forEach(function (el) { el.remove(); });
};

// ---- Field glow — feedback visuel par champ ---- //

// Mapping champ → section (utilisé par _changedFields pour filtrer les champs metier)
TradeEditorController._fieldToSection = {
  strategy: 0, direction: 0, stdv_level: 0, is_win: 0,
  entry_price: 1, stop_loss: 1, take_profit: 1, exit_price: 1,
  position_size: 1, leverage: 1, pnl: 1, rr: 1,
  why_trade: 2, why_entry: 2, scenario: 2, why_stop: 2, why_tp: 2,
  thesis_validated: 3, execution_quality: 3, tags: 3, lessons_learned: 3,
  plan_model: 4, plan_direction: 4, plan_alignment: 4, plan_score: 4,
  plan_errors: 4, plan_warnings: 4, plan_override_reason: 4, plan_snapshot: 4,
};

TradeEditorController._changedFields = function (payload, original) {
  var fields = {};
  if (!original) return fields;
  Object.keys(payload).forEach(function (key) {
    if (TradeEditorController._fieldToSection[key] === undefined) return;
    // Ignorer les champs qui seront recalculés par recalcMetrics
    // (leur diff est artifact du calcul, pas une modif volontaire)
    if (key === 'rr' || key === 'pnl' || key === 'is_win') return;
    if (String(payload[key] ?? '').trim() !== String(original[key] ?? '').trim()) {
      fields[key] = true;
    }
  });
  return fields;
};

TradeEditorController._findFieldEl = function (editor, fieldName) {
  if (!editor) return null;
  // Chercher l'élément du champ directement (input, textarea, select, pills, stars)
  return editor.querySelector(
    'input[data-field="' + fieldName + '"], ' +
    'textarea[data-field="' + fieldName + '"], ' +
    'select[data-field="' + fieldName + '"], ' +
    '.jedit-pills[data-field="' + fieldName + '"], ' +
    '.jedit-stars[data-field="' + fieldName + '"]'
  ) || null;
};

TradeEditorController._glowFields = function (editor, fields, type) {
  if (!editor) return;
  // Nettoyer les glows précédents du même type
  editor.querySelectorAll('.jedit-field-glow, .jedit-field-error').forEach(function (el) {
    el.classList.remove('jedit-field-glow', 'jedit-field-error');
  });
  if (type === '') return;
  Object.keys(fields).forEach(function (fieldName) {
    var wrap = TradeEditorController._findFieldEl(editor, fieldName);
    if (!wrap) return;
    if (type === 'success') {
      wrap.classList.add('jedit-field-glow');
    } else if (type === 'error') {
      wrap.classList.add('jedit-field-error');
    }
  });
};

// ---- Save ----
TradeEditorController.save = function (tid) {
  var tidStr  = String(tid);
  // Nettoyer tout timer en attente pour éviter une double sauvegarde
  clearTimeout(TradeEditorController.saveTimers[tidStr]);
  
  var original = _journalDayTradeCache[tidStr];
  var payload  = TradeEditorController.collectPayload(tidStr);
  var editor   = document.querySelector('.journal-trade-editor[data-trade-id="' + tidStr + '"]');
  if (!payload || !editor) return;

  // Détecter les champs modifiés
  var changedFields = TradeEditorController._changedFields(payload, original);

  TradeEditorController.recalcMetrics(payload, original);

  // Nettoyer les glows précédents
  TradeEditorController._glowFields(editor, {}, '');
  TradeEditorController.setStatus(editor, 'saving', 'Sauvegarde...');

  api('/api/trades/' + tidStr, { method: 'PUT', body: JSON.stringify(payload) })
    .then(function (res) {
      var updated = (res && res.trade) ? res.trade : res;
      updated = updated && updated.id ? updated : payload;
      _journalDayTradeCache[tidStr] = updated;
      _journalCardRefreshMetrics(tidStr, updated);
      TradeEditorController.refreshUI(editor, updated);
      _journalSyncStateAfterSave(tidStr, updated);
      TradeEditorController.clearWarnings(editor);
      TradeEditorController._glowFields(editor, changedFields, 'success');
      TradeEditorController.setStatus(editor, 'saved', 'Sauvegarde');
      // Retirer le glow après 1s
      setTimeout(function () {
        TradeEditorController._glowFields(editor, changedFields, '');
      }, 1000);
    })
    .catch(function (err) {
      TradeEditorController.showWarnings(editor, (err && err.message) ? err.message : null);
      TradeEditorController._glowFields(editor, changedFields, 'error');
    });
};

TradeEditorController.scheduleSave = function (tid) {
  // Sauvegarde immédiate à la sortie du champ, pas de debounce
  TradeEditorController.save(tid);
};

TradeEditorController.flushPending = function () {
  var timers = TradeEditorController.saveTimers;
  Object.keys(timers).forEach(function (tid) {
    clearTimeout(timers[tid]);
    TradeEditorController.save(tid);
  });
  TradeEditorController.saveTimers = {};
};

// ---- Open / Close ----
TradeEditorController.open = function (tid) {
  var tidStr = String(tid);
  var wrap   = $('#journalDayTrades');
  var trade  = _journalDayTradeCache[tidStr];
  var day    = _journalDayTradeDays[tidStr];
  if (!wrap || !trade || !day) return;

  // Repérer la card source
  var sourceCard = wrap.querySelector('.journal-flip-card[data-trade-id="' + tidStr + '"]');

  TradeEditorController.close({ immediate: true });
  TradeEditorController.activeTradeId = tidStr;
  wrap.classList.add('is-editing');
  wrap.classList.add('is-focusing');
  document.documentElement.classList.add('html-editor-open');
  document.documentElement.classList.add('journal-no-flip');

  // Card source monte, les autres s'atténuent (CSS transitions)
  if (sourceCard) sourceCard.classList.add('is-source');

  // Insérer l'éditeur immédiatement
  wrap.insertAdjacentHTML('beforeend', TradeEditorController.renderHtml(day, trade));

  var editor = wrap.querySelector('.journal-trade-editor[data-trade-id="' + tidStr + '"]');
  if (!editor) return;

  // Laisser le DOM s'afficher, puis animer l'éditeur
  requestAnimationFrame(function () {
    editor.classList.add('is-visible');
    // Stagger reveal des sections
    var scroll = editor.querySelector('.jedit-scroll');
    if (scroll) scroll.classList.add('is-revealing');
  });

  setTimeout(function () {
    var focusTarget = editor.querySelector('.jedit-field, .jedit-pill, .jedit-close');
    if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus({ preventScroll: true });
  }, 120);
};

TradeEditorController.close = function (opts) {
  var wrap    = $('#journalDayTrades');
  var editor  = wrap && wrap.querySelector('.journal-trade-editor');
  if (!wrap || !editor) return;

  var closingTid = TradeEditorController.activeTradeId;
  TradeEditorController.flushPending();
  TradeEditorController.justClosed = true;
  TradeEditorController.closeTime = Date.now();

  // 🛡️ Mettre à jour les infos de la card SANS remplacer le DOM
  // pour éviter le glitch visuel
  if (closingTid && !(opts && opts.immediate)) {
    _journalCardRefreshMetrics(closingTid, _journalDayTradeCache[String(closingTid)]);
    // Mettre à jour le nom de la stratégie et le résumé sur la face avant
    var card = document.querySelector('.journal-flip-card[data-trade-id="' + String(closingTid) + '"]');
    var trade = _journalDayTradeCache[String(closingTid)];
    if (card && trade) {
      var h4 = card.querySelector('.journal-trade-main h4');
      if (h4) h4.textContent = escapeHtml(trade.strategy ? prettify(trade.strategy) : 'Strategie inconnue');
      var summary = card.querySelector('.journal-trade-main p');
      if (summary) summary.textContent = escapeHtml(TradeEditorController.shortText(trade.why_trade, trade.scenario, trade.why_entry));
    }
  }

  // 🔥 Unfocus : animation inverse
  wrap.classList.add('is-unfocusing');
  wrap.classList.remove('is-focusing');
  wrap.classList.remove('is-editing');
  document.documentElement.classList.remove('journal-no-flip');

  if (opts && opts.immediate) {
    TradeEditorController.activeTradeId = null;
    document.documentElement.classList.remove('html-editor-open');
    wrap.classList.remove('is-unfocusing');
    editor.remove();
    setTimeout(function () { TradeEditorController.justClosed = false; }, 250);
    return;
  }

  editor.classList.remove('is-visible');

  // Attendre l'animation de unfocus puis nettoyer
  setTimeout(function () {
    TradeEditorController.activeTradeId = null;
    document.documentElement.classList.remove('html-editor-open');
    wrap.classList.remove('is-unfocusing');
    if (editor.parentNode) editor.remove();
  }, 550);
  setTimeout(function () { TradeEditorController.justClosed = false; }, 650);
};

// ---- Editor HTML helpers ----
TradeEditorController.selectOption = function (value, label, current) {
  return '<option value="' + escapeHtml(value) + '"' + (String(current || '') === String(value) ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
};

TradeEditorController.field = function (label, field, value, type, opts) {
  var o = opts || {};
  var inputType = type === 'number' || type === 'int' ? 'number' : 'text';
  var step      = o.step ? ' step="' + escapeHtml(o.step) + '"' : '';
  var placeholder = o.placeholder ? ' placeholder="' + escapeHtml(o.placeholder) + '"' : '';
  var dataType = type ? ' data-type="' + escapeHtml(type) + '"' : '';
  return '<label class="jedit-field-wrap"><span>' + escapeHtml(label) + '</span><input class="jedit-field" type="' + inputType + '"' + step + dataType + ' data-field="' + escapeHtml(field) + '" value="' + TradeEditorController.valueAttr(value) + '"' + placeholder + ' /></label>';
};

TradeEditorController.textarea = function (label, field, value, rows) {
  return '<label class="jedit-field-wrap jedit-text-wrap"><span>' + escapeHtml(label) + '</span><textarea class="jedit-field" data-field="' + escapeHtml(field) + '" rows="' + (rows || 3) + '">' + escapeHtml(String(value || '')) + '</textarea></label>';
};

TradeEditorController.pills = function (field, current, choices) {
  return '<div class="jedit-pills" data-field="' + escapeHtml(field) + '">' + choices.map(function (choice) {
    var active = String(current || '') === String(choice.value || '');
    return '<button type="button" class="jedit-pill' + (active ? ' is-active' : '') + '" data-value="' + escapeHtml(choice.value || '') + '">' + escapeHtml(choice.label) + '</button>';
  }).join('') + '</div>';
};

TradeEditorController.strategyOptions = function (current) {
  var values = [];
  (DEFAULT_STRATEGY_VALUES || []).forEach(function (value) { if (values.indexOf(value) === -1) values.push(value); });
  ((state && state.settings && state.settings.custom_strategies) || []).forEach(function (s) {
    if (s && s.value && values.indexOf(s.value) === -1) values.push(s.value);
  });
  if (current && values.indexOf(current) === -1) values.push(current);
  return values.map(function (value) { return TradeEditorController.selectOption(value, prettify(value), current); }).join('');
};

TradeEditorController.shortText = function () {
  for (var i = 0; i < arguments.length; i += 1) {
    var v = String(arguments[i] || '').trim();
    if (v) return v.length > 150 ? v.slice(0, 147) + '...' : v;
  }
  return 'Aucun resume renseigne pour ce trade.';
};

TradeEditorController.fmtPrice = function (v) {
  if (v == null || v === '') return '-';
  var n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : '-';
};

TradeEditorController.valueAttr = function (v) {
  return v == null ? '' : escapeHtml(String(v));
};

TradeEditorController.tagsValue = function (tags) {
  return Array.isArray(tags) ? tags.join(', ') : '';
};

// ---- Editor HTML template ----
TradeEditorController.renderHtml = function (day, trade) {
  var m = deriveTradeMetrics(trade);
  var pnl = Number(m.pnl || 0);
  var pnlClass = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : 'flat';
  var resultClass = m.isWin === 1 ? 'win' : m.isWin === 0 ? 'loss' : 'neutral';
  var resultLabel = m.isWin === 1 ? 'WIN' : m.isWin === 0 ? 'LOSS' : '-';
  var direction   = (m.direction || trade.direction || '').toLowerCase();
  var rr    = m.rr == null ? '-' : Number(m.rr).toFixed(2) + 'R';
  var strategy = trade.strategy ? prettify(trade.strategy) : 'Strategie inconnue';
  var dateLabel = prettyDateKey(day.date);
  var shot = (trade.screenshots || [])[0];
  var shotStyle = shot ? ' style="background-image:url(\'/screenshots/' + escapeHtml(shot.filename) + '\')"' : '';
  var shotClass = shot ? 'has-shot' : 'is-empty';
  var qualityRaw = Number(trade.execution_quality) || 0;
  var tid = escapeHtml(String(trade.id));
  var winValue = trade.is_win == null ? '' : String(trade.is_win);
  var starsHtml = [1, 2, 3, 4, 5].map(function (i) {
    return '<button type="button" class="jedit-star' + (qualityRaw >= i ? ' is-lit' : '') + '" data-val="' + i + '">★</button>';
  }).join('');
  var screenshotsHtml = (trade.screenshots || []).length
    ? (trade.screenshots || []).map(function (s) {
        return '<a class="jedit-shot-thumb" href="/screenshots/' + escapeHtml(s.filename) + '" target="_blank" rel="noreferrer" style="background-image:url(&quot;/screenshots/' + escapeHtml(s.filename) + '&quot;)" aria-label="Ouvrir screenshot"></a>';
      }).join('')
    : '<div class="jedit-empty">Aucune capture pour ce trade.</div>';

  return '\n    <aside class="journal-trade-editor" data-trade-id="' + tid + '" role="dialog" aria-label="Edition du trade">\n      <div class="jedit-panel">\n        <div class="jedit-hero">\n          <div class="jedit-hero-shot ' + shotClass + '"' + shotStyle + '>' + (shot ? '' : '<span>Aucune capture</span>') + '</div>\n          <div class="jedit-hero-copy">\n            <div class="jedit-topline">\n              <span>' + escapeHtml(dateLabel) + '</span>\n              <span>' + escapeHtml(day.instrument || '-') + '</span>\n              <span>' + escapeHtml((direction || '-').toUpperCase()) + '</span>\n            </div>\n            <h3>' + escapeHtml(strategy) + '</h3>\n            <p>' + escapeHtml(TradeEditorController.shortText(trade.why_trade, trade.scenario, trade.why_entry)) + '</p>\n            <div class="jedit-metrics">\n              <div class="jedit-metric-pnl"><strong class="' + pnlClass + '">' + fmtMoney(pnl) + '</strong><span>PnL</span></div>\n              <div class="jedit-metric-rr"><strong>' + escapeHtml(rr) + '</strong><span>R multiple</span></div>\n              <div class="jedit-metric-result"><strong class="' + resultClass + '">' + escapeHtml(resultLabel) + '</strong><span>Resultat</span></div>\n            </div>\n          </div>\n          <div class="jedit-actions">\n            <span class="jedit-status" data-state=""></span>\n            <button type="button" class="jedit-save" data-journal-editor-save="' + tid + '">Sauver</button>\n            <button type="button" class="jedit-close" data-journal-editor-close aria-label="Fermer">\n              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>\n            </button>\n          </div>\n        </div>\n\n        <div class="jedit-scroll">\n          <section class="jedit-block jedit-identity">\n            <div class="jedit-block-title"><span>01</span><h4>Setup</h4></div>\n            <div class="jedit-grid">\n              <label class="jedit-field-wrap"><span>Strategie</span><select class="jedit-field" data-field="strategy">' + TradeEditorController.strategyOptions(trade.strategy || '') + '</select></label>\n              <label class="jedit-field-wrap"><span>Direction</span>' + TradeEditorController.pills('direction', direction, [{ value: 'long', label: 'Long' }, { value: 'short', label: 'Short' }, { value: '', label: '?' }]) + '</label>\n              ' + TradeEditorController.field('Stdv', 'stdv_level', trade.stdv_level, 'number', { step: '0.5', placeholder: '1 - 5' }) + '\n              <label class="jedit-field-wrap"><span>Resultat</span><select class="jedit-field" data-field="is_win" data-type="bool">' + TradeEditorController.selectOption('', 'A qualifier', winValue) + TradeEditorController.selectOption('1', 'Win', winValue) + TradeEditorController.selectOption('0', 'Loss', winValue) + '</select></label>\n            </div>\n          </section>\n\n          <section class="jedit-block">\n            <div class="jedit-block-title"><span>02</span><h4>Niveaux</h4></div>\n            <div class="jedit-grid jedit-grid-5">\n              ' + TradeEditorController.field('Entree', 'entry_price', trade.entry_price, 'number', { step: '0.01' }) + '\n              ' + TradeEditorController.field('Stop', 'stop_loss', trade.stop_loss, 'number', { step: '0.01' }) + '\n              ' + TradeEditorController.field('Target', 'take_profit', trade.take_profit, 'number', { step: '0.01' }) + '\n              ' + TradeEditorController.field('Sortie', 'exit_price', trade.exit_price, 'number', { step: '0.01' }) + '\n              ' + TradeEditorController.field('Size', 'position_size', trade.position_size, 'number', { step: '0.01' }) + '\n              ' + TradeEditorController.field('Levier', 'leverage', trade.leverage, 'number', { step: '1', placeholder: '1x' }) + '\n              ' + TradeEditorController.field('PnL', 'pnl', trade.pnl, 'number', { step: '0.01' }) + '\n              ' + TradeEditorController.field('RR', 'rr', trade.rr, 'number', { step: '0.01' }) + '\n            </div>\n          </section>\n\n          <section class="jedit-block">\n            <div class="jedit-block-title"><span>03</span><h4>Scenario</h4></div>\n            <div class="jedit-notes">\n              ' + TradeEditorController.textarea('Pourquoi ce trade', 'why_trade', trade.why_trade, 3) + '\n              ' + TradeEditorController.textarea('Pourquoi cette entree', 'why_entry', trade.why_entry, 3) + '\n              ' + TradeEditorController.textarea('Scenario complet', 'scenario', trade.scenario, 4) + '\n              ' + TradeEditorController.textarea('Pourquoi ce stop', 'why_stop', trade.why_stop, 3) + '\n              ' + TradeEditorController.textarea('Pourquoi ce TP', 'why_tp', trade.why_tp, 3) + '\n            </div>\n          </section>\n\n          <section class="jedit-block">\n            <div class="jedit-block-title"><span>04</span><h4>Review</h4></div>\n            <div class="jedit-grid">\n              <label class="jedit-field-wrap"><span>These validee</span>' + TradeEditorController.pills('thesis_validated', trade.thesis_validated || '', [{ value: 'yes', label: 'Oui' }, { value: 'no', label: 'Non' }, { value: '', label: '?' }]) + '</label>\n              <label class="jedit-field-wrap"><span>Qualite execution</span><div class="jedit-stars" data-field="execution_quality" data-value="' + qualityRaw + '">' + starsHtml + '</div></label>\n              ' + TradeEditorController.field('Tags', 'tags', TradeEditorController.tagsValue(trade.tags), 'tags', { placeholder: 'tag1, tag2' }) + '\n              ' + TradeEditorController.textarea('Lecons apprises', 'lessons_learned', trade.lessons_learned, 4) + '\n            </div>\n          </section>\n\n          <section class="jedit-block">\n            <div class="jedit-block-title"><span>05</span><h4>Plan & captures</h4></div>\n            <div class="jedit-plan-grid">\n              <div><span>Plan model</span><strong>' + escapeHtml(trade.plan_model || '-') + '</strong></div>\n              <div><span>Direction plan</span><strong>' + escapeHtml(trade.plan_direction || '-') + '</strong></div>\n              <div><span>Alignement</span><strong>' + escapeHtml(trade.plan_alignment || 'unknown') + '</strong></div>\n              <div><span>Score</span><strong>' + (trade.plan_score == null ? '-' : escapeHtml(String(trade.plan_score))) + '</strong></div>\n            </div>\n            ' + TradeEditorController.textarea('Raison override plan', 'plan_override_reason', trade.plan_override_reason, 3) + '\n            <div class="jedit-shots">' + screenshotsHtml + '</div>\n          </section>\n        </div>\n      </div>\n    </aside>\n  ';
};
