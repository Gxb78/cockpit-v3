// ---------- 074_v6_tape_panel.js ----------
// Tape panel renderer for Cockpit V6 orderflow.
// Phase 7: added exchange + symbol columns for live Go engine trades.

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};
  var Panels = V6OF.Panels = V6OF.Panels || {};

  Panels.renderTape = function (trades, settings) {
    trades = Array.isArray(trades) ? trades : [];
    settings = settings || {};
    var minQty = Number(settings.minQty || 0);
    var tapeFontSize = Number(settings.tapeFontSize || 10);
    var maxRows = Math.max(8, Math.min(500, Number(settings.maxRows || 42)));
    var rows = trades.filter(function (trade) {
      return trade.qty >= minQty;
    }).slice(0, maxRows);

    if (!rows.length) {
      return '<div class="v6-empty">Not available</div>';
    }

    return [
      '<div class="v6-tape-table" style="font-size: ' + tapeFontSize + 'px;">',
        '<div class="v6-tape-row v6-tape-head">',
          '<span>Time</span><span>Side</span><span>Price</span><span>Qty</span><span>Exch</span><span>Sym</span>',
        '</div>',
        rows.map(function (trade) {
          var sideClass = trade.side === 'buy' ? 'is-buy' : 'is-sell';
          return [
            '<div class="v6-tape-row ', sideClass, '">',
              '<span>', V6OF.escapeHtml(V6OF.format.time(trade.tsExchange)), '</span>',
              '<span>', trade.side === 'buy' ? 'BUY' : 'SELL', '</span>',
              '<span>', V6OF.escapeHtml(V6OF.format.price(trade.price)), '</span>',
              '<span>', V6OF.escapeHtml(V6OF.format.qty(trade.qty)), '</span>',
              '<span class="v6-tape-exch">', V6OF.escapeHtml(trade.exchange || '--'), '</span>',
              '<span class="v6-tape-sym">', V6OF.escapeHtml(trade.symbol || '--'), '</span>',
            '</div>'
          ].join('');
        }).join(''),
      '</div>'
    ].join('');
  };
})();
