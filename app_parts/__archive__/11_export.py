# ---------- Export ----------

@app.get("/api/export")
def export_data():
    db   = get_db()
    days = [row_to_dict(r) for r in db.execute("SELECT * FROM days ORDER BY date, instrument")]
    for d in days:
        d["tags"]   = _decode_json(d.get("tags"), [])
        d["trades"] = _fetch_trades_for_day(d["id"])
    return jsonify({
        "version": 3, "schema_version": SCHEMA_VERSION,
        "exported_at": now_iso(),
        "instruments": INSTRUMENTS, "strategies": STRATEGIES,
        "count": len(days), "days": days,
    })


