# ---------- Launcher ----------

def env_bool(name, default=False):
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def open_browser(url):
    webbrowser.open_new(url)


if __name__ == "__main__":
    backup_db()
    init_db()

    debug_mode = env_bool("DEBUG", env_bool("FLASK_DEBUG", False))
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5000"))

    open_browser_enabled = env_bool("OPEN_BROWSER", True)
    browser_url = os.environ.get("APP_URL", f"http://127.0.0.1:{port}/")
    is_reloader_child = os.environ.get("WERKZEUG_RUN_MAIN") == "true"

    # Avoid opening duplicate tabs when Flask reloader is active.
    if open_browser_enabled and (not debug_mode or is_reloader_child):
        Timer(0.8, open_browser, args=(browser_url,)).start()

    print(f"[launcher] host={host} port={port} debug={debug_mode} open_browser={open_browser_enabled}")
    app.run(host=host, port=port, debug=debug_mode)
