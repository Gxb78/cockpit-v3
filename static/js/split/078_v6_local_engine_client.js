// ---------- 078_v6_local_engine_client.js ----------
// Engine client: WebSocket transport connecting the V6 surface to the local Go market engine.
// Auto-connects to the configured local engine WebSocket when the V6 orderflow shell mounts.
// Local engine only. No exchange browser WebSocket. No Wails dependency.

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

  function configuredMarketWsUrl() {
    var cfg = window.COCKPIT_CONFIG || {};
    if (cfg.marketWsUrl) return String(cfg.marketWsUrl);
    var proto = window.location && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var host = window.location && window.location.hostname ? window.location.hostname : '127.0.0.1';
    return proto + '//' + host + ':8765/stream';
  }

  // Normalize an origin URL for a given transport ('ws' or 'http'), stripping the
  // '/stream' suffix and any query/hash. Shared by both transports.
  function normalizeOrigin(rawUrl, transport) {
    try {
      var parsed = new URL(rawUrl, window.location && window.location.href ? window.location.href : undefined);
      var secure = parsed.protocol === 'wss:' || parsed.protocol === 'https:';
      parsed.protocol = transport === 'ws' ? (secure ? 'wss:' : 'ws:') : (secure ? 'https:' : 'http:');
      parsed.pathname = parsed.pathname.replace(/\/stream\/?$/, '') || '/';
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString().replace(/\/$/, '');
    } catch (err) {
      if (transport === 'ws') return rawUrl.replace(/\/stream\/?$/, '');
      return rawUrl.replace(/^ws(s?):/, 'http$1:').replace(/\/stream\/?$/, '');
    }
  }

  // HTTP origin for the market engine REST API (footprint history, /replay).
  // First-class config value: read COCKPIT_CONFIG.marketHttpUrl when present;
  // otherwise fall back to deriving it from the WS origin (legacy behavior).
  function configuredMarketHttpUrl() {
    var cfg = window.COCKPIT_CONFIG || {};
    if (cfg.marketHttpUrl) return String(cfg.marketHttpUrl).replace(/\/$/, '');
    return normalizeOrigin(configuredMarketWsUrl(), 'http');
  }

  function resolveMarketUrl(path, transport) {
    var suffix = path || '';
    var base = transport === 'ws'
      ? normalizeOrigin(configuredMarketWsUrl(), 'ws')
      : configuredMarketHttpUrl();
    return base + (suffix.charAt(0) === '/' ? suffix : '/' + suffix);
  }

  V6OF.register('Transport', 'resolveMarketUrl', resolveMarketUrl, 'resolveMarketUrl');
  V6OF.register('Transport', 'marketWsUrl', configuredMarketWsUrl, 'marketWsUrl');
  V6OF.register('Transport', 'marketHttpUrl', configuredMarketHttpUrl, 'marketHttpUrl');

  var DEFAULT_URL = configuredMarketWsUrl();
  var DEFAULT_MAX_TRADE_BUFFER = 5000;
  var STALE_THRESHOLD_MS = 10000;
  var MAX_BUCKETS_PER_INTERVAL = 5000;
  var DEFAULT_MAX_HEATMAP_FRAMES = 10000;
  var DEFAULT_MAX_FOOTPRINT_CANDLES = 3000;
  var RECONNECT_BASE_MS = 2000;
  var RECONNECT_MAX_MS = 30000;
  var RECONNECT_MAX_ATTEMPTS = 8;
  var BATCH_RENDER_MS = 33;
  var MAX_DEPTH_HISTORY = 10000;

  function timeframeToMs(tf) {
    if (!tf) return 60000;
    var match = tf.match(/^(\d+)([mhd])$/i);
    if (!match) return 60000;
    var val = parseInt(match[1], 10);
    var unit = match[2].toLowerCase();
    if (unit === 'm') return val * 60000;
    if (unit === 'h') return val * 3600000;
    if (unit === 'd') return val * 86400000;
    return 60000;
  }

  // Normalize symbol: 'BTC' -> 'BTCUSDT', leave 'BTCUSDT' etc. unchanged.
  // This prevents the subscriber from seeing a fake symbol change each batch.
  function normalizeSymbol(sym) {
    if (!sym) return 'BTCUSDT';
    var s = sym.toUpperCase();
    // Short coin names (no quote currency) get USDT appended
    if (/^[A-Z]{2,6}$/.test(s) && !s.match(/USDT$|BUSD$|USDC$|BTC$|ETH$/)) {
      return s + 'USDT';
    }
    // 'BTC' alone is shorthand for BTCUSDT
    if (s === 'BTC') return 'BTCUSDT';
    if (s === 'ETH') return 'ETHUSDT';
    return s;
  }

  /**
   * @typedef {Object} V6EngineStats
   * @property {number} tradesReceived
   * @property {number} deltaBucketsReceived
   * @property {number} vwapsReceived
   * @property {number} orderBooksReceived
   * @property {number} heatmapFramesReceived
   * @property {number} footprintCandlesReceived
   * @property {number} errorsCount
   * @property {number} reconnectsCount
   * @property {number} droppedCount
   * @property {number} queueDepth
   * @property {number} lagMs
   * @property {number|null} lastMessageTs
   * @property {string} lastError
   */

  /**
   * @typedef {'disconnected'|'connecting'|'connected'|'error'} V6EngineStatus
   */

  function createClient(store) {
    var ws = null;
    var status = 'disconnected';
    var stats = {
      tradesReceived: 0,
      deltaBucketsReceived: 0,
      vwapsReceived: 0,
      orderBooksReceived: 0,
      heatmapFramesReceived: 0,
      footprintCandlesReceived: 0,
      errorsCount: 0,
      reconnectsCount: 0,
      droppedCount: 0,
      lastMessageTs: null,
      lastError: ''
    };
    var tradeBuffer = [];
    var paused = false;
    var reconnectAttempt = 0;
    var reconnectTimer = null;
    var batchTimer = null;
    var staleTimer = null;
    var candleFallbackTimer = null;
    var pendingTrades = [];
    var pendingDeltaBuckets = [];
    var pendingVwap = null;
    var pendingOrderBook = null;
    var pendingHeatmapFrames = [];
    var pendingFootprintCandles = [];
    var intentionalClose = false;
    var listeners = [];
    var generation = 0;
    var depthHistory = [];
    var pendingDepthPoint = null;

    function pendingQueueDepth() {
      return pendingTrades.length +
        pendingDeltaBuckets.length +
        (pendingVwap ? 1 : 0) +
        (pendingOrderBook ? 1 : 0) +
        pendingHeatmapFrames.length +
        pendingFootprintCandles.length +
        (pendingDepthPoint ? 1 : 0);
    }

    function statsSnapshot() {
      var out = Object.assign({}, stats);
      out.queueDepth = pendingQueueDepth();
      out.lagMs = stats.lastMessageTs ? Math.max(0, Date.now() - stats.lastMessageTs) : 0;
      return out;
    }

    // ── Footprint signal thresholds (UI → engine) ───────────────────────────
    // Seed the engine's orderflow-signal thresholds from the UI settings so its
    // derived footprint signals match the client-side fallback. Sent on connect
    // and whenever the relevant settings change.
    var lastFpConfigJson = '';
    function setEngineConfigStatus(next, detail) {
      if (!store || !store.setState) return;
      var patch = {
        engineConfigStatus: next,
        engineConfigError: next === 'failed' ? String(detail || 'send failed') : ''
      };
      if (next === 'synced') {
        patch.engineConfigSyncedAt = Date.now();
      } else if (next === 'stale') {
        patch.engineConfigStaleAt = Date.now();
      }
      store.setState(patch, 'engine-config-' + next);
    }
    function buildFootprintConfigMsg() {
      var s = (store && store.getState && store.getState().settings) || {};
      return {
        type: 'footprint_config',
        imbalanceRatio: Number(s.imbalanceRatio) > 0 ? Number(s.imbalanceRatio) : 3.0,
        imbalanceStack: Number(s.imbalanceStack) > 0 ? Number(s.imbalanceStack) : 3,
        imbalanceMinVolume: Number(s.imbalanceMinVolume) >= 0 ? Number(s.imbalanceMinVolume) : 1.0,
        exhaustionFactor: Number(s.exhaustionFactor) > 0 ? Number(s.exhaustionFactor) : 0.35
      };
    }
    function sendFootprintConfig(force) {
      var json = JSON.stringify(buildFootprintConfigMsg());
      if (!force && json === lastFpConfigJson) return;
      if (!(ws && status === 'connected')) {
        setEngineConfigStatus('stale');
        return;
      }
      try {
        ws.send(json);
        lastFpConfigJson = json;
        setEngineConfigStatus('synced');
      } catch (e) {
        setEngineConfigStatus('failed', e && e.message ? e.message : e);
        console.warn('[V6 EngineClient] footprint_config send failed', e);
      }
    }
    if (store && store.subscribe) {
      store.subscribe(function () { sendFootprintConfig(false); }, function (state) {
        return state ? state.settings : null;
      });
    }

    var lastTf = (store && store.getState().timeframe) || '1m';
    // Always store a normalized symbol so 'BTC' vs 'BTCUSDT' oscillation never
    // triggers a spurious footprint history refetch.
    var lastSymbol = normalizeSymbol((store && store.getState().symbol) || 'BTC');
    if (store) {
      store.subscribe(function (state) {
        var currentTf = state.timeframe || '1m';
        // Normalize before comparing: engine sends 'BTC', store may hold 'BTCUSDT'
        var currentSymbol = normalizeSymbol(state.symbol || 'BTC');
        var changed = false;
        if (currentTf !== lastTf) {
          lastTf = currentTf;
          changed = true;
          if (ws && status === 'connected') {
            try {
              ws.send(JSON.stringify({ type: 'cvd_history_request', timeframe: currentTf }));
              console.log('[V6 Client] requested CVD history for timeframe:', currentTf);
            } catch (e) {
              console.warn('[V6 Client] failed to request CVD history:', e);
            }
          }
        }
        if (currentSymbol !== lastSymbol) {
          lastSymbol = currentSymbol;
          changed = true;
          console.log('[V6 Client] symbol changed to', currentSymbol, '— will fetch footprint history');
        }
        if (changed && status === 'connected') {
          fetchFootprintHistory();
        }
      });
    }

    function notify() {
      var snapshot = {
        status: status,
        stats: Object.assign({}, stats),
        paused: paused
      };
      listeners.slice().forEach(function (fn) {
        try { fn(snapshot); } catch (err) { console.error('[V6 EngineClient] listener error', err); }
      });
    }

    function setStatus(next, errorMsg) {
      status = next;
      if (errorMsg) {
        stats.lastError = errorMsg;
        stats.errorsCount++;
      } else if (next === 'connected' || next === 'disconnected') {
        stats.lastError = '';
      }
      if (store) {
        var patch = { transportStatus: next };
        if (next === 'connected') {
          var connectedState = store.getState ? store.getState() : {};
          if (connectedState.source !== 'rest-fallback' && connectedState.dataFreshness !== 'rest-fallback') {
            patch.dataFreshness = 'warming';
          }
        } else if (next === 'disconnected' || next === 'error') {
          var s = store.getState();
          patch.dataFreshness = (s.dataFreshness === 'rest-fallback') ? 'rest-fallback' : 'offline';
          patch.engineConfigStatus = 'stale';
          patch.engineConfigStaleAt = Date.now();
        }
        store.setState(patch, 'transport-status-change');
      }
      notify();
    }

    function flushBatch() {
      batchTimer = null;
      if (!pendingTrades.length && !pendingDeltaBuckets.length && !pendingVwap && !pendingOrderBook && !pendingHeatmapFrames.length && !pendingFootprintCandles.length && !pendingDepthPoint) return;
      var newTrades = pendingTrades;
      var newDeltaBuckets = pendingDeltaBuckets;
      var nextVwap = pendingVwap;
      var nextOrderBook = pendingOrderBook;
      var nextHeatmapFrames = pendingHeatmapFrames;
      var nextFootprintCandles = pendingFootprintCandles;
      var nextDepthPoint = pendingDepthPoint;
      pendingTrades = [];
      pendingDeltaBuckets = [];
      pendingVwap = null;
      pendingOrderBook = null;
      pendingHeatmapFrames = [];
      pendingFootprintCandles = [];
      pendingDepthPoint = null;

      // Prepend new trades (newest first) and cap buffer
      if (newTrades.length) {
        var maxTrades = DEFAULT_MAX_TRADE_BUFFER;
        if (store) {
          var curSettings = store.getState().settings;
          if (curSettings && Number.isFinite(curSettings.maxTrades) && curSettings.maxTrades > 0) {
            maxTrades = Math.max(50, Math.min(5000, curSettings.maxTrades));
          }
        }
        tradeBuffer = newTrades.concat(tradeBuffer);
        if (tradeBuffer.length > maxTrades) {
          stats.droppedCount += tradeBuffer.length - maxTrades;
          tradeBuffer.length = maxTrades;
        }
      }

      if (store) {
        store.setState(function (state) {
          var patch = {};
          if (newTrades.length && !paused) {
            patch.trades = tradeBuffer.slice();
          }
          if (newDeltaBuckets.length) {
            var bucketsByInterval = Object.assign({}, state.deltaBucketsByInterval || {});
            var latestByInterval = Object.assign({}, state.latestDeltaByInterval || {});
            newDeltaBuckets.forEach(function (bucket) {
              var key = String(bucket.intervalMs || 0);
              var list = Array.isArray(bucketsByInterval[key]) ? bucketsByInterval[key].slice() : [];
              list.push(bucket);
              if (list.length > MAX_BUCKETS_PER_INTERVAL) {
                stats.droppedCount += list.length - MAX_BUCKETS_PER_INTERVAL;
                list = list.slice(list.length - MAX_BUCKETS_PER_INTERVAL);
              }
              bucketsByInterval[key] = list;
              latestByInterval[key] = bucket;
            });
            var selected = String((state.settings && state.settings.deltaIntervalMs) || 60000);
            patch.deltaBucketsByInterval = bucketsByInterval;
            patch.latestDeltaByInterval = latestByInterval;
            patch.deltaBuckets = bucketsByInterval[selected] || newDeltaBuckets.slice(-MAX_BUCKETS_PER_INTERVAL);
          }
          if (nextVwap) {
            var vwapBySymbol = Object.assign({}, state.vwapBySymbol || {});
            vwapBySymbol[nextVwap.symbol || 'BTC'] = nextVwap;
            patch.vwap = nextVwap;
            patch.vwapBySymbol = vwapBySymbol;
          }
          if (nextOrderBook) {
            var bookBySymbol = Object.assign({}, state.lastOrderBookBySymbol || {});
            bookBySymbol[nextOrderBook.symbol || 'BTC'] = nextOrderBook;
            patch.orderBook = nextOrderBook;
            patch.lastOrderBookBySymbol = bookBySymbol;
            patch.orderBookCount = (state.orderBookCount || 0) + 1;
            patch.lastOrderBookTs = nextOrderBook.tsLocal || Date.now();
            patch.liveDepthCount = Math.min(nextOrderBook.bids ? nextOrderBook.bids.length : 0, nextOrderBook.asks ? nextOrderBook.asks.length : 0);
            patch.selectedDomSymbol = nextOrderBook.symbol || state.selectedDomSymbol || 'BTC';
          }
          if (nextDepthPoint) {
            depthHistory.push(nextDepthPoint);
            if (depthHistory.length > MAX_DEPTH_HISTORY) {
              depthHistory = depthHistory.slice(depthHistory.length - MAX_DEPTH_HISTORY);
            }
            patch.depthHistory = depthHistory;
          }
          if (nextHeatmapFrames.length) {
            var maxFrames = Math.max(60, Math.min(10000, Number((state.settings && state.settings.heatmapMaxFrames) || DEFAULT_MAX_HEATMAP_FRAMES)));
            var frames = (state.heatmapFrames || []).concat(nextHeatmapFrames);
            if (frames.length > maxFrames) {
              stats.droppedCount += frames.length - maxFrames;
              frames = frames.slice(frames.length - maxFrames);
            }
            var lastFrame = frames[frames.length - 1] || null;
            patch.heatmapFrames = frames;
            patch.lastHeatmapFrame = lastFrame;
            patch.heatmapFrameCount = (state.heatmapFrameCount || 0) + nextHeatmapFrames.length;
            patch.lastHeatmapTs = lastFrame ? (lastFrame.tsLocal || Date.now()) : (state.lastHeatmapTs || 0);
            patch.selectedHeatmapSymbol = lastFrame ? (lastFrame.symbol || state.selectedHeatmapSymbol || 'BTC') : state.selectedHeatmapSymbol;
          }
          if (nextFootprintCandles.length) {
            var maxCandles = Math.max(60, Math.min(3000, Number((state.settings && state.settings.footprintMaxCandles) || DEFAULT_MAX_FOOTPRINT_CANDLES)));
            var fpBefore = (state.footprintCandles || []).length + nextFootprintCandles.length;
            var candles = mergeFootprintCandles(state.footprintCandles || [], nextFootprintCandles, maxCandles);
            if (fpBefore > candles.length) {
              stats.droppedCount += fpBefore - candles.length;
            }
            var lastCandle = candles[candles.length - 1] || nextFootprintCandles[nextFootprintCandles.length - 1] || null;
            patch.footprintCandles = candles;
            patch.lastFootprintCandle = lastCandle;
            patch.footprintCandleCount = (state.footprintCandleCount || 0) + nextFootprintCandles.length;
            patch.lastFootprintTs = lastCandle ? (lastCandle.tsLocal || Date.now()) : (state.lastFootprintTs || 0);
            patch.selectedFootprintSymbol = lastCandle ? (lastCandle.symbol || state.selectedFootprintSymbol || 'BTC') : state.selectedFootprintSymbol;
          }
          if (newTrades.length || newDeltaBuckets.length || nextVwap || nextOrderBook || nextHeatmapFrames.length || nextFootprintCandles.length) {
            patch.source = 'live';
            patch.dataFreshness = 'live';
            patch.lastMessageAt = stats.lastMessageTs || Date.now();
            patch.isStale = false;
            // Always normalize the symbol before writing it to the store.
            // Raw engine payloads use 'BTC'; the store canonical form is 'BTCUSDT'.
            // Without this, state.symbol oscillates each batch and the subscriber
            // mistakes it for a real symbol change, triggering endless history refetches.
            var rawSym = (nextVwap && nextVwap.symbol) ||
              (nextOrderBook && nextOrderBook.symbol) ||
              (nextHeatmapFrames.length && nextHeatmapFrames[nextHeatmapFrames.length - 1].symbol) ||
              (nextFootprintCandles.length && nextFootprintCandles[nextFootprintCandles.length - 1].symbol) ||
              (newDeltaBuckets.length && newDeltaBuckets[newDeltaBuckets.length - 1].symbol) ||
              (newTrades.length && newTrades[0].symbol) ||
              state.symbol;
            patch.symbol = normalizeSymbol(rawSym);
          }
          return patch;
        }, 'live-engine-batch');
      }
      notify();
    }

    function scheduleBatch() {
      if (batchTimer) return;
      if (document.hidden || typeof requestAnimationFrame !== 'function') {
        batchTimer = setTimeout(flushBatch, BATCH_RENDER_MS);
        return;
      }
      batchTimer = requestAnimationFrame(function () {
        batchTimer = null;
        // Use a small setTimeout to coalesce multiple messages within one frame
        batchTimer = setTimeout(flushBatch, BATCH_RENDER_MS);
      });
    }

    function normalizeDeltaBucket(payload, fallbackTs) {
      return {
        exchange: payload.exchange || 'unknown',
        symbol: payload.symbol || '??',
        intervalMs: Number(payload.intervalMs || 0),
        startTime: Number(payload.startTime || 0),
        endTime: Number(payload.endTime || 0),
        buyVol: Number(payload.buyVol || 0),
        sellVol: Number(payload.sellVol || 0),
        delta: Number(payload.delta || 0),
        cvd: Number(payload.cvd || 0),
        closed: !!payload.closed,
        tsLocal: Number(payload.tsLocal || fallbackTs || Date.now())
      };
    }

    function footprintKey(candle) {
      return [
        candle.exchange || '',
        candle.symbol || '',
        candle.intervalMs || 0,
        candle.openTime || 0
      ].join(':');
    }

    function mergeFootprintCandles(existing, incoming, maxCandles) {
      var byKey = {};
      var indexByKey = {};
      var merged = [];
      (Array.isArray(existing) ? existing : []).forEach(function (candle) {
        var key = footprintKey(candle);
        if (!key) return;
        byKey[key] = candle;
        indexByKey[key] = merged.length;
        merged.push(candle);
      });
      incoming.forEach(function (candle) {
        var key = footprintKey(candle);
        if (!key) return;
        if (byKey[key]) {
          merged[indexByKey[key]] = candle;
        } else {
          indexByKey[key] = merged.length;
          merged.push(candle);
        }
        byKey[key] = candle;
      });
      merged.sort(function (a, b) {
        return (a.openTime || 0) - (b.openTime || 0);
      });
      if (merged.length > maxCandles) {
        merged = merged.slice(merged.length - maxCandles);
      }
      return merged;
    }

    function normalizeVwap(payload, fallbackTs) {
      return {
        exchange: payload.exchange || 'unknown',
        symbol: payload.symbol || '??',
        sessionId: payload.sessionId || '',
        sessionStart: Number(payload.sessionStart || 0),
        coverageStart: Number(payload.coverageStart || 0),
        lastUpdateTs: Number(payload.lastUpdateTs || payload.ts || 0),
        cumPV: Number(payload.cumPV || 0),
        cumVol: Number(payload.cumVol || 0),
        value: Number(payload.value || 0),
        source: payload.source || 'live',
        isWarm: !!payload.isWarm,
        tsLocal: Number(payload.tsLocal || fallbackTs || Date.now())
      };
    }

    function normalizeOrderBookLevel(level, running) {
      var price = Number(level && level.price);
      var size = Number(level && level.size);
      if (!Number.isFinite(price) || !Number.isFinite(size) || price <= 0 || size < 0) {
        return null;
      }
      var cumulative = Number(level.cumulative);
      if (!Number.isFinite(cumulative) || cumulative < size) {
        cumulative = running + size;
      }
      return {
        price: price,
        size: size,
        orders: Number(level.orders || level.numOrders || 0),
        cumulative: cumulative
      };
    }

    function normalizeOrderBookSide(levels, maxDepth) {
      var out = [];
      var running = 0;
      (Array.isArray(levels) ? levels : []).forEach(function (level) {
        if (out.length >= maxDepth) return;
        var normalized = normalizeOrderBookLevel(level, running);
        if (!normalized) return;
        running = normalized.cumulative;
        out.push(normalized);
      });
      return out;
    }

    function normalizeOrderBook(payload, fallbackTs) {
      var depth = Math.max(1, Math.min(5000, Number(payload.depth || 1000)));
      var bids = normalizeOrderBookSide(payload.bids, depth);
      var asks = normalizeOrderBookSide(payload.asks, depth);
      var bestBid = Number(payload.bestBid || (bids[0] && bids[0].price) || 0);
      var bestAsk = Number(payload.bestAsk || (asks[0] && asks[0].price) || 0);
      var spread = Number(payload.spread);
      if (!Number.isFinite(spread) && bestBid > 0 && bestAsk > 0) {
        spread = bestAsk - bestBid;
      }
      var mid = Number(payload.mid);
      if (!Number.isFinite(mid) && bestBid > 0 && bestAsk > 0) {
        mid = (bestBid + bestAsk) / 2;
      }
      return {
        exchange: payload.exchange || 'unknown',
        symbol: payload.symbol || '??',
        tsExchange: Number(payload.tsExchange || 0),
        tsLocal: Number(payload.tsLocal || fallbackTs || Date.now()),
        bids: bids,
        asks: asks,
        bestBid: Number.isFinite(bestBid) ? bestBid : 0,
        bestAsk: Number.isFinite(bestAsk) ? bestAsk : 0,
        spread: Number.isFinite(spread) ? spread : 0,
        mid: Number.isFinite(mid) ? mid : 0,
        depth: Number(payload.depth || Math.min(bids.length, asks.length)),
        seq: Number(payload.seq || payload.sequence || payload.updateId || payload.lastUpdateId || payload.u || 0),
        firstSeq: Number(payload.firstSeq || payload.firstUpdateId || payload.U || 0),
        prevSeq: Number(payload.prevSeq || payload.previousUpdateId || payload.pu || 0),
        source: payload.source || 'l2Book'
      };
    }

    function clamp01(value) {
      value = Number(value);
      if (!Number.isFinite(value) || value < 0) return 0;
      if (value > 1) return 1;
      return value;
    }

    function normalizeHeatmapFrame(payload, fallbackTs) {
      var priceMin = Number(payload.priceMin);
      var priceMax = Number(payload.priceMax);
      if (!Number.isFinite(priceMin) || !Number.isFinite(priceMax) || priceMin >= priceMax) {
        return null;
      }
      var maxTotal = 0;
      var rawLevels = Array.isArray(payload.levels) ? payload.levels : [];
      rawLevels.forEach(function (level) {
        var total = Number(level && level.totalSize);
        if (Number.isFinite(total) && total > maxTotal) maxTotal = total;
      });
      var levels = rawLevels.map(function (level) {
        var price = Number(level && level.price);
        var bidSize = Number(level && level.bidSize || 0);
        var askSize = Number(level && level.askSize || 0);
        var totalSize = Number(level && level.totalSize);
        if (!Number.isFinite(totalSize)) totalSize = Math.max(0, bidSize) + Math.max(0, askSize);
        var intensity = Number(level && level.intensity);
        if (!Number.isFinite(intensity) && maxTotal > 0) intensity = totalSize / maxTotal;
        if (!Number.isFinite(price) || price <= 0 || totalSize < 0) return null;
        return {
          price: price,
          bidSize: Number.isFinite(bidSize) ? bidSize : 0,
          askSize: Number.isFinite(askSize) ? askSize : 0,
          totalSize: totalSize,
          intensity: clamp01(intensity)
        };
      }).filter(Boolean);
      return {
        exchange: payload.exchange || 'unknown',
        symbol: payload.symbol || '??',
        tsExchange: Number(payload.tsExchange || 0),
        tsLocal: Number(payload.tsLocal || fallbackTs || Date.now()),
        mid: Number(payload.mid || 0),
        bestBid: Number(payload.bestBid || 0),
        bestAsk: Number(payload.bestAsk || 0),
        priceMin: priceMin,
        priceMax: priceMax,
        tickSize: Number(payload.tickSize || 1),
        levels: levels,
        source: payload.source || 'l2Book',
        depth: Number(payload.depth || levels.length)
      };
    }

    function normalizeFootprintLevel(level) {
      var price = Number(level && level.price);
      if (!Number.isFinite(price) || price <= 0) return null;
      var buyVol = Math.max(0, Number(level.buyVol || 0));
      var sellVol = Math.max(0, Number(level.sellVol || 0));
      var totalVol = Number(level.totalVol);
      if (!Number.isFinite(totalVol)) totalVol = buyVol + sellVol;
      var delta = Number(level.delta);
      if (!Number.isFinite(delta)) delta = buyVol - sellVol;
      return {
        price: price,
        buyVol: buyVol,
        sellVol: sellVol,
        delta: delta,
        totalVol: Math.max(0, totalVol),
        trades: Math.max(0, Math.floor(Number(level.trades || 0))),
        // Engine-derived diagonal-imbalance flags (see calc.DeriveFootprintSignals).
        buyImbalance: level.buyImbalance === true,
        sellImbalance: level.sellImbalance === true
      };
    }

    function normalizeFootprintCandle(payload, fallbackTs) {
      var openTime = Number(payload.openTime || 0);
      var closeTime = Number(payload.closeTime || 0);
      var high = Number(payload.high || 0);
      var low = Number(payload.low || 0);
      if (!Number.isFinite(openTime) || openTime <= 0 || !Number.isFinite(high) || !Number.isFinite(low) || high <= 0 || low <= 0 || low > high) {
        return null;
      }
      var levels = (Array.isArray(payload.levels) ? payload.levels : []).map(normalizeFootprintLevel).filter(Boolean);
      return {
        exchange: payload.exchange || 'unknown',
        symbol: payload.symbol || '??',
        intervalMs: Number(payload.intervalMs || 0),
        openTime: openTime,
        closeTime: closeTime,
        open: Number(payload.open || 0),
        high: high,
        low: low,
        close: Number(payload.close || 0),
        volume: Math.max(0, Number(payload.volume || 0)),
        buyVol: Math.max(0, Number(payload.buyVol || 0)),
        sellVol: Math.max(0, Number(payload.sellVol || 0)),
        delta: Number(payload.delta || 0),
        poc: Number(payload.poc || 0),
        closed: !!payload.closed,
        levels: levels,
        source: payload.source || 'trades',
        tsLocal: Number(payload.tsLocal || fallbackTs || Date.now()),
        // Engine-derived orderflow signals — the inspector prefers these over its
        // own client-side computation (deterministic across live/replay).
        signalsDerived: payload.signalsDerived === true,
        maxImbalanceRatio: Math.max(0, Number(payload.maxImbalanceRatio || 0)),
        buyImbalanceCount: Math.max(0, Math.floor(Number(payload.buyImbalanceCount || 0))),
        sellImbalanceCount: Math.max(0, Math.floor(Number(payload.sellImbalanceCount || 0))),
        stackedBuyImbalanceCount: Math.max(0, Math.floor(Number(payload.stackedBuyImbalanceCount || 0))),
        stackedSellImbalanceCount: Math.max(0, Math.floor(Number(payload.stackedSellImbalanceCount || 0))),
        hasBuyAbsorption: payload.hasBuyAbsorption === true,
        hasSellAbsorption: payload.hasSellAbsorption === true,
        isExhaustionHigh: payload.isExhaustionHigh === true,
        isExhaustionLow: payload.isExhaustionLow === true,
        isUnfinishedHigh: payload.isUnfinishedHigh === true,
        isUnfinishedLow: payload.isUnfinishedLow === true
      };
    }

    function normalizeHistoryCandles(arr) {
      var out = [];
      for (var i = 0; i < arr.length; i++) {
        var c = arr[i];
        if (!c) continue;
        var open = Number(c.open), close = Number(c.close), high = Number(c.high), low = Number(c.low);
        var openTime = Number(c.openTime), closeTime = Number(c.closeTime);
        if (!Number.isFinite(open) || open <= 0 || !Number.isFinite(openTime) || openTime <= 0) continue;
        var hasClose = Number.isFinite(closeTime) && closeTime > openTime;
        out.push({
          symbol: c.symbol || 'BTC',
          openTime: openTime,
          closeTime: hasClose ? closeTime : openTime + 60000,
          open: open,
          high: Number.isFinite(high) ? high : open,
          low: Number.isFinite(low) ? low : open,
          close: Number.isFinite(close) ? close : open,
          volume: Number(c.volume) || 0,
          intervalMs: hasClose ? (closeTime - openTime + 1) : 60000,
          source: 'backfill'
        });
      }
      out.sort(function (a, b) { return a.openTime - b.openTime; });
      return out;
    }

    function normalizeRestCandles(arr, interval) {
      var intervalMs = timeframeToMs(interval || '1m');
      var out = [];
      for (var i = 0; i < (Array.isArray(arr) ? arr : []).length; i++) {
        var c = arr[i];
        if (!c) continue;
        var openTime = Number(c.openTime);
        if (!Number.isFinite(openTime) || openTime <= 0) {
          openTime = Number(c.time);
          if (Number.isFinite(openTime) && openTime > 0 && openTime < 1000000000000) openTime *= 1000;
        }
        var closeTime = Number(c.closeTime);
        if (!Number.isFinite(closeTime) || closeTime <= openTime) closeTime = openTime + intervalMs;
        var open = Number(c.open), high = Number(c.high), low = Number(c.low), close = Number(c.close);
        if (!Number.isFinite(openTime) || openTime <= 0 || !Number.isFinite(open) || open <= 0) continue;
        out.push({
          symbol: c.symbol || 'BTC',
          timeframe: interval || c.timeframe || '1m',
          intervalMs: intervalMs,
          openTime: openTime,
          closeTime: closeTime,
          open: open,
          high: Number.isFinite(high) ? high : open,
          low: Number.isFinite(low) ? low : open,
          close: Number.isFinite(close) ? close : open,
          volume: Number(c.volume) || 0,
          priceOnly: true,
          analyticsSource: 'price-only-rest',
          source: 'rest-fallback'
        });
      }
      out.sort(function (a, b) { return a.openTime - b.openTime; });
      return out;
    }

    function newestCandleOpen(candles) {
      if (!Array.isArray(candles) || !candles.length) return 0;
      return Number(candles[candles.length - 1].openTime || 0);
    }

    function shouldRestBackfill(state, interval) {
      state = state || {};
      var cache = state._candlesByInterval || {};
      var candles = cache[interval] || state.chartCandles || [];
      if (!candles.length) return true;
      var newest = newestCandleOpen(candles);
      var intervalMs = timeframeToMs(interval || '1m');
      return newest > 0 && Date.now() - newest > intervalMs * 2.5;
    }

    function restKlinesUrl(state, interval) {
      var src = (state && state.dataSource) || 'binance';
      if (src === 'hyperliquid') {
        var coin = ((state && state.symbol) || 'BTC').replace(/USDT$/i, '') || 'BTC';
        return '/api/hyperliquid/klines?market=' + encodeURIComponent(coin) + '&interval=' + encodeURIComponent(interval) + '&limit=1000';
      }
      var symbol = ((state && state.symbol) || 'BTCUSDT').toUpperCase();
      if (symbol === 'BTC') symbol = 'BTCUSDT';
      return '/api/market/klines?symbol=' + encodeURIComponent(symbol) + '&interval=' + encodeURIComponent(interval) + '&limit=1000&soft=1';
    }

    function handleMessage(event) {
      var msg;
      try {
        msg = JSON.parse(event.data);
      } catch (err) {
        console.warn('[V6 EngineClient] invalid JSON', err);
        return;
      }



      var now = Date.now();
      stats.lastMessageTs = now;
      resetStaleTimer();

      if (msg.type === 'trade' && msg.payload) {
        stats.tradesReceived++;
        if (V6OF.DomLadder) V6OF.DomLadder.feedTrade(msg.payload);
        var trade = {
          id: msg.payload.tradeId || msg.payload.id || ('live-' + msg.seq),
          exchange: msg.payload.exchange || 'unknown',
          symbol: msg.payload.symbol || '??',
          tsExchange: msg.payload.tsExchange || 0,
          tsLocal: msg.payload.tsLocal || msg.tsLocal || Date.now(),
          price: msg.payload.price || 0,
          qty: msg.payload.qty || 0,
          side: msg.payload.side || 'buy',
          notional: (msg.payload.price || 0) * (msg.payload.qty || 0)
        };
        pendingTrades.unshift(trade); // newest first
        if (V6OF.CvdBuckets) V6OF.CvdBuckets.addTrade(trade);
        scheduleBatch();
      } else if (msg.type === 'delta_bucket') {
        stats.deltaBucketsReceived++;
        if (msg.payload) {
          pendingDeltaBuckets.push(normalizeDeltaBucket(msg.payload, msg.tsLocal));
          scheduleBatch();
        } else {
          notify();
        }
      } else if (msg.type === 'vwap') {
        stats.vwapsReceived++;
        if (msg.payload) {
          pendingVwap = normalizeVwap(msg.payload, msg.tsLocal);
          scheduleBatch();
        } else {
          notify();
        }
      } else if (msg.type === 'order_book') {
        stats.orderBooksReceived++;
        if (V6OF.DomLadder) V6OF.DomLadder.feedOrderBook(msg.payload);
        if (msg.payload) {
          pendingOrderBook = normalizeOrderBook(msg.payload, msg.tsLocal);
          // Capturer le point d'historique depth s'il est présent
          if (msg.payload.depthHistoryPoint) {
            pendingDepthPoint = msg.payload.depthHistoryPoint;
          }
          scheduleBatch();
        } else {
          notify();
        }
      } else if (msg.type === 'heatmap_frame') {
        stats.heatmapFramesReceived++;
        if (msg.payload) {
          var frame = normalizeHeatmapFrame(msg.payload, msg.tsLocal);
          if (frame) {
            pendingHeatmapFrames.push(frame);
            scheduleBatch();
          } else {
            notify();
          }
        } else {
          notify();
        }
      } else if (msg.type === 'footprint_candle') {
        stats.footprintCandlesReceived++;
        if (msg.payload) {
          var candle = normalizeFootprintCandle(msg.payload, msg.tsLocal);
          if (candle) {
            pendingFootprintCandles.push(candle);
            scheduleBatch();
          } else {
            notify();
          }
        } else {
          notify();
        }
      } else if (msg.type === 'candle_history') {
        stats.candleHistoryReceived = (stats.candleHistoryReceived || 0) + 1;
        if (msg.payload && Array.isArray(msg.payload.candles) && store) {
          var history = normalizeHistoryCandles(msg.payload.candles);
          if (history.length) {
            var ivKey = msg.payload.interval || '1m';
            var prev = store.getState();
            var byIv = Object.assign({}, prev._candlesByInterval || {});
            byIv[ivKey] = history;
            var patch = {
              _candlesByInterval: byIv,
              source: 'live',
              dataFreshness: 'live',
              isStale: false,
              lastMessageAt: Date.now(),
              symbol: (function (s) { return s === 'BTC' ? 'BTCUSDT' : s; })(msg.payload.symbol || history[history.length - 1].symbol || prev.symbol)
            };
            // Show this interval on the chart only if it's the active timeframe
            // (or nothing has been shown yet).
            var activeTf = prev.timeframe || '1m';
            if (ivKey === activeTf || !(prev.chartCandles && prev.chartCandles.length)) {
              patch.chartCandles = history;
            }
            store.setState(patch, 'candle-history-' + ivKey);
          }
        }
        notify();
      } else if (msg.type === 'replay_status') {
        if (msg.payload && store) {
          store.setState({ replay: msg.payload }, 'replay-status');
        }
        notify();
      } else if (msg.type === 'heartbeat') {
        // heartbeat - just update lastMessageTs
        notify();
      } else if (msg.type === 'source_switched') {
        // G3: Go engine confirmed source switch — request fresh CVD history.
        var newSource = msg.source || 'unknown';
        console.log('[V6] source switched to', newSource);
        if (V6OF.CvdBuckets) V6OF.CvdBuckets.reset();
        // Don't clear trades/orderBook — keep old data visible until new exchange sends fresh data
        if (store) {
          store.setState({ dataSource: newSource }, 'source-switched');
        }
        // Request CVD history for the new exchange
        var activeTf = (store && store.getState().timeframe) || '1m';
        if (ws && status === 'connected') {
          try {
            ws.send(JSON.stringify({ type: 'cvd_history_request', timeframe: activeTf }));
          } catch (e) {
            console.warn('[V6] failed to request CVD after source switch', e);
          }
        }
        notify();
      } else if (msg.type === 'cvd_init' && msg.payload) {
        // Initialisation CVD historique depuis le serveur
        if (V6OF.CvdBuckets && V6OF.CvdBuckets.loadHistory) {
          var activeTf = (store && store.getState().timeframe) || '1m';
          var intervalMs = timeframeToMs(activeTf);
          V6OF.CvdBuckets.loadHistory(msg.payload, intervalMs);
          console.log('[V6] loaded CVD history (' + activeTf + '):',
            (msg.payload.series ? Object.keys(msg.payload.series).length : 0) + ' series,',
            (msg.payload.deltaVol ? msg.payload.deltaVol.length : 0) + ' delta points');
          if (store) {
            store.setState({ cvdLoadedAt: Date.now() }, 'cvd-init-loaded');
          }
        }
        notify();
      } else if (msg.type === 'depth_history' && msg.payload) {
        // Initialisation historique depth depuis le serveur
        var points = msg.payload.points;
        if (Array.isArray(points) && points.length) {
          depthHistory = points.slice();
          if (depthHistory.length > MAX_DEPTH_HISTORY) {
            depthHistory = depthHistory.slice(depthHistory.length - MAX_DEPTH_HISTORY);
          }
          if (store) {
            store.setState({ depthHistory: depthHistory }, 'depth-history-init');
          }
          console.log('[V6] loaded depth history: ' + depthHistory.length + ' points');
        }
        notify();
      }
    }

    function clearReconnectTimer() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function resetStaleTimer() {
      if (staleTimer) {
        clearTimeout(staleTimer);
        staleTimer = null;
      }
      if (status === 'connected') {
        staleTimer = setTimeout(function () {
          staleTimer = null;
          if (status === 'connected' && store) {
            store.setState({ isStale: true }, 'stale-detected');
            notify();
          }
        }, STALE_THRESHOLD_MS);
      }
    }

    function clearStaleTimer() {
      if (staleTimer) {
        clearTimeout(staleTimer);
        staleTimer = null;
      }
    }

    function scheduleReconnect(gen) {
      if (intentionalClose) return;
      if (reconnectAttempt >= RECONNECT_MAX_ATTEMPTS) {
        setStatus('error', 'Max reconnect attempts (' + RECONNECT_MAX_ATTEMPTS + ') reached');
        return;
      }
      var delay = Math.min(
        RECONNECT_BASE_MS * Math.pow(2, reconnectAttempt),
        RECONNECT_MAX_MS
      );
      reconnectAttempt++;
      stats.reconnectsCount++;
      console.log('[V6 EngineClient] scheduling reconnect #' + reconnectAttempt + ' in ' + delay + 'ms');
      setStatus('connecting');

      reconnectTimer = setTimeout(function () {
        reconnectTimer = null;
        if (gen !== generation) return;
        doConnect(gen);
      }, delay);
    }

    function doConnect(gen) {
      if (gen !== generation) return;
      intentionalClose = false;
      setStatus('connecting');

      try {
        ws = new WebSocket(DEFAULT_URL);
      } catch (err) {
        setStatus('error', 'WebSocket constructor failed: ' + err.message);
        return;
      }

      ws.onopen = function () {
        if (gen !== generation) { ws.close(); return; }
        reconnectAttempt = 0;
        setStatus('connected');
        console.log('[V6 EngineClient] connected to', DEFAULT_URL);

        // Request CVD history for the active timeframe
        var activeTf = (store && store.getState().timeframe) || '1m';
        try {
          ws.send(JSON.stringify({ type: 'cvd_history_request', timeframe: activeTf }));
          console.log('[V6 Client] requested initial CVD history for timeframe:', activeTf);
        } catch (e) {
          console.warn('[V6 Client] failed to send initial cvd request:', e);
        }
        fetchFootprintHistory();
        sendFootprintConfig(true);
        scheduleCandleFallback('ws-open');
      };

      ws.onmessage = function (event) {
        if (gen !== generation) return;
        handleMessage(event);
      };

      ws.onerror = function () {
        if (gen !== generation) return;
        // onerror fires before onclose, so just log
        console.warn('[V6 EngineClient] websocket error');
      };

      ws.onclose = function (event) {
        if (gen !== generation) return;
        var reason = event.reason || ('code ' + event.code);
        console.log('[V6 EngineClient] websocket closed:', reason);
        ws = null;
        if (!intentionalClose) {
          setStatus('error', 'Connection closed: ' + reason);
          scheduleReconnect(gen);
        } else {
          setStatus('disconnected');
        }
      };
    }
    function fetchCandleHistory(reason) {
      if (!store) return;
      var state = store.getState();
      var interval = state.timeframe || '1m';
      if (!shouldRestBackfill(state, interval)) return;
      var url = restKlinesUrl(state, interval);
      tryFetch(url, 2).then(function (data) {
        var raw = [];
        if (data && Array.isArray(data.candles)) raw = data.candles;
        var candles = normalizeRestCandles(raw, interval);
        if (!candles.length || !store) return;
        store.setState(function (prev) {
          var byIv = Object.assign({}, prev._candlesByInterval || {});
          byIv[interval] = candles;
          var patch = {
            _candlesByInterval: byIv,
            source: 'rest-fallback',
            dataFreshness: 'rest-fallback',
            isStale: false,
            lastMessageAt: Date.now()
          };
          if ((prev.timeframe || '1m') === interval || !(prev.chartCandles && prev.chartCandles.length)) {
            patch.chartCandles = candles;
          }
          return patch;
        }, 'rest-candle-fallback-' + (reason || 'connect'));
        if (V6OF.chart && V6OF.chart.resetOnDataChange && !(state.chartCandles && state.chartCandles.length)) {
          V6OF.chart.resetOnDataChange();
        }
        console.log('[V6] REST candle fallback loaded', interval, candles.length, reason || '');
        fetchFootprintHistory({ symbol: state.symbol || 'BTC', timeframe: interval });
      }).catch(function (err) {
        console.warn('[V6] REST candle fallback failed', err);
      });
    }
    // Tracks the last footprint history fetch: {symbol, tf, from, to, ts}
    var _lastFpFetch = null;

    function fetchFootprintHistory(options) {
      if (!store) return Promise.resolve(null);
      options = options || {};
      var state = store.getState();
      var symbol = normalizeSymbol(options.symbol || state.symbol || 'BTC');
      var tf = options.timeframe || state.timeframe || '1m';
      var intervalMsValue = timeframeToMs(tf);
      var from = Number(options.from || options.startTime || 0);
      var to = Number(options.to || options.endTime || 0);
      if ((!from || !to) && Array.isArray(state.chartCandles) && state.chartCandles.length) {
        var firstChartCandle = state.chartCandles[0];
        var lastChartCandle = state.chartCandles[state.chartCandles.length - 1];
        from = from || Number(firstChartCandle.openTime || 0);
        to = to || Number(lastChartCandle.closeTime || (Number(lastChartCandle.openTime || 0) + intervalMsValue - 1));
      }
      var limit = Math.max(1, Math.min(3000, Number(options.limit || DEFAULT_MAX_FOOTPRINT_CANDLES)));

      // --- Idempotency guard ---
      // Don't re-fetch the full history if we already have it for this symbol+tf+window.
      // Only bypass when explicitly called with a forced small range (e.g. inspector, limit<=20).
      var isSmallFetch = options.limit && options.limit <= 20;
      if (!isSmallFetch && _lastFpFetch) {
        var sameKey = _lastFpFetch.symbol === symbol && _lastFpFetch.tf === tf;
        var sameWindow = (!from || _lastFpFetch.from <= from) && (!to || _lastFpFetch.to >= to);
        var recentEnough = (Date.now() - _lastFpFetch.ts) < 60000; // 1 min debounce
        if (sameKey && sameWindow && recentEnough) {
          // Check we actually have candles covering this window
          var fp = state.footprintCandles || [];
          if (fp.length > 0) {
            console.log('[V6 Client] footprint history already loaded (' + fp.length + ' candles), skipping refetch');
            return Promise.resolve(null);
          }
        }
      }
      _lastFpFetch = { symbol: symbol, tf: tf, from: from, to: to, ts: Date.now() };

      var url = resolveMarketUrl(tf === '1m' ? '/api/v1/footprint/1m' : '/api/v1/footprint/tf', 'http');
      url += '?symbol=' + encodeURIComponent(symbol);
      if (tf !== '1m') {
        url += '&tf=' + encodeURIComponent(tf);
      }
      if (from > 0) url += '&from=' + encodeURIComponent(Math.floor(from));
      if (to > 0) url += '&to=' + encodeURIComponent(Math.floor(to));
      url += '&limit=' + encodeURIComponent(limit);

      console.log('[V6 Client] fetching footprint history from:', url);
      
      return fetch(url)
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          if (!data || !Array.isArray(data.candles)) return;
          var candles = data.candles.map(function (c) {
            return {
              exchange: state.dataSource || 'local',
              symbol: symbol,
              intervalMs: intervalMsValue,
              openTime: c.ts,
              closeTime: c.ts + intervalMsValue - 1,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume,
              buyVol: c.buy_volume,
              sellVol: c.sell_volume,
              delta: c.delta,
              poc: c.close,
              closed: true,
              levels: (c.profile || []).map(function (lv) {
                var buy = Number(lv.b || 0);
                var sell = Number(lv.s || 0);
                return {
                  price: Number(lv.p),
                  buyVol: buy,
                  sellVol: sell,
                  delta: buy - sell,
                  totalVol: buy + sell
                };
              }),
              source: 'history',
              tsLocal: Date.now()
            };
          });
          
          if (!candles.length) return;
          
          store.setState(function (prev) {
            var maxCandles = Math.max(60, Math.min(3000, Number((prev.settings && prev.settings.footprintMaxCandles) || DEFAULT_MAX_FOOTPRINT_CANDLES)));
            var merged = mergeFootprintCandles(prev.footprintCandles || [], candles, maxCandles);
            var lastCandle = merged[merged.length - 1];
            return {
              footprintCandles: merged,
              lastFootprintCandle: lastCandle || null,
              lastFootprintTs: lastCandle ? (lastCandle.tsLocal || Date.now()) : 0,
              selectedFootprintSymbol: symbol,
              selectedFootprintTimeframe: tf
            };
          }, 'footprint-history-loaded');
          
          console.log('[V6 Client] footprint history loaded:', candles.length, 'candles');
        })
        .catch(function (err) {
          console.warn('[V6 Client] failed to load footprint history:', err);
        });
    }

    function scheduleCandleFallback(reason) {
      if (candleFallbackTimer) clearTimeout(candleFallbackTimer);
      candleFallbackTimer = setTimeout(function () {
        candleFallbackTimer = null;
        fetchCandleHistory(reason);
      }, 1200);
    }

    // Expose cache so timeframe switch can use it
    function switchCandlesToTimeframe(interval) {
      if (!store) return;
      var state = store.getState();
      var cache = state._candlesByInterval || {};
      var candles = cache[interval];
      if (candles && candles.length) {
        store.setState({ chartCandles: candles, timeframe: interval }, 'switch-tf');
      }
      fetchFootprintHistory({ symbol: state.symbol || 'BTC', timeframe: interval });
    }

    function tryFetch(url, retries) {
      return fetch(url).then(function (res) {
        if (res.ok) return res.json();
        if (retries > 0 && (res.status === 502 || res.status === 503 || res.status === 429)) {
          console.log('[V6] retry', url, 'status', res.status, 'retries left:', retries);
          return new Promise(function (resolve) { setTimeout(resolve, 1500); }).then(function () {
            return tryFetch(url, retries - 1);
          });
        }
        throw new Error('HTTP ' + res.status);
      });
    }

    return {
      /**
       * Connect to the local engine. The layout calls this automatically on mount;
       * the header control can still use it for reconnect.
       */
      connect: function () {
        if (status === 'connected' || status === 'connecting') return;
        generation++;
        reconnectAttempt = 0;
        intentionalClose = false;
        clearReconnectTimer();
        doConnect(generation);
        fetchCandleHistory();
      },

      /**
       * Send a JSON message via the WebSocket (if connected).
       */
      sendMessage: function (obj) {
        if (ws && status === 'connected') {
          try {
            ws.send(JSON.stringify(obj));
          } catch (e) {
            console.warn('[V6 EngineClient] send failed', e);
          }
        }
      },

      /**
       * Disconnect from the local engine.
       */
      disconnect: function () {
        generation++;
        intentionalClose = true;
        clearReconnectTimer();
        clearStaleTimer();
        if (candleFallbackTimer) {
          clearTimeout(candleFallbackTimer);
          candleFallbackTimer = null;
        }
        if (batchTimer) {
          clearTimeout(batchTimer);
          batchTimer = null;
        }
        pendingTrades = [];
        pendingDeltaBuckets = [];
        pendingVwap = null;
        pendingOrderBook = null;
        pendingHeatmapFrames = [];
        pendingFootprintCandles = [];
        if (ws) {
          ws.onopen = null;
          ws.onmessage = null;
          ws.onerror = null;
          ws.onclose = null;
          try { ws.close(); } catch (e) { /* ignore */ }
          ws = null;
        }
        if (store) {
          store.setState({ isStale: false, lastMessageAt: 0 }, 'engine-disconnect');
        }
        setStatus('disconnected');
      },

      /**
       * @returns {V6EngineStatus}
       */
      getStatus: function () {
        return status;
      },

      /**
       * @returns {V6EngineStats}
       */
      getStats: function () {
        return statsSnapshot();
      },

      /**
       * @returns {boolean}
       */
      isPaused: function () {
        return paused;
      },

      /**
       * Pause the tape render (new trades still accumulate in buffer).
       */
      pause: function () {
        paused = true;
        notify();
      },

      /**
       * Resume the tape render and push buffered trades to store.
       */
      resume: function () {
        paused = false;
        if (store && tradeBuffer.length) {
          store.setState({ trades: tradeBuffer.slice() }, 'resume');
        }
        notify();
      },

      /**
       * Clear the trade buffer.
       */
      clearTrades: function () {
        tradeBuffer = [];
        pendingTrades = [];
        pendingDeltaBuckets = [];
        if (store) {
          store.setState({ trades: [] }, 'clear-tape');
        }
        notify();
      },

      /**
       * Clear heatmap frames from store.
       */
      clearHeatmap: function () {
        pendingHeatmapFrames = [];
        if (store) {
          store.clearHeatmap();
        }
        notify();
      },

      /**
       * Clear footprint candles from store.
       */
      clearFootprint: function () {
        pendingFootprintCandles = [];
        if (store) {
          store.clearFootprint();
        }
        notify();
      },

      /**
       * Clear all UI buffers (trades + heatmap + footprint). Does NOT reset CVD/VWAP.
       */
      clearAllBuffers: function () {
        tradeBuffer = [];
        pendingTrades = [];
        pendingHeatmapFrames = [];
        pendingFootprintCandles = [];
        if (store) {
          store.clearAllBuffers();
        }
        notify();
      },

      fetchCandleHistory: function () {
        fetchCandleHistory();
      },

      fetchFootprintHistory: function (options) {
        return fetchFootprintHistory(options || {});
      },

      switchTimeframe: function (interval) {
        switchCandlesToTimeframe(interval);
      },

      /**
       * Subscribe to status/stats changes.
       * @param {Function} fn
       * @returns {Function} unsubscribe
       */
      subscribe: function (fn) {
        if (typeof fn !== 'function') return function () {};
        listeners.push(fn);
        return function () {
          listeners = listeners.filter(function (item) { return item !== fn; });
        };
      },

      /**
       * Destroy the client (for cleanup).
       */
      destroy: function () {
        this.disconnect();
        clearStaleTimer();
        listeners = [];
        tradeBuffer = [];
      }
    };
  }

  V6OF.register('Transport', 'EngineClient', {
    create: createClient
  }, 'EngineClient');
})();
