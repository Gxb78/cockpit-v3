// ---------- Journal inline day trades ----------

var _journalDayTradeCardsBound = false;
var _journalDayTradeCache = {};
var _journalDayTradeDays = {};
var _journalCardSaveTimers = {};
var _journalEditorSaveTimers = {};
var _journalEditorActiveTradeId = null;
var _journalRefreshTimer = null;

// ---- collect / summarize helpers ----

function collectJournalDayTrades(days) {
  var out = [];
  (days || []).forEach(function (day) {
    (day.trades || []).forEach(function (trade) {
      out.push({ day: day, trade: trade });
    });
  });
  return out;
}

function summarizeJournalDayTrades(items) {
  return items.reduce(function (acc, item) {
    var m = deriveTradeMetrics(item.trade);
    var pnl = Number(m.pnl || 0);
    acc.pnl += pnl;
    if (m.isWin === 1) acc.wins += 1;
    if (m.isWin === 0) acc.losses += 1;
    acc.instruments[item.day.instrument || "-"] = true;
    return acc;
  }, { pnl: 0, wins: 0, losses: 0, instruments: {} });
}

// ---- inline edit: collect, save, refresh ----

function _journalCardCollectPayload(tid) {
  var tidStr = String(tid);
  var scroll = document.querySelector('.journal-flip-back-scroll[data-trade-id="' + tidStr + '"]');
  if (!scroll) return null;
  var trade = _journalDayTradeCache[tidStr];
  if (!trade) return null;

  var patch = {};

  // text / number inputs and textareas
  scroll.querySelectorAll('input.jcard-field, textarea.jcard-field').forEach(function (el) {
    patch[el.dataset.field] = el.value;
  });

  // pill groups — active pill value per group
  scroll.querySelectorAll('.jcard-pills').forEach(function (group) {
    var field = group.dataset.field;
    var active = group.querySelector('.jcard-pill.is-active');
    if (field) patch[field] = active ? active.dataset.value : '';
  });

  // star rating — stored on the wrapper's data-value
  scroll.querySelectorAll('.jcard-stars').forEach(function (group) {
    var field = group.dataset.field;
    if (field) {
      var starVal = group.dataset.value;
      if (starVal && starVal !== '0') patch[field] = starVal;
    }
  });

  return Object.assign({}, trade, patch);
}

function _journalCardSave(tid) {
  var tidStr = String(tid);
  var payload = _journalCardCollectPayload(tidStr);
  if (!payload) return;

  var scroll = document.querySelector('.journal-flip-back-scroll[data-trade-id="' + tidStr + '"]');
  var ind = scroll && scroll.querySelector('.jcard-save-ind');
  if (ind) { ind.textContent = '…'; ind.dataset.state = 'saving'; }

  api('/api/trades/' + tidStr, { method: 'PUT', body: JSON.stringify(payload) })
    .then(function (res) {
      var updated = (res && res.trade) ? res.trade : payload;
      _journalDayTradeCache[tidStr] = updated;
      _journalCardRefreshMetrics(tidStr, updated);
      _journalCardRefreshFull(tidStr, updated);
      _journalRefreshStateDebounced();
      if (ind) {
        ind.textContent = 'Sauvegardé ✓';
        ind.dataset.state = 'saved';
        setTimeout(function () {
          if (ind) { ind.textContent = ''; ind.dataset.state = ''; }
        }, 2200);
      }
    })
    .catch(function () {
      if (ind) { ind.textContent = 'Erreur'; ind.dataset.state = 'error'; }
    });
}

function _journalCardRefreshMetrics(tid, trade) {
  var tidStr = String(tid);
  var scroll = document.querySelector('.journal-flip-back-scroll[data-trade-id="' + tidStr + '"]');
  var card   = document.querySelector('.journal-flip-card[data-trade-id="' + tidStr + '"]');
  var editor = document.querySelector('.journal-trade-editor[data-trade-id="' + tidStr + '"]');
  var m      = deriveTradeMetrics(trade);
  var pnl    = Number(m.pnl || 0);
  var pnlClass    = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : 'flat';
  var resultClass = m.isWin === 1 ? 'win' : m.isWin === 0 ? 'loss' : 'neutral';
  var resultLabel = m.isWin === 1 ? 'WIN' : m.isWin === 0 ? 'LOSS' : '-';
  var rrTxt  = m.rr == null ? '-' : Number(m.rr).toFixed(2) + 'R';
  var pnlTxt = fmtMoney(pnl);

  // Back face
  if (scroll) {
    var pnlEl = scroll.querySelector('.jcard-pnl-display');
    if (pnlEl) { pnlEl.textContent = pnlTxt; pnlEl.className = 'jcard-pnl-display ' + pnlClass; }
    var rrEl  = scroll.querySelector('.jcard-rr-display');
    if (rrEl) rrEl.textContent = rrTxt;
    var resEl = scroll.querySelector('.jcard-result-display');
    if (resEl) { resEl.textContent = resultLabel; resEl.className = 'jcard-result-display ' + resultClass; }
  }

  // Front face
  if (card) {
    var topPnl = card.querySelector('.journal-flip-front .journal-trade-top-pnl');
    if (topPnl) { topPnl.textContent = pnlTxt; topPnl.className = 'journal-trade-top-pnl ' + pnlClass; }
    var topRes = card.querySelector('.journal-flip-front .journal-trade-result');
    if (topRes) { topRes.textContent = resultLabel; topRes.className = 'journal-trade-result ' + resultClass; }
    var frontPnl = card.querySelector('.journal-flip-front .journal-trade-pnl');
    if (frontPnl) { frontPnl.textContent = pnlTxt; frontPnl.className = 'journal-trade-pnl ' + pnlClass; }
  }

  if (editor) {
    var editorPnl = editor.querySelector('.jedit-metric-pnl strong');
    if (editorPnl) { editorPnl.textContent = pnlTxt; editorPnl.className = pnlClass; }
    var editorRr = editor.querySelector('.jedit-metric-rr strong');
    if (editorRr) editorRr.textContent = rrTxt;
    var editorResult = editor.querySelector('.jedit-metric-result strong');
    if (editorResult) { editorResult.textContent = resultLabel; editorResult.className = resultClass; }
  }
}

