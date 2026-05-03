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
