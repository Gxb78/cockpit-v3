// ---------- Trades list (dans la modal) ----------

var _tradeCardDataCache = {};
var _tradesListBound = false;

function bindTradesListActions(list) {
  if (!list || _tradesListBound) return;
  list.addEventListener("click", function (e) {
    // Lightbox on shot click
    var shot = e.target.closest(".trade-card-shot");
    if (shot) {
      e.stopPropagation();
      var card = shot.closest(".trade-card");
      var tid = card && card.dataset.tid;
      var trade = tid ? _tradeCardDataCache[tid] : null;
      var shots = trade && trade.screenshots;
      var first = shots && shots[0];
      if (first && typeof openLightbox === "function") {
        openLightbox("/screenshots/" + first.filename);
      }
      return;
    }
    // Edit on card click
    var card = e.target.closest(".trade-card");
    if (!card) return;
    var tid = card.dataset.tid;
    var trade = tid ? _tradeCardDataCache[tid] : null;
    if (trade && typeof openTradeForm === "function") {
      openTradeForm(trade);
    }
  });
  _tradesListBound = true;
}

function renderTradesList(trades) {
  var list = $("#tradesList");
  list.innerHTML = "";
  bindTradesListActions(list);
  // Build cache
  var cache = {};
  trades.forEach(function (t) { if (t.id != null) cache[String(t.id)] = t; });
  _tradeCardDataCache = cache;
  if (trades.length === 0) {
    list.innerHTML = '<div class="trades-empty"><strong>Aucun trade sur cette journee.</strong>Ajoute le premier trade pour construire ton plan, tes niveaux et ta review.</div>';
    return;
  }
  var summary = trades.reduce(function (acc, t) {
    var d = deriveTradeMetrics(t);
    var pnl = d.pnl ?? 0;
    acc.pnl += pnl;
    if (d.isWin === 1) acc.wins += 1;
    if (d.isWin === 0) acc.losses += 1;
    return acc;
  }, { pnl: 0, wins: 0, losses: 0 });
  var decided = summary.wins + summary.losses;
  var wr = decided ? Math.round(summary.wins / decided * 100) + "%" : "-";
  list.insertAdjacentHTML("beforeend",
    '<div class="trade-orchestrator">' +
      '<div class="trade-orchestrator-line"></div>' +
      '<div class="trade-orchestrator-node">Execution desk</div>' +
      '<div class="trade-orchestrator-node is-active">Trades du jour</div>' +
      '<div class="trade-orchestrator-metrics">' +
        '<span>' + trades.length + ' setups</span>' +
        '<span>' + fmtMoney(summary.pnl) + '</span>' +
        '<span>WR ' + wr + '</span>' +
      '</div>' +
    '</div>'
  );
  var fragment = document.createDocumentFragment();
  trades.forEach(function (t, i) {
    fragment.appendChild(tradeCardEl(t, i + 1));
  });
  list.appendChild(fragment);
  if (typeof setActiveTradeCard === "function") setActiveTradeCard(state.currentTradeId);
}

