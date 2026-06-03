// ---------- 090_v6_dom_ladder.js ----------
// Professional DOM ladder model: merges order book snapshots + recent trades
// into a dense price ladder. Pure JS — no Go changes needed.
// The Go engine already streams order_book + trade messages.

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};

  // ── Config ──
  var ROWS = 5000;             // rows displayed above + below mid (max depth)
  var MAX_LEVELS = 10000;
  var TRADE_DECAY_MS = 60000; // trades older than this are aged out
  var THROTTLE_MS = 200;      // UI update throttle

  // ── State ──
  var levels = [];            // [{ price, bidSize, askSize, buyVol, sellVol, delta }]
  var priceGrouping = 1;
  var midPrice = 0;
  var bestBid = 0;
  var bestAsk = 0;
  var spread = 0;
  var bookCount = 0;
  var lastUpdateTs = 0;
  var groupingOptions = [1, 5, 10, 25, 50, 100, 250];

  // Recent trades indexed by price bucket
  var tradeBuckets = {};      // { "bucketPrice": { buyVol, sellVol, updatedAt } }

  // ── Helpers ──
  function groupPrice(price) {
    if (priceGrouping <= 1) return price;
    return Math.round(price / priceGrouping) * priceGrouping;
  }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  // ── Reset all state ──
  function reset() {
    levels = [];
    tradeBuckets = {};
    midPrice = 0;
    bestBid = 0;
    bestAsk = 0;
    spread = 0;
    bookCount = 0;
    lastUpdateTs = 0;
  }

  // ── Feed an order book snapshot ──
  function feedOrderBook(book) {
    if (!book || !Array.isArray(book.bids) || !Array.isArray(book.asks)) return;
    bookCount++;
    lastUpdateTs = Date.now();

    bestBid = Number(book.bestBid) || (book.bids[0] && book.bids[0].price) || 0;
    bestAsk = Number(book.bestAsk) || (book.asks[0] && book.asks[0].price) || 0;
    spread = Number(book.spread);
    if (!isFinite(spread) && bestBid > 0 && bestAsk > 0) spread = bestAsk - bestBid;
    var mid = Number(book.mid);
    if (!isFinite(mid) && bestBid > 0 && bestAsk > 0) mid = (bestBid + bestAsk) / 2;
    midPrice = mid;

    // Build a hash from the book levels
    var bidMap = {};
    book.bids.forEach(function (b) {
      var p = groupPrice(Number(b.price));
      if (p > 0) bidMap[p] = (bidMap[p] || 0) + Number(b.size);
    });
    var askMap = {};
    book.asks.forEach(function (b) {
      var p = groupPrice(Number(b.price));
      if (p > 0) askMap[p] = (askMap[p] || 0) + Number(b.size);
    });

    // Debug: log incoming book depth
    if (bookCount <= 3) {
      console.log('[DOM Ladder] Book #' + bookCount +
        ' bids=' + book.bids.length + ' asks=' + book.asks.length +
        ' groupedBids=' + Object.keys(bidMap).length + ' groupedAsks=' + Object.keys(askMap).length +
        ' mid=' + midPrice.toFixed(2) + ' grouping=' + priceGrouping);
    }

    // Determine the price range to display
    var prices = new Set();
    Object.keys(bidMap).forEach(function (p) { prices.add(Number(p)); });
    Object.keys(askMap).forEach(function (p) { prices.add(Number(p)); });
    Object.keys(tradeBuckets).forEach(function (p) { prices.add(Number(p)); });

    if (prices.size === 0) return;

    var minP = Infinity, maxP = -Infinity;
    prices.forEach(function (p) { if (p < minP) minP = p; if (p > maxP) maxP = p; });

    // Center around mid price
    if (isFinite(midPrice) && midPrice > 0) {
      var halfRange = ROWS/2 * priceGrouping;
      if (priceGrouping < 1) halfRange = ROWS/2;
      var lo = midPrice - halfRange;
      var hi = midPrice + halfRange;
      if (lo < minP) minP = lo;
      if (hi > maxP) maxP = hi;
    }

    // Build sorted level list
    var newLevels = [];
    var step = Math.max(1, priceGrouping);
    var start = Math.floor(minP / step) * step;
    var end = Math.ceil(maxP / step) * step;
    for (var p = start; p <= end; p += step) {
      if (p <= 0) continue;
      var bid = bidMap[p] || 0;
      var ask = askMap[p] || 0;
      var trades = tradeBuckets[p] || { buyVol: 0, sellVol: 0 };
      newLevels.push({
        price: p,
        bidSize: bid,
        askSize: ask,
        buyVol: trades.buyVol || 0,
        sellVol: trades.sellVol || 0,
        delta: (trades.buyVol || 0) - (trades.sellVol || 0)
      });
    }

    // Merge with existing levels to preserve depth from REST/previously fetched data.
    // New book updates refresh matching prices but don't erase levels not in the update.
    var oldMap = {};
    for (var oi = 0; oi < levels.length; oi++) {
      oldMap[levels[oi].price] = levels[oi];
    }
    for (var ni = 0; ni < newLevels.length; ni++) {
      var nl = newLevels[ni];
      var existing = oldMap[nl.price];
      if (existing) {
        // Update only if new data has non-zero values; keep old trade volumes
        if (nl.bidSize > 0 || nl.askSize > 0) {
          existing.bidSize = nl.bidSize;
          existing.askSize = nl.askSize;
        }
        // Accumulate trade volumes (WebSocket trades may have arrived since last book)
        existing.buyVol = Math.max(existing.buyVol || 0, nl.buyVol || 0);
        existing.sellVol = Math.max(existing.sellVol || 0, nl.sellVol || 0);
        existing.delta = existing.buyVol - existing.sellVol;
      } else {
        oldMap[nl.price] = nl;
      }
    }
    // Rebuild sorted array from merged map
    var mergedKeys = Object.keys(oldMap).map(Number).sort(function (a, b) { return a - b; });
    var merged = [];
    for (var mk = 0; mk < mergedKeys.length; mk++) {
      merged.push(oldMap[mergedKeys[mk]]);
    }

    // Trim to max levels
    if (merged.length > MAX_LEVELS) {
      var midIdx = -1;
      for (var i = 0; i < merged.length; i++) {
        if (merged[i].price >= midPrice) { midIdx = i; break; }
      }
      if (midIdx >= 0) {
        var half = Math.floor(MAX_LEVELS / 2);
        var from = Math.max(0, midIdx - half);
        var to = Math.min(merged.length, midIdx + half);
        merged = merged.slice(from, to);
      } else {
        merged = merged.slice(0, MAX_LEVELS);
      }
    }

    levels = merged;

    // Debug: log output
    if (bookCount <= 3) {
      var nonEmpty = 0;
      for (var n = 0; n < levels.length; n++) {
        var lv = levels[n];
        if (lv.bidSize > 0 || lv.askSize > 0 || lv.buyVol > 0 || lv.sellVol > 0) nonEmpty++;
      }
      console.log('[DOM Ladder] Output: total=' + levels.length + ' nonEmpty=' + nonEmpty +
        ' range=' + levels[0].price.toFixed(2) + '–' + levels[levels.length-1].price.toFixed(2));
    }
  }

  // ── Feed a trade to update buy/sell volumes at price ──
  function feedTrade(trade) {
    if (!trade) return;
    var price = Number(trade.price);
    var qty = Number(trade.qty);
    if (price <= 0 || qty <= 0) return;
    var bucket = groupPrice(price);
    var now = Date.now();

    if (!tradeBuckets[bucket]) {
      tradeBuckets[bucket] = { buyVol: 0, sellVol: 0, updatedAt: now };
    }
    var tb = tradeBuckets[bucket];
    if (trade.side === 'buy' || trade.side === 'Buy' || trade.side === 'B' || trade.IsBuyerMaker === false) {
      tb.buyVol += qty;
    } else {
      tb.sellVol += qty;
    }
    tb.updatedAt = now;

    // Age out stale buckets
    var cutoff = now - TRADE_DECAY_MS;
    for (var k in tradeBuckets) {
      if (tradeBuckets[k].updatedAt < cutoff) {
        delete tradeBuckets[k];
      }
    }
  }

  // ── Feed footprint candle level data ──
  function feedFootprint(candle) {
    if (!candle || !Array.isArray(candle.levels)) return;
    var now = Date.now();
    candle.levels.forEach(function (lv) {
      var price = Number(lv.price);
      if (price <= 0) return;
      var bucket = groupPrice(price);
      if (!tradeBuckets[bucket]) {
        tradeBuckets[bucket] = { buyVol: 0, sellVol: 0, updatedAt: now };
      }
      var tb = tradeBuckets[bucket];
      var bv = Number(lv.buyVol) || 0;
      var sv = Number(lv.sellVol) || 0;
      // Footprint is per-candle volume — we keep the latest
      if (bv > tb.buyVol) tb.buyVol = bv;
      if (sv > tb.sellVol) tb.sellVol = sv;
      tb.updatedAt = now;
    });
  }

  // ── Set price grouping ──
  function setGrouping(group) {
    if (groupingOptions.indexOf(group) === -1) return;
    if (group === priceGrouping) return;
    var sourceLevels = levels.slice();
    priceGrouping = group;
    if (!sourceLevels.length) return;

    var grouped = {};
    var newBuckets = {};
    var now = Date.now();
    sourceLevels.forEach(function (lv) {
      var p = groupPrice(lv.price);
      if (!grouped[p]) {
        grouped[p] = { price: p, bidSize: 0, askSize: 0, buyVol: 0, sellVol: 0, delta: 0 };
      }
      grouped[p].bidSize += Number(lv.bidSize || 0);
      grouped[p].askSize += Number(lv.askSize || 0);
      grouped[p].buyVol += Number(lv.buyVol || 0);
      grouped[p].sellVol += Number(lv.sellVol || 0);
      grouped[p].delta = grouped[p].buyVol - grouped[p].sellVol;
      if (lv.buyVol > 0 || lv.sellVol > 0) {
        if (!newBuckets[p]) newBuckets[p] = { buyVol: 0, sellVol: 0, updatedAt: now };
        newBuckets[p].buyVol += Number(lv.buyVol || 0);
        newBuckets[p].sellVol += Number(lv.sellVol || 0);
      }
    });

    var keys = Object.keys(grouped).map(Number).sort(function (a, b) { return a - b; });
    levels = keys.map(function (p) { return grouped[p]; });
    tradeBuckets = newBuckets;

    if (bestBid > 0) bestBid = groupPrice(bestBid);
    if (bestAsk > 0) bestAsk = groupPrice(bestAsk);
    if (midPrice > 0) {
      var mid = (bestBid > 0 && bestAsk > 0) ? (bestBid + bestAsk) / 2 : groupPrice(midPrice);
      midPrice = mid;
    }
  }

  // ── Get current ladder snapshot ──
  function snapshot() {
    return {
      levels: levels,
      midPrice: midPrice,
      bestBid: bestBid,
      bestAsk: bestAsk,
      spread: spread,
      priceGrouping: priceGrouping,
      bookCount: bookCount,
      lastUpdate: lastUpdateTs
    };
  }

  // ── Public API ──
  V6OF.DomLadder = {
    reset: reset,
    feedOrderBook: feedOrderBook,
    feedTrade: feedTrade,
    feedFootprint: feedFootprint,
    setGrouping: setGrouping,
    snapshot: snapshot,
    getGroupingOptions: function () { return groupingOptions.slice(); },
    THROTTLE_MS: THROTTLE_MS
  };

})();
