# ---------- Routes API : Market data (Binance proxy) ----------
#
# Proxies Binance public API to avoid CORS issues in dev.
# Endpoints :
#   GET /api/market/klines?symbol=BTCUSDT&interval=1h&limit=100
#   Supports arbitrary limits via pagination (Binance max 1000/req).


import urllib.request
import json as _json
import time as _time_mod
import copy

BINANCE_API = "https://api.binance.com"
MAX_PER_REQUEST = 1000
MAX_TOTAL_TRADES = 8000
_MAX_PAGES = 8

# === Market Service — klines cache + stale fallback ===

_KLINES_SYMBOL_WHITELIST = frozenset({"BTCUSDT", "ETHUSDT", "SOLUSDT"})
_KLINES_INTERVAL_WHITELIST = frozenset({
    "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"
})
_KLINES_MAX_LIMIT = 1000
_KLINES_CACHE_TTL = 300  # 5min
_KLINES_CACHE_MAX_KEYS = 100
_klines_cache = {}


def _klines_cache_key(symbol, interval, limit, start_time):
    return f"{symbol}:{interval}:{limit}:{start_time}"


def _klines_purge():
    if len(_klines_cache) <= _KLINES_CACHE_MAX_KEYS:
        return
    now = _time_mod.time()
    expired = [k for k, v in _klines_cache.items() if (now - v["ts"]) >= _KLINES_CACHE_TTL]
    for k in expired:
        del _klines_cache[k]
    if len(_klines_cache) > _KLINES_CACHE_MAX_KEYS:
        sorted_keys = sorted(_klines_cache.keys(), key=lambda k: _klines_cache[k]["ts"])
        for k in sorted_keys[:len(_klines_cache) - _KLINES_CACHE_MAX_KEYS]:
            del _klines_cache[k]


