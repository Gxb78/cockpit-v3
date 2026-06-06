// ---------- 074_v6_tape_panel.js ----------
// Tape panel: renders real-time trade log with exchange + symbol columns from the Go engine.

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};
  var Panels = V6OF.Panels = V6OF.Panels || {};

  function tradeTime(trade) {
    return Number(trade && (trade.tsExchange || trade.time || trade.tsLocal || 0));
  }

  function tapeRows(trades, settings) {
    trades = Array.isArray(trades) ? trades : [];
    settings = settings || {};
    var minQty = Number(settings.minQty || 0);
    var maxRows = Math.max(8, Math.min(5000, Number(settings.maxRows || 420)));
    var rows = [];
    for (var i = 0; i < trades.length && rows.length < maxRows; i++) {
      var trade = trades[i];
      if (Number(trade && trade.qty || 0) >= minQty) rows.push(trade);
    }
    return rows;
  }

  function renderTapeRow(trade) {
    trade = trade || {};
    var side = trade.side === 'buy' ? 'buy' : 'sell';
    var sideClass = side === 'buy' ? 'is-buy' : 'is-sell';
    return [
      '<div class="v6-tape-row ', sideClass, '">',
        '<span>', V6OF.escapeHtml(V6OF.format.time(tradeTime(trade))), '</span>',
        '<span>', side === 'buy' ? 'BUY' : 'SELL', '</span>',
        '<span>', V6OF.escapeHtml(V6OF.format.price(Number(trade.price))), '</span>',
        '<span>', V6OF.escapeHtml(V6OF.format.qty(Number(trade.qty))), '</span>',
        '<span class="v6-tape-exch">', V6OF.escapeHtml(trade.exchange || trade.source || '--'), '</span>',
        '<span class="v6-tape-sym">', V6OF.escapeHtml(trade.symbol || '--'), '</span>',
      '</div>'
    ].join('');
  }

  function ensureTapeShell(container) {
    if (!container || container._v6TapeShell) return;
    container.innerHTML = [
      '<div class="v6-tape-table v6-tape-shell">',
        '<div class="v6-tape-row v6-tape-head">',
          '<span>Time</span><span>Side</span><span>Price</span><span>Qty</span><span>Exch</span><span>Sym</span>',
        '</div>',
        '<div class="v6-tape-virtual-body" data-v6-tape-virtual></div>',
      '</div>'
    ].join('');
    container._v6TapeShell = {
      table: container.querySelector('.v6-tape-table'),
      body: container.querySelector('[data-v6-tape-virtual]')
    };
  }

  Panels.renderTapeInto = function (container, trades, settings) {
    if (!container) return;
    settings = settings || {};
    var rows = tapeRows(trades, settings);
    var tapeFontSize = Number(settings.tapeFontSize || 10);
    ensureTapeShell(container);
    if (container._v6TapeShell && container._v6TapeShell.table) {
      container._v6TapeShell.table.style.fontSize = tapeFontSize + 'px';
    }
    var body = container._v6TapeShell && container._v6TapeShell.body;
    if (!rows.length) {
      if (body) body.innerHTML = '<div class="v6-empty">Not available</div>';
      return;
    }
    if (V6OF.VirtualList && body) {
      V6OF.VirtualList.render(body, {
        rows: rows,
        rowHeight: Math.max(18, Math.min(28, tapeFontSize + 10)),
        buffer: 10,
        className: 'v6-tape-window',
        stickToTop: true,
        renderRow: renderTapeRow
      });
    } else if (body) {
      body.innerHTML = rows.map(renderTapeRow).join('');
    }
  };

  Panels.renderTape = function (trades, settings) {
    settings = settings || {};
    var tapeFontSize = Number(settings.tapeFontSize || 10);
    var rows = tapeRows(trades, settings);

    if (!rows.length) {
      return '<div class="v6-empty">Not available</div>';
    }

    return [
      '<div class="v6-tape-table" style="font-size: ' + tapeFontSize + 'px;">',
        '<div class="v6-tape-row v6-tape-head">',
          '<span>Time</span><span>Side</span><span>Price</span><span>Qty</span><span>Exch</span><span>Sym</span>',
        '</div>',
        rows.map(renderTapeRow).join(''),
      '</div>'
    ].join('');
  };
})();
