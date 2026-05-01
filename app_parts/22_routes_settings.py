# ---------- Routes : user settings (profile, strategies, tags, prefs) ----------

@app.get("/api/user/settings")
def get_user_settings():
    db = get_db()
    rows = db.execute("SELECT key, value FROM user_settings").fetchall()
    settings = {}
    for row in rows:
        try:
            settings[row["key"]] = json.loads(row["value"])
        except (json.JSONDecodeError, TypeError):
            settings[row["key"]] = row["value"]
    return jsonify({"ok": True, "settings": settings})


@app.post("/api/user/settings")
def save_user_settings():
    data = request.get_json(silent=True)
    if not data or not isinstance(data, dict):
        return jsonify({"ok": False, "error": "Invalid payload"}), 400

    db = get_db()
    now = now_iso()

    allowed_keys = {"profile", "custom_strategies", "custom_tags", "preferences"}

    for key in allowed_keys:
        if key not in data:
            continue
        value = data[key]
        value_json = json.dumps(value, ensure_ascii=False)
        db.execute(
            "INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)",
            (key, value_json),
        )

    db.commit()
    return jsonify({"ok": True, "updated_at": now})