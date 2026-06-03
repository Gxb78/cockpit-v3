# ---------- Routes API : Hyperliquid market data (read-only proxy) ----------
#
# Public Info endpoint only. No wallet, no API key, no trading calls.
# HIP-3 / builder-deployed perps can require a full coin name like
# "deployer:ASSET", so aliases are resolved from Hyperliquid metadata.

import copy as _hl_copy
import json as _hl_json
import time as _hl_time
import urllib.error as _hl_urlerror
import urllib.request as _hl_urlrequest


HYPERLIQUID_INFO_API = "https://api.hyperliquid.xyz/info"
HYPERLIQUID_WS_API = "wss://api.hyperliquid.xyz/ws"

_HL_INTERVAL_WHITELIST = frozenset({
    "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d", "3d", "1w", "1M"
})
_HL_PRIORITY_MARKETS = ("BTC", "ES", "NASDAQ")
_HL_CANONICAL_MARKET_ASSETS = {
    "ES": "xyz:SP500",
    "NASDAQ": "xyz:XYZ100",
}
_HL_ALIAS_TERMS = {
    "BTC": ("BTC", "UBTC"),
    "ES": ("xyz:SP500", "SP500", "S&P500", "S&P 500", "ES", "MES", "SPX", "US500", "SPY"),
    "NASDAQ": ("xyz:XYZ100", "XYZ100", "NASDAQ", "NAS100", "US100", "NDX", "NQ", "MNQ", "QQQ"),
}
_HL_INFO_TIMEOUT_S = 4.0
_HL_CACHE_MAX_KEYS = 160
_HL_TTLS = {
    "meta": 600,
    "catalog": 600,
    "mids": 2,
    "book": 1,
    "trades": 2,
    "candles": 20,
    "funding": 60,
    "predicted_funding": 60,
    "contexts": 15,
    "dexs": 600,
    "annotations": 600,
    "open_interest_cap": 300,
}
_hl_cache = {}


def _hl_now():
    return _hl_time.time()


def _hl_cache_get(key, ttl, force=False):
    if force:
        return None
    cached = _hl_cache.get(key)
    if not cached:
        return None
    age = _hl_now() - cached["ts"]
    if age >= ttl:
        return None
    return _hl_copy.deepcopy(cached["data"])


def _hl_cache_put(key, data):
    if len(_hl_cache) > _HL_CACHE_MAX_KEYS:
        oldest = sorted(_hl_cache.keys(), key=lambda k: _hl_cache[k]["ts"])
        for stale_key in oldest[:max(1, len(_hl_cache) - _HL_CACHE_MAX_KEYS)]:
            del _hl_cache[stale_key]
    _hl_cache[key] = {"ts": _hl_now(), "data": _hl_copy.deepcopy(data)}


def _hl_post_info(payload, timeout=_HL_INFO_TIMEOUT_S):
    req = _hl_urlrequest.Request(
        HYPERLIQUID_INFO_API,
        data=_hl_json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Journal/1.0",
        },
        method="POST",
    )
    try:
        with _hl_urlrequest.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return _hl_json.loads(raw), None
    except _hl_urlerror.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:300]
        return None, ({"error": "Hyperliquid HTTP error", "status": e.code, "detail": detail}, 502)
    except _hl_urlerror.URLError as e:
        return None, ({"error": "Hyperliquid network error", "detail": str(e.reason)}, 502)
    except Exception as e:
        return None, ({"error": "Hyperliquid unavailable", "detail": str(e)}, 502)


def _hl_info_cached(payload, cache_key, ttl, force=False):
    cached = _hl_cache_get(cache_key, ttl, force=force)
    if cached is not None:
        return cached, None

    data, err = _hl_post_info(payload)
    if err:
        stale = _hl_cache.get(cache_key)
        if stale:
            return _hl_copy.deepcopy(stale["data"]), None
        return None, err

    _hl_cache_put(cache_key, data)
    return _hl_copy.deepcopy(data), None


def _hl_parse_int(name, default=None, min_value=None, max_value=None):
    raw = request.args.get(name)
    if raw in (None, ""):
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise ValueError(f"Parametre invalide: {name}")
    if min_value is not None:
        value = max(min_value, value)
    if max_value is not None:
        value = min(max_value, value)
    return value


def _hl_force_param():
    try:
        return bool(_hl_parse_int("force", 0, 0, 1))
    except ValueError:
        return False


