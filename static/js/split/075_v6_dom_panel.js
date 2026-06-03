// ---------- 075_v6_dom_panel.js ----------
// Professional DOM ladder v3: source-aware depth window + visual wall detection.

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};
  var RENDER_THROTTLE = 160;

  function fmt(v, showZero) {
    if (v == null || !Number.isFinite(Number(v))) return '';
    v = Number(v);
    if (v === 0 && !showZero) return '';
    if (Math.abs(v) < 0.5 && !showZero) return '';
    if (v >= 1000000) return Math.round(v / 1e6) + 'M';
    if (v >= 1000) return Math.round(v / 1e3) + 'K';
    return String(Math.round(v));
  }

  function fmtSigned(v) {
    if (v == null || !Number.isFinite(Number(v)) || v === 0) return '';
    var a = Math.abs(v);
    if (a < 1) return '';
    var s = a >= 1000000 ? Math.round(a / 1e6) + 'M'
          : a >= 1000 ? Math.round(a / 1e3) + 'K'
          : String(Math.round(a));
    return (v >= 0 ? '+' : '') + s;
  }

  function fmtPrice(v) {
    if (v == null || !Number.isFinite(Number(v))) return '-';
    if (v >= 1000) return String(Math.round(v));
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }

  function clampInt(v, min, max, fallback) {
    v = parseInt(v, 10);
    if (!Number.isFinite(v)) return fallback;
    return Math.max(min, Math.min(max, v));
  }

  function median(values) {
    var nums = values.filter(function (v) { return Number.isFinite(v) && v > 0; }).sort(function (a, b) { return a - b; });
    if (!nums.length) return 1;
    var mid = Math.floor(nums.length / 2);
    return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
  }

  function fmtAge(ts) {
    if (!ts || !Number.isFinite(Number(ts))) return '-';
    var age = Math.max(0, Date.now() - Number(ts));
    if (age < 1000) return age + 'ms';
    if (age < 60000) return (age / 1000).toFixed(age < 10000 ? 1 : 0) + 's';
    return Math.floor(age / 60000) + 'm';
  }

  function sourceLabel(state, ladder) {
    var source = (state && state.dataSource) || (ladder && ladder.source) || 'binance';
    var symbol = (state && state.symbol) || (state && state.selectedSymbol) || (source === 'hyperliquid' ? 'BTC' : 'BTCUSDT');
    var nice = source === 'hyperliquid' ? 'Hyperliquid' : 'Binance';
    return String(symbol).toUpperCase() + ' @ ' + nice;
  }

  function livePrice(state, ladder) {
    var trades = state && state.trades;
    if (trades && trades.length && Number.isFinite(Number(trades[0].price))) return Number(trades[0].price);
    if (ladder && Number.isFinite(Number(ladder.midPrice))) return Number(ladder.midPrice);
    return NaN;
  }

  var autoCenter = true;
  var userScrolled = false;
  var suppressScrollUntil = 0;
  var lastRenderKey = '';

  function scrollHost(container) {
    var body = container && container.querySelector('.v6-dom-body');
    if (body && body.scrollHeight > body.clientHeight + 4) return body;
    return container;
  }

  function centerLiveRow(container, smooth) {
    var row = container && (container.querySelector('.v6-dom-row.is-live') || container.querySelector('.v6-dom-row.is-mid'));
    var body = scrollHost(container);
    if (!body || !row) return;
    suppressScrollUntil = Date.now() + 450;
    var targetCenter = Math.max(0, Math.round((body.clientHeight - row.offsetHeight) * 0.48));
    var nextTop = Math.max(0, row.offsetTop - targetCenter);
    if (typeof body.scrollTo === 'function') {
      body.scrollTo({ top: nextTop, behavior: smooth ? 'smooth' : 'auto' });
    } else {
      body.scrollTop = nextTop;
    }
    setTimeout(function () {
      if (Date.now() >= suppressScrollUntil) suppressScrollUntil = 0;
    }, smooth ? 520 : 80);
  }

  function _buildSkeleton(container, groupOpts, grouping, settings) {
    var range = clampInt(settings && settings.domRangeLevels, 25, 500, 100);
    var wallsOnly = !!(settings && settings.domWallsOnly);
    container.innerHTML =
      '<div class="v6-dom-header">' +
        '<div class="v6-dom-hleft">' +
          '<span class="v6-dom-stat v6-dom-source"><em>SRC</em><strong data-dom-stat="source">-</strong></span>' +
          '<span class="v6-dom-stat"><em>AGE</em><strong data-dom-stat="age">-</strong></span>' +
          '<span class="v6-dom-stat v6-dom-stat-mid"><em>MID</em><strong class="is-mid" data-dom-stat="mid">-</strong></span>' +
          '<span class="v6-dom-stat"><em>SPR</em><strong data-dom-stat="spread">-</strong></span>' +
        '</div>' +
        '<div class="v6-dom-hright">' +
          '<span class="v6-dom-stat"><em>DEPTH</em><span data-dom-stat="depth">0/0</span></span>' +
          '<button class="v6-dom-recenter" title="Re-center to mid">C</button>' +
        '</div>' +
      '</div>' +
      '<div class="v6-dom-cols">' +
        '<div class="v6-dom-col v6-dom-col-bid">BIDS</div>' +
        '<div class="v6-dom-col v6-dom-col-price">PRICE</div>' +
        '<div class="v6-dom-col v6-dom-col-ask">ASKS</div>' +
        '<div class="v6-dom-col v6-dom-col-buy">BUYS</div>' +
        '<div class="v6-dom-col v6-dom-col-sell">SELLS</div>' +
        '<div class="v6-dom-col v6-dom-col-delta">DELTA</div>' +
      '</div>' +
      '<div class="v6-dom-body"></div>' +
      '<div class="v6-dom-footer">' +
        '<label class="v6-dom-glbl">Group <select class="v6-dom-grouping">' +
          groupOpts.map(function (g) { return '<option value="' + g + '"' + (g === grouping ? ' selected' : '') + '>' + g + '</option>'; }).join('') +
        '</select></label>' +
        '<label class="v6-dom-glbl">Range <select class="v6-dom-range">' +
          [25, 50, 100, 250, 500].map(function (n) { return '<option value="' + n + '"' + (n === range ? ' selected' : '') + '>' + n + '</option>'; }).join('') +
        '</select></label>' +
        '<button class="v6-dom-walls-toggle' + (wallsOnly ? ' is-active' : '') + '" type="button" title="Afficher uniquement les gros niveaux">◆</button>' +
      '</div>';
  }

  function _setStat(container, name, value) {
    var el = container.querySelector('[data-dom-stat="' + name + '"]');
    if (el && el.textContent !== String(value)) el.textContent = String(value);
  }

  function _syncControls(container, grouping, settings) {
    var sel = container.querySelector('.v6-dom-grouping');
    if (sel && String(sel.value) !== String(grouping)) sel.value = grouping;
    var range = container.querySelector('.v6-dom-range');
    var rangeValue = clampInt(settings && settings.domRangeLevels, 25, 500, 100);
    if (range && String(range.value) !== String(rangeValue)) range.value = String(rangeValue);
    var walls = container.querySelector('.v6-dom-walls-toggle');
    if (walls) walls.classList.toggle('is-active', !!(settings && settings.domWallsOnly));
  }

  function _isEmpty(lv) {
    return lv.bidSize <= 0 && lv.askSize <= 0 && lv.buyVol <= 0 && lv.sellVol <= 0;
  }

  function _bookDepth(state, levels) {
    var book = state && state.orderBook;
    var liveDepth = Number(state && state.liveDepthCount) || 0;
    var restDepth = Number(state && state.restDepthCount) || 0;
    if (liveDepth || restDepth) {
      if (liveDepth && restDepth) return 'L' + liveDepth + '/R' + restDepth;
      if (liveDepth) return 'L' + liveDepth;
      return 'R' + restDepth;
    }
    if (book && Array.isArray(book.bids) && Array.isArray(book.asks)) {
      return book.bids.length + '/' + book.asks.length;
    }
    return String(levels ? levels.length : 0);
  }

  function render(container, ladder, state) {
    if (!container) return;
    state = state || {};
    var settings = state.settings || {};

    if (!ladder || !ladder.levels || !ladder.levels.length) {
      if (!container._domBuilt) {
        var emptyGroupOpts = V6OF.DomLadder && V6OF.DomLadder.getGroupingOptions
          ? V6OF.DomLadder.getGroupingOptions() : [1, 5, 10, 25, 50, 100, 250];
        _buildSkeleton(container, emptyGroupOpts, ladder ? (ladder.priceGrouping || 10) : 10, settings);
        container._domBuilt = true;
      }
      var emptyBody = container.querySelector('.v6-dom-body');
      if (emptyBody) emptyBody.innerHTML = '<div class="v6-dom-empty">Waiting for order book...</div>';
      _setStat(container, 'source', sourceLabel(state, ladder));
      _setStat(container, 'age', '-');
      return;
    }

    var now = Date.now();
    if (container._domLastRender && now - container._domLastRender < RENDER_THROTTLE) return;

    var levels = ladder.levels;
    var mid = ladder.midPrice;
    var bid = ladder.bestBid;
    var ask = ladder.bestAsk;
    var live = livePrice(state, ladder);
    var grouping = ladder.priceGrouping || 1;
    var rangeLevels = clampInt(settings.domRangeLevels, 25, 500, 100);
    var wallRatioThreshold = clampInt(settings.domWallRatio, 2, 12, 4);
    var wallsOnly = settings.domWallsOnly === true;

    var groupOpts = V6OF.DomLadder && V6OF.DomLadder.getGroupingOptions
      ? V6OF.DomLadder.getGroupingOptions() : [1, 5, 10, 25, 50, 100, 250];
    if (!container._domBuilt) {
      _buildSkeleton(container, groupOpts, grouping, settings);
      container._domBuilt = true;
    }

    function gp(p) { if (grouping <= 1) return p; return Math.round(p / grouping) * grouping; }
    var gMid = gp(mid);
    var gBid = gp(bid);
    var gAsk = gp(ask);
    var gLive = Number.isFinite(live) && live > 0 ? gp(live) : gMid;
    var anchorIdx = 0;
    var bestAnchorDist = Infinity;
    for (var j = 0; j < levels.length; j++) {
      var dist = Math.abs(levels[j].price - gLive);
      if (dist < bestAnchorDist) {
        bestAnchorDist = dist;
        anchorIdx = j;
      }
    }

    var half = Math.max(12, Math.floor(rangeLevels / 2));
    var start = Math.max(0, anchorIdx - half);
    var end = Math.min(levels.length, anchorIdx + half + 1);
    var windowLevels = levels.slice(start, end);
    var liq = [];
    var maxBid = 1;
    var maxAsk = 1;
    for (var i = 0; i < windowLevels.length; i++) {
      var src = windowLevels[i];
      if (src.bidSize > 0) liq.push(src.bidSize);
      if (src.askSize > 0) liq.push(src.askSize);
      if (src.bidSize > maxBid) maxBid = src.bidSize;
      if (src.askSize > maxAsk) maxAsk = src.askSize;
    }
    var base = Math.max(1, median(liq));

    var key = [
      gLive.toFixed(1), gMid.toFixed(1), grouping, rangeLevels, wallsOnly ? 1 : 0, wallRatioThreshold,
      windowLevels.length,
      windowLevels[0] ? windowLevels[0].price + ':' + windowLevels[0].bidSize.toFixed(1) + ':' + windowLevels[0].askSize.toFixed(1) : '',
      windowLevels[windowLevels.length - 1] ? windowLevels[windowLevels.length - 1].price + ':' + windowLevels[windowLevels.length - 1].bidSize.toFixed(1) + ':' + windowLevels[windowLevels.length - 1].askSize.toFixed(1) : ''
    ].join('|');
    if (key === lastRenderKey && container._domBuilt) {
      _setStat(container, 'source', sourceLabel(state, ladder));
      _setStat(container, 'age', fmtAge(state.lastOrderBookTs || ladder.lastUpdate || ladder.tsLocal));
      _syncControls(container, grouping, settings);
      container._domLastRender = now;
      return;
    }
    lastRenderKey = key;

    var rows = [];
    var walls = 0;
    for (i = windowLevels.length - 1; i >= 0; i--) {
      var lv = windowLevels[i];
      var isMid = mid > 0 && Math.abs(lv.price - gMid) <= Math.max(0.0001, grouping / 2);
      var isLive = gLive > 0 && Math.abs(lv.price - gLive) <= Math.max(0.0001, grouping / 2);
      var isBid = bid > 0 && Math.abs(lv.price - gBid) <= Math.max(0.0001, grouping / 2);
      var isAsk = ask > 0 && Math.abs(lv.price - gAsk) <= Math.max(0.0001, grouping / 2);
      var bidRatio = lv.bidSize > 0 ? lv.bidSize / base : 0;
      var askRatio = lv.askSize > 0 ? lv.askSize / base : 0;
      var wallRatio = Math.max(bidRatio, askRatio);
      var isWall = wallRatio >= wallRatioThreshold;
      if (isWall) walls++;
      if (_isEmpty(lv) && !isMid && !isBid && !isAsk && !isWall) continue;
      if (wallsOnly && !isWall && !isMid && !isBid && !isAsk) continue;

      var cls = '';
      if (isMid) cls += ' is-mid';
      if (isLive) cls += ' is-live';
      if (isBid) cls += ' is-best-bid';
      if (isAsk) cls += ' is-best-ask';
      if (lv.bidSize > 0) cls += ' has-bid';
      if (lv.askSize > 0) cls += ' has-ask';
      if (isWall) {
        cls += ' is-wall';
        cls += bidRatio >= askRatio ? ' is-wall-bid' : ' is-wall-ask';
        cls += wallRatio >= 8 ? ' is-wall-8' : wallRatio >= 4 ? ' is-wall-4' : ' is-wall-2';
      }

      var bidPct = Math.min(100, (lv.bidSize / maxBid * 100)).toFixed(1);
      var askPct = Math.min(100, (lv.askSize / maxAsk * 100)).toFixed(1);
      var badge = isWall ? '<span class="v6-dom-wall-badge">' + Math.round(wallRatio) + 'x</span>' : '';
      var liveBadge = isLive ? '<span class="v6-dom-live-pill">LIVE</span>' : '';

      rows.push(
        '<div class="v6-dom-row' + cls + '">' +
          '<div class="v6-dom-cell v6-dom-cell-bid">' +
            '<div class="v6-dom-bar is-bid" style="width:' + bidPct + '%"></div>' +
            '<span class="v6-dom-val">' + fmt(lv.bidSize) + '</span>' +
          '</div>' +
          '<div class="v6-dom-cell v6-dom-cell-price">' + (isLive ? '<span class="v6-dom-marker">></span>' : '') + fmtPrice(lv.price) + liveBadge + badge + '</div>' +
          '<div class="v6-dom-cell v6-dom-cell-ask">' +
            '<div class="v6-dom-bar is-ask" style="width:' + askPct + '%"></div>' +
            '<span class="v6-dom-val">' + fmt(lv.askSize) + '</span>' +
          '</div>' +
          '<div class="v6-dom-cell v6-dom-cell-buy">' + fmt(lv.buyVol) + '</div>' +
          '<div class="v6-dom-cell v6-dom-cell-sell">' + fmt(lv.sellVol) + '</div>' +
          '<div class="v6-dom-cell v6-dom-cell-delta">' + fmtSigned(lv.delta) + '</div>' +
        '</div>'
      );
    }

    var body = container.querySelector('.v6-dom-body');
    if (body) body.innerHTML = rows.length ? rows.join('') : '<div class="v6-dom-empty">No visible levels in current filter.</div>';

    _setStat(container, 'source', sourceLabel(state, ladder));
    _setStat(container, 'age', fmtAge(state.lastOrderBookTs || ladder.lastUpdate || ladder.tsLocal));
    _setStat(container, 'mid', fmtPrice(mid));
    _setStat(container, 'spread', fmtPrice(ladder.spread));
    _setStat(container, 'depth', _bookDepth(state, levels));
    _syncControls(container, grouping, settings);

    container._domLastRender = now;

    if (autoCenter && !userScrolled) {
      centerLiveRow(container, false);
      requestAnimationFrame(function () { centerLiveRow(container, false); });
    }
  }

  function bindControls(container, onGroupChange, onRecenter, onSettingsPatch) {
    if (!container || container._domControlsBound) return;
    container._domControlsBound = true;
    container.addEventListener('change', function (event) {
      var target = event.target;
      if (!target) return;
      if (target.classList.contains('v6-dom-grouping') && onGroupChange) {
        lastRenderKey = '';
        onGroupChange(Number(target.value));
      }
      if (target.classList.contains('v6-dom-range') && onSettingsPatch) {
        onSettingsPatch({ domRangeLevels: clampInt(target.value, 25, 500, 100) });
      }
    });
    container.addEventListener('click', function (event) {
      var target = event.target;
      if (!target) return;
      if (target.classList.contains('v6-dom-recenter')) {
        autoCenter = true;
        userScrolled = false;
        if (onRecenter) onRecenter();
        centerLiveRow(container, true);
      }
      if (target.classList.contains('v6-dom-walls-toggle') && onSettingsPatch) {
        onSettingsPatch({ domWallsOnly: !target.classList.contains('is-active') });
      }
    });
    container.addEventListener('wheel', function () {
      if (Date.now() < suppressScrollUntil) return;
      autoCenter = false;
      userScrolled = true;
    }, { passive: true });
    container.addEventListener('pointerdown', function (event) {
      if (event.target && event.target.closest('button,select,input,label')) return;
      autoCenter = false;
      userScrolled = true;
    }, { passive: true });
  }

  V6OF.DomPanel = {
    render: render,
    bindControls: bindControls,
    resetCenter: function () { autoCenter = true; userScrolled = false; }
  };
})();
