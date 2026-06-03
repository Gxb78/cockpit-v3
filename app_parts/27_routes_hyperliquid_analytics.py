# ---------- Routes API: Hyperliquid analytics workspace ----------
#
# Market archives are isolated from journal.db. Flask queries normalized
# partitions and maintains a small WAL control database. The independently
# launched worker owns ingestion and live persistence.

import datetime as _ha_datetime
import json as _ha_json
import math as _ha_math
import secrets as _ha_secrets
import sqlite3 as _ha_sqlite3
import time as _ha_time
from pathlib import Path as _HaPath


MARKET_DATA_DIR = DATA_DIR / "market"
MARKET_CONTROL_DB = MARKET_DATA_DIR / "control.sqlite"

_HA_DATASETS = frozenset({"trades", "l2"})
_HA_METRICS = frozenset({"notional", "base"})
_HA_PROFILE_TYPES = frozenset({"session", "visible", "fixed", "composite"})
_HA_INTERVAL_MS = {
    "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000,
    "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000,
    "4h": 14_400_000, "8h": 28_800_000, "12h": 43_200_000,
    "1d": 86_400_000,
}
_ha_profile_cache = {}


def _ha_now_ms():
    return int(_ha_time.time() * 1000)


def _ha_root():
    root = _HaPath(MARKET_DATA_DIR)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _ha_control_db():
    path = _ha_root() / "control.sqlite"
    con = _ha_sqlite3.connect(path)
    con.row_factory = _ha_sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA busy_timeout=3000")
    con.executescript("""
        CREATE TABLE IF NOT EXISTS ha_markets (
            coin TEXT PRIMARY KEY,
            market TEXT NOT NULL,
            followed INTEGER NOT NULL DEFAULT 1,
            dataset_version INTEGER NOT NULL DEFAULT 0,
            created_ms INTEGER NOT NULL,
            updated_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ha_coverage (
            coin TEXT NOT NULL,
            dataset TEXT NOT NULL,
            source TEXT NOT NULL,
            start_ms INTEGER,
            end_ms INTEGER,
            complete INTEGER NOT NULL DEFAULT 0,
            gaps_json TEXT NOT NULL DEFAULT '[]',
            updated_ms INTEGER NOT NULL,
            PRIMARY KEY (coin, dataset, source)
        );
        CREATE TABLE IF NOT EXISTS ha_import_previews (
            token TEXT PRIMARY KEY,
            coin TEXT NOT NULL,
            datasets_json TEXT NOT NULL,
            from_value TEXT NOT NULL,
            to_value TEXT NOT NULL,
            object_count INTEGER,
            bytes_estimated INTEGER,
            status TEXT NOT NULL,
            warning TEXT NOT NULL,
            created_ms INTEGER NOT NULL,
            expires_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ha_import_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT NOT NULL,
            coin TEXT NOT NULL,
            datasets_json TEXT NOT NULL,
            status TEXT NOT NULL,
            bytes_total INTEGER,
            bytes_done INTEGER NOT NULL DEFAULT 0,
            partitions_validated INTEGER NOT NULL DEFAULT 0,
            errors_json TEXT NOT NULL DEFAULT '[]',
            gaps_json TEXT NOT NULL DEFAULT '[]',
            created_ms INTEGER NOT NULL,
            updated_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ha_collector_state (
            singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
            heartbeat_ms INTEGER,
            status TEXT NOT NULL,
            details_json TEXT NOT NULL DEFAULT '{}'
        );
    """)
    return con


def _ha_coin(value):
    raw = str(value or "BTC").strip()
    if not raw:
        return "BTC"
    canonical = _HL_CANONICAL_MARKET_ASSETS.get(raw.upper())
    return canonical or raw.upper()


def _ha_partition_coin(coin):
    return str(coin).replace("/", "_").replace("\\", "_")


def _ha_float(value, default=0.0):
    try:
        result = float(value)
        return result if _ha_math.isfinite(result) else default
    except (TypeError, ValueError):
        return default


def _ha_side(raw_side):
    side = str(raw_side or "").upper()
    if side in ("B", "BUY"):
        return "buy"
    if side in ("A", "S", "SELL"):
        return "sell"
    return None