def _hl_optional_dex_param():
    dex = request.args.get("dex")
    if dex is None:
        return None
    return dex.strip()


def _hl_dex_name(dex_info):
    if isinstance(dex_info, str):
        return dex_info.strip()
    if isinstance(dex_info, dict):
        for key in ("name", "dex", "dexName"):
            value = dex_info.get(key)
            if value:
                return str(value).strip()
    return ""


def _hl_full_coin_name(name, dex_name=""):
    name = str(name or "").strip()
    dex_name = str(dex_name or "").strip()
    if not name:
        return ""
    if ":" in name or not dex_name:
        return name
    return f"{dex_name}:{name}"


def _hl_extract_meta_entries(payload):
    entries = []

    def add_meta(meta, dex_name=""):
        if not isinstance(meta, dict):
            return
        universe = meta.get("universe") or []
        for idx, asset in enumerate(universe):
            if not isinstance(asset, dict):
                continue
            name = str(asset.get("name") or "").strip()
            if not name:
                continue
            full_name = _hl_full_coin_name(name, dex_name)
            row = {
                "name": name,
                "coin": full_name,
                "dex": dex_name or "default",
                "assetIndex": idx,
                "szDecimals": asset.get("szDecimals"),
                "maxLeverage": asset.get("maxLeverage"),
                "onlyIsolated": bool(asset.get("onlyIsolated", False)),
                "isDelisted": bool(asset.get("isDelisted", False)),
                "raw": asset,
            }
            entries.append(row)

    if isinstance(payload, dict):
        add_meta(payload, payload.get("dex") or payload.get("dexName") or "")
    elif isinstance(payload, list):
        for item in payload:
            if isinstance(item, dict):
                add_meta(item, item.get("dex") or item.get("dexName") or item.get("name") or "")
            elif isinstance(item, (list, tuple)) and len(item) >= 2:
                dex_name = _hl_dex_name(item[0])
                add_meta(item[1], dex_name)

    # Deduplicate by full coin name while preserving first occurrence.
    seen = set()
    deduped = []
    for row in entries:
        key = row["coin"].upper()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return deduped


def _hl_get_meta_catalog(force=False):
    cache_key = "hl:catalog:v2"
    cached = _hl_cache_get(cache_key, _HL_TTLS["catalog"], force=force)
    if cached is not None:
        return cached, None

    raw_all, err = _hl_info_cached({"type": "allPerpMetas"}, "hl:allPerpMetas", _HL_TTLS["meta"], force=force)
    if err:
        raw_all = None
    assets = _hl_extract_meta_entries(raw_all)

    raw_meta, meta_err = _hl_info_cached({"type": "meta"}, "hl:meta", _HL_TTLS["meta"], force=force)
    if meta_err and not assets:
        return None, meta_err
    default_assets = _hl_extract_meta_entries(raw_meta)
    by_coin = {a["coin"].upper(): a for a in assets}
    for asset in default_assets:
        by_coin.setdefault(asset["coin"].upper(), asset)
    assets = sorted(by_coin.values(), key=lambda a: (a["dex"] != "default", a["coin"].upper()))

    payload = {
        "ok": True,
        "source": "hyperliquid",
        "readOnly": True,
        "infoApi": HYPERLIQUID_INFO_API,
        "wsApi": HYPERLIQUID_WS_API,
        "assets": assets,
        "count": len(assets),
        "priority": {},
        "notes": [
            "Les perps HIP-3 peuvent utiliser un nom complet deployer:ASSET.",
            "Les endpoints ici utilisent uniquement l'Info API publique Hyperliquid.",
        ],
        "cache": {"hit": False, "stale": False, "age": 0, "ttl": _HL_TTLS["catalog"]},
    }
    for market in _HL_PRIORITY_MARKETS:
        payload["priority"][market] = _hl_resolve_coin_from_assets(market, assets)
    _hl_cache_put(cache_key, payload)
    return _hl_copy.deepcopy(payload), None


def _hl_match_score(symbol, terms, asset):
    coin_upper = asset["coin"].upper()
    name_upper = asset["name"].upper()
    terms_upper = [t.upper() for t in terms]
    if coin_upper == symbol or name_upper == symbol:
        return 100
    for term in terms_upper:
        if coin_upper == term or name_upper == term:
            return 95
        if coin_upper.endswith(":" + term):
            return 90
    for term in terms_upper:
        if name_upper.startswith(term) or coin_upper.endswith(":" + term):
            return 70
        if term in name_upper or term in coin_upper:
            return 45
    return 0