// ---- Full card DOM refresh + state sync after save ----

function _journalCardRefreshFull(tid, trade) {
  var tidStr = String(tid);
  var card = document.querySelector('.journal-flip-card[data-trade-id="' + tidStr + '"]');
  var day = _journalDayTradeDays[tidStr];
  if (!card || !day) return;

  // Preserve flip state
  var isFlipped = card.classList.contains('is-flipped');

  // Find card index within grid
  var grid = card.closest('.journal-day-trades-grid');
  var idx = 1;
  if (grid) {
    var allCards = grid.querySelectorAll('.journal-flip-card');
    for (var i = 0; i < allCards.length; i++) {
      if (allCards[i] === card) { idx = i + 1; break; }
    }
  }

  var newHtml = journalTradeFlipCardHtml(day, trade, idx, {});
  var temp = document.createElement('div');
  temp.innerHTML = newHtml;
  var newCard = temp.firstElementChild;
  if (isFlipped) newCard.classList.add('is-flipped');
  card.parentNode.replaceChild(newCard, card);
}

// Debounced state refresh for calendar, stats, filters
function _journalRefreshStateDebounced() {
  clearTimeout(_journalRefreshTimer);
  _journalRefreshTimer = setTimeout(function () {
    if (typeof loadMonth === 'function') loadMonth();
    if (typeof loadStats === 'function') loadStats({ refreshDays: false, skipRender: false });
  }, 400);
}

// Lightweight state sync after editor save - updates state.days in place
function _journalSyncStateAfterSave(tid, updated) {
  if (!state || !state.days) return;
  var targetId = Number(tid);
  state.days.forEach(function (day) {
    if (day.trades) {
      day.trades.forEach(function (trade, i) {
        if (Number(trade.id) === targetId) {
          day.trades[i] = updated;
        }
      });
    }
  });
}

function _journalCardScheduleSave(tid) {
  var tidStr = String(tid);
  clearTimeout(_journalCardSaveTimers[tidStr]);
  _journalCardSaveTimers[tidStr] = setTimeout(function () {
    _journalCardSave(tidStr);
  }, 700);
}

// ---- card-style editor drawer ----

function _journalEditorSetStatus(editor, state, text) {
  // Use the save button text to show status (avoids layout shift + overflow)
  var saveBtn = editor && editor.querySelector('.jedit-save');
  if (!saveBtn) return;
  if (state === 'saving') {
    saveBtn.textContent = text || 'Sauvegarde...';
    saveBtn.disabled = true;
  } else if (state === 'saved') {
    saveBtn.textContent = text || 'Sauvegarde';
    setTimeout(function () { saveBtn.textContent = 'Sauver'; saveBtn.disabled = false; }, 2200);
  } else if (state === 'error') {
    saveBtn.textContent = text && text.length > 20 ? text.slice(0, 18) + '…' : (text || 'Erreur');
    setTimeout(function () { saveBtn.textContent = 'Sauver'; saveBtn.disabled = false; }, 4000);
  } else {
    saveBtn.textContent = 'Sauver';
    saveBtn.disabled = false;
  }
}

function _journalEditorCollectPayload(tid) {
  var tidStr = String(tid);
  var editor = document.querySelector('.journal-trade-editor[data-trade-id="' + tidStr + '"]');
  var trade = _journalDayTradeCache[tidStr];
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
}

// ---- Live recalc PnL/RR/is_win for editor before save ----

function _journalEditorRecalcMetrics(collected, originalTrade) {
  var entry = collected.entry_price != null ? Number(collected.entry_price) : null;
  var exit_ = collected.exit_price != null ? Number(collected.exit_price) : null;
  var stop = collected.stop_loss != null ? Number(collected.stop_loss) : null;
  var target = collected.take_profit != null ? Number(collected.take_profit) : null;
  var qtyRaw = collected.position_size != null ? Number(collected.position_size) : null;
  var qty = qtyRaw && qtyRaw > 0 ? qtyRaw : 1;
  var dir = (collected.direction || '').toLowerCase();
  if (!dir && entry != null && stop != null && stop !== entry) {
    dir = stop < entry ? 'long' : 'short';
  }

  // Recalc RR if entry + stop + target available
  if (entry != null && stop != null && target != null && stop !== entry) {
    collected.rr = Number((Math.abs(target - entry) / Math.abs(entry - stop)).toFixed(4));
  }

  // Recalc PnL from exit if pnl was not explicitly changed by user
  var pnlExplicit = collected.hasOwnProperty('pnl') && collected.pnl !== (originalTrade && originalTrade.pnl);
  if (!pnlExplicit && dir && entry != null && exit_ != null) {
    collected.pnl = dir === 'long' ? (exit_ - entry) * qty : (entry - exit_) * qty;
  }

  // Infer is_win from pnl if not explicit
  if (collected.is_win == null || collected.is_win === '') {
    var pnlNum = collected.pnl != null ? Number(collected.pnl) : null;
    if (pnlNum != null) {
      collected.is_win = pnlNum > 0 ? '1' : pnlNum < 0 ? '0' : '';
    }
  }
}

