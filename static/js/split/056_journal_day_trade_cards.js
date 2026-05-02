function journalTradeEditorHtml(day, trade) { return TradeEditorController.renderHtml(day, trade); }

// ---------- Journal inline day trades ----------

var _journalDayTradeCardsBound = false;
var _journalDayTradeCache = {};
var _journalDayTradeDays = {};
var _journalCardSaveTimers = {};
var _journalRefreshTimer = null;
var _jcardFieldFocused = false;

// ---- Intercepteur anti re-fired click (enregistre avant tout) ----
(function() {
  if (window._intRegistered) return;
  window._intRegistered = true;
  window.addEventListener('click', function interceptor(e) {
    var wrap = document.getElementById('journalDayTrades');
    if (!wrap || !wrap.classList.contains('is-editing')) return;
    var inPanel = e.target.closest('.jedit-panel');
    if (inPanel) return;
    if (!wrap.contains(e.target)) return;
    closeJournalTradeEditor();
    window._consumeClick = true;
    setTimeout(function() { window._consumeClick = false; }, 0);
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);
})();

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
      _journalSyncStateAfterSave(tidStr, updated);
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
  _journalCardSave(tid);
}

// ---- card-style editor drawer ----

// ---- Live recalc PnL/RR/is_win for editor before save ----

// ---- Live editor UI refresh after save ----

// ---- Inline warnings in editor sections ----

function openJournalTradeEditor(tid) {
  TradeEditorController.open(tid);
}

// Save a trade immediately via TradeEditorController
function _journalEditorSave(tid) {
  TradeEditorController.save(String(tid));
}

function _flushPendingJournalSaves() {
  // Execute pending editor saves immediately instead of dropping them
  Object.keys(TradeEditorController.saveTimers).forEach(function (tid) {
    clearTimeout(TradeEditorController.saveTimers[tid]);
    _journalEditorSave(tid);
  });
  TradeEditorController.saveTimers = {};

  // Execute pending card saves immediately
  Object.keys(_journalCardSaveTimers).forEach(function (tid) {
    clearTimeout(_journalCardSaveTimers[tid]);
    _journalCardSave(tid);
  });
  _journalCardSaveTimers = {};
}

function closeJournalTradeEditor(opts) {
  TradeEditorController.close(opts);
}