def _hl_resolve_coin_from_assets(market, assets):
    raw = str(market or "BTC").strip()
    symbol = raw.upper()
    terms = _HL_ALIAS_TERMS.get(symbol, (symbol,))
    canonical = _HL_CANONICAL_MARKET_ASSETS.get(symbol)

    candidates = []
    for asset in assets:
        if asset.get("isDelisted"):
            continue
        score = _hl_match_score(symbol, terms, asset)
        if canonical:
            canonical_upper = canonical.upper()
            coin_upper = asset["coin"].upper()
            name_upper = asset["name"].upper()
            if name_upper == canonical_upper or coin_upper == canonical_upper or coin_upper.endswith(":" + canonical_upper):
                score = max(score, 120)
        if score > 0:
            item = {k: asset.get(k) for k in ("coin", "name", "dex", "assetIndex", "szDecimals", "maxLeverage")}
            item["score"] = score
            candidates.append(item)

    candidates.sort(key=lambda x: (-x["score"], x["coin"].upper()))
    best = candidates[0] if candidates else None
    return {
        "market": raw,
        "coin": best["coin"] if best else None,
        "resolved": bool(best),
        "source": "canonical-alias" if best and canonical and best.get("score") == 120 else "meta" if best else "unresolved",
        "candidates": candidates[:12],
    }


def _hl_resolve_coin(market=None, force=False):
    explicit = request.args.get("coin")
    if explicit:
        return {
            "market": market or explicit,
            "coin": explicit.strip(),
            "resolved": True,
            "source": "query.coin",
            "candidates": [],
        }, None

    # Marchés prioritaires: canonical direct, pas de fuzzy matching
    # Les metas Hyperliquid peuvent avoir des noms proches (SPX au lieu de SP500)
    # qui faussent la résolution. On utilise le mapping produit explicite.
    market_key = (market or "BTC").strip().upper()
    if market_key in _HL_CANONICAL_MARKET_ASSETS:
        canonical = _HL_CANONICAL_MARKET_ASSETS[market_key]
        return {
            "market": market,
            "coin": canonical,
            "resolved": True,
            "source": "canonical-direct",
            "candidates": [],
        }, None

    catalog, err = _hl_get_meta_catalog(force=force)
    if err:
        return None, err
    resolved = _hl_resolve_coin_from_assets(market or "BTC", catalog.get("assets") or [])
    if not resolved.get("resolved"):
        return None, ({
            "error": f"Impossible de resoudre le marche Hyperliquid: {market}",
            "hint": "Passe coin=deployer:ASSET pour un perp HIP-3, ou regarde /api/hyperliquid/catalog.",
            "candidates": resolved.get("candidates", []),
        }, 404)
    return resolved, None


def _hl_context_rows(raw, dex_name=""):
    if not (isinstance(raw, list) and len(raw) >= 2 and isinstance(raw[0], dict) and isinstance(raw[1], list)):
        return []
    meta = raw[0]
    contexts = raw[1]
    rows = []
    for idx, asset in enumerate(meta.get("universe") or []):
        if not isinstance(asset, dict):
            continue
        ctx = contexts[idx] if idx < len(contexts) and isinstance(contexts[idx], dict) else {}
        name = str(asset.get("name") or "").strip()
        coin = _hl_full_coin_name(name, dex_name)
        rows.append({
            "coin": coin,
            "name": name,
            "dex": dex_name or "default",
            "asset": asset,
            "context": ctx,
            "markPx": _hl_float(ctx.get("markPx"), None),
            "midPx": _hl_float(ctx.get("midPx"), None),
            "oraclePx": _hl_float(ctx.get("oraclePx"), None),
            "funding": _hl_float(ctx.get("funding"), None),
            "openInterest": _hl_float(ctx.get("openInterest"), None),
            "dayNtlVlm": _hl_float(ctx.get("dayNtlVlm"), None),
            "dayBaseVlm": _hl_float(ctx.get("dayBaseVlm"), None),
        })
    return rows


def _hl_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _hl_normalize_candle(c):
    open_ms = int(c.get("t") or c.get("time") or 0)
    return {
        "time": open_ms // 1000,
        "openTime": open_ms,
        "closeTime": int(c.get("T") or 0),
        "open": _hl_float(c.get("o")),
        "high": _hl_float(c.get("h")),
        "low": _hl_float(c.get("l")),
        "close": _hl_float(c.get("c")),
        "volume": _hl_float(c.get("v")),
        "trades": int(c.get("n") or 0),
        "raw": c,
    }