// ---- Live editor UI refresh after save ----

function _journalEditorRefreshUI(editor, trade) {
  if (!editor || !trade) return;

  // Update strategy title
  var title = editor.querySelector('.jedit-hero-copy h3');
  if (title) title.textContent = trade.strategy ? prettify(trade.strategy) : 'Strategie inconnue';

  // Update direction badge in topline
  var topline = editor.querySelector('.jedit-topline');
  if (topline) {
    var badges = topline.querySelectorAll('span');
    var dir = (trade.direction || '-').toUpperCase();
    if (badges.length >= 3) badges[2].textContent = dir;
  }

  // Update scenario/why text
  var summary = editor.querySelector('.jedit-hero-copy p');
  if (summary) summary.textContent = journalShortText(trade.why_trade, trade.scenario, trade.why_entry);
}

function _journalEditorSave(tid) {
  var tidStr = String(tid);
  var payload = _journalEditorCollectPayload(tidStr);
  var editor = document.querySelector('.journal-trade-editor[data-trade-id="' + tidStr + '"]');
  if (!payload || !editor) return;
  // Recalc PnL/RR/is_win from levels before sending
  _journalEditorRecalcMetrics(payload, _journalDayTradeCache[tidStr]);

  _journalEditorSetStatus(editor, 'saving', 'Sauvegarde...');

  api('/api/trades/' + tidStr, { method: 'PUT', body: JSON.stringify(payload) })
    .then(function (res) {
      var updated = (res && res.trade) ? res.trade : res;
      updated = updated && updated.id ? updated : payload;
      _journalDayTradeCache[tidStr] = updated;
      _journalCardRefreshMetrics(tidStr, updated);
      _journalEditorRefreshUI(editor, updated);
      _journalSyncStateAfterSave(tidStr, updated);
      _journalEditorSetStatus(editor, 'saved', 'Sauvegarde');
    })
    .catch(function (err) {
      _journalEditorSetStatus(editor, 'error', (err && err.message) ? err.message : 'Erreur');
    });
}

function _journalEditorScheduleSave(tid) {
  var tidStr = String(tid);
  clearTimeout(_journalEditorSaveTimers[tidStr]);
  _journalEditorSaveTimers[tidStr] = setTimeout(function () {
    _journalEditorSave(tidStr);
  }, 650);
}

function openJournalTradeEditor(tid) {
  var tidStr = String(tid);
  var wrap = $("#journalDayTrades");
  var trade = _journalDayTradeCache[tidStr];
  var day = _journalDayTradeDays[tidStr];
  if (!wrap || !trade || !day) return;

  closeJournalTradeEditor({ immediate: true });
  _journalEditorActiveTradeId = tidStr;
  wrap.classList.add('is-editing');
  wrap.insertAdjacentHTML('beforeend', journalTradeEditorHtml(day, trade));

  var editor = wrap.querySelector('.journal-trade-editor[data-trade-id="' + tidStr + '"]');
  if (!editor) return;
  requestAnimationFrame(function () { editor.classList.add('is-visible'); });
  setTimeout(function () {
    var focusTarget = editor.querySelector('.jedit-field, .jedit-pill, .jedit-close');
    if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus({ preventScroll: true });
  }, 80);
}

function _flushPendingJournalSaves() {
  // Execute pending editor saves immediately instead of dropping them
  Object.keys(_journalEditorSaveTimers).forEach(function (tid) {
    clearTimeout(_journalEditorSaveTimers[tid]);
    _journalEditorSave(tid);
  });
  _journalEditorSaveTimers = {};

  // Execute pending card saves immediately
  Object.keys(_journalCardSaveTimers).forEach(function (tid) {
    clearTimeout(_journalCardSaveTimers[tid]);
    _journalCardSave(tid);
  });
  _journalCardSaveTimers = {};
}

function closeJournalTradeEditor(opts) {
  var wrap = $("#journalDayTrades");
  var editor = wrap && wrap.querySelector('.journal-trade-editor');
  if (!wrap || !editor) return;
  // Refresh the edited card before closing
  var closingTid = _journalEditorActiveTradeId;
  _flushPendingJournalSaves();
  _journalEditorActiveTradeId = null;
  wrap.classList.remove('is-editing');

  if (opts && opts.immediate) {
    editor.remove();
    return;
  }
  editor.classList.remove('is-visible');
  setTimeout(function () {
    if (editor.parentNode) editor.remove();
    // Refresh card after editor animation completes
    if (closingTid) _journalCardRefreshFull(closingTid, _journalDayTradeCache[String(closingTid)]);
  }, 180);
}

