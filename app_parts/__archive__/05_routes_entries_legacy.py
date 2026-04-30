# ---------- API : entries (legacy v2 compatibility) ----------

@app.get("/api/entries")
def list_entries_legacy():
    days = _query_days(
        month=request.args.get("month"),
        instrument=request.args.get("instrument"),
        date_from=request.args.get("from"),
        date_to=request.args.get("to"),
        search=request.args.get("q"),
    )
    return jsonify([_legacy_entry_from_day(day) for day in days])


@app.get("/api/entries/<int:entry_id>")
def get_entry_legacy(entry_id):
    day = fetch_day(entry_id)
    if not day:
        return jsonify({"error": "not found"}), 404
    return jsonify(_legacy_entry_from_day(day))


@app.post("/api/entries")
def create_entry_legacy():
    data = request.get_json(force=True) or {}

    date = data.get("date")
    instrument = _canonical_instrument(data.get("instrument"))
    if not date or not instrument:
        return jsonify({"error": "date et instrument requis"}), 400
    if instrument not in INSTRUMENTS:
        return jsonify({"error": f"instrument doit être parmi {INSTRUMENTS}"}), 400

    num_trades, num_trades_err = _parse_num_trades(data.get("num_trades"))
    if num_trades_err:
        return jsonify({"error": num_trades_err}), 400

    day_payload, day_errors = normalize_day_payload(data)
    if day_errors:
        return jsonify({"error": "; ".join(day_errors)}), 400

    wants_trade = _legacy_payload_has_trade_fields(data) or (num_trades is not None and num_trades > 0)
    trade_payload, trade_errors = ({}, [])
    if wants_trade:
        trade_payload, trade_errors = _normalize_legacy_trade_payload(data, for_update=False)
        if trade_errors:
            return jsonify({"error": "; ".join(trade_errors)}), 400
        semantic_errors = _validate_trade_semantics(trade_payload)
        if semantic_errors:
            return jsonify({"error": "; ".join(semantic_errors)}), 400

    day_payload.update({
        "date": date,
        "instrument": instrument,
        "schema_version": SCHEMA_VERSION,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    })

    db = get_db()
    cols = list(day_payload.keys())
    sql = f"INSERT INTO days ({','.join(cols)}) VALUES ({','.join(['?'] * len(cols))})"
    try:
        cur = db.execute(sql, [day_payload[c] for c in cols])
    except sqlite3.IntegrityError:
        return jsonify({"error": "Cette entrée existe déjà pour cette date et cet instrument"}), 409

    day_id = cur.lastrowid
    if wants_trade:
        _insert_trade_for_day(day_id, trade_payload)
    db.commit()

    return jsonify(_legacy_entry_from_day(fetch_day(day_id))), 201


@app.put("/api/entries/<int:entry_id>")
def update_entry_legacy(entry_id):
    data = request.get_json(force=True) or {}
    db = get_db()
    exists = db.execute("SELECT id FROM days WHERE id=?", (entry_id,)).fetchone()
    if not exists:
        return jsonify({"error": "not found"}), 404

    errors = []

    num_trades = None
    if "num_trades" in data:
        num_trades, num_trades_err = _parse_num_trades(data.get("num_trades"))
        if num_trades_err:
            errors.append(num_trades_err)

    day_payload, day_errors = normalize_day_payload(data, for_update=True)
    errors.extend(day_errors)

    if "date" in data:
        if not data.get("date"):
            errors.append("date requis")
        else:
            day_payload["date"] = data.get("date")
    if "instrument" in data:
        instrument = _canonical_instrument(data.get("instrument"))
        if not instrument:
            errors.append("instrument requis")
        elif instrument not in INSTRUMENTS:
            errors.append(f"instrument doit être parmi {INSTRUMENTS}")
        else:
            day_payload["instrument"] = instrument

    trade_payload = {}
    trade_fields_present = _legacy_payload_has_trade_fields(data)
    if trade_fields_present:
        trade_payload, trade_errors = _normalize_legacy_trade_payload(data, for_update=True)
        errors.extend(trade_errors)

    if errors:
        return jsonify({"error": "; ".join(errors)}), 400

    if day_payload:
        day_payload["updated_at"] = now_iso()
        sets = ", ".join(f"{c}=?" for c in day_payload)
        try:
            db.execute(f"UPDATE days SET {sets} WHERE id=?", list(day_payload.values()) + [entry_id])
        except sqlite3.IntegrityError:
            return jsonify({"error": "Cette entrée existe déjà pour cette date et cet instrument"}), 409

    if trade_fields_present:
        primary = _legacy_primary_trade(entry_id)
        if primary:
            if trade_payload:
                semantic_payload = dict(primary)
                semantic_payload.update(trade_payload)
                semantic_errors = _validate_trade_semantics(semantic_payload)
                if semantic_errors:
                    return jsonify({"error": "; ".join(semantic_errors)}), 400
                trade_payload["updated_at"] = now_iso()
                sets = ", ".join(f"{c}=?" for c in trade_payload)
                db.execute(
                    f"UPDATE trades SET {sets} WHERE id=?",
                    list(trade_payload.values()) + [primary["id"]]
                )
        else:
            create_payload, create_errors = _normalize_legacy_trade_payload(data, for_update=False)
            if create_errors:
                return jsonify({"error": "; ".join(create_errors)}), 400
            semantic_errors = _validate_trade_semantics(create_payload)
            if semantic_errors:
                return jsonify({"error": "; ".join(semantic_errors)}), 400
            _insert_trade_for_day(entry_id, create_payload)
    elif "num_trades" in data:
        if num_trades == 0:
            db.execute("DELETE FROM trades WHERE day_id=?", (entry_id,))
        else:
            primary = _legacy_primary_trade(entry_id)
            if not primary:
                _insert_trade_for_day(entry_id, {"pnl": 0})

    db.commit()
    return jsonify(_legacy_entry_from_day(fetch_day(entry_id)))


