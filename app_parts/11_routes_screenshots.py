# ---------- API : screenshots ----------

@app.post("/api/trades/<int:trade_id>/screenshots")
@ratelimit(max_per_minute=30)
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
    # Verifier la taille individuelle du fichier
    file.stream.seek(0, 2)  # seek end
    file_size = file.stream.tell()
    file.stream.seek(0)     # reset
    if file_size > MAX_SCREENSHOT_SIZE:
        return jsonify({"error": f"fichier trop volumineux ({file_size // 1024} Ko, max {MAX_SCREENSHOT_SIZE // 1024 // 1024} Mo)"}), 400
    fname = f"{uuid.uuid4().hex}.{sniffed_ext}"
    dest = SCREENSHOTS_DIR / fname
    # Compression optionnelle via Pillow si installe (redimensionne a 1920px max)
    try:
        from PIL import Image as _PILImg
        img = _PILImg.open(file.stream)
        if max(img.width, img.height) > 1920:
            ratio = 1920.0 / max(img.width, img.height)
            img = img.resize((int(img.width * ratio), int(img.height * ratio)), _PILImg.LANCZOS)
        if sniffed_ext == "jpg":
            img.save(dest, "JPEG", quality=85, optimize=True)
        elif sniffed_ext == "png":
            img.save(dest, "PNG", optimize=True)
        else:
            img.save(dest)
    except ImportError:
        # Pillow absent — sauvegarde brute sans compression
        file.stream.seek(0)
        file.save(dest)
    except Exception:
        # Fallback sur sauvegarde brute en cas d erreur de compression
        file.stream.seek(0)
        file.save(dest)
    caption = request.form.get("caption", "")
    if len(caption) > MAX_TEXT_SHORT:
        return jsonify({"error": f"caption trop longue ({len(caption)} caracteres, max {MAX_TEXT_SHORT})"}), 400
    cur = db.execute(
        "INSERT INTO trade_screenshots (trade_id, filename, caption, created_at) VALUES (?,?,?,?)",
        (trade_id, fname, caption, now_iso())
    )
    db.commit()
    return jsonify({"id": cur.lastrowid, "filename": fname, "caption": caption}), 201


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
    caption = data.get("caption", "")
    if len(caption) > MAX_TEXT_SHORT:
        return jsonify({"error": f"caption trop longue ({len(caption)} caracteres, max {MAX_TEXT_SHORT})"}), 400
    if not db.execute("SELECT id FROM trade_screenshots WHERE id=?", (shot_id,)).fetchone():
        return jsonify({"error": "not found"}), 404
    db.execute("UPDATE trade_screenshots SET caption=? WHERE id=?", (data.get("caption", ""), shot_id))
    db.commit()
    return jsonify({"ok": True})
