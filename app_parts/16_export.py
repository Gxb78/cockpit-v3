# ---------- Export ----------

import csv as _csv
import io as _io

SHORT_MONTHS_FR = {
    1: "Jan", 2: "Fev", 3: "Mar", 4: "Avr",
    5: "Mai", 6: "Jui", 7: "Jul", 8: "Aou",
    9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec",
}


@app.get("/api/export")
@ratelimit(max_per_minute=20)
def export_data():
    db = get_db()

    # --- Filtres ---
    instrument = _canonical_instrument(request.args.get("instrument"))
    raw_from = request.args.get("from")
    raw_to = request.args.get("to")
    fmt = (request.args.get("format") or "json").strip().lower()

    q = "SELECT * FROM days WHERE 1=1"
    p = []
    if instrument and instrument != "ALL":
        q += " AND instrument=?"
        p.append(instrument)
    if raw_from:
        try:
            f = _validate_date_key(raw_from, "from")
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        q += " AND date>=?"
        p.append(f)
    if raw_to:
        try:
            t = _validate_date_key(raw_to, "to")
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        q += " AND date<=?"
        p.append(t)

    q += " ORDER BY date, instrument"
    days = [row_to_dict(r) for r in db.execute(q, p)]

    for d in days:
        d["tags"] = _decode_json(d.get("tags"), [])
        d["trades"] = _fetch_trades_for_day(d["id"])
        for t in d["trades"]:
            t["tags"] = _decode_json(t.get("tags"), [])
            t["custom_blocks"] = _decode_json(t.get("custom_blocks"), [])
            t["screenshots"] = _fetch_screenshots(t["id"])

    if fmt == "csv":
        return _render_csv(days)

    # Format JSON (default)
    return jsonify({
        "version": 3,
        "schema_version": SCHEMA_VERSION,
        "exported_at": now_iso(),
        "instruments": INSTRUMENTS,
        "strategies": STRATEGIES,
        "count": len(days),
        "days": days,
    })


def _render_csv(days):
    """Renderit les jours + trades en CSV, 1 ligne par trade."""
    buf = _io.StringIO()
    writer = _csv.writer(buf)
    writer.writerow([
        "date",
        "instrument",
        "session",
        "htf_bias",
        "htf_context",
        "daily_notes",
        "day_tags",
        "trade_id",
        "strategy",
        "direction",
        "entry_price",
        "stop_loss",
        "take_profit",
        "exit_price",
        "position_size",
        "pnl",
        "rr",
        "is_win",
        "execution_quality",
        "stdv_level",
        "scenario",
        "why_trade",
        "why_entry",
        "why_stop",
        "why_tp",
        "thesis_validated",
        "lessons_learned",
        "trade_tags",
    ])

    wrote = 0
    for d in days:
        day_tags = "; ".join(d.get("tags") or [])
        if not d["trades"]:
            # Jour sans trade — quand meme une ligne
            writer.writerow([
                d.get("date"),
                d.get("instrument"),
                d.get("session", ""),
                d.get("htf_bias", ""),
                d.get("htf_context", ""),
                d.get("daily_notes", ""),
                day_tags,
                "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
            ])
            wrote += 1
            continue
        for t in d["trades"]:
            trade_tags = "; ".join(t.get("tags") or [])
            writer.writerow([
                d.get("date"),
                d.get("instrument"),
                d.get("session", ""),
                d.get("htf_bias", ""),
                d.get("htf_context", ""),
                d.get("daily_notes", ""),
                day_tags,
                t.get("id", ""),
                t.get("strategy", ""),
                t.get("direction", ""),
                t.get("entry_price", ""),
                t.get("stop_loss", ""),
                t.get("take_profit", ""),
                t.get("exit_price", ""),
                t.get("position_size", ""),
                t.get("pnl", ""),
                t.get("rr", ""),
                t.get("is_win", ""),
                t.get("execution_quality", ""),
                t.get("stdv_level", ""),
                t.get("scenario", ""),
                t.get("why_trade", ""),
                t.get("why_entry", ""),
                t.get("why_stop", ""),
                t.get("why_tp", ""),
                t.get("thesis_validated", ""),
                t.get("lessons_learned", ""),
                trade_tags,
            ])
            wrote += 1

    output = buf.getvalue()
    resp = app.response_class(
        response=output,
        mimetype="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=journal-export-{now_iso()[:10]}.csv",
        },
    )
    resp.headers["Content-Type"] = "text/csv; charset=utf-8"
    return resp


@app.get("/api/db/info")
@ratelimit(max_per_minute=10)
def db_info():
    import os as _os
    db_path = str(DB_PATH)
    size_bytes = DB_PATH.stat().st_size if DB_PATH.exists() else 0
    if size_bytes < 1024:
        size_str = f"{size_bytes} o"
    elif size_bytes < 1024 * 1024:
        size_str = f"{size_bytes / 1024:.1f} Ko"
    else:
        size_str = f"{size_bytes / 1024 / 1024:.1f} Mo"
    return jsonify({
        "db_path": db_path,
        "size_bytes": size_bytes,
        "size_str": size_str,
        "num_days": db.execute("SELECT COUNT(*) AS c FROM days").fetchone()["c"],
        "num_trades": db.execute("SELECT COUNT(*) AS c FROM trades").fetchone()["c"],
    })