// ---- bind ----

function bindJournalDayTrades() {
  var wrap = $("#journalDayTrades");
  if (!wrap || _journalDayTradeCardsBound) return;

  wrap.addEventListener("click", function (e) {
    var editorClose = e.target.closest("[data-journal-editor-close]");
    if (editorClose) {
      e.stopPropagation();
      closeJournalTradeEditor();
      return;
    }

    var editorSave = e.target.closest("[data-journal-editor-save]");
    if (editorSave) {
      e.stopPropagation();
      var saveTid = editorSave.dataset.journalEditorSave || _journalEditorActiveTradeId;
      if (saveTid) _journalEditorSave(saveTid);
      return;
    }

    // Close button
    var closeBtn = e.target.closest("[data-journal-day-close]");
    if (closeBtn) { closeJournalDayTrades(); return; }

    // Edit button → open full modal
    var editBtn = e.target.closest("[data-journal-trade-edit]");
    // Fallback: match by class if data attribute lookup fails (3D transform hit-test edge case)
    if (!editBtn && e.target.tagName === 'BUTTON' && e.target.classList.contains('journal-back-edit')) {
      editBtn = e.target;
    }
    if (editBtn) {
      e.stopPropagation();
      try {
        var tid = editBtn.dataset.journalTradeEdit;
        openJournalTradeEditor(tid);
      } catch (_e) {
        console.error("[cockpit] Erreur ouverture editeur:", _e);
      }
      return;
    }

    var editorPill = e.target.closest('.jedit-pill');
    if (editorPill) {
      e.stopPropagation();
      var editorGroup = editorPill.closest('.jedit-pills');
      if (editorGroup) {
        editorGroup.querySelectorAll('.jedit-pill').forEach(function (p) { p.classList.remove('is-active'); });
        editorPill.classList.add('is-active');
        var editor = editorPill.closest('.journal-trade-editor');
        var editorTid = editor && editor.dataset.tradeId;
        if (editorTid) _journalEditorScheduleSave(editorTid);
      }
      return;
    }

    var editorStar = e.target.closest('.jedit-star');
    if (editorStar) {
      e.stopPropagation();
      var editorStars = editorStar.closest('.jedit-stars');
      if (editorStars) {
        var editorVal = Number(editorStar.dataset.val);
        if (String(editorStars.dataset.value) === String(editorVal)) editorVal = 0;
        editorStars.dataset.value = String(editorVal);
        editorStars.querySelectorAll('.jedit-star').forEach(function (s) {
          s.classList.toggle('is-lit', Number(s.dataset.val) <= editorVal);
        });
        var editor2 = editorStars.closest('.journal-trade-editor');
        var editorTid2 = editor2 && editor2.dataset.tradeId;
        if (editorTid2) _journalEditorScheduleSave(editorTid2);
      }
      return;
    }

    // Pill toggle (thesis, etc.)
    var pill = e.target.closest('.jcard-pill');
    if (pill) {
      e.stopPropagation();
      var group = pill.closest('.jcard-pills');
      if (group) {
        group.querySelectorAll('.jcard-pill').forEach(function (p) { p.classList.remove('is-active'); });
        pill.classList.add('is-active');
        var scroll = pill.closest('.journal-flip-back-scroll');
        var tid2 = scroll && scroll.dataset.tradeId;
        if (tid2) _journalCardScheduleSave(tid2);
      }
      return;
    }

    // Star rating
    var star = e.target.closest('.jcard-star');
    if (star) {
      e.stopPropagation();
      var starsWrap = star.closest('.jcard-stars');
      if (starsWrap) {
        var val = Number(star.dataset.val);
        // Click same value again → clear
        if (String(starsWrap.dataset.value) === String(val)) val = 0;
        starsWrap.dataset.value = String(val);
        starsWrap.querySelectorAll('.jcard-star').forEach(function (s) {
          s.classList.toggle('is-lit', Number(s.dataset.val) <= val);
        });
        var scroll2 = starsWrap.closest('.journal-flip-back-scroll');
        var tid3 = scroll2 && scroll2.dataset.tradeId;
        if (tid3) _journalCardScheduleSave(tid3);
      }
      return;
    }

    // Back-face icon buttons — don't flip
    if (e.target.closest(".journal-back-icon")) { e.stopPropagation(); return; }

    if (e.target.closest(".journal-trade-editor")) { e.stopPropagation(); return; }

    // Don't flip when clicking editable elements
    if (e.target.closest('input, textarea, select, .jcard-pills, .jcard-stars')) return;

    var card = e.target.closest(".journal-flip-card");
    if (!card || !wrap.contains(card)) return;
    card.classList.toggle("is-flipped");
  });

  // Save on blur for inputs / textareas
  wrap.addEventListener("focusout", function (e) {
    var field = e.target.closest('.jcard-field');
    if (field) {
      var scroll = field.closest('.journal-flip-back-scroll');
      var tid = scroll && scroll.dataset.tradeId;
      if (tid) _journalCardScheduleSave(tid);
      return;
    }

    var editorField = e.target.closest('.jedit-field');
    if (editorField) {
      var editor = editorField.closest('.journal-trade-editor');
      var editorTid = editor && editor.dataset.tradeId;
      if (editorTid) _journalEditorScheduleSave(editorTid);
    }
  });

  wrap.addEventListener("change", function (e) {
    var editorField = e.target.closest('.jedit-field');
    if (!editorField) return;
    var editor = editorField.closest('.journal-trade-editor');
    var editorTid = editor && editor.dataset.tradeId;
    if (editorTid) _journalEditorScheduleSave(editorTid);
  });

  wrap.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && _journalEditorActiveTradeId) {
      e.preventDefault();
      closeJournalTradeEditor();
      return;
    }
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.matches('input, textarea, select, button')) return;
    if (e.target.closest(".journal-trade-editor")) return;
    var card = e.target.closest(".journal-flip-card");
    if (!card || !wrap.contains(card)) return;
    e.preventDefault();
    card.classList.toggle("is-flipped");
  });

  _journalDayTradeCardsBound = true;

  // Close on click outside — registered once globally
  if (!window._journalCloseBound) {
    window._journalCloseBound = true;
    document.addEventListener("click", function _closeOnOutside(e) {
      var w = $("#journalDayTrades");
      if (!w || w.classList.contains("hidden")) return;
      // Ne pas fermer si le clic va ouvrir une card (case calendrier, ligne tableau, bouton editer)
      if (e.target.closest(".day, #journalTradesTbody, [data-journal-trade-edit]")) return;
      if (!w.contains(e.target)) {
        closeJournalDayTrades();
      }
    });
  }
}

