// ---------- 087_v6_indicator_runtime.js ----------
// Live editable indicators for the V6 orderflow surface.
// Trusted local JS: source code is compiled in a short-lived Worker when possible.

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};
  var escapeHtml = V6OF.escapeHtml || function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  };

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  var TEMPLATES = {
    sma: {
      name: 'SMA Overlay',
      pane: 'overlay',
      code: [
        'return {',
        '  id: "sma_custom",',
        '  name: "SMA Custom",',
        '  pane: "overlay",',
        '  inputs: { period: 20, source: "close" },',
        '  compute({ candles, inputs, helpers }) {',
        '    return {',
        '      series: [{',
        '        type: "line",',
        '        name: "SMA",',
        '        color: "#2962ff",',
        '        width: 1.5,',
        '        points: helpers.sma(candles, inputs.period, inputs.source)',
        '      }]',
        '    };',
        '  }',
        '};'
      ].join('\n')
    },
    cvd: {
      name: 'CVD Pane',
      pane: 'separate',
      code: [
        'return {',
        '  id: "cvd_custom",',
        '  name: "CVD Custom",',
        '  pane: "separate",',
        '  inputs: {},',
        '  compute({ deltaBuckets }) {',
        '    const points = (deltaBuckets || []).map((b) => ({',
        '      time: b.t || b.ts || b.start || b.openTime,',
        '      value: Number(b.cvd || b.v || 0)',
        '    })).filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value));',
        '    return {',
        '      series: [{ type: "line", name: "CVD", color: "#131722", width: 1.25, points }]',
        '    };',
        '  }',
        '};'
      ].join('\n')
    },
    marketCypherSeed: {
      name: 'Market Cypher Seed',
      pane: 'separate',
      code: [
        'return {',
        '  id: "market_cypher_seed",',
        '  name: "Market Cypher Seed",',
        '  pane: "separate",',
        '  inputs: { fast: 9, slow: 21 },',
        '  compute({ candles, inputs, helpers }) {',
        '    const fast = helpers.ema(candles, inputs.fast, "close");',
        '    const slow = helpers.ema(candles, inputs.slow, "close");',
        '    const byTime = new Map(slow.map((p) => [p.time, p.value]));',
        '    const wave = fast.map((p) => ({ time: p.time, value: p.value - (byTime.get(p.time) || p.value) }));',
        '    return {',
        '      series: [',
        '        { type: "histogram", name: "Wave", color: "#2962ff", points: wave },',
        '        { type: "line", name: "Zero", color: "#868993", width: 1, points: wave.map((p) => ({ time: p.time, value: 0 })) }',
        '      ]',
        '    };',
        '  }',
        '};'
      ].join('\n')
    }
  };

  function candleTime(c) {
    return Number(c && (c.openTime || c.time || c.t || c.ts || c.closeTime || 0));
  }

  function sourceValue(c, source) {
    var key = source || 'close';
    return Number(c && c[key]);
  }

  function workerScript() {
    return [
      'function val(c, source) { return Number(c && c[source || "close"]); }',
      'function ts(c) { return Number(c && (c.openTime || c.time || c.t || c.ts || c.closeTime || 0)); }',
      'var helpers = {',
      '  sma: function(candles, period, source) {',
      '    period = Math.max(1, Number(period) || 20); source = source || "close";',
      '    var out = [], sum = 0, q = [];',
      '    for (var i = 0; i < (candles || []).length; i++) {',
      '      var v = val(candles[i], source);',
      '      if (!Number.isFinite(v)) continue;',
      '      q.push(v); sum += v;',
      '      if (q.length > period) sum -= q.shift();',
      '      if (q.length >= period) out.push({ time: ts(candles[i]), value: sum / q.length });',
      '    }',
      '    return out;',
      '  },',
      '  ema: function(candles, period, source) {',
      '    period = Math.max(1, Number(period) || 20); source = source || "close";',
      '    var out = [], prev = null, k = 2 / (period + 1);',
      '    for (var i = 0; i < (candles || []).length; i++) {',
      '      var v = val(candles[i], source);',
      '      if (!Number.isFinite(v)) continue;',
      '      prev = prev == null ? v : prev + k * (v - prev);',
      '      out.push({ time: ts(candles[i]), value: prev });',
      '    }',
      '    return out;',
      '  },',
      '  highest: function(points, len) {',
      '    len = Math.max(1, Number(len) || 20);',
      '    return (points || []).map(function(p, i, arr) {',
      '      var m = -Infinity;',
      '      for (var j = Math.max(0, i - len + 1); j <= i; j++) m = Math.max(m, Number(arr[j].value));',
      '      return { time: p.time, value: m };',
      '    });',
      '  },',
      '  lowest: function(points, len) {',
      '    len = Math.max(1, Number(len) || 20);',
      '    return (points || []).map(function(p, i, arr) {',
      '      var m = Infinity;',
      '      for (var j = Math.max(0, i - len + 1); j <= i; j++) m = Math.min(m, Number(arr[j].value));',
      '      return { time: p.time, value: m };',
      '    });',
      '  }',
      '};',
      'self.onmessage = function(event) {',
      '  var msg = event.data || {};',
      '  try {',
      '    var def = (new Function(String(msg.code || "")))();',
      '    if (!def || typeof def.compute !== "function") throw new Error("Indicator must return a compute() function");',
      '    var inputs = Object.assign({}, def.inputs || {}, msg.inputs || {});',
      '    var result = def.compute({ candles: msg.candles || [], trades: msg.trades || [], deltaBuckets: msg.deltaBuckets || [], inputs: inputs, helpers: helpers });',
      '    self.postMessage({ ok: true, meta: { id: def.id || msg.sourceId, name: def.name || msg.sourceName || msg.sourceId, pane: def.pane === "separate" ? "separate" : "overlay", inputs: inputs }, result: result || {} });',
      '  } catch (err) {',
      '    self.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });',
      '  }',
      '};'
    ].join('\n');
  }

  function normalizeCandles(state) {
    var arr = (state && (state.chartCandles || state.candles)) || [];
    return arr.map(function (c) {
      return {
        time: candleTime(c),
        openTime: candleTime(c),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume || c.vol || c.qty || 0)
      };
    }).filter(function (c) {
      return Number.isFinite(c.time) && Number.isFinite(c.close);
    });
  }

  function stateKey(state, source, inst) {
    var candles = (state && (state.chartCandles || state.candles)) || [];
    var last = candles.length ? candleTime(candles[candles.length - 1]) : 0;
    var deltas = (state && state.deltaBuckets) || [];
    var lastDelta = deltas.length ? Number(deltas[deltas.length - 1].t || deltas[deltas.length - 1].ts || 0) : 0;
    return [
      inst.instanceId,
      source.updatedAt || 0,
      state && state.symbol,
      state && state.timeframe,
      candles.length,
      last,
      deltas.length,
      lastDelta,
      JSON.stringify(inst.inputs || {})
    ].join('|');
  }

  function findSource(settings, sourceId) {
    var sources = (settings && settings.indicatorSources) || [];
    for (var i = 0; i < sources.length; i++) {
      if (sources[i].sourceId === sourceId) return sources[i];
    }
    return null;
  }

  function linePoints(series) {
    var points = (series && series.points) || [];
    return points.map(function (p) {
      return {
        time: Number(p.time || p.t || p.ts || p.openTime),
        value: Number(p.value != null ? p.value : p.v)
      };
    }).filter(function (p) {
      return Number.isFinite(p.time) && Number.isFinite(p.value);
    });
  }

  function visiblePoints(points, timeStart, timeEnd) {
    var out = [];
    for (var i = 0; i < points.length; i++) {
      if (points[i].time >= timeStart && points[i].time <= timeEnd) out.push(points[i]);
    }
    return out;
  }

  function drawLine(ctx, points, tx, ty, color, width, dash) {
    if (!points || points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color || '#2962ff';
    ctx.lineWidth = Number(width) || 1.25;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    points.forEach(function (p, i) {
      var x = tx(p.time), y = ty(p.value);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  }

  function drawHistogram(ctx, points, tx, ty, zeroY, color) {
    if (!points || !points.length) return;
    ctx.save();
    points.forEach(function (p) {
      var x = tx(p.time);
      var y = ty(p.value);
      ctx.fillStyle = p.value >= 0 ? (color || '#089981') : '#f23645';
      ctx.fillRect(x - 2, Math.min(y, zeroY), 4, Math.max(1, Math.abs(zeroY - y)));
    });
    ctx.restore();
  }

  function seriesArray(result) {
    if (!result) return [];
    if (Array.isArray(result.series)) return result.series;
    if (Array.isArray(result)) return result;
    return [];
  }

  var Runtime = {
    _results: {},
    _status: {},
    _inflight: {},
    templates: TEMPLATES,
    addTemplate: function (templateId) {
      var t = TEMPLATES[templateId] || TEMPLATES.sma;
      if (!V6OF.store || !V6OF.store.updateSettings) return;
      var state = V6OF.store.getState ? V6OF.store.getState() : {};
      var settings = state.settings || {};
      var sourceId = uid('src');
      var instanceId = uid('ind');
      var sources = (settings.indicatorSources || []).slice();
      var indicators = (settings.indicators || []).slice();
      sources.push({ sourceId: sourceId, name: t.name, code: t.code, updatedAt: Date.now() });
      indicators.push({ instanceId: instanceId, sourceId: sourceId, name: t.name, pane: t.pane, visible: true, inputs: {}, style: {}, height: 112 });
      V6OF.store.updateSettings({ indicatorSources: sources, indicators: indicators, activeTab: 'indicators' });
      if (V6OF.store.updateUi) V6OF.store.updateUi({ activeIndicatorId: instanceId, indicatorEditorOpen: true });
    },
    evaluateAll: function (state, done) {
      var settings = (state && state.settings) || {};
      var indicators = settings.indicators || [];
      for (var i = 0; i < indicators.length; i++) {
        if (indicators[i].visible !== false) this.evaluateInstance(state, indicators[i], done);
      }
    },
    evaluateInstance: function (state, inst, done) {
      if (!inst || inst.instanceId === 'cvd' || inst.visible === false) return;
      var settings = (state && state.settings) || {};
      var source = findSource(settings, inst.sourceId);
      if (!source || !source.code) return;
      var key = stateKey(state, source, inst);
      if (this._results[inst.instanceId] && this._results[inst.instanceId].key === key) return;
      if (this._inflight[inst.instanceId] === key) return;
      this._inflight[inst.instanceId] = key;
      this._status[inst.instanceId] = { state: 'running', message: 'Running...', updatedAt: Date.now() };

      var self = this;
      var payload = {
        sourceId: source.sourceId,
        sourceName: source.name,
        code: source.code,
        inputs: inst.inputs || {},
        candles: normalizeCandles(state),
        trades: ((state && state.trades) || []).slice(0, 5000),
        deltaBuckets: ((state && state.deltaBuckets) || []).slice(-5000)
      };

      function finish(ok, data) {
        if (self._inflight[inst.instanceId] !== key) return;
        delete self._inflight[inst.instanceId];
        if (ok) {
          self._results[inst.instanceId] = { key: key, meta: data.meta || {}, result: data.result || {}, updatedAt: Date.now() };
          self._status[inst.instanceId] = { state: 'ok', message: 'Ready', updatedAt: Date.now() };
          if (data.meta && V6OF.store && V6OF.store.getState && V6OF.store.updateSettings) {
            var cur = V6OF.store.getState();
            var curSettings = cur.settings || {};
            var nextIndicators = (curSettings.indicators || []).map(function (item) {
              if (item.instanceId !== inst.instanceId) return item;
              return Object.assign({}, item, {
                name: data.meta.name || item.name,
                pane: data.meta.pane || item.pane,
                inputs: Object.assign({}, data.meta.inputs || item.inputs || {})
              });
            });
            V6OF.store.updateSettings({ indicators: nextIndicators });
          }
        } else {
          self._status[inst.instanceId] = { state: 'error', message: data.error || 'Runtime error', updatedAt: Date.now() };
        }
        if (typeof done === 'function') done();
      }

      if (window.Worker && window.Blob && window.URL) {
        var blob = new Blob([workerScript()], { type: 'text/javascript' });
        var url = URL.createObjectURL(blob);
        var worker = new Worker(url);
        var timer = setTimeout(function () {
          worker.terminate();
          URL.revokeObjectURL(url);
          finish(false, { error: 'Indicator timeout' });
        }, 800);
        worker.onmessage = function (event) {
          clearTimeout(timer);
          worker.terminate();
          URL.revokeObjectURL(url);
          var msg = event.data || {};
          finish(!!msg.ok, msg);
        };
        worker.onerror = function (event) {
          clearTimeout(timer);
          worker.terminate();
          URL.revokeObjectURL(url);
          finish(false, { error: event.message || 'Worker error' });
        };
        worker.postMessage(payload);
      } else {
        finish(false, { error: 'Worker API unavailable' });
      }
    },
    status: function (instanceId) {
      return this._status[instanceId] || { state: 'idle', message: 'Idle' };
    },
    result: function (instanceId) {
      return this._results[instanceId] || null;
    },
    drawOverlay: function (ctx, vp, plot, state) {
      var settings = (state && state.settings) || {};
      var indicators = settings.indicators || [];
      for (var i = 0; i < indicators.length; i++) {
        var inst = indicators[i];
        if (!inst || inst.visible === false || inst.pane === 'separate') continue;
        var cached = this.result(inst.instanceId);
        var series = cached && seriesArray(cached.result);
        if (!series || !series.length) continue;
        for (var s = 0; s < series.length; s++) {
          var pts = visiblePoints(linePoints(series[s]), vp.timeStart, vp.timeEnd);
          if (series[s].type === 'histogram') drawHistogram(ctx, pts, vp.timeToX.bind(vp), vp.priceToY.bind(vp), vp.priceToY(0), series[s].color);
          else drawLine(ctx, pts, vp.timeToX.bind(vp), vp.priceToY.bind(vp), series[s].color, series[s].width, series[s].dash);
        }
      }
    },
    drawPane: function (canvas, inst, state) {
      if (!canvas || !inst) return;
      var rect = canvas.getBoundingClientRect();
      var w = Math.max(1, rect.width || canvas.clientWidth || 1);
      var h = Math.max(1, rect.height || canvas.clientHeight || inst.height || 112);
      var dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }
      var ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#e0e3eb';
      ctx.beginPath();
      ctx.moveTo(0, 0.5);
      ctx.lineTo(w, 0.5);
      ctx.stroke();

      var cached = this.result(inst.instanceId);
      var series = cached && seriesArray(cached.result);
      if (!series || !series.length) {
        var st = this.status(inst.instanceId);
        ctx.fillStyle = st.state === 'error' ? '#f23645' : '#868993';
        ctx.font = '12px Inter, system-ui, sans-serif';
        ctx.fillText(st.message || 'No data', 12, 44);
        return;
      }

      var chart = V6OF.chart || {};
      var winStart = chart.timeStart || 0;
      var winEnd = chart.timeEnd || 0;
      var all = [];
      series.forEach(function (ser) {
        all = all.concat(visiblePoints(linePoints(ser), winStart, winEnd));
      });
      if (!all.length) {
        series.forEach(function (ser) { all = all.concat(linePoints(ser).slice(-200)); });
      }
      var min = Infinity, max = -Infinity;
      all.forEach(function (p) { min = Math.min(min, p.value); max = Math.max(max, p.value); });
      if (!Number.isFinite(min) || !Number.isFinite(max)) { min = -1; max = 1; }
      if (min === max) { min -= 1; max += 1; }
      var pad = (max - min) * 0.12;
      min -= pad; max += pad;
      if (!winStart || !winEnd || winEnd <= winStart) {
        winStart = all.length ? all[0].time : Date.now() - 3600000;
        winEnd = all.length ? all[all.length - 1].time : Date.now();
        if (winEnd <= winStart) winEnd = winStart + 1;
      }
      var left = 8, right = 72, top = 18, bottom = 18;
      var pw = Math.max(1, w - left - right);
      var ph = Math.max(1, h - top - bottom);
      var tx = function (t) { return left + (t - winStart) / (winEnd - winStart) * pw; };
      var ty = function (v) { return top + (max - v) / (max - min) * ph; };
      ctx.strokeStyle = '#f0f3fa';
      for (var g = 1; g <= 2; g++) {
        var gy = top + ph * g / 3;
        ctx.beginPath(); ctx.moveTo(left, gy); ctx.lineTo(left + pw, gy); ctx.stroke();
      }
      var zeroY = ty(0);
      if (min < 0 && max > 0) {
        ctx.strokeStyle = '#d1d4dc';
        ctx.setLineDash([4, 5]);
        ctx.beginPath(); ctx.moveTo(left, zeroY); ctx.lineTo(left + pw, zeroY); ctx.stroke();
        ctx.setLineDash([]);
      }
      series.forEach(function (ser) {
        var pts = visiblePoints(linePoints(ser), winStart, winEnd);
        if (ser.type === 'histogram') drawHistogram(ctx, pts, tx, ty, zeroY, ser.color);
        else drawLine(ctx, pts, tx, ty, ser.color, ser.width, ser.dash);
      });
      ctx.fillStyle = '#868993';
      ctx.font = '11px Inter, system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(max.toFixed(Math.abs(max) >= 10 ? 0 : 2), w - 8, top + 4);
      ctx.fillText(min.toFixed(Math.abs(min) >= 10 ? 0 : 2), w - 8, top + ph);
      ctx.textAlign = 'left';
    }
  };

  var baseDrawAll = V6OF.Indicators && V6OF.Indicators.drawAll;
  if (V6OF.Indicators && typeof baseDrawAll === 'function' && !V6OF.Indicators._v6RuntimeWrapped) {
    V6OF.Indicators._v6RuntimeWrapped = true;
    V6OF.Indicators.drawAll = function (ctx, vp, plot, state, baseCandles) {
      baseDrawAll.call(V6OF.Indicators, ctx, vp, plot, state, baseCandles);
      Runtime.drawOverlay(ctx, vp, plot, state);
    };
  }

  function activeIndicator(state) {
    var settings = (state && state.settings) || {};
    var ui = (state && state.ui) || {};
    var indicators = settings.indicators || [];
    if (ui.activeIndicatorId) {
      for (var i = 0; i < indicators.length; i++) {
        if (indicators[i].instanceId === ui.activeIndicatorId) return indicators[i];
      }
    }
    return indicators[0] || null;
  }

  function renderToolbar(instanceId) {
    return [
      '<div class="v6-indicator-toolbar is-open" data-v6-pane-toolbar data-instance-id="' + escapeHtml(instanceId) + '">',
        '<button type="button" class="v6-indicator-action" data-v6-pane-action="toggle" title="Hide" aria-label="Hide"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.5"/></svg></button>',
        '<button type="button" class="v6-indicator-action" data-v6-pane-action="settings" title="Settings" aria-label="Settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l7 4v8l-7 4-7-4V7z"/><circle cx="12" cy="12" r="2.8"/></svg></button>',
        '<button type="button" class="v6-indicator-action" data-v6-pane-action="source" title="Source" aria-label="Source"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 4c-2 1-2 3-2 5 0 2-2 3-2 3s2 1 2 3c0 2 0 4 2 5"/><path d="M16 4c2 1 2 3 2 5 0 2 2 3 2 3s-2 1-2 3c0 2 0 4-2 5"/></svg></button>',
        '<button type="button" class="v6-indicator-action" data-v6-pane-action="remove" title="Remove" aria-label="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6.5 7l1 16h9l1-16"/></svg></button>',
        '<button type="button" class="v6-indicator-action" data-v6-pane-action="source" title="More" aria-label="More"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18" cy="12" r="1.8"/></svg></button>',
      '</div>'
    ].join('');
  }

  function panelHtml(state) {
    var settings = (state && state.settings) || {};
    var indicators = settings.indicators || [];
    var sources = settings.indicatorSources || [];
    var active = activeIndicator(state);
    var activeSource = active ? findSource(settings, active.sourceId) : null;
    var code = activeSource ? activeSource.code : '';
    var status = active ? Runtime.status(active.instanceId) : { state: 'idle', message: 'Add an indicator' };

    var rows = indicators.map(function (inst) {
      var cls = active && active.instanceId === inst.instanceId ? ' is-active' : '';
      var st = Runtime.status(inst.instanceId);
      return [
        '<button type="button" class="v6-ind-row' + cls + '" data-v6-ind-action="select" data-instance-id="' + escapeHtml(inst.instanceId) + '">',
          '<span><strong>' + escapeHtml(inst.name || inst.sourceId) + '</strong><em>' + escapeHtml(inst.pane || 'overlay') + ' / ' + escapeHtml(st.state || 'idle') + '</em></span>',
          '<i>' + (inst.visible === false ? 'hidden' : 'on') + '</i>',
        '</button>'
      ].join('');
    }).join('');

    return [
      '<div class="v6-ind-panel">',
        '<div class="v6-ind-library" aria-label="Indicator templates">',
          '<button type="button" class="v6-btn v6-btn-sm" data-v6-ind-action="add-template" data-template="sma">SMA</button>',
          '<button type="button" class="v6-btn v6-btn-sm" data-v6-ind-action="add-template" data-template="cvd">CVD Pane</button>',
          '<button type="button" class="v6-btn v6-btn-sm" data-v6-ind-action="add-template" data-template="marketCypherSeed">Market Seed</button>',
        '</div>',
        '<div class="v6-ind-list">' + (rows || '<div class="v6-ind-empty">No custom indicators yet.</div>') + '</div>',
        '<div class="v6-ind-editor ' + (!active ? 'is-disabled' : '') + '">',
          '<div class="v6-ind-editor-head">',
            '<span>' + escapeHtml(active ? (active.name || 'Indicator') : 'Source') + '</span>',
            '<em class="is-' + escapeHtml(status.state || 'idle') + '">' + escapeHtml(status.message || '') + '</em>',
          '</div>',
          '<textarea spellcheck="false" data-v6-ind-code ' + (!active ? 'disabled' : '') + '>' + escapeHtml(code) + '</textarea>',
          '<div class="v6-ind-actions">',
            '<button type="button" class="v6-btn v6-btn-sm" data-v6-ind-action="apply" ' + (!active ? 'disabled' : '') + '>Apply</button>',
            '<button type="button" class="v6-btn v6-btn-sm" data-v6-ind-action="duplicate" ' + (!active ? 'disabled' : '') + '>Duplicate</button>',
            '<button type="button" class="v6-btn v6-btn-sm" data-v6-ind-action="toggle" ' + (!active ? 'disabled' : '') + '>' + (active && active.visible === false ? 'Show' : 'Hide') + '</button>',
            '<button type="button" class="v6-btn v6-btn-sm v6-btn-danger" data-v6-ind-action="remove" ' + (!active ? 'disabled' : '') + '>Remove</button>',
          '</div>',
        '</div>',
      '</div>'
    ].join('');
  }

  function switchDockToIndicators(root) {
    var rbody = root && root.querySelector('[data-v6-rbody]');
    if (rbody) rbody.className = 'v6-rbody show-indicators';
    Array.prototype.forEach.call(root.querySelectorAll('[data-v6-rtab]'), function (tab) {
      var active = tab.getAttribute('data-v6-rtab') === 'indicators';
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    root.classList.remove('v6-dock-collapsed');
  }

  var Panel = {
    renderInto: function (root, state) {
      var body = root && root.querySelector('[data-v6-indicators-panel]');
      if (!body) return;
      var settings = (state && state.settings) || {};
      var ui = (state && state.ui) || {};
      var active = activeIndicator(state);
      var activeSource = active ? findSource(settings, active.sourceId) : null;
      var key = JSON.stringify({
        count: (settings.indicators || []).length,
        sources: (settings.indicatorSources || []).map(function (s) { return s.sourceId + ':' + s.updatedAt; }).join(','),
        active: active ? active.instanceId : '',
        source: activeSource ? activeSource.updatedAt : 0,
        visible: (settings.indicators || []).map(function (i) { return i.instanceId + ':' + i.visible + ':' + i.pane; }).join(','),
        editor: ui.indicatorEditorOpen
      });
      var codeFocused = document.activeElement && document.activeElement.matches && document.activeElement.matches('[data-v6-ind-code]');
      if (body._v6IndKey !== key && !codeFocused) {
        body._v6IndKey = key;
        body.innerHTML = panelHtml(state);
      }
      this.bind(root);
      Runtime.evaluateAll(state, function () {
        var canvas = root.querySelector('[data-v6-chart]');
        if (canvas && V6OF.CanvasChart && V6OF.store) V6OF.CanvasChart.draw(canvas, V6OF.store.getState());
        Panel.renderPanes(root, V6OF.store ? V6OF.store.getState() : state);
        var panel = root.querySelector('[data-v6-indicators-panel]');
        if (panel) {
          panel._v6IndKey = '';
          Panel.renderInto(root, V6OF.store ? V6OF.store.getState() : state);
        }
      });
    },
    renderPanes: function (root, state) {
      var host = root && root.querySelector('[data-v6-indicator-panes]');
      if (!host) return;
      var settings = (state && state.settings) || {};
      var indicators = (settings.indicators || []).filter(function (inst) {
        return inst && inst.visible !== false && inst.pane === 'separate';
      });
      host.classList.toggle('is-empty', indicators.length === 0);
      var key = indicators.map(function (inst) {
        return inst.instanceId + ':' + inst.name + ':' + inst.height + ':' + inst.visible;
      }).join('|');
      if (host._v6PaneKey !== key) {
        host._v6PaneKey = key;
        host.innerHTML = indicators.map(function (inst) {
          var h = Math.max(56, Math.min(280, Number(inst.height || 112)));
          return [
            '<div class="v6-custom-indicator-pane" data-v6-ind-pane="' + escapeHtml(inst.instanceId) + '" style="height:' + h + 'px">',
              '<div class="v6-custom-indicator-head">',
                '<span class="v6-indicator-name">' + escapeHtml(inst.name || 'Indicator') + '</span>',
                renderToolbar(inst.instanceId),
              '</div>',
              '<canvas class="v6-custom-indicator-canvas" data-v6-ind-canvas="' + escapeHtml(inst.instanceId) + '"></canvas>',
            '</div>'
          ].join('');
        }).join('');
      }
      Runtime.evaluateAll(state, function () {
        Panel.renderPanes(root, V6OF.store ? V6OF.store.getState() : state);
      });
      indicators.forEach(function (inst) {
        var canvas = host.querySelector('[data-v6-ind-canvas="' + inst.instanceId + '"]');
        Runtime.drawPane(canvas, inst, state);
      });
      this.bind(root);
    },
    bind: function (root) {
      if (!root || root._v6IndicatorPanelBound) return;
      root._v6IndicatorPanelBound = true;
      root.addEventListener('click', function (event) {
        var actionEl = event.target.closest('[data-v6-ind-action], [data-v6-pane-action]');
        if (!actionEl || !root.contains(actionEl)) return;
        var store = V6OF.store;
        if (!store || !store.getState || !store.updateSettings) return;
        var state = store.getState();
        var settings = state.settings || {};
        var indicators = (settings.indicators || []).slice();
        var sources = (settings.indicatorSources || []).slice();
        var action = actionEl.getAttribute('data-v6-ind-action') || actionEl.getAttribute('data-v6-pane-action');
        var instanceId = actionEl.getAttribute('data-instance-id') ||
          (actionEl.closest('[data-v6-pane-toolbar]') && actionEl.closest('[data-v6-pane-toolbar]').getAttribute('data-instance-id')) ||
          (activeIndicator(state) && activeIndicator(state).instanceId);

        if (action === 'add-template') {
          Runtime.addTemplate(actionEl.getAttribute('data-template'));
          switchDockToIndicators(root);
          return;
        }
        if (!instanceId) return;
        var inst = indicators.filter(function (item) { return item.instanceId === instanceId; })[0];
        if (action === 'select' || action === 'settings' || action === 'source') {
          if (store.updateUi) store.updateUi({ activeIndicatorId: instanceId, indicatorEditorOpen: true });
          if (action === 'source') switchDockToIndicators(root);
          return;
        }
        if (action === 'toggle') {
          indicators = indicators.map(function (item) {
            return item.instanceId === instanceId ? Object.assign({}, item, { visible: item.visible === false }) : item;
          });
          store.updateSettings({ indicators: indicators });
          return;
        }
        if (action === 'remove') {
          indicators = indicators.filter(function (item) { return item.instanceId !== instanceId; });
          store.updateSettings({ indicators: indicators });
          if (store.updateUi) store.updateUi({ activeIndicatorId: indicators[0] ? indicators[0].instanceId : '' });
          return;
        }
        if (action === 'duplicate' && inst) {
          var src = findSource(settings, inst.sourceId);
          if (!src) return;
          var newSourceId = uid('src');
          var newInstanceId = uid('ind');
          sources.push({ sourceId: newSourceId, name: src.name + ' Copy', code: src.code, updatedAt: Date.now() });
          indicators.push(Object.assign({}, inst, { instanceId: newInstanceId, sourceId: newSourceId, name: inst.name + ' Copy' }));
          store.updateSettings({ indicatorSources: sources, indicators: indicators });
          if (store.updateUi) store.updateUi({ activeIndicatorId: newInstanceId, indicatorEditorOpen: true });
          return;
        }
        if (action === 'apply' && inst) {
          var textarea = root.querySelector('[data-v6-ind-code]');
          var code = textarea ? textarea.value : '';
          sources = sources.map(function (src) {
            return src.sourceId === inst.sourceId ? Object.assign({}, src, { code: code, updatedAt: Date.now() }) : src;
          });
          store.updateSettings({ indicatorSources: sources });
          Runtime.evaluateInstance(store.getState(), inst, function () {
            var canvas = root.querySelector('[data-v6-chart]');
            if (canvas && V6OF.CanvasChart && V6OF.store) V6OF.CanvasChart.draw(canvas, V6OF.store.getState());
            Panel.renderPanes(root, V6OF.store ? V6OF.store.getState() : state);
            Panel.renderInto(root, V6OF.store ? V6OF.store.getState() : state);
          });
        }
      });
    }
  };

  V6OF.IndicatorRuntime = Runtime;
  V6OF.IndicatorPanel = Panel;
})();
