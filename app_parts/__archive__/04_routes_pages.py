# ---------- Routes : pages ----------

@app.route("/")
def index():
    return render_template("index.html", instruments=INSTRUMENTS)


@app.route("/screenshots/<path:filename>")
def serve_screenshot(filename):
    return send_from_directory(SCREENSHOTS_DIR, filename)


@app.get("/api/settings")
def get_settings():
    raw_key = (os.environ.get("ANTHROPIC_API_KEY", "") or "").strip()
    if not raw_key:
        masked = ""
    elif len(raw_key) <= 10:
        masked = raw_key[:2] + "..." + raw_key[-2:]
    else:
        masked = raw_key[:6] + "..." + raw_key[-4:]
    return jsonify({
        "ai_api_key_present": bool(raw_key),
        "ai_api_key_masked": masked,
        "ai_api_key_env": "ANTHROPIC_API_KEY",
        "ai_provider": "anthropic",
    })


