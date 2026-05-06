// ---------- Orderflow Engine v0.1 — Canvas 2D Custom ----------
// Phase 1 : squelette moteur — axes, grille, zoom, pan, crosshair
// Aucune dépendance à Lightweight Charts ou à la page Chart classique

/**
 * @typedef {Object} OFPoint
 * @property {number} x - pixel
 * @property {number} y - pixel
 */

/**
 * @typedef {Object} PriceScale
 * @property {number} minPrice
 * @property {number} maxPrice
 * @property {number} height
 * @property {number} topMargin
 * @property {number} bottomMargin
 * @property {number} pixelsPerUnit
 */

/**
 * @typedef {Object} TimeScale
 * @property {number} startTime
 * @property {number} endTime
 * @property {number} width
 * @property {number} leftMargin
 * @property {number} rightMargin
 * @property {number} pixelsPerMs
 */

(function () {
  'use strict';

  // ============================================================
  // OrderflowEngine — classe principale, boucle rAF
  // ============================================================

  var OF = window.OF = window.OF || {};

  function OrderflowEngine(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) throw new Error('Canvas #' + canvasId + ' not found');
    this.ctx = this.canvas.getContext('2d');

    // Scales
    this.priceScale = {
      minPrice: 60000,
      maxPrice: 75000,
      height: 1,
      topMargin: 30,
      bottomMargin: 40,
      get pixelsPerUnit() { return (this.height - this.topMargin - this.bottomMargin) / (this.maxPrice - this.minPrice); }
    };

    this.timeScale = {
      startTime: Date.now() - 24 * 60 * 60 * 1000,
      endTime: Date.now(),
      width: 1,
      leftMargin: 10,
      rightMargin: 10,
      get pixelsPerMs() { return (this.width - this.leftMargin - this.rightMargin) / (this.endTime - this.startTime); }
    };

    // Scroll / zoom state
    this.dpr = 1;
    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.scrollStart = { x: 0, y: 0 };
    this.mousePos = { x: 0, y: 0 };
    this.inCanvas = false;

    // Indicateur de dirty — on ne redraw que si nécessaire
    this._dirty = true;

    // Viewport controller — centralise toutes les mutations de la vue
    this.viewport = new OF.ViewportController(this);

    // Dernières dimensions connues (pour détecter les changements)
    this._lastW = 0;
    this._lastH = 0;

    // Binding des events
    this._bindEvents();

    // Candles data
    this._candles = [];
    this._rawTrades = [];
    this._klinesCandles = [];  // Bougies OHLC de base (depuis klines)
    this._footprintMap = {};   // Footprint indexé par candleTime (depuis aggTrades)
    this._marketState = null;  // Contrat data unifie (066b_orderflow_data.js)
    this._isLiveData = false;
    this._loading = false;
    this._error = null;
    this._symbol = 'BTCUSDT';
    this._interval = '3m';
    this._tickSize = 10;
    this._intervalMs = 180000;
    this._footprintWindowMs = 900000; // 15m
    this._coverageInfo = "";
    this._currentRange = null; // {start, end} du dernier fetch
    this._requestedRangeMs = 7200000; // 2h par defaut (3m → ~40 bougies)
    this._rangeUserOverridden = false;
    this._fetchTimestamp = null;
    // Steps config par symbole
    this._stepsConfig = {
      BTCUSDT: { steps: [5, 10, 25, 50], default: 10, label: '$' },
      ETHUSDT: { steps: [1, 2, 5, 10], default: 2, label: '$' },
      SOLUSDT: { steps: [0.05, 0.10, 0.25, 0.50], default: 0.10, label: '$' },
    };

    // Layout zones (mise a jour a chaque resize)
    this.layout = {
      topMargin: 30,
      bottomMargin: 40,
      priceAxisWidth: 64,
      vpWidth: 120,
      chartLeft: 10,
      chartRight: 0,
      chartWidth: 0,
    };

    // Live WebSocket
    this._liveEnabled = true;
    this._liveStatus = 'disconnected';
    this._lastHistoricalTradeId = 0;
    this._liveTradesCount = 0;

    // Request counter pour annuler les vieux fetchs
    this._loadRequestId = 0;

    // Anti-doublon live: ensemble borné des IDs déjà vus
    this._seenLiveIds = {};
    this._seenLiveIdsQueue = [];

    // Buffer live trades (flush toutes les 150ms)
    this._liveBuffer = [];
    this._liveFlushTimer = null;
    this._lastTrimAt = 0;

    // rAF handle pour pouvoir stop/start
    this._rafId = null;
    this._running = false;

    // Statut
    this._setStatus('ready');
    console.log('[OrderflowEngine] initialized');

    // Load mock data
    this._loadMockData();
    this._updateStepButtons(this._symbol);
  }

  OrderflowEngine.prototype._setStatus = function (msg) {
    var el = document.getElementById('ofStatus');
    if (el) {
      el.textContent = msg;
      el.classList.toggle('status-live', this._liveStatus === 'connected');
      el.classList.toggle('status-mock', !this._isLiveData && !this._loading && !this._error && this._liveStatus === 'disconnected');
      el.classList.toggle('status-error', !!this._error || this._liveStatus === 'error');
      el.classList.toggle('status-loading', this._loading);
      el.classList.toggle('status-reconnecting', this._liveStatus === 'reconnecting');
      el.classList.toggle('status-live-off', !this._liveEnabled);
      el.classList.toggle('status-partial', !!this._partialData);
    }
  };

  // ============================================================
  // Resize
  // ============================================================

  OrderflowEngine.prototype._handleResize = function () {
    var rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    var w = rect.width;
    var h = rect.height;

    // Mettre à jour les dimensions du canvas (logique)
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;

    // Mettre à jour les scales
    this.priceScale.height = h;
    this.timeScale.width = w;

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this._dirty = true;

    // Mettre a jour le layout — définir une zone chart claire
    var lay = this.layout;
    lay.topMargin = 30;
    lay.bottomMargin = 40;
    lay.priceAxisWidth = 64;
    lay.vpWidth = 120;
    lay.chartLeft = 10;
    lay.chartRight = Math.max(lay.chartLeft + 100, w - lay.priceAxisWidth - lay.vpWidth - 15);
    lay.chartWidth = Math.max(100, lay.chartRight - lay.chartLeft);
  };

  // ============================================================
  // Events
  // ============================================================

  OrderflowEngine.prototype._bindEvents = function () {
    var self = this;
    var c = this.canvas;

    // ===== WHEEL / TRACKPAD =====
    c.addEventListener('wheel', function (e) {
      e.preventDefault();

      // Ctrl+Wheel = zoom global (temps + prix)
      if (e.ctrlKey || e.metaKey) {
        self.viewport.zoomGlobal(e.offsetY, e.deltaY < 0 ? 0.92 : 1.08, 'ctrl-wheel-global');
        return;
      }

      // Sur l'axe prix : wheel vertical = zoom prix uniquement
      var inPriceAxis = e.offsetX > self.layout.chartRight;
      if (inPriceAxis && e.deltaY !== 0) {
        self.viewport.zoomPrice(e.offsetY, e.deltaY < 0 ? 1.08 : 0.92, 'price-axis-wheel');
        return;
      }

      // Dans la zone chart : wheel vertical = zoom temps uniquement
      if (e.deltaY !== 0) {
        self.viewport.zoomTime(e.deltaY < 0 ? 0.92 : 1.08, 'chart-wheel-time', e.offsetX);
        return;
      }

      // Wheel horizontal / trackpad lateral = scroll temps
      if (e.deltaX !== 0) {
        self.viewport.scrollTime(e.deltaX > 0 ? 1 : -1, Math.abs(e.deltaX) * 0.8, 'wheel-h');
      }
    }, { passive: false });

    // ===== POINTER EVENTS =====
    self._dragThreshold = 4; // px
    self._isPointerDown = false;
    self._hasMoved = false;

    c.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      c.setPointerCapture(e.pointerId);
      self._isPointerDown = true;
      self._hasMoved = false;
      self.dragStart.x = e.offsetX;
      self.dragStart.y = e.offsetY;
      self.scrollStart.time = self.timeScale.startTime;
      self.scrollStart.timeEnd = self.timeScale.endTime;
      self.scrollStart.pixelsPerMs = self.timeScale.pixelsPerMs;
      self.scrollStart.priceMin = self.priceScale.minPrice;
      self.scrollStart.priceMax = self.priceScale.maxPrice;
      self.scrollStart.pixelsPerPrice = self.priceScale.pixelsPerUnit;
      c.style.cursor = 'grabbing';
    });

    c.addEventListener('pointermove', function (e) {
      self.mousePos.x = e.offsetX;
      self.mousePos.y = e.offsetY;
      self.inCanvas = true;

      if (self._isPointerDown) {
        var dx = e.offsetX - self.dragStart.x;
        var dy = e.offsetY - self.dragStart.y;
        if (Math.sqrt(dx * dx + dy * dy) < self._dragThreshold) return;

        self._hasMoved = true;
        // Shift+Drag vertical = zoom prix
        if (e.shiftKey) {
          var factor = dy < 0 ? 1.05 : 0.95;
          self.viewport.zoomPrice(e.offsetY, factor, 'shift-drag-price-zoom');
        }
        // Drag dans la zone chart = pan temps uniquement (via snapshots)
        else if (!(e.offsetX > self.layout.chartRight)) {
          self.viewport._touch('drag-time');
          var dt = -dx / self.scrollStart.pixelsPerMs;
          self.viewport.applyTimeRange(
            self.scrollStart.time + dt,
            self.scrollStart.timeEnd + dt
          );
        }
        // Drag sur l'axe prix = ZOOM prix (rétrécir/agrandir le range vertical)
        else {
          self.viewport._touch('drag-price-zoom');
          // dy > 0 (drag bas) → zoom out, dy < 0 (drag haut) → zoom in
          var factor = 1 + dy * 0.003;
          factor = Math.max(0.5, Math.min(2, factor));
          self.viewport.zoomPrice(e.offsetY, factor, 'price-axis-drag');
        }
      } else {
        self._dirty = true;
        c.style.cursor = e.offsetX > self.layout.chartRight ? 'row-resize' : 'grab';
      }
    });

    c.addEventListener('pointerup', function (e) {
      c.releasePointerCapture(e.pointerId);
      self._isPointerDown = false;
      self._hasMoved = false;
      c.style.cursor = 'grab';
      self._dirty = true;
    });

    // lostpointercapture = capture perdue (clic hors canvas, perte focus)
    // Garantit que _isPointerDown ne reste pas bloqué à true
    c.addEventListener('lostpointercapture', function () {
      self._isPointerDown = false;
      self._hasMoved = false;
      c.style.cursor = self.inCanvas ? 'grab' : 'default';
      self._dirty = true;
    });

    c.addEventListener('pointerleave', function () {
      self.inCanvas = false;
      self._isPointerDown = false;
      self._hasMoved = false;
      c.style.cursor = 'default';
      self._dirty = true;
    });

    // Double-click — reset zoom
    c.addEventListener('dblclick', function () {
      self.viewport.reset('dblclick');
    });

    // Resize
    window.addEventListener('resize', function () {
      self._handleResize();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', self._onKeyDown.bind(self));

    // Symbol buttons
    self._bindTopbarClicks();
  };

  /** Hotkeys: Space=reset, H=centrer temps, P=centrer prix, +/-=zoom, I/O=zoom, Arrow keys=scroll fin */
  OrderflowEngine.prototype._onKeyDown = function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (!document.querySelector('.page[data-page="orderflow"].active')) return;

    var k = e.key.toLowerCase();
    var handled = false;
    var vp = this.viewport;
    var centerY = this.canvas ? (this.canvas.height / 2 / (this.dpr || 1)) : 0;

    // Space/Enter = reset vue complète
    if (k === ' ' || k === 'enter') {
      vp.reset('key-space');
      handled = true;
    }
    // H = fit temps (centrer sur les bougies)
    else if (k === 'h') {
      vp.fitTime('key-h');
      handled = true;
    }
    // P = fit prix
    else if (k === 'p') {
      vp.fitPrice('key-p', 0.15);
      handled = true;
    }
    // +/= = zoom prix IN
    else if (k === '+' || k === '=') {
      vp.zoomPrice(centerY, 1.12, 'key-plus');
      handled = true;
    }
    // -/_ = zoom prix OUT
    else if (k === '-' || k === '_') {
      vp.zoomPrice(centerY, 0.89, 'key-minus');
      handled = true;
    }
    // I = zoom IN prix
    else if (k === 'i') {
      vp.zoomPrice(centerY, 1.15, 'key-i');
      handled = true;
    }
    // O = zoom OUT prix
    else if (k === 'o') {
      vp.zoomPrice(centerY, 0.87, 'key-o');
      handled = true;
    }
    // R = reset complet (vue par défaut)
    else if (k === 'r') {
      vp.reset('key-r');
      handled = true;
    }
    // Arrow keys = scroll temps
    else if (k === 'arrowleft') {
      var dt = -(this.timeScale.endTime - this.timeScale.startTime) * 0.05;
      vp.nudgeTime(dt, 'key-left');
      handled = true;
    } else if (k === 'arrowright') {
      var dt = (this.timeScale.endTime - this.timeScale.startTime) * 0.05;
      vp.nudgeTime(dt, 'key-right');
      handled = true;
    }
    // Arrow up/down = pan prix
    else if (k === 'arrowup') {
      var dp = (this.priceScale.maxPrice - this.priceScale.minPrice) * 0.02;
      vp.nudgePrice(-dp, 'key-up');
      handled = true;
    } else if (k === 'arrowdown') {
      var dp = (this.priceScale.maxPrice - this.priceScale.minPrice) * 0.02;
      vp.nudgePrice(dp, 'key-down');
      handled = true;
    }

    if (handled) {
      e.preventDefault();
    }
  };

  /** Bind clicks on topbar symbol/timeframe buttons (avec debounce) */
  OrderflowEngine.prototype._bindTopbarClicks = function () {
    var self = this;
    var pairBtns = document.querySelectorAll('.of-pair-btn');
    var tfBtns = document.querySelectorAll('.of-tf-btn');

    pairBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var symbol = this.dataset.symbol;
        if (symbol === self._symbol) return;
        pairBtns.forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        self._symbol = symbol;
        // Mettre a jour les boutons step pour ce symbole
        self._updateStepButtons(symbol);
        if (self._loadTimer) clearTimeout(self._loadTimer);
        self._loadTimer = setTimeout(function () {
          self._tickSize = self._stepsConfig[symbol] ? self._stepsConfig[symbol].default : 10;
          self.loadData(self._symbol, self._interval);
        }, 200);
      });
    });

    tfBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var interval = this.dataset.interval;
        if (interval === self._interval) return;
        tfBtns.forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        // NE PAS toucher self._interval ici — setInterval() est le seul propriétaire
        if (self._loadTimer) clearTimeout(self._loadTimer);
        self._loadTimer = setTimeout(function () {
          self.setInterval(interval, { source: 'timeframe-button', resetView: true });
        }, 200);
      });
    });

    // Price step buttons
    var stepBtns = document.querySelectorAll('.of-step-btn');
    stepBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var step = Number(this.dataset.step);
        if (step === self._tickSize) return;
        stepBtns.forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        self.setTickSize(step);
      });
    });

    // Range buttons
    var rangeBtns = document.querySelectorAll('.of-range-btn');
    var autoBtn = document.getElementById('ofAutoRange');

    rangeBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        // Auto button est clicke separement
        if (this.id === 'ofAutoRange') return;
        var rangeMs = Number(this.dataset.range);
        if (rangeMs === self._requestedRangeMs && !self._rangeUserOverridden) return;
        // Desactiver Auto
        self._rangeUserOverridden = true;
        if (autoBtn) autoBtn.classList.remove('active');
        rangeBtns.forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        if (self._loadTimer) clearTimeout(self._loadTimer);
        self._loadTimer = setTimeout(function () { self.setRange(rangeMs); }, 200);
      });
    });

    // Auto range button
    if (autoBtn) {
      autoBtn.addEventListener('click', function () {
        self._rangeUserOverridden = false;
        rangeBtns.forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        self.setAutoRange();
      });
    }

    // Reload button
    var reloadBtn = document.getElementById('ofReloadBtn');
    if (reloadBtn) {
      reloadBtn.addEventListener('click', function () {
        this.classList.add('loading');
        var orig = this.textContent;
        this.textContent = '⟳';
        self.reload();
        setTimeout(function () {
          reloadBtn.textContent = orig;
          reloadBtn.classList.remove('loading');
        }, 1500);
      });
    }

    // Live toggle button
    var liveBtn = document.getElementById('ofLiveBtn');
    if (liveBtn) {
      liveBtn.addEventListener('click', function () {
        self._liveEnabled = !self._liveEnabled;
        this.classList.toggle('active', self._liveEnabled);
        this.textContent = self._liveEnabled ? 'Live' : 'Off';
        if (self._liveEnabled) {
          self._connectLive();
        } else {
          self._disconnectLive();
        }
        self._setStatus(self._buildStatus());
      });
    }

    // Fit price button
    var fitBtn = document.getElementById('ofFitBtn');
    if (fitBtn) {
      fitBtn.addEventListener('click', function () {
        if (self._candles.length === 0) return;
        self.viewport.fitPrice('fit-btn', 0.05);
        self._setStatus(self._buildStatus());
      });
    }

    // Reset view button
    var resetBtn = document.getElementById('ofResetBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        self.viewport.reset('reset-btn');
      });
    }
  };

  // ============================================================
  // Transformations
  // ============================================================

  /**
   * Convertir un prix en pixel Y
   * @param {number} price
   * @returns {number}
   */
  OrderflowEngine.prototype.priceToY = function (price) {
    var ps = this.priceScale;
    return ps.topMargin + (ps.maxPrice - price) * ps.pixelsPerUnit;
  };

  /**
   * Convertir un pixel Y en prix
   * @param {number} y
   * @returns {number}
   */
  OrderflowEngine.prototype.yToPrice = function (y) {
    var ps = this.priceScale;
    return ps.maxPrice - (y - ps.topMargin) / ps.pixelsPerUnit;
  };

  /**
   * Convertir un timestamp en pixel X
   * @param {number} time - timestamp ms
   * @returns {number}
   */
  OrderflowEngine.prototype.timeToX = function (time) {
    var ts = this.timeScale;
    return ts.leftMargin + (time - ts.startTime) * ts.pixelsPerMs;
  };

  /**
   * Convertir un pixel X en timestamp
   * @param {number} x
   * @returns {number}
   */
  OrderflowEngine.prototype.xToTime = function (x) {
    var ts = this.timeScale;
    return ts.startTime + (x - ts.leftMargin) / ts.pixelsPerMs;
  };

  // ============================================================
  // Zoom / Pan / Scroll
  // ============================================================

  /**
   * Zoom vertical (prix seulement) centré sur un pixel Y
   * @param {number} y - centre du zoom en pixels
   * @param {number} factor - >1 zoom in, <1 zoom out
   */
  OrderflowEngine.prototype._zoomPrice = function (y, factor) {
    var ps = this.priceScale;
    var centerPrice = this.yToPrice(y);
    var range = ps.maxPrice - ps.minPrice;
    var newRange = range * (1 / factor);

    // Limiter le zoom
    if (newRange < 10) newRange = 10;   // ~$10 minimum
    if (newRange > 100000) newRange = 100000; // ~$100k maximum

    var nextMin = centerPrice - (centerPrice - ps.minPrice) * (newRange / range);
    var nextMax = nextMin + newRange;
    this.viewport.applyPriceRange(nextMin, nextMax);
  };

  /**
   * Zoom global (prix + temps ensemble) — comme pincher une carte
   * Les deux axes zooment proportionnellement autour du point central
   * @param {number} y - centre vertical du zoom en pixels
   * @param {number} factor - >1 zoom in, <1 zoom out
   */
  OrderflowEngine.prototype._zoomGlobal = function (y, factor) {
    var ts = this.timeScale;
    var ps = this.priceScale;

    // === ZOOM PRIX ===
    var centerPrice = this.yToPrice(y);
    var priceRange = ps.maxPrice - ps.minPrice;
    var newPriceRange = priceRange * (1 / factor);

    if (newPriceRange < 10) newPriceRange = 10;
    if (newPriceRange > 100000) newPriceRange = 100000;

    var nextMin = centerPrice - (centerPrice - ps.minPrice) * (newPriceRange / priceRange);
    var nextMax = nextMin + newPriceRange;
    this.viewport.applyPriceRange(nextMin, nextMax);

    // === ZOOM TEMPS (proportionnel) ===
    // Zoom centré sur le milieu du temps visible
    var timeRange = ts.endTime - ts.startTime;
    var newTimeRange = timeRange * (1 / factor);
    var midTime = ts.startTime + timeRange / 2;

    var nextStart = midTime - newTimeRange / 2;
    this.viewport.applyTimeRange(nextStart, nextStart + newTimeRange);
  };

  /**
   * Pan libre : déplacement temps (X) + prix (Y) simultanément
   */
  OrderflowEngine.prototype._pan = function (dx, dy) {
    // Horizontal = déplacement temps (range constant, utilise snapshot)
    var dt = -dx / this.scrollStart.pixelsPerMs;
    this.viewport.applyTimeRange(this.scrollStart.time + dt, this.scrollStart.timeEnd + dt);

    // Vertical = déplacement prix (range constant, utilise snapshot)
    var dp = dy / this.scrollStart.pixelsPerPrice;
    this.viewport.applyPriceRange(this.scrollStart.priceMin + dp, this.scrollStart.priceMax + dp);
  };

  /**
   * Scroll horizontal par ticks
   */
  OrderflowEngine.prototype._scrollTime = function (dir, pixels) {
    var ts = this.timeScale;
    var dt = (pixels * dir) / ts.pixelsPerMs;
    this.viewport.applyTimeRange(ts.startTime + dt, ts.endTime + dt);
  };

  /**
   * Reset view — tout afficher
   */
  OrderflowEngine.prototype._resetView = function () {
    var now = Date.now();
    var range = this._requestedRangeMs || 1800000;
    this.viewport.applyTimeRange(now - range, now + this._intervalMs * 4);
    this._fitPrice(0.05);
    this._dirty = true;
  };

  // ============================================================
  // Rendu
  // ============================================================


  OrderflowEngine.prototype._buildRenderState = function () {
    return {
      candles: this._candles,
      inCanvas: this.inCanvas,
      hint: 'Drag↔=pan temps  Drag axe prix=zoom prix  Shift+Drag=zoom prix  Wheel↕ chart=zoom temps  Wheel axe prix=zoom prix  Ctrl+Wheel=zoom global  Wheel↔=scroll temps  +/-=zoom prix  Space=reset  H=fit temps  P=fit prix  R=defaut',
      market: this._marketState,
    };
  };

  OrderflowEngine.prototype._renderFrame = function (ctx, state, viewport, w, h) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, w, h);
    this._drawGrid(ctx, w, h);
    this._drawFootprintCoverage(ctx, state, w, h);
    if (state.candles && state.candles.length > 0) {
      this._drawFootprint(ctx, w, h, state);
      this._drawVolumeProfile(ctx, w, h);
    }
    this._drawPriceAxis(ctx, w, h);
    this._drawTimeAxis(ctx, w, h);
    if (state.inCanvas) this._drawCrosshair(ctx, w, h);
    if (state.inCanvas) this._drawTooltip(ctx);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(state.hint, 10, h - 2);
  };

  OrderflowEngine.prototype._drawFootprintCoverage = function (ctx, state, w, h) {
    if (!state || !state.market || !state.market.footprintCoverage) return;
    var fc = state.market.footprintCoverage;
    if (!Number.isFinite(fc.start)) return;

    var x = this.timeToX(fc.start);
    if (x < this.layout.chartLeft || x > this.layout.chartRight) return;

    var topY = this.layout.topMargin;
    var botY = h - this.layout.bottomMargin;

    ctx.save();

    // Fond tinté discret à droite de la ligne (zone footprint)
    ctx.fillStyle = 'rgba(56,211,238,0.03)';
    ctx.fillRect(x, topY, this.layout.chartRight - x, botY - topY);

    // Ligne verticale fine
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(x, topY);
    ctx.lineTo(x, botY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Label discret
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(
      'FP ' + (fc.complete ? '15m' : 'partial'),
      Math.max(x + 6, this.layout.chartLeft + 6),
      topY + 4
    );
    ctx.restore();
  };

  OrderflowEngine.prototype.render = function () {
    var ctx = this.ctx;
    var ps = this.priceScale;
    var ts = this.timeScale;

    // VÉRIFICATION DES DIMENSIONS en temps réel (getBoundingClientRect)
    // Le canvas peut être à 0×0 si la page était cachée au démarrage.
    var rect = this.canvas.getBoundingClientRect();
    var rw = Math.round(rect.width);
    var rh = Math.round(rect.height);

    if (rw !== this._lastW || rh !== this._lastH) {
      this._lastW = rw;
      this._lastH = rh;
      // Appliquer les nouvelles dimensions
      this.dpr = window.devicePixelRatio || 1;
      this.canvas.width = rw * this.dpr;
      this.canvas.height = rh * this.dpr;
      // CSS gère l'affichage (width:100%;height:100%)
      ps.height = rh;
      ts.width = rw;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      // Recalculer le layout
      var lay = this.layout;
      lay.chartRight = Math.max(lay.chartLeft + 100, rw - lay.priceAxisWidth - lay.vpWidth - 15);
      lay.chartWidth = Math.max(100, lay.chartRight - lay.chartLeft);

      this._dirty = true;
    }

    if (!this._dirty) return;
    this._dirty = false;

    // Protection: ne pas render si dimensions 0
    if (rw < 1 || rh < 1) return;
    
    var w = rw;
    var h = rh;

    var state = this._buildRenderState();
    this._renderFrame(ctx, state, this.viewport, w, h);
  };

  /**
   * Grille horizontale + verticale
   */
  OrderflowEngine.prototype._drawGrid = function (ctx, w, h) {
    var ps = this.priceScale;
    var ts = this.timeScale;

    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;

    // Niveaux de prix (tous les $200)
    var tickStep = this._nicePriceStep((ps.maxPrice - ps.minPrice) / 10);
    var startPrice = Math.floor(ps.minPrice / tickStep) * tickStep;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (var price = startPrice; price <= ps.maxPrice; price += tickStep) {
      var y = this.priceToY(price);
      if (y < this.layout.topMargin || y > h - this.layout.bottomMargin) continue;
      ctx.beginPath();
      ctx.moveTo(this.layout.chartLeft, y);
      ctx.lineTo(this.layout.chartRight, y);
      ctx.stroke();
    }
  };

  /**
   * Axe prix à droite
   */
  OrderflowEngine.prototype._drawPriceAxis = function (ctx, w, h) {
    var ps = this.priceScale;
    var tickStep = this._nicePriceStep((ps.maxPrice - ps.minPrice) / 10);
    var startPrice = Math.floor(ps.minPrice / tickStep) * tickStep;

    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (var price = startPrice; price <= ps.maxPrice; price += tickStep) {
      var y = this.priceToY(price);
      if (y < this.layout.topMargin || y > h - this.layout.bottomMargin) continue;
      ctx.fillText(price.toFixed(0), w - 12, y);
    }
  };

  /**
   * Axe temps en bas
   */
  OrderflowEngine.prototype._drawTimeAxis = function (ctx, w, h) {
    var ts = this.timeScale;
    var ps = this.priceScale;
    var timeRange = ts.endTime - ts.startTime;

    // Déterminer un pas de temps lisible
    var stepMs = this._niceTimeStep(timeRange / 8);
    var startTime = Math.floor(ts.startTime / stepMs) * stepMs;

    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (var t = startTime; t <= ts.endTime; t += stepMs) {
      var x = this.timeToX(t);
      if (x < this.layout.chartLeft || x > this.layout.chartRight) continue;

      // Petite marque
      ctx.beginPath();
      ctx.moveTo(x, h - this.layout.bottomMargin + 4);
      ctx.lineTo(x, h - this.layout.bottomMargin + 8);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Label
      var d = new Date(t);
      ctx.fillText(
        ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2),
        x, h - this.layout.bottomMargin + 10
      );
    }
  };

  /**
   * Crosshair
   */
  OrderflowEngine.prototype._drawCrosshair = function (ctx, w, h) {
    var mx = this.mousePos.x;
    var my = this.mousePos.y;
    var ps = this.priceScale;

    // Ne pas dessiner le crosshair dans la zone prix/VP
    if (mx > this.layout.chartRight) return;

    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;

    // Ligne verticale
    ctx.beginPath();
    ctx.moveTo(mx, this.layout.topMargin);
    ctx.lineTo(mx, h - this.layout.bottomMargin);
    ctx.stroke();

    // Ligne horizontale
    ctx.beginPath();
    ctx.moveTo(this.layout.chartLeft, my);
    ctx.lineTo(this.layout.chartRight, my);
    ctx.stroke();

    ctx.restore();
  };

  /**
   * Tooltip — prix + temps sous le crosshair
   */
  OrderflowEngine.prototype._drawTooltip = function (ctx) {
    var mx = this.mousePos.x;
    var my = this.mousePos.y;
    var w = this.canvas.width / this.dpr;
    var lay = this.layout;

    if (mx > lay.chartRight) return;

    var price = this.yToPrice(my);
    var time = this.xToTime(mx);
    var d = new Date(time);

    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    var text = price.toFixed(1) + ' @ ' +
      ('0' + d.getHours()).slice(-2) + ':' +
      ('0' + d.getMinutes()).slice(-2) + ':' +
      ('0' + d.getSeconds()).slice(-2);

    var tw = ctx.measureText(text).width;
    var tx = Math.min(mx + 12, w - tw - 24);
    var ty = Math.max(8, my - 20);

    // Background
    // Fond du tooltip (fillRect pour compatibilité cross-browser)
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(tx - 4, ty - 2, tw + 8, 16);

    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(text, tx, ty);
  };

  // ============================================================
  // Helpers
  // ============================================================

  /**
   * Pas de prix "lisible" — arrondi à la puissance de 10 × 1/2/5
   */
  OrderflowEngine.prototype._nicePriceStep = function (rawStep) {
    var exp = Math.floor(Math.log10(rawStep));
    var mant = rawStep / Math.pow(10, exp);
    if (mant < 1.5) return Math.pow(10, exp);
    if (mant < 3.5) return 2 * Math.pow(10, exp);
    if (mant < 7.5) return 5 * Math.pow(10, exp);
    return 10 * Math.pow(10, exp);
  };

  /**
   * Pas de temps lisible (ms)
   */
  OrderflowEngine.prototype._niceTimeStep = function (rawMs) {
    var steps = [
      1000,          // 1s
      5000,          // 5s
      30000,         // 30s
      60000,         // 1m
      300000,        // 5m
      900000,        // 15m
      1800000,       // 30m
      3600000,       // 1h
      7200000,       // 2h
      14400000,      // 4h
      43200000,      // 12h
      86400000,      // 1d
    ];
    for (var i = 0; i < steps.length; i++) {
      if (steps[i] >= rawMs) return steps[i];
    }
    return steps[steps.length - 1];
  };

  // ============================================================
  // Pan vertical (scroll prix)
  // ============================================================

  OrderflowEngine.prototype._panPrice = function (pixels) {
    var ps = this.priceScale;
    var dp = pixels / ps.pixelsPerUnit;
    this.viewport.applyPriceRange(ps.minPrice + dp, ps.maxPrice + dp);
  };

  /**
   * Zoom horizontal (temps seulement) — rétrécir/agrandir l'axe X
   * Zoom centré au milieu du range visible
   * @param {number} factor - >1 zoom in (rétrécir temps), <1 zoom out (agrandir temps)
   */
  /** Zoom temps centré sur la position X du curseur (comme LWC) */
  OrderflowEngine.prototype._zoomTime = function (factor, anchorX) {
    var ts = this.timeScale;

    // Calculer le timestamp sous le curseur
    var anchorTime = anchorX != null ? this.xToTime(anchorX) : null;
    if (anchorTime == null) {
      anchorTime = ts.startTime + (ts.endTime - ts.startTime) / 2;
    }

    var timeRange = ts.endTime - ts.startTime;
    var newTimeRange = timeRange * (1 / factor);

    var nextStart = anchorTime - (anchorTime - ts.startTime) * (newTimeRange / timeRange);
    this.viewport.applyTimeRange(nextStart, nextStart + newTimeRange);
  };

  // ============================================================
  // Boucle rAF
  // ============================================================

  OrderflowEngine.prototype.start = function () {
    if (this._running) return;
    this._running = true;
    var self = this;
    function loop() {
      if (!self._running) return;
      self.render();
      self._rafId = requestAnimationFrame(loop);
    }
    loop();
  };

  OrderflowEngine.prototype.stop = function () {
    this._running = false;
    if (this._liveFlushTimer) {
      clearTimeout(this._liveFlushTimer);
      this._liveFlushTimer = null;
    }
    this._liveBuffer = [];
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  };

  // ============================================================
  // Init automatique
  // ============================================================

  function initOrderflow() {
    var container = document.querySelector('.page[data-page="orderflow"]');
    if (!container) return;
    if (!OF.ViewportController) {
      setTimeout(initOrderflow, 0);
      return;
    }
    var engine = new OrderflowEngine('ofCanvas');
    window.__ofEngine = engine;

    // Si la page est déjà active, lancer le chargement + rAF
    if (container.classList.contains('active')) {
      engine.loadData(engine._symbol, engine._interval);
      engine.start();
    }
  }

  // Écouter les changements de page pour charger/stoper
  document.addEventListener('pageChange', function (e) {
    var engine = window.__ofEngine;
    if (!engine) return;
    var page = e.detail && e.detail.page;
    if (page === 'orderflow') {
      if (!engine._isLiveData && !engine._loading && engine._rawTrades.length === 0) {
        engine.loadData(engine._symbol, engine._interval);
      }
      if (engine._liveEnabled) {
        engine._connectLive();
      }
      engine.start();
    } else {
      engine.stop();
      engine._disconnectLive();
    }
  });

  // Attendre que le DOM soit prêt
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOrderflow);
  } else {
    initOrderflow();
  }


  // ============================================================
  // Load real data from API
  // ============================================================

  OrderflowEngine.prototype.loadData = function (symbol, interval) {
    var self = this;
    var requestId = ++this._loadRequestId;
    this._symbol = symbol || this._symbol;
    this._interval = interval || this._interval;
    this._intervalMs = this._intervalToMs(this._interval);
    this._loading = true;
    this._error = null;
    this._setStatus('loading ' + this._symbol + ' ' + this._interval + '...');

    var now = Date.now();
    var startTime = now - this._requestedRangeMs;
    // Footprint: seulement les dernieres 15 min (900000ms)
    var fpStartTime = now - this._footprintWindowMs;

    Promise.all([
      OF.DataService.fetchKlines(this._symbol, this._interval, startTime, now),
      OF.DataService.fetchTrades(this._symbol, fpStartTime, now, 5000)
    ])
      .then(function (results) {
        self._applyHybridData(results[0], results[1], startTime, now, requestId);
      })
      .catch(function (err) { self._handleHistoricalError(err, requestId); });
  };

  /** Appliquer les donnees hybrides (klines + aggTrades) à l'engine */
  OrderflowEngine.prototype._applyHybridData = function (klinesData, tradesData, startTime, endTime, requestId) {
    if (requestId !== this._loadRequestId) return;
    var self = this;

    // 1. Bougies OHLC depuis klines
    var klines = klinesData && klinesData.candles ? klinesData.candles : (Array.isArray(klinesData) ? klinesData : []);
    if (!klines || klines.length === 0) {
      throw new Error('Aucune kline recue pour ' + self._symbol);
    }
    var ohlcCandles = OF.Aggregator.aggregateOHLC(klines, self._intervalMs);
    self._klinesCandles = ohlcCandles;

    // 2. Footprint depuis aggTrades (limité aux 15 dernieres minutes)
    var trades = Array.isArray(tradesData) ? tradesData : (tradesData && tradesData.trades ? tradesData.trades : []);
    var limits = !Array.isArray(tradesData) && tradesData ? tradesData.limits || {} : {};
    self._rawTrades = trades;
    self._footprintMap = OF.Aggregator.buildFootprintMap(trades, self._intervalMs, self._tickSize);

    // 3. Fusion
    self._candles = OF.Aggregator.mergeOHLCWithFootprint(ohlcCandles, self._footprintMap);

    self._isLiveData = true;
    self._loading = false;
    self._currentRange = { start: startTime, end: endTime };
    self._fetchTimestamp = Date.now();
    self._fetchMeta = limits;
    self._liveTradesCount = 0;

    self._lastHistoricalTradeId = 0;
    for (var ti = 0; ti < trades.length; ti++) {
      if (trades[ti].id && trades[ti].id > self._lastHistoricalTradeId) {
        self._lastHistoricalTradeId = trades[ti].id;
      }
    }

    // Partial = footprint partiel (pas assez de trades pour couvrir toutes les bougies recentes)
    var fpCandleCount = Object.keys(self._footprintMap).length;
    var expectedRecent = Math.ceil(self._footprintWindowMs / self._intervalMs); // bougies attendues dans la fenetre footprint
    self._partialData = fpCandleCount < expectedRecent && trades.length > 0;
    if (OF.DataModel && typeof OF.DataModel.buildHybridState === 'function') {
      self._marketState = OF.DataModel.buildHybridState({
        symbol: self._symbol,
        interval: self._interval,
        intervalMs: self._intervalMs,
        requestedStart: startTime,
        requestedEnd: endTime,
        ohlcCandles: self._klinesCandles,
        footprintMap: self._footprintMap,
        mergedCandles: self._candles,
        footprintWindowMs: self._footprintWindowMs,
        partial: self._partialData,
        klinesMeta: klinesData || {},
        aggTradesMeta: tradesData || {},
      });
    }

    self.viewport.setDataRange('load');
    self._dirty = true;
    self._updateStatsPanel();

    if (self._liveEnabled) {
      self._disconnectLive();
      self._connectLive();
    }
    self._setStatus(self._buildStatus());
  };

  /** Gestion d'erreur fetch (commun à loadData et reload) */
  OrderflowEngine.prototype._handleHistoricalError = function (err, requestId) {
    if (requestId !== this._loadRequestId) return;
    console.warn('[OF] API error, fallback mock:', err.message);
    this._disconnectLive();
    this._error = err.message;
    this._isLiveData = false;
    this._loadMockData();
    this._setStatus(this._buildStatus());
  };

  /** Changer le range — marque comme override utilisateur */
  OrderflowEngine.prototype.setRange = function (rangeMs) {
    if (rangeMs === this._requestedRangeMs && this._rawTrades.length > 0) return;
    this._requestedRangeMs = rangeMs;
    this._rangeUserOverridden = true;
    var autoBtn = document.getElementById('ofAutoRange');
    if (autoBtn) autoBtn.classList.remove('active');
    if (this._isLiveData) {
      this.loadData(this._symbol, this._interval);
    }
  };

  /** Revenir en mode auto-range */
  OrderflowEngine.prototype.setAutoRange = function () {
    this._rangeUserOverridden = false;
    this.viewport.mode = 'auto';
    this.viewport.userDetached = false;
    this.setInterval(this._interval); // va appliquer auto-range via setDataRange
  };

  /** Recharger les donnees (force fetch — ignore le cache) */
  OrderflowEngine.prototype.reload = function () {
    this._disconnectLive();
    OF.DataService.clearCache();
    this._loadRequestId++; // annuler tout fetch en cours
    var now = Date.now();
    var startTime = now - this._requestedRangeMs;
    var fpStartTime = now - this._footprintWindowMs;
    var self = this;
    var requestId = this._loadRequestId;

    Promise.all([
      OF.DataService.fetchKlines(this._symbol, this._interval, startTime, now),
      OF.DataService.fetchTrades(this._symbol, fpStartTime, now, 5000, true)
    ])
      .then(function (results) {
        self._applyHybridData(results[0], results[1], startTime, now, requestId);
      })
      .catch(function (err) { self._handleHistoricalError(err, requestId); });
  };

  // ============================================================
  // Live WebSocket
  // ============================================================

  /** Connecter le stream live */
  OrderflowEngine.prototype._connectLive = function () {
    if (this._liveStream) {
      this._liveStream.disconnect();
      this._liveStream = null;
    }
    var self = this;
    this._liveStream = Object.create(OF.LiveStream);
    this._liveStream.connect(this._symbol, function (trade) {
      self._onLiveTrade(trade);
    }, function (status) {
      self._liveStatus = status;
      self._setStatus(self._buildStatus());
    });
  };

  /** Déconnecter le stream live */
  OrderflowEngine.prototype._disconnectLive = function () {
    if (this._liveStream) {
      this._liveStream.disconnect();
      this._liveStream = null;
    }
    this._liveStatus = 'disconnected';
    this._setStatus(this._buildStatus());
  };

  /** Handler pour chaque trade live — bufferise et flush periodique */
  OrderflowEngine.prototype._onLiveTrade = function (trade) {
    // Anti-doublon: ignorer si id <= dernier historique
    if (trade.id && this._lastHistoricalTradeId > 0 && trade.id <= this._lastHistoricalTradeId) return;

    // Anti-doublon reconnect: _seenLiveIds ensemble borné
    if (trade.id) {
      if (this._seenLiveIds[trade.id]) return;
      this._seenLiveIds[trade.id] = true;
      this._seenLiveIdsQueue.push(trade.id);
      // Garder max 5000 IDs en mémoire
      if (this._seenLiveIdsQueue.length > 5000) {
        var oldId = this._seenLiveIdsQueue.shift();
        delete this._seenLiveIds[oldId];
      }
    }

    // Mettre à jour le dernier ID
    if (trade.id && trade.id > this._lastHistoricalTradeId) {
      this._lastHistoricalTradeId = trade.id;
    }

    // Bufferiser et scheduler le flush
    this._liveBuffer.push(trade);
    if (!this._liveFlushTimer) {
      var self = this;
      this._liveFlushTimer = setTimeout(function () {
        self._flushLiveTrades();
      }, 150);
    }
  };

  /** Flusher le buffer live — ensureLiveCandle + footprint incremental + merge */
  OrderflowEngine.prototype._flushLiveTrades = function () {
    this._liveFlushTimer = null;
    var buf = this._liveBuffer;
    this._liveBuffer = [];
    if (!buf.length) return;

    // 1. Ensure live candles + push to rawTrades + trim
    var now = Date.now();
    var fpWindow = this._footprintWindowMs;
    var trimBefore = now - this._requestedRangeMs; // garder au moins le range demande

    for (var i = 0; i < buf.length; i++) {
      var t = buf[i];
      this._rawTrades.push(t);
      this._liveTradesCount++;

      // Ensure candle existe dans _klinesCandles
      var candleTime = Math.floor(t.time / this._intervalMs) * this._intervalMs;
      this._ensureLiveCandle(candleTime, t);

      // Mettre à jour le dernier ID
      if (t.id && t.id > this._lastHistoricalTradeId) {
        this._lastHistoricalTradeId = t.id;
      }
    }

    // 2. Trim: garder max 15 min de trades en mémoire
    var fpTrim = now - fpWindow;
    var idx = 0;
    while (idx < this._rawTrades.length - 1 && this._rawTrades[idx].time < fpTrim) {
      idx++;
    }
    if (idx > 0) this._rawTrades.splice(0, idx);

    // 3. Appliquer le batch à la footprintMap existante (incrémental)
    OF.Aggregator.applyTradesToFootprintMap(this._footprintMap, buf, this._intervalMs, this._tickSize);

    // 4. Re-merger klines + footprint
    this._candles = OF.Aggregator.mergeOHLCWithFootprint(this._klinesCandles, this._footprintMap);

    // 5. Mettre à jour le flag partial
    var fpCount = Object.keys(this._footprintMap).length;
    var expected = Math.ceil(this._footprintWindowMs / this._intervalMs);
    this._partialData = fpCount < expected && this._rawTrades.length > 0;
    if (OF.DataModel && typeof OF.DataModel.refreshLiveState === 'function') {
      this._marketState = OF.DataModel.refreshLiveState(this._marketState, {
        ohlcCandles: this._klinesCandles,
        footprintMap: this._footprintMap,
        mergedCandles: this._candles,
        partial: this._partialData,
        footprintWindowMs: this._footprintWindowMs,
      });
    }

    this._dirty = true;
    this._updateStatsPanel();
    this._setStatus(this._buildStatus());
  };

  /** Créer ou mettre à jour une bougie synthétique depuis un trade live */
  OrderflowEngine.prototype._ensureLiveCandle = function (candleTime, trade) {
    // Chercher dans _klinesCandles
    for (var i = 0; i < this._klinesCandles.length; i++) {
      if (this._klinesCandles[i].time === candleTime) {
        var c = this._klinesCandles[i];
        c.high = Math.max(c.high, trade.price);
        c.low = Math.min(c.low, trade.price);
        c.close = trade.price;
        c.volume = (c.volume || 0) + trade.qty;
        return;
      }
    }
    // Pas trouvé → créer une bougie synthétique
    this._klinesCandles.push({
      time: candleTime,
      open: trade.price,
      high: trade.price,
      low: trade.price,
      close: trade.price,
      volume: trade.qty,
      delta: 0,
      levels: [],
      _synthetic: true
    });
    // Rester trié par time
    this._klinesCandles.sort(function (a, b) { return a.time - b.time; });
  };

  /** Construire le message de status */
  OrderflowEngine.prototype._buildStatus = function () {
    var parts = [this._symbol + ' · ' + this._interval + ' candles'];
    if (this._candles.length > 0) {
      var ohlcH = Math.max(1, Math.round(this._requestedRangeMs / 3600000));
      var fpMins = Math.round(this._footprintWindowMs / 60000);
      parts.push('OHLC ' + ohlcH + 'h');
      parts.push('FP ' + fpMins + 'm');
      if (this._partialData) parts.push('partial');
    }
    // Viewport mode
    if (this.viewport) {
      parts.push(this.viewport.mode === 'auto' ? 'AUTO' : 'MANUAL');
    }
    // Live status
    if (this._liveEnabled && this._liveStatus === 'connected') {
      parts.push('LIVE');
      if (this._liveTradesCount > 0) parts.push('+' + this._liveTradesCount);
    } else if (this._liveEnabled && this._liveStatus === 'reconnecting') {
      parts.push('reconnecting');
    } else if (this._liveEnabled && this._liveStatus === 'error') {
      parts.push('error');
    } else if (!this._liveEnabled) {
      parts.push('LIVE off');
    }
    return parts.join(' · ');
  };

  /** Mettre a jour le panneau stats — enrichi avec metadata */  
  OrderflowEngine.prototype._updateStatsPanel = function () {
    var el = document.getElementById('ofStats');
    if (!el) return;
    var candles = this._candles;
    if (!candles || candles.length === 0) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');

    var totalDelta = 0, totalVol = 0;
    for (var i = 0; i < candles.length; i++) {
      totalDelta += candles[i].delta || 0;
      totalVol += candles[i].volume || 0;
    }

    var first = candles[0], last = candles[candles.length - 1];
    var coverageH = Math.round((last.time - first.time) / 3600000 * 10) / 10;
    var reqH = Math.round(this._requestedRangeMs / 3600000);
    var ratio = last.time - first.time > 0 ? (last.time - first.time) / this._requestedRangeMs : 0;

    var from = new Date(first.time);
    var to = new Date(last.time);
    var timeStr = ('0' + from.getHours()).slice(-2) + ':' + ('0' + from.getMinutes()).slice(-2);
    timeStr += ' - ' + ('0' + to.getHours()).slice(-2) + ':' + ('0' + to.getMinutes()).slice(-2);

    var deltaClass = totalDelta >= 0 ? 'stats-delta-pos' : 'stats-delta-neg';

    // Warnings
    var warns = [];
    if (candles.length < 20) warns.push('seulement ' + candles.length + ' candles');
    if (ratio < 0.5) warns.push('cover ' + coverageH + 'h / ' + reqH + 'h demandes');
    if (this._fetchMeta && this._fetchMeta.hitBinanceLimit) warns.push('limite Binance atteinte');
    var warnHtml = warns.length > 0 ? '<br><span class="stats-warn">⚠ ' + warns.join(' · ') + '</span>' : '';

    // Timestamp fetch
    var fetchStr = '';
    if (this._fetchTimestamp) {
      var fd = new Date(this._fetchTimestamp);
      fetchStr = '<br><span class="stats-info">' 
        + ('0' + fd.getHours()).slice(-2) + ':' + ('0' + fd.getMinutes()).slice(-2) + ':' + ('0' + fd.getSeconds()).slice(-2)
        + '</span>';
    }

    el.innerHTML = '<strong>' + this._symbol + '</strong> ' + this._interval + ' $' + this._tickSize
      + (this._rangeUserOverridden ? '' : ' · auto')
      + '<br>Trades: <strong>' + this._rawTrades.length + '</strong>  Candles: <strong>' + candles.length + '</strong>'
      + '<br>' + timeStr
      + '<br>Δ <strong class="' + deltaClass + '">' + (totalDelta >= 0 ? '+' : '') + totalDelta.toFixed(1) + '</strong>  Vol <strong>' + totalVol.toFixed(1) + '</strong>'
      + warnHtml
      + fetchStr;
  };

  /** Re-agreger les rawTrades — preserve le temps visible, ajuste le prix si necessaire */
  OrderflowEngine.prototype._reaggregate = function () {
    if (!this._rawTrades || this._rawTrades.length === 0) return;
    // Sauvegarder la plage temps visible
    var savedStart = this.timeScale.startTime;
    var savedEnd = this.timeScale.endTime;

    this._footprintMap = OF.Aggregator.buildFootprintMap(this._rawTrades, this._intervalMs, this._tickSize);
    this._candles = OF.Aggregator.mergeOHLCWithFootprint(this._klinesCandles, this._footprintMap);

    // Restaurer la plage temps (ne pas reset le contexte utilisateur)
    this.viewport.applyTimeRange(savedStart, savedEnd);

    // Ajuster le prix uniquement si les bougies sortent du range visible
    var candles = this._candles || [];
    if (candles.length > 0) {
      var minP = candles[0].low, maxP = candles[0].high;
      for (var i = 0; i < candles.length; i++) {
        if (candles[i].low < minP) minP = candles[i].low;
        if (candles[i].high > maxP) maxP = candles[i].high;
      }
      if (minP < this.priceScale.minPrice || maxP > this.priceScale.maxPrice) {
        var pad = (maxP - minP) * 0.15 || 200;
        this.viewport.applyPriceRange(minP - pad, maxP + pad);
      }
    }

    this._dirty = true;
    this._updateStatsPanel();
    this._setStatus(this._buildStatus());
  };

  /** Auto-range suggere selon le timeframe */
  OrderflowEngine.prototype._suggestRange = function (interval) {
    var map = { '1m': 3600000, '3m': 7200000, '5m': 10800000, '15m': 21600000, '1h': 86400000, '4h': 432000000 };
    return map[interval] || 7200000;
  };

  /** Changer le timeframe — re-aggregation locale si on a deja les rawTrades */
  /** Timeframe ranges par défaut — auto-range adapté au timeframe */
  OrderflowEngine.prototype._getAutoRangeMs = function (interval) {
    var map = {
      '1m': 60 * 60 * 1000,     // 1h
      '3m': 2 * 60 * 60 * 1000,  // 2h
      '5m': 3 * 60 * 60 * 1000,  // 3h
      '15m': 6 * 60 * 60 * 1000, // 6h
      '30m': 12 * 60 * 60 * 1000,// 12h
      '1h': 24 * 60 * 60 * 1000, // 24h
    };
    return map[interval] || 2 * 60 * 60 * 1000;
  };

  OrderflowEngine.prototype.setInterval = function (interval, opts) {
    opts = opts || {};
    if (!interval) return;

    var changed = interval !== this._interval;
    if (!changed && !opts.force) return;

    this._interval = interval;
    this._intervalMs = this._intervalToMs(interval);

    // Auto-range : recalcule le range logique par timeframe si pas d'override
    if (!this._rangeUserOverridden) {
      this._requestedRangeMs = this._getAutoRangeMs(interval);
    }

    // Sur changement de timeframe, repasser en mode auto (vue claire)
    if (this.viewport && this.viewport.setMode) {
      this.viewport.setMode('auto', false);
    }

    if (this._klinesCandles && this._klinesCandles.length > 0) {
      // Intervalle change → re-fetch complet (klines au nouvel intervalle)
      this.loadData(this._symbol, this._interval);
    } else if (this._rawTrades && this._rawTrades.length > 0 && this._currentRange) {
      this._reaggregate();
    } else {
      // Pas encore de donnees → loadData initial
      this.loadData(this._symbol, interval);
    }
    this._setStatus(this._buildStatus());
  };

  /** Snapshot debug — injecté dans window.__ofEngine.debugSnapshot() */
  OrderflowEngine.prototype.debugSnapshot = function () {
    return {
      symbol: this._symbol,
      interval: this._interval,
      intervalMs: this._intervalMs,
      requestedRangeMs: this._requestedRangeMs,
      viewport: this.viewport && this.viewport.getState ? this.viewport.getState() : null,
      liveStatus: this._liveStatus,
      liveEnabled: this._liveEnabled,
      candles: this._candles ? this._candles.length : 0,
      rawTrades: this._rawTrades ? this._rawTrades.length : 0,
      klinesCandles: this._klinesCandles ? this._klinesCandles.length : 0,
      footprintCandles: this._footprintMap ? Object.keys(this._footprintMap).length : 0,
      partialData: !!this._partialData,
      currentRange: this._currentRange,
    };
  };

  /** Changer le tick size (price step) — re-aggregation locale uniquement */
  OrderflowEngine.prototype.setTickSize = function (tickSize) {
    if (tickSize === this._tickSize) return;
    this._tickSize = tickSize;
    this._reaggregate();
    this._updateStatsPanel();
    this._setStatus(this._buildStatus());
  };

  /** Mettre a jour les boutons step selon le symbole */
  OrderflowEngine.prototype._updateStepButtons = function (symbol) {
    var cfg = this._stepsConfig[symbol] || this._stepsConfig['BTCUSDT'];
    var btns = document.querySelectorAll('.of-step-btn');
    var labels = cfg.steps;
    btns.forEach(function (btn, i) {
      if (i < labels.length) {
        var val = labels[i];
        btn.dataset.step = String(val);
        btn.textContent = cfg.label + val;
        btn.classList.toggle('active', val === cfg.default);
      }
    });
  };

  /** Convertir timeframe string en ms */
  OrderflowEngine.prototype._intervalToMs = function (interval) {
    var map = { '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000 };
    return map[interval] || 180000;
  };

  /** Ajuster les scales aux donnees chargees */
  OrderflowEngine.prototype._fitToData = function () {
    var candles = this._candles;
    if (!candles || candles.length === 0) return;

    var minP = candles[0].low, maxP = candles[0].high;
    for (var i = 0; i < candles.length; i++) {
      if (candles[i].low < minP) minP = candles[i].low;
      if (candles[i].high > maxP) maxP = candles[i].high;
    }
    var pad = (maxP - minP) * 0.15 || 200;
    this.viewport.applyPriceRange(minP - pad, maxP + pad);

    // Fit temps: centrer les dernieres N bougies
    var dataRange = candles[candles.length - 1].time - candles[0].time;
    var visibleCount = Math.min(candles.length, 30); // max 30 bougies visibles
    var endTime = candles[candles.length - 1].time + this._intervalMs * 4;
    var startTime = candles[Math.max(0, candles.length - visibleCount)].time;
    this.viewport.applyTimeRange(startTime - this._intervalMs, endTime);
  };

  /** Renvoyer les bougies visibles (ou toutes si aucune visible) */
  OrderflowEngine.prototype._getVisibleCandles = function () {
    var all = this._candles || [];
    if (!all.length) return [];
    var start = this.timeScale.startTime;
    var end = this.timeScale.endTime;
    var visible = all.filter(function (c) {
      return c && c.time >= start && c.time <= end;
    });
    return visible.length ? visible : all;
  };

  /** Fit price seulement — centrer le range prix sur les bougies visibles */
  OrderflowEngine.prototype._fitPrice = function (margin) {
    var candles = this._getVisibleCandles();
    if (!candles || !candles.length) return;

    var minP = candles[0].low, maxP = candles[0].high;
    for (var i = 1; i < candles.length; i++) {
      var c = candles[i];
      if (!c) continue;
      if (Number.isFinite(c.low) && c.low < minP) minP = c.low;
      if (Number.isFinite(c.high) && c.high > maxP) maxP = c.high;
    }
    var range = maxP - minP;
    var pad = range * (margin || 0.05) || 50;
    this.viewport.applyPriceRange(minP - pad, maxP + pad);
    this._dirty = true;
  };

  /** Reset complet : range temporel au défaut + fit price */
  OrderflowEngine.prototype._resetDefaultView = function () {
    var now = Date.now();
    this.viewport.applyTimeRange(now - this._requestedRangeMs, now);
    // Desactiver l'override utilisateur pour le range
    this._rangeUserOverridden = false;
    var autoBtn = document.getElementById('ofAutoRange');
    if (autoBtn) {
      var rangeBtns = document.querySelectorAll('.of-range-btn');
      rangeBtns.forEach(function (b) { b.classList.remove('active'); });
      autoBtn.classList.add('active');
    }
    this._fitPrice(0.05);
    this._dirty = true;
    this._setStatus(this._buildStatus());
  };

  // ============================================================
  // Mock Data Generator — 200 candles footprint
  // ============================================================

  /**
   * @returns {Array} candles avec levels [{price, bid, ask, delta}]
   */
  OF._generateMockCandles = function (count) {
    var candles = [];
    var now = Date.now();
    var intervalMs = 3 * 60 * 1000; // 3m
    var price = 68500 + Math.random() * 2000;
    var tickSize = 10; // $10 buckets

    for (var i = 0; i < count; i++) {
      var time = now - (count - i) * intervalMs;

      // Random walk
      var change = (Math.random() - 0.48) * 400;
      price += change;
      if (price < 60000) price = 60000 + Math.random() * 1000;
      if (price > 80000) price = 80000 - Math.random() * 1000;

      var open = price;
      var close = price + (Math.random() - 0.48) * 120;
      var high = Math.max(open, close) + Math.random() * 80;
      var low = Math.min(open, close) - Math.random() * 80;

      // Build price levels around candle range
      var levels = [];
      var levelCount = 15 + Math.floor(Math.random() * 30);
      var basePrice = Math.floor(low / tickSize) * tickSize;
      var maxLevel = Math.ceil(high / tickSize) * tickSize;

      for (var p = basePrice; p <= maxLevel; p += tickSize) {
        // More volume near high/low (trading activity clusters)
        var proximity = 1 - Math.abs(p - (high + low) / 2) / ((high - low) || 1);
        var baseVol = (0.3 + proximity * 0.7) * (0.5 + Math.random());

        // Generate imbalance based on candle direction
        var bullBias = (close - open) / (high - low + 1) * 2;
        var bid = baseVol * (1 + Math.max(0, bullBias) * 0.5 + Math.random() * 0.3);
        var ask = baseVol * (1 + Math.max(0, -bullBias) * 0.5 + Math.random() * 0.3);

        // Occasional absorption zone (high volume both sides)
        if (Math.random() < 0.12) {
          bid *= 2 + Math.random() * 2;
          ask *= 2 + Math.random() * 2;
        }

        var delta = bid - ask;
        levels.push({
          price: p,
          bid: Math.round(bid * 10) / 10,
          ask: Math.round(ask * 10) / 10,
          delta: Math.round(delta * 10) / 10
        });
      }

      candles.push({
        time: time,
        open: Math.round(open * 100) / 100,
        high: Math.round(high * 100) / 100,
        low: Math.round(low * 100) / 100,
        close: Math.round(close * 100) / 100,
        volume: Math.round((Math.random() * 500 + 100) * 100) / 100,
        levels: levels
      });
    }
    return candles;
  };

  // ============================================================
  // Load mock data into engine
  // ============================================================

  OrderflowEngine.prototype._loadMockData = function () {
    this._candles = OF._generateMockCandles(200);

    // Auto-fit scales
    this._fitToData();

    this._dirty = true;
    this._setStatus(this._buildStatus());
  };

  // ============================================================
  // Footprint renderer
  // ============================================================

  OrderflowEngine.prototype._drawFootprint = function (ctx, w, h, state) {
    var candles = this._candles;
    if (!candles || candles.length === 0) return;

    var ps = this.priceScale;
    var ts = this.timeScale;
    var visibleStart = ts.startTime;
    var visibleEnd = ts.endTime;
    var coverage = (state && state.market && state.market.footprintCoverage)
      ? state.market.footprintCoverage
      : this._getFootprintCoverageRange();
    var coverageStart = coverage ? coverage.start : null;
    var coverageEnd = coverage ? coverage.end : null;

    // Espacement entre bougies — adaptatif
    var candleGap = 0.2;
    var candleW = (ts.pixelsPerMs * (candles[1] ? (candles[1].time - candles[0].time) : 180000)) * (1 - candleGap);
    if (candleW > 50) candleW = 50;
    var minCandleW = Math.max(6, candleW);
    var renderMode = 'full';
    if (minCandleW < 18) renderMode = 'compact';
    if (minCandleW < 8) renderMode = 'skinny';

    for (var i = 0; i < candles.length; i++) {
      var c = candles[i];
      if (!c || !Number.isFinite(c.time)) continue;
      if (c.time < visibleStart - 60000 || c.time > visibleEnd + 60000) continue;

      var cx = this.timeToX(c.time);
      if (cx < -minCandleW || cx > this.layout.chartRight) continue;

      var isBull = c.close >= c.open;
      var inCoverage = Number.isFinite(coverageStart) && Number.isFinite(coverageEnd)
        ? (c.time >= coverageStart && c.time <= coverageEnd)
        : true;
      var yOpen = this.priceToY(c.open);
      var yClose = this.priceToY(c.close);
      var yHigh = this.priceToY(c.high);
      var yLow = this.priceToY(c.low);

      // === 1. WICK ===
      ctx.strokeStyle = isBull ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(cx, yHigh);
      ctx.lineTo(cx, yLow);
      ctx.stroke();

      // === 2. BODY OHLC ===
      var bodyTop = Math.min(yOpen, yClose);
      var bodyBottom = Math.max(yOpen, yClose);
      var bodyH = Math.max(2, bodyBottom - bodyTop);

      // Couleur adaptée au mode
      var bodyColor = isBull
        ? (inCoverage ? 'rgba(34,197,94,0.6)' : 'rgba(34,197,94,0.15)')
        : (inCoverage ? 'rgba(239,68,68,0.6)' : 'rgba(239,68,68,0.15)');
      ctx.fillStyle = bodyColor;
      ctx.fillRect(cx - minCandleW / 2, bodyTop, minCandleW, bodyH);

      // Contour fin
      ctx.strokeStyle = isBull
        ? (inCoverage ? 'rgba(34,197,94,0.4)' : 'rgba(34,197,94,0.1)')
        : (inCoverage ? 'rgba(239,68,68,0.4)' : 'rgba(239,68,68,0.1)');
      ctx.lineWidth = 0.5;
      ctx.strokeRect(cx - minCandleW / 2, bodyTop, minCandleW, bodyH);

      // Skinny: pas de footprint
      if (renderMode === 'skinny') continue;
      if (!inCoverage) continue;

      // === 3. FOOTPRINT LEVELS (overlay, seulement si disponibles) ===
      var levels = Array.isArray(c.levels) ? c.levels : [];
      var hasLevels = levels.length > 0;
      var isRealFootprint = inCoverage && hasLevels;

      // Hors footprint réel : body plus transparent
      if (!isRealFootprint) {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = isBull ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)';
        ctx.fillRect(cx - minCandleW/2, bodyTop, minCandleW, bodyH);
        ctx.globalAlpha = 1;
      }

      // Delta label pour les bougies avec footprint réel (pas en mode skinny)
      if (isRealFootprint && c.delta != null && renderMode !== 'skinny') {
        var deltaVal = Math.round(c.delta);
        var deltaStr = String(deltaVal);
        // Pas de label si la bougie est trop serrée (compact) — sauf delta significatif
        if (renderMode !== 'compact' || Math.abs(deltaVal) > 50) {
          ctx.save();
          ctx.font = renderMode === 'compact' ? '7px sans-serif' : '8px \"JetBrains Mono\", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = deltaVal >= 0 ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.6)';
          ctx.fillText(deltaStr, cx, Math.min(h - this.layout.bottomMargin - 10, yLow + 10));
          ctx.restore();
        }
      }

      if (!hasLevels) {
        // Compact sans footprint: body transparent
        if (renderMode === 'compact') {
          ctx.fillStyle = isBull ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)';
          ctx.fillRect(cx - minCandleW/2, bodyTop, minCandleW, bodyH);
        }
        continue;
      }

      // Trouver les volumes max
      var maxBid = 0, maxAsk = 0;
      for (var li = 0; li < levels.length; li++) {
        var lv = levels[li];
        if (!lv) continue;
        if (lv.bid > maxBid) maxBid = lv.bid;
        if (lv.ask > maxAsk) maxAsk = lv.ask;
      }
      if (maxBid < 1) maxBid = 1;
      if (maxAsk < 1) maxAsk = 1;

      var halfW = minCandleW / 2;

      for (var li = 0; li < levels.length; li++) {
        var lv = levels[li];
        if (!lv || !Number.isFinite(lv.price)) continue;
        var y = this.priceToY(lv.price);
        if (!Number.isFinite(y)) continue;

        // Skip levels outside candle range (high→low)
        if (y > yHigh - 2 || y < yLow + 2) continue;

        var bidPx = (lv.bid / maxBid) * halfW;
        var askPx = (lv.ask / maxAsk) * halfW;

        // Bid volume (green) — left side
        var barH = Math.max(4, Math.min(20, halfW * 0.6));
        if (bidPx > 0.5) {
          ctx.fillStyle = 'rgba(34,197,94,' + Math.min(0.7, 0.2 + (bidPx / halfW) * 0.5) + ')';
          ctx.fillRect(cx - bidPx, y - barH/2, bidPx, barH);
        }

        // Ask volume (red) — right side
        if (askPx > 0.5) {
          ctx.fillStyle = 'rgba(239,68,68,' + Math.min(0.7, 0.2 + (askPx / halfW) * 0.5) + ')';
          ctx.fillRect(cx, y - barH/2, askPx, barH);
        }

        // Delta dot: small circle if imbalance > 3:1
        var ratio = maxBid > maxAsk ? lv.bid / (lv.ask || 0.01) : lv.ask / (lv.bid || 0.01);
        if (ratio > 3) {
          ctx.fillStyle = lv.delta > 0 ? '#22c55e' : '#ef4444';
          ctx.beginPath();
          ctx.arc(cx + (lv.delta > 0 ? halfW + 4 : -halfW - 4), y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

  };

  OrderflowEngine.prototype._getFootprintCoverageRange = function () {
    if (!this._candles || this._candles.length === 0) return null;
    var end = this.timeScale.endTime || Date.now();
    var start = end - this._footprintWindowMs;
    return { start: start, end: end };
  };

  // ============================================================
  // Volume Profile renderer (side histogram)
  // ============================================================

  OrderflowEngine.prototype._drawVolumeProfile = function (ctx, w, h) {
    var candles = this._candles;
    if (!candles || candles.length === 0) return;

    var ps = this.priceScale;
    var ts = this.timeScale;
    var lay = this.layout;
    var vpWidth = lay.vpWidth;
    // VP positionnée après chartRight avec gap 15px
    var vpX = lay.chartRight + 15;
    var priceAxisX = vpX + vpWidth;

    var visibleStart = ts.startTime;
    var visibleEnd = ts.endTime;

    // Accumulate volume by price level
    var volMap = {};
    var maxVolLevel = 0;
    var tickSize = 10;

    for (var i = 0; i < candles.length; i++) {
      var c = candles[i];
      if (c.time < visibleStart || c.time > visibleEnd) continue;
      if (!c.levels) continue;

      for (var li = 0; li < c.levels.length; li++) {
        var lv = c.levels[li];
        var bucket = Math.floor(lv.price / tickSize) * tickSize;
        if (!volMap[bucket]) volMap[bucket] = 0;
        volMap[bucket] += lv.bid + lv.ask;
        if (volMap[bucket] > maxVolLevel) maxVolLevel = volMap[bucket];
      }
    }

    if (maxVolLevel < 1) return;

    // Sort price levels
    var prices = Object.keys(volMap).map(Number).sort(function (a, b) { return b - a; });

    // Calculate POC, VAH, VAL
    var totalVol = prices.reduce(function (sum, p) { return sum + volMap[p]; }, 0);
    var pocPrice = prices.reduce(function (best, p) {
      return volMap[p] > volMap[best] ? p : best;
    }, prices[0]);

    // Value Area: 70% of volume around POC
    var sortedDesc = prices.slice().sort(function (a, b) { return volMap[b] - volMap[a]; });
    var vaVol = 0;
    var vaPrices = [];
    for (var vi = 0; vi < sortedDesc.length; vi++) {
      vaPrices.push(sortedDesc[vi]);
      vaVol += volMap[sortedDesc[vi]];
      if (vaVol / totalVol >= 0.7) break;
    }
    var vah = vaPrices.reduce(function (a, b) { return Math.max(a, b); }, -Infinity);
    var val = vaPrices.reduce(function (a, b) { return Math.min(a, b); }, Infinity);

    // VP background strip — seulement dans la colonne VP
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    ctx.fillRect(vpX, 0, vpWidth, h);

    // VP label
    ctx.font = '8px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillText('VP', vpX + 4, 4);

    // Draw VP histogram
    for (var pi = 0; pi < prices.length; pi++) {
      var price = prices[pi];
      var vol = volMap[price];
      var y = this.priceToY(price);
      if (y < 0 || y > h) continue;
      var barW = (vol / maxVolLevel) * vpWidth;

      // VA edge lines
      if (price <= vah && price >= val && (price === vah || price === val)) {
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(vpX, y);
        ctx.lineTo(vpX + vpWidth, y);
        ctx.stroke();
      }

      // Volume bar — gradient from dim to brighter based on volume ratio
      var volRatio = vol / maxVolLevel;
      var alpha = 0.04 + volRatio * 0.12;
      ctx.fillStyle = 'rgba(255,255,255,' + alpha + ')';
      ctx.fillRect(vpX + vpWidth - barW, y - 2, barW, 4);

      // POC highlight
      if (price === pocPrice) {
        ctx.fillStyle = 'rgba(245,158,11,0.25)';
        ctx.fillRect(vpX + vpWidth - barW, y - 3, barW, 6);

        ctx.strokeStyle = 'rgba(245,158,11,0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(vpX, y);
        ctx.lineTo(vpX + vpWidth, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // VAH/VAL/POC labels dans la colonne axe prix
    ctx.font = '8px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(34,197,94,0.35)';
    ctx.fillText('VAH', priceAxisX + 4, this.priceToY(vah));
    ctx.fillStyle = 'rgba(239,68,68,0.35)';
    ctx.fillText('VAL', priceAxisX + 4, this.priceToY(val));
    ctx.fillStyle = 'rgba(245,158,11,0.5)';
    ctx.fillText('POC', priceAxisX + 4, this.priceToY(pocPrice));

    ctx.restore();
  };



  // ============================================================
  // OF.LiveStream — WebSocket connection to Binance
  // ============================================================

  var WS_BINANCE = 'wss://stream.binance.com:9443/ws/';

  OF.LiveStream = {
    _ws: null,
    _symbol: null,
    _reconnectTimer: null,
    _reconnectAttempts: 0,
    _maxReconnect: 10,
    _reconnectDelay: 1000,
    _onTrade: null,
    _onStatus: null,
    _status: 'disconnected',
    _reconnectScheduled: false, // garde anti-double reconnect
    _streamToken: 0, // incremente à chaque connect → ignore callback obsolètes

    /** Connect to Binance aggTrade stream */
    connect: function (symbol, onTrade, onStatus) {
      this.disconnect();
      this._symbol = symbol.toLowerCase();
      this._onTrade = onTrade;
      this._onStatus = onStatus;
      this._reconnectAttempts = 0;
      this._reconnectScheduled = false;
      this._streamToken++;
      this._connect();
    },

    /** Internal connect */
    _connect: function () {
      if (!this._symbol) return;
      var self = this;
      var token = this._streamToken;

      var url = WS_BINANCE + this._symbol + '@aggTrade';

      try {
        this._ws = new WebSocket(url);
      } catch (e) {
        console.warn('[LiveStream] WS creation failed:', e.message);
        if (token === self._streamToken) self._setStatus('error');
        return;
      }

      // Timeout de connexion
      var connTimeout = setTimeout(function () {
        if (token !== self._streamToken) return;
        if (self._ws && self._ws.readyState === WebSocket.CONNECTING) {
          console.warn('[LiveStream] connection timeout');
          self._neutralizeAndClose();
          self._scheduleReconnect();
        }
      }, 5000);

      this._ws.onopen = function () {
        if (token !== self._streamToken) { self._neutralizeAndClose(); return; }
        clearTimeout(connTimeout);
        self._reconnectAttempts = 0;
        self._reconnectDelay = 1000;
        self._reconnectScheduled = false;
        self._setStatus('connected');
        console.log('[LiveStream] connected to', url);
      };

      this._ws.onmessage = function (e) {
        if (token !== self._streamToken) return;
        try {
          var data = JSON.parse(e.data);
          if (data.e !== 'aggTrade') return;
          var trade = self._normalize(data);
          if (self._onTrade) self._onTrade(trade);
        } catch (err) { /* ignore */ }
      };

      this._ws.onerror = function () {
        if (token !== self._streamToken) return;
        clearTimeout(connTimeout);
        console.warn('[LiveStream] WS error');
      };

      this._ws.onclose = function () {
        clearTimeout(connTimeout);
        if (token !== self._streamToken) return;
        if (self._status === 'disconnected') return; // intentional
        self._setStatus('reconnecting');
        self._scheduleReconnect();
      };
    },

    /** Normalize Binance aggTrade payload to our format */
    _normalize: function (data) {
      return {
        id: data.a,
        time: data.T,
        price: parseFloat(data.p),
        qty: parseFloat(data.q),
        side: data.m ? 'sell' : 'buy',
      };
    },

    /** Neutralise TOUS les callbacks et ferme le socket, meme CONNECTING */
    _neutralizeAndClose: function () {
      if (!this._ws) return;
      // Neutraliser les callbacks pour eviter toute execution future
      this._ws.onopen = null;
      this._ws.onmessage = null;
      this._ws.onerror = null;
      this._ws.onclose = null;
      // Fermer — meme si CONNECTING, close() est safe (la spec WebSocket le gère)
      try { this._ws.close(); } catch (e) { /* ignore */ }
      this._ws = null;
    },

    /** Schedule reconnection avec exponential backoff, avec guard anti-double */
    _scheduleReconnect: function () {
      if (this._reconnectScheduled) return;
      if (this._reconnectAttempts >= this._maxReconnect) {
        this._setStatus('error');
        console.warn('[LiveStream] max reconnects reached');
        return;
      }
      var self = this;
      var delay = this._reconnectDelay;
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, 30000);
      this._reconnectAttempts++;
      this._reconnectScheduled = true;
      console.log('[LiveStream] reconnect in', delay, 'ms (attempt', this._reconnectAttempts + ')');

      if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
      this._reconnectTimer = setTimeout(function () {
        self._reconnectScheduled = false;
        self._connect();
      }, delay);
    },

    /** Disconnect intentionally */
    disconnect: function () {
      this._reconnectScheduled = false;
      this._reconnectAttempts = 0;
      this._reconnectDelay = 1000;
      if (this._reconnectTimer) {
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
      }
      this._neutralizeAndClose();
      this._setStatus('disconnected');
    },

    _setStatus: function (s) {
      this._status = s;
      if (this._onStatus) this._onStatus(s);
    },

    getStatus: function () { return this._status; },
  };

  // ============================================================
  // OrderflowDataService — fetch trades from API
  // ============================================================

  var CACHE_TTL = 30000; // 30s

  OF.DataService = {
    _cache: {},
    _cacheMeta: {}, // metadata complement pour chaque cacheKey

    /** Fetch OHLC klines pour le range complet */
    fetchKlines: function (symbol, interval, startTime, endTime) {
      var rangeMs = endTime - startTime;
      var intervalMs = OF.Aggregator._intervalMs(interval) || 180000;
      var limit = Math.max(1, Math.ceil(rangeMs / intervalMs)) + 3; // buffer pour bougie en cours + offset serveur
      var url = '/api/market/klines?symbol=' + encodeURIComponent(symbol)
        + '&interval=' + encodeURIComponent(interval)
        + '&limit=' + limit;
      if (startTime) url += '&startTime=' + startTime;
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + r.statusText);
        return r.json();
      });
    },

    /** Fetch aggTrades (auto-paginate backend, up to 8000) */
    fetchTrades: function (symbol, startTime, endTime, limit, force) {
      var cacheKey = symbol + ':' + (startTime || '') + ':' + (endTime || '');
      if (!force) {
        var cached = this._cache[cacheKey];
        if (cached && Date.now() - cached.ts < CACHE_TTL) {
          return Promise.resolve(cached.result);
        }
      }

      var self = this;
      var allTrades = [];
      var pagesLeft = 8;
      var currentEnd = endTime;

      function fetchPage() {
        var url = '/api/market/aggtrades?symbol=' + encodeURIComponent(symbol)
          + '&limit=1000';
        if (startTime) url += '&startTime=' + startTime;
        if (currentEnd) url += '&endTime=' + currentEnd;
        if (force) url += '&force=1';

        return fetch(url)
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + r.statusText);
            return r.json();
          })
          .then(function (data) {
            if (data.error) throw new Error(data.error);
            var batch = data.trades || [];
            if (batch.length === 0) return { trades: allTrades, limits: { count: allTrades.length, hitBinanceLimit: false } };

            allTrades = batch.concat(allTrades);
            var lim = limit || 1000;

            if (allTrades.length >= lim || batch.length < 1000 || pagesLeft <= 1) {
              if (allTrades.length > lim) allTrades = allTrades.slice(-lim);
              // Construire les metadata depuis la derniere page
              var meta = {
                firstTradeTime: allTrades.length > 0 ? allTrades[0].time : null,
                lastTradeTime: allTrades.length > 0 ? allTrades[allTrades.length - 1].time : null,
                count: allTrades.length,
                hitBinanceLimit: batch.length >= 1000,
              };
              var result = { trades: allTrades, limits: meta };
              self._cache[cacheKey] = { ts: Date.now(), result: result };
              return result;
            }

            pagesLeft--;
            currentEnd = batch[0].time - 1;
            return fetchPage();
          });
      }

      return fetchPage();
    },

    /** Clear cache (e.g., on symbol change) */
    clearCache: function () {
      this._cache = {};
    }
  };

  // ============================================================
  // OrderflowAggregator — trades → footprint candles
  // ============================================================

  OF.Aggregator = {

    /**
     * Aggregate trades into footprint candles.
     * @param {Array} trades — [{time, price, qty, side}]
     * @param {number} intervalMs — candle interval in ms (e.g. 180000 for 3m)
     * @param {number} tickSize — price bucket size (e.g. 10 for BTC)
     * @returns {Array} footprints candles
     */
    aggregate: function (trades, intervalMs, tickSize) {
      if (!trades || trades.length === 0) return [];

      tickSize = tickSize || 10;
      intervalMs = intervalMs || 180000;

      // Grouper les trades par candle
      var candleMap = {};

      for (var i = 0; i < trades.length; i++) {
        var t = trades[i];
        // Floor au début de la bougie
        var candleTime = Math.floor(t.time / intervalMs) * intervalMs;

        if (!candleMap[candleTime]) {
          candleMap[candleTime] = {
            time: candleTime,
            open: t.price,
            high: t.price,
            low: t.price,
            close: t.price,
            volume: 0,
            delta: 0,
            levels: {}  // {priceKey: {bid, ask, delta}}
          };
        }

        var c = candleMap[candleTime];
        c.high = Math.max(c.high, t.price);
        c.low = Math.min(c.low, t.price);
        c.close = t.price;
        c.volume += t.qty;

        // Price level bucket
        var priceKey = Math.floor(t.price / tickSize) * tickSize;
        if (!c.levels[priceKey]) {
          c.levels[priceKey] = { bid: 0, ask: 0, delta: 0 };
        }

        var lv = c.levels[priceKey];
        if (t.side === 'buy') {
          lv.bid += t.qty;
          lv.delta += t.qty;
          c.delta += t.qty;
        } else {
          lv.ask += t.qty;
          lv.delta -= t.qty;
          c.delta -= t.qty;
        }
      }

      // Convertir en array trié par time
      var candles = Object.keys(candleMap).map(function (k) {
        var c = candleMap[k];
        // Convertir levels en array pour le rendu
        var levelsArr = [];
        var priceKeys = Object.keys(c.levels).map(Number).sort(function (a, b) { return a - b; });
        for (var pi = 0; pi < priceKeys.length; pi++) {
          var pk = priceKeys[pi];
          levelsArr.push({
            price: pk,
            bid: Math.round(c.levels[pk].bid * 100) / 100,
            ask: Math.round(c.levels[pk].ask * 100) / 100,
            delta: Math.round(c.levels[pk].delta * 100) / 100
          });
        }
        c.levels = levelsArr;
        return c;
      });

      candles.sort(function (a, b) { return a.time - b.time; });
      return candles;
    },

    /** Convertir interval string en ms */
    _intervalMs: function (interval) {
      var map = { '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000 };
      return map[interval] || 180000;
    },

    /**
     * Construire des bougies OHLC depuis des klines.
     * Les klines ont time en secondes → converti en ms.
     * @param {Array} klines — [{time, open, high, low, close, volume}]
     * @param {number} intervalMs — intervalle en ms
     * @returns {Array} candles sans footprint (levels=[], delta=0)
     */
    aggregateOHLC: function (klines, intervalMs) {
      if (!klines || klines.length === 0) return [];
      intervalMs = intervalMs || 180000;
      var tickSize = this._tickSize || 10;
      return klines.map(function (k) {
        return {
          time: k.time * 1000,         // klines en secondes → ms
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
          volume: k.volume || 0,
          delta: 0,
          levels: [],
          _fromKline: true
        };
      });
    },

    /**
     * Aggréger des aggTrades en footprintMap indexée par candleTime.
     * @param {Array} trades — [{time(ms), price, qty, side}]
     * @param {number} intervalMs
     * @param {number} tickSize
     * @returns {Object} { candleTime: {delta, levels: [{price, bid, ask, delta}]} }
     */
    buildFootprintMap: function (trades, intervalMs, tickSize) {
      var map = {};
      if (!trades || trades.length === 0) return map;
      tickSize = tickSize || 10;
      intervalMs = intervalMs || 180000;

      for (var i = 0; i < trades.length; i++) {
        var t = trades[i];
        var candleTime = Math.floor(t.time / intervalMs) * intervalMs;
        if (!map[candleTime]) {
          map[candleTime] = { delta: 0, levels: {} };
        }
        var c = map[candleTime];
        var priceKey = Math.floor(t.price / tickSize) * tickSize;
        if (!c.levels[priceKey]) {
          c.levels[priceKey] = { price: priceKey, bid: 0, ask: 0, delta: 0 };
        }
        var lv = c.levels[priceKey];
        if (t.side === 'buy') {
          lv.bid += t.qty;
          lv.delta += t.qty;
          c.delta += t.qty;
        } else {
          lv.ask += t.qty;
          lv.delta -= t.qty;
          c.delta -= t.qty;
        }
      }

      // Convertir levels en arrays
      var result = {};
      var timeKeys = Object.keys(map);
      for (var ti = 0; ti < timeKeys.length; ti++) {
        var tk = Number(timeKeys[ti]);
        var src = map[tk];
        var levelsArr = [];
        var priceKeys = Object.keys(src.levels).map(Number).sort(function (a, b) { return a - b; });
        for (var pi = 0; pi < priceKeys.length; pi++) {
          var pk = priceKeys[pi];
          var lv = src.levels[pk];
          levelsArr.push({
            price: pk,
            bid: Math.round(lv.bid * 100) / 100,
            ask: Math.round(lv.ask * 100) / 100,
            delta: Math.round(lv.delta * 100) / 100
          });
        }
        result[tk] = { delta: Math.round(src.delta * 100) / 100, levels: levelsArr };
      }
      return result;
    },

    /**
     * Fusionner des bougies OHLC avec une footprintMap.
     * Chaque bougie OHLC reçoit levels+delta si la footprintMap a une entrée pour son time.
     * @param {Array} ohlcCandles — de aggregateOHLC()
     * @param {Object} footprintMap — de buildFootprintMap()
     * @returns {Array} candles fusionnées
     */
    mergeOHLCWithFootprint: function (ohlcCandles, footprintMap) {
      return ohlcCandles.map(function (c) {
        var fp = footprintMap[c.time];
        if (fp && fp.levels) {
          c.delta = Number(fp.delta || 0);
          // Convertir l'objet levels (cle=priceKey) en tableau trie
          var levelsArr = [];
          var keys = Object.keys(fp.levels);
          for (var ki = 0; ki < keys.length; ki++) {
            var lv = fp.levels[keys[ki]];
            if (lv && Number.isFinite(lv.price)) {
              levelsArr.push({
                price: Number(lv.price),
                bid: Number(lv.bid || 0),
                ask: Number(lv.ask || 0),
                delta: Number(lv.delta || 0),
              });
            }
          }
          levelsArr.sort(function(a, b) { return a.price - b.price; });
          c.levels = levelsArr;
          c._hasFootprint = true;
        } else {
          c.levels = [];
          c.delta = 0;
          c._hasFootprint = false;
        }
        c._fromKline = true;
        return c;
      });
    },

    /**
     * Appliquer un batch de trades à une footprintMap existante (incrémental).
     * Optimisation: ne pas tout reconstruire à chaque flush live.
     * @param {Object} footprintMap — existant, muté sur place
     * @param {Array} trades — [{time(ms), price, qty, side}]
     * @param {number} intervalMs
     * @param {number} tickSize
     */
    applyTradesToFootprintMap: function (footprintMap, trades, intervalMs, tickSize) {
      tickSize = tickSize || 10;
      intervalMs = intervalMs || 180000;
      for (var i = 0; i < trades.length; i++) {
        var t = trades[i];
        var candleTime = Math.floor(t.time / intervalMs) * intervalMs;
        if (!footprintMap[candleTime]) {
          footprintMap[candleTime] = { delta: 0, levels: {} };
        }
        var c = footprintMap[candleTime];
        var priceKey = Math.floor(t.price / tickSize) * tickSize;
        if (!c.levels[priceKey]) {
          c.levels[priceKey] = { price: priceKey, bid: 0, ask: 0, delta: 0 };
        }
        var lv = c.levels[priceKey];
        if (t.side === 'buy') {
          lv.bid += t.qty;
          lv.delta += t.qty;
          c.delta += t.qty;
        } else {
          lv.ask += t.qty;
          lv.delta -= t.qty;
          c.delta -= t.qty;
        }
      }
      // Convertir les nouvelles entrées de levels en arrays
      var timeKeys = Object.keys(footprintMap);
      for (var ti = 0; ti < timeKeys.length; ti++) {
        var tk = Number(timeKeys[ti]);
        var src = footprintMap[tk];
        if (Array.isArray(src.levels)) continue; // déjà converti
        var levelsArr = [];
        var priceKeys = Object.keys(src.levels).map(Number).sort(function (a, b) { return a - b; });
        for (var pi = 0; pi < priceKeys.length; pi++) {
          var pk = priceKeys[pi];
          var lv = src.levels[pk];
          levelsArr.push({
            price: pk,
            bid: Math.round(lv.bid * 100) / 100,
            ask: Math.round(lv.ask * 100) / 100,
            delta: Math.round(lv.delta * 100) / 100
          });
        }
        src.levels = levelsArr;
      }
    }
  };


})();





