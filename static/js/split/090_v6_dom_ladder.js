// ---------- 090_v6_dom_ladder.js ----------
// DOM Ladder v5 — Stable window model.
// Fenetre de prix STABLE centree sur le mid, jamais recalculee a chaque feed.
//
// - book: Map<priceKey, BookLevel>  — tous les niveaux connus
// - viewMin / viewMax : fenetre d'affichage stable (ne change QUE si le prix sort)
// - Plus de reset brutal bidSize/askSize a chaque snapshot
// - Les niveaux non presents dans le nouveau snapshot gardent leur ancienne valeur

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

  // ── Config ──
  var TRADE_DECAY_MS    = 600000;  // trades plus vieux que 10min sont retires
  var THROTTLE_MS       = 200;
  var VIEW_HALF_RANGE   = 200;     // ticks au-dessus et en-dessous du mid
  var VIEW_EXPAND_MARGIN = 0.15;   // 15% du range avant expansion
  var STALE_LEVEL_MS    = 60000;  // niveaux sans update depuis 60s → zero
  var groupingOptions    = [1, 5, 10, 25, 50, 100, 250, 500, 1000];

  // ── State ──
  var book         = new Map();  // Map<priceKey, BookLevel>
  var tickSize     = 1;
  var contractSize = 1;          // instrument contract size (metadata; 1 for base-coin venues)
  var priceGrouping = 25;
  var midPrice     = 0;
  var bestBid      = 0;
  var bestAsk      = 0;
  var spread       = 0;
  var viewMin      = 0;          // tick le plus bas de la fenetre stable
  var viewMax      = 0;          // tick le plus haut de la fenetre stable
  var dataMin      = 0;          // tick le plus bas avec donnees reelles
  var dataMax      = 0;          // tick le plus haut avec donnees reelles
  var bookCount    = 0;
  var lastUpdateTs = 0;
  var lastSequence = 0;
  var sequenceGapCount = 0;
  var droppedUpdates = 0;
  var source       = 'unknown';
  var symbol       = '';

  // ── Helpers ──

  function isNum(v) {
    return typeof v === 'number' && isFinite(v) && v > 0;
  }

  function priceToTick(price) {
    if (tickSize <= 0) return Math.round(price);
    return Math.round(price / tickSize);
  }

  function tickToPrice(tick) {
    return tick * tickSize;
  }

  function makePriceKey(price) {
    return String(priceToTick(price));
  }

  function getOrCreate(priceKey, price) {
    var lv = book.get(priceKey);
    if (!lv) {
      lv = {
        priceKey    : priceKey,
        tick        : priceToTick(price),
        price       : price,
        bidSize     : 0,
        askSize     : 0,
        buyVol      : 0,
        sellVol     : 0,
        delta       : 0,
        prevBidSize : 0,
        prevAskSize : 0,
        lastUpdateTs: 0,
        firstSeenTs : Date.now(),
        maxBidSeen  : 0,
        maxAskSeen  : 0,
        bidWallScore: 0,
        askWallScore: 0,
        wallScore   : 0
      };
      book.set(priceKey, lv);
    }
    return lv;
  }

  // ── Percentile sur tableau de nombres positifs ──
  function percentile(values, p) {
    if (!values.length) return 0;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var idx = p * (sorted.length - 1);
    var lo = Math.floor(idx);
    var hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  // ── Wall scoring global ──
  function computeWallScores() {
    var bidSizes = [];
    var askSizes = [];
    book.forEach(function (lv) {
      if (lv.bidSize > 0) bidSizes.push(lv.bidSize);
      if (lv.askSize > 0) askSizes.push(lv.askSize);
    });

    var p85b = percentile(bidSizes, 0.85);
    var p95b = percentile(bidSizes, 0.95);
    var p85a = percentile(askSizes, 0.85);
    var p95a = percentile(askSizes, 0.95);

    book.forEach(function (lv) {
      if (lv.bidSize >= p95b && p95b > 0) {
        lv.bidWallScore = 2;
      } else if (lv.bidSize >= p85b && p85b > 0) {
        lv.bidWallScore = 1;
      } else {
        lv.bidWallScore = 0;
      }

      if (lv.askSize >= p95a && p95a > 0) {
        lv.askWallScore = 2;
      } else if (lv.askSize >= p85a && p85a > 0) {
        lv.askWallScore = 1;
      } else {
        lv.askWallScore = 0;
      }

      lv.wallScore = Math.max(lv.bidWallScore, lv.askWallScore);
    });
  }

  // ── Detecting tick size from raw prices ──
  function detectTickSize(bids, asks) {
    var prices = [];
    var i;
    for (i = 0; i < Math.min(bids.length, 20); i++) {
      var p = Number(bids[i].price);
      if (p > 0) prices.push(p);
    }
    for (i = 0; i < Math.min(asks.length, 20); i++) {
      var pa = Number(asks[i].price);
      if (pa > 0) prices.push(pa);
    }
    prices.sort(function (a, b) { return a - b; });
    var minGap = Infinity;
    for (i = 1; i < prices.length; i++) {
      var gap = prices[i] - prices[i - 1];
      if (gap > 0 && gap < minGap) minGap = gap;
    }
    if (!isFinite(minGap) || minGap <= 0) return null;
    var mag = Math.pow(10, Math.floor(Math.log10(minGap)));
    return Math.round(minGap / mag) * mag;
  }

  // ── Reset ──
  function reset() {
    book.clear();
    tickSize      = 1;
    midPrice      = 0;
    bestBid       = 0;
    bestAsk       = 0;
    spread        = 0;
    viewMin       = 0;
    viewMax       = 0;
    dataMin       = 0;
    dataMax       = 0;
    bookCount     = 0;
    lastUpdateTs  = 0;
    lastSequence  = 0;
    sequenceGapCount = 0;
    droppedUpdates = 0;
  }

  function ingestSequence(ob) {
    var seq = Number(ob.seq || ob.sequence || ob.updateId || ob.lastUpdateId || ob.u || 0);
    var firstSeq = Number(ob.firstSeq || ob.firstUpdateId || ob.U || 0);
    var prevSeq = Number(ob.prevSeq || ob.previousUpdateId || ob.pu || 0);
    if (!Number.isFinite(seq) || seq <= 0) {
      lastSequence = bookCount;
      return;
    }

    if (lastSequence > 0) {
      var expectedPrev = prevSeq > 0 ? prevSeq : (firstSeq > 0 ? firstSeq - 1 : lastSequence);
      if (expectedPrev > lastSequence || seq > lastSequence + 1) {
        var missed = Math.max(1, expectedPrev > lastSequence ? expectedPrev - lastSequence : seq - lastSequence - 1);
        sequenceGapCount += 1;
        droppedUpdates += missed;
      }
    }
    lastSequence = seq;
  }

  // ── Ajuster la fenetre stable autour du mid ──
  // Appele apres chaque feedOrderBook.
  // Ne change viewMin/viewMax QUE si le mid sort de la zone de confort.
  function updateViewWindow(midTick) {
    if (!isFinite(midTick)) return;

    var range  = VIEW_HALF_RANGE;
    var margin = Math.floor(range * VIEW_EXPAND_MARGIN);

    // Premier appel : initialiser la fenetre
    if (viewMin === 0 && viewMax === 0) {
      viewMin = midTick - range;
      viewMax = midTick + range;
      return;
    }

    var lowThreshold  = viewMin + margin;
    var highThreshold = viewMax - margin;

    // Le mid est-il sorti de la zone de confort ?
    if (midTick < lowThreshold) {
      // Decaler la fenetre vers le bas
      var shift = lowThreshold - midTick;
      viewMin -= shift;
      viewMax -= shift;
    } else if (midTick > highThreshold) {
      // Decaler la fenetre vers le haut
      var shiftUp = midTick - highThreshold;
      viewMin += shiftUp;
      viewMax += shiftUp;
    }
    // Sinon : fenetre stable, aucun changement
  }

  // ── Feed un snapshot order book ──
  function feedOrderBook(ob) {
    if (!ob || !Array.isArray(ob.bids) || !Array.isArray(ob.asks)) return;
    bookCount++;
    lastUpdateTs = Date.now();
    source = ob.exchange || ob.source || 'unknown';
    symbol = ob.symbol || symbol;
    ingestSequence(ob);

    // --- Tick size : stable, base sur le grouping uniquement ---
    // Ne JAMAIS recalculer dynamiquement — changerait les priceKeys entre feeds
    // et rendrait les niveaux orphelins (ASK disparaissent).
    tickSize = priceGrouping > 0 ? priceGrouping : 1;

    // --- Contract size : metadata instrument (defaut 1, conserve la derniere valeur connue) ---
    if (Number(ob.contractSize) > 0) contractSize = Number(ob.contractSize);

    // --- Prix cles ---
    var rawBestBid = Number(ob.bestBid) || (ob.bids[0] && Number(ob.bids[0].price)) || 0;
    var rawBestAsk = Number(ob.bestAsk) || (ob.asks[0] && Number(ob.asks[0].price)) || 0;
    bestBid = rawBestBid;
    bestAsk = rawBestAsk;
    spread  = Number(ob.spread);
    if (!isFinite(spread) && bestBid > 0 && bestAsk > 0) spread = bestAsk - bestBid;
    var mid = Number(ob.mid);
    if (!isFinite(mid) && bestBid > 0 && bestAsk > 0) mid = (bestBid + bestAsk) / 2;
    midPrice = mid;

    // --- Sauvegarder les anciennes valeurs AVANT mise a jour ---
    book.forEach(function (lv) {
      lv.prevBidSize = lv.bidSize;
      lv.prevAskSize = lv.askSize;
    });

    var now = Date.now();

    // --- Ingest : mettre a jour les niveaux presents dans le snapshot ---
    // On ne touche PAS aux niveaux absents — ils gardent leur ancienne valeur
    // jusqu'a expiration temporelle (STALE_LEVEL_MS sans update)
    function ingest(levels, side) {
      levels.forEach(function (raw) {
        var price = Number(raw.price);
        var size  = Number(raw.size);
        if (!isNum(price) || size <= 0) return;  // skip zero/negative sizes

        var snappedPrice = Math.round(price / tickSize) * tickSize;
        var pk = makePriceKey(snappedPrice);
        var lv = getOrCreate(pk, snappedPrice);

        if (side === 'bid') {
          lv.bidSize = size;
          if (lv.bidSize > lv.maxBidSeen) lv.maxBidSeen = lv.bidSize;
        } else {
          lv.askSize = size;
          if (lv.askSize > lv.maxAskSeen) lv.maxAskSeen = lv.askSize;
        }

        lv.lastUpdateTs = now;
      });
    }

    ingest(ob.bids, 'bid');
    ingest(ob.asks, 'ask');

    // --- Expiration temporelle : zero les niveaux non mis a jour depuis >60s ---
    // Ainsi les niveaux REST (5000 de profondeur) survivent entre les refresh REST
    // (toutes les 15s), meme si le WS ne couvre que le top 50.
    var staleThreshold = now - STALE_LEVEL_MS;
    book.forEach(function (lv, pk) {
      if (lv.lastUpdateTs < staleThreshold) {
        lv.bidSize = 0;
        lv.askSize = 0;
      }
    });

    // --- Recalculer dataMin/dataMax depuis les niveaux AVEC donnees ---
    var newDataMin = Infinity;
    var newDataMax = -Infinity;
    book.forEach(function (lv) {
      if (lv.bidSize > 0 || lv.askSize > 0) {
        if (lv.tick < newDataMin) newDataMin = lv.tick;
        if (lv.tick > newDataMax) newDataMax = lv.tick;
      }
    });
    if (isFinite(newDataMin) && isFinite(newDataMax)) {
      dataMin = newDataMin;
      dataMax = newDataMax;
    }

    // --- Mettre a jour la fenetre stable (seulement si mid a bouge) ---
    var midTick = priceToTick(midPrice);
    updateViewWindow(midTick);

    // --- S'assurer que la fenetre couvre au moins les donnees ---
    // (le mid peut etre stable mais de nouveaux niveaux apparaissent aux extremites)
    var dataMargin = Math.floor(VIEW_HALF_RANGE * 0.1);
    if (dataMin < viewMin - dataMargin) viewMin = dataMin - Math.floor(VIEW_HALF_RANGE * 0.05);
    if (dataMax > viewMax + dataMargin) viewMax = dataMax + Math.floor(VIEW_HALF_RANGE * 0.05);

    // --- Pruner les entrees tres loin de la fenetre ---
    var pruneRange  = viewMax - viewMin;
    var pruneBuffer = Math.max(pruneRange, VIEW_HALF_RANGE * 4);
    var pruneMin    = viewMin - pruneBuffer;
    var pruneMax    = viewMax + pruneBuffer;
    book.forEach(function (lv, pk) {
      if (lv.tick < pruneMin || lv.tick > pruneMax) {
        book.delete(pk);
      }
    });

    // --- Wall scores ---
    computeWallScores();

    if (bookCount <= 3) {
      console.log('[DomLadder v5] Book #' + bookCount +
        ' bids=' + ob.bids.length + ' asks=' + ob.asks.length +
        ' tickSize=' + tickSize +
        ' viewMin=' + viewMin + ' viewMax=' + viewMax +
        ' dataMin=' + dataMin + ' dataMax=' + dataMax +
        ' midTick=' + midTick +
        ' totalTicks=' + (viewMax - viewMin + 1) +
        ' bookSize=' + book.size +
        ' mid=' + midPrice.toFixed(2));
    }
  }

  // ── Feed un trade ──
  function feedTrade(trade) {
    if (!trade) return;
    var price = Number(trade.price);
    var qty   = Number(trade.qty);
    if (price <= 0 || qty <= 0) return;

    var snappedPrice = Math.round(price / tickSize) * tickSize;
    var pk = makePriceKey(snappedPrice);
    var lv = getOrCreate(pk, snappedPrice);
    var now = Date.now();

    var isBuy = trade.side === 'buy' || trade.side === 'Buy' || trade.side === 'B' ||
                trade.IsBuyerMaker === false;
    if (isBuy) {
      lv.buyVol += qty;
    } else {
      lv.sellVol += qty;
    }
    lv.delta = lv.buyVol - lv.sellVol;
    lv.lastUpdateTs = now;

    // Vieillissement des trades
    var cutoff = now - TRADE_DECAY_MS;
    book.forEach(function (lv2) {
      if (lv2.buyVol === 0 && lv2.sellVol === 0) return;
      if (lv2.lastUpdateTs < cutoff) {
        lv2.buyVol  = 0;
        lv2.sellVol = 0;
        lv2.delta   = 0;
      }
    });
  }

  // ── Feed footprint candle ──
  function feedFootprint(candle) {
    if (!candle || !Array.isArray(candle.levels)) return;
    var now = Date.now();
    candle.levels.forEach(function (lv) {
      var price = Number(lv.price);
      if (price <= 0) return;
      var snappedPrice = Math.round(price / tickSize) * tickSize;
      var pk = makePriceKey(snappedPrice);
      var entry = getOrCreate(pk, snappedPrice);
      var bv = Number(lv.buyVol) || 0;
      var sv = Number(lv.sellVol) || 0;
      if (bv > entry.buyVol) entry.buyVol = bv;
      if (sv > entry.sellVol) entry.sellVol = sv;
      entry.delta = entry.buyVol - entry.sellVol;
      entry.lastUpdateTs = now;
    });
  }

  // ── Changer le grouping ──
  function setGrouping(group) {
    if (groupingOptions.indexOf(group) === -1) return;
    if (group === priceGrouping) return;
    priceGrouping = group;
    reset();
  }

  // ── Snapshot pour le panel ──
  function snapshot() {
    // Pour compatibilite : minTick/maxTick pointent vers la fenetre stable
    return {
      book         : book,
      tickSize     : tickSize,
      contractSize : contractSize,
      priceGrouping: priceGrouping,
      midPrice     : midPrice,
      bestBid      : bestBid,
      bestAsk      : bestAsk,
      spread       : spread,
      minTick      : viewMin,     // backward compat : utilise la fenetre stable
      maxTick      : viewMax,     // backward compat : utilise la fenetre stable
      viewMin      : viewMin,     // nouveau nom explicite
      viewMax      : viewMax,
      dataMin      : dataMin,
      dataMax      : dataMax,
      midTick      : priceToTick(midPrice),
      bestBidTick  : priceToTick(bestBid),
      bestAskTick  : priceToTick(bestAsk),
      bookCount    : bookCount,
      sequence     : lastSequence,
      sequenceGapCount: sequenceGapCount,
      droppedUpdates: droppedUpdates,
      bookSize     : book.size,
      lastUpdate   : lastUpdateTs,
      source       : source,
      symbol       : symbol
    };
  }

  // ── API publique ──
  V6OF.register('Data', 'DomLadder', {
    reset             : reset,
    feedOrderBook     : feedOrderBook,
    feedTrade         : feedTrade,
    feedFootprint     : feedFootprint,
    setGrouping       : setGrouping,
    snapshot          : snapshot,
    getGroupingOptions: function () { return groupingOptions.slice(); },
    THROTTLE_MS       : THROTTLE_MS,
    priceToTick       : priceToTick,
    tickToPrice       : tickToPrice
  }, 'DomLadder');

})();
