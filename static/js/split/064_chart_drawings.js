// ---------- Chart Drawing Engine v3 — Canvas Overlay ----------
// Tools: Box, Trend, Horizontal, Horizontal Ray, Vertical, Fibonacci, Text
// Features: opacity, fib level toggles, templates, colors, extends, text labels
// v3.2 — Session zones: Asian, London, New York time-based overlays

(function () {
  'use strict';

  var DRAW_TOOLS = [
    { id: 'cursor',        label: 'Curseur',      icon: '⊹' },
    { id: 'box',           label: 'Rectangle',     icon: '▭' },
    { id: 'trendline',     label: 'Trend line',    icon: '↗' },
    { id: 'horizontal',    label: 'Horizontale',   icon: '—' },
    { id: 'horizontalray', label: 'Rayon horiz.',  icon: '→' },
    { id: 'vertical',      label: 'Verticale',     icon: '│' },
    { id: 'fibonacci',     label: 'Fibonacci',     icon: 'ϕ' },
    { id: 'text',          label: 'Texte',          icon: 'T' },
  ];

  var LINE_WIDTHS = [1, 1.5, 2, 2.5, 3];
  var LINE_STYLES = [
    { id: 'solid',  label: '─', dash: [] },
    { id: 'dashed', label: '╌', dash: [6, 4] },
    { id: 'dotted', label: '┈', dash: [2, 4] },
  ];
  var TOOL_COLORS = ['#06b6d4', '#22c55e', '#f59e0b', '#ef4444', '#a78bfa', '#f472b6', '#fb923c', '#ffffff', '#9ca3af'];

  var FIB_LEVELS = [
    { key: 0,     label: '0',     color: '#9ca3af' },
    { key: 0.236, label: '23.6',  color: '#06b6d4' },
    { key: 0.382, label: '38.2',  color: '#22c55e' },
    { key: 0.5,   label: '50',    color: '#f59e0b' },
    { key: 0.618, label: '61.8',  color: '#ef4444' },
    { key: 1,     label: '100',   color: '#9ca3af' },
    { key: 2,     label: '200',   color: '#a78bfa' },
    { key: 2.5,   label: '250',   color: '#f472b6' },
    { key: 3,     label: '300',   color: '#fb923c' },
    { key: 4,     label: '400',   color: '#34d399' },
    { key: 4.5,   label: '450',   color: '#818cf8' },
    { key: 5,     label: '500',   color: '#e879f9' },
  ];
  // Default: all levels visible
  var DEFAULT_FIB_VISIBLE = {};
  FIB_LEVELS.forEach(function (l) { DEFAULT_FIB_VISIBLE[l.key] = true; });

  var STORAGE_KEY = 'chartDrawings';
  var TEMPLATE_KEY = 'chartDrawTemplates';
  var MAX_UNDO = 30;

  // ── SESSION PRESETS ──
  // Chaque session définit ses horaires en heure locale du marché.
  // timezone = fuseau horaire IANA (ex: 'America/New_York')
  // start/end = heures locales au format 'HH:MM'
  // Le rendu convertit automatiquement en UTC selon la date affichée,
  // ce qui gère correctement les passages à l'heure d'été (DST).
  var SESSION_PRESETS = [
    { id: 'asian',     name: 'Asie',      timezone: 'Asia/Tokyo',          start: '09:00', end: '15:00', color: '#ffdd00', active: true,  opacity: 0.12 },
    { id: 'london',    name: 'Londres',   timezone: 'Europe/London',       start: '08:00', end: '16:30', color: '#0066ff', active: true,  opacity: 0.12 },
    { id: 'ny_rth',    name: 'NY RTH',    timezone: 'America/New_York',   start: '09:30', end: '16:00', color: '#ff0066', active: true,  opacity: 0.12 },
    { id: 'ny_ext',    name: 'NY Ext',    timezone: 'America/New_York',   start: '08:00', end: '17:00', color: '#ff7733', active: false, opacity: 0.08 },
  ];

  var SESSION_STORAGE_KEY = 'chartSessionSettings';
  // ── / SESSION PRESETS

  // ── TIMEZONE HELPERS ──
  // Calcule le décalage UTC (en minutes) d'une timezone pour une date donnée.
  // Utilise Intl.DateTimeFormat.formatToParts — fiable sur tous les navigateurs modernes.
  function _getTzOffsetMinutes(dateMs, timezone) {
    try {
      var parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      }).formatToParts(new Date(dateMs));
      var v = {};
      for (var pi = 0; pi < parts.length; pi++) { v[parts[pi].type] = parts[pi].value; }
      var tzDate = Date.UTC(
        parseInt(v.year), parseInt(v.month) - 1,
        parseInt(v.day), parseInt(v.hour),
        parseInt(v.minute), parseInt(v.second)
      );
      return Math.round((tzDate - dateMs) / 60000);
    } catch (e) { return 0; }
  }

  // Convertit les horaires locaux d'une session en secondes UTC pour un jour donné.
  // dayUtcSeconds = minuit UTC du jour (timestamp en secondes)
  // Retourne { startUtcSeconds, endUtcSeconds }
  function _getSessionUtcRangeForChartDay(dayUtcSeconds, session) {
    var dateMs = dayUtcSeconds * 1000;
    var offsetMinutes = _getTzOffsetMinutes(dateMs, session.timezone);

    var startP = session.start.split(':');
    var endP = session.end.split(':');
    var startLocalMin = parseInt(startP[0]) * 60 + parseInt(startP[1]);
    var endLocalMin = parseInt(endP[0]) * 60 + parseInt(endP[1]);

    var startUtc = dayUtcSeconds + (startLocalMin - offsetMinutes) * 60;
    var endUtc = dayUtcSeconds + (endLocalMin - offsetMinutes) * 60;

    // Gérer les sessions qui traversent minuit (start > end)
    if (endUtc <= startUtc) {
      endUtc += 86400;
    }

    return { startUtcSeconds: startUtc, endUtcSeconds: endUtc };
  }
  // ── / TIMEZONE HELPERS

  // ── STATE ──

  var state = {
    ctx: null, chart: null, series: null, container: null, canvas: null,
    drawings: [],
    undoStack: [],
    sessions: [], // session zone configs
    activeTool: 'cursor',
    isDrawing: false, dragStart: null, previewPoint: null,
    selectedIndex: -1, // -1 = none, >=0 = editing an existing drawing
    snapEnabled: false, // false = snap actif (OHLC) — cf. _snapPoint inverse
    _crosshairPos: null, // position souris pour crosshair canvas
    _drag: null, // drag state: { idx, startTime, startPrice, pointIdx }
    toolOptions: {
      color: '#06b6d4', fillColor: '#06b6d4', opacity: 0.3,
      lineWidth: 1.5, lineStyle: 'solid',
      extendLeft: false, extendRight: true,
      text: '', fibLevels: Object.assign({}, DEFAULT_FIB_VISIBLE),
    },
  };

  // ── INIT ──

  function initDrawings(chart, series, container) {
    state.chart = chart; state.series = series; state.container = container;
    _loadDrawings();
    _loadSessionSettings();
    _createCanvas();
    _bindEvents();
    _renderAll();
    _syncOptionsUI();
  }

  function destroyDrawings() {
    _stopRenderLoop();
    clearTimeout(_interactionTimeout);
    if (state.canvas) {
      state.canvas.removeEventListener('click', _onCanvasClick);
      state.canvas.removeEventListener('mousemove', _onMouseMove);
      state.canvas.removeEventListener('mouseleave', _onMouseLeave);
      state.canvas.removeEventListener('dblclick', _onDblClick);
      if (state.canvas.parentNode) state.canvas.parentNode.removeChild(state.canvas);
    }
    window.removeEventListener('resize', _onWindowResize);
    state.chart = null; state.series = null; state.container = null;
    state.ctx = null; state.canvas = null; state.drawings = []; state.undoStack = [];
  }

  // ── CANVAS ──

  function _createCanvas() {
    if (!state.container) return;
    state.canvas = document.createElement('canvas');
    state.canvas.className = 'draw-overlay';
    state.canvas.style.cssText = 'position:absolute;inset:0;z-index:10;pointer-events:none;width:100%;height:100%;';
    state.container.appendChild(state.canvas);
    state.ctx = state.canvas.getContext('2d');
    _resizeCanvas();
  }

  function _resizeCanvas() {
    var c = state.canvas; if (!c || !state.container) return;
    var pane = _getLwcPaneRect();
    var rect = pane || { left: 0, top: 0, width: state.container.clientWidth, height: state.container.clientHeight };
    var dpr = window.devicePixelRatio || 1;
    c.style.left = rect.left + 'px';
    c.style.top = rect.top + 'px';
    c.style.width = rect.width + 'px';
    c.style.height = rect.height + 'px';
    c.width = Math.round(rect.width * dpr);
    c.height = Math.round(rect.height * dpr);
    if (state.ctx) state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Cache du pane rect pour eviter querySelectorAll + getBoundingClientRect a 60fps
  var _cachedPaneRect = null;

  function _invalidatePaneRect() { _cachedPaneRect = null; }

  // Trouve le rectangle du pane LWC interne (pas tout le container)
  function _getLwcPaneRect() {
    if (_cachedPaneRect) return _cachedPaneRect;
    if (!state.container) return null;
    var containerRect = state.container.getBoundingClientRect();
    var canvases = Array.prototype.slice.call(
      state.container.querySelectorAll('canvas')
    ).filter(function (c) {
      return c !== state.canvas && !c.classList.contains('draw-overlay');
    });
    if (!canvases.length) return null;
    var best = null, bestArea = 0;
    for (var i = 0; i < canvases.length; i++) {
      var r = canvases[i].getBoundingClientRect();
      var area = r.width * r.height;
      if (r.width > 100 && r.height > 100 && area > bestArea) {
        best = r; bestArea = area;
      }
    }
    if (!best) return null;
    var result = {
      left: best.left - containerRect.left,
      top: best.top - containerRect.top,
      width: best.width,
      height: best.height,
      absLeft: best.left,
      absTop: best.top,
    };
    _cachedPaneRect = result;
    return result;
  }

  // ── COORDINATES ──

  function _clientToPanePoint(clientX, clientY) {
    if (!state.container) return null;
    var pane = _getLwcPaneRect();
    var rect = pane
      ? { left: pane.absLeft, top: pane.absTop }
      : state.container.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  function _toPixel(time, price) {
    var x = state.chart.timeScale().timeToCoordinate(time);
    var y = state.series.priceToCoordinate(price);
    // Si timeToCoordinate echoue (temps au-dela des donnees), calculer via le ratio temps/pixel
    if (x == null && state.chart && state.chart.timeScale()) {
      try {
        var vr = state.chart.timeScale().getVisibleRange();
        if (vr && vr.from != null && vr.to != null) {
          var lx = state.chart.timeScale().timeToCoordinate(vr.from);
          var rx = state.chart.timeScale().timeToCoordinate(vr.to);
          if (lx != null && rx != null && rx !== lx) {
            // Inverser le calcul: (time - vr.from) * (pixels / time) + offset gauche
            var pxPerTime = (rx - lx) / (vr.to - vr.from);
            x = lx + (time - vr.from) * pxPerTime;
          }
        }
      } catch(e) {}
    }
    if (x == null || y == null) return null;
    return { x: x, y: y };
  }

  function _toTimePrice(clientX, clientY) {
    var point = _clientToPanePoint(clientX, clientY);
    if (!point) return null;
    var x = point.x;
    var y = point.y;
    var tp = state.chart.timeScale().coordinateToTime(x);
    var pp = state.series.coordinateToPrice(y);
    if (pp == null) return null;
    // Si clic au-dela du temps visible (dans le futur/droite), prendre le bord droit de la time scale
    if (tp == null) {
      try {
        var vr = state.chart.timeScale().getVisibleRange();
        if (vr && vr.from != null && vr.to != null) {
          var lx = state.chart.timeScale().timeToCoordinate(vr.from);
          var rx = state.chart.timeScale().timeToCoordinate(vr.to);
          if (lx != null && rx != null && rx !== lx) {
            var timePerPx = (vr.to - vr.from) / (rx - lx);
            tp = vr.from + (x - lx) * timePerPx;
          }
        }
      } catch(e) {}
    }
    if (tp == null) return null;
    return { time: tp, price: pp };
  }

  // Snap un point {time, price} a la bougie la plus proche (OHLC)
  function _snapPoint(tp, clientX) {
    if (!tp) return tp;
    if (state.snapEnabled || !state.chart || !state.series || !state.container) return tp;
    try {
      var point = _clientToPanePoint(clientX, 0);
      if (!point) return tp;
      var x = point.x;
      var logical = state.chart.timeScale().coordinateToLogical(x);
      if (logical == null) return tp;
      var index = Math.round(logical);
      var candle = state.series.dataByIndex(index);
      if (!candle || typeof candle.high !== 'number' || typeof candle.time !== 'number') return tp;
      tp.time = candle.time;
      var candidates = [
        { val: candle.high,  dist: Math.abs(candle.high - tp.price) },
        { val: candle.low,   dist: Math.abs(candle.low - tp.price) },
        { val: candle.open,  dist: Math.abs(candle.open - tp.price) },
        { val: candle.close, dist: Math.abs(candle.close - tp.price) },
      ];
      candidates.sort(function (a, b) { return a.dist - b.dist; });
      tp.price = candidates[0].val;
    } catch(e) {
      console.warn('[drawings] snap error:', e);
    }
    return tp;
  }

  function _createDrawing(type, points) {
    var o = state.toolOptions;
    var d = {
      id: _uid(), type: type, points: points,
      color: o.color, fillColor: o.fillColor,
      lineWidth: o.lineWidth, lineStyle: o.lineStyle,
      opacity: o.opacity,
      extendLeft: o.extendLeft, extendRight: o.extendRight,
      text: o.text || '',
      fibLevels: type === 'fibonacci' ? Object.assign({}, o.fibLevels) : null,
      locked: false,
      createdAt: Date.now(),
    };
    return d;
  }

  function _uid() { return 'draw_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6); }

  // ── STORAGE ──

  function _saveDrawings() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.drawings)); } catch(e) {} }
  function _loadDrawings() {
    try { var r = localStorage.getItem(STORAGE_KEY); state.drawings = r ? JSON.parse(r) : []; } catch(e) { state.drawings = []; }
  }

  // ── SESSION ZONE STORAGE ──

  function _loadSessionSettings() {
    try {
      var r = localStorage.getItem(SESSION_STORAGE_KEY);
      if (r) {
        var saved = JSON.parse(r);

        // Migration : détecter l'ancien format (startHour/endHour) et le convertir
        var needsMigration = saved.length > 0 && saved[0].startHour !== undefined;
        if (needsMigration) {
          var OLD_TO_NEW = {
            'asian':   { timezone: 'Asia/Tokyo',        start: '09:00', end: '15:00' },
            'london':  { timezone: 'Europe/London',     start: '08:00', end: '16:30' },
            'newyork': { timezone: 'America/New_York',  start: '09:30', end: '16:00' },
          };
          var OLD_ID_MAP = { 'newyork': 'ny_rth' };
          saved = saved.map(function (old) {
            var preset = OLD_TO_NEW[old.id];
            if (!preset) return old; // unknown, keep as-is
            return {
              id: OLD_ID_MAP[old.id] || old.id,
              name: old.name,
              timezone: preset.timezone,
              start: preset.start,
              end: preset.end,
              color: old.color || '#ff0066',
              active: old.active !== false,
              opacity: old.opacity != null ? old.opacity : 0.12,
            };
          });
          // Sauvegarder au nouveau format immédiatement
          try { localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(saved)); } catch(e) {}
        }

        // Merge with presets: keep saved if exists, fallback to preset defaults
        state.sessions = SESSION_PRESETS.map(function (preset) {
          var existing = null;
          for (var i = 0; i < saved.length; i++) {
            if (saved[i].id === preset.id) { existing = saved[i]; break; }
          }
          return existing ? Object.assign({}, preset, existing) : Object.assign({}, preset);
        });
      } else {
        state.sessions = SESSION_PRESETS.map(function (p) { return Object.assign({}, p); });
      }
    } catch(e) {
      state.sessions = SESSION_PRESETS.map(function (p) { return Object.assign({}, p); });
    }
  }

  function _saveSessionSettings() {
    try { localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state.sessions)); } catch(e) {}
  }

  function updateSessions(sessions) {
    state.sessions = sessions;
    _saveSessionSettings();
    _renderAll();
  }

  function getSessionSettings() { return state.sessions.slice(); }

  // ── / SESSION ZONE STORAGE

  // ── UNDO ──

  function _pushUndoState() {
    try {
      state.undoStack.push(JSON.stringify(state.drawings));
      if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
    } catch(e) {}
  }

  function undo() {
    if (!state.undoStack.length) return;
    try {
      state.drawings = JSON.parse(state.undoStack.pop());
      _saveDrawings();
      _renderAll();
    } catch(e) {}
  }

  // ── TEMPLATES ──

  function saveTemplate(name) {
    if (!name || !state.drawings.length) return;
    try {
      var templates = JSON.parse(localStorage.getItem(TEMPLATE_KEY)) || {};
      templates[name] = { name: name, drawings: JSON.parse(JSON.stringify(state.drawings)), savedAt: Date.now() };
      localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
      return true;
    } catch(e) { return false; }
  }

  function loadTemplate(name) {
    try {
      var templates = JSON.parse(localStorage.getItem(TEMPLATE_KEY)) || {};
      var t = templates[name];
      if (!t) return false;
      _pushUndoState();
      state.drawings = JSON.parse(JSON.stringify(t.drawings));
      _saveDrawings();
      _renderAll();
      return true;
    } catch(e) { return false; }
  }

  function listTemplates() {
    try {
      var templates = JSON.parse(localStorage.getItem(TEMPLATE_KEY)) || {};
      var names = Object.keys(templates);
      names.sort(function (a, b) { return templates[b].savedAt - templates[a].savedAt; });
      return names.map(function (n) { return templates[n]; });
    } catch(e) { return []; }
  }

  function deleteTemplate(name) {
    try {
      var templates = JSON.parse(localStorage.getItem(TEMPLATE_KEY)) || {};
      delete templates[name];
      localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
    } catch(e) {}
  }

  // ── TOOL MANAGEMENT ──

  function setActiveTool(toolId) {
    state.selectedIndex = -1; // clear selection on tool change
    state.activeTool = toolId || 'cursor';
    state.isDrawing = false; state.dragStart = null; state.previewPoint = null; state._crosshairPos = null;
    if (toolId === 'horizontal' || toolId === 'horizontalray' || toolId === 'vertical') {
      state.toolOptions.extendLeft = false; state.toolOptions.extendRight = true;
    } else if (toolId === 'text') {
      state.toolOptions.text = '';
    }
    _updateCanvasPointer();
    _syncOptionsUI();
    _renderAll();
  }

  function getActiveTool() { return state.activeTool; }

  function _updateCanvasPointer() {
    if (!state.canvas) return;
    state.canvas.style.pointerEvents = state.activeTool === 'cursor' ? 'none' : 'all';
    state.canvas.style.cursor = state.activeTool === 'cursor' ? '' : 'crosshair';
  }

  // ── LOCK TOGGLE ──

  function _syncLockButton(d) {
    var btn = document.getElementById('drawLockToggle');
    if (!btn) return;
    var locked = d && d.locked;
    btn.textContent = locked ? '🔒' : '🔓';
    btn.title = locked ? 'Déverrouiller le dessin' : 'Verrouiller le dessin (clic traverse vers le chart)';
    btn.dataset.locked = locked ? 'true' : 'false';
  }

  function _toggleLock() {
    if (state.selectedIndex < 0 || state.selectedIndex >= state.drawings.length) return;
    var d = state.drawings[state.selectedIndex];
    d.locked = !d.locked;
    _saveDrawings();
    _syncLockButton(d);
    _renderAll();
    toast('Dessin ' + (d.locked ? 'verrouillé' : 'déverrouillé'), 'info');
  }

  // ── / LOCK TOGGLE

  function _syncOptionsUI() {
    ['drawOptionsPanel', 'drawOptionsPanelWidget'].forEach(function (id) {
      var panel = document.getElementById(id);
      if (panel) {
        if (state.activeTool === 'cursor' && state.selectedIndex < 0) { panel.classList.add('hidden'); }
        else { panel.classList.remove('hidden'); }
      }
    });

    _setVal('drawColorPick', state.toolOptions.color);
    _setVal('drawFillColor', state.toolOptions.fillColor);
    _setVal('drawLineWidth', state.toolOptions.lineWidth);
    _setVal('drawLineStyle', state.toolOptions.lineStyle);
    _setVal('drawOpacity', state.toolOptions.opacity);
    var ov = document.getElementById('drawOpacityVal');
    if (ov) ov.textContent = parseFloat(state.toolOptions.opacity).toFixed(2);
    _setChecked('drawExtLeft', state.toolOptions.extendLeft);
    _setChecked('drawExtRight', state.toolOptions.extendRight);
    _setVal('drawText', state.toolOptions.text);

    // Row visibility : selon le tool actif OU le dessin selectionne
    var tool = state.activeTool;
    if (tool === 'cursor' && state.selectedIndex >= 0) {
      // Utiliser le type du dessin selectionne
      var sel = state.drawings[state.selectedIndex];
      if (sel) tool = sel.type;
    }
    _showEl('drawExtRow', tool === 'trendline');
    _showEl('drawTextRow', tool === 'text' || tool === 'trendline' || tool === 'horizontal' || tool === 'horizontalray' || tool === 'vertical' || tool === 'box');
    _showEl('drawFillRow', tool === 'box');
    _showEl('drawOpacityRow', tool === 'box');
    _showEl('drawFibSection', tool === 'fibonacci');

    // Swatches
    var swatches = document.getElementById('drawColorSwatches');
    if (swatches && swatches.innerHTML === '') {
      TOOL_COLORS.forEach(function (c) {
        var sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'draw-swatch' + (c === state.toolOptions.color ? ' is-active' : '');
        sw.style.background = c;
        sw.dataset.color = c;
        sw.addEventListener('click', function () {
          swatches.querySelectorAll('.draw-swatch').forEach(function (s) { s.classList.remove('is-active'); });
          this.classList.add('is-active');
          state.toolOptions.color = c;
          _setVal('drawColorPick', c);
          _readOptionsFromUI();
        });
        swatches.appendChild(sw);
      });
    }
    // Update active swatch
    if (swatches) {
      swatches.querySelectorAll('.draw-swatch').forEach(function (s) {
        s.classList.toggle('is-active', s.dataset.color === state.toolOptions.color);
      });
    }

    // Fib level toggles
    var fibList = document.getElementById('drawFibLevels');
    if (fibList) {
      fibList.innerHTML = '';
      FIB_LEVELS.forEach(function (l) {
        var vis = state.toolOptions.fibLevels[l.key] !== false;
        var row = document.createElement('label');
        row.className = 'draw-fib-row';
        row.innerHTML =
          '<input type="checkbox" ' + (vis ? 'checked' : '') + ' data-fib-key="' + l.key + '">' +
          '<span class="draw-fib-dot" style="background:' + l.color + '"></span>' +
          '<span class="draw-fib-label">' + l.label + '%</span>';
        row.querySelector('input').addEventListener('change', function () {
          state.toolOptions.fibLevels[parseFloat(this.dataset.fibKey)] = this.checked;
        });
        fibList.appendChild(row);
      });
    }
  }

  function _setVal(id, val) { var e = document.getElementById(id); if (e) e.value = val; }
  function _setChecked(id, val) { var e = document.getElementById(id); if (e) e.checked = !!val; }
  function _showEl(id, show) { var e = document.getElementById(id); if (e) e.style.display = show ? '' : 'none'; }

  function _readOptionsFromUI() {
    function gv(id) { var e = document.getElementById(id); return e ? e.value : null; }
    function gc(id) { var e = document.getElementById(id); return e ? e.checked : false; }
    state.toolOptions.color = gv('drawColorPick') || '#06b6d4';
    state.toolOptions.fillColor = gv('drawFillColor') || '#06b6d4';
    state.toolOptions.lineWidth = parseFloat(gv('drawLineWidth')) || 1.5;
    state.toolOptions.lineStyle = gv('drawLineStyle') || 'solid';
    state.toolOptions.opacity = parseFloat(gv('drawOpacity')) || 0.3;
    state.toolOptions.extendLeft = gc('drawExtLeft');
    state.toolOptions.extendRight = gc('drawExtRight');
    state.toolOptions.text = gv('drawText') || '';

    // Apply to selected drawing (live edit)
    if (state.selectedIndex >= 0 && state.selectedIndex < state.drawings.length) {
      var d = state.drawings[state.selectedIndex];
      d.color = state.toolOptions.color;
      d.fillColor = state.toolOptions.fillColor;
      d.lineWidth = state.toolOptions.lineWidth;
      d.lineStyle = state.toolOptions.lineStyle;
      d.opacity = state.toolOptions.opacity;
      d.extendLeft = state.toolOptions.extendLeft;
      d.extendRight = state.toolOptions.extendRight;
      d.text = state.toolOptions.text;
      // Fib levels preserved — only sync top-level props
      _saveDrawings();
      _renderAll();
    }
  }

  // ── EVENTS ──

  // rAF render loop — double rAF pour laisser LWC finir son rendu avant nous
  var _renderLoopRunning = false;
  var _rafA = null;
  var _rafB = null;
  var _interactionTimeout = null;
  var IDLE_DELAY_MS = 200;

  function _startRenderLoop() {
    if (_renderLoopRunning) return;
    _renderLoopRunning = true;

    function tick() {
      if (!_renderLoopRunning) return;

      _rafA = requestAnimationFrame(function () {
        _rafA = null;
        // Deuxieme rAF : LWC a fini ses transforms internes
        _rafB = requestAnimationFrame(function () {
          _rafB = null;
          if (!_renderLoopRunning) return;
          _resizeCanvas();
          _renderAll();
          tick();
        });
      });
    }

    tick();
  }

  function _stopRenderLoop() {
    _renderLoopRunning = false;
    if (_rafA) { cancelAnimationFrame(_rafA); _rafA = null; }
    if (_rafB) { cancelAnimationFrame(_rafB); _rafB = null; }
    // Dernier rendu stabilise
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        _resizeCanvas();
        _renderAll();
      });
    });
  }

  function _scheduleStop() {
    clearTimeout(_interactionTimeout);
    _interactionTimeout = setTimeout(_stopRenderLoop, IDLE_DELAY_MS);
  }

  function _bindEvents() {
    if (!state.canvas) return;
    state.canvas.addEventListener('click', _onCanvasClick);
    state.canvas.addEventListener('mousemove', _onMouseMove);
    state.canvas.addEventListener('mouseleave', _onMouseLeave);
    state.canvas.addEventListener('dblclick', _onDblClick);

      // Click handler sur le conteneur pour hit-test en mode curseur
      if (state.container) {
        // Mousedown en phase CAPTURE pour intercepter avant LWC
        state.container.addEventListener('mousedown', function (e) {
          if (state.activeTool !== 'cursor' || e.button !== 0) return;
          if (e.target.closest('#drawOptionsPanel, #drawOptionsPanelWidget')) return;
          var tp = _toTimePrice(e.clientX, e.clientY);
          if (!tp) return;
          var hitIdx = _hitTestIndex(tp.time, tp.price);
          if (hitIdx >= 0 && !state.drawings[hitIdx].locked) {
            e.stopPropagation();
            e.preventDefault();
            // Detecter si le clic est sur une extremite (resize) ou le corps (deplacer)
            var dragPointIdx = -1; // -1 = deplacement complet
            var d = state.drawings[hitIdx];
            if (d.points && tp) {
              var cpx = _toPixel(tp.time, tp.price);
              if (cpx) {
                for (var p = 0; p < Math.min(d.points.length, 2); p++) {
                  var ppx = _toPixel(d.points[p].time, d.points[p].price);
                  if (ppx) {
                    var dist = Math.sqrt((cpx.x - ppx.x) * (cpx.x - ppx.x) + (cpx.y - ppx.y) * (cpx.y - ppx.y));
                    if (dist < 15) { dragPointIdx = p; break; }
                  }
                }
              }
            }
            state._drag = {
              idx: hitIdx,
              startX: e.clientX,
              startY: e.clientY,
              startTime: tp.time,
              startPrice: tp.price,
              pointIdx: dragPointIdx,
              // Snapshot immuable des points originaux au mousedown
              origPoints: JSON.parse(JSON.stringify(d.points)),
            };
            if (state.selectedIndex !== hitIdx) _selectDrawing(hitIdx);
            if (state.canvas) state.canvas.style.cursor = 'grabbing';
          }
        }, { capture: true });

        state.container.addEventListener('mouseup', function (e) {
          if (state._drag) {
            // Drag termine : sauvegarder
            _saveDrawings();
            state._drag = null;
            state.canvas.style.cursor = state.activeTool === 'cursor' ? '' : 'crosshair';
            _scheduleStop();
          }
        });

        state.container.addEventListener('click', function (e) {
          if (state.activeTool !== 'cursor') return;
          // Ne pas interferer avec les clics dans le panneau d'options
          if (e.target.closest('#drawOptionsPanel, #drawOptionsPanelWidget')) return;
          // Ignorer si on vient de draguer
          if (state._drag) return;
          var tp = _toTimePrice(e.clientX, e.clientY);
          if (tp) {
            var hitIdx = _hitTestIndex(tp.time, tp.price);
            if (hitIdx >= 0) {
              e.stopPropagation();
              _selectDrawing(hitIdx);
            } else {
              _deselectDrawing();
            }
          } else {
            _deselectDrawing();
          }
        });
        // Fallback: document-level click si le container ne capte pas
        document.addEventListener('click', function (e) {
          if (state.activeTool !== 'cursor') return;
          if (!state.container || !state.container.contains(e.target)) return;
          // Ne pas interferer avec les clics dans le panneau d'options
          if (e.target.closest('#drawOptionsPanel, #drawOptionsPanelWidget')) return;
          var tp = _toTimePrice(e.clientX, e.clientY);
          if (tp) {
            var hitIdx = _hitTestIndex(tp.time, tp.price);
            if (hitIdx >= 0) {
              e.stopPropagation();
              _selectDrawing(hitIdx);
            } else {
              _deselectDrawing();
            }
          } else {
            _deselectDrawing();
          }
        });
      }

    // Render loop synchro parfaite pendant interaction souris
    if (state.container) {
      state.container.addEventListener('mousemove', function (e) {
        // Drag: deplacer le dessin selectionne
        if (state._drag) {
          var d = state.drawings[state._drag.idx];
          if (d && d.points) {
            var current = _toTimePrice(e.clientX, e.clientY);
            if (!current) return;
            var dt = current.time - state._drag.startTime;
            var dp = current.price - state._drag.startPrice;
            // Appliquer sur le snapshot original (pas d'accumulation)
            if (state._drag.pointIdx >= 0) {
              var pi = state._drag.pointIdx;
              d.points[pi] = {
                time: state._drag.origPoints[pi].time + dt,
                price: state._drag.origPoints[pi].price + dp,
              };
            } else {
              for (var pi = 0; pi < d.points.length; pi++) {
                d.points[pi] = {
                  time: state._drag.origPoints[pi].time + dt,
                  price: state._drag.origPoints[pi].price + dp,
                };
              }
            }
            _renderAll();
          }
        }
        if (state._drag || state.activeTool !== 'cursor' || (e.buttons & 1)) {
          _startRenderLoop();
          _scheduleStop();
        }
      }, { passive: true });
      state.container.addEventListener('wheel', function () {
        _startRenderLoop();
        _scheduleStop();
      }, { passive: true });
      state.container.addEventListener('mouseleave', function () {
        clearTimeout(_interactionTimeout);
        _stopRenderLoop();
      });
    }

    document.addEventListener('change', function (e) {
      if (e.target.closest('#drawOptionsPanel')) _readOptionsFromUI();
      if (e.target.id === 'drawTemplateLoad') _onTemplateLoad();
    });

    // Live preview for range slider
    document.addEventListener('input', function (e) {
      if (e.target.id === 'drawOpacity') {
        var valEl = document.getElementById('drawOpacityVal');
        if (valEl) valEl.textContent = parseFloat(e.target.value).toFixed(2);
        _readOptionsFromUI();
      }
    });

    document.addEventListener('click', function (e) {
      if (e.target.id === 'drawTemplateSave') _onTemplateSave();
      if (e.target.id === 'drawTemplateDelete') _onTemplateDelete();
      if (e.target.id === 'drawTypeBtn') _onDrawTypeBtn();
      if (e.target.id === 'drawLockToggle') _toggleLock();
    });

    // Mouseup global pour finaliser le drag meme hors container
    document.addEventListener('mouseup', function () {
      if (state._drag) {
        _saveDrawings();
        state._drag = null;
        if (state.canvas) state.canvas.style.cursor = state.activeTool === 'cursor' ? '' : 'crosshair';
      }
    });
    // Keyboard: Ctrl+Z for undo + Escape to deselect
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      }
      if (e.key === 'Escape' && state.selectedIndex >= 0) {
        _deselectDrawing();
      }
    });

    if (state.chart && state.chart.timeScale()) {
      var _debounceTimer = null;
      function _scheduleRender() {
        _invalidatePaneRect();
        _startRenderLoop();
        _scheduleStop();
        if (_debounceTimer) return;
        _debounceTimer = setTimeout(function () { _debounceTimer = null; _renderAll(); }, 16);
      }
      state.chart.timeScale().subscribeVisibleTimeRangeChange(_scheduleRender);
      state.chart.timeScale().subscribeVisibleLogicalRangeChange(_scheduleRender);
    }

    // Redraw on window resize — DEPRECATED, utilise le ResizeObserver du chart page
    // window.addEventListener('resize', _onWindowResize);
  }

  function _onWindowResize() {
    _resizeCanvas();
    _renderAll();
  }

  function _onTemplateSave() {
    var name = prompt('Nom du template :');
    if (name && saveTemplate(name.trim())) {
      _refreshTemplateList();
      toast('Template "' + name.trim() + '" sauvegardé', 'success');
    }
  }

  function _onTemplateLoad() {
    var sel = document.getElementById('drawTemplateLoad');
    if (!sel || !sel.value) return;
    if (loadTemplate(sel.value)) {
      _refreshTemplateList();
      toast('Template "' + sel.value + '" chargé', 'success');
    }
  }

  function _onTemplateDelete() {
    var sel = document.getElementById('drawTemplateLoad');
    if (!sel || !sel.value) return;
    if (confirm('Supprimer le template "' + sel.value + '" ?')) {
      deleteTemplate(sel.value);
      _refreshTemplateList();
    }
  }

  function _refreshTemplateList() {
    var sel = document.getElementById('drawTemplateLoad');
    if (!sel) return;
    var current = sel.value;
    sel.innerHTML = '<option value="">— Charger un template —</option>';
    var templates = listTemplates();
    templates.forEach(function (t) {
      var opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = t.name + ' (' + t.drawings.length + ' dessins)';
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
  }

  function _onCanvasClick(e) {
    if (state.activeTool === 'cursor') return;
    _readOptionsFromUI();
    var tp = _snapPoint(_toTimePrice(e.clientX, e.clientY), e.clientX);
    if (!tp) return;

    var tool = state.activeTool;
    var isOnePoint = (tool === 'horizontal' || tool === 'horizontalray' || tool === 'vertical' || tool === 'text');

    // If editing an existing drawing, clicking elsewhere deselects
    if (state.selectedIndex >= 0 && state.selectedIndex < state.drawings.length) {
      _deselectDrawing();
      // If user clicked on a different drawing, select that one instead
      var hitIdx = _hitTestIndex(tp.time, tp.price);
      if (hitIdx >= 0 && hitIdx !== state.selectedIndex) {
        _selectDrawing(hitIdx);
        return;
      }
      return;
    }

    // Hit test: clicking on existing drawing enters edit mode
    if (!state.isDrawing) {
      var hitIdx = _hitTestIndex(tp.time, tp.price);
      if (hitIdx >= 0) {
        _selectDrawing(hitIdx);
        return;
      }
    }

    // Otherwise, creation flow
    if (!state.isDrawing) {
      // First click: start drawing
      state.dragStart = { time: tp.time, price: tp.price };
      state.isDrawing = true;
      state.previewPoint = null;
      // For 1-point tools, finalize immediately
      if (isOnePoint) { _finalizeDrawing(tp); }
    } else {
      // Second click: finalize drawing
      _finalizeDrawing(tp);
    }
  }

  function _selectDrawing(idx) {
    if (idx < 0 || idx >= state.drawings.length) return;
    _cancelDrawing();
    state.selectedIndex = idx;
    var d = state.drawings[idx];
    // Sync tool options to match the selected drawing
    state.toolOptions.color = d.color || '#06b6d4';
    state.toolOptions.fillColor = d.fillColor || '#06b6d4';
    state.toolOptions.lineWidth = d.lineWidth || 1.5;
    state.toolOptions.lineStyle = d.lineStyle || 'solid';
    state.toolOptions.opacity = d.opacity !== undefined ? d.opacity : 0.3;
    state.toolOptions.extendLeft = d.extendLeft || false;
    state.toolOptions.extendRight = d.extendRight !== false;
    state.toolOptions.text = d.text || '';
    if (d.fibLevels) {
      Object.keys(state.toolOptions.fibLevels).forEach(function (k) {
        state.toolOptions.fibLevels[k] = d.fibLevels[k] !== false;
      });
    }
    _syncOptionsUI();
    // Forcer l'affichage du panneau d'options meme en mode curseur
    ['drawOptionsPanel', 'drawOptionsPanelWidget'].forEach(function (id) {
      var panel = document.getElementById(id);
      if (panel) panel.classList.remove('hidden');
    });
    // Sync lock button
    _syncLockButton(d);
    _renderAll();
    if (typeof toast === 'function') toast('Dessin sélectionné — modifie les options en direct', 'info');
  }

  function _deselectDrawing() {
    if (state.selectedIndex < 0) return;
    state.selectedIndex = -1;
    _syncOptionsUI();
    // Reset lock button
    var btn = document.getElementById('drawLockToggle');
    if (btn) { btn.textContent = '🔓'; btn.dataset.locked = 'false'; btn.title = 'Verrouiller le dessin (clic traverse vers le chart)'; }
    _renderAll();
  }

  function _finalizeDrawing(tp) {
    if (!state.dragStart) { _cancelDrawing(); return; }
    var p1 = state.dragStart, p2 = { time: tp.time, price: tp.price };
    var tool = state.activeTool, drawing = null;

    switch (tool) {
      case 'box':
        if (p1.time === p2.time && p1.price === p2.price) { _cancelDrawing(); _renderAll(); return; }
        drawing = _createDrawing('box', [p1, p2]);
        break;
      case 'trendline':
        if (p1.time === p2.time && p1.price === p2.price) { _cancelDrawing(); _renderAll(); return; }
        drawing = _createDrawing('trendline', [p1, p2]);
        break;
      case 'horizontal':
        drawing = _createDrawing('horizontal', [p1]);
        break;
      case 'horizontalray':
        drawing = _createDrawing('horizontalray', [p1]);
        break;
      case 'vertical':
        drawing = _createDrawing('vertical', [p1]);
        break;
      case 'fibonacci':
        if (p1.time === p2.time && p1.price === p2.price) { _cancelDrawing(); _renderAll(); return; }
        drawing = _createDrawing('fibonacci', [p1, p2]);
        break;
      case 'text':
        drawing = _createDrawing('text', [p1]);
        break;
    }

    if (drawing) {
      _pushUndoState();
      state.drawings.push(drawing); _saveDrawings();
    }
    _cancelDrawing();
    _renderAll();

    // Auto-exit to cursor mode
    setActiveTool('cursor');
    // Update toolbar button active state
    var toolbar = document.getElementById('drawToolbar');
    if (toolbar) {
      toolbar.querySelectorAll('.draw-toolbar-btn').forEach(function (b) {
        b.classList.toggle('is-active', b.dataset.tool === 'cursor');
      });
    }
    var widgetToolbar = document.getElementById('drawToolbarWidget');
    if (widgetToolbar) {
      widgetToolbar.querySelectorAll('.draw-toolbar-btn').forEach(function (b) {
        b.classList.toggle('is-active', b.dataset.tool === 'cursor');
      });
    }
  }

  function _onMouseMove(e) {
    if (state.isDrawing && state.dragStart) {
      var tp = _snapPoint(_toTimePrice(e.clientX, e.clientY), e.clientX);
      if (tp) { state.previewPoint = { time: tp.time, price: tp.price }; _renderAll(); }
    }
    if (state.activeTool === 'cursor') {
      var tp = _snapPoint(_toTimePrice(e.clientX, e.clientY), e.clientX);
      if (tp && state.canvas) state.canvas.style.cursor = _hitTest(tp.time, tp.price) ? 'pointer' : '';
    }
    // Stocker la position pour le crosshair canvas en mode dessin
    if (state.activeTool !== 'cursor') {
      state._crosshairPos = _clientToPanePoint(e.clientX, e.clientY);
    }
  }

  function _onMouseLeave() { state.previewPoint = null; state._crosshairPos = null; _renderAll(); }

  function _onDblClick(e) {
    if (state.activeTool !== 'cursor') return;
    var tp = _snapPoint(_toTimePrice(e.clientX, e.clientY), e.clientX);
    if (!tp) return;
    var idx = _hitTestIndex(tp.time, tp.price);
    if (idx !== -1) {
      _pushUndoState();
      state.drawings.splice(idx, 1); _saveDrawings(); _renderAll();
    }
  }

  function _cancelDrawing() { state.isDrawing = false; state.dragStart = null; state.previewPoint = null; }

  // ── HIT TEST ──

  function _hitTestIndex(time, price) {
    var threshold = 10;
    var clickPx = _toPixel(time, price);
    if (!clickPx) return -1;
    var cx = clickPx.x, cy = clickPx.y;
    for (var i = state.drawings.length - 1; i >= 0; i--) {
      var d = state.drawings[i];
      if (!d.points || !d.points[0]) continue;

      // Toujours tester les endpoints (points d'extremite)
      for (var p = 0; p < Math.min(d.points.length, 2); p++) {
        var px = _toPixel(d.points[p].time, d.points[p].price);
        if (!px) continue;
        var dist = Math.sqrt((cx - px.x) * (cx - px.x) + (cy - px.y) * (cy - px.y));
        if (dist < threshold) return i;
      }

      // Si locke : seulement les endpoints, pas les segments/aires
      if (d.locked) continue;

      // Hit-test par type (segments de ligne, aires)
      switch (d.type) {
        case 'box':
          // Unlock: integre (tout le rectangle). Lock: seulement endpoints (deja teste plus haut)
          if (!d.locked && d.points.length >= 2) {
            var p1 = _toPixel(d.points[0].time, d.points[0].price);
            var p2 = _toPixel(d.points[1].time, d.points[1].price);
            if (p1 && p2) {
              var bX1 = Math.min(p1.x, p2.x), bY1 = Math.min(p1.y, p2.y);
              var bX2 = Math.max(p1.x, p2.x), bY2 = Math.max(p1.y, p2.y);
              // Marge 10px autour pour le confort
              if (cx >= bX1 - 10 && cx <= bX2 + 10 && cy >= bY1 - 10 && cy <= bY2 + 10) return i;
            }
          }
          break;

        case 'trendline':
          if (d.points.length >= 2) {
            var p1 = _toPixel(d.points[0].time, d.points[0].price);
            var p2 = _toPixel(d.points[1].time, d.points[1].price);
            if (p1 && p2) {
              var cw = state.canvas ? state.canvas.width / (window.devicePixelRatio || 1) : 0;
              var x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
              if (d.extendLeft) { var tL = (0 - x1) / (x2 - x1 || 1); x1 = 0; y1 = y1 + (y2 - y1) * tL; }
              if (d.extendRight) { var tR = (cw - x1) / (x2 - x1 || 1); x2 = cw; y2 = y1 + (y2 - y1) * tR; }
              if (_distToSegment(cx, cy, x1, y1, x2, y2) < threshold) return i;
            }
          }
          break;

        case 'horizontal':
        case 'horizontalray':
          {
            var px = _toPixel(d.points[0].time, d.points[0].price);
            if (px) {
              var cw = state.canvas ? state.canvas.width / (window.devicePixelRatio || 1) : 0;
              var rx1 = d.type === 'horizontal' ? 0 : px.x;
              var rx2 = cw;
              if (Math.abs(cy - px.y) < threshold && cx >= rx1 - threshold && cx <= rx2 + threshold) return i;
            }
          }
          break;

        case 'vertical':
          {
            var px = _toPixel(d.points[0].time, d.points[0].price);
            if (px) {
              var ch = state.canvas ? state.canvas.height / (window.devicePixelRatio || 1) : 0;
              if (Math.abs(cx - px.x) < threshold && cy >= -threshold && cy <= ch + threshold) return i;
            }
          }
          break;

        case 'fibonacci':
          if (d.points.length >= 2) {
            var p1 = _toPixel(d.points[0].time, d.points[0].price);
            var p2 = _toPixel(d.points[1].time, d.points[1].price);
            if (p1 && p2) {
              if (_distToSegment(cx, cy, p1.x, p1.y, p2.x, p2.y) < threshold) return i;
              var price1 = d.points[0].price, price2 = d.points[1].price, diff = price2 - price1;
              var fibKeys = d.fibLevels || {};
              for (var f = 0; f < FIB_LEVELS.length; f++) {
                var l = FIB_LEVELS[f];
                if (fibKeys[l.key] === false) continue;
                var fPrice = price1 + diff * l.key;
                var fp = _toPixel(d.points[0].time, fPrice);
                if (!fp) continue;
                if (Math.abs(cy - fp.y) < threshold) return i;
              }
            }
          }
          break;

        case 'text':
          // Deja teste via endpoints (un seul point)
          break;
      }
    }
    return -1;
  }

  // Distance d'un point (px,py) a un segment (x1,y1)-(x2,y2)
  function _distToSegment(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
    var t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    var nearX = x1 + t * dx, nearY = y1 + t * dy;
    return Math.sqrt((px - nearX) * (px - nearX) + (py - nearY) * (py - nearY));
  }

  // ── RENDER ──

  function _renderAll() {
    var ctx = state.ctx; if (!ctx || !state.canvas) return;

    // Clear en repere bitmap (pas CSS) pour eviter les artefacts Retina
    var dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    _renderSessions();
    for (var i = 0; i < state.drawings.length; i++) { _renderDrawing(state.drawings[i], i); _drawSelectionIndicators(state.drawings[i], i); _drawLockIcon(state.drawings[i], i); _drawLockedDots(state.drawings[i], i); }
    if (state.dragStart && state.previewPoint && state.activeTool !== 'cursor') {
      _renderPreview(state.activeTool, state.dragStart, state.previewPoint);
    }
    // Crosshair en mode dessin : lignes horizontale + verticale
    if (state.activeTool !== 'cursor' && state._crosshairPos) {
      _renderCrosshair(state._crosshairPos);
    }
  }

  function _drawSelectionIndicators(d, index) {
    if (index !== state.selectedIndex || !d.points) return;
    var ctx = state.ctx;
    ctx.save();
    for (var p = 0; p < d.points.length; p++) {
      var px = _toPixel(d.points[p].time, d.points[p].price);
      if (!px) continue;
      // Outer glow ring
      ctx.beginPath(); ctx.arc(px.x, px.y, 6, 0, Math.PI * 2);
      ctx.strokeStyle = '#06b6d4'; ctx.lineWidth = 2;
      ctx.shadowColor = '#06b6d4'; ctx.shadowBlur = 8;
      ctx.stroke();
      // Inner dot
      ctx.beginPath(); ctx.arc(px.x, px.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#06b6d4'; ctx.fill();
    }
    ctx.restore();
  }

  function _drawLockIcon(d, index) {
    if (!d.locked || !d.points || !d.points[0]) return;
    var px = _toPixel(d.points[0].time, d.points[0].price);
    if (!px) return;
    var ctx = state.ctx;
    ctx.save();
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#f59e0b';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4;
    ctx.fillText('🔒', px.x, px.y - 8);
    ctx.restore();
  }

  // Points d'extremite visibles pour les dessins lockes (pour pouvoir les selectionner)
  function _drawLockedDots(d, index) {
    if (!d.locked || !d.points) return;
    if (index === state.selectedIndex) return; // deja dessine par _drawSelectionIndicators
    var ctx = state.ctx;
    ctx.save();
    for (var p = 0; p < Math.min(d.points.length, 2); p++) {
      var px = _toPixel(d.points[p].time, d.points[p].price);
      if (!px) continue;
      ctx.beginPath(); ctx.arc(px.x, px.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = d.color || '#06b6d4';
      ctx.globalAlpha = 0.5;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function _renderDrawing(d, index) {
    switch (d.type) {
      case 'box':          _drawBox(d.points, d, index); break;
      case 'trendline':    _drawLine(d.points, d, index); break;
      case 'horizontal':   _drawHorizLine(d.points[0], d, index); break;
      case 'horizontalray':_drawHorizRay(d.points[0], d, index); break;
      case 'vertical':     _drawVertLine(d.points[0], d, index); break;
      case 'fibonacci':    _drawFibonacci(d, index); break;
      case 'text':         _drawText(d.points[0], d, index); break;
    }
  }

  function _renderPreview(tool, p1, p2) {
    var o = state.toolOptions;
    var pd = { color: o.color, fillColor: o.fillColor, lineWidth: 1, lineStyle: 'dashed', opacity: o.opacity, text: o.text, fibLevels: o.fibLevels };
    switch (tool) {
      case 'box':          _drawBox([p1, p2], pd); break;
      case 'trendline':    _drawLine([p1, p2], pd); break;
      case 'horizontal':   _drawHorizLine(p1, pd); break;
      case 'horizontalray':_drawHorizRay(p1, pd); break;
      case 'vertical':     _drawVertLine(p1, pd); break;
      case 'fibonacci':    _drawFibonacci({ points: [p1, p2], color: o.color, fibLevels: o.fibLevels }); break;
      case 'text':         _drawText(p1, pd); break;
    }
  }

  // ── CROSSHAIR CANVAS (mode dessin) ──

  function _renderCrosshair(pos) {
    var ctx = state.ctx;
    if (!ctx || !state.canvas) return;
    var dpr = window.devicePixelRatio || 1;
    var w = state.canvas.width / dpr;
    var h = state.canvas.height / dpr;
    var px = pos.x;
    var py = pos.y;

    ctx.save();
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    // Ligne verticale
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();

    // Ligne horizontale
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(w, py);
    ctx.stroke();

    ctx.restore();
  }

  // ── SESSION ZONES ──

  function _renderSessions() {
    var ctx = state.ctx;
    if (!ctx || !state.chart || !state.sessions || !state.sessions.length) return;

    var visibleRange = state.chart.timeScale().getVisibleRange();
    if (!visibleRange || !visibleRange.from || !visibleRange.to) return;

    var from = visibleRange.from; // seconds
    var to = visibleRange.to;

    var ch;
    try { ch = state.canvas.height / (window.devicePixelRatio || 1); } catch(e) { return; }
    if (!ch) return;

    // Day boundaries: floor/ceil to UTC midnight
    var dayStart = Math.floor(from / 86400) * 86400;
    var dayEnd = Math.ceil(to / 86400) * 86400;

    ctx.save();
    ctx.textBaseline = 'top';
    ctx.font = '9px "JetBrains Mono", monospace';

    for (var s = 0; s < state.sessions.length; s++) {
      var session = state.sessions[s];
      if (!session.active) continue;

      for (var t = dayStart; t < dayEnd; t += 86400) {
        // Convertir les horaires locaux en UTC pour ce jour précis
        var range = _getSessionUtcRangeForChartDay(t, session);

        // Clip to visible range
        var clipStart = Math.max(range.startUtcSeconds, from);
        var clipEnd = Math.min(range.endUtcSeconds, to);
        if (clipStart >= clipEnd) continue;

        var x1 = state.chart.timeScale().timeToCoordinate(clipStart);
        var x2 = state.chart.timeScale().timeToCoordinate(clipEnd);
        if (x1 == null || x2 == null || x2 - x1 < 2) continue;

        // Draw fill
        ctx.globalAlpha = parseFloat(session.opacity) || 0.12;
        ctx.fillStyle = session.color;
        ctx.fillRect(x1, 0, x2 - x1, ch);
        ctx.globalAlpha = 1;

        // Draw label at top-left of zone
        ctx.fillStyle = session.color;
        ctx.textAlign = 'left';
        ctx.fillText(session.name, x1 + 3, 3);

        // Thin line at session start
        ctx.strokeStyle = session.color;
        ctx.lineWidth = 0.5;
        ctx.globalAlpha = 0.25;
        ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1, ch); ctx.stroke();

        // Thin line at session end
        ctx.beginPath(); ctx.moveTo(x2, 0); ctx.lineTo(x2, ch); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    ctx.restore();
  }

  // ── / SESSION ZONES

  // ── DRAWING PRIMITIVES ──

  function _getDash(style) { for (var i = 0; i < LINE_STYLES.length; i++) { if (LINE_STYLES[i].id === style) return LINE_STYLES[i].dash; } return []; }
  function _getAlpha(d) { var a = parseFloat(d.opacity); return (a >= 0 && a <= 1) ? a : 0.3; }

  function _drawBox(points, d, index) {
    if (points.length < 2) return;
    var ctx = state.ctx;
    var p1 = _toPixel(points[0].time, points[0].price);
    var p2 = _toPixel(points[1].time, points[1].price);
    if (!p1 || !p2) return;

    var x = Math.min(p1.x, p2.x), y = Math.min(p1.y, p2.y);
    var w = Math.abs(p2.x - p1.x), h = Math.abs(p2.y - p1.y);

    ctx.save();
    // Fill
    ctx.globalAlpha = _getAlpha(d);
    ctx.fillStyle = d.fillColor || d.color;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    // Border
    ctx.strokeStyle = d.color;
    ctx.lineWidth = d.lineWidth || 1.5;
    ctx.setLineDash(_getDash(d.lineStyle));
    ctx.strokeRect(x, y, w, h);
    // Dots (seulement si selectionne)
    if (index === state.selectedIndex) {
      _drawDot(p1.x, p1.y, d.color);
      _drawDot(p2.x, p2.y, d.color);
    }
    // Label
    if (d.text) _drawLabel(p2.x + 6, p1.y - 4, d.text, d.color);
    ctx.restore();
  }

  function _drawLine(points, d, index) {
    if (points.length < 2) return;
    var ctx = state.ctx;
    var p1 = _toPixel(points[0].time, points[0].price);
    var p2 = _toPixel(points[1].time, points[1].price);
    if (!p1 || !p2) return;
    var cw = state.canvas.width / (window.devicePixelRatio || 1);

    ctx.save();
    ctx.globalAlpha = _getAlpha(d);
    ctx.strokeStyle = d.color;
    ctx.lineWidth = d.lineWidth || 1.5;
    ctx.setLineDash(_getDash(d.lineStyle));

    var x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
    if (d.extendLeft || d.extendRight) {
      var dx = x2 - x1, dy = y2 - y1;
      if (dx !== 0) {
        if (d.extendLeft) { var tL = (0 - x1) / dx; x1 = 0; y1 = y1 + dy * tL; }
        if (d.extendRight) { var tR = (cw - x1) / dx; x2 = cw; y2 = y1 + dy * tR; }
      }
    }

    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.globalAlpha = 1;
    if (index === state.selectedIndex) {
      _drawDot(p1.x, p1.y, d.color); _drawDot(p2.x, p2.y, d.color);
    }
    if (d.text) _drawLabel(p2.x + 6, p2.y - 6, d.text, d.color);
    ctx.restore();
  }

  function _drawHorizLine(point, d) {
    var ctx = state.ctx;
    var px = _toPixel(point.time, point.price);
    if (!px) return;
    var cw = state.canvas.width / (window.devicePixelRatio || 1);
    ctx.save();
    ctx.globalAlpha = _getAlpha(d);
    ctx.strokeStyle = d.color; ctx.lineWidth = d.lineWidth || 1.5;
    ctx.setLineDash(_getDash(d.lineStyle));
    ctx.beginPath(); ctx.moveTo(0, px.y); ctx.lineTo(cw, px.y); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = d.color;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(point.price.toFixed(2), 4, px.y - 4);
    if (d.text) { ctx.textAlign = 'right'; ctx.fillText(d.text, cw - 4, px.y - 4); }
    ctx.restore();
  }

  function _drawHorizRay(point, d, index) {
    var ctx = state.ctx;
    var px = _toPixel(point.time, point.price);
    if (!px) return;
    var cw = state.canvas.width / (window.devicePixelRatio || 1);
    ctx.save();
    ctx.globalAlpha = _getAlpha(d);
    ctx.strokeStyle = d.color; ctx.lineWidth = d.lineWidth || 1.5;
    ctx.setLineDash(_getDash(d.lineStyle));
    ctx.beginPath(); ctx.moveTo(px.x, px.y); ctx.lineTo(cw, px.y); ctx.stroke();
    ctx.globalAlpha = 1;
    var as = 8; ctx.beginPath(); ctx.moveTo(cw, px.y); ctx.lineTo(cw - as, px.y - as / 2); ctx.lineTo(cw - as, px.y + as / 2); ctx.closePath(); ctx.fillStyle = d.color; ctx.fill();
    ctx.fillStyle = d.color;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(point.price.toFixed(2), px.x + 6, px.y - 6);
    if (d.text) ctx.fillText(d.text, px.x + 6, px.y + 14);
    if (index === state.selectedIndex) _drawDot(px.x, px.y, d.color);
    ctx.restore();
  }

  function _drawVertLine(point, d, index) {
    var ctx = state.ctx;
    var px = _toPixel(point.time, point.price);
    if (!px) return;
    var ch = state.canvas.height / (window.devicePixelRatio || 1);
    ctx.save();
    ctx.globalAlpha = _getAlpha(d);
    ctx.strokeStyle = d.color; ctx.lineWidth = d.lineWidth || 1.5;
    ctx.setLineDash(_getDash(d.lineStyle));
    ctx.beginPath(); ctx.moveTo(px.x, 0); ctx.lineTo(px.x, ch); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = d.color; ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(d.text || '', px.x, ch - 4);
    if (index === state.selectedIndex) _drawDot(px.x, 0, d.color);
    ctx.restore();
  }

  function _drawFibonacci(d, index) {
    var points = d.points;
    if (points.length < 2) return;
    var ctx = state.ctx;
    var p1 = _toPixel(points[0].time, points[0].price);
    var p2 = _toPixel(points[1].time, points[1].price);
    if (!p1 || !p2) return;

    var price1 = points[0].price, price2 = points[1].price, diff = price2 - price1;
    var vis = d.fibLevels || {};

    ctx.save();
    ctx.globalAlpha = _getAlpha(d);
    ctx.strokeStyle = d.color; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    ctx.globalAlpha = 1;

    var cw = state.canvas.width / (window.devicePixelRatio || 1);
    var minX = Math.max(0, Math.min(p1.x, p2.x) - 30);
    var maxX = Math.min(cw, Math.max(p1.x, p2.x) + 30);

    for (var i = 0; i < FIB_LEVELS.length; i++) {
      var l = FIB_LEVELS[i];
      if (vis[l.key] === false) continue;
      var price = price1 + diff * l.key;
      var py = _toPixel(points[0].time, price);
      if (!py) continue;
      ctx.save();
      ctx.strokeStyle = l.color; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(minX, py.y); ctx.lineTo(maxX, py.y); ctx.stroke();
      ctx.fillStyle = l.color; ctx.font = '9px "JetBrains Mono", monospace';
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(l.label + '% (' + price.toFixed(2) + ')', maxX - 2, py.y);
      ctx.restore();
    }

    if (index === state.selectedIndex) {
      _drawDot(p1.x, p1.y, d.color); _drawDot(p2.x, p2.y, d.color);
    }
    ctx.restore();
  }

  function _drawText(point, d, index) {
    var ctx = state.ctx;
    var px = _toPixel(point.time, point.price);
    if (!px) return;
    ctx.save();
    ctx.globalAlpha = _getAlpha(d);
    ctx.fillStyle = d.color;
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(d.text || 'Texte', px.x + 6, px.y - 6);
    ctx.globalAlpha = 1;
    if (index === state.selectedIndex) _drawDot(px.x, px.y, d.color);
    ctx.restore();
  }

  function _drawLabel(x, y, txt, color) {
    var ctx = state.ctx;
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(txt, x, y);
    ctx.restore();
  }

  function _drawDot(x, y, color) {
    var ctx = state.ctx; if (!ctx) return;
    ctx.save(); ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ── CLEAR ──

  function clearAllDrawings() {
    _pushUndoState();
    state.drawings = []; _saveDrawings(); _renderAll();
  }

  // ── EXPOSED API ──

  window.ChartDrawings = {
    init: initDrawings, destroy: destroyDrawings,
    setTool: setActiveTool, getTool: getActiveTool,
    clearAll: clearAllDrawings, undo: undo, tools: DRAW_TOOLS,
    saveTemplate: saveTemplate, loadTemplate: loadTemplate,
    listTemplates: listTemplates, deleteTemplate: deleteTemplate,
    getDrawings: function () { return state.drawings.slice(); },
    onResize: function () { _resizeCanvas(); _renderAll(); },
    setSnapEnabled: function (v) { state.snapEnabled = !!v; },
    getSnapEnabled: function () { return state.snapEnabled; },
    // Session zones
    getSessionSettings: getSessionSettings,
    updateSessions: updateSessions,
  };

})();