def _fetch_klines_page(url):
    """Fetch une page de klines Binance avec retry sur 429/502/503. Retourne (batch_or_None, error_json_or_None)."""
    import time as _time
    max_attempts = 3
    for attempt in range(max_attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Journal/1.0"})
            with urllib.request.urlopen(req, timeout=3) as resp:
                raw = resp.read().decode("utf-8")
                batch = _json.loads(raw)
            return batch, None
        except urllib.error.HTTPError as e:
            code = e.code
            if code in (429, 502, 503) and attempt < max_attempts - 1:
                _time.sleep(1 + attempt)
                continue
            detail = e.read().decode("utf-8", errors="replace")[:200]
            return None, ({"error": f"Binance HTTP {code}: {detail}"}, code)
        except urllib.error.URLError as e:
            return None, ({"error": f"Erreur reseau: {e.reason}"}, 502)
        except Exception as e:
            if attempt < max_attempts - 1:
                _time.sleep(1 + attempt)
                continue
            return None, ({"error": str(e)}, 500)
    return None, ({"error": "Max retries exceeded"}, 502)


def _normalize_candle(k):
    """Normalise une kline Binance en notre format."""
    return {
        "time": k[0] // 1000,
        "open": float(k[1]),
        "high": float(k[2]),
        "low": float(k[3]),
        "close": float(k[4]),
        "volume": float(k[5]),
    }


def _dedupe_klines(candles):
    """Deduplique les bougies par open time (timestamp ms)."""
    seen = set()
    result = []
    for c in candles:
        t = c["time"]
        if t in seen:
            continue
        seen.add(t)
        result.append(c)
    return result


def fetch_klines(symbol, interval, limit, start_time=None):
    """Fetch klines avec cache, stale fallback, pagination dedupee.

    Retourne un dict avec le nouveau contrat :
      { symbol, interval, candles, source, cache, upstream_error }
    En cas d'erreur avec cache dispo, retourne le cache stale.
    """
    now = _time_mod.time()

    # Whitelists
    if symbol not in _KLINES_SYMBOL_WHITELIST:
        return {"error": f"Symbole non supporte: {symbol}. Supportes: {', '.join(sorted(_KLINES_SYMBOL_WHITELIST))}"}, 400
    if interval not in _KLINES_INTERVAL_WHITELIST:
        return {"error": f"Intervalle non supporte: {interval}"}, 400

    # Clamp limit
    limit = max(1, min(limit, _KLINES_MAX_LIMIT))

    # Cache lookup
    cache_key = _klines_cache_key(symbol, interval, limit, start_time)
    cached = _klines_cache.get(cache_key)
    if cached and (now - cached["ts"]) < _KLINES_CACHE_TTL:
        # Cache hit fresh — retourner directement
        resp = copy.deepcopy(cached["response"])
        resp["cache"]["hit"] = True
        resp["cache"]["age"] = int(now - cached["ts"])
        return resp, 200

    # Pagination
    all_raw = []
    current_start = start_time
    upstream_error = None

    while len(all_raw) < limit:
        fetch = min(MAX_PER_REQUEST, limit - len(all_raw))
        url = f"{BINANCE_API}/api/v3/klines?symbol={symbol}&interval={interval}&limit={fetch}"
        if current_start:
            url += f"&startTime={current_start}"

        batch, err = _fetch_klines_page(url)
        if err:
            upstream_error = err[0].get("error", str(err[0]))
            # Stale fallback: si on a du cache, le retourner avec flag stale
            if cached:
                resp = copy.deepcopy(cached["response"])
                resp["source"] = "cache"
                resp["cache"]["hit"] = True
                resp["cache"]["stale"] = True
                resp["cache"]["age"] = int(now - cached["ts"])
                resp["upstream_error"] = upstream_error
                return resp, 200
            # Sinon, propager l'erreur
            return err[0], err[1]

        if not batch:
            break

        all_raw.extend(batch)

        # Next page: dernier open_time + interval_ms pour éviter les doublons
        # L'open_time est batch[-1][0], l'interval en ms
        interval_ms = _interval_to_ms(interval)
        current_start = batch[-1][0] + interval_ms

        if len(batch) < fetch:
            break

    # Normaliser et dédupliquer
    candles = [_normalize_candle(k) for k in all_raw]
    candles = _dedupe_klines(candles)

    source = "binance"
    age = int(now - cached["ts"]) if cached else 0

    response_data = {
        "symbol": symbol,
        "interval": interval,
        "candles": candles,
        "source": source,
        "cache": {
            "hit": bool(cached),
            "stale": False,
            "age": age,
            "ttl": _KLINES_CACHE_TTL,
        },
        "upstream_error": upstream_error,
    }

    # Mettre en cache
    _klines_cache[cache_key] = {
        "ts": now,
        "response": response_data,
    }
    _klines_purge()

    return response_data, 200


def _interval_to_ms(interval):
    """Convertit un interval Binance en millisecondes."""
    unit = interval[-1]
    val = int(interval[:-1])
    mult = {"m": 60000, "h": 3600000, "d": 86400000, "w": 604800000, "M": 2592000000}
    return val * mult.get(unit, 60000)


@app.get("/api/market/klines")
def market_klines():
    """Proxy les klines Binance (bougies chandeliers) avec cache + stale fallback.

    Query params:
      symbol    (str) : paire (defaut BTCUSDT, whitelist)
      interval  (str) : 1m..1M (defaut 1h, whitelist)
      limit     (int) : nb bougies max (defaut 100, max 1000)
      startTime (int) : timestamp ms optionnel pour paginer
    """
    symbol = request.args.get("symbol", "BTCUSDT").upper().strip()
    interval = request.args.get("interval", "1h").strip()
    try:
        limit = _parse_int_param("limit", 100)
        start_time = _parse_int_param("startTime")
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    data, status = fetch_klines(symbol, interval, limit, start_time)
    if status != 200 and isinstance(data, dict) and "error" in data:
        return jsonify(data), status

    return jsonify(data), 200


# =====================================================================
# Aggregated Trades (aggTrades) — pour footprint charts
# =====================================================================
# Proxies Binance /api/v3/aggTrades. Public — no API key needed.
# Champs Binance bruts : a=aggTradeId, p=price, q=qty, f=firstId,
#   l=lastId, T=tradeTime(ms), m=isBuyerMaker(true=sell, false=buy)
#
# Notre format normalisé : {id, time, price, qty, side}
#   side = "sell" si isBuyerMaker (m=True), "buy" sinon

_SYMBOL_WHITELIST = frozenset({"BTCUSDT", "ETHUSDT", "SOLUSDT"})
_MAX_TIME_RANGE_MS = 24 * 60 * 60 * 1000  # 24h max par requête
_CACHE_TTL_S = 30  # cache court — les aggTrades sont immutables
_CACHE_MAX_KEYS = 100

# Cache simple en mémoire : clé = "symbol:startTime:endTime:limit"
_aggtrade_cache = {}


def _purge_cache():
    """Supprime les entrées expirées si le cache dépasse _CACHE_MAX_KEYS."""
    if len(_aggtrade_cache) <= _CACHE_MAX_KEYS:
        return
    now = _time_mod.time()
    # Supprimer les expirées
    expired = [k for k, v in _aggtrade_cache.items() if (now - v["ts"]) >= _CACHE_TTL_S]
    for k in expired:
        del _aggtrade_cache[k]
    # Si toujours trop, supprimer les plus vieilles
    if len(_aggtrade_cache) > _CACHE_MAX_KEYS:
        sorted_keys = sorted(_aggtrade_cache.keys(), key=lambda k: _aggtrade_cache[k]["ts"])
        for k in sorted_keys[:len(_aggtrade_cache) - _CACHE_MAX_KEYS]:
            del _aggtrade_cache[k]


def _parse_int_param(name, default=None):
    """Parse un paramètre entier, retourne default si absent, jsonify+400 si invalide."""
    val = request.args.get(name, None)
    if val is None:
        return default
    try:
        return int(val)
    except (ValueError, TypeError):
        # abort(400) peut retourner HTML — on return jsonify direct
        raise ValueError(f"Parametre '{name}' invalide: doit etre un entier, recu: {val}")


def _format_aggTrade(t):
    """Normalise un aggTrade Binance en notre format."""
    return {
        "id": t["a"],
        "time": t["T"],
        "price": float(t["p"]),
        "qty": float(t["q"]),
        "side": "sell" if t["m"] else "buy",
    }


def _fetch_binance_agg(url):
    """Fetch une page Binance, retourne (batch_or_None, error_json_or_None)."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Journal/1.0"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            raw = resp.read().decode("utf-8")
            batch = _json.loads(raw)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:200]
        return None, ({"error": f"Binance HTTP {e.code}: {detail}"}, e.code)
    except urllib.error.URLError as e:
        return None, ({"error": f"Erreur reseau: {e.reason}"}, 502)
    except Exception as e:
        return None, ({"error": str(e)}, 500)

    if not isinstance(batch, list):
        return None, ({"error": "Format inattendu Binance", "raw": str(batch)[:300]}, 502)

    trades = [_format_aggTrade(t) for t in batch]
    return trades, None


@app.get("/api/market/aggtrades")
def market_aggtrades():
    """Proxy les aggTrades Binance pour footprint charts, avec pagination backend.

    Query params:
      symbol    (str) : paire (BTCUSDT, ETHUSDT, SOLUSDT)
      startTime (int) : timestamp ms debut (optionnel)
      endTime   (int) : timestamp ms fin (optionnel, max 24h apres start)
      limit     (int) : nb trades max (defaut 1000, max {MAX_TOTAL_TRADES})
      force     (int) : 1 pour contourner le cache

    Retourne un objet avec trades, requested, actual, limits, cache.
    """
    symbol = request.args.get("symbol", "BTCUSDT").upper().strip()
    if symbol not in _SYMBOL_WHITELIST:
        return jsonify({"error": f"Symbole non supporte: {symbol}. Supportes: {', '.join(sorted(_SYMBOL_WHITELIST))}"}), 400

    # Parser les parametres entiers avec JSON 400 propre
    try:
        start_time = _parse_int_param("startTime")
        end_time = _parse_int_param("endTime")
        limit = _parse_int_param("limit", 1000)
        force = _parse_int_param("force", 0)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    # Clamp limit
    limit = max(1, min(limit, MAX_TOTAL_TRADES))
    desired = limit

    # Valider plage temporelle
    if start_time and end_time:
        if end_time - start_time > _MAX_TIME_RANGE_MS:
            return jsonify({
                "error": f"Plage trop large: max {_MAX_TIME_RANGE_MS // 3600000}h"
            }), 400

    # Cache lookup (sauf si force=1)
    cache_key = f"{symbol}:{start_time}:{end_time}:{desired}"
    now = _time_mod.time()
    if not force:
        cached = _aggtrade_cache.get(cache_key)
        if cached and (now - cached["ts"]) < _CACHE_TTL_S:
            resp = copy.deepcopy(cached["response"])
            resp["cache"] = {"hit": True, "ttl": _CACHE_TTL_S, "age": int(now - cached["ts"])}
            return jsonify(resp)

    # --- Pagination ---
    all_trades = []
    pages_used = 0
    hit_limit = False
    # Premier appel avec startTime (si fourni), puis fromId pour les pages suivantes
    next_from_id = None

    while len(all_trades) < desired and pages_used < _MAX_PAGES:
        url = f"{BINANCE_API}/api/v3/aggTrades?symbol={symbol}&limit=1000"
        if next_from_id:
            # Pages suivantes: pagination par fromId (précise, pas de trous)
            url += f"&fromId={next_from_id}"
        else:
            # Première page: avec startTime/endTime
            if start_time:
                url += f"&startTime={start_time}"
            if end_time:
                url += f"&endTime={end_time}"

        batch, err = _fetch_binance_agg(url)
        if err:
            if all_trades:
                break
            return jsonify(err[0]), err[1]

        if not batch:
            break

        # Si c'est la première page, filtrer les trades > endTime
        if not next_from_id and end_time:
            batch = [t for t in batch if t["time"] <= end_time]
            if not batch:
                break

        all_trades.extend(batch)
        pages_used += 1

        # Next page: fromId = dernier aggTradeId + 1
        last_id = batch[-1]["id"] if batch else 0
        next_from_id = last_id + 1

        # Si Batch < 1000, plus de donnees disponibles
        if len(batch) < 1000:
            break

        if len(all_trades) >= desired:
            if len(all_trades) > desired:
                all_trades = all_trades[:desired]
            break

    # Vérifier si on a été limité
    if pages_used >= _MAX_PAGES or len(all_trades) >= desired:
        hit_limit = (len(batch) >= 1000) if batch else False

    # Trier par time croissant (les pages sont concaténées dans l'ordre mais on assure)
    all_trades.sort(key=lambda t: t["time"])

    # Calculer couverture réelle
    first_time = all_trades[0]["time"] if all_trades else None
    last_time = all_trades[-1]["time"] if all_trades else None

    response_data = {
        "symbol": symbol,
        "trades": all_trades,
        "cached": False,
        "count": len(all_trades),
        "requested": {
            "startTime": start_time,
            "endTime": end_time,
        },
        "actual": {
            "firstTradeTime": first_time,
            "lastTradeTime": last_time,
            "coverageMs": (last_time - first_time) if first_time and last_time else 0,
        },
        "limits": {
            "maxTrades": desired,
            "pagesUsed": pages_used,
            "hitBinanceLimit": hit_limit,
        },
        "cache": {
            "hit": False,
            "ttl": _CACHE_TTL_S,
        },
    }

    # Mettre en cache (payload complet)
    _aggtrade_cache[cache_key] = {
        "ts": _time_mod.time(),
        "response": response_data,
    }
    _purge_cache()

    return jsonify(response_data)
