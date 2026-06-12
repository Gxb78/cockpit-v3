# ---------- Market History Cache : SQLite backend pour klines longue duree ----------
#
# Probleme : Binance ne retourne que ~1000 candles par requete.
# Pour du Volume Profile 90D/366D, on a besoin de 2000+ candles fluides.
#
# Solution : Cache SQLite persistant avec pagination Binance automatique.
#   - Table market_klines : (symbol, interval, time) PK
#   - Endpoint GET /api/market/klines/history?symbol=&interval=&days=
#   - Si le cache couvre la periode, retour direct depuis SQLite
#   - Sinon fetch Binance pagine, upsert, retour depuis SQLite
#
# Depend de : get_db(), _normalize_candle(), _interval_to_ms(), _fetch_klines_page()
# (definis dans 02_database.py, 23_routes_market.py - namespace partage)

import time as _time
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Cache coverage check
# ---------------------------------------------------------------------------

def _history_cache_coverage(symbol, interval, start_time_s, end_time_s):
    """Retourne {'ok': True} si le cache couvre toute la plage, ou
    {'ok': False, first_gap': timestamp_s, 'last_gap': timestamp_s} avec
    la premiere et derniere bougie manquantes."""
    db = get_db()
    row = db.execute(
        "SELECT MIN(time) AS first_ts, MAX(time) AS last_ts, COUNT(*) AS cnt "
        "FROM market_klines WHERE symbol=? AND interval=?",
        (symbol, interval)
    ).fetchone()

    if not row or row["cnt"] == 0:
        return {"ok": False, "reason": "empty"}

    first_ts = row["first_ts"]
    last_ts = row["last_ts"]

    # Tolerance : on accepte un decalage de 2 intervalles en debut et fin.
    # Pour 4h → 8h de tolerance, pour 15m → 30min.
    # Le cache ne peut pas couvrir la bougie courante (pas fermee).
    interval_ms = _interval_to_ms(interval)
    interval_s = interval_ms // 1000
    tolerance_s = interval_s * 2

    # Est-ce que la couverture commence assez tot ?
    if first_ts > start_time_s + tolerance_s:
        return {"ok": False, "reason": "start_gap",
                "first_gap": start_time_s, "last_gap": first_ts}

    # Est-ce que la couverture va jusqu'a la fin ?
    if last_ts < end_time_s - tolerance_s:
        return {"ok": False, "reason": "end_gap",
                "first_gap": last_ts, "last_gap": end_time_s}

    # Compter les trous : verifier que le nombre de bougies est coherent
    expected = max(0, (last_ts - first_ts) // interval_s) + 1
    if row["cnt"] < expected * 0.9:
        return {"ok": False, "reason": "sparse",
                "first_gap": first_ts, "last_gap": last_ts}

    return {"ok": True}


def _read_history_candles(symbol, interval, start_time_s, end_time_s):
    """Lit les candles depuis SQLite pour la plage demandee."""
    db = get_db()
    rows = db.execute(
        "SELECT time, open, high, low, close, volume "
        "FROM market_klines "
        "WHERE symbol=? AND interval=? AND time>=? AND time<=? "
        "ORDER BY time ASC",
        (symbol, interval, start_time_s, end_time_s)
    ).fetchall()

    candles = []
    for r in rows:
        candles.append({
            "time": r["time"],
            "open": r["open"],
            "high": r["high"],
            "low": r["low"],
            "close": r["close"],
            "volume": r["volume"],
        })
    return candles


# ---------------------------------------------------------------------------
# Table creation
# ---------------------------------------------------------------------------

def _ensure_market_history_table():
    """Cree la table market_klines si besoin (appelee au premier usage)."""
    db = get_db()
    db.execute("""
        CREATE TABLE IF NOT EXISTS market_klines (
            symbol   TEXT NOT NULL,
            interval TEXT NOT NULL,
            time     INTEGER NOT NULL,
            open     REAL NOT NULL,
            high     REAL NOT NULL,
            low      REAL NOT NULL,
            close    REAL NOT NULL,
            volume   REAL NOT NULL,
            PRIMARY KEY (symbol, interval, time)
        )
    """)
    db.execute("""
        CREATE INDEX IF NOT EXISTS idx_market_klines_lookup
        ON market_klines(symbol, interval, time)
    """)
    db.commit()


# ---------------------------------------------------------------------------
# Upsert helpers
# ---------------------------------------------------------------------------

def _upsert_klines_batch(symbol, interval, candles):
    """Insere ou ignore des bougies normalisees dans le cache SQLite."""
    db = get_db()
    for c in candles:
        db.execute(
            "INSERT OR IGNORE INTO market_klines "
            "(symbol, interval, time, open, high, low, close, volume) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (symbol, interval,
             c["time"],
             c["open"], c["high"], c["low"], c["close"], c["volume"])
        )
    db.commit()


