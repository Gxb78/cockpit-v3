# ---------- Launcher ----------

def env_bool(name, default=False):
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def open_browser(url):
    webbrowser.open_new(url)


# ---------- Dev restart ----------

@app.post("/api/dev/restart")
def dev_restart():
    """Redémarre le serveur Flask (mode dev uniquement).
    Rebuild d'abord le bundle, puis remplace le processus via os.execv."""
    import threading as _t
    def _restart():
        import sys
        import time as _t_mod
        import subprocess as _sp
        import os as _os
        # Rebuild le bundle avant de redémarrer
        _build_script = _os.path.join(_os.path.dirname(__file__), "..", "build.py")
        _build_script = _os.path.abspath(_build_script)
        try:
            _result = _sp.run([sys.executable, _build_script], capture_output=True, text=True, timeout=30)
            if _result.returncode != 0:
                log.warning("Dev restart: build failed\n%s", _result.stderr)
            else:
                log.info("Dev restart: rebuild OK")
        except Exception as _e:
            log.warning("Dev restart: build error %s", _e)
        _t_mod.sleep(0.5)
        log.info("Dev restart: os.execv(%s, %s)", sys.executable, sys.argv)
        _os.environ["OPEN_BROWSER"] = "0"
        _os.execv(sys.executable, [sys.executable] + sys.argv)
    _t.Thread(target=_restart, daemon=True).start()
    return jsonify({"ok": True, "message": "Rebuild + redémarrage en cours..."})


def launch():
    """Point d'entree du serveur. Appele par app.py quand le module est __main__."""
    import sys

    backup_db()
    init_db()

    debug_mode = env_bool("DEBUG", env_bool("FLASK_DEBUG", False))
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5000"))
    run_id = os.environ.get("COCKPIT_RUN_ID") or f"pid-{os.getpid()}"
    cwd = os.getcwd()

    open_browser_enabled = env_bool("OPEN_BROWSER", True)
    browser_url = os.environ.get("APP_URL", f"http://127.0.0.1:{port}/")
    is_reloader_child = os.environ.get("WERKZEUG_RUN_MAIN") == "true"

    # Avoid opening duplicate tabs when Flask reloader is active.
    if open_browser_enabled and (not debug_mode or is_reloader_child):
        Timer(0.8, open_browser, args=(browser_url,)).start()

    log.info(
        "Serveur run_id=%s pid=%s cwd=%s exe=%s host=%s port=%s debug=%s open_browser=%s app_url=%s",
        run_id,
        os.getpid(),
        cwd,
        sys.executable,
        host,
        port,
        debug_mode,
        open_browser_enabled,
        browser_url,
    )
    app.run(host=host, port=port, debug=debug_mode)
