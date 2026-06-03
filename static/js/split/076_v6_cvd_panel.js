// ---------- 076_v6_cvd_panel.js ----------
// CVD and delta panel renderer for Cockpit V6 orderflow.
// Redesigned: TradingView-style compact summary + delta histogram.

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};
  var Panels = V6OF.Panels = V6OF.Panels || {};

  function intervalOption(value, selected, label) {
    return '<option value="' + value + '"' + (Number(selected) === value ? ' selected' : '') + '>' + label + '</option>';
  }

  function sourceText(state) {
    if (!state) return 'Offline';
    if (state.source === 'mock') return 'Mock';
    if (state.dataFreshness === 'live') return 'Live';
    if (state.dataFreshness === 'rest-fallback') return 'REST Fallback';
    if (state.transportStatus === 'connecting') return 'Connecting';
    return 'Offline';
  }

  // Format signed value with +/-
  function fmtSigned(v) {
    if (v == null || !Number.isFinite(v)) return '—';
    var a = Math.abs(v);
    var s = a >= 1000 ? (a / 1000).toFixed(1) + 'K' : a.toFixed(a >= 100 ? 0 : 1);
    return (v >= 0 ? '+' : '') + s;
  }

  function fmtPrice(v) {
    if (v == null || !Number.isFinite(v)) return '—';
    return v.toFixed(2);
  }

  Panels.renderCvd = function (state) {
    state = state || {};
    var settings = state.settings || {};
    var selected = Number(settings.deltaIntervalMs || 60000);
    var bucketsByInterval = state.deltaBucketsByInterval || {};
    var latestByInterval = state.latestDeltaByInterval || {};
    var buckets = bucketsByInterval[String(selected)] || state.deltaBuckets || [];
    buckets = Array.isArray(buckets) ? buckets : [];
    var latest = latestByInterval[String(selected)] || buckets[buckets.length - 1] || null;
    var isLive = state.source === 'live';

    // Build a compact metric card
    function metric(label, value, cls) {
      return '<div class="v6-cvd-metric' + (cls ? ' ' + cls : '') + '">' +
        '<span class="v6-cvd-metric-lbl">' + label + '</span>' +
        '<span class="v6-cvd-metric-val">' + value + '</span>' +
        '</div>';
    }

    // Mini sparkline from recent delta buckets
    function sparkline(buckets) {
      if (!buckets || buckets.length < 2) return '';
      var recent = buckets.slice(-48);
      var maxAbs = 1;
      recent.forEach(function (b) { maxAbs = Math.max(maxAbs, Math.abs(b.delta)); });
      var barW = Math.max(2, Math.min(4, Math.floor(240 / recent.length)));
      var bars = recent.map(function (b) {
        var pct = Math.max(5, Math.min(100, Math.abs(b.delta) / maxAbs * 100));
        var cls = b.delta >= 0 ? 'is-up' : 'is-down';
        return '<span class="v6-cvd-spark-bar ' + cls + '" style="--h:' + pct.toFixed(1) + '%;--w:' + barW + 'px"></span>';
      }).join('');
      return '<div class="v6-cvd-spark">' + bars + '</div>';
    }

    if (!latest) {
      return [
        '<div class="v6-cvd-panel">',
          '<div class="v6-cvd-toolbar">',
            '<span class="v6-cvd-status">' + sourceText(state) + '</span>',
            '<label class="v6-cvd-interval">',
              '<select data-v6-setting="deltaIntervalMs">',
                intervalOption(1000, selected, '1s'),
                intervalOption(5000, selected, '5s'),
                intervalOption(60000, selected, '1m'),
              '</select>',
            '</label>',
          '</div>',
          '<div class="v6-cvd-empty">Waiting for data…</div>',
        '</div>',
      ].join('');
    }

    var deltaClass = latest.delta >= 0 ? 'is-pos' : 'is-neg';
    var cvdClass = latest.cvd >= 0 ? 'is-pos' : 'is-neg';

    return [
      '<div class="v6-cvd-panel">',
        // Toolbar
        '<div class="v6-cvd-toolbar">',
          '<span class="v6-cvd-status">' + sourceText(state) + '</span>',
          '<div class="v6-cvd-live">',
            '<span class="v6-cvd-badge ' + deltaClass + '">' + fmtSigned(latest.delta) + '</span>',
            '<label class="v6-cvd-interval">',
              '<select data-v6-setting="deltaIntervalMs">',
                intervalOption(1000, selected, '1s'),
                intervalOption(5000, selected, '5s'),
                intervalOption(60000, selected, '1m'),
              '</select>',
            '</label>',
          '</div>',
        '</div>',
        // Sparkline
        sparkline(buckets),
        // Compact metrics grid
        '<div class="v6-cvd-metrics">',
          metric('Buy Vol', fmtSigned(latest.buyVol)),
          metric('Sell Vol', fmtSigned(latest.sellVol)),
          metric('Delta', fmtSigned(latest.delta), deltaClass),
          metric('CVD', fmtSigned(latest.cvd), cvdClass),
        '</div>',
        // Delta bars
        '<div class="v6-cvd-bars">',
          (function () {
            var recent = buckets.slice(-36);
            var maxAbs = 1;
            recent.forEach(function (b) { maxAbs = Math.max(maxAbs, Math.abs(b.delta)); });
            return recent.map(function (bucket) {
              var pct = Math.max(6, Math.min(100, Math.abs(bucket.delta) / maxAbs * 100));
              var cls = bucket.delta >= 0 ? 'is-buy' : 'is-sell';
              return '<span class="v6-cvd-bar ' + cls + '" title="' +
                new Date(bucket.endTime || bucket.tsLocal).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
                ' ' + fmtSigned(bucket.delta) +
                '" style="--h:' + pct.toFixed(1) + '%"></span>';
            }).join('');
          })(),
        '</div>',
      '</div>',
    ].join('');
  };

  Panels.renderVwap = function (vwap, state) {
    state = state || {};
    if (!vwap) {
      return [
        '<div class="v6-cvd-panel">',
          '<div class="v6-cvd-empty">VWAP not available</div>',
        '</div>',
      ].join('');
    }
    var source = vwap.source || state.source || 'mock';
    var warm = !!vwap.isWarm;
    return [
      '<div class="v6-cvd-panel">',
        '<div class="v6-vwap-hero">',
          '<span class="v6-vwap-lbl">VWAP</span>',
          '<span class="v6-vwap-val">' + V6OF.format.price(vwap.value) + '</span>',
        '</div>',
        '<div class="v6-cvd-metrics">',
          '<div class="v6-cvd-metric"><span class="v6-cvd-metric-lbl">Symbol</span><span class="v6-cvd-metric-val">' + (vwap.symbol || '—') + '</span></div>',
          '<div class="v6-cvd-metric"><span class="v6-cvd-metric-lbl">Session</span><span class="v6-cvd-metric-val">' + new Date(vwap.sessionStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</span></div>',
          '<div class="v6-cvd-metric"><span class="v6-cvd-metric-lbl">Cum Vol</span><span class="v6-cvd-metric-val">' + V6OF.format.qty(vwap.cumVol) + '</span></div>',
          '<div class="v6-cvd-metric"><span class="v6-cvd-metric-lbl">Warm</span><span class="v6-cvd-metric-val' + (warm ? ' is-pos' : ' is-warn') + '">' + (warm ? 'Yes' : 'No') + '</span></div>',
        '</div>',
      '</div>',
    ].join('');
  };
})();
