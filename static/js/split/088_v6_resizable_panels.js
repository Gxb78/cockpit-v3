// 088_v6_resizable_panels.js
// Resizable panels: library-free pointer-based resize for right dock and CVD strip.
// Controls right dock (.v6-right-col) width & bottom CVD panel (.v6-cvd-strip) height.
// Uses Pointer Events. Automatically persists sizes in localStorage.
// Triggers redraw of both canvas charts to prevent blur or incorrect bounds.

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

  var MIN_RIGHT_WIDTH = 240;
  var MAX_RIGHT_WIDTH = 760;
  var MIN_CVD_HEIGHT = 120;
  var MAX_CVD_HEIGHT = 420;

  var STORAGE_WIDTH_KEY = 'cockpitV6.rightColWidth';
  var STORAGE_LEFT_WIDTH_KEY = 'cockpitV6.leftColWidth';
  var STORAGE_HEIGHT_KEY = 'cockpitV6.cvdStripHeight';

  function applyCvdHeight(root, cvdStrip, height) {
    if (!cvdStrip || !height) return;
    var h = Math.max(MIN_CVD_HEIGHT, Math.min(MAX_CVD_HEIGHT, parseInt(height, 10)));
    cvdStrip.style.height = h + 'px';
    cvdStrip.style.flex = '0 0 ' + h + 'px';
    var centerCol = root && root.querySelector('.v6-center-col');
    if (centerCol) centerCol.style.setProperty('--v6-cvd-strip-height', h + 'px');
  }

  var redrawQueued = false;
  function redrawCharts(root) {
    if (redrawQueued) return;
    redrawQueued = true;
    var schedule = typeof requestAnimationFrame === 'function' && !document.hidden
      ? requestAnimationFrame
      : function (fn) { return setTimeout(fn, 33); };
    schedule(function () {
      redrawQueued = false;
      var chartCanvas = root && root.querySelector ? root.querySelector('[data-v6-chart]') : document.querySelector('[data-v6-chart]');
      var store = V6OF.getStore ? V6OF.getStore(chartCanvas || root) : null;
      if (!store) return;
      var state = store.getState();
      if (chartCanvas && V6OF.CanvasChart) {
        V6OF.CanvasChart.draw(chartCanvas, state);
      }
      var cvdCanvas = root && root.querySelector ? root.querySelector('[data-v6-cvd-canvas]') : document.querySelector('[data-v6-cvd-canvas]');
      if (cvdCanvas && V6OF.CvdPanel) {
        var cvdStrip = root && root.querySelector ? root.querySelector('[data-v6-cvd-strip]') : document.querySelector('[data-v6-cvd-strip]');
        if (cvdStrip && !cvdStrip.classList.contains('is-collapsed')) {
          V6OF.CvdPanel.draw(cvdCanvas, state);
        }
      }
    });
  }

  V6OF.register('UI', 'ResizablePanels', {
    init: function (root) {
      if (!root) return;
      var mainArea = root.querySelector('.v6-main-area');
      var centerCol = root.querySelector('.v6-center-col');
      var rightCol = root.querySelector('.v6-right-col');
      var leftCol = root.querySelector('[data-v6-left-col]');
      var cvdStrip = root.querySelector('[data-v6-cvd-strip]');
      if (!mainArea || !centerCol || !rightCol || !cvdStrip) return;

      // Restore sizes
      var savedWidth = localStorage.getItem(STORAGE_WIDTH_KEY);
      if (savedWidth) {
        var w = Math.max(MIN_RIGHT_WIDTH, Math.min(MAX_RIGHT_WIDTH, parseInt(savedWidth, 10)));
        rightCol.style.width = w + 'px';
        rightCol.style.flex = '0 1 ' + w + 'px';
      }

      var savedLeftWidth = localStorage.getItem(STORAGE_LEFT_WIDTH_KEY);
      if (savedLeftWidth && leftCol) {
        var wl = Math.max(MIN_RIGHT_WIDTH, Math.min(MAX_RIGHT_WIDTH, parseInt(savedLeftWidth, 10)));
        leftCol.style.width = wl + 'px';
        leftCol.style.flex = '0 1 ' + wl + 'px';
      }

      var savedHeight = localStorage.getItem(STORAGE_HEIGHT_KEY);
      if (savedHeight) {
        var h = Math.max(MIN_CVD_HEIGHT, Math.min(MAX_CVD_HEIGHT, parseInt(savedHeight, 10)));
        applyCvdHeight(root, cvdStrip, h);
      } else {
        applyCvdHeight(root, cvdStrip, cvdStrip.offsetHeight || MIN_CVD_HEIGHT);
      }

      // 1. Horizontal Resize (Right Dock Width)
      var handleH = root.querySelector('.v6-resize-h');
      if (handleH) {
        var isDraggingH = false;
        var startX = 0;
        var startWidth = 0;
        var pendingWidth = 0;

        handleH.addEventListener('pointerdown', function (e) {
          isDraggingH = true;
          startX = e.clientX;
          startWidth = rightCol.offsetWidth;
          handleH.classList.add('is-dragging');
          mainArea.classList.add('v6-resizing-active');
          handleH.setPointerCapture(e.pointerId);
          e.preventDefault();
        });

        handleH.addEventListener('pointermove', function (e) {
          if (!isDraggingH) return;
          var dx = e.clientX - startX;
          // Moving left (negative dx) increases right-dock size
          var nextWidth = Math.max(MIN_RIGHT_WIDTH, Math.min(MAX_RIGHT_WIDTH, startWidth - dx));
          pendingWidth = nextWidth;
          rightCol.style.width = nextWidth + 'px';
          rightCol.style.flex = '0 1 ' + nextWidth + 'px';
          redrawCharts(root);
        });

        var onPointerUpH = function (e) {
          if (!isDraggingH) return;
          isDraggingH = false;
          handleH.classList.remove('is-dragging');
          mainArea.classList.remove('v6-resizing-active');
          if (pendingWidth) localStorage.setItem(STORAGE_WIDTH_KEY, pendingWidth);
          try { handleH.releasePointerCapture(e.pointerId); } catch (_) {}
          redrawCharts(root);
        };

        handleH.addEventListener('pointerup', onPointerUpH);
        handleH.addEventListener('pointercancel', onPointerUpH);
      }

      // 1b. Horizontal Resize (Left Dock Width)
      var handleHLeft = root.querySelector('[data-v6-resize-h-left]');
      if (handleHLeft && leftCol) {
        var isDraggingHLeft = false;
        var startXLeft = 0;
        var startWidthLeft = 0;
        var pendingWidthLeft = 0;

        handleHLeft.addEventListener('pointerdown', function (e) {
          isDraggingHLeft = true;
          startXLeft = e.clientX;
          startWidthLeft = leftCol.offsetWidth;
          handleHLeft.classList.add('is-dragging');
          mainArea.classList.add('v6-resizing-active');
          handleHLeft.setPointerCapture(e.pointerId);
          e.preventDefault();
        });

        handleHLeft.addEventListener('pointermove', function (e) {
          if (!isDraggingHLeft) return;
          var dx = e.clientX - startXLeft;
          // Moving right (positive dx) increases left-dock size
          var nextWidth = Math.max(MIN_RIGHT_WIDTH, Math.min(MAX_RIGHT_WIDTH, startWidthLeft + dx));
          pendingWidthLeft = nextWidth;
          leftCol.style.width = nextWidth + 'px';
          leftCol.style.flex = '0 1 ' + nextWidth + 'px';
          redrawCharts(root);
        });

        var onPointerUpHLeft = function (e) {
          if (!isDraggingHLeft) return;
          isDraggingHLeft = false;
          handleHLeft.classList.remove('is-dragging');
          mainArea.classList.remove('v6-resizing-active');
          if (pendingWidthLeft) localStorage.setItem(STORAGE_LEFT_WIDTH_KEY, pendingWidthLeft);
          try { handleHLeft.releasePointerCapture(e.pointerId); } catch (_) {}
          redrawCharts(root);
        };

        handleHLeft.addEventListener('pointerup', onPointerUpHLeft);
        handleHLeft.addEventListener('pointercancel', onPointerUpHLeft);
      }

      // 2. Vertical Resize (CVD Strip Height)
      var handleV = root.querySelector('.v6-resize-v');
      if (handleV) {
        var isDraggingV = false;
        var startY = 0;
        var startHeight = 0;
        var pendingHeight = 0;

        handleV.addEventListener('pointerdown', function (e) {
          if (cvdStrip.classList.contains('is-collapsed')) return; // ignore if collapsed
          isDraggingV = true;
          startY = e.clientY;
          startHeight = cvdStrip.offsetHeight;
          handleV.classList.add('is-dragging');
          mainArea.classList.add('v6-resizing-active');
          handleV.setPointerCapture(e.pointerId);
          e.preventDefault();
        });

        handleV.addEventListener('pointermove', function (e) {
          if (!isDraggingV) return;
          var dy = e.clientY - startY;
          // Moving up (negative dy) increases CVD strip height
          var nextHeight = Math.max(MIN_CVD_HEIGHT, Math.min(MAX_CVD_HEIGHT, startHeight - dy));
          pendingHeight = nextHeight;
          applyCvdHeight(root, cvdStrip, nextHeight);
          redrawCharts();
        });

        var onPointerUpV = function (e) {
          if (!isDraggingV) return;
          isDraggingV = false;
          handleV.classList.remove('is-dragging');
          mainArea.classList.remove('v6-resizing-active');
          if (pendingHeight) localStorage.setItem(STORAGE_HEIGHT_KEY, pendingHeight);
          try { handleV.releasePointerCapture(e.pointerId); } catch (_) {}
          redrawCharts();
        };

        handleV.addEventListener('pointerup', onPointerUpV);
        handleV.addEventListener('pointercancel', onPointerUpV);
      }
    },

    restoreSizes: function (root, width, height, leftWidth) {
      if (!root) return;
      var rightCol = root.querySelector('.v6-right-col');
      var leftCol = root.querySelector('[data-v6-left-col]');
      var cvdStrip = root.querySelector('[data-v6-cvd-strip]');
      if (rightCol && width) {
        var w = Math.max(MIN_RIGHT_WIDTH, Math.min(MAX_RIGHT_WIDTH, width));
        rightCol.style.width = w + 'px';
        rightCol.style.flex = '0 1 ' + w + 'px';
        localStorage.setItem(STORAGE_WIDTH_KEY, w);
      }
      if (leftCol && leftWidth) {
        var wl = Math.max(MIN_RIGHT_WIDTH, Math.min(MAX_RIGHT_WIDTH, leftWidth));
        leftCol.style.width = wl + 'px';
        leftCol.style.flex = '0 1 ' + wl + 'px';
        localStorage.setItem(STORAGE_LEFT_WIDTH_KEY, wl);
      }
      if (cvdStrip && height) {
        var h = Math.max(MIN_CVD_HEIGHT, Math.min(MAX_CVD_HEIGHT, height));
        applyCvdHeight(root, cvdStrip, h);
        localStorage.setItem(STORAGE_HEIGHT_KEY, h);
      }
      redrawCharts();
    }
  }, 'ResizablePanels');
})();
