# ---------- Routes : pages ----------

@app.context_processor
def _inject_asset_version():
    """Hash du bundle pour cache-busting — change quand le fichier change."""
    import hashlib as _h
    _v = ""
    for _f in (RESOURCE_DIR / "static" / "app.js", RESOURCE_DIR / "static" / "style.css"):
        if _f.exists():
            _v += _h.md5(_f.read_bytes()).hexdigest()[:12]
    market_ws_url = (os.environ.get("COCKPIT_MARKET_WS_URL") or "").strip()
    if not market_ws_url:
        market_host = (os.environ.get("MARKET_GO_HOST") or "127.0.0.1").strip() or "127.0.0.1"
        market_port = (os.environ.get("MARKET_GO_PORT") or "8765").strip() or "8765"
        market_ws_url = f"ws://{market_host}:{market_port}/stream"
    return dict(
        ASSET_VERSION=_v,
        COCKPIT_CONFIG={
            "marketWsUrl": market_ws_url,
        },
    )

@app.route("/")
def index():
    return render_template("index.html")


ALLOWED_SCREENSHOT_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}

@app.route("/screenshots/<filename>")
def serve_screenshot(filename):
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_SCREENSHOT_EXTENSIONS:
        abort(404)
    return send_from_directory(SCREENSHOTS_DIR, filename)


def _extract_asset_version(template_path: Path, pattern: str) -> str:
    if not template_path.exists():
        return ""
    try:
        content = template_path.read_text(encoding="utf-8")
    except Exception:
        return ""
    m = _re.search(pattern, content)
    return m.group(1) if m else ""


@app.get("/api/debug/runtime")
def debug_runtime():
    import sys

    scripts_tpl = RESOURCE_DIR / "templates" / "partials" / "overlays" / "scripts.html"
    css_tpl = RESOURCE_DIR / "templates" / "partials" / "layout" / "head_assets_css.html"
    app_js = RESOURCE_DIR / "static" / "app.js"
    style_css = RESOURCE_DIR / "static" / "style.css"

    app_js_stat = app_js.stat() if app_js.exists() else None
    style_css_stat = style_css.stat() if style_css.exists() else None

    return jsonify({
        "now": datetime.now().isoformat(timespec="seconds"),
        "pid": os.getpid(),
        "cwd": str(Path.cwd()),
        "base_dir": str(BASE_DIR),
        "python_executable": sys.executable,
        "env": {
            "host": os.environ.get("HOST", ""),
            "port": os.environ.get("PORT", ""),
            "app_url": os.environ.get("APP_URL", ""),
            "run_id": os.environ.get("COCKPIT_RUN_ID", ""),
            "debug": os.environ.get("DEBUG", ""),
            "flask_debug": os.environ.get("FLASK_DEBUG", ""),
            "werkzeug_run_main": os.environ.get("WERKZEUG_RUN_MAIN", ""),
        },
        "db_path": str(DB_PATH),
        "assets": {
            "template_js_version": _extract_asset_version(
                scripts_tpl,
                r"/static/app\.js\?v=([^\"']+)"
            ),
            "template_css_version": _extract_asset_version(
                css_tpl,
                r"/static/style\.css\?v=([^\"']+)"
            ),
            "app_js": {
                "path": str(app_js),
                "exists": app_js.exists(),
                "size": app_js_stat.st_size if app_js_stat else None,
                "mtime": datetime.fromtimestamp(app_js_stat.st_mtime).isoformat(timespec="seconds")
                if app_js_stat else None,
            },
            "style_css": {
                "path": str(style_css),
                "exists": style_css.exists(),
                "size": style_css_stat.st_size if style_css_stat else None,
                "mtime": datetime.fromtimestamp(style_css_stat.st_mtime).isoformat(timespec="seconds")
                if style_css_stat else None,
            },
        },
    })


@app.get("/api/settings")
def get_settings():
    def _mask_key(raw):
        raw = (raw or "").strip()
        if not raw:
            return ""
        if len(raw) <= 10:
            return raw[:2] + "..." + raw[-2:]
        return raw[:6] + "..." + raw[-4:]

    anthropic_raw = os.environ.get("ANTHROPIC_API_KEY", "")
    deepseek_raw  = os.environ.get("DEEPSEEK_API_KEY", "")

    return jsonify({
        "ai_api_key_present": bool(anthropic_raw.strip()),
        "ai_api_key_masked": _mask_key(anthropic_raw),
        "ai_api_key_env": "ANTHROPIC_API_KEY",
        "ai_provider": "anthropic",
        "ai_config_hint": (
            ""
            if anthropic_raw.strip()
            else "Cree un fichier .env a la racine du projet avec: ANTHROPIC_API_KEY=sk-ant-..."
        ),
        "deepseek": {
            "key_present": bool(deepseek_raw.strip()),
            "key_masked": _mask_key(deepseek_raw),
            "env_var": "DEEPSEEK_API_KEY",
            "hint": (
                ""
                if deepseek_raw.strip()
                else "Ajoute dans .env: DEEPSEEK_API_KEY=sk-votre-cle..."
            ),
        },
    })


@app.get("/api/config")
def get_config():
    """Retourne la configuration partagee (instruments, strategies, etc.)."""
    return jsonify({
        "instruments": INSTRUMENTS,
        "strategies": STRATEGIES,
        "strategy_labels": STRATEGY_LABELS,
        "debug": os.environ.get("DEBUG", os.environ.get("FLASK_DEBUG", "0")).strip().lower() in ("1", "true", "yes", "on"),
    })


@app.post("/api/settings/key")
def save_api_key():
    body = request.get_json(silent=True) or {}
    raw_key = (body.get("key") or "").strip()
    provider = (body.get("provider") or "deepseek").strip().lower()
    if not raw_key:
        return jsonify({"error": "Cle requise"}), 400
    env_var = "DEEPSEEK_API_KEY" if provider == "deepseek" else "ANTHROPIC_API_KEY"
    env_path = BASE_DIR / ".env"
    try:
        if env_path.exists():
            text = env_path.read_text(encoding="utf-8")
            lines = text.splitlines(keepends=True)
            found = False
            new_lines = []
            for line in lines:
                if line.strip().startswith(env_var + "="):
                    new_lines.append(f'{env_var}={raw_key}\n')
                    found = True
                else:
                    new_lines.append(line)
            if not found:
                new_lines.append(f'{env_var}={raw_key}\n')
            env_path.write_text("".join(new_lines), encoding="utf-8")
        else:
            env_path.write_text(f'{env_var}={raw_key}\n', encoding="utf-8")
        os.environ[env_var] = raw_key
        return jsonify({"ok": True, "message": f"Cle {env_var} mise a jour. Redemarre le serveur pour quil prenne effet."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
