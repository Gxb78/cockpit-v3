"""Dedicated Hyperliquid market collector.

Run independently from Flask:
    python workers/hyperliquid_market_worker.py --coin BTC --collect

The worker writes append-only Parquet partitions in data/market and updates
control.sqlite. It never trades and only uses public market subscriptions.
"""

import argparse
import json
import sqlite3
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MARKET_ROOT = ROOT / "data" / "market"
CONTROL_DB = MARKET_ROOT / "control.sqlite"
WS_URL = "wss://api.hyperliquid.xyz/ws"
RESOLUTION_MS = {"500ms": 500, "5s": 5_000, "1m": 60_000, "15m": 900_000}


def now_ms():
    return int(time.time() * 1000)


def control_db():
    MARKET_ROOT.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(CONTROL_DB)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA busy_timeout=3000")
    con.executescript("""
        CREATE TABLE IF NOT EXISTS ha_markets (
            coin TEXT PRIMARY KEY, market TEXT NOT NULL, followed INTEGER NOT NULL DEFAULT 1,
            dataset_version INTEGER NOT NULL DEFAULT 0, created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ha_coverage (
            coin TEXT NOT NULL, dataset TEXT NOT NULL, source TEXT NOT NULL,
            start_ms INTEGER, end_ms INTEGER, complete INTEGER NOT NULL DEFAULT 0,
            gaps_json TEXT NOT NULL DEFAULT '[]', updated_ms INTEGER NOT NULL,
            PRIMARY KEY (coin, dataset, source)
        );
        CREATE TABLE IF NOT EXISTS ha_collector_state (
            singleton INTEGER PRIMARY KEY CHECK(singleton = 1), heartbeat_ms INTEGER,
            status TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS ha_import_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL, coin TEXT NOT NULL,
            datasets_json TEXT NOT NULL, status TEXT NOT NULL, bytes_total INTEGER,
            bytes_done INTEGER NOT NULL DEFAULT 0, partitions_validated INTEGER NOT NULL DEFAULT 0,
            errors_json TEXT NOT NULL DEFAULT '[]', gaps_json TEXT NOT NULL DEFAULT '[]',
            created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL
        );
    """)
    return con


def heartbeat(status, details=None):
    con = control_db()
    try:
        con.execute(
            """INSERT INTO ha_collector_state(singleton, heartbeat_ms, status, details_json)
               VALUES(1, ?, ?, ?)
               ON CONFLICT(singleton) DO UPDATE SET heartbeat_ms=excluded.heartbeat_ms,
               status=excluded.status, details_json=excluded.details_json""",
            (now_ms(), status, json.dumps(details or {})),
        )
        con.commit()
    finally:
        con.close()


def record_market(coin):
    current = now_ms()
    con = control_db()
    try:
        con.execute(
            """INSERT INTO ha_markets(coin, market, followed, created_ms, updated_ms)
               VALUES(?, ?, 1, ?, ?)
               ON CONFLICT(coin) DO UPDATE SET followed=1, updated_ms=excluded.updated_ms""",
            (coin, coin, current, current),
        )
        con.commit()
    finally:
        con.close()


def record_gap(coin, dataset, started_ms, ended_ms, reason):
    con = control_db()
    try:
        row = con.execute(
            "SELECT gaps_json FROM ha_coverage WHERE coin=? AND dataset=? AND source='live'",
            (coin, dataset),
        ).fetchone()
        gaps = json.loads(row["gaps_json"]) if row else []
        gaps.append({"startTime": started_ms, "endTime": ended_ms, "reason": reason})
        con.execute(
            """INSERT INTO ha_coverage(coin, dataset, source, start_ms, end_ms, complete, gaps_json, updated_ms)
               VALUES(?, ?, 'live', NULL, NULL, 0, ?, ?)
               ON CONFLICT(coin, dataset, source) DO UPDATE SET
               gaps_json=excluded.gaps_json, complete=0, updated_ms=excluded.updated_ms""",
            (coin, dataset, json.dumps(gaps[-100:]), now_ms()),
        )
        con.commit()
    finally:
        con.close()