def _hl_normalize_trade(t):
    side = str(t.get("side") or "").upper()
    if side == "B":
        side = "buy"
    elif side == "A":
        side = "sell"
    else:
        side = str(t.get("side") or "").lower()
    return {
        "id": t.get("tid") or t.get("hash"),
        "tid": t.get("tid"),
        "hash": t.get("hash"),
        "time": int(t.get("time") or t.get("T") or 0),
        "price": _hl_float(t.get("px") or t.get("price")),
        "qty": _hl_float(t.get("sz") or t.get("size")),
        "size": _hl_float(t.get("sz") or t.get("size")),
        "side": side,
        "raw": t,
    }


def _hl_normalize_book_level(level):
    if isinstance(level, dict):
        return {
            "price": _hl_float(level.get("px") or level.get("price")),
            "size": _hl_float(level.get("sz") or level.get("size")),
            "n": int(level.get("n") or 0),
            "raw": level,
        }
    if isinstance(level, (list, tuple)) and len(level) >= 2:
        return {"price": _hl_float(level[0]), "size": _hl_float(level[1]), "n": int(level[2]) if len(level) > 2 else 0}
    return {"price": 0.0, "size": 0.0, "n": 0, "raw": level}


@app.get("/api/hyperliquid/catalog")
def hyperliquid_catalog():
    force = _hl_force_param()
    catalog, err = _hl_get_meta_catalog(force=force)
    if err:
        return jsonify(err[0]), err[1]
    return jsonify(catalog)


@app.get("/api/hyperliquid/resolve")
def hyperliquid_resolve():
    market = request.args.get("market", "BTC").strip()
    resolved, err = _hl_resolve_coin(market, force=_hl_force_param())
    if err:
        return jsonify(err[0]), err[1]
    return jsonify({"ok": True, **resolved})


@app.get("/api/hyperliquid/mids")
def hyperliquid_mids():
    force = _hl_force_param()
    data, err = _hl_info_cached({"type": "allMids"}, "hl:allMids", _HL_TTLS["mids"], force=force)
    if err:
        return jsonify(err[0]), err[1]
    return jsonify({
        "ok": True,
        "source": "hyperliquid",
        "mids": data if isinstance(data, dict) else {},
        "cache": {"hit": False, "stale": False, "age": 0, "ttl": _HL_TTLS["mids"]},
    })


@app.get("/api/hyperliquid/dexs")
def hyperliquid_dexs():
    force = _hl_force_param()
    raw, err = _hl_info_cached({"type": "perpDexs"}, "hl:perpDexs", _HL_TTLS["dexs"], force=force)
    if err:
        return jsonify(err[0]), err[1]
    return jsonify({
        "ok": True,
        "source": "hyperliquid",
        "dexs": raw if isinstance(raw, list) else [],
        "cache": {"hit": False, "stale": False, "age": 0, "ttl": _HL_TTLS["dexs"]},
    })


@app.get("/api/hyperliquid/contexts")
def hyperliquid_contexts():
    force = _hl_force_param()
    market = request.args.get("market")
    dex = _hl_optional_dex_param()
    resolved = None
    if market:
        resolved, err = _hl_resolve_coin(market.strip(), force=force)
        if err:
            return jsonify(err[0]), err[1]
        if dex is None and ":" in resolved["coin"]:
            dex = resolved["coin"].split(":", 1)[0]

    req = {"type": "metaAndAssetCtxs"}
    cache_dex = dex or "default"
    if dex:
        req["dex"] = dex
    raw, err = _hl_info_cached(req, f"hl:metaAndAssetCtxs:{cache_dex}", _HL_TTLS["contexts"], force=force)
    if err:
        return jsonify(err[0]), err[1]

    rows = _hl_context_rows(raw, dex or "")
    if resolved:
        target = resolved["coin"].upper()
        rows = [r for r in rows if r["coin"].upper() == target or r["name"].upper() == target]
    return jsonify({
        "ok": True,
        "source": "hyperliquid",
        "market": market,
        "resolved": resolved,
        "dex": dex or "default",
        "contexts": rows,
        "count": len(rows),
        "cache": {"hit": False, "stale": False, "age": 0, "ttl": _HL_TTLS["contexts"]},
    })


