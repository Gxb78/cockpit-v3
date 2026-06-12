// ---------- 079_v6_orderflow_settings.js ----------
// Orderflow settings: localStorage persistence for V6 UI preferences (key: cockpitV6.orderflow.settings).
// Local key: cockpitV6.orderflow.settings. Backend key: v6_orderflow_settings.

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
  var STORAGE_KEY = 'cockpitV6.orderflow.settings';
  var SERVER_KEY = 'v6_orderflow_settings';
  var SETTINGS_SCHEMA_VERSION = 1;
  var _settingsSyncTimer = null;

  // TradingView-style ladder default: VOL | SELL | BUY | BID | PRICE | ASK | DELTA,
  // with heatmap-intensity backgrounds on vol/sell/buy/delta. Older builds
  // shipped narrower defaults (two-sided ladder, 6/9-column "full" set);
  // LEGACY_DEFAULT_DOM_COLUMN_SETS below lets us recognize a persisted value
  // that is just one of those old baked-in defaults (never customized by the
  // user) and migrate it forward.
  var DEFAULT_DOM_COLUMNS = ['vol', 'sell', 'buy', 'bid', 'price', 'ask', 'delta'];
  var LEGACY_DEFAULT_DOM_COLUMN_SETS = [
    ['bid', 'price', 'ask', 'buy', 'sell', 'delta', 'imb', 'stack', 'abs'],
    ['bid', 'price', 'ask', 'buy', 'sell', 'delta'],
    ['bid', 'price', 'ask']
  ];
  var VALID_DOM_KEYS = { vol: 1, sell: 1, buy: 1, bid: 1, price: 1, ask: 1, delta: 1, imb: 1, stack: 1, abs: 1 };

  function isLegacyDefaultDomColumns(cols) {
    if (!Array.isArray(cols)) return false;
    return LEGACY_DEFAULT_DOM_COLUMN_SETS.some(function (legacy) {
      if (legacy.length !== cols.length) return false;
      for (var i = 0; i < legacy.length; i++) {
        if (legacy[i] !== cols[i]) return false;
      }
      return true;
    });
  }

  var DEFAULTS = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    chartMode: 'both',
    showTape: true,
    showDOM: true,
    showCVD: true,
    showVwap: false,
    showOhlc: true,
    showCandles: true,
    ohlcBodyStyle: 'candles',
    ohlcLineWidth: 1,
    ohlcBodyWidth: 0.72,
    showBubbles: false,
    showHeatmap: false,
    showFootprint: false,
    maxTrades: 100000,
    heatmapMaxFrames: 100000,
    footprintMaxCandles: 100000,
    footprintHistoryLookbackMinutes: 10080,
    domDepth: 5000,
    domRangeLevels: 1000,
    domMinNotionalUsd: 100,
    domFollowThresholdTicks: 1,
    domScaleMode: 'book',
    domValueMode: 'coin',
    domGroup: 1,
    domColumns: DEFAULT_DOM_COLUMNS.slice(),
    domColumnWidths: {},
    domSoftWallPercentile: 0.85,
    domMajorWallPercentile: 0.95,
    minQty: 0,
    maxRows: 5000,
    restTradePrefillLimit: 100000,
    tapeFontSize: 10,
    deltaIntervalMs: 60000,
    tickSize: 1,
    showLastPrice: true,
    showGrid: true,
    showSessionZones: true,
    sessionProfile: 'global',
    bgColor: '#131722',
    upColor: '#089981',
    downColor: '#f23645',
    theme: 'dark-tv',
    indicators: [],
    indicatorSources: [],
    chartIndicators: ['ohlc'],
    hiddenChartIndicators: [],
    activeTab: 'dom',
    dockCollapsed: false,
    cvdCollapsed: false,
    inspectorTimeZoneMode: 'utc',
    showFootprintVA: true,
    showVwapBands: false,
    vwapBand1: 1.0,
    vwapBand2: 2.0,
    alertsEnabled: false,
    largeTradeAlertQty: 10,
    deltaAlertThreshold: 100,
    imbalanceRatio: 3.0,
    imbalanceStack: 3,
    imbalanceMinVolume: 1.0,
    exhaustionFactor: 0.35,
    footprintValueAreaPct: 70,
    minWickTicks: 0,
    markers: [],
    showVolumeProfile: false,
    volumeProfileType: 'visible',
    volumeProfileSide: 'right',
    volumeProfileStyle: 'volume',
    volumeProfileValueArea: 70,
    volumeProfileFixedStart: 0,
    volumeProfileFixedEnd: 0,
    volumeProfileShowPocTrail: false
  };

  var VALID_CHART_MODES = { heatmap: 1, footprint: 1, both: 1, none: 1 };
  var VALID_SESSION_PROFILES = { global: 1, rth: 1, eth: 1 };
  // DOM bid/ask value display modes. 'usd' is the legacy alias of 'notional'.
  var VALID_VALUE_MODES = { coin: 1, notional: 1, contracts: 1, ticks: 1 };
  var VALID_THEMES = { 'light-tv': 1, 'dark-tv': 1 };

  function clampInt(value, min, max, fallback) {
    var n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  function validateSettings(raw) {
    if (!raw || typeof raw !== 'object') return Object.assign({}, DEFAULTS);
    var out = {};
    out.schemaVersion = SETTINGS_SCHEMA_VERSION;
    out.chartMode = VALID_CHART_MODES[raw.chartMode] ? raw.chartMode : DEFAULTS.chartMode;
    out.showTape = typeof raw.showTape === 'boolean' ? raw.showTape : DEFAULTS.showTape;
    out.showDOM = typeof raw.showDOM === 'boolean' ? raw.showDOM : DEFAULTS.showDOM;
    out.showCVD = typeof raw.showCVD === 'boolean' ? raw.showCVD : DEFAULTS.showCVD;
    out.showVwap = typeof raw.showVwap === 'boolean' ? raw.showVwap : DEFAULTS.showVwap;
    out.showOhlc = typeof raw.showOhlc === 'boolean' ? raw.showOhlc
      : (typeof raw.showCandles === 'boolean' ? raw.showCandles : DEFAULTS.showOhlc);
    out.showCandles = typeof raw.showCandles === 'boolean' ? raw.showCandles : DEFAULTS.showCandles;
    out.ohlcBodyStyle = raw.ohlcBodyStyle === 'bars' || raw.ohlcBodyStyle === 'hollow' ? raw.ohlcBodyStyle : DEFAULTS.ohlcBodyStyle;
    out.ohlcLineWidth = Math.max(1, Math.min(4, Number(raw.ohlcLineWidth) || DEFAULTS.ohlcLineWidth));
    out.ohlcBodyWidth = Math.max(0.2, Math.min(1, Number(raw.ohlcBodyWidth) || DEFAULTS.ohlcBodyWidth));
    out.showBubbles = typeof raw.showBubbles === 'boolean' ? raw.showBubbles : DEFAULTS.showBubbles;
    out.showHeatmap = typeof raw.showHeatmap === 'boolean' ? raw.showHeatmap : DEFAULTS.showHeatmap;
    out.showFootprint = typeof raw.showFootprint === 'boolean' ? raw.showFootprint : DEFAULTS.showFootprint;
    out.showLastPrice = typeof raw.showLastPrice === 'boolean' ? raw.showLastPrice : DEFAULTS.showLastPrice;
    out.showGrid = typeof raw.showGrid === 'boolean' ? raw.showGrid : DEFAULTS.showGrid;
    out.showSessionZones = typeof raw.showSessionZones === 'boolean' ? raw.showSessionZones : DEFAULTS.showSessionZones;
    out.sessionProfile = VALID_SESSION_PROFILES[raw.sessionProfile] ? raw.sessionProfile : DEFAULTS.sessionProfile;
    out.theme = 'dark-tv'; // Always enforce dark theme for all orderflow components
    out.bgColor = typeof raw.bgColor === 'string' ? raw.bgColor : DEFAULTS.bgColor;
    if (out.bgColor === '#ffffff' || out.bgColor === '#f8f9fa') {
      out.bgColor = '#131722';
    }
    out.upColor = typeof raw.upColor === 'string' ? raw.upColor : DEFAULTS.upColor;
    out.downColor = typeof raw.downColor === 'string' ? raw.downColor : DEFAULTS.downColor;
    out.maxTrades = clampInt(raw.maxTrades, 50, 100000, DEFAULTS.maxTrades);
    out.heatmapMaxFrames = clampInt(raw.heatmapMaxFrames, 60, 100000, DEFAULTS.heatmapMaxFrames);
    out.footprintMaxCandles = clampInt(raw.footprintMaxCandles, 60, 100000, DEFAULTS.footprintMaxCandles);
    out.footprintHistoryLookbackMinutes = clampInt(raw.footprintHistoryLookbackMinutes, 1, 100000, DEFAULTS.footprintHistoryLookbackMinutes);
    out.domDepth = clampInt(raw.domDepth, 10, 5000, DEFAULTS.domDepth);
    out.domRangeLevels = clampInt(raw.domRangeLevels, 250, 5000, DEFAULTS.domRangeLevels);
    out.domMinNotionalUsd = Math.max(0, Math.min(10000000, Number(raw.domMinNotionalUsd) || DEFAULTS.domMinNotionalUsd));
    out.domFollowThresholdTicks = clampInt(raw.domFollowThresholdTicks, 1, 20, DEFAULTS.domFollowThresholdTicks);
    out.domScaleMode = raw.domScaleMode === 'visible' ? 'visible' : DEFAULTS.domScaleMode;
    out.domGroup = clampInt(raw.domGroup, 1, 100, DEFAULTS.domGroup);
    out.domSoftWallPercentile = Math.max(0.5, Math.min(0.99, Number(raw.domSoftWallPercentile) || DEFAULTS.domSoftWallPercentile));
    out.domMajorWallPercentile = Math.max(out.domSoftWallPercentile, Math.min(0.999, Number(raw.domMajorWallPercentile) || DEFAULTS.domMajorWallPercentile));
    var rawValueMode = raw.domValueMode === 'usd' ? 'notional' : raw.domValueMode;
    out.domValueMode = VALID_VALUE_MODES[rawValueMode] ? rawValueMode : DEFAULTS.domValueMode;
    // Validate domColumns: must be a non-empty array of unique valid keys.
    // If the persisted value is exactly one of the old baked-in defaults
    // (6 or 9 columns), treat it as "never customized" and migrate to the
    // new clean BID | PRICE | ASK default rather than preserving it.
    if (isLegacyDefaultDomColumns(raw.domColumns)) {
      out.domColumns = DEFAULT_DOM_COLUMNS.slice();
    } else if (Array.isArray(raw.domColumns) && raw.domColumns.length > 0) {
      var seen = {};
      var validCols = [];
      raw.domColumns.forEach(function (k) {
        if (VALID_DOM_KEYS[k] && !seen[k]) {
          seen[k] = true;
          validCols.push(k);
        }
      });
      // Force 'price' column if missing
      if (!seen['price']) {
        // Find where price should be (between bid/ask if possible, or just insert it)
        var bidIdx = validCols.indexOf('bid');
        var askIdx = validCols.indexOf('ask');
        if (bidIdx !== -1 && askIdx !== -1 && askIdx > bidIdx) {
          validCols.splice(askIdx, 0, 'price');
        } else {
          validCols.push('price');
        }
      }
      if (validCols.length > 0) {
        out.domColumns = validCols;
      } else {
        out.domColumns = DEFAULT_DOM_COLUMNS.slice();
      }
    } else {
      out.domColumns = DEFAULT_DOM_COLUMNS.slice();
    }
    out.domColumnWidths = sanitizeDomColumnWidths(raw.domColumnWidths);
    out.minQty = Math.max(0, Number(raw.minQty) || 0);
    out.maxRows = clampInt(raw.maxRows, 8, 5000, DEFAULTS.maxRows);
    out.restTradePrefillLimit = clampInt(raw.restTradePrefillLimit, 50, 100000, DEFAULTS.restTradePrefillLimit);
    out.tapeFontSize = clampInt(raw.tapeFontSize, 8, 20, DEFAULTS.tapeFontSize);
    out.deltaIntervalMs = Number(raw.deltaIntervalMs) || DEFAULTS.deltaIntervalMs;
    // Respect the instrument's native tick precision — no 0.01 floor, which
    // merged distinct levels on fine-tick assets. Only reject non-positive/NaN.
    out.tickSize = (Number.isFinite(Number(raw.tickSize)) && Number(raw.tickSize) > 0)
      ? Number(raw.tickSize)
      : DEFAULTS.tickSize;
    out.activeTab = typeof raw.activeTab === 'string' ? raw.activeTab : DEFAULTS.activeTab;
    out.dockCollapsed = typeof raw.dockCollapsed === 'boolean' ? raw.dockCollapsed : DEFAULTS.dockCollapsed;
    out.cvdCollapsed = typeof raw.cvdCollapsed === 'boolean' ? raw.cvdCollapsed : DEFAULTS.cvdCollapsed;
    out.inspectorTimeZoneMode = raw.inspectorTimeZoneMode === 'local' || raw.inspectorTimeZoneMode === 'exchange'
      ? raw.inspectorTimeZoneMode
      : DEFAULTS.inspectorTimeZoneMode;
    out.showFootprintVA = typeof raw.showFootprintVA === 'boolean' ? raw.showFootprintVA : DEFAULTS.showFootprintVA;
    out.showVwapBands = typeof raw.showVwapBands === 'boolean' ? raw.showVwapBands : DEFAULTS.showVwapBands;
    out.vwapBand1 = Math.max(0.1, Math.min(5, Number(raw.vwapBand1) || DEFAULTS.vwapBand1));
    out.vwapBand2 = Math.max(out.vwapBand1, Math.min(8, Number(raw.vwapBand2) || DEFAULTS.vwapBand2));
    out.alertsEnabled = typeof raw.alertsEnabled === 'boolean' ? raw.alertsEnabled : DEFAULTS.alertsEnabled;
    out.largeTradeAlertQty = Math.max(0, Math.min(1000000, Number(raw.largeTradeAlertQty) || DEFAULTS.largeTradeAlertQty));
    out.deltaAlertThreshold = Math.max(0, Math.min(10000000, Number(raw.deltaAlertThreshold) || DEFAULTS.deltaAlertThreshold));
    out.imbalanceRatio = Math.max(1.5, Math.min(8.0, Number(raw.imbalanceRatio) || DEFAULTS.imbalanceRatio));
    out.imbalanceStack = clampInt(raw.imbalanceStack, 2, 6, DEFAULTS.imbalanceStack);
    out.imbalanceMinVolume = Math.max(0, Math.min(1000000, Number(raw.imbalanceMinVolume) || DEFAULTS.imbalanceMinVolume));
    out.exhaustionFactor = Math.max(0.05, Math.min(1, Number(raw.exhaustionFactor) || DEFAULTS.exhaustionFactor));
    out.footprintValueAreaPct = Math.max(1, Math.min(100, Number(raw.footprintValueAreaPct) || DEFAULTS.footprintValueAreaPct));
    out.minWickTicks = clampInt(raw.minWickTicks, 0, 10, DEFAULTS.minWickTicks);
    out.indicatorSources = sanitizeIndicatorSources(raw.indicatorSources);
    out.indicators = sanitizeIndicators(raw.indicators, out.indicatorSources);
    out.chartIndicators = sanitizeChartIndicators(raw.chartIndicators, out.showOhlc);
    out.hiddenChartIndicators = sanitizeHiddenChartIndicators(raw.hiddenChartIndicators);
    out.markers = Array.isArray(raw.markers) ? raw.markers.map(function (m) {
      return {
        ts: Number(m.ts || 0),
        text: String(m.text || ''),
        type: String(m.type || 'user')
      };
    }) : [];
    out.showVolumeProfile = typeof raw.showVolumeProfile === 'boolean' ? raw.showVolumeProfile : DEFAULTS.showVolumeProfile;
    out.volumeProfileType = ['visible', 'session', 'fixed', 'composite'].indexOf(raw.volumeProfileType) >= 0 ? raw.volumeProfileType : DEFAULTS.volumeProfileType;
    out.volumeProfileSide = ['left', 'right'].indexOf(raw.volumeProfileSide) >= 0 ? raw.volumeProfileSide : DEFAULTS.volumeProfileSide;
    out.volumeProfileStyle = ['volume', 'delta', 'split'].indexOf(raw.volumeProfileStyle) >= 0 ? raw.volumeProfileStyle : DEFAULTS.volumeProfileStyle;
    out.volumeProfileValueArea = clampInt(raw.volumeProfileValueArea, 10, 100, DEFAULTS.volumeProfileValueArea);
    out.volumeProfileFixedStart = Math.max(0, Number(raw.volumeProfileFixedStart) || 0);
    out.volumeProfileFixedEnd = Math.max(0, Number(raw.volumeProfileFixedEnd) || 0);
    out.volumeProfileShowPocTrail = typeof raw.volumeProfileShowPocTrail === 'boolean' ? raw.volumeProfileShowPocTrail : DEFAULTS.volumeProfileShowPocTrail;
    return out;
  }

  function sanitizeIndicatorSources(rawSources) {
    if (!Array.isArray(rawSources)) return DEFAULTS.indicatorSources.slice();
    var seen = {};
    var out = [];
    rawSources.forEach(function (src) {
      if (!src || typeof src !== 'object') return;
      var sourceId = typeof src.sourceId === 'string' ? src.sourceId.trim() : '';
      var code = typeof src.code === 'string' ? src.code : '';
      if (!sourceId || !code || seen[sourceId]) return;
      seen[sourceId] = true;
      out.push({
        sourceId: sourceId.slice(0, 80),
        name: (typeof src.name === 'string' && src.name.trim() ? src.name.trim() : sourceId).slice(0, 80),
        code: code.slice(0, 200000),
        updatedAt: Number(src.updatedAt) || Date.now()
      });
    });
    return out;
  }

  function sanitizeChartIndicators(raw, showOhlc) {
    var valid = { ohlc: 1, vwap: 1, ema9: 1, ema21: 1 };
    var out = [];
    var seen = {};
    if (Array.isArray(raw)) {
      raw.forEach(function (id) {
        id = String(id || '').trim();
        if (valid[id] && !seen[id]) {
          seen[id] = true;
          out.push(id);
        }
      });
    }
    if (showOhlc !== false && !seen.ohlc) out.unshift('ohlc');
    return out;
  }

  function sanitizeHiddenChartIndicators(raw) {
    var valid = { ohlc: 1, vwap: 1, ema9: 1, ema21: 1 };
    var out = [];
    var seen = {};
    if (!Array.isArray(raw)) return out;
    raw.forEach(function (id) {
      id = String(id || '').trim();
      if (valid[id] && !seen[id]) {
        seen[id] = true;
        out.push(id);
      }
    });
    return out;
  }

  function sanitizeIndicators(rawIndicators, sources) {
    if (!Array.isArray(rawIndicators)) return DEFAULTS.indicators.slice();
    var sourceMap = {};
    (sources || []).forEach(function (src) { sourceMap[src.sourceId] = 1; });
    var seen = {};
    var out = [];
    rawIndicators.forEach(function (inst) {
      if (!inst || typeof inst !== 'object') return;
      var instanceId = typeof inst.instanceId === 'string' ? inst.instanceId.trim() : '';
      var sourceId = typeof inst.sourceId === 'string' ? inst.sourceId.trim() : '';
      if (!instanceId || !sourceId || !sourceMap[sourceId] || seen[instanceId]) return;
      seen[instanceId] = true;
      out.push({
        instanceId: instanceId.slice(0, 80),
        sourceId: sourceId.slice(0, 80),
        name: (typeof inst.name === 'string' && inst.name.trim() ? inst.name.trim() : sourceId).slice(0, 80),
        pane: inst.pane === 'separate' ? 'separate' : 'overlay',
        visible: inst.visible !== false,
        inputs: inst.inputs && typeof inst.inputs === 'object' ? Object.assign({}, inst.inputs) : {},
        style: inst.style && typeof inst.style === 'object' ? Object.assign({}, inst.style) : {},
        height: clampInt(inst.height, 56, 280, 112),
        locked: inst.locked === true
      });
    });
    return out;
  }

  function sanitizeDomColumnWidths(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(VALID_DOM_KEYS).forEach(function (key) {
      if (raw[key] == null) return;
      var n = Number(raw[key]);
      if (!Number.isFinite(n)) return;
      out[key] = Math.max(24, Math.min(220, Math.round(n)));
    });
    return out;
  }

  function load() {
    try {
      var json = localStorage.getItem(STORAGE_KEY);
      if (!json) return Object.assign({}, DEFAULTS);
      var parsed = JSON.parse(json);
      var validated = validateSettings(parsed);
      if (parsed.schemaVersion !== SETTINGS_SCHEMA_VERSION) save(validated);
      return validated;
    } catch (err) {
      console.warn('[V6OF Settings] invalid localStorage, using defaults', err);
      return Object.assign({}, DEFAULTS);
    }
  }

  function syncToServer(settings) {
    if (typeof fetch !== 'function' || typeof setTimeout !== 'function') return;
    if (typeof clearTimeout === 'function') clearTimeout(_settingsSyncTimer);
    _settingsSyncTimer = setTimeout(function () {
      var payload = {};
      payload[SERVER_KEY] = validateSettings(settings);
      fetch('/api/user/workspace-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      }).catch(function () {});
    }, 1000);
  }

  function loadFromServer(callback) {
    if (typeof fetch !== 'function') return;
    fetch('/api/user/workspace-profile', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var raw = data && data.workspace_profile && data.workspace_profile[SERVER_KEY];
        if (!raw || typeof raw !== 'object') return;
        callback(validateSettings(raw));
      })
      .catch(function () {});
  }

  function save(settings, opts) {
    opts = opts || {};
    try {
      var validated = validateSettings(settings);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(validated));
      if (opts.sync !== false) syncToServer(validated);
    } catch (err) {
      console.warn('[V6OF Settings] failed to save to localStorage', err);
    }
  }

  function reset() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) { /* ignore */ }
    return Object.assign({}, DEFAULTS);
  }

  // Validate and normalize a domColumns array (used by DOM panel render).
  // This centralizes the validation logic so it's not duplicated in 075_v6_dom_panel.js.
  function getValidatedDomColumns(rawCols) {
    if (isLegacyDefaultDomColumns(rawCols)) {
      return DEFAULT_DOM_COLUMNS.slice();
    }
    if (!Array.isArray(rawCols) || rawCols.length === 0) {
      return DEFAULT_DOM_COLUMNS.slice();
    }
    var seen = {};
    var validCols = [];
    rawCols.forEach(function (k) {
      if (VALID_DOM_KEYS[k] && !seen[k]) {
        seen[k] = true;
        validCols.push(k);
      }
    });
    // Force 'price' column if missing
    if (!seen['price']) {
      var bidIdx = validCols.indexOf('bid');
      var askIdx = validCols.indexOf('ask');
      if (bidIdx !== -1 && askIdx !== -1 && askIdx > bidIdx) {
        validCols.splice(askIdx, 0, 'price');
      } else {
        validCols.push('price');
      }
    }
    return validCols.length > 0 ? validCols : DEFAULT_DOM_COLUMNS.slice();
  }

  function bindStore(store) {
    if (!store) return;
    var lastJson = '';
    var hydrating = false;
    loadFromServer(function (serverSettings) {
      var json = JSON.stringify(serverSettings);
      lastJson = json;
      hydrating = true;
      save(serverSettings, { sync: false });
      if (store.updateSettings) store.updateSettings(serverSettings);
      hydrating = false;
    });
    store.subscribe(function (state) {
      if (!state || !state.settings) return;
      var json = JSON.stringify(validateSettings(state.settings));
      if (json !== lastJson) {
        lastJson = json;
        save(state.settings, { sync: !hydrating });
      }
    }, function (state) {
      return state ? state.settings : null;
    });
  }

  V6OF.register('Core', 'Settings', {
    SCHEMA_VERSION: SETTINGS_SCHEMA_VERSION,
    DEFAULTS: DEFAULTS,
    load: load,
    save: save,
    reset: reset,
    validate: validateSettings,
    bindStore: bindStore,
    getValidatedDomColumns: getValidatedDomColumns
  }, 'Settings');
})();