def _ha_normalize_trade(raw, coin=None, source="ws-trades", archive_fill=False):
    coin = _ha_coin(raw.get("coin") or coin)
    time_ms = int(raw.get("timeMs") or raw.get("time") or raw.get("T") or 0)
    tid = raw.get("tid")
    price = _ha_float(raw.get("price", raw.get("px")))
    size = _ha_float(raw.get("sizeBase", raw.get("qty", raw.get("size", raw.get("sz")))))
    if not time_ms or price <= 0 or size <= 0:
        return None
    crossed = raw.get("crossed")
    side = _ha_side(raw.get("aggressorSide") or raw.get("side"))
    if archive_fill and crossed is not True:
        side = None
    identity = str(tid if tid is not None else raw.get("hash") or "")
    trade_key = raw.get("tradeKey") or f"{time_ms}:{coin}:{identity}"
    return {
        "tradeKey": str(trade_key),
        "tid": tid,
        "coin": coin,
        "timeMs": time_ms,
        "price": price,
        "sizeBase": size,
        "notionalUsd": price * size,
        "aggressorSide": side,
        "source": source,
        "crossed": crossed,
    }


def _ha_dedupe_fills(rows, coin=None, source="node_fills_by_block"):
    selected = {}
    for raw in rows or []:
        if not isinstance(raw, dict):
            continue
        normalized = _ha_normalize_trade(raw, coin, source, archive_fill=True)
        if not normalized:
            continue
        key = (normalized["timeMs"], normalized["coin"], normalized["tid"])
        current = selected.get(key)
        if current is None or (current.get("crossed") is not True and normalized.get("crossed") is True):
            selected[key] = normalized
    return sorted(selected.values(), key=lambda row: (row["timeMs"], row["tradeKey"]))


def _ha_tick_size(coin, prices):
    maximum = max(prices or [0])
    if maximum >= 10000:
        return 1.0
    if maximum >= 1000:
        return 0.1
    if maximum >= 10:
        return 0.01
    return 0.0001


def _ha_row_size(raw, coin, trades):
    prices = [row["price"] for row in trades if row.get("price")]
    tick = _ha_tick_size(coin, prices)
    if raw not in (None, "", "auto"):
        value = _ha_float(raw)
        if value > 0:
            return max(tick, round(_ha_math.ceil(value / tick) * tick, 10))
    if not prices:
        return tick
    desired = (max(prices) - min(prices)) / 300.0
    return max(tick, round(_ha_math.ceil(max(tick, desired) / tick) * tick, 10))


def _ha_metric_volume(trade, metric):
    return trade["sizeBase"] if metric == "base" else trade["notionalUsd"]


def _ha_levels(trades, metric, row_size):
    levels = {}
    for trade in trades:
        low = _ha_math.floor((trade["price"] + row_size * 1e-9) / row_size) * row_size
        price = round(low, 10)
        level = levels.setdefault(price, {
            "price": price, "buyVolume": 0.0, "sellVolume": 0.0,
            "unknownVolume": 0.0, "totalVolume": 0.0, "delta": 0.0,
        })
        volume = _ha_metric_volume(trade, metric)
        side = trade.get("aggressorSide")
        if side == "buy":
            level["buyVolume"] += volume
        elif side == "sell":
            level["sellVolume"] += volume
        else:
            level["unknownVolume"] += volume
        level["totalVolume"] += volume
    rows = sorted(levels.values(), key=lambda row: row["price"])
    for level in rows:
        level["delta"] = level["buyVolume"] - level["sellVolume"]
    return rows


def _ha_value_area(levels, va_percent):
    if not levels:
        return {"poc": None, "vah": None, "val": None, "valueAreaVolume": 0.0}
    max_volume = max(level["totalVolume"] for level in levels)
    poc_index = next(i for i, level in enumerate(levels) if level["totalVolume"] == max_volume)
    total = sum(level["totalVolume"] for level in levels)
    target = total * (va_percent / 100.0)
    lower = upper = poc_index
    included = levels[poc_index]["totalVolume"]
    while included < target and (lower > 0 or upper < len(levels) - 1):
        below = levels[lower - 1]["totalVolume"] if lower > 0 else -1
        above = levels[upper + 1]["totalVolume"] if upper < len(levels) - 1 else -1
        if below >= 0 and above >= 0 and abs(below - above) < 1e-12:
            lower -= 1
            upper += 1
            included += below + above
        elif below >= above and below >= 0:
            lower -= 1
            included += below
        elif above >= 0:
            upper += 1
            included += above
        else:
            break
    return {
        "poc": levels[poc_index]["price"],
        "vah": levels[upper]["price"],
        "val": levels[lower]["price"],
        "valueAreaVolume": included,
    }


