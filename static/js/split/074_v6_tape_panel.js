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
    var maxRows = Math.max(8, Math.min(100000, Number(settings.maxRows || 5000)));
    var rows = [];
    for (var i = 0; i < trades.length && rows.length < maxRows; i++) {
      var trade = trades[i];
      if (Number(trade && trade.qty || 0) >= minQty) rows.push(trade);
    }
    return rows;
  }

  // Threshold above which a trade is considered "big" (used for is-big highlight)
  var BIG_TRADE_THRESHOLD = 50;

  function renderTapeRow(trade, opts) {
    trade = trade || {};
    opts = opts || {};
    var side = trade.side === 'buy' ? 'buy' : 'sell';
    var sideClass = side === 'buy' ? 'is-buy' : 'is-sell';
    var qty = Number(trade.qty) || 0;
    var maxQty = Number(opts.maxQty) || BIG_TRADE_THRESHOLD;
    var szPct = Math.min(100, Math.round(qty / maxQty * 100));
    var bigClass = qty >= BIG_TRADE_THRESHOLD ? ' is-big' : '';
    return [
      '<div class="v6-tape-row ', sideClass, bigClass, '">',
        '<span class="v6-tape-time">', V6OF.escapeHtml(V6OF.format.time(tradeTime(trade))), '</span>',
        '<span class="v6-tape-side">', side === 'buy' ? 'B' : 'S', '</span>',
        '<span class="v6-tape-price">', V6OF.escapeHtml(V6OF.format.price(Number(trade.price))), '</span>',
        '<span class="v6-tape-qty">',
          '<span class="v6-tape-szbar" style="width:', szPct, '%"></span>',
          V6OF.escapeHtml(V6OF.format.qty(qty)),
        '</span>',
        '<span class="v6-tape-exch">', V6OF.escapeHtml(trade.exchange || trade.source || '--'), '</span>',
        '<span class="v6-tape-sym">', V6OF.escapeHtml(trade.symbol || '--'), '</span>',
      '</div>'
    ].join('');
  }

  function ensureTapeShell(container) {
    if (!container || container._v6TapeShell) return;
    container.innerHTML = [
      '<div class="v6-tape-header">',
        '<span class="v6-panel-tick" aria-hidden="true"></span>',
        '<span class="v6-panel-title">Tape</span>',
        '<span class="v6-tape-pressure-bar" data-v6-tape-pressure>',
          '<span class="v6-tape-pressure-buy" data-v6-tape-pressure-buy style="width:50%"></span>',
          '<span class="v6-tape-pressure-sell" data-v6-tape-pressure-sell style="width:50%"></span>',
        '</span>',
        '<span class="v6-panel-sp"></span>',
        '<span class="v6-panel-grab" aria-hidden="true">&#x2807;</span>',
        '<button type="button" class="v6-panel-ib" data-v6-action="panel-settings" title="Tape settings" aria-label="Tape settings">&#x2699;</button>',
        '<button type="button" class="v6-panel-ib v6-panel-ib-close" data-v6-action="panel-close" title="Close tape" aria-label="Close tape">&#x2715;</button>',
      '</div>',
      '<div class="v6-tape-table v6-tape-shell">',
        '<div class="v6-tape-row v6-tape-head">',
          '<span class="v6-tape-time">Time</span>',
          '<span class="v6-tape-side">S</span>',
          '<span class="v6-tape-price">Price</span>',
          '<span class="v6-tape-qty">Qty</span>',
          '<span class="v6-tape-exch">Exch</span>',
          '<span class="v6-tape-sym">Sym</span>',
        '</div>',
        '<div class="v6-tape-virtual-body" data-v6-tape-virtual></div>',
      '</div>'
    ].join('');
    container._v6TapeShell = {
      header: container.querySelector('.v6-tape-header'),
      table: container.querySelector('.v6-tape-table'),
      body: container.querySelector('[data-v6-tape-virtual]'),
      pressureBuy: container.querySelector('[data-v6-tape-pressure-buy]'),
      pressureSell: container.querySelector('[data-v6-tape-pressure-sell]')
    };
  }

  Panels.renderTapeInto = function (container, trades, settings) {
    if (!container) return;
    settings = settings || {};
    var rows = tapeRows(trades, settings);
    var tapeFontSize = Number(settings.tapeFontSize || 10);
    ensureTapeShell(container);
    var shell = container._v6TapeShell;
    if (shell && shell.table) {
      shell.table.style.fontSize = tapeFontSize + 'px';
    }

    // Compute maxQty across visible rows for size-bar scaling
    var maxQty = BIG_TRADE_THRESHOLD;
    for (var i = 0; i < rows.length; i++) {
      var q = Number(rows[i].qty) || 0;
      if (q > maxQty) maxQty = q;
    }
    var rowOpts = { maxQty: maxQty };

    // Update pressure bar: ratio of buy vs sell volume
    if (shell && shell.pressureBuy && shell.pressureSell && rows.length) {
      var buyVol = 0, sellVol = 0;
      for (var j = 0; j < rows.length; j++) {
        var rv = Number(rows[j].qty) || 0;
        if (rows[j].side === 'buy') buyVol += rv; else sellVol += rv;
      }
      var total = buyVol + sellVol || 1;
      shell.pressureBuy.style.width = Math.round(buyVol / total * 100) + '%';
      shell.pressureSell.style.width = Math.round(sellVol / total * 100) + '%';
    }

    var body = shell && shell.body;
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
        renderRow: function (trade) { return renderTapeRow(trade, rowOpts); }
      });
    } else if (body) {
      body.innerHTML = rows.map(function (t) { return renderTapeRow(t, rowOpts); }).join('');
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
