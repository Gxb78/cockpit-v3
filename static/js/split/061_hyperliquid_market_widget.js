// ---------- Hyperliquid markets dashboard widget ----------

(function () {
  var POLL_MS = 12000;
  var selectedMarket = localStorage.getItem("hlMarketWidget:selected") || "BTC";
  var timer = null;
  var loading = false;
  var snapshot = null;

  function $(id) { return document.getElementById(id); }

  function esc(v) {
    if (typeof escapeHtml === "function") return escapeHtml(v == null ? "" : String(v));
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (ch) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[ch];
    });
  }

  function fmtNum(v, digits) {
    var n = Number(v);
    if (!Number.isFinite(n)) return "--";
    return n.toLocaleString("en-US", { maximumFractionDigits: digits == null ? 4 : digits });
  }

  function fmtPct(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return "--";
    return (n * 100).toFixed(4) + "%";
  }

  function setStatus(text, mode) {
    var el = $("hlMarketStatus");
    if (!el) return;
    el.textContent = text;
    el.dataset.mode = mode || "";
  }

  async function getJson(url) {
    var r = await fetch(url);
    var data = await r.json().catch(function () { return null; });
    if (!r.ok || !data) throw new Error((data && data.error) || ("HTTP " + r.status));
    return data;
  }

  async function load(force) {
    if (loading) return;
    loading = true;
    setStatus("sync...", "loading");
    var q = force ? "&force=1" : "";
    try {
      var base = "?market=" + encodeURIComponent(selectedMarket) + q;
      var results = await Promise.allSettled([
        getJson("/api/hyperliquid/catalog" + (force ? "?force=1" : "")),
        getJson("/api/hyperliquid/resolve" + base),
        getJson("/api/hyperliquid/contexts" + base),
        getJson("/api/hyperliquid/orderbook" + base),
        getJson("/api/hyperliquid/trades" + base),
        getJson("/api/hyperliquid/funding" + base),
        getJson("/api/hyperliquid/predicted-funding" + base),
        getJson("/api/hyperliquid/mids" + (force ? "?force=1" : "")),
        getJson("/api/hyperliquid/open-interest-caps" + (force ? "?force=1" : "")),
        getJson("/api/hyperliquid/dexs" + (force ? "?force=1" : "")),
        getJson("/api/hyperliquid/annotations" + (force ? "?force=1" : "")),
      ]);
      snapshot = {
        catalog: value(results[0]),
        resolve: value(results[1]),
        contexts: value(results[2]),
        book: value(results[3]),
        trades: value(results[4]),
        funding: value(results[5]),
        predicted: value(results[6]),
        mids: value(results[7]),
        caps: value(results[8]),
        dexs: value(results[9]),
        annotations: value(results[10]),
        errors: results.filter(function (x) { return x.status === "rejected"; }).map(function (x) { return x.reason && x.reason.message; }),
        updatedAt: Date.now(),
      };
      render();
      setStatus("live " + new Date(snapshot.updatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }), "ok");
    } catch (e) {
      snapshot = { error: e.message || String(e) };
      render();
      setStatus("error", "error");
    } finally {
      loading = false;
    }
  }

  function value(result) {
    return result && result.status === "fulfilled" ? result.value : null;
  }

  function activeContext() {
    var rows = snapshot && snapshot.contexts && Array.isArray(snapshot.contexts.contexts)
      ? snapshot.contexts.contexts
      : [];
    return rows[0] || null;
  }

  function activeCoin() {
    return (snapshot && snapshot.resolve && snapshot.resolve.coin)
      || (activeContext() && activeContext().coin)
      || selectedMarket;
  }

  function activeGlobalMid() {
    var mids = snapshot && snapshot.mids && snapshot.mids.mids ? snapshot.mids.mids : null;
    return mids ? mids[activeCoin()] : null;
  }

  function renderSummary() {
    var coin = $("hlMarketCoin");
    var mark = $("hlMarketMark");
    var funding = $("hlMarketFunding");
    var ctx = activeContext();
    if (coin) coin.textContent = activeCoin();
    if (mark) mark.textContent = fmtNum((ctx && (ctx.markPx || ctx.midPx || ctx.oraclePx)) || activeGlobalMid(), 2);
    if (funding) funding.textContent = fmtPct(ctx && ctx.funding);
  }

  function kv(label, value) {
    return '<div class="hl-market-kv"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>';
  }

  function renderContext() {
    var ctx = activeContext();
    if (!ctx) return '<div class="hl-market-empty">No context for ' + esc(selectedMarket) + '.</div>';
    return '<div class="hl-market-section"><h4>Context</h4>' +
      '<div class="hl-market-kvgrid">' +
        kv("Mark", fmtNum(ctx.markPx, 2)) +
        kv("Mid", fmtNum(ctx.midPx, 2)) +
        kv("All mids", fmtNum(activeGlobalMid(), 2)) +
        kv("Oracle", fmtNum(ctx.oraclePx, 2)) +
        kv("Funding", fmtPct(ctx.funding)) +
        kv("Open interest", fmtNum(ctx.openInterest, 2)) +
        kv("24h notional", fmtNum(ctx.dayNtlVlm, 0)) +
      '</div></div>';
  }

  function renderBook() {
    var book = snapshot && snapshot.book;
    var bids = book && Array.isArray(book.bids) ? book.bids.slice(0, 5) : [];
    var asks = book && Array.isArray(book.asks) ? book.asks.slice(0, 5) : [];
    function sideRows(rows, side) {
      return rows.map(function (r) {
        return '<div class="hl-market-book-row ' + side + '"><span>' + fmtNum(r.price, 2) + '</span><span>' + fmtNum(r.size, 4) + '</span><span>' + fmtNum(r.n, 0) + '</span></div>';
      }).join("");
    }
    return '<div class="hl-market-section"><h4>L2 Book</h4>' +
      '<div class="hl-market-book-head"><span>Price</span><span>Size</span><span>N</span></div>' +
      sideRows(asks.reverse(), "ask") +
      sideRows(bids, "bid") +
    '</div>';
  }

  function renderTrades() {
    var data = snapshot && snapshot.trades;
    var trades = data && Array.isArray(data.trades) ? data.trades.slice(-8).reverse() : [];
    if (!trades.length) return '<div class="hl-market-section"><h4>Tape</h4><div class="hl-market-empty">No recent trade.</div></div>';
    return '<div class="hl-market-section"><h4>Tape</h4>' + trades.map(function (t) {
      var side = t.side === "buy" ? "buy" : "sell";
      return '<div class="hl-market-trade ' + side + '"><span>' + esc(side.toUpperCase()) + '</span><span>' + fmtNum(t.price, 2) + '</span><span>' + fmtNum(t.size, 4) + '</span></div>';
    }).join("") + '</div>';
  }

  function renderFunding() {
    var funding = snapshot && snapshot.funding && Array.isArray(snapshot.funding.funding) ? snapshot.funding.funding.slice(-5).reverse() : [];
    var predicted = snapshot && snapshot.predicted && Array.isArray(snapshot.predicted.predictedFunding) ? snapshot.predicted.predictedFunding : [];
    var caps = snapshot && snapshot.caps && Array.isArray(snapshot.caps.markets) ? snapshot.caps.markets : [];
    var rows = funding.map(function (f) {
      return '<div class="hl-market-mini-row"><span>' + esc(f.time ? new Date(Number(f.time)).toLocaleString("fr-FR", { day: "2-digit", hour: "2-digit", minute: "2-digit" }) : f.coin || "") + '</span><strong>' + fmtPct(f.fundingRate) + '</strong></div>';
    }).join("");
    var predText = predicted.length ? predicted.map(function (p) { return Array.isArray(p) ? p[0] : ""; }).filter(Boolean).join(", ") : "--";
    var capHit = caps.indexOf(activeCoin()) >= 0 ? "yes" : "no";
    return '<div class="hl-market-section"><h4>Funding / Risk</h4>' +
      '<div class="hl-market-kvgrid">' + kv("Predicted venues", predText) + kv("OI cap", capHit) + '</div>' +
      (rows || '<div class="hl-market-empty">No funding history.</div>') +
    '</div>';
  }

  function renderCatalog() {
    var catalog = snapshot && snapshot.catalog;
    var priority = catalog && catalog.priority ? catalog.priority : {};
    var dexs = snapshot && snapshot.dexs && Array.isArray(snapshot.dexs.dexs) ? snapshot.dexs.dexs : [];
    var annotations = snapshot && snapshot.annotations;
    var annCount = annotations && annotations.annotations
      ? (Array.isArray(annotations.annotations) ? annotations.annotations.length : Object.keys(annotations.annotations).length)
      : 0;
    return '<div class="hl-market-section"><h4>Catalog</h4>' +
      '<div class="hl-market-kvgrid">' +
        kv("Assets", catalog ? catalog.count : "--") +
        kv("DEXs", dexs.length) +
        kv("Annotations", annCount) +
        kv("BTC", priority.BTC && priority.BTC.coin || "--") +
        kv("ES", priority.ES && priority.ES.coin || "--") +
        kv("NASDAQ", priority.NASDAQ && priority.NASDAQ.coin || "--") +
      '</div></div>';
  }

  function render() {
    var main = $("hlMarketMain");
    var side = $("hlMarketSide");
    if (!main || !side) return;
    renderSummary();
    if (!snapshot) {
      main.innerHTML = '<div class="hl-market-empty">Loading Hyperliquid data.</div>';
      side.innerHTML = "";
      return;
    }
    if (snapshot.error) {
      main.innerHTML = '<div class="hl-market-empty is-error">' + esc(snapshot.error) + '</div>';
      side.innerHTML = "";
      return;
    }
    main.innerHTML = renderContext() + renderBook();
    side.innerHTML = renderTrades() + renderFunding() + renderCatalog();
  }

  function bind() {
    document.querySelectorAll("[data-hl-market]").forEach(function (btn) {
      if (btn._hlMarketBound) return;
      btn._hlMarketBound = true;
      btn.addEventListener("click", function () {
        selectedMarket = btn.getAttribute("data-hl-market") || "BTC";
        localStorage.setItem("hlMarketWidget:selected", selectedMarket);
        document.querySelectorAll("[data-hl-market]").forEach(function (b) { b.classList.toggle("active", b === btn); });
        load(true);
      });
      btn.classList.toggle("active", btn.getAttribute("data-hl-market") === selectedMarket);
    });
    var refresh = $("hlMarketRefreshBtn");
    if (refresh && !refresh._hlMarketBound) {
      refresh._hlMarketBound = true;
      refresh.addEventListener("click", function () { load(true); });
    }
  }

  function init() {
    if (!document.querySelector(".hl-market-widget")) return;
    bind();
    render();
    load(false);
    if (!timer) {
      timer = setInterval(function () {
        if (document.body.getAttribute("data-current-page") === "today") load(false);
      }, POLL_MS);
    }
  }

  window.initHyperliquidMarketWidget = init;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else setTimeout(init, 0);
})();
