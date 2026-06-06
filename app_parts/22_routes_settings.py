# ---------- Routes : user profile and workspace profile ----------

USER_PROFILE_KEYS = {"profile", "custom_strategies", "custom_tags", "preferences", "ui_state"}
WORKSPACE_PROFILE_KEYS = {"v6_orderflow_settings", "v6_workspaces"}
USER_SETTINGS_KEYS = USER_PROFILE_KEYS | WORKSPACE_PROFILE_KEYS


def _load_user_settings(keys=None):
    db = get_db()
    if keys:
        placeholders = ",".join(["?"] * len(keys))
        rows = db.execute(
            f"SELECT key, value FROM user_settings WHERE key IN ({placeholders})",
            tuple(keys),
        ).fetchall()
    else:
        rows = db.execute("SELECT key, value FROM user_settings").fetchall()

    settings = {}
    for row in rows:
        try:
            settings[row["key"]] = json.loads(row["value"])
        except (json.JSONDecodeError, TypeError):
            settings[row["key"]] = row["value"]
    return settings


def _save_user_settings_payload(data, allowed_keys):
    if not data or not isinstance(data, dict):
        return None, (jsonify({"ok": False, "error": "Invalid payload"}), 400)

    db = get_db()
    now = now_iso()
    saved = []
    for key in allowed_keys:
        if key not in data:
            continue
        value_json = json.dumps(data[key], ensure_ascii=False)
        db.execute(
            "INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)",
            (key, value_json),
        )
        saved.append(key)

    db.commit()
    return {"ok": True, "updated_at": now, "saved": saved}, None


@app.get("/api/user/settings")
def get_user_settings():
    return jsonify({"ok": True, "settings": _load_user_settings()})


@app.post("/api/user/settings")
def save_user_settings():
    data = request.get_json(silent=True)
    saved, error = _save_user_settings_payload(data, USER_SETTINGS_KEYS)
    if error:
        return error
    return jsonify(saved)


@app.get("/api/user/profile")
def get_user_profile():
    return jsonify({"ok": True, "profile": _load_user_settings(USER_PROFILE_KEYS)})


@app.post("/api/user/profile")
def save_user_profile():
    data = request.get_json(silent=True)
    saved, error = _save_user_settings_payload(data, USER_PROFILE_KEYS)
    if error:
        return error
    return jsonify(saved)


@app.get("/api/user/workspace-profile")
def get_user_workspace_profile():
    return jsonify({"ok": True, "workspace_profile": _load_user_settings(WORKSPACE_PROFILE_KEYS)})


@app.post("/api/user/workspace-profile")
def save_user_workspace_profile():
    data = request.get_json(silent=True)
    saved, error = _save_user_settings_payload(data, WORKSPACE_PROFILE_KEYS)
    if error:
        return error
    return jsonify(saved)
