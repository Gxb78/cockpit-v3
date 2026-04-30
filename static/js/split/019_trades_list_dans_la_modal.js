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

  el.innerHTML = tradeHeroCardHtml(trade, {
    variant: 'card',
    index: num,
    showInstrument: false,
  });

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