// ---- render / close ----
function renderJournalDayTrades(dateKey, days) {
  var wrap = $("#journalDayTrades");
  if (!wrap) return;
  bindJournalDayTrades();

  var items = collectJournalDayTrades(days);
  if (!items.length) { closeJournalDayTrades(); return; }

  _journalDayTradeCache = {};
  _journalDayTradeDays  = {};
  items.forEach(function (item) {
    var id = String(item.trade.id);
    _journalDayTradeCache[id] = item.trade;
    _journalDayTradeDays[id]  = item.day;
  });

  var summary   = summarizeJournalDayTrades(items);
  var decided   = summary.wins + summary.losses;
  var wr        = decided ? Math.round(summary.wins / decided * 100) + "%" : "-";
  var instruments = Object.keys(summary.instruments).join(" / ");

  wrap.classList.remove("hidden");
  wrap.dataset.count = String(Math.min(items.length, 3));
  wrap.innerHTML = `
    <div class="journal-day-trades-grid">
      ${items.map(function (item, idx) {
        return journalTradeFlipCardHtml(item.day, item.trade, idx + 1, { dateKey: dateKey, wr: wr });
      }).join("")}
    </div>
  `;

  var firstCard = wrap.querySelector(".journal-flip-card");
  if (firstCard) firstCard.focus({ preventScroll: true });
}

function closeJournalDayTrades() {
  var wrap = $("#journalDayTrades");
  if (!wrap) return;
  // Flush any pending saves before destroying
  _flushPendingJournalSaves();
  _journalEditorActiveTradeId = null;
  wrap.classList.add("hidden");
  wrap.classList.remove("is-editing");
  delete wrap.dataset.count;
  wrap.innerHTML = "";
  _journalDayTradeCache = {};
  _journalDayTradeDays  = {};
}

// ---- helpers ----

function journalShortText() {
  for (var i = 0; i < arguments.length; i += 1) {
    var v = String(arguments[i] || "").trim();
    if (v) return v.length > 150 ? v.slice(0, 147) + "..." : v;
  }
  return "Aucun resume renseigne pour ce trade.";
}

function journalFmtPrice(v) {
  if (v == null || v === "") return "-";
  var n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "-";
}

function journalValueAttr(v) {
  return v == null ? "" : escapeHtml(String(v));
}

function journalTagsValue(tags) {
  return Array.isArray(tags) ? tags.join(", ") : "";
}