def update_live_coverage(coin, dataset, rows):
    if not rows:
        return
    start_ms = min(row["timeMs"] for row in rows)
    end_ms = max(row["timeMs"] for row in rows)
    con = control_db()
    try:
        existing = con.execute(
            "SELECT start_ms, end_ms, gaps_json FROM ha_coverage WHERE coin=? AND dataset=? AND source='live'",
            (coin, dataset),
        ).fetchone()
        lower = min(start_ms, existing["start_ms"]) if existing and existing["start_ms"] else start_ms
        upper = max(end_ms, existing["end_ms"]) if existing and existing["end_ms"] else end_ms
        gaps_json = existing["gaps_json"] if existing else "[]"
        con.execute(
            """INSERT INTO ha_coverage(coin, dataset, source, start_ms, end_ms, complete, gaps_json, updated_ms)
               VALUES(?, ?, 'live', ?, ?, 0, ?, ?)
               ON CONFLICT(coin, dataset, source) DO UPDATE SET start_ms=excluded.start_ms,
               end_ms=excluded.end_ms, gaps_json=excluded.gaps_json, updated_ms=excluded.updated_ms""",
            (coin, dataset, lower, upper, gaps_json, now_ms()),
        )
        con.execute("UPDATE ha_markets SET dataset_version=dataset_version+1, updated_ms=? WHERE coin=?", (now_ms(), coin))
        con.commit()
    finally:
        con.close()


def partition_path(dataset, coin, event_ms):
    day = datetime.fromtimestamp(event_ms / 1000, timezone.utc).strftime("%Y-%m-%d")
    target = MARKET_ROOT / dataset / f"coin={coin}" / f"date={day}"
    target.mkdir(parents=True, exist_ok=True)
    return target / f"part-{event_ms}-{uuid.uuid4().hex}.parquet"


def write_parquet(dataset, coin, rows):
    if not rows:
        return 0
    try:
        import duckdb
    except ImportError as exc:
        raise RuntimeError("duckdb is required by the market worker") from exc
    grouped = {}
    for row in rows:
        day = datetime.fromtimestamp(row["timeMs"] / 1000, timezone.utc).strftime("%Y-%m-%d")
        grouped.setdefault(day, []).append(row)
    written = 0
    for items in grouped.values():
        final = partition_path(dataset, coin, items[0]["timeMs"])
        temp = final.with_suffix(".tmp.parquet")
        con = duckdb.connect(database=":memory:")
        try:
            if dataset == "trades":
                con.execute(
                    """CREATE TABLE output (
                       tradeKey VARCHAR, coin VARCHAR, timeMs BIGINT, price DOUBLE,
                       sizeBase DOUBLE, notionalUsd DOUBLE, aggressorSide VARCHAR, source VARCHAR
                    )"""
                )
                values = [
                    (r["tradeKey"], r["coin"], r["timeMs"], r["price"], r["sizeBase"],
                     r["notionalUsd"], r.get("aggressorSide"), r["source"]) for r in items
                ]
            else:
                con.execute(
                    """CREATE TABLE output (
                       timeMs BIGINT, price DOUBLE, bidSize DOUBLE, askSize DOUBLE, source VARCHAR
                    )"""
                )
                values = [(r["timeMs"], r["price"], r["bidSize"], r["askSize"], r["source"]) for r in items]
            placeholders = ",".join(["?"] * len(values[0]))
            con.executemany(f"INSERT INTO output VALUES ({placeholders})", values)
            output_path = str(temp).replace("'", "''")
            con.execute(f"COPY output TO '{output_path}' (FORMAT PARQUET, COMPRESSION ZSTD)")
        finally:
            con.close()
        temp.replace(final)
        written += 1
    update_live_coverage(coin, "trades" if dataset == "trades" else "l2", rows)
    return written


def trade_row(raw, coin):
    try:
        event_ms = int(raw.get("time") or 0)
        price = float(raw.get("px"))
        size = float(raw.get("sz"))
    except (TypeError, ValueError):
        return None
    side = str(raw.get("side") or "").upper()
    aggressive = "buy" if side == "B" else "sell" if side == "A" else None
    tid = raw.get("tid", raw.get("hash", ""))
    return {
        "tradeKey": f"{event_ms}:{coin}:{tid}",
        "coin": coin,
        "timeMs": event_ms,
        "price": price,
        "sizeBase": size,
        "notionalUsd": price * size,
        "aggressorSide": aggressive,
        "source": "ws-trades",
    }


def book_rows(raw, coin):
    event_ms = int(raw.get("time") or 0)
    levels = raw.get("levels") or [[], []]
    rows = {}
    for side_index, name in ((0, "bidSize"), (1, "askSize")):
        for level in levels[side_index] if len(levels) > side_index else []:
            try:
                price = float(level.get("px"))
                size = float(level.get("sz"))
            except (AttributeError, TypeError, ValueError):
                continue
            row = rows.setdefault(price, {
                "timeMs": event_ms, "price": price, "bidSize": 0.0, "askSize": 0.0, "source": "ws-l2Book"
            })
            row[name] = size
    return list(rows.values())