@app.get("/api/hyperliquid/annotations")
def hyperliquid_annotations():
    force = _hl_force_param()
    annotations, ann_err = _hl_info_cached({"type": "perpConciseAnnotations"}, "hl:perpConciseAnnotations", _HL_TTLS["annotations"], force=force)
    categories, cat_err = _hl_info_cached({"type": "perpCategories"}, "hl:perpCategories", _HL_TTLS["annotations"], force=force)
    if ann_err and cat_err:
        return jsonify(ann_err[0]), ann_err[1]
    return jsonify({
        "ok": True,
        "source": "hyperliquid",
        "annotations": annotations if isinstance(annotations, (list, dict)) else [],
        "categories": categories if isinstance(categories, (list, dict)) else [],
        "upstream_error": (ann_err or cat_err or [None])[0],
        "cache": {"hit": False, "stale": False, "age": 0, "ttl": _HL_TTLS["annotations"]},
    })


@app.get("/api/hyperliquid/klines")
def hyperliquid_klines():
    market = request.args.get("market", "BTC").strip()
    interval = request.args.get("interval", "5m").strip()
    if interval not in _HL_INTERVAL_WHITELIST:
        return jsonify({"error": f"Intervalle Hyperliquid non supporte: {interval}"}), 400

    try:
        limit = _hl_parse_int("limit", 1000, 1, 5000)
        start_time = _hl_parse_int("startTime")
        end_time = _hl_parse_int("endTime")
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    if end_time is None:
        end_time = int(_hl_time.time() * 1000)
    if start_time is None:
        # Large enough default for history views; the exchange still enforces its own limits.
        minutes = {"1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "2h": 120, "4h": 240, "8h": 480, "12h": 720, "1d": 1440, "3d": 4320, "1w": 10080, "1M": 43200}[interval]
        start_time = end_time - (limit * minutes * 60_000)
    if start_time >= end_time:
        return jsonify({"error": "startTime doit etre inferieur a endTime"}), 400

    force = _hl_force_param()
    resolved, err = _hl_resolve_coin(market, force=force)
    if err:
        return jsonify(err[0]), err[1]
    coin = resolved["coin"]

    cache_key = f"hl:candles:{coin}:{interval}:{limit}:{start_time}:{end_time}"
    raw, err = _hl_info_cached({
        "type": "candleSnapshot",
        "req": {"coin": coin, "interval": interval, "startTime": start_time, "endTime": end_time},
    }, cache_key, _HL_TTLS["candles"], force=force)
    if err:
        return jsonify(err[0]), err[1]

    candles = [_hl_normalize_candle(c) for c in (raw or []) if isinstance(c, dict)]
    candles.sort(key=lambda c: c["openTime"])
    if len(candles) > limit:
        candles = candles[-limit:]
    return jsonify({
        "ok": True,
        "source": "hyperliquid",
        "market": market,
        "coin": coin,
        "resolved": resolved,
        "interval": interval,
        "candles": candles,
        "count": len(candles),
        "requested": {"startTime": start_time, "endTime": end_time, "limit": limit},
        "cache": {"hit": False, "stale": False, "age": 0, "ttl": _HL_TTLS["candles"]},
    })


@app.get("/api/hyperliquid/trades")
def hyperliquid_trades():
    market = request.args.get("market", "BTC").strip()
    force = _hl_force_param()
    resolved, err = _hl_resolve_coin(market, force=force)
    if err:
        return jsonify(err[0]), err[1]
    coin = resolved["coin"]

    cache_key = f"hl:recentTrades:{coin}"
    raw, err = _hl_info_cached({"type": "recentTrades", "coin": coin}, cache_key, _HL_TTLS["trades"], force=force)
    if err:
        return jsonify(err[0]), err[1]
    trades = [_hl_normalize_trade(t) for t in (raw or []) if isinstance(t, dict)]
    trades.sort(key=lambda t: t["time"])
    return jsonify({
        "ok": True,
        "source": "hyperliquid",
        "market": market,
        "coin": coin,
        "resolved": resolved,
        "trades": trades,
        "count": len(trades),
        "cache": {"hit": False, "stale": False, "age": 0, "ttl": _HL_TTLS["trades"]},
    })


@app.get("/api/hyperliquid/orderbook")
def hyperliquid_orderbook():
    market = request.args.get("market", "BTC").strip()
    force = _hl_force_param()
    resolved, err = _hl_resolve_coin(market, force=force)
    if err:
        return jsonify(err[0]), err[1]
    coin = resolved["coin"]

    req = {"coin": coin}
    try:
        n_sig_figs = _hl_parse_int("nSigFigs", None, 2, 5)
        mantissa = _hl_parse_int("mantissa", None, 1, 5)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    if n_sig_figs is not None:
        req["nSigFigs"] = n_sig_figs
    if mantissa is not None:
        req["mantissa"] = mantissa

    cache_key = f"hl:l2Book:{coin}:{n_sig_figs}:{mantissa}"
    raw, err = _hl_info_cached({"type": "l2Book", **req}, cache_key, _HL_TTLS["book"], force=force)
    if err:
        return jsonify(err[0]), err[1]
    levels = raw.get("levels") if isinstance(raw, dict) else []
    bids = [_hl_normalize_book_level(x) for x in (levels[0] if len(levels) > 0 else [])]
    asks = [_hl_normalize_book_level(x) for x in (levels[1] if len(levels) > 1 else [])]
    return jsonify({
        "ok": True,
        "source": "hyperliquid",
        "market": market,
        "coin": coin,
        "resolved": resolved,
        "time": raw.get("time") if isinstance(raw, dict) else None,
        "bids": bids,
        "asks": asks,
        "raw": raw,
        "cache": {"hit": False, "stale": False, "age": 0, "ttl": _HL_TTLS["book"]},
    })


@app.get("/api/hyperliquid/funding")
def hyperliquid_funding():
    market = request.args.get("market", "BTC").strip()
    try:
        start_time = _hl_parse_int("startTime")
        end_time = _hl_parse_int("endTime")
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    if end_time is None:
        end_time = int(_hl_time.time() * 1000)
    if start_time is None:
        start_time = end_time - (7 * 24 * 60 * 60 * 1000)

    force = _hl_force_param()
    resolved, err = _hl_resolve_coin(market, force=force)
    if err:
        return jsonify(err[0]), err[1]
    coin = resolved["coin"]

    cache_key = f"hl:fundingHistory:{coin}:{start_time}:{end_time}"
    raw, err = _hl_info_cached({
        "type": "fundingHistory",
        "coin": coin,
        "startTime": start_time,
        "endTime": end_time,
    }, cache_key, _HL_TTLS["funding"], force=force)
    if err:
        return jsonify(err[0]), err[1]
    return jsonify({
        "ok": True,
        "source": "hyperliquid",
        "market": market,
        "coin": coin,
        "resolved": resolved,
        "funding": raw if isinstance(raw, list) else [],
        "count": len(raw) if isinstance(raw, list) else 0,
        "requested": {"startTime": start_time, "endTime": end_time},
        "cache": {"hit": False, "stale": False, "age": 0, "ttl": _HL_TTLS["funding"]},
    })


@app.get("/api/hyperliquid/predicted-funding")
def hyperliquid_predicted_funding():
    market = request.args.get("market")
    force = _hl_force_param()
    resolved = None
    target = None
    if market:
        resolved, err = _hl_resolve_coin(market.strip(), force=force)
        if err:
            return jsonify(err[0]), err[1]
        target = resolved["coin"].upper()

    raw, err = _hl_info_cached({"type": "predictedFundings"}, "hl:predictedFundings", _HL_TTLS["predicted_funding"], force=force)
    if err:
        return jsonify(err[0]), err[1]

    rows = raw if isinstance(raw, list) else []
    if target:
        rows = [r for r in rows if isinstance(r, list) and r and str(r[0]).upper() == target]
    return jsonify({
        "ok": True,
        "source": "hyperliquid",
        "market": market,
        "resolved": resolved,
        "predictedFunding": rows,
        "count": len(rows),
        "cache": {"hit": False, "stale": False, "age": 0, "ttl": _HL_TTLS["predicted_funding"]},
    })


@app.get("/api/hyperliquid/open-interest-caps")
def hyperliquid_open_interest_caps():
    force = _hl_force_param()
    raw, err = _hl_info_cached({"type": "perpsAtOpenInterestCap"}, "hl:perpsAtOpenInterestCap", _HL_TTLS["open_interest_cap"], force=force)
    if err:
        return jsonify(err[0]), err[1]
    return jsonify({
        "ok": True,
        "source": "hyperliquid",
        "markets": raw if isinstance(raw, list) else [],
        "cache": {"hit": False, "stale": False, "age": 0, "ttl": _HL_TTLS["open_interest_cap"]},
    })
