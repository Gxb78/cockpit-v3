# ---------- API : screenshots ----------

@app.post("/api/trades/<int:trade_id>/screenshots")
def upload_screenshot(trade_id):
    db = get_db()
    if not db.execute("SELECT id FROM trades WHERE id=?", (trade_id,)).fetchone():
        return jsonify({"error": "trade not found"}), 404
    if "file" not in request.files:
        return jsonify({"error": "no file"}), 400
    file = request.files["file"]
    if not file.filename or not allowed_file(file.filename):
        return jsonify({"error": "invalid file type"}), 400
    declared_ext = file.filename.rsplit(".", 1)[1].lower()
    declared_ext = "jpg" if declared_ext == "jpeg" else declared_ext
    sniffed_ext = _sniff_image_extension(file)
    if not sniffed_ext:
        return jsonify({"error": "invalid image content"}), 400
    if declared_ext != sniffed_ext:
        return jsonify({"error": f"file extension/content mismatch ({declared_ext} vs {sniffed_ext})"}), 400
    fname = f"{uuid.uuid4().hex}.{sniffed_ext}"
    file.save(SCREENSHOTS_DIR / fname)
    caption = request.form.get("caption", "")
    cur = db.execute(
        "INSERT INTO trade_screenshots (trade_id, filename, caption, created_at) VALUES (?,?,?,?)",
        (trade_id, fname, caption, now_iso())
    )
    db.commit()
    return jsonify({"id": cur.lastrowid, "filename": fname, "caption": caption}), 201


@app.post("/api/entries/<int:entry_id>/screenshots")
def upload_entry_screenshot_legacy(entry_id):
    db = get_db()
    day_exists = db.execute("SELECT id FROM days WHERE id=?", (entry_id,)).fetchone()
    if not day_exists:
        return jsonify({"error": "not found"}), 404
    primary = _legacy_primary_trade(entry_id)
    if not primary:
        trade_id = _insert_trade_for_day(entry_id, {"pnl": 0})
        db.commit()
    else:
        trade_id = primary["id"]
    return upload_screenshot(trade_id)


@app.delete("/api/screenshots/<int:shot_id>")
def delete_screenshot(shot_id):
    db  = get_db()
    row = db.execute("SELECT filename FROM trade_screenshots WHERE id=?", (shot_id,)).fetchone()
    if not row:
        return jsonify({"error": "not found"}), 404
    try:
        (SCREENSHOTS_DIR / row["filename"]).unlink(missing_ok=True)
    except Exception:
        pass
    db.execute("DELETE FROM trade_screenshots WHERE id=?", (shot_id,))
    db.commit()
    return jsonify({"ok": True})


@app.put("/api/screenshots/<int:shot_id>")
def update_screenshot(shot_id):
    data = request.get_json(force=True)
    db   = get_db()
    if not db.execute("SELECT id FROM trade_screenshots WHERE id=?", (shot_id,)).fetchone():
        return jsonify({"error": "not found"}), 404
    db.execute("UPDATE trade_screenshots SET caption=? WHERE id=?", (data.get("caption", ""), shot_id))
    db.commit()
    return jsonify({"ok": True})


