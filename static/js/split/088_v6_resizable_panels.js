// 088_v6_resizable_panels.js
// Phase 20: Library-free resizable panels for Cockpit V6.
// Controls right dock (.v6-right-col) width & bottom CVD panel (.v6-cvd-strip) height.
// Uses Pointer Events. Automatically persists sizes in localStorage.
// Triggers redraw of both canvas charts to prevent blur or incorrect bounds.

(function () {
  'use strict';
  var V6OF = window.V6OF = window.V6OF || {};

  var MIN_RIGHT_WIDTH = 260;
  var MAX_RIGHT_WIDTH = 520;
  var MIN_CVD_HEIGHT = 120;
  var MAX_CVD_HEIGHT = 420;

  var STORAGE_WIDTH_KEY = 'cockpitV6.rightColWidth';
  var STORAGE_HEIGHT_KEY = 'cockpitV6.cvdStripHeight';

  var redrawQueued = false;
  function redrawCharts() {
    if (redrawQueued) return;
    redrawQueued = true;
    var schedule = typeof requestAnimationFrame === 'function' && !document.hidden
      ? requestAnimationFrame
      : function (fn) { return setTimeout(fn, 33); };
    schedule(function () {
      redrawQueued = false;
      if (!V6OF.store) return;
      var state = V6OF.store.getState();
      var chartCanvas = document.querySelector('[data-v6-chart]');
      if (chartCanvas && V6OF.CanvasChart) {
        V6OF.CanvasChart.draw(chartCanvas, state);
      }
      var cvdCanvas = document.querySelector('[data-v6-cvd-canvas]');
      if (cvdCanvas && V6OF.CvdPanel) {
        var cvdStrip = document.querySelector('[data-v6-cvd-strip]');
        if (cvdStrip && !cvdStrip.classList.contains('is-collapsed')) {
          V6OF.CvdPanel.draw(cvdCanvas, state);
        }
      }
    });
  }

  V6OF.ResizablePanels = {
    init: function (root) {
      if (!root) return;
      var mainArea = root.querySelector('.v6-main-area');
      var centerCol = root.querySelector('.v6-center-col');
      var rightCol = root.querySelector('.v6-right-col');
      var cvdStrip = root.querySelector('[data-v6-cvd-strip]');
      if (!mainArea || !centerCol || !rightCol || !cvdStrip) return;

      // Restore sizes
      var savedWidth = localStorage.getItem(STORAGE_WIDTH_KEY);
      if (savedWidth) {
        var w = Math.max(MIN_RIGHT_WIDTH, Math.min(MAX_RIGHT_WIDTH, parseInt(savedWidth, 10)));
        rightCol.style.width = w + 'px';
        rightCol.style.flex = '0 0 ' + w + 'px';
      }

      var savedHeight = localStorage.getItem(STORAGE_HEIGHT_KEY);
      if (savedHeight) {
        var h = Math.max(MIN_CVD_HEIGHT, Math.min(MAX_CVD_HEIGHT, parseInt(savedHeight, 10)));
        cvdStrip.style.height = h + 'px';
        cvdStrip.style.flex = '0 0 ' + h + 'px';
      }

      // 1. Horizontal Resize (Right Dock Width)
      var handleH = root.querySelector('.v6-resize-h');
      if (handleH) {
        var isDraggingH = false;
        var startX = 0;
        var startWidth = 0;

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
          rightCol.style.width = nextWidth + 'px';
          rightCol.style.flex = '0 0 ' + nextWidth + 'px';
          localStorage.setItem(STORAGE_WIDTH_KEY, nextWidth);
          redrawCharts();
        });

        var onPointerUpH = function (e) {
          if (!isDraggingH) return;
          isDraggingH = false;
          handleH.classList.remove('is-dragging');
          mainArea.classList.remove('v6-resizing-active');
          try { handleH.releasePointerCapture(e.pointerId); } catch (_) {}
          redrawCharts();
        };

        handleH.addEventListener('pointerup', onPointerUpH);
        handleH.addEventListener('pointercancel', onPointerUpH);
      }

      // 2. Vertical Resize (CVD Strip Height)
      var handleV = root.querySelector('.v6-resize-v');
      if (handleV) {
        var isDraggingV = false;
        var startY = 0;
        var startHeight = 0;

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
          cvdStrip.style.height = nextHeight + 'px';
          cvdStrip.style.flex = '0 0 ' + nextHeight + 'px';
          localStorage.setItem(STORAGE_HEIGHT_KEY, nextHeight);
          redrawCharts();
        });

        var onPointerUpV = function (e) {
          if (!isDraggingV) return;
          isDraggingV = false;
          handleV.classList.remove('is-dragging');
          mainArea.classList.remove('v6-resizing-active');
          try { handleV.releasePointerCapture(e.pointerId); } catch (_) {}
          redrawCharts();
        };

        handleV.addEventListener('pointerup', onPointerUpV);
        handleV.addEventListener('pointercancel', onPointerUpV);
      }
    },

    restoreSizes: function (root, width, height) {
      if (!root) return;
      var rightCol = root.querySelector('.v6-right-col');
      var cvdStrip = root.querySelector('[data-v6-cvd-strip]');
      if (rightCol && width) {
        var w = Math.max(MIN_RIGHT_WIDTH, Math.min(MAX_RIGHT_WIDTH, width));
        rightCol.style.width = w + 'px';
        rightCol.style.flex = '0 0 ' + w + 'px';
        localStorage.setItem(STORAGE_WIDTH_KEY, w);
      }
      if (cvdStrip && height) {
        var h = Math.max(MIN_CVD_HEIGHT, Math.min(MAX_CVD_HEIGHT, height));
        cvdStrip.style.height = h + 'px';
        cvdStrip.style.flex = '0 0 ' + h + 'px';
        localStorage.setItem(STORAGE_HEIGHT_KEY, h);
      }
      redrawCharts();
    }
  };
})();
