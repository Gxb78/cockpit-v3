// ---------- Interactive empty-space background ----------

(function () {
  var canvas, ctx, rafId;
  var pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999, active: false };
  var cells = [];
  var lastW = 0;
  var lastH = 0;

  function pickCells(w, h) {
    var size = Math.max(44, Math.min(68, Math.round(w / 22)));
    var cols = Math.ceil(w / size) + 2;
    var rows = Math.ceil(h / size) + 2;
    var out = [];
    for (var y = -1; y < rows; y++) {
      for (var x = -1; x < cols; x++) {
        var n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        var r = n - Math.floor(n);
        if (r > 0.78 || (x < 9 && y < 8 && r > 0.60)) {
          out.push({
            x: x * size,
            y: y * size,
            size: size,
            seed: r * 10,
            alpha: 0.08 + r * 0.17,
            hue: r > 0.88 ? "blue" : "red",
          });
        }
      }
    }
    cells = out;
  }

  function resize() {
    if (!canvas) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    lastW = window.innerWidth;
    lastH = window.innerHeight;
    canvas.width = Math.floor(lastW * dpr);
    canvas.height = Math.floor(lastH * dpr);
    canvas.style.width = lastW + "px";
    canvas.style.height = lastH + "px";
    ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pickCells(lastW, lastH);
  }

  function movePointer(e) {
    pointer.tx = e.clientX;
    pointer.ty = e.clientY;
    pointer.active = true;
  }

  function leavePointer() {
    pointer.active = false;
    pointer.tx = -9999;
    pointer.ty = -9999;
  }

  function drawGrid(w, h, t) {
    var grid = 60;
    var offset = (t * 5) % grid;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.018)";
    for (var x = -grid + offset; x < w + grid; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.012)";
    for (var y = 0; y < h + grid; y += grid) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  function draw(tms) {
    if (!ctx || !canvas) return;
    var t = tms * 0.001;
    if (lastW !== window.innerWidth || lastH !== window.innerHeight) resize();

    pointer.x += (pointer.tx - pointer.x) * 0.14;
    pointer.y += (pointer.ty - pointer.y) * 0.14;

    ctx.clearRect(0, 0, lastW, lastH);
    drawGrid(lastW, lastH, t);

    var waveX = (Math.sin(t * 0.16) * 0.5 + 0.5) * lastW;
    var ambient = ctx.createRadialGradient(waveX, lastH * 0.42, 0, waveX, lastH * 0.42, Math.max(lastW, lastH) * 0.42);
    ambient.addColorStop(0, "rgba(120,24,24,0.11)");
    ambient.addColorStop(0.45, "rgba(80,20,20,0.045)");
    ambient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = ambient;
    ctx.fillRect(0, 0, lastW, lastH);

    cells.forEach(function (c) {
      var cx = c.x + c.size / 2;
      var cy = c.y + c.size / 2;
      var dx = cx - pointer.x;
      var dy = cy - pointer.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var avoid = pointer.active ? Math.max(0, 1 - dist / 190) : 0;
      var push = avoid * 34;
      var nx = dist > 0 ? dx / dist : 0;
      var ny = dist > 0 ? dy / dist : 0;
      var driftX = Math.sin(t * 0.26 + c.seed) * 8;
      var driftY = Math.cos(t * 0.21 + c.seed) * 7;
      var x = c.x + driftX + nx * push;
      var y = c.y + driftY + ny * push;
      var pulse = c.alpha + (Math.sin(t * 1.1 + c.seed) * 0.5 + 0.5) * 0.08 + avoid * 0.18;
      var color = c.hue === "blue" ? "48,82,255" : "140,32,32";
      ctx.strokeStyle = "rgba(" + color + "," + pulse.toFixed(3) + ")";
      ctx.fillStyle = "rgba(" + color + "," + (pulse * 0.11).toFixed(3) + ")";
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x + 0.5, y + 0.5, c.size - 1, c.size - 1);
      ctx.fillRect(x + 1, y + 1, c.size - 2, c.size - 2);
    });

    rafId = requestAnimationFrame(draw);
  }

  function initInteractiveBackground() {
    canvas = document.getElementById("interactiveBgCanvas");
    if (!canvas) return;
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", movePointer, { passive: true });
    window.addEventListener("mouseleave", leavePointer);
    if (!rafId) rafId = requestAnimationFrame(draw);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initInteractiveBackground);
  } else {
    initInteractiveBackground();
  }
})();
