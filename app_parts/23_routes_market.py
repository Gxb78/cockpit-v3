# ---------- Routes API : Market data (Binance proxy) ----------
#
# Proxies Binance public API to avoid CORS issues in dev.
# Endpoints :
#   GET /api/market/klines?symbol=BTCUSDT&interval=1h&limit=100


import urllib.request
import json as _json

BINANCE_API = "https://api.binance.com"


@app.get("/api/market/klines")
def market_klines():
    """Proxy les klines Binance (bougies chandeliers).

    Query params:
      symbol   (str) : paire (defaut BTCUSDT)
      interval (str) : 1m, 5m, 15m, 1h, 4h, 1d (defaut 1h)
      limit    (int) : nb bougies max (defaut 200, max 1000)
    """
    symbol = request.args.get("symbol", "BTCUSDT").upper().strip()
    interval = request.args.get("interval", "1h").strip()
    limit = min(int(request.args.get("limit", 200)), 1000)

    url = f"{BINANCE_API}/api/v3/klines?symbol={symbol}&interval={interval}&limit={limit}"

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Journal/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8")
            data = _json.loads(raw)
    except urllib.error.HTTPError as e:
        return jsonify({"error": f"Binance HTTP {e.code}: {e.reason}"}), e.code
    except urllib.error.URLError as e:
        return jsonify({"error": f"Erreur reseau: {e.reason}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # Formater pour le frontend
    candles = []
    for k in data:
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