def tile_rows(rows, resolution):
    bucket_ms = RESOLUTION_MS[resolution]
    selected = {}
    for row in rows:
        bucket = (row["timeMs"] // bucket_ms) * bucket_ms
        key = (bucket, row["price"])
        updated = dict(row)
        updated["timeMs"] = bucket
        selected[key] = updated
    return list(selected.values())


class Collector:
    def __init__(self, coin, interval="5m"):
        self.coin = coin
        self.interval = interval
        self.trade_buffer = []
        self.l2_buffer = []
        self.last_flush = time.monotonic()
        self.connected_at = None

    def flush(self):
        if self.trade_buffer:
            write_parquet("trades", self.coin, self.trade_buffer)
            self.trade_buffer = []
        if self.l2_buffer:
            rows = self.l2_buffer
            write_parquet("l2", self.coin, rows)
            for resolution in RESOLUTION_MS:
                write_parquet(f"tiles/resolution={resolution}", self.coin, tile_rows(rows, resolution))
            self.l2_buffer = []
        self.last_flush = time.monotonic()
        heartbeat("collecting", {"coin": self.coin, "lastFlushMs": now_ms()})

    def on_open(self, ws):
        self.connected_at = now_ms()
        heartbeat("connected", {"coin": self.coin})
        for subscription in (
            {"type": "trades", "coin": self.coin},
            {"type": "l2Book", "coin": self.coin},
            {"type": "candle", "coin": self.coin, "interval": self.interval},
        ):
            ws.send(json.dumps({"method": "subscribe", "subscription": subscription}))

    def on_message(self, _ws, message):
        payload = json.loads(message)
        channel = payload.get("channel")
        data = payload.get("data")
        if channel == "trades":
            for raw in data or []:
                row = trade_row(raw, self.coin)
                if row:
                    self.trade_buffer.append(row)
        elif channel == "l2Book" and isinstance(data, dict):
            self.l2_buffer.extend(book_rows(data, self.coin))
        if len(self.trade_buffer) >= 1000 or len(self.l2_buffer) >= 5000 or time.monotonic() - self.last_flush >= 5:
            self.flush()

    def on_close(self, _ws, _code, message):
        disconnected_at = now_ms()
        self.flush()
        start = self.connected_at or disconnected_at
        for dataset in ("trades", "l2"):
            record_gap(self.coin, dataset, start, disconnected_at, "websocket-disconnected")
        heartbeat("disconnected", {"coin": self.coin, "detail": message or ""})

    def on_error(self, _ws, error):
        heartbeat("error", {"coin": self.coin, "error": str(error)})

    def run(self):
        try:
            import websocket
        except ImportError as exc:
            raise RuntimeError("websocket-client is required by the market worker") from exc
        record_market(self.coin)
        while True:
            app = websocket.WebSocketApp(
                WS_URL, on_open=self.on_open, on_message=self.on_message,
                on_close=self.on_close, on_error=self.on_error,
            )
            app.run_forever(ping_interval=20, ping_timeout=10)
            time.sleep(2)


def process_pending_jobs():
    """Surface queued imports until the S3 importer is deliberately enabled.

    Historical buckets are requester-pays and may be missing or delayed. The
    job is never silently reported as complete without validated partitions.
    """
    con = control_db()
    try:
        rows = con.execute("SELECT id FROM ha_import_jobs WHERE status='queued'").fetchall()
        for row in rows:
            message = (
                "Archive job queued. Run an approved requester-pays importer "
                "to enumerate and download official Hyperliquid partitions."
            )
            con.execute(
                "UPDATE ha_import_jobs SET status='awaiting-requester-pays', errors_json=?, updated_ms=? WHERE id=?",
                (json.dumps([message]), now_ms(), row["id"]),
            )
        con.commit()
    finally:
        con.close()
    heartbeat("idle", {"queuedJobsProcessed": len(rows)})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--coin", default="BTC")
    parser.add_argument("--interval", default="5m")
    parser.add_argument("--collect", action="store_true")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    if args.once:
        process_pending_jobs()
        return 0
    if not args.collect:
        parser.error("choose --collect or --once")
    Collector(args.coin, args.interval).run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