function bindJournalDayTrades() {
  var wrap = $("#journalDayTrades");
  if (!wrap || _journalDayTradeCardsBound) return;

  wrap.addEventListener("click", function (e) {

    // 🛡️ Bouclier anti re-fired click du navigateur
    if (window._consumeClick) {
      window._consumeClick = false;
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }

    var editorClose = e.target.closest("[data-journal-editor-close]");
    if (editorClose) {
      e.stopPropagation();
      closeJournalTradeEditor();
      return;
    }

    var editorSave = e.target.closest("[data-journal-editor-save]");
    if (editorSave) {
      e.stopPropagation();
      var saveTid = editorSave.dataset.journalEditorSave || TradeEditorController.activeTradeId;
      if (saveTid) TradeEditorController.save(saveTid);
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
        if (editorTid) TradeEditorController.scheduleSave(editorTid);
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
        if (editorTid2) TradeEditorController.scheduleSave(editorTid2);
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

    // 🛡️ Si un champ jcard-field a (ou avait récemment) le focus
    // → l'utilisateur est en train d'éditer → ne pas flipper
    if (_jcardFieldFocused) {
      return;
    }

    // Don't flip when clicking editable elements
    if (e.target.closest('input, textarea, select, .jcard-pills, .jcard-stars')) return;

    // 🛡️ GUARD ULTIME : classe html-editor-open sur <html>.
    if (document.documentElement.classList.contains('html-editor-open')) {
      closeJournalTradeEditor();
      return;
    }

    // Si l'éditeur est ouvert → ferme-le, ne flip pas
    if (TradeEditorController.activeTradeId !== null) {
      closeJournalTradeEditor();
      return;
    }

    // Cooldown booléen fermeture editeur (1000ms)
    if (TradeEditorController.justClosed) return;

    // 🛡️ Grace period timestamp — ne dépend PAS d'un setTimeout
    if (Date.now() - TradeEditorController.closeTime < 1200) return;

    // 🛡️ Bouclier DOM : éditeur encore dans le DOM (invisible, pointer-events: none)
    if (document.querySelector('#journalDayTrades .journal-trade-editor')) return;

    var card = e.target.closest(".journal-flip-card");
    if (!card || !wrap.contains(card)) return;
    card.classList.toggle("is-flipped");
  });

  // ---- Track focus on jcard-field pour éviter le flip ----
  wrap.addEventListener("focusin", function (e) {
    if (e.target.closest('.jcard-field')) {
      _jcardFieldFocused = true;
    }
  });
  wrap.addEventListener("focusout", function (e) {
    if (e.target.closest('.jcard-field')) {
      // Le focus est perdu AVANT le click event. On diffère le flag
      // pour que le flip handler du click qui suit le voie encore.
      setTimeout(function () { _jcardFieldFocused = false; }, 300);
    }
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
      if (editorTid) TradeEditorController.scheduleSave(editorTid);
    }
  });

  wrap.addEventListener("change", function (e) {
    var editorField = e.target.closest('.jedit-field');
    if (!editorField) return;
    var editor = editorField.closest('.journal-trade-editor');
    var editorTid = editor && editor.dataset.tradeId;
    // Live preview: update strategy title on select change
    if (editorField.tagName === 'SELECT' && editorField.dataset.field === 'strategy') {
      var title = editor && editor.querySelector('.jedit-hero-copy h3');
      if (title) title.textContent = editorField.options[editorField.selectedIndex] ?
        editorField.options[editorField.selectedIndex].text : editorField.value;
    }
  });

  wrap.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && TradeEditorController.activeTradeId) {
      e.preventDefault();
      closeJournalTradeEditor();
      return;
    }
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.matches('input, textarea, select, button')) return;
    if (e.target.closest(".journal-trade-editor")) return;

    // 🛡️ Si un champ a le focus → ne pas flipper
    if (wrap.querySelector('.jcard-field:focus, .journal-flip-back-scroll:focus-within')) return;

    // 🛡️ GUARD ULTIME : classe html-editor-open
    if (document.documentElement.classList.contains('html-editor-open')) return;

    // Éditeur ouvert → pas de flip
    if (TradeEditorController.activeTradeId !== null) return;

    // 🛡️ Grace period timestamp
    if (Date.now() - TradeEditorController.closeTime < 1200) return;

    // 🛡️ Bouclier DOM re-fired click
    if (document.querySelector('#journalDayTrades .journal-trade-editor')) return;

    var card = e.target.closest(".journal-flip-card");
    if (!card || !wrap.contains(card)) return;
    e.preventDefault();
    card.classList.toggle("is-flipped");
  });

  // Auto-compute position_size from Marge + Levier + Entry (verso flip card uniquement)
  wrap.addEventListener("input", function (e) {
    var field = e.target.closest('.journal-flip-back-scroll .jcard-margin-input, .journal-flip-back-scroll .jcard-field[data-field="leverage"], .journal-flip-back-scroll .jcard-field[data-field="entry_price"]');
    if (!field) return;
    var scroll = field.closest('.journal-flip-back-scroll');
    if (!scroll) return;
    var tid = scroll.dataset.tradeId;
    if (!tid) return;

    var marginInput = scroll.querySelector('.jcard-margin-input');
    var levInput = scroll.querySelector('.jcard-field[data-field="leverage"]');
    var entryInput = scroll.querySelector('.jcard-field[data-field="entry_price"]');
    var posInput = scroll.querySelector('.jcard-field[data-field="position_size"]');
    if (!marginInput || !levInput || !entryInput || !posInput) return;

    if (field === marginInput || field.dataset.field === 'leverage') {
      var margin = Number(marginInput.value);
      var lev = Number(levInput.value);
      var entry = Number(entryInput.value);
      if (margin > 0 && lev > 0 && entry > 0) {
        var computed = computePositionSize(margin, lev, entry);
        if (computed != null) {
          posInput.value = String(computed);
          // Trigger save indicator
          _journalCardScheduleSave(tid);
        }
      }
    }

    // If user changed position_size, update margin display
    if (field === posInput) {
      var pos = Number(posInput.value);
      var lev2 = Number(levInput.value);
      var entry2 = Number(entryInput.value);
      if (pos > 0 && lev2 > 0 && entry2 > 0) {
        var computedMargin = computeMarginUsd(pos, lev2, entry2);
        if (computedMargin != null) marginInput.value = String(computedMargin);
      }
    }
  });

  // Screenshot upload on card back face
  wrap.addEventListener("click", function (e) {
    var shotEl = e.target.closest(".journal-back-shot");
    if (!shotEl) return;
    var input = shotEl.querySelector(".journal-shot-input");
    if (!input) return;
    input.click();
  });

  wrap.addEventListener("change", function (e) {
    var input = e.target.closest(".journal-shot-input");
    if (!input || !input.files || !input.files[0]) return;
    var file = input.files[0];
    var scroll = input.closest(".journal-flip-back-scroll");
    if (!scroll) return;
    var tid = scroll.dataset.tradeId;
    if (!tid) return;

    var fd = new FormData();
    fd.append("file", file);
    fetch("/api/trades/" + tid + "/screenshots", { method: "POST", body: fd })
      .then(function (r) {
        if (!r.ok) throw new Error("Upload echoue");
        return r.json();
      })
      .then(function () {
        // Recharge le trade pour mettre a jour la capture
        return api("/api/trades/" + tid);
      })
      .then(function (updated) {
        _journalDayTradeCache[String(tid)] = updated;
        _journalCardRefreshFull(String(tid), updated);
        _journalRefreshStateDebounced();
      })
      .catch(function (err) {
        toast(err.message || "Erreur upload screenshot", "error");
      });
    input.value = "";
  });

  _journalDayTradeCardsBound = true;

  // Close on click outside — registered once globally
  if (!window._journalCloseBound) {
    window._journalCloseBound = true;
    document.addEventListener("click", function _closeOnOutside(e) {
      var w = $("#journalDayTrades");
      if (!w || w.classList.contains("hidden")) return;
      // Ne pas fermer si le clic est sur une card, un input verso, le tableau, ou un bouton editer
      if (e.target.closest(".journal-flip-card, #journalDayTrades, .day, #journalTradesTbody, [data-journal-trade-edit]")) return;
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

  // Preserver l'etat des flips avant de detruire le DOM
  var flipped = {};
  wrap.querySelectorAll('.journal-flip-card.is-flipped').forEach(function (c) {
    var tid = c.dataset.tradeId;
    if (tid) flipped[tid] = true;
  });

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

  // Restaurer les flips preserves
  if (Object.keys(flipped).length) {
    Object.keys(flipped).forEach(function (tid) {
      var card = wrap.querySelector('.journal-flip-card[data-trade-id="' + tid + '"]');
      if (card) card.classList.add('is-flipped');
    });
  }

  var firstCard = wrap.querySelector(".journal-flip-card");
  if (firstCard) firstCard.focus({ preventScroll: true });
}

function closeJournalDayTrades() {
  var wrap = $("#journalDayTrades");
  if (!wrap) return;
  // Flush any pending saves before destroying
  _flushPendingJournalSaves();
  TradeEditorController.activeTradeId = null;
  document.documentElement.classList.remove('html-editor-open');
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

function journalEditorField(label, field, value, type, opts) { return TradeEditorController.field(label, field, value, type, opts); }

function journalEditorTextarea(label, field, value, rows) { return TradeEditorController.textarea(label, field, value, rows); }

function journalEditorPills(field, current, choices) { return TradeEditorController.pills(field, current, choices); }

function journalEditorStrategyOptions(current) { return TradeEditorController.strategyOptions(current); }

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
            <span class="metric-pill metric-pill--muted journal-trade-index">#${idx}</span>
            <span class="metric-pill metric-pill--cyan journal-trade-instrument">${escapeHtml(day.instrument || "-")}</span>
            <span class="metric-pill metric-pill--${pnlClass === 'pos' ? 'win' : pnlClass === 'neg' ? 'loss' : 'muted'} journal-trade-top-pnl ${pnlClass}">${fmtMoney(pnl)}</span>
            <span class="metric-pill metric-pill--${resultClass === 'win' ? 'win' : resultClass === 'loss' ? 'loss' : 'muted'} journal-trade-result ${resultClass}">${resultLabel}</span>
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
              <span class="metric-pill">${escapeHtml(direction)}</span>
              <span class="metric-pill">${escapeHtml(rr)}</span>
              <span class="metric-pill metric-pill--${resultClass === 'win' ? 'win' : resultClass === 'loss' ? 'loss' : 'muted'}">${escapeHtml(resultLabel)}</span>
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
              <div><strong>${escapeHtml(trade.session || '-')}</strong><span>Session</span></div>
              <div><strong class="jcard-rr-display">${escapeHtml(rr)}</strong><span>R multiple</span></div>
              <div><strong class="jcard-pnl-display ${pnlClass}">${fmtMoney(pnl)}</strong><span>PnL</span></div>
            </div>

            <h5>Niveaux</h5>
            <div class="journal-trade-detail-grid">
              <div style="grid-column:1/-1">
                <span>Entree</span>
                <input class="jcard-field" type="number" step="0.01" data-field="entry_price"
                  value="${trade.entry_price != null ? escapeHtml(String(trade.entry_price)) : ''}" placeholder="—"/>
              </div>
              <div>
                <span>SL</span>
                <input class="jcard-field" type="number" step="0.01" data-field="stop_loss"
                  value="${trade.stop_loss != null ? escapeHtml(String(trade.stop_loss)) : ''}" placeholder="—"/>
              </div>
              <div>
                <span>Sortie</span>
                <input class="jcard-field" type="number" step="0.01" data-field="exit_price"
                  value="${trade.exit_price != null ? escapeHtml(String(trade.exit_price)) : ''}" placeholder="—"/>
              </div>
            </div>

            <h5>Capture</h5>
            <div class="journal-back-shot" data-trade-shot="${tid}">
              ${shot
                ? `<img class="journal-back-shot-img" src="/screenshots/${escapeHtml(shot.filename)}" alt="Screenshot" />`
                : '<div class="journal-back-shot-empty"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><span>Ajouter une photo</span></div>'}
              <input type="file" accept="image/*" class="journal-shot-input hidden" data-trade-shot-input="${tid}" />
            </div>

            <h5>Execution</h5>
            <div class="journal-trade-detail-grid jcard-exec-grid">
              <div>
                <span>Resultat</span>
                <strong class="jcard-result-display ${resultClass}">${escapeHtml(resultLabel)}</strong>
              </div>
              <div>
                <span>Marge $</span>
                <input class="jcard-field jcard-margin-input" type="number" step="0.01" min="0" data-margin-input="1"
                  value="${trade.position_size != null && trade.leverage != null && trade.entry_price != null
                    ? escapeHtml(String(computeMarginUsd(trade.position_size, trade.leverage, trade.entry_price)))
                    : ''}" placeholder="0.00"/>
              </div>
              <div>
                <span>Levier</span>
                <input class="jcard-field" type="number" step="1" min="1" data-field="leverage"
                  value="${trade.leverage != null ? escapeHtml(String(trade.leverage)) : ''}" placeholder="1x"/>
              </div>
              <div>
                <span>Position</span>
                <input class="jcard-field" type="number" step="0.01" data-field="position_size"
                  value="${trade.position_size != null ? escapeHtml(String(trade.position_size)) : ''}" placeholder="—"/>
              </div>
              <div>
                <span>Qualite</span>
                <div class="jcard-stars" data-field="execution_quality" data-value="${qualityRaw}">${starsHtml}</div>
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