# ---------------------------------------------------------------------------
# Binance pagination
# ---------------------------------------------------------------------------

def _fetch_history_from_binance(symbol, interval, days):
    """Pagine Binance pour (symbol, interval) sur N jours, upsert dans SQLite.

    Repete: fetch MAX_PER_REQUEST klines avec startTime, avance de
    interval_ms, jusqu'a couvrir la periode demandee.

    Retourne le nombre de bougies fetchées.
    """
    now_ms = int(_time.time() * 1000)
    interval_ms = _interval_to_ms(interval)
    duration_ms = days * 86400 * 1000
    start_ms = now_ms - duration_ms

    total_fetched = 0
    current_start = start_ms
    max_pages = (duration_ms // (interval_ms * 990)) + 2  # securite

    for page in range(max_pages):
        # Construire la querystring pour Binance
        qs = f"/api/v3/klines?symbol={symbol}&interval={interval}&limit={MAX_PER_REQUEST}&startTime={current_start}"
        batch, err = _fetch_klines_page(qs)

        if err or not batch:
            if err:
                log.warning("market_history: page %d erreur %s", page, err[0].get("error", str(err[0])))
            break

        if not isinstance(batch, list) or len(batch) == 0:
            break

        # Normaliser et upsert
        candles = [_normalize_candle(k) for k in batch]
        _upsert_klines_batch(symbol, interval, candles)
        total_fetched += len(candles)

        # Avancer : dernier open_time + interval_ms
        last_open_ms = batch[-1][0]
        current_start = last_open_ms + interval_ms

        # Si Binance a renvoye moins que demande, c'est fini
        if len(batch) < 1000:
            break

        # Si on a deja depasse la fenetre, inutile de continuer
        if current_start >= now_ms:
            break

    log.info("market_history: fetched %d candles %s %s for %d days",
             total_fetched, symbol, interval, days)
    return total_fetched


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@app.get("/api/market/klines/history")
def market_klines_history():
    """Endpoint historique longue duree avec cache SQLite persistant.

    Query params:
      symbol   (str) : paire (defaut BTCUSDT, whitelist)
      interval (str) : 1m..1w (defaut 1h)
      days     (int) : nb jours d'historique (defaut 30)

    Comportement:
      1. Calcule start_time = now - days
      2. Verifie la couverture du cache SQLite
      3. Si OK : retourne direct depuis SQLite
      4. Sinon : pagine Binance, upsert, retourne depuis SQLite

    Reponse:
      { symbol, interval, days, source, candles: [...] }
    """
    symbol = request.args.get("symbol", "BTCUSDT").upper().strip()
    interval = request.args.get("interval", "1h").strip()
    try:
        days = _parse_int_param("days", 30)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    # Validation
    if not _is_supported_kline_symbol(symbol):
        return jsonify({"error": f"Symbole non supporte: {symbol}. Format attendu: crypto quotee USDT/USDC/FDUSD/BTC/ETH/BNB."}), 400
    if interval not in _KLINES_INTERVAL_WHITELIST:
        return jsonify({"error": f"Intervalle non supporte: {interval}"}), 400

    days = max(1, min(days, 365 * 5))  # max 5 ans

    # Bornes temporelles en secondes
    now_s = int(_time.time())
    start_time_s = now_s - days * 86400
    end_time_s = now_s

    # S'assurer que la table existe
    try:
        _ensure_market_history_table()
    except Exception as e:
        log.error("market_history: table creation failed: %s", e)
        return jsonify({"error": "Database error"}), 500

    # Verifier la couverture du cache
    coverage = _history_cache_coverage(symbol, interval, start_time_s, end_time_s)
    source_parts = []

    if coverage.get("ok"):
        # Cache OK -> retour direct
        candles = _read_history_candles(symbol, interval, start_time_s, end_time_s)
        if candles:
            return jsonify({
                "symbol": symbol,
                "interval": interval,
                "days": days,
                "source": "sqlite",
                "candles": candles,
            }), 200

    # Cache insuffisant -> fetch Binance
    try:
        total = _fetch_history_from_binance(symbol, interval, days)
        source_parts.append("binance")
    except Exception as e:
        log.error("market_history: binance fetch failed: %s", e)
        # Fallback : si on a des donnees partielles, les retourner
        candles = _read_history_candles(symbol, interval, start_time_s, end_time_s)
        if candles:
            return jsonify({
                "symbol": symbol,
                "interval": interval,
                "days": days,
                "source": "sqlite+partial",
                "candles": candles,
            }), 200
        return jsonify({"error": f"Binance fetch failed: {str(e)}"}), 502

    # Lire depuis SQLite apres le fetch
    candles = _read_history_candles(symbol, interval, start_time_s, end_time_s)
    source_parts.append("sqlite")

    return jsonify({
        "symbol": symbol,
        "interval": interval,
        "days": days,
        "source": "+".join(source_parts),
        "candles": candles,
    }), 200
