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

  var DOM_ROW_HEIGHT  = 20;  // px
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
  }

  // ── Scroll / Follow ─────────────────────────────────────────────────────────

  var suppressScrollUntil = 0;
  var autoCenter   = true;
  var userScrolled = false;
  var lastMidTick  = null;      // pour detecter le mouvement du mid
  var followRaf    = null;
  var followPending = null;

  function scheduleFollowReturn(container) {
    if (!container) return;
    if (container._domScrollTimer) clearTimeout(container._domScrollTimer);
    container._domScrollTimer = setTimeout(function () {
      userScrolled = false;
      autoCenter   = true;
    }, 4000);
  }

  // ── Center on a tick (smooth si le mid a bouge, instant sinon) ──

  function centerOnTick(body, tick, maxTick, smooth) {
    if (!body || tick == null) return;
    var rowIndex     = maxTick - tick;
    var targetCenter = Math.max(0, Math.round((body.clientHeight - DOM_ROW_HEIGHT) * 0.48));
    var nextTop      = Math.max(0, rowIndex * DOM_ROW_HEIGHT - targetCenter);
    suppressScrollUntil = Date.now() + (smooth ? 600 : 100);
    if (typeof body.scrollTo === 'function') {
      body.scrollTo({ top: nextTop, behavior: smooth ? 'smooth' : 'auto' });
    } else {
      body.scrollTop = nextTop;
    }
    setTimeout(function () { if (Date.now() >= suppressScrollUntil) suppressScrollUntil = 0; },
      smooth ? 660 : 120);
  }

  // ── Skeleton HTML ─────────────────────────────────────────────────────────────

  function buildSkeleton(container, grouping, groupOpts) {
    container.innerHTML =
      '<div class="v6-dom-header">' +
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
      '</div>' +
      '<div class="v6-dom-cols">' +
        '<div class="v6-dom-col v6-dom-col-bid">BIDS</div>' +
        '<div class="v6-dom-col v6-dom-col-price">PRICE</div>' +
        '<div class="v6-dom-col v6-dom-col-ask">ASKS</div>' +
        '<div class="v6-dom-col v6-dom-col-buy">BUYS</div>' +
        '<div class="v6-dom-col v6-dom-col-sell">SELLS</div>' +
        '<div class="v6-dom-col v6-dom-col-delta">DELTA</div>' +
        '<div class="v6-dom-col v6-dom-col-imb">IMB</div>' +
        '<div class="v6-dom-col v6-dom-col-stack">STK</div>' +
        '<div class="v6-dom-col v6-dom-col-abs">ABS</div>' +
      '</div>' +
      '<div class="v6-dom-body" role="grid" aria-label="Depth of market price ladder"></div>' +
      '<div class="v6-dom-stale-overlay" data-dom-stale-overlay hidden aria-live="polite">' +
        '<strong>Stale DOM</strong><span data-dom-stale-text>Waiting for order book</span>' +
      '</div>' +
      '<div class="v6-dom-footer">' +
        '<label class="v6-dom-glbl">Group <select class="v6-dom-grouping">' +
          groupOpts.map(function (g) {
            return '<option value="' + g + '"' + (g === grouping ? ' selected' : '') + '>' + g + '</option>';
          }).join('') +
        '</select></label>' +
        '<label class="v6-dom-glbl v6-dom-value-mode-wrap">Val <select class="v6-dom-value-mode" title="Value display mode">' +
          '<option value="coin">Coin</option>' +
          '<option value="notional">Notional</option>' +
          '<option value="contracts">Contracts</option>' +
          '<option value="ticks">Ticks</option>' +
        '</select></label>' +
      '</div>';
  }

  function setStat(container, name, value) {
    var el = container.querySelector('[data-dom-stat="' + name + '"]');
    if (el && el.textContent !== String(value)) el.textContent = String(value);
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
    var sel = container.querySelector('.v6-dom-grouping');
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

  function renderRow(lv, y, maxBid, maxAsk, liveTick, midTick, bestBidTick, bestAskTick, live, vctx, sizeThreshold, analytics) {
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

    return '<div class="' + cls + '"' +
      ' style="position:absolute;top:' + y + 'px;left:0;right:0;height:' + DOM_ROW_HEIGHT + 'px"' +
      ' data-price-key="' + lv.priceKey + '" role="row" aria-label="' + escAttr(rowLabel) + '">' +
      '<div class="v6-dom-cell v6-dom-cell-bid' + bidChangeClass + '" role="gridcell" tabindex="0" aria-label="' + escAttr('Bid size ' + bidText + ' at price ' + priceText) + '">' +
        '<div class="v6-dom-bar is-bid" style="width:' + bidPct + '%"></div>' +
        '<span class="v6-dom-val">' + (bidText === '0' ? '' : bidText) + '</span>' +
      '</div>' +
      '<div class="v6-dom-cell v6-dom-cell-price" role="gridcell" tabindex="0" aria-label="' + escAttr(rowLabel) + '">' + marker + priceText + liveBadge + '</div>' +
      '<div class="v6-dom-cell v6-dom-cell-ask' + askChangeClass + '" role="gridcell" tabindex="0" aria-label="' + escAttr('Ask size ' + askText + ' at price ' + priceText) + '">' +
        '<div class="v6-dom-bar is-ask" style="width:' + askPct + '%"></div>' +
        '<span class="v6-dom-val">' + (askText === '0' ? '' : askText) + '</span>' +
      '</div>' +
      '<div class="v6-dom-cell v6-dom-cell-buy">'   + fmtMode(lv.buyVol,  false, vctx) + '</div>' +
      '<div class="v6-dom-cell v6-dom-cell-sell">'  + fmtMode(lv.sellVol, false, vctx) + '</div>' +
      '<div class="v6-dom-cell v6-dom-cell-delta">' + fmtModeSigned(lv.delta, vctx)    + '</div>' +
      '<div class="v6-dom-cell v6-dom-cell-imb ' + imSide + '">' + imText + '</div>' +
      '<div class="v6-dom-cell v6-dom-cell-stack ' + imSide + '">' + stackText + '</div>' +
      '<div class="v6-dom-cell v6-dom-cell-abs ' + absSide + '">' + absText + '</div>' +
    '</div>';
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

  function renderVirtual(body, snap, live, settings) {
    if (!body) return;

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

    if (viewChanged) {
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

    // 3. Mise a jour hauteur spacer
    if (virt.lastH !== totalHeight) {
      virt.spacer.style.height = totalHeight + 'px';
      virt.lastH = totalHeight;
    }

    // 4. Calcul de la fenetre visible
    var scrollTop    = body.scrollTop;
    var viewport     = body.clientHeight;
    if (!(viewport > 0)) viewport = DOM_ROW_HEIGHT * 20;

    var firstRow    = Math.max(0, Math.floor(scrollTop / DOM_ROW_HEIGHT) - OVERSCAN);
    var visibleRows = Math.ceil(viewport / DOM_ROW_HEIGHT) + OVERSCAN * 2;
    var lastRow     = Math.min(totalTicks - 1, firstRow + visibleRows);

    var startTick = maxTick - firstRow;
    var endTick   = maxTick - lastRow;

    // 5. Max bid/ask pour les barres.
    // book: stable viewMin/viewMax, visible: rows currently rendered in the scroll window.
    var scaleMinTick = (settings && settings.domScaleMode) === 'visible' ? endTick : minTick;
    var scaleMaxTick = (settings && settings.domScaleMode) === 'visible' ? startTick : maxTick;
    var maxBid = 1, maxAsk = 1;
    book.forEach(function (lv) {
      if (lv.tick < scaleMinTick || lv.tick > scaleMaxTick) return;
      if (lv.bidSize > maxBid) maxBid = lv.bidSize;
      if (lv.askSize > maxAsk) maxAsk = lv.askSize;
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
      var y        = rowIndex * DOM_ROW_HEIGHT;
      var pk       = String(tick);
      var lv       = book.get(pk);
      if (!lv) {
        lv = {
          priceKey: pk, tick: tick, price: tick * tickSize,
          bidSize: 0, askSize: 0, buyVol: 0, sellVol: 0, delta: 0,
          wallScore: 0, bidWallScore: 0, askWallScore: 0
        };
      }
      html += renderRow(lv, y, maxBid, maxAsk, liveTick, midTick, bestBidTick, bestAskTick, live, vctx, sizeThreshold, analyticsByTick[tick]);
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
    if (lastMidTick != null && Math.abs(midTick - lastMidTick) < threshold) return;
    lastMidTick = midTick;

    followPending = { body: body, midTick: midTick, maxTick: maxTick };
    if (followRaf) return;
    followRaf = requestAnimationFrame(function () {
      var pending = followPending;
      followRaf = null;
      followPending = null;
      if (!pending || !pending.body || !pending.body.isConnected) return;
      centerOnTick(pending.body, pending.midTick, pending.maxTick, true);
    });
  }

  // ── Point d'entree public ─────────────────────────────────────────────────────

  function render(container, snap, state) {
    if (!container) return;
    state    = state || {};
    var settings = state.settings || {};

    var groupOpts = V6OF.DomLadder && V6OF.DomLadder.getGroupingOptions
      ? V6OF.DomLadder.getGroupingOptions() : [1, 5, 10, 25, 50, 100, 250];

    // Skeleton (une seule fois)
    if (!container._domBuilt) {
      var grouping = (snap && snap.priceGrouping) || 25;
      buildSkeleton(container, grouping, groupOpts);
      container._domBuilt = true;
    }

    var body = container.querySelector('.v6-dom-body');

    // ── Etat "pas encore de book" ──
    // NOTE: on ne detruit PLUS le DOM virtuel. On garde le dernier rendu visible.
    var bookEmpty = !snap || !snap.book || !snap.book.size ||
                    !Number.isFinite(snap.minTick) || !Number.isFinite(snap.maxTick) ||
                    snap.minTick >= snap.maxTick;

    if (bookEmpty) {
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
    renderVirtual(body, snap, live, settings);

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

    // ── Auto-center : UNE SEULE FOIS au premier render ──
    if (!container._domHasCentered || (body && body._domNeedsCenter)) {
      container._domHasCentered = true;
      if (body) body._domNeedsCenter = false;
      var midTick = snap.midTick;
      var maxTick = snap.viewMax != null ? snap.viewMax : snap.maxTick;
      if (body && Number.isFinite(midTick) && Number.isFinite(maxTick)) {
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

    // Grouping + mode
    container.addEventListener('change', function (event) {
      var target = event.target;
      if (!target) return;
      if (target.classList.contains('v6-dom-grouping') && onGroupChange) {
        autoCenter   = true;
        userScrolled = false;
        container._domHasCentered = false;
        onGroupChange(Number(target.value));
      }
    });

    // Bouton C (recenter) + bouton mode coin/$
    container.addEventListener('click', function (event) {
      var target = event.target;
      if (!target) return;
      if (target.classList.contains('v6-dom-recenter')) {
        autoCenter   = true;
        userScrolled = false;
        container._domHasCentered = false;
        if (onRecenter) onRecenter();
        var body = container.querySelector('.v6-dom-body');
        if (body && container._domLastSnap) {
          var s = container._domLastSnap;
          centerOnTick(body, s.midTick, s.maxTick, true);
          requestAnimationFrame(function () {
            renderVirtual(body, s, container._domLastLive || 0,
              (container._domLastState && container._domLastState.settings) || {});
          });
        }
      }
      if (target.classList.contains('v6-dom-value-mode') && onSettingsPatch) {
        onSettingsPatch({ domValueMode: normalizeValueMode(target.value) });
      }
    });

    // Scroll → re-render virtuel + detection user scroll
    var body = container.querySelector('.v6-dom-body');
    if (body) {
      body.addEventListener('scroll', function () {
        if (Date.now() < suppressScrollUntil) return;

        // L'utilisateur a scrolle manuellement → desactiver auto-follow
        if (!userScrolled) {
          userScrolled = true;
          autoCenter   = false;
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

      // Mouse wheel → detection scroll utilisateur
      body.addEventListener('wheel', function () {
        if (!userScrolled) {
          userScrolled = true;
          autoCenter   = false;
          scheduleFollowReturn(container);
        }
      }, { passive: true });
    }
  }

  // ── API publique ──
  V6OF.DomPanel = {
    render       : render,
    bindControls : bindControls,
    computeSizeThreshold : computeSizeThreshold,
    modeValue    : modeValue,
    normalizeValueMode : normalizeValueMode
  };

})();
