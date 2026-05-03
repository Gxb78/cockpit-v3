# ---------- Routes API : Market data (Binance proxy) ----------
#
# Proxies Binance public API to avoid CORS issues in dev.
# Endpoints :
#   GET /api/market/klines?symbol=BTCUSDT&interval=1h&limit=100
#   Supports arbitrary limits via pagination (Binance max 1000/req).


import urllib.request
import json as _json
import time as _time_mod

BINANCE_API = "https://api.binance.com"
MAX_PER_REQUEST = 1000
MAX_TOTAL_TRADES = 8000
_MAX_PAGES = 8


@app.get("/api/market/klines")
def market_klines():
    """Proxy les klines Binance (bougies chandeliers).

    Query params:
      symbol   (str) : paire (defaut BTCUSDT)
      interval (str) : 1m, 5m, 15m, 1h, 4h, 1d (defaut 1h)
      limit    (int) : nb bougies max (defaut 1000, pas de limite haute)
      startTime(int) : timestamp ms optionnel pour paginer
    """
    symbol = request.args.get("symbol", "BTCUSDT").upper().strip()
    interval = request.args.get("interval", "1h").strip()
    desired = _parse_int_param("limit", 1000)
    start_time = _parse_int_param("startTime")

    all_candles = []
    current_start = start_time

    while len(all_candles) < desired:
        fetch = min(MAX_PER_REQUEST, desired - len(all_candles))
        url = (
            f"{BINANCE_API}/api/v3/klines"
            f"?symbol={symbol}&interval={interval}&limit={fetch}"
        )
        if current_start:
            url += f"&startTime={current_start}"

        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Journal/1.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                raw = resp.read().decode("utf-8")
                batch = _json.loads(raw)
        except urllib.error.HTTPError as e:
            if all_candles:
                break
            return jsonify({"error": f"Binance HTTP {e.code}: {e.reason}"}), e.code
        except urllib.error.URLError as e:
            if all_candles:
                break
            return jsonify({"error": f"Erreur reseau: {e.reason}"}), 502
        except Exception as e:
            if all_candles:
                break
            return jsonify({"error": str(e)}), 500

        if not batch:
            break

        all_candles.extend(batch)
        current_start = batch[-1][0]

    candles = []
    for k in all_candles:
        candles.append({
            "time": k[0] // 1000,
            "open": float(k[1]),
            "high": float(k[2]),
            "low":  float(k[3]),
            "close": float(k[4]),
            "volume": float(k[5]),
        })

    return jsonify({
        "symbol": symbol,
        "interval": interval,
        "candles": candles,
    })


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
    """Parse un paramètre entier avec retour 400 propre si invalide."""
    val = request.args.get(name, None)
    if val is None:
        return default
    try:
        return int(val)
    except (ValueError, TypeError):
        abort(400, f"Parametre '{name}' invalide: doit etre un entier, recu: {val}")


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
        with urllib.request.urlopen(req, timeout=10) as resp:
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

    start_time = _parse_int_param("startTime")
    end_time = _parse_int_param("endTime")
    limit = _parse_int_param("limit", 1000)
    force = _parse_int_param("force", 0)

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
            resp = dict(cached["response"])
            resp["cache"] = {"hit": True, "ttl": _CACHE_TTL_S, "age": int(now - cached["ts"])}
            return jsonify(resp)

    # --- Pagination ---
    all_trades = []
    current_start = start_time
    pages_used = 0
    hit_limit = False

    while len(all_trades) < desired and pages_used < _MAX_PAGES:
        # Requests successive uses fromId based on last received trade
        url = f"{BINANCE_API}/api/v3/aggTrades?symbol={symbol}&limit=1000"
        if current_start:
            url += f"&startTime={current_start}"
        if end_time:
            url += f"&endTime={end_time}"

        batch, err = _fetch_binance_agg(url)
        if err:
            if all_trades:
                break  # Return what we have
            return jsonify(err[0]), err[1]

        if not batch:
            break  # No more data

        # Ajouter (on reçoit déjà dans l'ordre croissant, mais on préfixe pour garder l'ordre temporel)
        all_trades.extend(batch)
        pages_used += 1

        # Next batch: start from last trade time + 1ms
        last_trade_time = batch[-1]["time"]
        current_start = last_trade_time + 1

        # Si Binance a renvoyé < 1000 trades, on a tout ce qu'il y a pour cette période
        if len(batch) < 1000:
            break

        # Si on a atteint la limite demandée, on arrête
        if len(all_trades) >= desired:
            # Tronquer si trop
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
