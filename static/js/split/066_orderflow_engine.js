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

  var OF = window.OF = {};

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

    // Dernières dimensions connues (pour détecter les changements)
    this._lastW = 0;
    this._lastH = 0;

    // Binding des events
    this._bindEvents();

    // Candles data
    this._candles = [];
    this._isLiveData = false;
    this._loading = false;
    this._error = null;
    this._symbol = 'BTCUSDT';
    this._interval = '3m';
    this._tickSize = 10;
    this._intervalMs = 180000;

    // Statut
    this._setStatus('ready');
    console.log('[OrderflowEngine] initialized');

    // Load mock data
    this._loadMockData();
  }

  OrderflowEngine.prototype._setStatus = function (msg) {
    var el = document.getElementById('ofStatus');
    if (el) el.textContent = msg;
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
    // CSS gère l'affichage

    // Mettre à jour les scales
    this.priceScale.height = h;
    this.timeScale.width = w;

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this._dirty = true;
  };

  // ============================================================
  // Events
  // ============================================================

  OrderflowEngine.prototype._bindEvents = function () {
    var self = this;
    var c = this.canvas;

    // Mouse wheel — scroll temps (defaut), zoom prix (Shift+wheel)
    c.addEventListener('wheel', function (e) {
      e.preventDefault();

      if (e.ctrlKey || e.metaKey) {
        // Ctrl+Wheel = zoom prix
        self._zoomPrice(e.offsetY, e.deltaY < 0 ? 1.08 : 0.92);
        return;
      }

      if (e.deltaY !== 0) {
        if (e.shiftKey) {
          // Shift+Wheel = scroll temps (horizontal)
          var p = Math.abs(e.deltaY) * 0.6;
          self._scrollTime(e.deltaY > 0 ? 1 : -1, p);
        } else {
          // Wheel = scroll prix (vertical) - comme une page
          self._panPrice(e.deltaY * 0.5);
        }
      }

      if (e.deltaX !== 0) {
        // Trackpad lateral = scroll temps
        self._scrollTime(e.deltaX > 0 ? 1 : -1, Math.abs(e.deltaX) * 0.6);
      }
    }, { passive: false });

    // Mouse down — début du drag
    c.addEventListener('mousedown', function (e) {
      self.isDragging = true;
      self.dragStart.x = e.offsetX;
      self.dragStart.y = e.offsetY;
      self.scrollStart.time = self.timeScale.startTime;
      self.scrollStart.price = self.priceScale.minPrice;
    });

    // Mouse move — drag / crosshair
    c.addEventListener('mousemove', function (e) {
      self.mousePos.x = e.offsetX;
      self.mousePos.y = e.offsetY;
      self.inCanvas = true;

      if (self.isDragging) {
        var dx = e.offsetX - self.dragStart.x;
        var dy = e.offsetY - self.dragStart.y;
        self._pan(dx, dy);
      } else {
        self._dirty = true;
      }
    });

    // Mouse up — fin du drag
    c.addEventListener('mouseup', function () {
      self.isDragging = false;
    });

    // Mouse leave
    c.addEventListener('mouseleave', function () {
      self.inCanvas = false;
      self.isDragging = false;
      self._dirty = true;
    });

    // Double-click — reset zoom
    c.addEventListener('dblclick', function () {
      self._resetView();
    });

    // Resize
    window.addEventListener('resize', function () {
      self._handleResize();
    });

    // Symbol buttons
    self._bindTopbarClicks();
  };

  /** Bind clicks on topbar symbol/timeframe buttons */
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
        self.loadData(symbol, self._interval);
      });
    });

    tfBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var interval = this.dataset.interval;
        if (interval === self._interval) return;
        tfBtns.forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        self._interval = interval;
        self.loadData(self._symbol, interval);
      });
    });
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
   * Zoom vertical centré sur un pixel Y
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

    ps.minPrice = centerPrice - (centerPrice - ps.minPrice) * (newRange / range);
    ps.maxPrice = ps.minPrice + newRange;

    this._dirty = true;
  };

  /**
   * Pan horizontal + vertical
   */
  OrderflowEngine.prototype._pan = function (dx, dy) {
    var ps = this.priceScale;
    var ts = this.timeScale;

    // Horizontal
    var dt = -dx / ts.pixelsPerMs;
    ts.startTime = this.scrollStart.time + dt;
    ts.endTime = ts.startTime + (this.timeScale.width - ts.leftMargin - ts.rightMargin) / ts.pixelsPerMs;

    // Vertical
    var dp = dy / ps.pixelsPerUnit;
    ps.minPrice = this.scrollStart.price + dp;
    ps.maxPrice = ps.minPrice + (this.priceScale.height - ps.topMargin - ps.bottomMargin) / ps.pixelsPerUnit;

    this._dirty = true;
  };

  /**
   * Scroll horizontal par ticks
   */
  OrderflowEngine.prototype._scrollTime = function (dir, pixels) {
    var ts = this.timeScale;
    var dt = (pixels * dir) / ts.pixelsPerMs;
    ts.startTime += dt;
    ts.endTime += dt;
    this._dirty = true;
  };

  /**
   * Reset view — tout afficher
   */
  OrderflowEngine.prototype._resetView = function () {
    var now = Date.now();
    this.timeScale.startTime = now - 24 * 60 * 60 * 1000;
    this.timeScale.endTime = now;
    this.priceScale.minPrice = 60000;
    this.priceScale.maxPrice = 75000;
    this._dirty = true;
  };

  // ============================================================
  // Rendu
  // ============================================================

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
      this._dirty = true;
      // console.log('[OF] resize', rw, rh, 'dpr', this.dpr);
    }

    if (!this._dirty) return;
    this._dirty = false;

    // Protection: ne pas render si dimensions 0
    if (rw < 1 || rh < 1) return;
    
    var w = rw;
    var h = rh;

    // --- Clear ---
    ctx.clearRect(0, 0, w, h);

    // --- Background ---
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, w, h);

    // --- Grille ---
    this._drawGrid(ctx, w, h);

    // --- Footprint candles ---
    if (this._candles.length > 0) {
      this._drawFootprint(ctx, w, h);
      this._drawVolumeProfile(ctx, w, h);
    }

    // --- Axe prix (Y à droite) ---
    this._drawPriceAxis(ctx, w, h);

    // --- Axe temps (X en bas) ---
    this._drawTimeAxis(ctx, w, h);

    // --- Crosshair ---
    if (this.inCanvas) {
      this._drawCrosshair(ctx, w, h);
    }

    // --- Status bar info ---
    if (this.inCanvas) {
      this._drawTooltip(ctx);
    }
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
      if (y < ps.topMargin || y > h - ps.bottomMargin) continue;
      ctx.beginPath();
      ctx.moveTo(ts.leftMargin, y);
      ctx.lineTo(w - 10, y);
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
      if (y < ps.topMargin || y > h - ps.bottomMargin) continue;
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
      if (x < ts.leftMargin || x > w - ts.rightMargin) continue;

      // Petite marque
      ctx.beginPath();
      ctx.moveTo(x, h - ps.bottomMargin + 4);
      ctx.lineTo(x, h - ps.bottomMargin + 8);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Label
      var d = new Date(t);
      ctx.fillText(
        ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2),
        x, h - ps.bottomMargin + 10
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

    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;

    // Ligne verticale
    ctx.beginPath();
    ctx.moveTo(mx, ps.topMargin);
    ctx.lineTo(mx, h - ps.bottomMargin);
    ctx.stroke();

    // Ligne horizontale
    ctx.beginPath();
    ctx.moveTo(this.timeScale.leftMargin, my);
    ctx.lineTo(w - 10, my);
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
    ps.minPrice += dp;
    ps.maxPrice += dp;
    this._dirty = true;
  };

  // ============================================================
  // Boucle rAF
  // ============================================================

  OrderflowEngine.prototype.start = function () {
    var self = this;
    function loop() {
      self.render();
      requestAnimationFrame(loop);
    }
    loop();
  };

  // ============================================================
  // Init automatique
  // ============================================================

  function initOrderflow() {
    if (document.querySelector('.page[data-page="orderflow"]')) {
      var engine = new OrderflowEngine('ofCanvas');
      window.__ofEngine = engine;
      engine.start();
    }
  }

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
    this._symbol = symbol || this._symbol;
    this._interval = interval || this._interval;
    this._intervalMs = this._intervalToMs(this._interval);
    this._loading = true;
    this._error = null;
    this._setStatus('loading ' + this._symbol + ' ' + this._interval + '...');

    var now = Date.now();
    var rangeMs = 12 * 60 * 60 * 1000; // 12h de données
    var startTime = now - rangeMs;

    OF.DataService.fetchTrades(this._symbol, startTime, now, 3000)
      .then(function (trades) {
        if (!trades || trades.length === 0) {
          throw new Error('Aucune trade recue pour ' + self._symbol);
        }
        var candles = OF.Aggregator.aggregate(trades, self._intervalMs, self._tickSize);
        if (candles.length === 0) {
          throw new Error('Aggregation vide');
        }

        self._candles = candles;
        self._isLiveData = true;
        self._loading = false;

        // Ajuster les scales
        self._fitToData();
        self._dirty = true;
        self._setStatus(self._symbol + ' ' + self._interval + ' (' + candles.length + ' candles, ' + trades.length + ' trades)');
      })
      .catch(function (err) {
        console.warn('[OF] API error, fallback mock:', err.message);
        self._error = err.message;
        self._isLiveData = false;
        self._loadMockData();
        self._setStatus('mock (API: ' + err.message + ')');
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
    var pad = (maxP - minP) * 0.1 || 100;
    this.priceScale.minPrice = minP - pad;
    this.priceScale.maxPrice = maxP + pad;
    this.timeScale.startTime = candles[0].time;
    this.timeScale.endTime = candles[candles.length - 1].time + this._intervalMs * 3;
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
    this._setStatus('mock ' + this._candles.length + ' candles');
  };

  // ============================================================
  // Footprint renderer
  // ============================================================

  OrderflowEngine.prototype._drawFootprint = function (ctx, w, h) {
    var candles = this._candles;
    if (!candles || candles.length === 0) return;

    var ps = this.priceScale;
    var ts = this.timeScale;
    var visibleStart = ts.startTime;
    var visibleEnd = ts.endTime;

    // Espacement entre bougies
    var candleGap = 0.2; // 20% de l'espace en gap
    var candleW = (ts.pixelsPerMs * (candles[1] ? (candles[1].time - candles[0].time) : 180000)) * (1 - candleGap);
    if (candleW < 4) candleW = 4;
    if (candleW > 40) candleW = 40;

    for (var i = 0; i < candles.length; i++) {
      var c = candles[i];
      if (c.time < visibleStart - 60000 || c.time > visibleEnd + 60000) continue;

      var cx = this.timeToX(c.time);
      if (cx < -candleW || cx > w + candleW) continue;

      var yOpen = this.priceToY(c.open);
      var yClose = this.priceToY(c.close);
      var yHigh = this.priceToY(c.high);
      var yLow = this.priceToY(c.low);

      var isBull = c.close >= c.open;

      // --- Wick ---
      ctx.strokeStyle = isBull ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, yHigh);
      ctx.lineTo(cx, yLow);
      ctx.stroke();

      // --- Body ---
      var bodyTop = Math.max(yOpen, yClose);
      var bodyBottom = Math.min(yOpen, yClose);
      var bodyH = bodyBottom - bodyTop;
      if (bodyH < 2) bodyH = 2;

      ctx.fillStyle = isBull ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)';
      ctx.fillRect(cx - candleW / 2, bodyTop, candleW, bodyH);

      // --- Footprint levels ---
      if (!c.levels || c.levels.length === 0) continue;

      // Find max volumes in this candle for scaling
      var maxBid = 0, maxAsk = 0;
      for (var li = 0; li < c.levels.length; li++) {
        var lv = c.levels[li];
        if (lv.bid > maxBid) maxBid = lv.bid;
        if (lv.ask > maxAsk) maxAsk = lv.ask;
      }
      if (maxBid < 1) maxBid = 1;
      if (maxAsk < 1) maxAsk = 1;

      var halfW = candleW / 2;

      for (var li = 0; li < c.levels.length; li++) {
        var lv = c.levels[li];
        var y = this.priceToY(lv.price);

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

  // ============================================================
  // Volume Profile renderer (side histogram)
  // ============================================================

  OrderflowEngine.prototype._drawVolumeProfile = function (ctx, w, h) {
    var candles = this._candles;
    if (!candles || candles.length === 0) return;

    var ps = this.priceScale;
    var ts = this.timeScale;
    var vpWidth = 60; // pixels for VP panel
    var vpX = w - vpWidth - 5; // position (just left of price axis)

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

    // Draw VP histogram
    for (var pi = 0; pi < prices.length; pi++) {
      var price = prices[pi];
      var vol = volMap[price];
      var y = this.priceToY(price);
      var barW = (vol / maxVolLevel) * vpWidth;

      // VA range: ligne horizontale subtile aux extremites
      if (price <= vah && price >= val && (price === vah || price === val)) {
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(vpX, y);
        ctx.lineTo(vpX + vpWidth, y);
        ctx.stroke();
      }

      // Volume bar
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(vpX + vpWidth - barW, y - 3, barW, 6);

      // POC line
      if (price === pocPrice) {
        ctx.strokeStyle = 'rgba(245,158,11,0.6)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(vpX, y);
        ctx.lineTo(vpX + vpWidth, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // VAH/VAL labels
    ctx.font = '8px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(34,197,94,0.5)';
    ctx.textAlign = 'left';
    ctx.fillText('VAH', vpX + vpWidth + 4, this.priceToY(vah) + 3);
    ctx.fillStyle = 'rgba(239,68,68,0.5)';
    ctx.fillText('VAL', vpX + vpWidth + 4, this.priceToY(val) + 3);

    // POC label
    ctx.fillStyle = 'rgba(245,158,11,0.7)';
    ctx.fillText('POC', vpX + vpWidth + 4, this.priceToY(pocPrice) + 3);
  };



  // ============================================================
  // OrderflowDataService — fetch trades from API
  // ============================================================

  var CACHE_TTL = 30000; // 30s

  OF.DataService = {
    _cache: {},

    /** Fetch aggTrades (auto-paginate: max 5 pages x 1000 = 5000 trades) */
    fetchTrades: function (symbol, startTime, endTime, limit) {
      var cacheKey = symbol + ':' + (startTime || '') + ':' + (endTime || '');
      var cached = this._cache[cacheKey];
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return Promise.resolve(cached.trades);
      }

      var self = this;
      var allTrades = [];
      var pagesLeft = 5;
      var currentEnd = endTime;

      function fetchPage() {
        var url = '/api/market/aggtrades?symbol=' + encodeURIComponent(symbol)
          + '&limit=1000';
        if (startTime) url += '&startTime=' + startTime;
        if (currentEnd) url += '&endTime=' + currentEnd;

        return fetch(url)
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + r.statusText);
            return r.json();
          })
          .then(function (data) {
            if (data.error) throw new Error(data.error);
            var batch = data.trades || [];
            if (batch.length === 0) return allTrades;

            allTrades = batch.concat(allTrades);
            var lim = limit || 1000;

            if (allTrades.length >= lim || batch.length < 1000 || pagesLeft <= 1) {
              if (allTrades.length > lim) allTrades = allTrades.slice(-lim);
              self._cache[cacheKey] = { ts: Date.now(), trades: allTrades };
              return allTrades;
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
    }
  };


})();
