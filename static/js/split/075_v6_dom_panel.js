// ---------- 075_v6_dom_panel.js ----------
// DOM Panel v5 — Stable view window, no jumps.
//
// Utilise la fenetre stable viewMin/viewMax du DomLadder v5.
// - scrollTop JAMAIS modifie pendant les updates book (zero saut)
// - La fenetre viewMin/viewMax ne change que si le prix sort de la zone de confort
// - Follow mode : centrage smooth sur le mid quand en follow
// - Aucun "Waiting for orderbook" destructif — garde l'ancien rendu visible
// - Auto-center : une seule fois au premier render

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};
  if (!V6OF.register) {
    ['Core', 'Data', 'Transport', 'UI', 'Studies', 'Page'].forEach(function (name) { V6OF[name] = V6OF[name] || {}; });
    V6OF.register = function (domain, name, value, legacyName) {
      V6OF[domain] = V6OF[domain] || {};
      V6OF[domain][name] = value;
      if (legacyName) V6OF[legacyName] = value;
      return value;
    };
  }

  var DOM_ROW_HEIGHT  = 15;  // px, matches terminal-exocharts-photo-perfect-v2.html
  var OVERSCAN        = 8;   // rows hors viewport, pour le scroll fluide
  var RENDER_THROTTLE = 50;  // ms

  // ── Formatters ──────────────────────────────────────────────────────────────

  function trimZeros(s) {
    return String(s).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '').replace(/\.$/, '');
  }

  function fmt(v, showZero, price, minDisplay) {
    if (v == null || !Number.isFinite(Number(v))) return '';
    v = Number(v);
    if (v === 0) return showZero ? '0' : '';
    var a = Math.abs(v);
    // Apply minDisplay to displayed value (USD if price provided, coin otherwise)
    if (minDisplay != null) {
      var displayVal = price && Number.isFinite(price) && price > 0 ? a * price : a;
      if (displayVal < minDisplay) return '';
    }
    var neg = v < 0;
    if (price && Number.isFinite(price) && price > 0) {
      var usd = a * price;
      var t = usd >= 1e9 ? '$' + trimZeros((usd / 1e9).toFixed(usd >= 1e10 ? 0 : 1)) + 'B'
        : usd >= 1e6 ? '$' + trimZeros((usd / 1e6).toFixed(usd >= 1e7 ? 0 : 1)) + 'M'
        : usd >= 1000 ? '$' + trimZeros((usd / 1e3).toFixed(usd >= 1e4 ? 0 : 1)) + 'K'
        : usd >= 100 ? '$' + Math.round(usd)
        : usd >= 10 ? '$' + trimZeros(usd.toFixed(1))
        : '$' + trimZeros(usd.toFixed(2));
      return (neg ? '-' : '') + t;
    }
    var s = a >= 1e6 ? trimZeros((a / 1e6).toFixed(a >= 1e7 ? 0 : 1)) + 'M'
      : a >= 1000 ? trimZeros((a / 1e3).toFixed(a >= 1e4 ? 0 : 1)) + 'K'
      : a >= 100 ? a.toFixed(0)
      : a >= 10 ? trimZeros(a.toFixed(1))
      : a >= 1 ? trimZeros(a.toFixed(2))
      : a >= 0.01 ? trimZeros(a.toFixed(3))
      : a.toPrecision(2);
    return (neg ? '-' : '') + s;
  }

  function fmtSigned(v, price) {
    if (v == null || !Number.isFinite(Number(v)) || v === 0) return '';
    var body = fmt(Math.abs(v), true, price);
    return body ? (v >= 0 ? '+' : '-') + body : '';
  }

  function fmtPrice(v) {
    if (v == null || !Number.isFinite(Number(v))) return '-';
    if (v >= 1000) return String(Math.round(v));
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }

  function escAttr(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function fmtAge(ts) {
    if (!ts || !Number.isFinite(Number(ts))) return '-';
    var age = Math.max(0, Date.now() - Number(ts));
    if (age < 1000) return age + 'ms';
    if (age < 60000) return (age / 1000).toFixed(age < 10000 ? 1 : 0) + 's';
    return Math.floor(age / 60000) + 'm';
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function sourceLabel(state, snap) {
    var src = (state && state.dataSource) || (snap && snap.source) || 'binance';
    var sym = (snap && snap.symbol) || (state && state.symbol) || (state && state.selectedSymbol) ||
              (src === 'hyperliquid' ? 'BTC' : 'BTCUSDT');
    var nice = src === 'hyperliquid' ? 'Hyperliquid' : 'Binance';
    return String(sym).toUpperCase() + ' @ ' + nice;
  }

  var lastValidPrice = NaN;
  var lastPriceSymbol = '';

  function getTradeTime(t) { return t ? Number(t.time || t.tsLocal || t.tsExchange || 0) : 0; }

  function livePrice(state, snap) {
    var sym = (state && state.symbol) || (state && state.selectedSymbol) || '';
    if (sym && sym !== lastPriceSymbol) { lastPriceSymbol = sym; lastValidPrice = NaN; }
    var trades = state && state.trades;
    if (trades && trades.length) {
      var newest = trades[0];
      if (trades.length > 1) {
        var t0 = getTradeTime(trades[0]), tN = getTradeTime(trades[trades.length - 1]);
        if (tN > t0) newest = trades[trades.length - 1];
      }
      if (newest && Number.isFinite(Number(newest.price)) && Number(newest.price) > 0) {
        lastValidPrice = Number(newest.price);
        return lastValidPrice;
      }
    }
    if (snap && Number.isFinite(snap.midPrice) && snap.midPrice > 0) {
      lastValidPrice = snap.midPrice; return lastValidPrice;
    }
    return lastValidPrice;
  }

  function bookDepth(state, snap) {
    var ld = Number(state && state.liveDepthCount) || 0;
    var rd = Number(state && state.restDepthCount) || 0;
    if (ld || rd) return (ld && rd) ? 'L' + ld + '/R' + rd : (ld ? 'L' + ld : 'R' + rd);
    var ob = state && state.orderBook;
    if (ob && Array.isArray(ob.bids)) return ob.bids.length + '/' + (ob.asks ? ob.asks.length : 0);
    return snap ? String(snap.bookSize || 0) : '0';
  }

  function domSequenceLabel(snap) {
    var seq = Number(snap && (snap.sequence || snap.seq || snap.updateId || snap.bookCount));
    if (!Number.isFinite(seq) || seq <= 0) return '-';
    return seq >= 1000000 ? trimZeros((seq / 1000000).toFixed(1)) + 'M' : String(Math.round(seq));
  }

  function domGapCount(snap) {
    var gap = Number(snap && (snap.sequenceGapCount || snap.gapCount || snap.gaps));
    return Number.isFinite(gap) && gap > 0 ? Math.round(gap) : 0;
  }

  function domDroppedCount(state, snap) {
    var localDrops = Number(snap && (snap.droppedUpdates || snap.droppedCount)) || 0;
    var engineStats = (state && (state.engineStats || state.stats)) || {};
    var engineDrops = Number(engineStats.droppedCount || engineStats.drops || 0) || 0;
    return Math.max(0, Math.round(localDrops + engineDrops));
  }

  function renderStats(container, snap, state, live, settings) {
    setStat(container, 'source', sourceLabel(state, snap));
    setStat(container, 'age',    fmtAge(state.lastOrderBookTs || snap.lastUpdate));
    setStat(container, 'live',   fmtPrice(live));
    setStat(container, 'mid',    fmtPrice(snap.midPrice));
    setStat(container, 'spread', fmtPrice(snap.spread));
    setStat(container, 'depth',  bookDepth(state, snap));
    setStat(container, 'seq',    domSequenceLabel(snap));
    setStat(container, 'gap',    String(domGapCount(snap)));
    setStat(container, 'drop',   String(domDroppedCount(state, snap)));
    syncControls(container, snap.priceGrouping || 25, settings);
    // Σ BID / Σ ASK footer
    var sigmaFoot = container.querySelector('[data-v6-dom-sigma]');
    if (sigmaFoot && snap) {
      var sumBid = 0, sumAsk = 0;
      if (snap.book && typeof snap.book.forEach === 'function') {
        snap.book.forEach(function (lv) {
          sumBid += Math.max(0, Number(lv && lv.bidSize) || 0);
          sumAsk += Math.max(0, Number(lv && lv.askSize) || 0);
        });
      }
      var mid = snap.midPrice || snap.price || 0;
      var bidEl = sigmaFoot.querySelector('[data-dom-sigma="bid"]');
      var askEl = sigmaFoot.querySelector('[data-dom-sigma="ask"]');
      if (bidEl) bidEl.textContent = fmt(sumBid, true, mid) || '—';
      if (askEl) askEl.textContent = fmt(sumAsk, true, mid) || '—';
    }
  }

  // ── Scroll / Follow ─────────────────────────────────────────────────────────

  var suppressScrollUntil = 0;
  var autoCenter   = true;
  var userScrolled = false;
  var lastMidTick  = null;      // pour detecter le mouvement du mid
  var followRaf    = null;
  var followPending = null;

  function scheduleFollowReturn(container) {
    // Disabled to prevent automatic mid-centering from resetting the viewport.
    // The user must explicitly request follow mid via the "Follow mid" button.
  }

  // ── Center on a tick (smooth si le mid a bouge, instant sinon) ──

  function centerOnTick(body, tick, maxTick, smooth) {
    if (!body || tick == null) return;
    var rowIndex     = maxTick - tick;
    var targetCenter = Math.max(0, Math.round((body.clientHeight - DOM_ROW_HEIGHT) * 0.48));
    var nextTop      = Math.max(0, rowIndex * DOM_ROW_HEIGHT - targetCenter);
    suppressScrollUntil = Date.now() + (smooth ? 600 : 100);
    if (smooth && typeof body.scrollTo === 'function') {
      body.scrollTo({ top: nextTop, behavior: 'smooth' });
    } else {
      // Direct assignment is synchronous, so the re-render below sees the new top.
      body.scrollTop = nextTop;
    }
    // Re-render the virtual window for the NEW scrollTop immediately. renderVirtual
    // keys off body.scrollTop; without this, an auto-center leaves the rows
    // rendered for the previous (pre-scroll) position and stranded off-screen —
    // the cause of the "empty ladder on load" until you click Follow mid.
    var ctn = body.closest && body.closest('[data-v6-dom-list]');
    if (ctn && ctn._domLastSnap) {
      renderVirtual(body, ctn._domLastSnap, ctn._domLastLive || 0,
        (ctn._domLastState && ctn._domLastState.settings) || {});
    }
    setTimeout(function () { if (Date.now() >= suppressScrollUntil) suppressScrollUntil = 0; },
      smooth ? 660 : 120);
  }

  // ── Column registry ──────────────────────────────────────────────────────────
  // Single source of truth for DOM column layout, header label and cell
  // rendering. renderRow builds one shared `ctx` per row and calls
  // cols.map(c => COLUMN_DEFS[c].render(ctx)) — no per-column if/else chain.
  //
  // ctx.heat.{vol,sell,buy,delta} are alpha values in [0, HEAT_ALPHA_MAX]
  // (0 = no background) computed once per render pass by renderVirtual.
  var COLUMN_DEFS = {
    vol: {
      weight: 10,
      label: 'VOL',
      render: function (ctx) {
        var style = 'width:' + ctx.widths.vol + '; flex-shrink:0;';
        var alpha = ctx.heat.vol || 0;
        if (alpha > 0) style += ' background: rgba(var(--v6-accent-rgb), ' + alpha.toFixed(3) + ');';
        var raw = (Number(ctx.lv.buyVol) || 0) + (Number(ctx.lv.sellVol) || 0);
        return '<div class="v6-dom-cell v6-dom-cell-vol" style="' + style + '">' + fmtMode(raw, false, ctx.vctx) + '</div>';
      }
    },
    sell: {
      weight: 9,
      label: 'SELL',
      render: function (ctx) {
        var style = 'width:' + ctx.widths.sell + '; flex-shrink:0;';
        var alpha = ctx.heat.sell || 0;
        if (alpha > 0) style += ' background: rgba(var(--v6-sell-rgb), ' + alpha.toFixed(3) + ');';
        return '<div class="v6-dom-cell v6-dom-cell-sell" style="' + style + '">' + fmtMode(ctx.lv.sellVol, false, ctx.vctx) + '</div>';
      }
    },
    buy: {
      weight: 9,
      label: 'BUY',
      render: function (ctx) {
        var style = 'width:' + ctx.widths.buy + '; flex-shrink:0;';
        var alpha = ctx.heat.buy || 0;
        if (alpha > 0) style += ' background: rgba(var(--v6-buy-rgb), ' + alpha.toFixed(3) + ');';
        return '<div class="v6-dom-cell v6-dom-cell-buy" style="' + style + '">' + fmtMode(ctx.lv.buyVol, false, ctx.vctx) + '</div>';
      }
    },
    bid: {
      weight: 18,
      label: 'BID',
      render: function (ctx) {
        var style = 'width:' + ctx.widths.bid + '; flex-shrink:0;';
        return '<div class="v6-dom-cell v6-dom-cell-bid' + ctx.bidChangeClass + '" style="' + style + '" role="gridcell" tabindex="0" aria-label="' + escAttr('Bid size ' + ctx.bidText + ' at price ' + ctx.priceText) + '">' +
          '<div class="v6-dom-bar is-bid" style="width:' + ctx.bidPct + '%"></div>' +
          '<span class="v6-dom-val">' + (ctx.bidText === '0' ? '' : ctx.bidText) + '</span>' +
        '</div>';
      }
    },
    price: {
      weight: 16,
      label: 'PRICE',
      render: function (ctx) {
        var style = 'width:' + ctx.widths.price + '; flex-shrink:0;';
        return '<div class="v6-dom-cell v6-dom-cell-price" style="' + style + '" role="gridcell" tabindex="0" aria-label="' + escAttr(ctx.rowLabel) + '">' + ctx.marker + ctx.priceText + ctx.liveBadge + '</div>';
      }
    },
    ask: {
      weight: 18,
      label: 'ASK',
      render: function (ctx) {
        var style = 'width:' + ctx.widths.ask + '; flex-shrink:0;';
        return '<div class="v6-dom-cell v6-dom-cell-ask' + ctx.askChangeClass + '" style="' + style + '" role="gridcell" tabindex="0" aria-label="' + escAttr('Ask size ' + ctx.askText + ' at price ' + ctx.priceText) + '">' +
          '<div class="v6-dom-bar is-ask" style="width:' + ctx.askPct + '%"></div>' +
          '<span class="v6-dom-val">' + (ctx.askText === '0' ? '' : ctx.askText) + '</span>' +
        '</div>';
      }
    },
    delta: {
      weight: 10,
      label: 'DELTA',
      render: function (ctx) {
        var style = 'width:' + ctx.widths.delta + '; flex-shrink:0;';
        var alpha = ctx.heat.delta || 0;
        if (alpha > 0) {
          var rgbVar = (Number(ctx.lv.delta) || 0) >= 0 ? '--v6-buy-rgb' : '--v6-sell-rgb';
          style += ' background: rgba(var(' + rgbVar + '), ' + alpha.toFixed(3) + ');';
        }
        return '<div class="v6-dom-cell v6-dom-cell-delta" style="' + style + '">' + fmtModeSigned(ctx.lv.delta, ctx.vctx) + '</div>';
      }
    },
    imb: {
      weight: 8,
      label: 'IMB',
      render: function (ctx) {
        var style = 'width:' + ctx.widths.imb + '; flex-shrink:0;';
        return '<div class="v6-dom-cell v6-dom-cell-imb ' + ctx.imSide + '" style="' + style + '">' + ctx.imText + '</div>';
      }
    },
    stack: {
      weight: 5,
      label: 'STK',
      render: function (ctx) {
        var style = 'width:' + ctx.widths.stack + '; flex-shrink:0;';
        return '<div class="v6-dom-cell v6-dom-cell-stack ' + ctx.imSide + '" style="' + style + '">' + ctx.stackText + '</div>';
      }
    },
    abs: {
      weight: 7,
      label: 'ABS',
      render: function (ctx) {
        var style = 'width:' + ctx.widths.abs + '; flex-shrink:0;';
        return '<div class="v6-dom-cell v6-dom-cell-abs ' + ctx.absSide + '" style="' + style + '">' + ctx.absText + '</div>';
      }
    }
  };

  // Per-column header alignment (text-align/justify-content/padding), kept
  // separate from COLUMN_DEFS since it only applies to the header row.
  var COLUMN_HEADER_STYLE = {
    vol:   ' text-align: right; justify-content: flex-end;',
    sell:  ' text-align: right; justify-content: flex-end;',
    buy:   ' text-align: right; justify-content: flex-end;',
    bid:   ' text-align: right; justify-content: flex-end; padding-right: 5px;',
    price: ' justify-content: center;',
    ask:   ' text-align: left; justify-content: flex-start; padding-left: 5px;',
    delta: ' text-align: right; justify-content: flex-end;',
    imb:   ' text-align: right; justify-content: flex-end;',
    stack: ' text-align: center; justify-content: center;',
    abs:   ' text-align: center; justify-content: center;'
  };

  var DOM_REFERENCE_COLUMN_WIDTHS = {
    vol: 38,
    sell: 42,
    buy: 42,
    bid: 42,
    price: 48,
    ask: 42,
    delta: 48,
    imb: 36,
    stack: 32,
    abs: 36
  };

  var DOM_COLUMN_MIN_WIDTH = 24;
  var DOM_COLUMN_MAX_WIDTH = 220;

  function clampColumnWidth(value, fallback) {
    var n = Number(value);
    if (!Number.isFinite(n)) n = Number(fallback) || 42;
    return Math.max(DOM_COLUMN_MIN_WIDTH, Math.min(DOM_COLUMN_MAX_WIDTH, Math.round(n)));
  }

  function getDomColumns(settings) {
    var cols = settings && settings.domColumns;
    // Delegate to the centralized validation in 079_v6_orderflow_settings.js
    // to avoid duplicating the logic for handling legacy defaults, uniqueness, etc.
    if (V6OF.Core && V6OF.Core.Settings && V6OF.Core.Settings.getValidatedDomColumns) {
      return V6OF.Core.Settings.getValidatedDomColumns(cols);
    }
    // Fallback if Settings module not loaded yet (defensive)
    return cols && Array.isArray(cols) && cols.length > 0 ? cols : ['vol', 'sell', 'buy', 'bid', 'price', 'ask', 'delta'];
  }

  function getColumnWidths(cols, settings) {
    var widths = {};
    var custom = settings && settings.domColumnWidths && typeof settings.domColumnWidths === 'object'
      ? settings.domColumnWidths : {};
    cols.forEach(function (c) {
      var fallback = DOM_REFERENCE_COLUMN_WIDTHS[c] || (((COLUMN_DEFS[c] && COLUMN_DEFS[c].weight) || 10) * 4);
      widths[c] = clampColumnWidth(custom[c], fallback) + 'px';
    });
    widths._total = totalColumnWidth(cols, widths);
    return widths;
  }

  function totalColumnWidth(cols, widths) {
    var total = 0;
    cols.forEach(function (c) {
      var w = widths[c];
      if (!w) return; // Skip undefined/null widths
      total += parseFloat(w) || 0;
    });
    return Math.max(1, Math.round(total));
  }

  function columnBoundaryBackground(cols, widths) {
    var x = 0;
    var lines = [];
    cols.forEach(function (c, idx) {
      x += parseFloat(widths[c]) || 0;
      if (idx < cols.length - 1) {
        var pos = Math.round(x);
        lines.push('linear-gradient(90deg, transparent ' + pos + 'px, var(--v6-dom-ref-line) ' + pos + 'px, transparent ' + (pos + 1) + 'px)');
      }
    });
    return lines.join(',');
  }

  function renderHeadersHtml(cols, widths) {
    return cols.map(function (c) {
      var style = 'width:' + widths[c] + '; flex-shrink:0;';
      style += COLUMN_HEADER_STYLE[c] || '';
      var label = (COLUMN_DEFS[c] && COLUMN_DEFS[c].label) || c.toUpperCase();
      return '<div class="v6-dom-col v6-dom-col-' + c + ' v6-dom-draghead" style="' + style + '" data-col="' + c + '" draggable="true">' +
        label +
        '<span class="v6-dom-col-resizer" data-dom-col-resize="' + c + '" title="Ajuster ' + label + '"></span>' +
        '<span class="v6-dom-dragicon">&#9776;</span>' +
        '</div>';
    }).join('');
  }

  // ── Skeleton HTML ─────────────────────────────────────────────────────────────

  function buildSkeleton(container, grouping, groupOpts) {
    var groupSelectHtml = groupOpts.map(function (g) {
      return '<option value="' + g + '"' + (g === grouping ? ' selected' : '') + '>' + g + '</option>';
    }).join('');
    container.innerHTML =
      // ── Premium header ──────────────────────────────────────────────────────
      '<div class="v6-dom-header">' +
        // Legacy stats (hidden via CSS; data-dom-stat hooks preserved for JS)
        '<div class="v6-dom-hleft">' +
          '<span class="v6-dom-stat v6-dom-source"><em>SRC</em><strong data-dom-stat="source">-</strong></span>' +
          '<span class="v6-dom-stat"><em>AGE</em><strong data-dom-stat="age">-</strong></span>' +
          '<span class="v6-dom-stat v6-dom-stat-live"><em>LIVE</em><strong data-dom-stat="live">-</strong></span>' +
          '<span class="v6-dom-stat v6-dom-stat-mid"><em>MID</em><strong data-dom-stat="mid">-</strong></span>' +
          '<span class="v6-dom-stat"><em>SPR</em><strong data-dom-stat="spread">-</strong></span>' +
          '<span class="v6-dom-stat"><em>SEQ</em><strong data-dom-stat="seq">-</strong></span>' +
          '<span class="v6-dom-stat"><em>GAP</em><strong data-dom-stat="gap">0</strong></span>' +
          '<span class="v6-dom-stat"><em>DROP</em><strong data-dom-stat="drop">0</strong></span>' +
        '</div>' +
        '<div class="v6-dom-hright">' +
          '<span class="v6-dom-stat"><em>DEPTH</em><span data-dom-stat="depth">0/0</span></span>' +
          '<button class="v6-dom-recenter" type="button" title="Follow mid: re-center on the current mid price" aria-label="Follow mid: re-center on the current mid price">Follow mid</button>' +
        '</div>' +
        // Premium visual layer (shown via CSS; overlays the legacy stats row)
        '<span class="v6-panel-tick" aria-hidden="true"></span>' +
        '<span class="v6-panel-title">DOM</span>' +
        '<span class="v6-panel-meta" data-dom-stat="source">—</span>' +
        '<span class="v6-panel-sp"></span>' +
        '<span class="v6-panel-grab" aria-hidden="true">&#x2807;</span>' +
        '<button type="button" class="v6-panel-ib" data-v6-action="panel-settings" title="Settings" aria-label="Panel settings">&#x2699;</button>' +
        '<button type="button" class="v6-panel-ib v6-panel-ib-close" data-v6-action="panel-close" title="Close" aria-label="Close panel">&#x2715;</button>' +
      '</div>' +
      '<div class="v6-dom-toolbar">' +
        '<span>PG</span>' +
        '<select class="v6-dom-grouping" aria-label="Price grouping">' + groupSelectHtml + '</select>' +
        '<button class="v6-dom-recenter" type="button" title="Follow mid: re-center on the current mid price" aria-label="Follow mid: re-center on the current mid price">&#x2699;</button>' +
      '</div>' +
      // ── Column headers + ladder ──────────────────────────────────────────────
      '<div class="v6-dom-cols"></div>' +
      '<div class="v6-dom-body" role="grid" aria-label="Depth of market price ladder"></div>' +
      '<div class="v6-dom-stale-overlay" data-dom-stale-overlay hidden aria-live="polite">' +
        '<strong>Stale DOM</strong><span data-dom-stale-text>Waiting for order book</span>' +
      '</div>' +
      '<div class="v6-dom-activity-above" data-dom-activity-above hidden aria-live="polite">▲ Activity above window</div>' +
      '<div class="v6-dom-activity-below" data-dom-activity-below hidden aria-live="polite">▼ Activity below window</div>' +
      // ── Σ BID / Σ ASK footer ──────────────────────────────────────────────────
      '<div class="v6-dom-sigma-footer" data-v6-dom-sigma>' +
        '<span class="v6-dom-sigma-bid"><em>Σ BID</em> <strong data-dom-sigma="bid">—</strong></span>' +
        '<span class="v6-dom-sigma-ask"><em>Σ ASK</em> <strong data-dom-sigma="ask">—</strong></span>' +
      '</div>' +
      // ── Controls footer (goto price + value mode; GROUP moved to header) ─────
      '<div class="v6-dom-footer">' +
        '<form class="v6-dom-goto-form" aria-label="Go to price">' +
          '<input type="text" class="v6-dom-goto-input" placeholder="Go to price..." aria-label="Go to price input" />' +
        '</form>' +
        '<label class="v6-dom-glbl v6-dom-value-mode-wrap">Val <select class="v6-dom-value-mode" title="Value display mode">' +
          '<option value="coin">Coin</option>' +
          '<option value="notional">Notional</option>' +
          '<option value="contracts">Contracts</option>' +
          '<option value="ticks">Ticks</option>' +
        '</select></label>' +
      '</div>';
  }

  function setStat(container, name, value) {
    var els = container.querySelectorAll('[data-dom-stat="' + name + '"]');
    els.forEach(function (el) {
      if (el && el.textContent !== String(value)) el.textContent = String(value);
    });
  }

  function setStaleOverlay(container, visible, text) {
    var overlay = container && container.querySelector('[data-dom-stale-overlay]');
    if (!overlay) return;
    overlay.hidden = !visible;
    overlay.classList.toggle('is-visible', !!visible);
    var label = overlay.querySelector('[data-dom-stale-text]');
    if (label && text && label.textContent !== String(text)) label.textContent = String(text);
  }

  function syncControls(container, grouping, settings) {
    if (!container || !container.classList) return;
    // In Exocharts layout, grouping select is in the parent .exo-dom-toolbar
    var isExo = container.classList.contains('exo-dom-body');
    var searchRoot = isExo ? (container.parentElement || container) : container;
    var sel = searchRoot.querySelector('.v6-dom-grouping') || searchRoot.querySelector('.exo-dom-grouping');
    if (sel && document.activeElement !== sel && String(sel.value) !== String(grouping)) sel.value = grouping;
    var modeSel = container.querySelector('.v6-dom-value-mode');
    if (modeSel && document.activeElement !== modeSel) {
      var mode = normalizeValueMode(settings && settings.domValueMode);
      if (String(modeSel.value) !== mode) modeSel.value = mode;
    }
  }

  // ── Row HTML ──────────────────────────────────────────────────────────────────

  // Instrument-aware bid/ask display floor. `usdMode` true → compare against the
  // USD notional floor directly; otherwise convert that floor to coin units via
  // the live price (falling back to 0.001 when the price is unknown).
  function computeSizeThreshold(settings, usdMode, live) {
    var minNotionalUsd = Number(settings && settings.domMinNotionalUsd);
    if (!Number.isFinite(minNotionalUsd) || minNotionalUsd < 0) minNotionalUsd = 100;
    if (usdMode) return minNotionalUsd;
    if (Number.isFinite(live) && live > 0) return minNotionalUsd / live;
    return 0.001;
  }

  function fmtRatio(v) {
    if (!Number.isFinite(v)) return 'inf';
    return v >= 10 ? String(Math.round(v)) : trimZeros(v.toFixed(1));
  }

  function tradeImbalance(lv, ratio) {
    var buy = Math.max(0, Number(lv && lv.buyVol) || 0);
    var sell = Math.max(0, Number(lv && lv.sellVol) || 0);
    if (!buy && !sell) return null;
    if (buy > sell) {
      var buyRatio = sell > 0 ? buy / sell : Infinity;
      return buyRatio >= ratio ? { side: 'buy', ratio: buyRatio } : null;
    }
    if (sell > buy) {
      var sellRatio = buy > 0 ? sell / buy : Infinity;
      return sellRatio >= ratio ? { side: 'sell', ratio: sellRatio } : null;
    }
    return null;
  }

  function absorptionSignal(lv, ratio) {
    var buy = Math.max(0, Number(lv && lv.buyVol) || 0);
    var sell = Math.max(0, Number(lv && lv.sellVol) || 0);
    var bid = Math.max(0, Number(lv && lv.bidSize) || 0);
    var ask = Math.max(0, Number(lv && lv.askSize) || 0);
    if (sell > 0 && bid >= sell * ratio) return 'bid';
    if (buy > 0 && ask >= buy * ratio) return 'ask';
    return '';
  }

  function computeDomAnalytics(book, minTick, maxTick, settings) {
    var ratio = Math.max(1.5, Math.min(8, Number(settings && settings.imbalanceRatio) || 3));
    var minStack = Math.max(2, Math.min(6, Math.round(Number(settings && settings.imbalanceStack) || 3)));
    var out = {};
    var streak = [];
    var streakSide = '';

    function flushStreak() {
      if (streak.length >= minStack) {
        streak.forEach(function (tick) {
          if (out[tick]) out[tick].stack = streak.length;
        });
      }
      streak = [];
      streakSide = '';
    }

    for (var tick = minTick; tick <= maxTick; tick++) {
      var lv = book.get(String(tick));
      if (!lv) {
        flushStreak();
        continue;
      }
      var im = tradeImbalance(lv, ratio);
      var abs = absorptionSignal(lv, ratio);
      out[tick] = { imbalance: im, stack: 0, absorption: abs };
      if (im && im.side === streakSide) {
        streak.push(tick);
      } else {
        flushStreak();
        if (im) {
          streakSide = im.side;
          streak = [tick];
        }
      }
    }
    flushStreak();
    return out;
  }

  function depthChangeClass(current, previous) {
    current = Math.max(0, Number(current) || 0);
    previous = Math.max(0, Number(previous) || 0);
    if (current > 0 && previous <= 0) return ' is-depth-refresh';
    if (current > previous) return ' is-depth-add';
    if (current < previous) return ' is-depth-cancel';
    return '';
  }

  // ── Value display modes ───────────────────────────────────────────────────
  // The DOM size/volume cells can be shown in several units. 'usd' is the
  // legacy alias of 'notional'.
  function normalizeValueMode(m) {
    if (m === 'usd') return 'notional';
    return (m === 'notional' || m === 'contracts' || m === 'ticks' || m === 'coin') ? m : 'coin';
  }

  // Map a raw base-coin quantity to the value + price arg used by fmt() for the
  // active mode. `price > 0` makes fmt render a USD notional; otherwise the
  // value is rendered as a plain count.
  //   coin      → raw base quantity
  //   notional  → quantity × live price (USD)
  //   contracts → quantity ÷ instrument contract size
  //   ticks     → USD notional ÷ price tick size
  function modeValue(coinQty, mode, live, tickSize, contractSize) {
    var q = Number(coinQty);
    if (!Number.isFinite(q)) q = 0;
    switch (mode) {
      case 'notional':
        return { v: q, price: (Number.isFinite(live) && live > 0) ? live : 0 };
      case 'contracts':
        return { v: (Number.isFinite(contractSize) && contractSize > 0) ? q / contractSize : q, price: 0 };
      case 'ticks':
        return (Number.isFinite(live) && live > 0 && Number.isFinite(tickSize) && tickSize > 0)
          ? { v: q * live / tickSize, price: 0 }
          : { v: q, price: 0 };
      default: // 'coin'
        return { v: q, price: 0 };
    }
  }

  // Format a base-coin value for the active mode. `minCoin` (optional) hides
  // values whose absolute base-coin size is below the noise floor.
  function fmtMode(coinQty, showZero, vctx, minCoin) {
    var q = Number(coinQty);
    if (!Number.isFinite(q)) return '';
    if (q === 0) return showZero ? '0' : '';
    if (minCoin != null && Math.abs(q) < minCoin) return '';
    var mv = modeValue(q, vctx.mode, vctx.live, vctx.tickSize, vctx.contractSize);
    return fmt(mv.v, showZero, mv.price);
  }

  function fmtModeSigned(coinQty, vctx) {
    var q = Number(coinQty);
    if (!Number.isFinite(q) || q === 0) return '';
    var mv = modeValue(Math.abs(q), vctx.mode, vctx.live, vctx.tickSize, vctx.contractSize);
    var body = fmt(mv.v, true, mv.price);
    return body ? (q >= 0 ? '+' : '-') + body : '';
  }

  function renderRow(lv, y, maxBid, maxAsk, liveTick, midTick, bestBidTick, bestAskTick, live, vctx, sizeThreshold, analytics, cols, widths, heat) {
    var isLive    = lv.tick === liveTick;
    var isMid     = lv.tick === midTick;
    var isBestBid = lv.tick === bestBidTick;
    var isBestAsk = lv.tick === bestAskTick;
    var hasBid    = lv.bidSize > 0;
    var hasAsk    = lv.askSize > 0;
    var bidChangeClass = depthChangeClass(lv.bidSize, lv.prevBidSize);
    var askChangeClass = depthChangeClass(lv.askSize, lv.prevAskSize);
    var isEmpty   = !hasBid && !hasAsk && !bidChangeClass && !askChangeClass;

    var cls = 'v6-dom-row';
    if (isMid)     cls += ' is-mid';
    if (isLive)    cls += ' is-live';
    if (isBestBid) cls += ' is-best-bid';
    if (isBestAsk) cls += ' is-best-ask';
    if (hasBid)    cls += ' has-bid';
    if (hasAsk)    cls += ' has-ask';
    if (isEmpty)   cls += ' is-empty';
    if ((Number(lv.delta) || 0) > 0) cls += ' has-delta-pos';
    else if ((Number(lv.delta) || 0) < 0) cls += ' has-delta-neg';
    if (lv.wallScore >= 2) cls += ' is-wall-major';
    else if (lv.wallScore >= 1) cls += ' is-wall-soft';

    var bidPct = hasBid ? Math.max(3, Math.min(100, lv.bidSize / maxBid * 100)).toFixed(1) : '0';
    var askPct = hasAsk ? Math.max(3, Math.min(100, lv.askSize / maxAsk * 100)).toFixed(1) : '0';

    var liveBadge = isLive ? '<span class="v6-dom-live-pill">LIVE ' + fmtPrice(live) + '</span>' : '';
    var marker    = isLive ? '<span class="v6-dom-marker">&#9658;</span>' : '';
    var im        = analytics && analytics.imbalance;
    var imSide    = im && im.side === 'buy' ? 'is-buy' : (im && im.side === 'sell' ? 'is-sell' : '');
    var imText    = im ? (im.side === 'buy' ? 'B ' : 'S ') + fmtRatio(im.ratio) + 'x' : '';
    var stackText = analytics && analytics.stack ? String(analytics.stack) : '';
    var absSide   = analytics && analytics.absorption === 'bid' ? 'is-bid' : (analytics && analytics.absorption === 'ask' ? 'is-ask' : '');
    var absText   = analytics && analytics.absorption === 'bid' ? 'B' : (analytics && analytics.absorption === 'ask' ? 'A' : '');
    var priceText = fmtPrice(lv.price);
    var bidText   = fmtMode(lv.bidSize, false, vctx, sizeThreshold) || '0';
    var askText   = fmtMode(lv.askSize, false, vctx, sizeThreshold) || '0';
    var rowLabel  = 'Price ' + priceText + ', bid ' + bidText + ', ask ' + askText;

    var ctx = {
      lv: lv,
      widths: widths,
      vctx: vctx,
      heat: heat || {},
      bidChangeClass: bidChangeClass,
      askChangeClass: askChangeClass,
      bidPct: bidPct,
      askPct: askPct,
      bidText: bidText,
      askText: askText,
      priceText: priceText,
      marker: marker,
      liveBadge: liveBadge,
      rowLabel: rowLabel,
      imSide: imSide,
      imText: imText,
      stackText: stackText,
      absSide: absSide,
      absText: absText
    };

    var cellsHtml = cols.map(function (c) {
      return COLUMN_DEFS[c] ? COLUMN_DEFS[c].render(ctx) : '';
    }).join('');

    var y_snap = Math.round(y);
    var rowW = Math.max(1, Math.round(widths._total || totalColumnWidth(cols, widths)));
    return '<div class="' + cls + '"' +
      ' style="position:absolute;top:' + y_snap + 'px;left:0;width:' + rowW + 'px;height:' + DOM_ROW_HEIGHT + 'px"' +
      ' data-price-key="' + lv.priceKey + '" role="row" aria-label="' + escAttr(rowLabel) + '">' +
      cellsHtml +
      '</div>';
  }

  // Heatmap intensity → background alpha. 0 = no background (ratio <= 0);
  // otherwise mapped into [HEAT_ALPHA_MIN, HEAT_ALPHA_MAX] so the cell tint
  // never approaches the solid is-live price-cell fill.
  var HEAT_ALPHA_MIN = 0.05;
  var HEAT_ALPHA_MAX = 0.35;

  function heatAlpha(ratio) {
    if (!(ratio > 0)) return 0;
    var clamped = Math.min(1, ratio);
    return HEAT_ALPHA_MIN + clamped * (HEAT_ALPHA_MAX - HEAT_ALPHA_MIN);
  }

  // ── Render virtuel ────────────────────────────────────────────────────────────
  //
  // Architecture :
  //   body (overflow-y: scroll)
  //     └─ .v6-dom-spacer (position:relative, height = totalTicks*rowHeight)
  //          └─ rows (position:absolute, top = rowIndex*rowHeight)
  //
  // Seules les rows visibles + OVERSCAN sont dans le DOM.
  // scrollTop n'est JAMAIS modifie ici — la fenetre viewMin/viewMax est stable.

  function renderVirtual(body, snap, live, settings, cols, widths) {
    if (!body) return;
    if (!cols || !widths) {
      cols = getDomColumns(settings);
      widths = getColumnWidths(cols, settings);
    }

    var book     = snap.book;
    // Support v5 viewMin/viewMax (fallback a minTick/maxTick pour backward compat)
    var minTick  = snap.viewMin != null ? snap.viewMin : snap.minTick;
    var maxTick  = snap.viewMax != null ? snap.viewMax : snap.maxTick;
    var tickSize = snap.tickSize;

    // Validation minimale
    if (!book || !book.size || !Number.isFinite(minTick) || !Number.isFinite(maxTick) || minTick >= maxTick) return;

    var totalTicks  = maxTick - minTick + 1;
    var totalHeight = totalTicks * DOM_ROW_HEIGHT;

    // 1. Init / re-init si le spacer a ete detache
    //    NOTE: on ne detruit PLUS le spacer pour "Waiting for orderbook"
    var needsInit = !body._domVirtual ||
                    !body._domVirtual.spacer ||
                    !body.contains(body._domVirtual.spacer);

    if (needsInit) {
      body.innerHTML = '<div class="v6-dom-spacer"></div>';
      body._domVirtual = {
        spacer      : body.querySelector('.v6-dom-spacer'),
        lastH       : 0,
        lastViewMin : minTick,
        lastViewMax : maxTick
      };
      body._domNeedsCenter = true;
    }

    var virt = body._domVirtual;

    // 2. Detecter si la fenetre a change (decalage du mid au-dela du seuil)
    //    Dans ce cas, ajuster le scrollTop pour suivre le mid sans saut visible
    var viewChanged = (virt.lastViewMin !== minTick || virt.lastViewMax !== maxTick);

    if (body._domNeedsJump != null) {
      // A jump to price was explicitly requested.
      // Bypass the normal proportional view-change scroll adjustment.
      virt.lastViewMin = minTick;
      virt.lastViewMax = maxTick;
      body._domNeedsJump = null;
    } else if (viewChanged) {
      // La fenetre a ete decalee — ajuster scrollTop proportionnellement
      var deltaMin = minTick - virt.lastViewMin;
      var adjusted = body.scrollTop - deltaMin * DOM_ROW_HEIGHT;
      if (adjusted >= 0) {
        suppressScrollUntil = Date.now() + 80;
        body.scrollTop = adjusted;
      }
      virt.lastViewMin = minTick;
      virt.lastViewMax = maxTick;
    }

    // 3. Fenetre visible — deux modes de rendu.
    //  • Following (autoCenter): le ladder est epingle au mid et N'UTILISE PAS le
    //    scroll natif. Les rows sont positionnees relativement au haut du viewport
    //    et le spacer = hauteur du viewport. C'est immunise contre les resets de
    //    scrollTop qu'un book live qui se met a jour / se retrecit provoque (ce qui
    //    vidait le ladder, notamment apres un resize).
    //  • Manuel: modele virtual-scroll classique (grand spacer + offsets absolus).
    var viewport = body.clientHeight;
    if (!(viewport > 0)) viewport = DOM_ROW_HEIGHT * 20;

    var following = autoCenter && !userScrolled && Number.isFinite(snap.midTick);
    var firstRow, lastRow, rowOffsetBase, spacerH;

    if (following) {
      var visN       = Math.ceil(viewport / DOM_ROW_HEIGHT) + 2;
      var midIdx     = maxTick - snap.midTick;
      var centerSlot = Math.round((viewport * 0.48) / DOM_ROW_HEIGHT);
      firstRow      = Math.max(0, midIdx - centerSlot);
      lastRow       = Math.min(totalTicks - 1, firstRow + visN);
      rowOffsetBase = firstRow;   // rows positioned relative to the viewport top
      spacerH       = viewport;   // container does not scroll
      if (body.scrollTop !== 0) { suppressScrollUntil = Date.now() + 120; body.scrollTop = 0; }
    } else {
      var scrollTop = body.scrollTop;
      firstRow      = Math.max(0, Math.floor(scrollTop / DOM_ROW_HEIGHT) - OVERSCAN);
      lastRow       = Math.min(totalTicks - 1, firstRow + Math.ceil(viewport / DOM_ROW_HEIGHT) + OVERSCAN * 2);
      rowOffsetBase = 0;          // absolute offsets within the tall spacer
      spacerH       = totalHeight;
    }

    if (virt.lastH !== spacerH) {
      virt.spacer.style.height = spacerH + 'px';
      virt.lastH = spacerH;
    }
    var totalW = Math.max(1, Math.round(widths._total || totalColumnWidth(cols, widths)));
    // Ensure spacer width is always valid: fallback to container width or 300px minimum
    var containerW = body.clientWidth || 0;
    if (totalW < containerW || !Number.isFinite(totalW)) totalW = Math.max(containerW, 300);
    virt.spacer.style.minWidth = totalW + 'px';
    virt.spacer.style.width = totalW + 'px';
    virt.spacer.style.backgroundImage = columnBoundaryBackground(cols, widths);

    var startTick = maxTick - firstRow;
    var endTick   = maxTick - lastRow;

    // 5. Max bid/ask pour les barres.
    // book: stable viewMin/viewMax, visible: rows currently rendered in the scroll window.
    var scaleMinTick = (settings && settings.domScaleMode) === 'visible' ? endTick : minTick;
    var scaleMaxTick = (settings && settings.domScaleMode) === 'visible' ? startTick : maxTick;
    var maxBid = 1, maxAsk = 1, maxVol = 1, maxSell = 1, maxBuy = 1, maxAbsDelta = 1;
    book.forEach(function (lv) {
      if (lv.tick < scaleMinTick || lv.tick > scaleMaxTick) return;
      if (lv.bidSize > maxBid) maxBid = lv.bidSize;
      if (lv.askSize > maxAsk) maxAsk = lv.askSize;
      var bv = Number(lv.buyVol) || 0;
      var sv = Number(lv.sellVol) || 0;
      var vol = bv + sv;
      if (vol > maxVol) maxVol = vol;
      if (sv > maxSell) maxSell = sv;
      if (bv > maxBuy) maxBuy = bv;
      var ad = Math.abs(Number(lv.delta) || 0);
      if (ad > maxAbsDelta) maxAbsDelta = ad;
    });

    // 6. Parametres de rendu
    var valueMode   = normalizeValueMode(settings && settings.domValueMode);
    // contractSize comes from instrument metadata on the snapshot (default 1 for
    // base-coin venues like Binance USDT / Hyperliquid).
    var contractSize = (snap && Number(snap.contractSize) > 0) ? Number(snap.contractSize) : 1;
    var vctx        = { mode: valueMode, live: live, tickSize: tickSize, contractSize: contractSize };
    // Bid/ask noise filter is always evaluated in base-coin units (instrument-
    // aware via settings.domMinNotionalUsd ÷ price) so the same notional floor
    // applies regardless of the active display mode.
    var sizeThreshold = computeSizeThreshold(settings, false, live);
    var liveTick    = (Number.isFinite(live) && live > 0 && tickSize > 0)
                        ? Math.round(live / tickSize)
                        : snap.midTick;
    var midTick     = snap.midTick;
    var bestBidTick = snap.bestBidTick;
    var bestAskTick = snap.bestAskTick;
    var analyticsByTick = computeDomAnalytics(book, minTick, maxTick, settings);

    // 7. Generation du HTML
    var html = '';
    for (var tick = startTick; tick >= endTick; tick--) {
      var rowIndex = maxTick - tick;
      // Following: positioned relative to the viewport top (rowOffsetBase=firstRow).
      // Manual: absolute offset within the tall spacer (rowOffsetBase=0).
      var y        = (rowIndex - rowOffsetBase) * DOM_ROW_HEIGHT;
      var pk       = String(tick);
      var lv       = book.get(pk);
      if (!lv) {
        lv = {
          priceKey: pk, tick: tick, price: tick * tickSize,
          bidSize: 0, askSize: 0, buyVol: 0, sellVol: 0, delta: 0,
          wallScore: 0, bidWallScore: 0, askWallScore: 0
        };
      }
      var heat = {
        vol: heatAlpha(((Number(lv.buyVol) || 0) + (Number(lv.sellVol) || 0)) / maxVol),
        sell: heatAlpha((Number(lv.sellVol) || 0) / maxSell),
        buy: heatAlpha((Number(lv.buyVol) || 0) / maxBuy),
        delta: heatAlpha(Math.abs(Number(lv.delta) || 0) / maxAbsDelta)
      };
      html += renderRow(lv, y, maxBid, maxAsk, liveTick, midTick, bestBidTick, bestAskTick, live, vctx, sizeThreshold, analyticsByTick[tick], cols, widths, heat);
    }

    virt.spacer.innerHTML = html;
  }

  // ── Follow : centrage smooth sur le mid ──
  // Appele APRES renderVirtual, quand autoCenter est actif.

  function followMid(body, snap, settings) {
    if (!body || !snap) return;
    if (!autoCenter || userScrolled) return;

    var midTick = snap.midTick;
    var maxTick = snap.viewMax != null ? snap.viewMax : snap.maxTick;
    if (!Number.isFinite(midTick) || !Number.isFinite(maxTick)) return;

    var threshold = Math.max(1, Math.min(20, Math.round(Number(settings && settings.domFollowThresholdTicks) || 1)));
    // Re-center when the mid moves past the threshold OR when the mid row is not
    // currently on screen. The second condition is essential: after the book
    // window shifts (e.g. a wide live depth snapshot replaces a narrow REST one),
    // the ladder can be left scrolled to the top with the mid far off-screen; if
    // the mid is then stable, a move-only check would never recenter → blank ladder.
    var midOffset = (maxTick - midTick) * DOM_ROW_HEIGHT;
    var viewport  = body.clientHeight || 0;
    var midVisible = viewport > 0 &&
      midOffset >= body.scrollTop &&
      midOffset <= body.scrollTop + viewport - DOM_ROW_HEIGHT;
    var moved = lastMidTick == null || Math.abs(midTick - lastMidTick) >= threshold;
    if (!moved && midVisible) return;
    lastMidTick = midTick;

    followPending = { body: body, midTick: midTick, maxTick: maxTick };
    if (followRaf) return;
    followRaf = requestAnimationFrame(function () {
      var pending = followPending;
      followRaf = null;
      followPending = null;
      if (!pending || !pending.body || !pending.body.isConnected) return;
      // Instant (not smooth): a smooth scroll animates over ~600ms while the
      // virtual window is re-rendered from an early, low scrollTop, leaving the
      // rows stranded off-screen. Snapping fires a single scroll → one aligned
      // re-render, so the ladder always shows the mid band.
      centerOnTick(pending.body, pending.midTick, pending.maxTick, false);
    });
  }

  // ── Point d'entree public ─────────────────────────────────────────────────────

  function render(container, snap, state) {
    if (!container) return;
    state    = state || {};
    var settings = state.settings || {};

    var groupOpts = V6OF.DomLadder && V6OF.DomLadder.getGroupingOptions
      ? V6OF.DomLadder.getGroupingOptions() : [1, 5, 10, 25, 50, 100, 250];

    // Detect Exocharts layout (container IS .exo-dom-body, headers live in .exo-dom-head)
    var isExo = container.classList.contains && container.classList.contains('exo-dom-body');
    var exoHead = isExo ? container.parentElement && container.parentElement.querySelector('.exo-dom-head') : null;

    // Skeleton (une seule fois)
    if (!container._domBuilt) {
      var grouping = (snap && snap.priceGrouping) || 25;
      if (isExo) {
        // Minimal: just ensure the body is a scrollable container for rows
        container.innerHTML = '';
        container.style.overflowY = 'auto';
        // Populate the grouping select (in parent .exo-dom-toolbar)
        var groupingSelect = container.parentElement && container.parentElement.querySelector('.exo-dom-grouping');
        if (groupingSelect && !groupingSelect._populated) {
          groupingSelect.innerHTML = groupOpts.map(function (g) {
            return '<option value="' + g + '"' + (g === grouping ? ' selected' : '') + '>' + g + '</option>';
          }).join('');
          groupingSelect._populated = true;
        }
      } else {
        buildSkeleton(container, grouping, groupOpts);
      }
      container._domBuilt = true;
    }

    var cols = getDomColumns(settings);
    var widths = getColumnWidths(cols, settings);

    // Update header columns dynamically
    var colsContainer = isExo ? exoHead : container.querySelector('.v6-dom-cols');
    if (colsContainer) {
      var headerHtml = renderHeadersHtml(cols, widths);
      if (colsContainer.innerHTML !== headerHtml) {
        colsContainer.innerHTML = headerHtml;
      }
    }

    var body = isExo ? container : container.querySelector('.v6-dom-body');

    // ── Etat "pas encore de book" ──
    // NOTE: on ne detruit PLUS le DOM virtuel. On garde le dernier rendu visible.
    var bookEmpty = !snap || !snap.book || !snap.book.size ||
                    !Number.isFinite(snap.minTick) || !Number.isFinite(snap.maxTick) ||
                    snap.minTick >= snap.maxTick;

    if (bookEmpty) {
      var aboveEl = container.querySelector('[data-dom-activity-above]');
      var belowEl = container.querySelector('[data-dom-activity-below]');
      if (aboveEl) { aboveEl.hidden = true; aboveEl.classList.remove('is-visible'); }
      if (belowEl) { belowEl.hidden = true; belowEl.classList.remove('is-visible'); }

      // Premier render sans aucune donnee : afficher le placeholder
      if (!container._domHasCentered) {
        if (body) {
          body.innerHTML = '<div class="v6-dom-empty">Waiting for order book\u2026</div>';
        }
        setStaleOverlay(container, true, 'Waiting for first order book update');
        setStat(container, 'source', sourceLabel(state, snap));
        setStat(container, 'age', '-');
        setStat(container, 'live', '-');
      } else {
        var lastTs = (container._domLastSnap && container._domLastSnap.lastUpdate) || state.lastOrderBookTs || 0;
        var staleText = lastTs ? 'Last valid book ' + fmtAge(lastTs) + ' ago. Keeping previous rows visible.'
          : 'No fresh order book. Keeping previous rows visible.';
        setStaleOverlay(container, true, staleText);
        setStat(container, 'age', fmtAge(lastTs));
      }
      // Sinon : on garde l'ancien rendu visible, pas de flash
      return;
    }

    // ── Throttle ──
    var live = livePrice(state, snap);
    setStaleOverlay(container, false);
    renderStats(container, snap, state, live, settings);
    container._domLastSnap  = snap;
    container._domLastState = state;
    container._domLastLive  = live;

    var now = Date.now();
    var shouldRefreshRows = !container._domLastRowsRender || now - container._domLastRowsRender >= RENDER_THROTTLE;
    if (!shouldRefreshRows) return;
    container._domLastRowsRender = now;

    // ── Render virtuel (ne touche PAS scrollTop sauf decalage de fenetre) ──
    renderVirtual(body, snap, live, settings, cols, widths);

    // ── Activity above / below stable window ──
    var aboveEl = container.querySelector('[data-dom-activity-above]');
    var belowEl = container.querySelector('[data-dom-activity-below]');
    if (aboveEl && belowEl && snap) {
      var showAbove = snap.viewMax > 0 && snap.dataMax > snap.viewMax;
      var showBelow = snap.viewMin > 0 && snap.dataMin > 0 && snap.dataMin < snap.viewMin;
      aboveEl.hidden = !showAbove;
      aboveEl.classList.toggle('is-visible', !!showAbove);
      belowEl.hidden = !showBelow;
      belowEl.classList.toggle('is-visible', !!showBelow);
    }

    // ── Follow smooth (si autoCenter) ──
    followMid(body, snap, settings);

    // ── Stats header ──
    setStat(container, 'source', sourceLabel(state, snap));
    setStat(container, 'age',    fmtAge(state.lastOrderBookTs || snap.lastUpdate));
    setStat(container, 'live',   fmtPrice(live));
    setStat(container, 'mid',    fmtPrice(snap.midPrice));
    setStat(container, 'spread', fmtPrice(snap.spread));
    setStat(container, 'depth',  bookDepth(state, snap));
    setStat(container, 'seq',    domSequenceLabel(snap));
    setStat(container, 'gap',    String(domGapCount(snap)));
    setStat(container, 'drop',   String(domDroppedCount(state, snap)));
    syncControls(container, snap.priceGrouping || 25, settings);

    // ── Memorisation pour le scroll handler ──
    container._domLastSnap  = snap;
    container._domLastState = state;
    container._domLastLive  = live;

    // Toggle active class on recenter button based on autoCenter
    var recenterBtn = container.querySelector('.v6-dom-recenter');
    if (recenterBtn) {
      recenterBtn.classList.toggle('is-active', !!autoCenter);
    }

    // ── Auto-center : UNE SEULE FOIS au premier render ──
    if (!container._domHasCentered || (body && body._domNeedsCenter)) {
      container._domHasCentered = true;
      if (body) body._domNeedsCenter = false;
      var midTick = snap.midTick;
      var maxTick = snap.viewMax != null ? snap.viewMax : snap.maxTick;
      if (body && Number.isFinite(midTick) && Number.isFinite(maxTick)) {
        if (V6OF.DomLadder && V6OF.DomLadder.setAutoCenterEnabled) {
          V6OF.DomLadder.setAutoCenterEnabled(true);
        }
        autoCenter = true;
        userScrolled = false;
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            centerOnTick(body, midTick, maxTick, false);
            renderVirtual(body, snap, live, settings);
          });
        });
      }
    }
  }

  // ── bindControls ─────────────────────────────────────────────────────────────

  function bindControls(container, onGroupChange, onRecenter, onSettingsPatch) {
    if (!container || container._domControlsBound) return;
    container._domControlsBound = true;
    var isExo = container.classList.contains && container.classList.contains('exo-dom-body');
    // In Exocharts layout, the toolbar (grouping select) is a sibling of container,
    // so we delegate events from the parent .exo-dom-panel instead.
    var eventTarget = isExo ? (container.parentElement || container) : container;

    // Grouping + mode
    eventTarget.addEventListener('change', function (event) {
      var target = event.target;
      if (!target || !target.classList) return;
      if ((target.classList.contains('v6-dom-grouping') || target.classList.contains('exo-dom-grouping')) && onGroupChange) {
        autoCenter   = true;
        userScrolled = false;
        container._domHasCentered = false;
        if (V6OF.DomLadder && V6OF.DomLadder.setAutoCenterEnabled) {
          V6OF.DomLadder.setAutoCenterEnabled(true);
        }
        onGroupChange(Number(target.value));
      }
    });

    // Go to price form submit
    var gotoForm = container.querySelector('.v6-dom-goto-form');
    if (gotoForm) {
      gotoForm.addEventListener('submit', function (event) {
        event.preventDefault();
        var input = gotoForm.querySelector('.v6-dom-goto-input');
        if (!input) return;
        var val = input.value.trim();
        if (!val) return;
        var price = parseFloat(val);
        if (isNaN(price) || price <= 0) {
          input.value = '';
          return;
        }

        // De-activate auto-centering
        autoCenter   = false;
        userScrolled = true;
        if (V6OF.DomLadder && V6OF.DomLadder.setAutoCenterEnabled) {
          V6OF.DomLadder.setAutoCenterEnabled(false);
        }

        var tick = V6OF.DomLadder.priceToTick(price);
        if (Number.isFinite(tick) && tick > 0) {
          V6OF.DomLadder.centerWindowOnTick(tick);
          var snap = V6OF.DomLadder.snapshot();
          var live = container._domLastLive || 0;
          var settings = (container._domLastState && container._domLastState.settings) || {};

          var body = getBody(container);
          if (body) {
            body._domNeedsJump = tick;
            renderVirtual(body, snap, live, settings);
            centerOnTick(body, tick, snap.viewMax, false);
          }
        }
        input.value = '';
        input.blur();
      });
    }

    // Helper: in Exocharts layout the container IS the scrollable body
    function getBody(ctn) {
      return (ctn.classList.contains && ctn.classList.contains('exo-dom-body')) ? ctn : ctn.querySelector('.v6-dom-body');
    }

    // Bouton C (recenter) + bouton mode coin/$
    container.addEventListener('click', function (event) {
      var target = event.target;
      if (!target) return;
      if (target.closest('.v6-dom-recenter')) {
        autoCenter   = true;
        userScrolled = false;
        container._domHasCentered = false;
        if (V6OF.DomLadder && V6OF.DomLadder.setAutoCenterEnabled) {
          V6OF.DomLadder.setAutoCenterEnabled(true);
        }
        if (onRecenter) onRecenter();
        var body = getBody(container);
        if (body && container._domLastSnap) {
          var s = container._domLastSnap;
          centerOnTick(body, s.midTick, s.maxTick, true);
          requestAnimationFrame(function () {
            renderVirtual(body, s, container._domLastLive || 0,
              (container._domLastState && container._domLastState.settings) || {});
          });
        }
      }
      if (target.closest('.v6-dom-value-mode') && onSettingsPatch) {
        onSettingsPatch({ domValueMode: normalizeValueMode(target.value) });
      }
    });

    // Scroll → re-render virtuel + detection user scroll
    var body = getBody(container);
    if (body) {
      body.addEventListener('scroll', function () {
        // suppressScrollUntil covers programmatic scrolls (centerOnTick / follow).
        // It must ONLY skip the "user disabled auto-follow" side effect — the
        // virtual window must STILL be re-rendered so rows stay aligned with the
        // new scrollTop (otherwise an auto-center leaves rows stranded off-screen).
        var suppressed = Date.now() < suppressScrollUntil;

        // L'utilisateur a scrolle manuellement → desactiver auto-follow
        if (!suppressed && !userScrolled) {
          userScrolled = true;
          autoCenter   = false;
          if (V6OF.DomLadder && V6OF.DomLadder.setAutoCenterEnabled) {
            V6OF.DomLadder.setAutoCenterEnabled(false);
          }
          scheduleFollowReturn(container);
        }

        if (!container._domScrollRaf && container._domLastSnap) {
          container._domScrollRaf = requestAnimationFrame(function () {
            container._domScrollRaf = null;
            var s = container._domLastSnap;
            if (!s) return;
            renderVirtual(body, s, container._domLastLive || 0,
              (container._domLastState && container._domLastState.settings) || {});
          });
        }
      }, { passive: true });

      // Mouse wheel → detection scroll utilisateur. Leaving follow mode switches
      // from the viewport-relative model to the scroll model; anchor the scroll at
      // the mid first so the view doesn't snap to the top of the book.
      body.addEventListener('wheel', function () {
        if (!userScrolled) {
          userScrolled = true;
          autoCenter   = false;
          if (V6OF.DomLadder && V6OF.DomLadder.setAutoCenterEnabled) {
            V6OF.DomLadder.setAutoCenterEnabled(false);
          }
          var s = container._domLastSnap;
          if (s) {
            var settings = (container._domLastState && container._domLastState.settings) || {};
            var live = container._domLastLive || 0;
            renderVirtual(body, s, live, settings); // grow spacer to full height
            var maxTickL = s.viewMax != null ? s.viewMax : s.maxTick;
            if (Number.isFinite(s.midTick) && Number.isFinite(maxTickL)) {
              var midOff = (maxTickL - s.midTick) * DOM_ROW_HEIGHT;
              suppressScrollUntil = Date.now() + 150;
              body.scrollTop = Math.max(0, midOff - body.clientHeight / 2);
              renderVirtual(body, s, live, settings); // render window at the anchored scroll
            }
          }
          scheduleFollowReturn(container);
        }
      }, { passive: true });

      // Resize → re-render (which re-centers on the mid). A window/dock/panel
      // resize changes the body height and resets scrollTop; without this the
      // ladder stays blank until the next order-book tick happens to re-render.
      if (typeof ResizeObserver === 'function' && !body._domResizeObs) {
        var roRaf = null;
        body._domResizeObs = new ResizeObserver(function () {
          if (roRaf) return;
          roRaf = requestAnimationFrame(function () {
            roRaf = null;
            var s = container._domLastSnap;
            if (!s || !body.isConnected) return;
            renderVirtual(body, s, container._domLastLive || 0,
              (container._domLastState && container._domLastState.settings) || {});
          });
        });
        body._domResizeObs.observe(body);
      }
    }
  }

  var Panels = V6OF.Panels = V6OF.Panels || {};
  Panels.wireDomDragDrop = function (root, store) {
    var domList = root.querySelector('[data-v6-dom-list]');
    if (!domList) return;

    var headerRow = domList.querySelector('.v6-dom-cols') || root.querySelector('.exo-dom-head');
    if (!headerRow) return;

    if (headerRow._dragBound) return;
    headerRow._dragBound = true;

    var draggedCol = null;
    var resizeState = null;

    function currentColumns(settings) {
      return getDomColumns(settings || {});
    }

    function currentWidths(settings, cols) {
      return getColumnWidths(cols || currentColumns(settings), settings || {});
    }

    headerRow.addEventListener('mousedown', function (e) {
      var handle = e.target.closest('[data-dom-col-resize]');
      if (!handle) return;
      e.preventDefault();
      e.stopPropagation();
      var col = handle.getAttribute('data-dom-col-resize');
      var settings = store.getState().settings || {};
      var cols = currentColumns(settings);
      var widths = currentWidths(settings, cols);
      resizeState = {
        col: col,
        startX: e.clientX,
        startWidth: parseFloat(widths[col]) || DOM_REFERENCE_COLUMN_WIDTHS[col] || 42,
        widths: Object.assign({}, settings.domColumnWidths || {})
      };
      handle.classList.add('is-dragging');
      document.body.classList.add('is-resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', function (e) {
      if (!resizeState) return;
      var delta = e.clientX - resizeState.startX;
      var next = clampColumnWidth(resizeState.startWidth + delta, resizeState.startWidth);
      resizeState.widths[resizeState.col] = next;
      if (!resizeState._raf) {
        resizeState._raf = requestAnimationFrame(function () {
          resizeState._raf = null;
          store.updateSettings({ domColumnWidths: Object.assign({}, resizeState.widths) });
        });
      }
    });

    document.addEventListener('mouseup', function () {
      if (!resizeState) return;
      var active = headerRow.querySelector('[data-dom-col-resize].is-dragging');
      if (active) active.classList.remove('is-dragging');
      resizeState = null;
      document.body.classList.remove('is-resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });

    headerRow.addEventListener('dragstart', function (e) {
      if (e.target.closest('[data-dom-col-resize]')) {
        e.preventDefault();
        return;
      }
      var target = e.target.closest('.v6-dom-col');
      if (!target) return;
      draggedCol = target.getAttribute('data-col');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedCol);
      target.classList.add('v6-dragging');
    });

    headerRow.addEventListener('dragover', function (e) {
      e.preventDefault();
      var target = e.target.closest('.v6-dom-col');
      if (target && target.getAttribute('data-col') !== draggedCol) {
        target.classList.add('v6-drop-target');
      }
    });

    headerRow.addEventListener('dragenter', function (e) {
      e.preventDefault();
    });

    headerRow.addEventListener('dragleave', function (e) {
      var target = e.target.closest('.v6-dom-col');
      if (target) {
        target.classList.remove('v6-drop-target');
      }
    });

    headerRow.addEventListener('dragend', function (e) {
      var cols = headerRow.querySelectorAll('.v6-dom-col');
      cols.forEach(function (c) {
        c.classList.remove('v6-dragging');
        c.classList.remove('v6-drop-target');
      });
      draggedCol = null;
    });

    headerRow.addEventListener('drop', function (e) {
      e.preventDefault();
      var target = e.target.closest('.v6-dom-col');
      if (!target) return;
      var targetCol = target.getAttribute('data-col');
      if (!draggedCol || draggedCol === targetCol) return;

      var settings = store.getState().settings || {};
      var cols = settings.domColumns ? settings.domColumns.slice() : ['bid', 'price', 'ask', 'buy', 'sell', 'delta', 'imb', 'stack', 'abs'];

      var srcIdx = cols.indexOf(draggedCol);
      var tgtIdx = cols.indexOf(targetCol);

      if (srcIdx !== -1 && tgtIdx !== -1) {
        cols.splice(srcIdx, 1);
        var insertIdx = cols.indexOf(targetCol);
        if (srcIdx > tgtIdx) {
          cols.splice(insertIdx, 0, draggedCol);
        } else {
          cols.splice(insertIdx + 1, 0, draggedCol);
        }
        store.updateSettings({ domColumns: cols });
      }

      target.classList.remove('v6-drop-target');
    });
  };

  // ── API publique ──
  V6OF.register('UI', 'DomPanel', {
    render       : render,
    bindControls : bindControls,
    computeSizeThreshold : computeSizeThreshold,
    modeValue    : modeValue,
    normalizeValueMode : normalizeValueMode
  }, 'DomPanel');

})();
