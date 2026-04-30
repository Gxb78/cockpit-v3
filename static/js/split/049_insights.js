// ---- 049_insights.js ---- Page Profil & Insights ML ----

(function () {
  "use strict";

  var _insightsInitialized = false;
  var _insightsToastTimeout = null;

  var INSIGHT_ICONS = {
    best_strategy: { icon: "+", cls: "success" },
    worst_strategy: { icon: "!", cls: "warning" },
    best_session: { icon: "+", cls: "success" },
    worst_session: { icon: "!", cls: "warning" },
    bias_correlation: { icon: "#", cls: "info" },
    direction_strength: { icon: "+", cls: "success" },
    lesson_themes: { icon: "#", cls: "info" },
    execution_quality: { icon: "+", cls: "success" },
    execution_warning: { icon: "!", cls: "warning" },
    rr_sweetspot: { icon: "#", cls: "info" },
    recent_trend: { icon: "#", cls: "info" },
    stdv_sweetspot: { icon: "+", cls: "success" },
    thesis_validated: { icon: "+", cls: "success" },
    thesis_invalid: { icon: "!", cls: "warning" },
  };

  function _dateKey(d) {
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function _getTodayStr() {
    return _dateKey(new Date());
  }

  function _get30dAgo() {
    var d = new Date();
    d.setDate(d.getDate() - 30);
    return _dateKey(d);
  }

  function _getFirstDayOfMonth() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-01";
  }

  function _fetchApi(endpoint, params) {
    var qs = [];
    params = params || {};
    for (var k in params) {
      if (params[k] && params[k] !== "ALL" && params[k] !== "") {
        qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
      }
    }
    var url = endpoint + (qs.length ? "?" + qs.join("&") : "");
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function _renderEmpty() {
    return '<div class="insight-empty">' +
      '<div class="insight-empty__icon">#</div>' +
      '<div class="insight-empty__title">Pas assez de donnees</div>' +
      '<div class="insight-empty__text">Remplis au moins 3 trades avec resultat pour que le moteur commence a detecter des patterns.</div>' +
      "</div>";
  }

  function _renderProfileHeader(profile) {
    if (profile.empty) return "";
    var pnlCls = (profile.total_pnl || 0) >= 0 ? "up" : "down";
    var pnlSign = (profile.total_pnl || 0) >= 0 ? "+" : "";
    return '<div class="profile-banner">' +
      '<div class="profile-stat"><div class="profile-stat__value">' + (profile.total_trades || 0) + '</div><div class="profile-stat__label">Trades</div></div>' +
      '<div class="profile-stat"><div class="profile-stat__value">' + (profile.winrate || 0) + '%</div><div class="profile-stat__label">Winrate (' + (profile.wins || 0) + "W/" + (profile.losses || 0) + "L)</div></div>" +
      '<div class="profile-stat"><div class="profile-stat__value ' + pnlCls + '">' + pnlSign + (profile.total_pnl || 0) + '$</div><div class="profile-stat__label">PnL Total</div></div>' +
      '<div class="profile-stat"><div class="profile-stat__value">' + (profile.avg_rr || "-") + '</div><div class="profile-stat__label">R:R Moyen</div></div>' +
      "</div>";
  }

  function _stars(confidence) {
    var n = Math.round((confidence || 0) * 5);
    var s = "";
    for (var i = 0; i < n; i++) s += "*";
    return '<span class="insight-stars">' + s + "</span>";
  }

  function _confidenceClass(confidence) {
    if (!confidence) return "low";
    if (confidence >= 0.7) return "high";
    if (confidence >= 0.4) return "medium";
    return "low";
  }

  function _renderInsightCard(pattern) {
    var def = INSIGHT_ICONS[pattern.kind] || { icon: "-", cls: "info" };
    var cardCls = "insight-card";
    if (def.cls === "warning") cardCls += " insight-card--warning";
    else if (def.cls === "success") cardCls += " insight-card--success";
    else cardCls += " insight-card--info";

    var tags = (pattern.tags || []).map(function (t) {
      return '<span class="insight-tag">' + _escapeHtml(t) + "</span>";
    }).join("");

    var confPct = Math.round((pattern.confidence || 0) * 100);
    var confCls = _confidenceClass(pattern.confidence);

    return '<div class="' + cardCls + '">' +
      '<div class="insight-header">' +
      '<div class="insight-icon insight-icon--' + def.cls + '">' + def.icon + "</div>" +
      '<div class="insight-title">' + _escapeHtml(pattern.title || "") + "</div>" +
      '<span class="insight-badge">' + confPct + "%</span>" +
      "</div>" +
      '<div class="insight-body">' + _escapeHtml(pattern.body || "") + "</div>" +
      '<div class="insight-meta">' +
      '<span class="insight-confidence">' + _stars(pattern.confidence) + " " + confPct + "% confiance</span>" +
      (pattern.evidence_count ? "<span>" + pattern.evidence_count + " trades</span>" : "") +
      "</div>" +
      (tags ? '<div class="insight-meta" style="margin-top:8px">' + tags + "</div>" : "") +
      '<div class="confidence-track"><div class="confidence-fill confidence-fill--' + confCls + '" style="width:' + confPct + '%"></div></div>' +
      "</div>";
  }

  function _renderStrategyTable(strategies) {
    if (!strategies || !strategies.length) return "";
    var best = strategies[0], worst = strategies[strategies.length - 1];
    var bestWr = 0, worstWr = 100;
    strategies.forEach(function (s) {
      if (s.winrate > bestWr) { bestWr = s.winrate; best = s; }
      if (s.winrate < worstWr && s.wins + s.losses >= 3) { worstWr = s.winrate; worst = s; }
    });

    var rows = strategies.map(function (s) {
      var pnlCls = (s.pnl || 0) >= 0 ? "up" : "down";
      var rowCls = "";
      if (s.name === (best && best.name) && s.winrate >= 60) rowCls = " best-row";
      else if (s.name === (worst && worst.name) && s.winrate < 45) rowCls = " worst-row";
      return '<tr class="' + rowCls + '"><td><strong>' + _escapeHtml(s.name || "-") + "</strong></td>" +
        '<td class="num">' + (s.total || 0) + "</td>" +
        "<td>" + (s.wins || 0) + "W/" + (s.losses || 0) + "L</td>" +
        '<td class="num">' + (s.winrate || 0) + "%</td>" +
        '<td class="num ' + pnlCls + '">' + ((s.pnl || 0) >= 0 ? "+" : "") + (s.pnl || 0) + "$</td></tr>";
    }).join("");

    return '<div class="insight-card insight-full" style="grid-column:1/-1">' +
      '<div class="insight-header"><div class="insight-icon insight-icon--info">#</div><div class="insight-title">Performance par strategie</div></div>' +
      '<table class="insight-table"><thead><tr>' +
      "<th>Strategie</th><th>Trades</th><th>Resultat</th><th>WR</th><th>PnL</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table></div>";
  }

  function _renderSuggestions(profile, patterns) {
    var warns = (patterns || []).filter(function (p) {
      return p.kind && (p.kind.indexOf("worst") >= 0 || p.kind.indexOf("warning") >= 0 || p.kind.indexOf("invalid") >= 0);
    });
    var goods = (patterns || []).filter(function (p) {
      return p.kind && (p.kind.indexOf("best") >= 0 || p.kind.indexOf("strength") >= 0 || p.kind.indexOf("sweetspot") >= 0);
    });

    var html = '<div class="insight-full" style="grid-column:1/-1">';
    html += '<div class="insight-header" style="margin-bottom:12px"><div class="insight-title">Recommandations</div></div>';

    warns.slice(0, 3).forEach(function (w) {
      html += '<div class="suggestion-card suggestion-card--warn"><div class="suggestion-icon">!</div><div class="suggestion-content"><strong>' +
        _escapeHtml(w.title || "") + "</strong><br/>" + _escapeHtml(w.body || "") + "</div></div>";
    });
    goods.slice(0, 3).forEach(function (g) {
      html += '<div class="suggestion-card suggestion-card--good"><div class="suggestion-icon">+</div><div class="suggestion-content"><strong>' +
        _escapeHtml(g.title || "") + "</strong><br/>" + _escapeHtml(g.body || "") + "</div></div>";
    });
    if (!warns.length && !goods.length) {
      html += '<div class="insight-empty">Ajoute des resultats a tes trades pour obtenir des recommandations.</div>';
    }
    html += "</div>";
    return html;
  }

  function loadInsights(opts) {
    opts = opts || {};
    var container = document.getElementById("insightsContent");
    var loading = document.getElementById("insightsLoading");
    if (!container) return;

    loading.style.display = "";
    container.style.display = "none";
    container.innerHTML = "";

    var params = {};
    if (opts.instrument && opts.instrument !== "ALL") params.instrument = opts.instrument;
    if (opts.from) params.from = opts.from;
    if (opts.to) params.to = opts.to;

    Promise.all([
      _fetchApi("/api/ml/profile", params),
      _fetchApi("/api/ml/insights", params),
    ]).then(function (results) {
      var profile = results[0];
      var insightsResp = results[1];
      var patterns = insightsResp.patterns || [];
      var html = "";

      loading.style.display = "none";
      container.style.display = "grid";
      html += _renderProfileHeader(profile);
      if (patterns.length) patterns.forEach(function (p) { html += _renderInsightCard(p); });
      else html += '<div style="grid-column:1/-1">' + _renderEmpty() + "</div>";
      if (profile.preferred_strategies && profile.preferred_strategies.length) html += _renderStrategyTable(profile.preferred_strategies);
      html += _renderSuggestions(profile, patterns);
      container.innerHTML = html;
    }).catch(function (err) {
      loading.style.display = "none";
      container.style.display = "grid";
      container.innerHTML = '<div class="insight-empty"><div class="insight-empty__icon">!</div><div class="insight-empty__title">Erreur</div><div class="insight-empty__text">' +
        _escapeHtml(err.message || "Impossible de charger les insights.") + "</div></div>";
    });
  }

  function _renderPretradeWidget() {
    _fetchApi("/api/ml/insights", { from: _get30dAgo() }).then(function (resp) {
      var patterns = resp.patterns || [];
      var container = document.getElementById("pretradeWidget");
      if (!container) return;
      var warnings = patterns.filter(function (p) {
        return p.kind && (p.kind.indexOf("worst") >= 0 || p.kind.indexOf("warning") >= 0);
      });
      var strengths = patterns.filter(function (p) {
        return p.kind && (p.kind.indexOf("best") >= 0 || p.kind.indexOf("strength") >= 0);
      });
      var items = [];
      strengths.slice(0, 2).forEach(function (s) {
        items.push('<span class="pretrade-item"><span class="pretrade-item__icon">+</span> ' + _escapeHtml(s.title || "") + "</span>");
      });
      warnings.slice(0, 2).forEach(function (w) {
        items.push('<span class="pretrade-item"><span class="pretrade-item__icon">!</span> ' + _escapeHtml(w.title || "") + "</span>");
      });
      if (items.length) {
        container.innerHTML =
          '<div class="pretrade-widget" id="pretradeWidget">' +
          '<div class="pretrade-header">Pré-trade du jour</div>' +
          '<div class="pretrade-items">' + items.join("") + "</div></div>";
      }
    }).catch(function () {});
  }

  function showInsightToast(title, body, duration) {
    duration = duration || 6000;
    var toast = document.getElementById("toastInsight");
    var titleEl = document.getElementById("toastInsightTitle");
    var bodyEl = document.getElementById("toastInsightBody");
    if (!toast || !titleEl || !bodyEl) return;
    if (_insightsToastTimeout) clearTimeout(_insightsToastTimeout);
    titleEl.textContent = title;
    bodyEl.textContent = body;
    toast.classList.add("show");
    _insightsToastTimeout = setTimeout(function () {
      toast.classList.remove("show");
    }, duration);
  }

  function _initPostTradeToast() {
    var closeBtn = document.getElementById("toastInsightClose");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        var t = document.getElementById("toastInsight");
        if (t) t.classList.remove("toast-insight--visible");
        if (_insightsToastTimeout) clearTimeout(_insightsToastTimeout);
      });
    }
  }

  function onTradeSaved(tradeData) {
    if (tradeData && tradeData.id) {
      _fetchApi("/api/ml/setups/similar", { trade_id: tradeData.id, limit: 3 }).then(function (data) {
        if (data.error || !data.similar_trades || !data.similar_trades.length) return;
        var similar = data.similar_trades;
        var wins = similar.filter(function (s) { return s.trade && s.trade.is_win === 1; }).length;
        var losses = similar.filter(function (s) { return s.trade && s.trade.is_win === 0; }).length;
        if (wins + losses >= 2) {
          var wr = Math.round(wins / (wins + losses) * 100);
          var body = wins + "W/" + losses + "L = " + wr + "% WR dans des trades similaires. ";
          body += wr >= 60 ? "Bon setup !" : "Sois prudent.";
          showInsightToast("Setups similaires", body);
        }
      }).catch(function () {});
    }
    _renderPretradeWidget();
  }

  function _initFilters() {
    var from = document.getElementById("filterFrom");
    var to = document.getElementById("filterTo");
    var instr = document.getElementById("filterInstrument");
    var strat = document.getElementById("filterStrategy");
    var refresh = document.getElementById("insightsRefreshBtn");
    if (!from || !to) return;

    from.value = _getFirstDayOfMonth();
    to.value = _getTodayStr();

    var quickBtns = [
      { label: "7j", days: 7 },
      { label: "30j", days: 30 },
      { label: "90j", days: 90 },
      { label: "Ce mois", fn: _getFirstDayOfMonth },
    ];

    function _applyFilter() {
      loadInsights({
        from: from.value || undefined,
        to: to.value || undefined,
        instrument: instr ? instr.value : undefined,
        strategy: strat ? strat.value : undefined,
      });
    }

    function _setQuickRange(days) {
      var d = new Date();
      d.setDate(d.getDate() - days);
      from.value = _dateKey(d);
      to.value = _getTodayStr();
      _applyFilter();
    }

    var btnContainer = document.getElementById("filterQuick");
    if (!btnContainer) return;
    btnContainer.innerHTML = "";
    quickBtns.forEach(function (q) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "qbtn";
      btn.textContent = q.label;
      btn.addEventListener("click", function () {
        if (q.fn) {
          from.value = q.fn();
          to.value = _getTodayStr();
          _applyFilter();
        } else {
          _setQuickRange(q.days);
        }
      });
      btnContainer.appendChild(btn);
    });

    if (from) from.addEventListener("change", _applyFilter);
    if (to) to.addEventListener("change", _applyFilter);
    if (instr) instr.addEventListener("change", _applyFilter);
    if (strat) strat.addEventListener("change", _applyFilter);
    if (refresh) refresh.addEventListener("click", _applyFilter);
    _applyFilter();
  }

  function initInsights() {
    if (_insightsInitialized) return;
    _insightsInitialized = true;
    _renderPretradeWidget();
    _initPostTradeToast();
    _initFilters();

    document.addEventListener("trade:saved", function (e) {
      onTradeSaved(e.detail);
    });
  }

  function _escapeHtml(str) {
    if (typeof str !== "string") return str || "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  window.initInsights = initInsights;
  window.loadInsights = loadInsights;
  window.showInsightToast = showInsightToast;
  window.onTradeSaved = onTradeSaved;

  if (document.querySelector('.page[data-page="insights"].active')) {
    initInsights();
  } else {
    var _origGoPage = window.goPage;
    if (_origGoPage) {
      window.goPage = function (pageName) {
        _origGoPage(pageName);
        if (pageName === "insights") initInsights();
      };
    }
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    if (document.querySelector('.page[data-page="insights"]')) {
      var checkPage = function () {
        if (document.querySelector('.page[data-page="insights"].active')) {
          initInsights();
        } else {
          setTimeout(checkPage, 300);
        }
      };
      setTimeout(checkPage, 500);
    }
  }
})();
