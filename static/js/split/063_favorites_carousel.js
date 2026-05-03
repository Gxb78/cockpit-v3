// ---------- Favorites carousel widget — Today dashboard ----------

(function () {
  var currentIndex = 0;
  var trades = [];
  var _origGoPage = window.goPage;

  function initFavCarousel() {
    var track = document.getElementById('favCarouselTrack');
    var empty = document.getElementById('favCarouselEmpty');
    var countEl = document.getElementById('favCarouselCount');
    if (!track) return;

    fetch('/api/trades/favorites')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        trades = Array.isArray(data) ? data : [];
        track.innerHTML = '';
        document.querySelector('.fav-carousel-panel')?.classList.remove('loading');

        if (trades.length === 0) {
          if (empty) empty.style.display = '';
          if (countEl) countEl.textContent = '';
          _updateDots(0);
          _updateArrows(0);
          return;
        }

        if (empty) empty.style.display = 'none';
        if (countEl) countEl.textContent = trades.length + ' trade' + (trades.length > 1 ? 's' : '');

        trades.forEach(function (trade, idx) {
          var day = {
            id: trade.day_id,
            instrument: trade.day_instrument || '-',
            date: trade.day_date || trade.created_at?.slice(0, 10) || '',
          };

          var wrap = document.createElement('div');
          wrap.className = 'fav-carousel-slide';
          wrap.dataset.index = idx;

          if (idx === currentIndex && window.journalTradeFlipCardHtml) {
            var cardHtml = window.journalTradeFlipCardHtml(day, trade, idx + 1, [trade]);
            wrap.innerHTML = cardHtml;
          }

          track.appendChild(wrap);
        });

        currentIndex = 0;
        _scrollTo(currentIndex, false);
        _updateDots(trades.length);
        _updateArrows(trades.length);
        _updateCount();

        // Rendre les slides adjacentes (maintenant que trades est peuple)
        _renderSlide(0);
        _renderSlide(1);

        // Setup scroll observer apres que les slides soient bien en place
        _setupScrollObserver();
      })
      .catch(function (err) {
        console.error('[fav-carousel] fetch:', err);
        // Sur erreur reseau : afficher l'empty state et cacher les fleches
        if (empty) empty.style.display = '';
        if (countEl) countEl.textContent = '';
        track.innerHTML = '';
        _updateDots(0);
        _updateArrows(0);
      });
  }

  function _renderSlide(idx) {
    var track = document.getElementById('favCarouselTrack');
    if (!track) return;
    var slide = track.children[idx];
    if (!slide || slide.querySelector('.journal-flip-card')) return;

    var trade = trades[idx];
    if (!trade || !window.journalTradeFlipCardHtml) return;

    var day = {
      id: trade.day_id,
      instrument: trade.day_instrument || '-',
      date: trade.day_date || trade.created_at?.slice(0, 10) || '',
    };

    var cardHtml = window.journalTradeFlipCardHtml(day, trade, idx + 1, trades);
    slide.innerHTML = cardHtml;
  }

  function _scrollTo(idx, smooth) {
    var wrap = document.getElementById('favCarouselWrap');
    if (!wrap) return;
    var slide = wrap.querySelector('.fav-carousel-track')?.children[idx];
    if (!slide) return;
    slide.scrollIntoView({
      behavior: smooth ? 'smooth' : 'instant',
      block: 'nearest',
      inline: 'start',
    });
    currentIndex = idx;
  }

  function _updateDots(count) {
    var dotsEl = document.getElementById('favCarouselDots');
    if (!dotsEl) return;
    if (count <= 1) { dotsEl.innerHTML = ''; return; }
    var html = '';
    for (var i = 0; i < count; i++) {
      html += '<button type="button" class="fav-carousel-dot' + (i === currentIndex ? ' is-active' : '') + '" data-dot="' + i + '" aria-label="Slide ' + (i + 1) + '"></button>';
    }
    dotsEl.innerHTML = html;
  }

  function _updateArrows(count) {
    var left = document.getElementById('favCarouselLeft');
    var right = document.getElementById('favCarouselRight');
    if (!left || !right) return;
    // Cacher les fleches uniquement si zero trades
    left.style.display = count > 0 ? '' : 'none';
    right.style.display = count > 0 ? '' : 'none';
    left.disabled = currentIndex <= 0;
    right.disabled = currentIndex >= count - 1;
  }

  function _updateCount() {
    var countEl = document.getElementById('favCarouselCount');
    if (!countEl) return;
    if (trades.length > 1) {
      countEl.textContent = (currentIndex + 1) + '/' + trades.length;
    }
  }

  function _goTo(idx) {
    if (idx < 0 || idx >= trades.length || idx === currentIndex) return;
    _renderSlide(idx);
    _scrollTo(idx, true);
  }

  function _goNext() { _goTo(currentIndex + 1); }
  function _goPrev() { _goTo(currentIndex - 1); }

  // ── Navigation events ──

  document.addEventListener('click', function (e) {
    var left = e.target.closest('#favCarouselLeft');
    if (left) { e.preventDefault(); _goPrev(); return; }

    var right = e.target.closest('#favCarouselRight');
    if (right) { e.preventDefault(); _goNext(); return; }

    var dot = e.target.closest('.fav-carousel-dot');
    if (dot) {
      var idx = parseInt(dot.dataset.dot, 10);
      if (!isNaN(idx)) _goTo(idx);
    }
  });

  // Scroll-snap observer pour detecter le changement de slide
  function _setupScrollObserver() {
    var wrap = document.getElementById('favCarouselWrap');
    if (!wrap) return;
    var track = document.getElementById('favCarouselTrack');
    if (!track) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var idx = parseInt(entry.target.dataset.index, 10);
          if (!isNaN(idx) && idx !== currentIndex) {
            currentIndex = idx;
            _updateDots(trades.length);
            _updateArrows(trades.length);
            _updateCount();
            // Lazy render les slides adjacents
            _renderSlide(idx - 1);
            _renderSlide(idx);
            _renderSlide(idx + 1);
          }
        }
      });
    }, {
      root: wrap,
      threshold: 0.6,
    });

    Array.from(track.children).forEach(function (slide) {
      observer.observe(slide);
    });
  }

  // ── Hook dans goPage pour init au chargement ──

  if (_origGoPage) {
    window.goPage = function (pageName) {
      _origGoPage(pageName);
      if (pageName === 'today') {
        // Laisser le temps aux widgets de se mettre en place
        setTimeout(function () {
          initFavCarousel();
        }, 500);
      }
    };
  }

  // Exposer une fonction de refresh pour les mise a jour externes
  window.refreshFavCarousel = function () {
    initFavCarousel();
  };

  // ── Aussi au DOMContentLoaded si Today est deja ouvert ──
  document.addEventListener('DOMContentLoaded', function () {
    if (document.querySelector('.page[data-page="today"].active')) {
      setTimeout(initFavCarousel, 600);
    }
  });

})();
