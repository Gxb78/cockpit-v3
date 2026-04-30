# ---------- Logging ----------

import logging as _logging

_logging.basicConfig(
    level=_logging.INFO,
    format="%(asctime)s %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S",
)
log = _logging.getLogger("journal")

# ---------- Flask app ----------

try:
    from dotenv import load_dotenv
    load_dotenv()  # charge .env depuis la racine du projet
except ImportError:
    log.warning("python-dotenv absent. Lance: pip install python-dotenv")
    log.warning("Sans .env, la cle ANTHROPIC_API_KEY doit etre dans l environnement.")

app = Flask(__name__,
    template_folder=str(BASE_DIR / "templates"),
    static_folder=str(BASE_DIR / "static"),
    static_url_path="/static",
)
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
app.config["TEMPLATES_AUTO_RELOAD"] = True


@app.after_request
def add_no_cache_headers(response):
    ct = response.content_type or ""
    if any(ct.startswith(t) for t in ("text/html", "text/css", "application/javascript", "text/javascript")):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"]  = "no-cache"
        response.headers["Expires"] = "0"
    # CORS leger pour les API — restreint aux origines locales
    if request.path.startswith("/api/"):
        origin = request.headers.get("Origin", "")
        if not origin or origin.startswith(("http://localhost", "http://127.0.0.1")):
            response.headers["Access-Control-Allow-Origin"] = origin or "*"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


# ---------- Handlers d'erreur ----------


def _json_error(status, message):
    return jsonify({"error": message}), status


@app.errorhandler(404)
def not_found(_exc):
    if request.path.startswith("/api/"):
        return _json_error(404, "Route introuvable")
    return render_template("index.html"), 404


@app.errorhandler(405)
def method_not_allowed(_exc):
    if request.path.startswith("/api/"):
        return _json_error(405, "Methode non autorisee")
    return render_template("index.html"), 405


@app.errorhandler(413)
def request_too_large(_exc):
    return _json_error(413, "Requete trop volumineuse (max 25 Mo)")


@app.errorhandler(500)
def server_error(_exc):
    return _json_error(500, "Erreur interne du serveur")