function journalSelectOption(value, label, current) {
  return '<option value="' + escapeHtml(value) + '"' + (String(current || '') === String(value) ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
}

function journalEditorField(label, field, value, type, opts) {
  var o = opts || {};
  var inputType = type === 'number' || type === 'int' ? 'number' : 'text';
  var step = o.step ? ' step="' + escapeHtml(o.step) + '"' : '';
  var placeholder = o.placeholder ? ' placeholder="' + escapeHtml(o.placeholder) + '"' : '';
  var dataType = type ? ' data-type="' + escapeHtml(type) + '"' : '';
  return '<label class="jedit-field-wrap"><span>' + escapeHtml(label) + '</span><input class="jedit-field" type="' + inputType + '"' + step + dataType + ' data-field="' + escapeHtml(field) + '" value="' + journalValueAttr(value) + '"' + placeholder + ' /></label>';
}

function journalEditorTextarea(label, field, value, rows) {
  return '<label class="jedit-field-wrap jedit-text-wrap"><span>' + escapeHtml(label) + '</span><textarea class="jedit-field" data-field="' + escapeHtml(field) + '" rows="' + (rows || 3) + '">' + escapeHtml(String(value || '')) + '</textarea></label>';
}

function journalEditorPills(field, current, choices) {
  return '<div class="jedit-pills" data-field="' + escapeHtml(field) + '">' + choices.map(function (choice) {
    var active = String(current || '') === String(choice.value || '');
    return '<button type="button" class="jedit-pill' + (active ? ' is-active' : '') + '" data-value="' + escapeHtml(choice.value || '') + '">' + escapeHtml(choice.label) + '</button>';
  }).join('') + '</div>';
}

function journalEditorStrategyOptions(current) {
  var values = [];
  (DEFAULT_STRATEGY_VALUES || []).forEach(function (value) { if (values.indexOf(value) === -1) values.push(value); });
  ((state && state.settings && state.settings.custom_strategies) || []).forEach(function (s) {
    if (s && s.value && values.indexOf(s.value) === -1) values.push(s.value);
  });
  if (current && values.indexOf(current) === -1) values.push(current);
  return values.map(function (value) { return journalSelectOption(value, prettify(value), current); }).join('');
}

function journalTradeEditorHtml(day, trade) {
  var m = deriveTradeMetrics(trade);
  var pnl = Number(m.pnl || 0);
  var pnlClass = pnl > 0 ? "pos" : pnl < 0 ? "neg" : "flat";
  var resultClass = m.isWin === 1 ? "win" : m.isWin === 0 ? "loss" : "neutral";
  var resultLabel = m.isWin === 1 ? "WIN" : m.isWin === 0 ? "LOSS" : "-";
  var direction = (m.direction || trade.direction || "").toLowerCase();
  var rr = m.rr == null ? "-" : Number(m.rr).toFixed(2) + "R";
  var strategy = trade.strategy ? prettify(trade.strategy) : "Strategie inconnue";
  var dateLabel = prettyDateKey(day.date);
  var shot = (trade.screenshots || [])[0];
  var shotStyle = shot ? " style=\"background-image:url('/screenshots/" + escapeHtml(shot.filename) + "')\"" : "";
  var shotClass = shot ? "has-shot" : "is-empty";
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

  return `
    <aside class="journal-trade-editor" data-trade-id="${tid}" role="dialog" aria-label="Edition du trade">
      <div class="jedit-panel">
        <div class="jedit-hero">
          <div class="jedit-hero-shot ${shotClass}"${shotStyle}>${shot ? "" : "<span>Aucune capture</span>"}</div>
          <div class="jedit-hero-copy">
            <div class="jedit-topline">
              <span>${escapeHtml(dateLabel)}</span>
              <span>${escapeHtml(day.instrument || "-")}</span>
              <span>${escapeHtml((direction || "-").toUpperCase())}</span>
            </div>
            <h3>${escapeHtml(strategy)}</h3>
            <p>${escapeHtml(journalShortText(trade.why_trade, trade.scenario, trade.why_entry))}</p>
            <div class="jedit-metrics">
              <div class="jedit-metric-pnl"><strong class="${pnlClass}">${fmtMoney(pnl)}</strong><span>PnL</span></div>
              <div class="jedit-metric-rr"><strong>${escapeHtml(rr)}</strong><span>R multiple</span></div>
              <div class="jedit-metric-result"><strong class="${resultClass}">${escapeHtml(resultLabel)}</strong><span>Resultat</span></div>
            </div>
          </div>
          <div class="jedit-actions">
            <span class="jedit-status" data-state=""></span>
            <button type="button" class="jedit-save" data-journal-editor-save="${tid}">Sauver</button>
            <button type="button" class="jedit-close" data-journal-editor-close aria-label="Fermer">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        <div class="jedit-scroll">
          <section class="jedit-block jedit-identity">
            <div class="jedit-block-title"><span>01</span><h4>Setup</h4></div>
            <div class="jedit-grid">
              <label class="jedit-field-wrap"><span>Strategie</span><select class="jedit-field" data-field="strategy">${journalEditorStrategyOptions(trade.strategy || '')}</select></label>
              <label class="jedit-field-wrap"><span>Direction</span>${journalEditorPills('direction', direction, [{ value: 'long', label: 'Long' }, { value: 'short', label: 'Short' }, { value: '', label: '?' }])}</label>
              ${journalEditorField('Stdv', 'stdv_level', trade.stdv_level, 'number', { step: '0.5', placeholder: '1 - 5' })}
              <label class="jedit-field-wrap"><span>Resultat</span><select class="jedit-field" data-field="is_win" data-type="bool">${journalSelectOption('', 'A qualifier', winValue)}${journalSelectOption('1', 'Win', winValue)}${journalSelectOption('0', 'Loss', winValue)}</select></label>
            </div>
          </section>

          <section class="jedit-block">
            <div class="jedit-block-title"><span>02</span><h4>Niveaux</h4></div>
            <div class="jedit-grid jedit-grid-5">
              ${journalEditorField('Entree', 'entry_price', trade.entry_price, 'number', { step: '0.01' })}
              ${journalEditorField('Stop', 'stop_loss', trade.stop_loss, 'number', { step: '0.01' })}
              ${journalEditorField('Target', 'take_profit', trade.take_profit, 'number', { step: '0.01' })}
              ${journalEditorField('Sortie', 'exit_price', trade.exit_price, 'number', { step: '0.01' })}
              ${journalEditorField('Size', 'position_size', trade.position_size, 'number', { step: '0.01' })}
              ${journalEditorField('PnL', 'pnl', trade.pnl, 'number', { step: '0.01' })}
              ${journalEditorField('RR', 'rr', trade.rr, 'number', { step: '0.01' })}
            </div>
          </section>

          <section class="jedit-block">
            <div class="jedit-block-title"><span>03</span><h4>Scenario</h4></div>
            <div class="jedit-notes">
              ${journalEditorTextarea('Pourquoi ce trade', 'why_trade', trade.why_trade, 3)}
              ${journalEditorTextarea('Pourquoi cette entree', 'why_entry', trade.why_entry, 3)}
              ${journalEditorTextarea('Scenario complet', 'scenario', trade.scenario, 4)}
              ${journalEditorTextarea('Pourquoi ce stop', 'why_stop', trade.why_stop, 3)}
              ${journalEditorTextarea('Pourquoi ce TP', 'why_tp', trade.why_tp, 3)}
            </div>
          </section>

          <section class="jedit-block">
            <div class="jedit-block-title"><span>04</span><h4>Review</h4></div>
            <div class="jedit-grid">
              <label class="jedit-field-wrap"><span>These validee</span>${journalEditorPills('thesis_validated', trade.thesis_validated || '', [{ value: 'yes', label: 'Oui' }, { value: 'no', label: 'Non' }, { value: '', label: '?' }])}</label>
              <label class="jedit-field-wrap"><span>Qualite execution</span><div class="jedit-stars" data-field="execution_quality" data-value="${qualityRaw}">${starsHtml}</div></label>
              ${journalEditorField('Tags', 'tags', journalTagsValue(trade.tags), 'tags', { placeholder: 'tag1, tag2' })}
              ${journalEditorTextarea('Lecons apprises', 'lessons_learned', trade.lessons_learned, 4)}
            </div>
          </section>

          <section class="jedit-block">
            <div class="jedit-block-title"><span>05</span><h4>Plan & captures</h4></div>
            <div class="jedit-plan-grid">
              <div><span>Plan model</span><strong>${escapeHtml(trade.plan_model || "-")}</strong></div>
              <div><span>Direction plan</span><strong>${escapeHtml(trade.plan_direction || "-")}</strong></div>
              <div><span>Alignement</span><strong>${escapeHtml(trade.plan_alignment || "unknown")}</strong></div>
              <div><span>Score</span><strong>${trade.plan_score == null ? "-" : escapeHtml(String(trade.plan_score))}</strong></div>
            </div>
            ${journalEditorTextarea('Raison override plan', 'plan_override_reason', trade.plan_override_reason, 3)}
            <div class="jedit-shots">${screenshotsHtml}</div>
          </section>
        </div>
      </div>
    </aside>
  `;
}

// ---- flip card HTML ----

function journalTradeFlipCardHtml(day, trade, idx, deck) {
  var m           = deriveTradeMetrics(trade);
  var pnl         = Number(m.pnl || 0);
  var pnlClass    = pnl > 0 ? "pos" : pnl < 0 ? "neg" : "flat";
  var resultClass = m.isWin === 1 ? "win" : m.isWin === 0 ? "loss" : "neutral";
  var resultLabel = m.isWin === 1 ? "WIN" : m.isWin === 0 ? "LOSS" : "-";
  var direction   = (m.direction || trade.direction || "-").toUpperCase();
  var strategy    = trade.strategy ? prettify(trade.strategy) : "Strategie inconnue";
  var rr          = m.rr == null ? "-" : Number(m.rr).toFixed(2) + "R";
  var thesisLabel = trade.thesis_validated === "yes" ? "These validee"
                  : trade.thesis_validated === "no"  ? "These rejetee"
                  : "These a qualifier";
  var thesisVal   = trade.thesis_validated || "";
  var summary     = journalShortText(trade.why_trade, trade.scenario, trade.why_entry);
  var lessonsRaw  = String(trade.lessons_learned || "");
  var qualityRaw  = Number(trade.execution_quality) || 0;
  var dateLabel   = prettyDateKey((deck && deck.dateKey) || day.date);
  var htf         = journalShortText(day.htf_context, day.daily_notes, trade.scenario);
  var shot        = (trade.screenshots || [])[0];
  var shotStyle   = shot ? " style=\"background-image:url('/screenshots/" + escapeHtml(shot.filename) + "')\"" : "";
  var shotClass   = shot ? "has-shot" : "is-empty";
  var tid         = escapeHtml(String(trade.id));

  var starsHtml = [1, 2, 3, 4, 5].map(function (i) {
    return '<button type="button" class="jcard-star' + (qualityRaw >= i ? ' is-lit' : '') + '" data-val="' + i + '">★</button>';
  }).join('');

  return `
    <article class="journal-flip-card" tabindex="0" data-trade-id="${tid}">
      <div class="journal-flip-card-inner">

        <!-- ── FRONT ── -->
        <div class="journal-flip-face journal-flip-front">
          <div class="journal-flip-top">
            <span class="journal-trade-index">#${idx}</span>
            <span class="journal-trade-instrument">${escapeHtml(day.instrument || "-")}</span>
            <span class="journal-trade-top-pnl ${pnlClass}">${fmtMoney(pnl)}</span>
            <span class="journal-trade-result ${resultClass}">${resultLabel}</span>
            <button type="button" class="journal-card-close" data-journal-day-close aria-label="Fermer">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="journal-trade-shot ${shotClass}"${shotStyle}>
            ${shot ? "" : "<span>Aucune capture</span>"}
          </div>
          <div class="journal-trade-content">
            <div class="journal-trade-main">
              <div>
                <h4>${escapeHtml(strategy)}</h4>
                <p>${escapeHtml(summary)}</p>
              </div>
              <strong class="journal-trade-pnl ${pnlClass}">${fmtMoney(pnl)}</strong>
            </div>
            <div class="journal-trade-strip">
              <span>${escapeHtml(direction)}</span>
              <span>${escapeHtml(rr)}</span>
              <span>${escapeHtml(thesisLabel)}</span>
            </div>
            <div class="journal-trade-card-actions">
              <span>${escapeHtml(resultLabel)}</span>
              <button type="button">Voir details</button>
            </div>
          </div>
        </div>

        <!-- ── BACK ── -->
        <div class="journal-flip-face journal-flip-back">
          <div class="journal-flip-back-scroll" data-trade-id="${tid}">

            <div class="journal-back-actions">
              <button type="button" class="journal-back-icon" aria-label="Trade marque">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>
              </button>
              <button type="button" class="journal-back-icon" aria-label="Partager">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.7 15.4 6.3"/><path d="M8.6 13.3l6.8 4.4"/></svg>
              </button>
              <span class="jcard-save-ind" data-state=""></span>
              <button type="button" class="journal-back-edit" data-journal-trade-edit="${tid}">Editer</button>
            </div>

            <h4>${escapeHtml(strategy)}</h4>
            <p class="journal-back-sub">${escapeHtml(dateLabel)} · ${escapeHtml(day.instrument || "-")} · ${escapeHtml(direction)}</p>
            <p class="journal-back-summary">${escapeHtml(summary)}</p>

            <div class="journal-back-stats">
              <div><strong>${escapeHtml(direction)}</strong><span>Direction</span></div>
              <div><strong class="jcard-rr-display">${escapeHtml(rr)}</strong><span>R multiple</span></div>
              <div><strong class="jcard-pnl-display ${pnlClass}">${fmtMoney(pnl)}</strong><span>PnL</span></div>
            </div>

            <h5>Niveaux</h5>
            <div class="journal-trade-detail-grid">
              <div>
                <span>Entree</span>
                <input class="jcard-field" type="number" step="0.01" data-field="entry_price"
                  value="${trade.entry_price != null ? escapeHtml(String(trade.entry_price)) : ''}" placeholder="—"/>
              </div>
              <div>
                <span>Sortie</span>
                <input class="jcard-field" type="number" step="0.01" data-field="exit_price"
                  value="${trade.exit_price != null ? escapeHtml(String(trade.exit_price)) : ''}" placeholder="—"/>
              </div>
              <div>
                <span>Stop</span>
                <input class="jcard-field" type="number" step="0.01" data-field="stop_loss"
                  value="${trade.stop_loss != null ? escapeHtml(String(trade.stop_loss)) : ''}" placeholder="—"/>
              </div>
              <div>
                <span>Target</span>
                <input class="jcard-field" type="number" step="0.01" data-field="take_profit"
                  value="${trade.take_profit != null ? escapeHtml(String(trade.take_profit)) : ''}" placeholder="—"/>
              </div>
            </div>

            <h5>Execution</h5>
            <div class="journal-trade-detail-grid jcard-exec-grid">
              <div>
                <span>Position</span>
                <input class="jcard-field" type="number" step="0.01" data-field="position_size"
                  value="${trade.position_size != null ? escapeHtml(String(trade.position_size)) : ''}" placeholder="—"/>
              </div>
              <div>
                <span>Qualite</span>
                <div class="jcard-stars" data-field="execution_quality" data-value="${qualityRaw}">${starsHtml}</div>
              </div>
              <div class="jcard-thesis-cell">
                <span>These</span>
                <div class="jcard-pills" data-field="thesis_validated">
                  <button type="button" class="jcard-pill${thesisVal === 'yes' ? ' is-active' : ''}" data-value="yes">Oui</button>
                  <button type="button" class="jcard-pill${thesisVal === 'no'  ? ' is-active' : ''}" data-value="no">Non</button>
                  <button type="button" class="jcard-pill${thesisVal !== 'yes' && thesisVal !== 'no' ? ' is-active' : ''}" data-value="">?</button>
                </div>
              </div>
              <div>
                <span>Resultat</span>
                <strong class="jcard-result-display ${resultClass}">${escapeHtml(resultLabel)}</strong>
              </div>
            </div>

            <h5>Contexte</h5>
            <div class="journal-trade-back-note">
              <span>HTF / plan</span>
              <p>${escapeHtml(htf)}</p>
            </div>
            <div class="journal-trade-back-note">
              <span>Review</span>
              <textarea class="jcard-field jcard-textarea" data-field="lessons_learned"
                rows="3" placeholder="Lecons apprises…">${escapeHtml(lessonsRaw)}</textarea>
            </div>

          </div>
        </div>

      </div>
    </article>
  `;
}
