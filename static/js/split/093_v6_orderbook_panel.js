// 093_v6_orderbook_panel.js
// Orderbook panel: two-sided ladder with cumulative depth bars.
// Reads from V6OrderBookSnapshot (state.orderBook).

(function () {
  'use strict';
  var V6OF = window.V6OF = window.V6OF || {};
  var Panels = V6OF.Panels = V6OF.Panels || {};
  if (!V6OF.register) {
    ['Core', 'Data', 'Transport', 'UI', 'Studies', 'Page'].forEach(function (n) {
      V6OF[n] = V6OF[n] || {};
    });
    V6OF.register = function (domain, name, value, legacyName) {
      V6OF[domain] = V6OF[domain] || {};
      V6OF[domain][name] = value;
      if (legacyName) V6OF[legacyName] = value;
      return value;
    };
  }

  function esc(s) {
    return V6OF.escapeHtml ? V6OF.escapeHtml(String(s)) : String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtPrice(v) {
    return V6OF.format && V6OF.format.price ? V6OF.format.price(Number(v)) : Number(v).toFixed(2);
  }

  function fmtQty(v) {
    return V6OF.format && V6OF.format.qty ? V6OF.format.qty(Number(v)) : Number(v).toFixed(3);
  }

  function headerHtml(source) {
    return [
      '<div class="v6-ob-header">',
        '<span class="v6-panel-tick" aria-hidden="true"></span>',
        '<span class="v6-panel-title">Book</span>',
        '<span class="v6-panel-meta" data-ob-stat="source">', esc(source || '—'), '</span>',
        '<span class="v6-panel-sp"></span>',
        '<span class="v6-panel-grab" aria-hidden="true">&#x2807;</span>',
        '<button type="button" class="v6-panel-ib" data-v6-action="panel-settings" title="Orderbook settings" aria-label="Orderbook settings">&#x2699;</button>',
        '<button type="button" class="v6-panel-ib v6-panel-ib-close" data-v6-action="panel-close" title="Close orderbook" aria-label="Close orderbook">&#x2715;</button>',
      '</div>'
    ].join('');
  }

  function colHeadHtml() {
    return [
      '<div class="v6-ob-row v6-ob-colhead">',
        '<span class="v6-ob-cell-bid-amt">Amt</span>',
        '<span class="v6-ob-cell-bid-total">Total</span>',
        '<span class="v6-ob-cell-price">Price</span>',
        '<span class="v6-ob-cell-ask-total">Total</span>',
        '<span class="v6-ob-cell-ask-amt">Amt</span>',
      '</div>'
    ].join('');
  }

  function rowHtml(level, side, maxCum) {
    var pct = maxCum > 0 ? Math.min(100, Math.round((Number(level.cumulative) || 0) / maxCum * 100)) : 0;
    var cls = 'v6-ob-row is-' + side;
    return [
      '<div class="', cls, '">',
        '<span class="v6-ob-bar" style="width:', pct, '%"></span>',
        '<span class="v6-ob-cell-bid-amt">', side === 'bid' ? esc(fmtQty(level.size)) : '', '</span>',
        '<span class="v6-ob-cell-bid-total">', side === 'bid' ? esc(fmtQty(level.cumulative)) : '', '</span>',
        '<span class="v6-ob-cell-price">', esc(fmtPrice(level.price)), '</span>',
        '<span class="v6-ob-cell-ask-total">', side === 'ask' ? esc(fmtQty(level.cumulative)) : '', '</span>',
        '<span class="v6-ob-cell-ask-amt">', side === 'ask' ? esc(fmtQty(level.size)) : '', '</span>',
      '</div>'
    ].join('');
  }

  function spreadRowHtml(snap) {
    var spread = Number(snap.spread) || 0;
    var mid = Number(snap.mid || snap.midPrice) || 0;
    return [
      '<div class="v6-ob-row v6-ob-spread">',
        '<span class="v6-ob-cell-bid-amt"></span>',
        '<span class="v6-ob-cell-bid-total"></span>',
        '<span class="v6-ob-cell-price">',
          mid > 0 ? esc(fmtPrice(mid)) : '—',
          ' <em>', spread > 0 ? esc(spread.toFixed(2)) : '—', '</em>',
        '</span>',
        '<span class="v6-ob-cell-ask-total"></span>',
        '<span class="v6-ob-cell-ask-amt"></span>',
      '</div>'
    ].join('');
  }

  Panels.OrderbookPanel = {
    renderInto: function (container, snap, settings) {
      if (!container) return;
      snap = snap || {};
      settings = settings || {};
      var obRows = Math.max(5, Math.min(50, Number(settings.obRows || 15)));

      var bids = Array.isArray(snap.bids) ? snap.bids.slice(0, obRows) : [];
      var asks = Array.isArray(snap.asks) ? snap.asks.slice(0, obRows) : [];

      // asks top-to-bottom: highest price first
      var asksDesc = asks.slice().sort(function (a, b) { return Number(b.price) - Number(a.price); });
      // bids top-to-bottom: highest bid first (best bid at top)
      var bidsDesc = bids.slice().sort(function (a, b) { return Number(b.price) - Number(a.price); });

      // max cumulative across both sides for bar scaling
      var maxCum = 0;
      bids.forEach(function (l) { var c = Number(l.cumulative) || 0; if (c > maxCum) maxCum = c; });
      asks.forEach(function (l) { var c = Number(l.cumulative) || 0; if (c > maxCum) maxCum = c; });

      var parts = [headerHtml(snap.exchange || snap.source || ''), colHeadHtml()];
      asksDesc.forEach(function (lv) { parts.push(rowHtml(lv, 'ask', maxCum)); });
      parts.push(spreadRowHtml(snap));
      bidsDesc.forEach(function (lv) { parts.push(rowHtml(lv, 'bid', maxCum)); });

      if (!bids.length && !asks.length) {
        parts.push('<div class="v6-empty">No orderbook data</div>');
      }

      container.innerHTML = parts.join('');
    }
  };
})();