function tradeCardEl(trade, num) {
  var el       = document.createElement("article");
  el.className = "trade-card";
  el.dataset.tid = trade.id;

  var derived   = deriveTradeMetrics(trade);
  var pnlValue  = derived.pnl ?? 0;
  var pnlClass  = pnlValue > 0 ? "pos" : pnlValue < 0 ? "neg" : "";
  var winLabel  = derived.isWin === 1 ? "WIN" : derived.isWin === 0 ? "LOSS" : "-";
  var winClass  = derived.isWin === 1 ? "win" : derived.isWin === 0 ? "loss" : "";
  var strategy  = trade.strategy ? prettify(trade.strategy) : "Strategie inconnue";
  var direction = trade.direction ? trade.direction.toUpperCase() : "";
  var stratKey  = trade.strategy || "";
  var thesisLabel = trade.thesis_validated === "yes" ? "These validee" : trade.thesis_validated === "no" ? "These rejetee" : "These a qualifier";
  var quality = trade.execution_quality ? trade.execution_quality + "/5" : "-";
  var setupTone = pnlValue > 0 ? "Moteur propre" : pnlValue < 0 ? "Point a corriger" : "Setup neutre";

  var fmtPrice = function (v) { return v != null && v !== "" ? Number(v).toFixed(2) : "-"; };
  var entryP   = fmtPrice(trade.entry_price);
  var exitP    = fmtPrice(trade.exit_price);
  var stopP    = fmtPrice(trade.stop_loss);
  var targetP  = fmtPrice(trade.take_profit);
  var posSize  = trade.position_size != null && trade.position_size !== "" ? Number(trade.position_size) + "u" : "-";
  var rrStr    = derived.rr != null ? Number(derived.rr).toFixed(2) + "R" : "-";
  var rrVal    = derived.rr != null ? Number(derived.rr) : 0;
  var rrPct    = Math.min(Math.abs(rrVal) / 5 * 100, 100);
  var rrColor  = rrVal >= 0 ? "pos" : "neg";

  var summary = trade.why_trade?.trim() || trade.scenario?.trim() || "";

  var shots    = trade.screenshots || [];
  var shot     = shots[0];
  var shotUrl  = shot ? "/screenshots/" + shot.filename : null;

  var rrBar = '<span class="trade-rr-bar"><span class="fill-track"><span class="fill ' + rrColor + '" style="width:' + rrPct + '%"></span></span><span>' + rrStr + '</span></span>';
  var mediaHtml, noteHtml;
  var topBar = '<div class="trade-card-topbar">' +
      '<div class="trade-card-pillline">' +
        '<span class="metric-pill trade-chip trade-chip-num">#' + num + '</span>' +
        '<span class="metric-pill trade-chip trade-chip-strategy' + (stratKey ? " " + stratKey : "") + '">' + escapeHtml(strategy) + '</span>' +
      '</div>' +
      '<div class="trade-card-score ' + pnlClass + '">' +
        '<strong>' + fmtMoney(pnlValue) + '</strong>' +
        '<span>' + winLabel + '</span>' +
      '</div>' +
    '</div>';
  var statusStrip = '<div class="trade-card-status">' +
      (direction ? '<span class="metric-pill trade-direction ' + trade.direction + '">' + direction + '</span>' : '<span class="metric-pill trade-direction">-</span>') +
      '<span class="metric-pill trade-result ' + winClass + '">' + winLabel + '</span>' +
      rrBar +
    '</div>';

  if (shotUrl) {
    mediaHtml = '<div class="trade-card-media has-shot">' +
      '<div class="trade-card-shot" style="background-image:url(\'' + escapeHtml(shotUrl) + '\')"></div>' +
      '<div class="trade-card-media-overlay"></div>' +
    '</div>';
  } else {
    mediaHtml = '<div class="trade-card-media is-empty">' +
      '<div class="trade-card-shot-empty"><span>Aucune capture</span><strong>' + escapeHtml(setupTone) + '</strong></div>' +
    '</div>';
  }

  noteHtml = summary ? '<div class="trade-card-note">' + escapeHtml(summary) + '</div>' : "";

  el.innerHTML = topBar + mediaHtml +
    '<div class="trade-card-body">' +
      '<div class="trade-card-head">' +
        '<div><div class="trade-card-title">Trade #' + num + '</div><div class="trade-card-subtitle">' + escapeHtml(thesisLabel) + '</div></div>' +
        '<div class="trade-pnl ' + pnlClass + '">' + fmtMoney(pnlValue) + '</div>' +
      '</div>' +
      statusStrip +
      '<div class="trade-card-kpis">' +
        '<div class="trade-kpi"><span>Entree</span><strong>' + entryP + '</strong></div>' +
        '<div class="trade-kpi"><span>Sortie</span><strong>' + exitP + '</strong></div>' +
        '<div class="trade-kpi"><span>Stop</span><strong>' + stopP + '</strong></div>' +
        '<div class="trade-kpi"><span>Target</span><strong>' + targetP + '</strong></div>' +
      '</div>' +
      '<div class="trade-card-diagnostics">' +
        '<div><span>Execution</span><strong>' + escapeHtml(quality) + '</strong></div>' +
        '<div><span>Position</span><strong>' + escapeHtml(posSize) + '</strong></div>' +
      '</div>' +
      '<div class="trade-card-foot">' +
        '<span class="trade-meta-pill">' + escapeHtml(setupTone) + '</span>' +
        '<span class="trade-edit-hint">Cliquer pour editer</span>' +
      '</div>' +
      noteHtml +
    '</div>';

  return el;
}

function pmWizOpen(tradeId, trade) {
  if (!tradeId) {
    toast("Trade introuvable", "error");
    return;
  }
  wizOpen({
    mode: "postmortem",
    tradeId: tradeId,
    dayId: state.currentDayId || (trade ? trade.day_id : null) || null,
  });
  if (!wizState) return;
  wizState.data.exit_price = (trade && trade.exit_price) ?? "";
  wizState.data.exit_quality = Number((trade && trade.execution_quality) || 0);

  wizState.data.lessons = (trade && trade.lessons_learned) || "";
  _wizRender();
}
