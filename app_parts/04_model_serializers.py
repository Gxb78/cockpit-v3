def _decode_json(val, default):
    if val and isinstance(val, str):
        try:
            return json.loads(val)
        except Exception:
            return default
    return default if val is None else val


def row_to_dict(row):
    return {k: row[k] for k in row.keys()} if row else None


def normalize_trade_response(t):
    if not t:
        return t
    t["tags"]          = _decode_json(t.get("tags"), [])
    t["custom_blocks"] = _decode_json(t.get("custom_blocks"), [])
    t["plan_errors"]   = _decode_json(t.get("plan_errors"), [])
    t["plan_warnings"] = _decode_json(t.get("plan_warnings"), [])
    t["plan_snapshot"] = _decode_json(t.get("plan_snapshot"), None)
    if not t.get("plan_alignment"):
        t["plan_alignment"] = "unknown"
    return t


def fetch_day(day_id):
    db  = get_db()
    row = db.execute("SELECT * FROM days WHERE id=?", (day_id,)).fetchone()
    if not row:
        return None
    d = row_to_dict(row)
    d["tags"]   = _decode_json(d.get("tags"), [])
    d["trades"] = _fetch_trades_for_day(day_id)
    return d


def _fetch_trades_for_day(day_id):
    db   = get_db()
    rows = db.execute("SELECT * FROM trades WHERE day_id=? ORDER BY id", (day_id,)).fetchall()
    trades = []
    for row in rows:
        t = row_to_dict(row)
        normalize_trade_response(t)
        t["screenshots"]   = _fetch_screenshots(t["id"])
        trades.append(t)
    return trades


def _fetch_screenshots(trade_id):
    db = get_db()
    rows = db.execute(
        "SELECT id, filename, caption, created_at FROM trade_screenshots WHERE trade_id=? ORDER BY id",
        (trade_id,)
    ).fetchall()
    return [row_to_dict(r) for r in rows]


def _parse_bool_to_is_win(value):
    if value is None or value == "":
        return None, None
    if isinstance(value, bool):
        return (1 if value else 0), None
    if isinstance(value, (int, float)) and value in (0, 1):
        return int(value), None
    if isinstance(value, str):
        v = value.strip().lower()
        if v in {"1", "true", "yes", "win", "w"}:
            return 1, None
        if v in {"0", "false", "no", "loss", "l"}:
            return 0, None
    return None, "is_win doit etre 0 ou 1"