def _ha_nodes(levels):
    if len(levels) < 3:
        return {"hvn": [row["price"] for row in levels], "lvn": []}
    ordered = sorted(row["totalVolume"] for row in levels)
    high = ordered[max(0, int(len(ordered) * 0.80) - 1)]
    low = ordered[min(len(ordered) - 1, int(len(ordered) * 0.20))]
    return {
        "hvn": [row["price"] for row in levels if row["totalVolume"] >= high],
        "lvn": [row["price"] for row in levels if row["totalVolume"] <= low],
    }


def _ha_profile_from_trades(trades, coin, metric="notional", row_size="auto", va_percent=70):
    metric = metric if metric in _HA_METRICS else "notional"
    step = _ha_row_size(row_size, coin, trades)
    levels = _ha_levels(trades, metric, step)
    value_area = _ha_value_area(levels, va_percent)
    unknown = sum(row["unknownVolume"] for row in levels)
    total = sum(row["totalVolume"] for row in levels)
    return {
        "metric": metric,
        "rowSize": step,
        "levels": levels,
        **value_area,
        **_ha_nodes(levels),
        "totalVolume": total,
        "unknownAggressorVolume": unknown,
        "deltaPartial": unknown > 0,
    }


def _ha_developing_levels(trades, coin, metric, row_size, va_percent):
    if not trades:
        return []
    increment = max(1, len(trades) // 48)
    output = []
    for end in range(increment, len(trades) + increment, increment):
        sample = trades[:min(end, len(trades))]
        profile = _ha_profile_from_trades(sample, coin, metric, row_size, va_percent)
        output.append({
            "timeMs": sample[-1]["timeMs"],
            "poc": profile["poc"],
            "vah": profile["vah"],
            "val": profile["val"],
        })
        if end >= len(trades):
            break
    return output


def _ha_candles_from_trades(trades, interval):
    interval_ms = _HA_INTERVAL_MS.get(interval, _HA_INTERVAL_MS["5m"])
    buckets = {}
    for trade in trades:
        candle_time = (trade["timeMs"] // interval_ms) * interval_ms
        candle = buckets.setdefault(candle_time, {
            "time": candle_time // 1000, "openTime": candle_time,
            "closeTime": candle_time + interval_ms - 1,
            "open": trade["price"], "high": trade["price"], "low": trade["price"],
            "close": trade["price"], "volume": 0.0, "notionalVolume": 0.0,
            "trades": 0,
        })
        candle["high"] = max(candle["high"], trade["price"])
        candle["low"] = min(candle["low"], trade["price"])
        candle["close"] = trade["price"]
        candle["volume"] += trade["sizeBase"]
        candle["notionalVolume"] += trade["notionalUsd"]
        candle["trades"] += 1
    return [buckets[key] for key in sorted(buckets)]


def _ha_footprint_from_trades(trades, coin, interval="5m", metric="notional", row_size="auto",
                              imbalance_ratio=3.0, stack=3):
    interval_ms = _HA_INTERVAL_MS.get(interval, _HA_INTERVAL_MS["5m"])
    step = _ha_row_size(row_size, coin, trades)
    by_candle = {}
    for trade in trades:
        candle_ms = (trade["timeMs"] // interval_ms) * interval_ms
        by_candle.setdefault(candle_ms, []).append(trade)
    output = []
    cumulative_delta = 0.0
    for candle_ms in sorted(by_candle):
        candle_trades = by_candle[candle_ms]
        levels = _ha_levels(candle_trades, metric, step)
        for index, level in enumerate(levels):
            sell_below = levels[index - 1]["sellVolume"] if index > 0 else 0.0
            buy_above = levels[index + 1]["buyVolume"] if index + 1 < len(levels) else 0.0
            level["buyImbalance"] = level["buyVolume"] > 0 and level["buyVolume"] >= imbalance_ratio * max(sell_below, 1e-12)
            level["sellImbalance"] = level["sellVolume"] > 0 and level["sellVolume"] >= imbalance_ratio * max(buy_above, 1e-12)
        buy_run = sell_run = 0
        for level in levels:
            buy_run = buy_run + 1 if level["buyImbalance"] else 0
            sell_run = sell_run + 1 if level["sellImbalance"] else 0
            level["stackedBuy"] = buy_run >= stack
            level["stackedSell"] = sell_run >= stack
        candle_delta = sum(level["delta"] for level in levels)
        cumulative_delta += candle_delta
        candle = _ha_candles_from_trades(candle_trades, interval)[0]
        candle.update({
            "levels": levels,
            "buyVolume": sum(row["buyVolume"] for row in levels),
            "sellVolume": sum(row["sellVolume"] for row in levels),
            "delta": candle_delta,
            "cvd": cumulative_delta,
        })
        output.append(candle)
    return {"rowSize": step, "candles": output, "cvd": cumulative_delta}


def _ha_parquet_rows(dataset, coin, start_ms, end_ms):
    root = _HaPath(MARKET_DATA_DIR) / dataset / f"coin={_ha_partition_coin(coin)}"
    files = list(root.glob("date=*/*.parquet")) if root.exists() else []
    if not files:
        return []
    try:
        import duckdb as _ha_duckdb
    except ImportError:
        return []
    con = _ha_duckdb.connect(database=":memory:")
    try:
        paths = [str(path) for path in files]
        if dataset == "trades":
            result = con.execute("""
                SELECT tradeKey, coin, timeMs, price, sizeBase, notionalUsd, aggressorSide, source
                FROM read_parquet(?) WHERE timeMs >= ? AND timeMs <= ? ORDER BY timeMs
            """, [paths, start_ms, end_ms]).fetchall()
            return [{
                "tradeKey": row[0], "coin": row[1], "timeMs": int(row[2]),
                "price": float(row[3]), "sizeBase": float(row[4]),
                "notionalUsd": float(row[5]), "aggressorSide": row[6], "source": row[7],
            } for row in result]
        result = con.execute("""
            SELECT timeMs, price, bidSize, askSize, source
            FROM read_parquet(?) WHERE timeMs >= ? AND timeMs <= ? ORDER BY timeMs, price
        """, [paths, start_ms, end_ms]).fetchall()
        return [{
            "timeMs": int(row[0]), "price": float(row[1]), "bidSize": float(row[2]),
            "askSize": float(row[3]), "source": row[4],
        } for row in result]
    finally:
        con.close()


def _ha_coverage(coin, dataset, start_ms, end_ms, source, rows):
    con = _ha_control_db()
    try:
        records = con.execute(
            "SELECT * FROM ha_coverage WHERE coin=? AND dataset=? ORDER BY updated_ms DESC",
            (coin, dataset),
        ).fetchall()
    finally:
        con.close()
    gaps = []
    complete = False
    covered_start = min((row.get("timeMs", end_ms) for row in rows), default=None)
    covered_end = max((row.get("timeMs", start_ms) for row in rows), default=None)
    if records:
        covered_start = min((r["start_ms"] for r in records if r["start_ms"] is not None), default=covered_start)
        covered_end = max((r["end_ms"] for r in records if r["end_ms"] is not None), default=covered_end)
        for record in records:
            gaps.extend(_ha_json.loads(record["gaps_json"] or "[]"))
        complete = any(
            bool(r["complete"]) and r["start_ms"] is not None and r["end_ms"] is not None
            and r["start_ms"] <= start_ms and r["end_ms"] >= end_ms for r in records
        ) and not gaps
    if not complete:
        gaps.append({"startTime": start_ms, "endTime": end_ms, "dataset": dataset, "reason": "coverage-not-confirmed"})
    return {
        "dataset": dataset,
        "coin": coin,
        "requested": {"startTime": start_ms, "endTime": end_ms},
        "covered": {"startTime": covered_start, "endTime": covered_end},
        "tradeBacked": dataset == "trades" and bool(rows),
        "complete": complete,
        "source": source,
    }, gaps, not complete


def _ha_recent_trades(coin, start_ms, end_ms):
    raw, err = _hl_info_cached({"type": "recentTrades", "coin": coin}, f"hl:recentTrades:{coin}", _HL_TTLS["trades"])
    if err:
        return [], err
    trades = []
    for row in raw or []:
        normalized = _ha_normalize_trade(row, coin, "hyperliquid-recentTrades", archive_fill=False)
        if normalized and start_ms <= normalized["timeMs"] <= end_ms:
            trades.append(normalized)
    return sorted(trades, key=lambda item: item["timeMs"]), None


def _ha_load_trades(coin, start_ms, end_ms):
    rows = _ha_parquet_rows("trades", coin, start_ms, end_ms)
    source = "parquet:trades"
    if not rows:
        rows, _ = _ha_recent_trades(coin, start_ms, end_ms)
        source = "hyperliquid:recentTrades"
    coverage, gaps, partial = _ha_coverage(coin, "trades", start_ms, end_ms, source, rows)
    return rows, source, coverage, gaps, partial


def _ha_query_range():
    now = _ha_now_ms()
    try:
        start_ms = int(request.args.get("startTime") or (now - 86_400_000))
        end_ms = int(request.args.get("endTime") or now)
    except ValueError:
        raise ValueError("startTime/endTime invalides")
    if start_ms >= end_ms:
        raise ValueError("startTime doit etre inferieur a endTime")
    return start_ms, end_ms


def _ha_register_market(coin, market):
    now = _ha_now_ms()
    con = _ha_control_db()
    try:
        con.execute(
            """INSERT INTO ha_markets(coin, market, followed, created_ms, updated_ms)
               VALUES(?, ?, 1, ?, ?)
               ON CONFLICT(coin) DO UPDATE SET market=excluded.market, followed=1, updated_ms=excluded.updated_ms""",
            (coin, market, now, now),
        )
        con.commit()
    finally:
        con.close()


@app.get("/api/hyperliquid/analytics/markets")
def hyperliquid_analytics_markets():
    _ha_register_market("BTC", "BTC")
    con = _ha_control_db()
    try:
        markets = [dict(row) for row in con.execute("SELECT * FROM ha_markets WHERE followed=1 ORDER BY market").fetchall()]
        coverage_rows = [dict(row) for row in con.execute("SELECT * FROM ha_coverage ORDER BY coin, dataset").fetchall()]
        collector_row = con.execute("SELECT * FROM ha_collector_state WHERE singleton=1").fetchone()
        jobs = [dict(row) for row in con.execute(
            "SELECT * FROM ha_import_jobs WHERE status IN ('queued','running') ORDER BY created_ms"
        ).fetchall()]
    finally:
        con.close()
    for row in coverage_rows:
        row["gaps"] = _ha_json.loads(row.pop("gaps_json") or "[]")
    collector = dict(collector_row) if collector_row else {"status": "offline", "heartbeat_ms": None, "details_json": "{}"}
    heartbeat = collector.get("heartbeat_ms")
    if not heartbeat or _ha_now_ms() - heartbeat > 30_000:
        collector["status"] = "offline"
    collector["details"] = _ha_json.loads(collector.pop("details_json") or "{}")
    return jsonify({
        "source": "hyperliquid:control",
        "coverage": coverage_rows,
        "gaps": [gap for row in coverage_rows for gap in row.get("gaps", [])],
        "partial": any(not bool(row.get("complete")) for row in coverage_rows) or not coverage_rows,
        "markets": markets,
        "collector": collector,
        "imports": jobs,
    })


@app.post("/api/hyperliquid/analytics/import/preview")
def hyperliquid_analytics_import_preview():
    payload = request.get_json(silent=True) or {}
    coin = _ha_coin(payload.get("coin") or payload.get("market") or "BTC")
    datasets = payload.get("datasets") or ["trades", "l2"]
    if not isinstance(datasets, list) or not datasets or any(item not in _HA_DATASETS for item in datasets):
        return jsonify({"error": "datasets doit contenir trades et/ou l2"}), 400
    from_value = str(payload.get("from") or "earliest")
    to_value = str(payload.get("to") or "latest")
    now = _ha_now_ms()
    token = _ha_secrets.token_urlsafe(24)
    warning = (
        "Les archives officielles S3 Hyperliquid sont requester-pays. "
        "Le worker doit enumerer les objets et confirmer les octets avant telechargement."
    )
    con = _ha_control_db()
    try:
        con.execute(
            """INSERT INTO ha_import_previews
               (token, coin, datasets_json, from_value, to_value, object_count, bytes_estimated,
                status, warning, created_ms, expires_ms)
               VALUES (?, ?, ?, ?, ?, NULL, NULL, 'pending-worker-scan', ?, ?, ?)""",
            (token, coin, _ha_json.dumps(datasets), from_value, to_value, warning, now, now + 15 * 60_000),
        )
        con.commit()
    finally:
        con.close()
    _ha_register_market(coin, payload.get("market") or coin)
    return jsonify({
        "source": "hyperliquid:official-archives",
        "coverage": {"coin": coin, "datasets": datasets, "from": from_value, "to": to_value},
        "gaps": [],
        "partial": True,
        "token": token,
        "status": "pending-worker-scan",
        "files": None,
        "bytesEstimated": None,
        "requesterPays": True,
        "warning": warning,
        "expiresAt": now + 15 * 60_000,
    }), 202


@app.post("/api/hyperliquid/analytics/import/jobs")
def hyperliquid_analytics_import_jobs_create():
    payload = request.get_json(silent=True) or {}
    token = str(payload.get("token") or "")
    if not token or payload.get("confirmed") is not True:
        return jsonify({"error": "Confirmation explicite et token de preflight requis"}), 400
    now = _ha_now_ms()
    con = _ha_control_db()
    try:
        preview = con.execute("SELECT * FROM ha_import_previews WHERE token=?", (token,)).fetchone()
        if not preview or preview["expires_ms"] < now:
            return jsonify({"error": "Token de preflight introuvable ou expire"}), 400
        cur = con.execute(
            """INSERT INTO ha_import_jobs
               (token, coin, datasets_json, status, bytes_total, created_ms, updated_ms)
               VALUES (?, ?, ?, 'queued', ?, ?, ?)""",
            (token, preview["coin"], preview["datasets_json"], preview["bytes_estimated"], now, now),
        )
        job_id = cur.lastrowid
        con.commit()
    finally:
        con.close()
    return jsonify({
        "source": "hyperliquid:control", "coverage": {}, "gaps": [], "partial": True,
        "id": job_id, "status": "queued",
    }), 202


@app.get("/api/hyperliquid/analytics/import/jobs/<int:job_id>")
def hyperliquid_analytics_import_job(job_id):
    con = _ha_control_db()
    try:
        row = con.execute("SELECT * FROM ha_import_jobs WHERE id=?", (job_id,)).fetchone()
    finally:
        con.close()
    if not row:
        return jsonify({"error": "Import introuvable"}), 404
    job = dict(row)
    job["datasets"] = _ha_json.loads(job.pop("datasets_json"))
    job["errors"] = _ha_json.loads(job.pop("errors_json"))
    gaps = _ha_json.loads(job.pop("gaps_json"))
    return jsonify({
        "source": "hyperliquid:control", "coverage": {}, "gaps": gaps,
        "partial": job["status"] != "complete" or bool(gaps), "job": job,
    })


@app.get("/api/hyperliquid/analytics/candles")
def hyperliquid_analytics_candles():
    coin = _ha_coin(request.args.get("coin") or request.args.get("market") or "BTC")
    interval = request.args.get("interval", "5m")
    if interval not in _HA_INTERVAL_MS:
        return jsonify({"error": "Intervalle analytique non supporte"}), 400
    try:
        start_ms, end_ms = _ha_query_range()
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    trades, source, coverage, gaps, partial = _ha_load_trades(coin, start_ms, end_ms)
    candles = _ha_candles_from_trades(trades, interval)
    return jsonify({
        "source": source, "coverage": coverage, "gaps": gaps, "partial": partial,
        "coin": coin, "interval": interval, "candles": candles, "count": len(candles),
    })


@app.get("/api/hyperliquid/analytics/volume-profile")
def hyperliquid_analytics_volume_profile():
    coin = _ha_coin(request.args.get("coin") or request.args.get("market") or "BTC")
    metric = request.args.get("metric", "notional")
    profile_type = request.args.get("profileType", "session")
    if metric not in _HA_METRICS or profile_type not in _HA_PROFILE_TYPES:
        return jsonify({"error": "metric ou profileType invalide"}), 400
    try:
        start_ms, end_ms = _ha_query_range()
        va_percent = max(50, min(99, int(request.args.get("vaPercent", 70))))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    row_size = request.args.get("rowSize", "auto")
    trades, source, coverage, gaps, partial = _ha_load_trades(coin, start_ms, end_ms)
    con = _ha_control_db()
    try:
        market_row = con.execute("SELECT dataset_version FROM ha_markets WHERE coin=?", (coin,)).fetchone()
        dataset_version = market_row["dataset_version"] if market_row else 0
    finally:
        con.close()
    cache_key = (coin, start_ms, end_ms, metric, row_size, va_percent, dataset_version)
    profile = _ha_profile_cache.get(cache_key)
    if profile is None:
        profile = _ha_profile_from_trades(trades, coin, metric, row_size, va_percent)
        if len(_ha_profile_cache) > 100:
            _ha_profile_cache.clear()
        _ha_profile_cache[cache_key] = profile
    previous_levels = None
    if profile_type == "session":
        prior_start = start_ms - 86_400_000
        prior_end = start_ms - 1
        previous_trades, _, _, _, _ = _ha_load_trades(coin, prior_start, prior_end)
        if previous_trades:
            previous = _ha_profile_from_trades(previous_trades, coin, metric, profile["rowSize"], va_percent)
            previous_levels = {"poc": previous["poc"], "vah": previous["vah"], "val": previous["val"]}
    return jsonify({
        "source": source, "coverage": coverage, "gaps": gaps,
        "partial": partial or profile["deltaPartial"], "coin": coin,
        "profileType": profile_type, "vaPercent": va_percent, **profile,
        "developing": _ha_developing_levels(trades, coin, metric, profile["rowSize"], va_percent),
        "previousLevels": previous_levels, "nakedPoc": [],
        "datasetVersion": dataset_version,
    })


@app.get("/api/hyperliquid/analytics/footprint")
def hyperliquid_analytics_footprint():
    coin = _ha_coin(request.args.get("coin") or request.args.get("market") or "BTC")
    metric = request.args.get("metric", "notional")
    interval = request.args.get("interval", "5m")
    if metric not in _HA_METRICS or interval not in _HA_INTERVAL_MS:
        return jsonify({"error": "metric ou interval invalide"}), 400
    try:
        start_ms, end_ms = _ha_query_range()
        imbalance = max(1.0, float(request.args.get("imbalanceRatio", 3)))
        stack = max(2, int(request.args.get("stack", 3)))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    trades, source, coverage, gaps, partial = _ha_load_trades(coin, start_ms, end_ms)
    footprint = _ha_footprint_from_trades(
        trades, coin, interval, metric, request.args.get("rowSize", "auto"), imbalance, stack
    )
    unknown = any(row["unknownVolume"] > 0 for candle in footprint["candles"] for row in candle["levels"])
    return jsonify({
        "source": source, "coverage": coverage, "gaps": gaps,
        "partial": partial or unknown, "coin": coin, "metric": metric,
        "interval": interval, "imbalanceRatio": imbalance, "stack": stack,
        "signalsEnabled": not partial and not unknown, **footprint,
    })


@app.get("/api/hyperliquid/analytics/heatmap")
def hyperliquid_analytics_heatmap():
    coin = _ha_coin(request.args.get("coin") or request.args.get("market") or "BTC")
    resolution = request.args.get("resolution", "5s")
    if resolution not in {"500ms", "5s", "1m", "15m"}:
        return jsonify({"error": "Resolution heatmap invalide"}), 400
    try:
        start_ms, end_ms = _ha_query_range()
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    tiles = _ha_parquet_rows(f"tiles/resolution={resolution}", coin, start_ms, end_ms)
    coverage, gaps, partial = _ha_coverage(coin, "l2", start_ms, end_ms, "parquet:l2-tiles", tiles)
    return jsonify({
        "source": "parquet:l2-tiles", "coverage": coverage, "gaps": gaps,
        "partial": partial, "coin": coin, "resolution": resolution,
        "rowSize": request.args.get("rowSize", "auto"), "tiles": tiles,
        "signalsEnabled": not partial,
    })
