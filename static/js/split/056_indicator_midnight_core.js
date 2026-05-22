// ---------- Midnight Core ----------
// Shared helper for 060 (BTC widget) and 062 (chart page).

(function () {
  var _cache = {};
  var _pending = {};

  var MIDNIGHT_COLOR = '#00f5ff';

  function _toMs(ts) {
    var n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return Date.now();
    return n > 1e12 ? n : n * 1000;
  }

  function getNyDateString(timestampMs) {
    var ms = _toMs(timestampMs);
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(ms));

    var out = { year: '0000', month: '01', day: '01' };
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.type === 'year' || p.type === 'month' || p.type === 'day') {
        out[p.type] = p.value;
      }
    }
    return out.year + '-' + out.month + '-' + out.day;
  }

  function _cacheKey(symbol, dateNy) {
    return (symbol || 'BTCUSDT').toUpperCase() + ':' + dateNy;
  }

  function _fetchDay(symbol, dateNy, force) {
    var sym = (symbol || 'BTCUSDT').toUpperCase();
    var key = _cacheKey(sym, dateNy);

    if (force) delete _cache[key];
    if (!force && _cache[key]) return Promise.resolve(_cache[key]);
    if (_pending[key]) return _pending[key];

    var url = '/api/models/midnight/day?symbol=' + encodeURIComponent(sym) + '&date=' + encodeURIComponent(dateNy);
    if (force) url += '&_=' + Date.now();
    var req = fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        _cache[key] = data || null;
        return _cache[key];
      })
      .catch(function (e) {
        console.warn('[MIDNIGHT] fetch failed', sym, dateNy, e);
        return null;
      })
      .finally(function () {
        delete _pending[key];
      });

    _pending[key] = req;
    return req;
  }

  function _getNyMinuteOfDay(timestampMs) {
    var ms = _toMs(timestampMs);
    try {
      var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(new Date(ms));
      var out = { hour: '0', minute: '0' };
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === 'hour' || parts[i].type === 'minute') out[parts[i].type] = parts[i].value;
      }
      var hour = parseInt(out.hour, 10);
      var minute = parseInt(out.minute, 10);
      if (!Number.isFinite(hour) || !Number.isFinite(minute)) return NaN;
      if (hour === 24) hour = 0;
      return hour * 60 + minute;
    } catch(e) {
      return NaN;
    }
  }

  function _shouldRefreshMutableMidnight(series, sym, dateNy, timestampMs) {
    var nowMs = _resolveNowMs(timestampMs);
    if (getNyDateString(nowMs) !== dateNy) return false;
    var nyMinute = _getNyMinuteOfDay(nowMs);
    if (!Number.isFinite(nyMinute) || nyMinute > 125) return false;
    if (series._midnightDrawnDate !== dateNy || series._midnightDrawnSymbol !== sym) return true;
    var now = Date.now();
    var last = Number(series._midnightLiveRefreshAt || 0);
    return !Number.isFinite(last) || now - last > 60000;
  }

  function _clearLines(series) {
    var lines = series && series._midnightPriceLines;
    if (!series || !Array.isArray(lines)) {
      if (series) series._midnightPriceLines = [];
      return;
    }
    for (var i = 0; i < lines.length; i++) {
      try { series.removePriceLine(lines[i]); } catch(e) {}
    }
    series._midnightPriceLines = [];
  }

  function _addLineSeries(chart, opts) {
    if (!chart) return null;
    try {
      if (typeof chart.addSeries === 'function' && window.LightweightCharts && window.LightweightCharts.LineSeries) {
        return chart.addSeries(window.LightweightCharts.LineSeries, opts);
      }
      if (typeof chart.addLineSeries === 'function') {
        return chart.addLineSeries(opts);
      }
    } catch(e) {}
    return null;
  }

  function _clearOpenSegment(series) {
    if (!series) return;
    var chart = series._midnightChart;
    var seg = series._midnightOpenSegmentSeries;
    if (chart && seg && typeof chart.removeSeries === 'function') {
      try { chart.removeSeries(seg); } catch(e) {}
    }
    series._midnightOpenSegmentSeries = null;
    series._midnightOpenPrice = NaN;
    series._midnightOpenStartSec = NaN;
    series._midnightOpenEndSec = NaN;
  }

  function _resolveNowMs(timestampMs) {
    var marketNow = window.BtcMarketClock && typeof window.BtcMarketClock.now === 'function'
      ? Number(window.BtcMarketClock.now())
      : NaN;
    if (Number.isFinite(marketNow) && marketNow > 0) return marketNow;
    return _toMs(timestampMs);
  }

  function _refreshOpenSegment(series, timestampMs) {
    if (!series || !series._midnightOpenSegmentSeries) return;
    var startSec = Number(series._midnightOpenStartSec);
    var price = Number(series._midnightOpenPrice);
    if (!Number.isFinite(startSec) || !Number.isFinite(price)) return;

    var nowSec = Math.floor(_resolveNowMs(timestampMs) / 1000);
    var endSec = Math.max(startSec + 1, nowSec);
    if (series._midnightOpenEndSec === endSec) return;

    series._midnightOpenEndSec = endSec;
    try {
      series._midnightOpenSegmentSeries.setData([
        { time: startSec, value: price },
        { time: endSec, value: price },
      ]);
    } catch(e) {}
  }

  async function drawMidnightLines(series, symbol, timestampMs, force, chartApi) {
    if (!series || typeof series.createPriceLine !== 'function' || typeof series.removePriceLine !== 'function') return;
    if (chartApi) series._midnightChart = chartApi;

    var sym = (symbol || 'BTCUSDT').toUpperCase();
    var dateNy = getNyDateString(timestampMs);
    var liveRefresh = !force && _shouldRefreshMutableMidnight(series, sym, dateNy, timestampMs);

    if (!force && !liveRefresh && series._midnightDrawnDate === dateNy && series._midnightDrawnSymbol === sym) {
      _refreshOpenSegment(series, timestampMs);
      return;
    }

    series._midnightDrawSeq = (series._midnightDrawSeq || 0) + 1;
    var drawSeq = series._midnightDrawSeq;
    if (liveRefresh) series._midnightLiveRefreshAt = Date.now();

    var payload = await _fetchDay(sym, dateNy, !!force || liveRefresh);
    if (drawSeq !== series._midnightDrawSeq) return;

    _clearLines(series);
    _clearOpenSegment(series);

    var levels = payload && payload.levels ? payload.levels : null;
    var midnightOpen = levels ? Number(levels.midnight_open) : NaN;
    if (!Number.isFinite(midnightOpen)) {
      series._midnightDrawnDate = dateNy;
      series._midnightDrawnSymbol = sym;
      return;
    }

    var midnightStartMs = payload && payload.windows && payload.windows.midnight
      ? Number(payload.windows.midnight.start_utc)
      : NaN;
    if (Number.isFinite(midnightStartMs)) {
      var startSec = Math.floor(midnightStartMs / 1000);
      var chart = series._midnightChart;
      var segSeries = _addLineSeries(chart, {
        color: MIDNIGHT_COLOR,
        lineWidth: 2,
        lineStyle: 0,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
        title: 'Midnight Open',
        autoscaleInfoProvider: function () { return null; },
      });
      if (segSeries) {
        series._midnightOpenSegmentSeries = segSeries;
        series._midnightOpenPrice = midnightOpen;
        series._midnightOpenStartSec = startSec;
        series._midnightOpenEndSec = NaN;
        _refreshOpenSegment(series, timestampMs);
      }
    }

    series._midnightPriceLines = [];
    series._midnightDrawnDate = dateNy;
    series._midnightDrawnSymbol = sym;
  }

  window.BtcMidnight = {
    _cache: _cache,
    getNyDateString: getNyDateString,
    drawMidnightLines: drawMidnightLines,
    clearSeriesLines: function (series) {
      _clearLines(series);
      _clearOpenSegment(series);
    },
  };
})();
