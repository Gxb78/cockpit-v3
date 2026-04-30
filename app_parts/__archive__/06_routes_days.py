# ---------- API : days ----------

@app.get("/api/days")
def list_days():
    days = _query_days(
        month=request.args.get("month"),
        instrument=request.args.get("instrument"),
        date_from=request.args.get("from"),
        date_to=request.args.get("to"),
        search=request.args.get("q"),
    )
    return jsonify(days)


@app.get("/api/days/lookup")
def lookup_day():
    date       = request.args.get("date")
    instrument = _canonical_instrument(request.args.get("instrument"))
    if not date or not instrument:
        return jsonify({"error": "date et instrument requis"}), 400
    db  = get_db()
    row = db.execute("SELECT * FROM days WHERE date=? AND instrument=?", (date, instrument)).fetchone()
    if not row:
        return jsonify(None), 404
    d = row_to_dict(row)
    d["tags"] = _decode_json(d.get("tags"), [])
    return jsonify(d)


@app.get("/api/days/<int:day_id>")
def get_day(day_id):
    d = fetch_day(day_id)
    return (jsonify(d) if d else (jsonify({"error": "not found"}), 404))


@app.post("/api/days")
def create_day():
    data = request.get_json(force=True)
    instrument = _canonical_instrument(data.get("instrument"))
    if not data.get("date") or not instrument:
        return jsonify({"error": "date et instrument requis"}), 400
    if instrument not in INSTRUMENTS:
        return jsonify({"error": f"instrument doit être parmi {INSTRUMENTS}"}), 400

    payload, errors = normalize_day_payload(data)
    if errors:
        return jsonify({"error": "; ".join(errors)}), 400

    payload.update({
        "date": data["date"], "instrument": instrument,
        "schema_version": SCHEMA_VERSION,
        "created_at": now_iso(), "updated_at": now_iso(),
    })
    db   = get_db()
    cols = list(payload.keys())
    sql  = f"INSERT INTO days ({','.join(cols)}) VALUES ({','.join(['?']*len(cols))})"
    try:
        cur = db.execute(sql, [payload[c] for c in cols])
        db.commit()
        return jsonify(fetch_day(cur.lastrowid)), 201
    except sqlite3.IntegrityError:
        existing = db.execute(
            "SELECT id FROM days WHERE date=? AND instrument=?",
            (date_val, instrument)
        ).fetchone()
        if existing:
            return jsonify(fetch_day(existing[0])), 200
        return jsonify({"error": "Entrée déjà existante pour cette date et cet instrument"}), 409


@app.put("/api/days/<int:day_id>")
def update_day(day_id):
    data = request.get_json(force=True) or {}
    db = get_db()
    if not db.execute("SELECT id FROM days WHERE id=?", (day_id,)).fetchone():
        return jsonify({"error": "not found"}), 404

    payload, errors = normalize_day_payload(data, for_update=True)
    if "date" in data:
        if not data.get("date"):
            errors.append("date requis")
        else:
            payload["date"] = data.get("date")
    if "instrument" in data:
        instrument = _canonical_instrument(data.get("instrument"))
        if not instrument:
            errors.append("instrument requis")
        elif instrument not in INSTRUMENTS:
            errors.append(f"instrument doit être parmi {INSTRUMENTS}")
        else:
            payload["instrument"] = instrument
    if errors:
        return jsonify({"error": "; ".join(errors)}), 400
    if not payload:
        return jsonify(fetch_day(day_id))

    payload["updated_at"] = now_iso()
    sets = ", ".join(f"{c}=?" for c in payload)
    try:
        db.execute(f"UPDATE days SET {sets} WHERE id=?", list(payload.values()) + [day_id])
    except sqlite3.IntegrityError:
        return jsonify({"error": "Cette entrée existe déjà pour cette date et cet instrument"}), 409
    db.commit()
    return jsonify(fetch_day(day_id))


@app.delete("/api/days/<int:day_id>")
def delete_day(day_id):
    db = get_db()
    # Supprimer les fichiers de screenshots en cascade
    shots = db.execute("""
        SELECT ts.filename FROM trade_screenshots ts
        JOIN trades t ON t.id = ts.trade_id
        WHERE t.day_id=?
    """, (day_id,)).fetchall()
    for s in shots:
        try:
            (SCREENSHOTS_DIR / s["filename"]).unlink(missing_ok=True)
        except Exception:
            pass
    db.execute("DELETE FROM days WHERE id=?", (day_id,))
    db.commit()
    return jsonify({"ok": True})


@app.delete("/api/entries/<int:entry_id>")
def delete_entry_legacy(entry_id):
    return delete_day(entry_id)


