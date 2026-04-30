// ---- 052_pretext_greeting.js ----
// Animated greeting with @chenglou/pretext: text flows around a subtle orb.

(function () {
  return;
  var CANVAS_ID = "pretextGreetingCanvas";
  var canvas, ctx, animId;
  var orb = { x: 0.7, y: 0.4, r: 18, vx: 0.001, vy: 0.0006 };
  var cells = [
    { x: 1, y: 1, a: 0.25, d: 0 }, { x: 2, y: 2, a: 0.16, d: 0.4 },
    { x: 3, y: 0, a: 0.30, d: 0.8 }, { x: 3, y: 1, a: 0.22, d: 1.1 },
    { x: 4, y: 1, a: 0.18, d: 1.4 }, { x: 4, y: 2, a: 0.15, d: 1.8 },
    { x: 5, y: 3, a: 0.20, d: 2.0 }, { x: 6, y: 4, a: 0.13, d: 2.5 },
    { x: 7, y: 2, a: 0.16, d: 2.9 }, { x: 8, y: 1, a: 0.22, d: 3.2 },
    { x: 2, y: 6, a: 0.13, d: 3.7 }, { x: 7, y: 6, a: 0.16, d: 4.1 }
  ];
  var pretextModule = null;
  var prepared = null;
  var currentText = "";
  var currentColor = "#00e5ff";

  var GREETINGS = {
    morning: { text: "Bonjour", emoji: "\u2615" },
    afternoon: { text: "Bon apr\u00e8s-midi", emoji: "\u2600" },
    evening: { text: "Bonsoir", emoji: "\u{1F319}" },
    night: { text: "Bonne nuit", emoji: "\u{1F303}" },
  };

  function getGreeting() {
    var h = new Date().getHours();
    if (h < 5) return GREETINGS.night;
    if (h < 12) return GREETINGS.morning;
    if (h < 18) return GREETINGS.afternoon;
    if (h < 22) return GREETINGS.evening;
    return GREETINGS.night;
  }

  function getGreetingText(username) {
    var g = getGreeting();
    var d = new Date();
    var days = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
    var months = ["janv", "f\u00e9vr", "mars", "avr", "mai", "juin",
      "juil", "ao\u00fbt", "sept", "oct", "nov", "d\u00e9c"];
    return g.text + " " + (username || "trader") + " \u00b7 "
      + days[d.getDay()] + " " + d.getDate() + " " + months[d.getMonth()];
  }

  function initCanvas() {
    canvas = document.getElementById(CANVAS_ID);
    if (!canvas) return false;
    var parent = canvas.parentElement;
    canvas.width = parent.offsetWidth;
    canvas.height = parent.offsetHeight;
    ctx = canvas.getContext("2d");
    return true;
  }

  function resizeCanvas() {
    if (!canvas || !canvas.parentElement) return;
    canvas.width = canvas.parentElement.offsetWidth;
    canvas.height = canvas.parentElement.offsetHeight;
  }

  function loadPretext() {
    try {
      return import(
        /* @vite-ignore */
        "https://esm.sh/@chenglou/pretext@0.0.6"
      );
    } catch (e) {
      // Fallback: render static text if Pretext fails to load
      return null;
    }
  }

  function drawFallback() {
    if (!ctx || !canvas) return;
    var w = canvas.width, h = canvas.height;
    ctx.font = '500 22px "Instrument Serif", Georgia, serif';
    ctx.textBaseline = "middle";
    ctx.fillStyle = currentColor;
    ctx.textAlign = "left";
    ctx.fillText(currentText, 4, h / 2 - 2);
    ctx.font = '14px "JetBrains Mono", monospace';
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillText("Trading Journal", 4, h / 2 + 22);
  }

  function drawKineticGrid(timestamp, w, h) {
    var t = timestamp * 0.001;
    var cell = Math.max(38, Math.min(62, Math.floor(w / 14)));
    var cols = Math.ceil(w / cell) + 1;
    var rows = Math.ceil(h / cell) + 1;

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(3,4,6,0.72)";
    ctx.fillRect(0, 0, w, h);

    ctx.lineWidth = 1;
    for (var cx = 0; cx <= cols; cx++) {
      var x = cx * cell + ((Math.sin(t * 0.22) * 8) % cell);
      ctx.strokeStyle = "rgba(255,255,255,0.018)";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (var ry = 0; ry <= rows; ry++) {
      var y = ry * cell;
      ctx.strokeStyle = "rgba(255,255,255,0.014)";
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    var wave = (Math.sin(t * 0.33) * 0.5 + 0.5) * w * 0.42;
    var glow = ctx.createRadialGradient(wave, h * 0.38, 0, wave, h * 0.38, w * 0.28);
    glow.addColorStop(0, "rgba(120,28,28,0.24)");
    glow.addColorStop(0.45, "rgba(120,28,28,0.09)");
    glow.addColorStop(1, "rgba(120,28,28,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    cells.forEach(function (c) {
      var px = c.x * cell + Math.sin(t * 0.18 + c.d) * 10;
      var py = c.y * cell + Math.cos(t * 0.15 + c.d) * 8;
      if (px > w || py > h) return;
      var pulse = c.a + (Math.sin(t * 1.4 + c.d) * 0.5 + 0.5) * 0.10;
      ctx.strokeStyle = "rgba(165,42,42," + pulse.toFixed(3) + ")";
      ctx.fillStyle = "rgba(110,24,24," + (pulse * 0.10).toFixed(3) + ")";
      ctx.lineWidth = 1.2;
      ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
      ctx.fillRect(px + 1, py + 1, cell - 2, cell - 2);
    });

    ctx.restore();
  }

  function animate(timestamp) {
    if (!ctx || !canvas || canvas.width === 0) {
      animId = requestAnimationFrame(animate);
      return;
    }
    var w = canvas.width, h = canvas.height;

    // Update orb position (gentle drift)
    orb.x += orb.vx;
    orb.y += orb.vy;
    // Bounce softly off edges
    if (orb.x < 0.1 || orb.x > 0.9) orb.vx *= -1;
    if (orb.y < 0.1 || orb.y > 0.9) orb.vy *= -1;
    // Keep orb in right third for visual balance
    orb.x = Math.max(0.5, Math.min(0.9, orb.x));

    var ox = orb.x * w;
    var oy = orb.y * h;
    var or = orb.r + Math.sin(timestamp * 0.001) * 2;

    ctx.clearRect(0, 0, w, h);
    drawKineticGrid(timestamp, w, h);

    if (pretextModule && prepared) {
      // Pretext rendering

      var fontSize = h > 80 ? 22 : 18;
      var font = fontSize + 'px "Instrument Serif", Georgia, serif';
      var lineHeight = fontSize + 8;

      var cursor = { segmentIndex: 0, graphemeIndex: 0 };
      var y = 14;
      var padding = 4;

      while (true) {
        // Calculate available width at this y (subtract orb)
        var availW = w - padding * 2;
        // If this line overlaps with orb, carve out space
        var lineCenterY = y + lineHeight / 2;
        var dy = Math.abs(lineCenterY - oy);
        if (dy < or + lineHeight) {
          var carveLeft = ox - or - 6;
          var carveRight = w - (ox + or + 6);
          if (carveLeft > 60) {
            availW = Math.min(availW, carveLeft - padding);
          } else if (carveRight > 60) {
            availW = Math.min(availW, carveRight - padding);
          }
        }

        if (availW < 30) {
          y += lineHeight;
          continue;
        }

        var range = pretextModule.layoutNextLineRange(prepared, cursor, availW);
        if (!range) break;

        var line = pretextModule.materializeLineRange(prepared, range);
        var lineX = padding;

        // If orb is on the left side of this line, shift text right
        if (dy < or + lineHeight && ox < w * 0.5 && line.advance > ox - or) {
          lineX = Math.max(padding, ox + or + 6);
        }

        ctx.font = font;
        ctx.textBaseline = "top";
        ctx.fillStyle = currentColor;
        ctx.fillText(line.text, lineX, y);
        cursor = range.end;
        y += lineHeight;
      }
    } else {
      // Fallback rendering
      drawFallback();
    }

    // Draw the moving focus glow
    var grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, or + 20);
    grad.addColorStop(0, "rgba(0,229,255,0.18)");
    grad.addColorStop(0.4, "rgba(0,229,255,0.06)");
    grad.addColorStop(1, "rgba(0,229,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(ox, oy, or + 20, 0, Math.PI * 2);
    ctx.fill();

    // Draw a small scanner node
    ctx.beginPath();
    ctx.arc(ox, oy, Math.max(3, or * 0.18), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,229,255,0.34)";
    ctx.fill();
    ctx.strokeStyle = "rgba(0,229,255,0.5)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    animId = requestAnimationFrame(animate);
  }

  function initPretextGreeting() {
    var header = document.querySelector(".page[data-page='today'] .page-head");
    if (!header) return;

    // Check if canvas already exists
    if (document.getElementById(CANVAS_ID)) return;

    // Create canvas
    var canvasEl = document.createElement("canvas");
    canvasEl.id = CANVAS_ID;
    canvasEl.className = "pretext-greeting-canvas";
    canvasEl.width = header.offsetWidth || header.clientWidth;
    canvasEl.height = header.offsetHeight || header.clientHeight;
    header.insertBefore(canvasEl, header.firstChild);

    header.classList.add("pretext-head");

    // Get current greeting text
    var nameEl = document.getElementById("todayGreeting");
    var username = nameEl ? nameEl.textContent : null;
    currentText = getGreetingText(username);

    // Pick color based on state
    currentColor = state && state._stats
      ? (state._stats.todayPnl > 0 ? "#88ff5a" : state._stats.todayPnl < 0 ? "#ff4e6b" : "#00e5ff")
      : "#00e5ff";

    if (!initCanvas()) return;

    // Load Pretext
    loadPretext().then(function (mod) {
      pretextModule = mod;
      var fontSize = (canvas.height > 80 ? 22 : 18);
      var font = fontSize + 'px "Instrument Serif", Georgia, serif';
      prepared = mod.prepareWithSegments(currentText, font);
      if (!animId) animate(Date.now());
    }).catch(function () {
      // Fallback animation without Pretext
      currentText = getGreetingText(username);
      if (!animId) animate(Date.now());
    });

    // Resize handler
    window.addEventListener("resize", function () {
      resizeCanvas();
      if (pretextModule && prepared) {
        var fontSize = (canvas.height > 80 ? 22 : 18);
        var font = fontSize + 'px "Instrument Serif", Georgia, serif';
        prepared = pretextModule.prepareWithSegments(currentText, font);
      }
    });

    // Listen for updates
    document.addEventListener("trade:saved", function () {
      // Refresh color based on latest stats
      if (state && state._stats) {
        currentColor = state._stats.todayPnl > 0
          ? "#88ff5a"
          : state._stats.todayPnl < 0
            ? "#ff4e6b"
            : "#00e5ff";
      }
    });
  }

  // Initialize on page show — hook into existing navigation
  function _patchGoPage() {
    var orig = window.goPage;
    if (!orig || window.__pretextPatched) return;
    window.__pretextPatched = true;
    window.goPage = function (pageName) {
      orig(pageName);
      if (pageName === "today" || !pageName) {
        setTimeout(initPretextGreeting, 100);
      }
    };
  }

  // Init on DOMContentLoaded if today page is active
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      if (document.querySelector(".page[data-page='today'].active")) {
        setTimeout(initPretextGreeting, 200);
      }
      _patchGoPage();
    });
  } else {
    if (document.querySelector(".page[data-page='today'].active")) {
      setTimeout(initPretextGreeting, 200);
    }
    _patchGoPage();
  }
})();
