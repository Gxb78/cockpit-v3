# ---------- Routes API : Market data (Binance proxy) ----------
#
# Proxies Binance public API to avoid CORS issues in dev.
# Endpoints :
#   GET /api/market/klines?symbol=BTCUSDT&interval=1h&limit=100
#   Supports arbitrary limits via pagination (Binance max 1000/req).


import urllib.request
import json as _json

BINANCE_API = "https://api.binance.com"
MAX_PER_REQUEST = 1000


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
    desired = int(request.args.get("limit", 1000))
    start_time = request.args.get("startTime", None)

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
            # If we already have some data, return what we have
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
            break  # No more data available

        all_candles.extend(batch)

        # Set startTime to the open time of the last candle for next page
        current_start = batch[-1][0]

    # Formater pour le frontend
    candles = []
    for k in all_candles:
        candles.append({
            "time": k[0] // 1000,  # ms → s (timeframe Unix)
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

import time as _time

_SYMBOL_WHITELIST = frozenset({"BTCUSDT", "ETHUSDT", "SOLUSDT"})
_MAX_TIME_RANGE_MS = 24 * 60 * 60 * 1000  # 24h max par requête
_CACHE_TTL_S = 30  # cache court — les aggTrades sont immutables

# Cache simple en mémoire : clé = "symbol:startTime:endTime"
_aggtrade_cache = {}


def _format_aggTrade(t):
    """Normalise un aggTrade Binance en notre format."""
    return {
        "id": t["a"],
        "time": t["T"],
        "price": float(t["p"]),
        "qty": float(t["q"]),
        "side": "sell" if t["m"] else "buy",
    }


@app.get("/api/market/aggtrades")
def market_aggtrades():
    """Proxy les aggTrades Binance pour footprint charts.

    Query params:
      symbol    (str) : paire (BTCUSDT, ETHUSDT, SOLUSDT)
      startTime (int) : timestamp ms debut (optionnel)
      endTime   (int) : timestamp ms fin (optionnel, max 24h apres start)
      limit     (int) : nb trades max (defaut 1000, max 1000)

    Retourne un tableau de trades normalises tries par time croissant.
    """
    symbol = request.args.get("symbol", "BTCUSDT").upper().strip()
    if symbol not in _SYMBOL_WHITELIST:
        return jsonify({"error": f"Symbole non supporte: {symbol}. Supportes: {', '.join(sorted(_SYMBOL_WHITELIST))}"}), 400

    start_time = request.args.get("startTime", None)
    end_time = request.args.get("endTime", None)
    limit = int(request.args.get("limit", 1000))

    # Valider plage temporelle
    if start_time:
        start_time = int(start_time)
        if end_time:
            end_time = int(end_time)
            if end_time - start_time > _MAX_TIME_RANGE_MS:
                return jsonify({
                    "error": f"Plage trop large: max {_MAX_TIME_RANGE_MS // 3600000}h"
                }), 400

    # Clé de cache
    cache_key = f"{symbol}:{start_time}:{end_time}:{limit}"
    cached = _aggtrade_cache.get(cache_key)
    now = _time.time()
    if cached and (now - cached["ts"]) < _CACHE_TTL_S:
        return jsonify({
            "symbol": symbol,
            "trades": cached["trades"],
            "cached": True,
            "count": len(cached["trades"]),
        })

    # Construire l'URL Binance
    url = f"{BINANCE_API}/api/v3/aggTrades?symbol={symbol}&limit={limit}"
    if start_time:
        url += f"&startTime={start_time}"
    if end_time:
        url += f"&endTime={end_time}"

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Journal/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8")
            batch = _json.loads(raw)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:200]
        return jsonify({"error": f"Binance HTTP {e.code}: {detail}"}), e.code
    except urllib.error.URLError as e:
        return jsonify({"error": f"Erreur reseau: {e.reason}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    if not isinstance(batch, list):
        return jsonify({"error": "Format inattendu Binance", "raw": str(batch)[:300]}), 502

    trades = [_format_aggTrade(t) for t in batch]

    # Trier par time croissant (Binance les renvoie déjà tries mais on assure)
    trades.sort(key=lambda t: t["time"])

    # Mettre en cache
    _aggtrade_cache[cache_key] = {
        "ts": now,
        "trades": trades,
    }

    # Calculer couverture reelle
    first_time = trades[0]["time"] if trades else None
    last_time = trades[-1]["time"] if trades else None

    return jsonify({
        "symbol": symbol,
        "trades": trades,
        "cached": False,
        "count": len(trades),
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
            "maxTrades": limit,
            "hitBinanceLimit": len(trades) >= limit,
        },
        "cache": {
            "hit": False,
            "ttl": _CACHE_TTL_S,
        },
    })
