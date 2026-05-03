// ---------- Favorites Carousel Widget (reuses journal flip card) ----------
// Uses journalTradeFlipCardHtml() so recto/verso is identical to journal.

(function () {
  'use strict';

  var _trades       = [];
  var _currentIndex = 0;
  var _observer     = null;

  // ── Render / init ──────────────────────────────────────────
  function initFavCarousel() {
    var track   = document.getElementById('favCarouselTrack');
    var empty   = document.getElementById('favCarouselEmpty');
    var countEl = document.getElementById('favCarouselCount');
    if (!track) return;

    // Show skeleton
    track.innerHTML = '<div class="fav-skeleton"></div>';
    if (empty) empty.style.display = 'none';

    fetch('/api/trades/favorites')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        _trades = Array.isArray(data) ? data : [];
        _currentIndex = 0;
        track.innerHTML = '';

        if (_observer) { _observer.disconnect(); _observer = null; }

        if (_trades.length === 0) {
          if (empty)   { empty.style.display = ''; }
          if (countEl) { countEl.textContent = ''; }
          _updateDots(0);
          _updateArrows();
          return;
        }

        if (empty) empty.style.display = 'none';
        _updateCount();

        _trades.forEach(function (trade, i) {
          var day = {
            id: trade.day_id,
            instrument: trade.day_instrument || '-',
            date: trade.day_date || (trade.created_at ? trade.created_at.slice(0, 10) : ''),
          };

          var slide = document.createElement('div');
          slide.className = 'fav-carousel-slide';
          slide.dataset.index = i;

          if (typeof journalTradeFlipCardHtml === 'function') {
            slide.innerHTML = journalTradeFlipCardHtml(day, trade, i + 1, [trade]);
          }

          track.appendChild(slide);
        });

        _updateDots(_trades.length);
        _updateArrows();
        _setupObserver();
      })
      .catch(function (err) {
        console.error('[fav-carousel]', err);
        track.innerHTML = '';
        if (empty) empty.style.display = '';
        if (countEl) countEl.textContent = '';
        _updateDots(0);
        _updateArrows();
      });
  }

  // ── Navigation ───────────────────────────────────────────────
  function _goTo(idx, smooth) {
    if (idx < 0 || idx >= _trades.length) return;
    var track = document.getElementById('favCarouselTrack');
    if (!track) return;
    var slide = track.children[idx];
    if (!slide) return;
    slide.scrollIntoView({ behavior: smooth === false ? 'instant' : 'smooth', block: 'nearest', inline: 'start' });
    _currentIndex = idx;
    _updateDots(_trades.length);
    _updateArrows();
    _updateCount();
  }

  function _updateDots(count) {
    var el = document.getElementById('favCarouselDots');
    if (!el) return;
    if (count <= 1) { el.innerHTML = ''; return; }
    var html = '';
    for (var i = 0; i < count; i++) {
      html += '<button type="button" class="fav-carousel-dot' + (i === _currentIndex ? ' is-active' : '') +
              '" data-dot="' + i + '" aria-label="Trade ' + (i + 1) + '"></button>';
    }
    el.innerHTML = html;
  }

  function _updateArrows() {
    var left  = document.getElementById('favCarouselLeft');
    var right = document.getElementById('favCarouselRight');
    if (!left || !right) return;
    var n = _trades.length;
    left.style.display  = n > 1 ? '' : 'none';
    right.style.display = n > 1 ? '' : 'none';
    left.disabled  = _currentIndex <= 0;
    right.disabled = _currentIndex >= n - 1;
  }

  function _updateCount() {
    var el = document.getElementById('favCarouselCount');
    if (!el) return;
    if (_trades.length > 1) {
      el.textContent = (_currentIndex + 1) + ' / ' + _trades.length;
    } else if (_trades.length === 1) {
      el.textContent = '1 trade';
    } else {
      el.textContent = '';
    }
  }

  // ── Flip helpers (uses journal-flip-card class) ─────────────
  function _flipCard(card, toBack) {
    document.querySelectorAll('.journal-flip-card.is-flipped').forEach(function (c) {
      if (c !== card) c.classList.remove('is-flipped');
    });
    if (toBack === undefined) {
      card.classList.toggle('is-flipped');
    } else {
      card.classList.toggle('is-flipped', toBack);
    }
  }

  // ── Intersection observer ────────────────────────────────────
  function _setupObserver() {
    var track = document.getElementById('favCarouselTrack');
    if (!track) return;

    _observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          var idx = parseInt(e.target.dataset.index, 10);
          if (!isNaN(idx) && idx !== _currentIndex) {
            _currentIndex = idx;
            _updateDots(_trades.length);
            _updateArrows();
            _updateCount();
          }
        }
      });
    }, { root: track, threshold: 0.55 });

    Array.from(track.children).forEach(function (s) { _observer.observe(s); });
  }

  // ── Global delegated click handler ──────────────────────────
  document.addEventListener('click', function (e) {

    // Arrow left / right
    var left = e.target.closest('#favCarouselLeft');
    if (left) { e.preventDefault(); e.stopPropagation(); _goTo(_currentIndex - 1); return; }

    var right = e.target.closest('#favCarouselRight');
    if (right) { e.preventDefault(); e.stopPropagation(); _goTo(_currentIndex + 1); return; }

    // Dot
    var dot = e.target.closest('.fav-carousel-dot');
    if (dot) { _goTo(parseInt(dot.dataset.dot, 10)); return; }

    // Flip back (journal card uses data-journal-day-close or similar)
    var backBtn = e.target.closest('[data-journal-day-close]');
    if (backBtn) {
      e.stopPropagation();
      var card = backBtn.closest('.journal-flip-card');
      if (card) _flipCard(card, false);
      return;
    }

    // Flip card (click anywhere on journal-flip-card that isn't a button)
    var card = e.target.closest('.journal-flip-card');
    if (card) {
      if (e.target.closest('button, input, textarea, a, select, [data-journal-day-close]')) return;
      e.stopPropagation();
      _flipCard(card);
      return;
    }
  }, true); // useCapture = true to intercept before journal handler

  // ── Keyboard support ─────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    var focused = document.activeElement;
    if (!focused) return;

    var card = focused.closest('.journal-flip-card');
    if (card) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _flipCard(card); return; }
      if (e.key === 'Escape' && card.classList.contains('is-flipped')) { _flipCard(card, false); return; }
    }

    var wrap = document.getElementById('favCarouselWrap');
    if (wrap && (wrap.contains(focused) || wrap.matches(':hover'))) {
      if (e.key === 'ArrowLeft')  { _goTo(_currentIndex - 1); return; }
      if (e.key === 'ArrowRight') { _goTo(_currentIndex + 1); return; }
    }
  });

  // ── Swipe touch support ──────────────────────────────────────
  (function () {
    var startX = 0, startY = 0, isDragging = false;
    document.addEventListener('touchstart', function (e) {
      var wrap = e.target.closest('#favCarouselWrap');
      if (!wrap) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      isDragging = true;
    }, { passive: true });
    document.addEventListener('touchend', function (e) {
      if (!isDragging) return;
      isDragging = false;
      var dx = e.changedTouches[0].clientX - startX;
      var dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
        _goTo(dx < 0 ? _currentIndex + 1 : _currentIndex - 1);
      }
    }, { passive: true });
  })();

  // ── Boot hooks ───────────────────────────────────────────────
  function _waitForFavContainer(callback, maxRetries, interval) {
    maxRetries = maxRetries || 20;
    interval = interval || 50;
    var retries = 0;
    function poll() {
      if (document.getElementById('favCarouselTrack')) {
        callback();
        return;
      }
      retries++;
      if (retries >= maxRetries) { console.warn('[fav-carousel] container introuvable'); return; }
      setTimeout(poll, interval);
    }
    poll();
  }

  var _origGoPage = window.goPage;
  if (_origGoPage) {
    window.goPage = function (pageName) {
      _origGoPage(pageName);
      if (pageName === 'today') {
        _waitForFavContainer(initFavCarousel);
      }
    };
  }

  window.refreshFavCarousel = initFavCarousel;

  document.addEventListener('DOMContentLoaded', function () {
    if (document.querySelector('.page[data-page="today"].active')) {
      _waitForFavContainer(initFavCarousel);
    }
  });

})();
