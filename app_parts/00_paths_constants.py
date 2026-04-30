"""
Trading Journal - COCKPIT v3
Local Flask app for BTC / ETH / NAS / ES.
Schema v3 : days (contexte journalier) + trades (trades individuels, N par jour).
"""
import json
import os
import re as _re
import sqlite3
import unicodedata
import uuid
import webbrowser
from datetime import datetime
from pathlib import Path
from threading import Timer

from flask import Flask, abort, g, jsonify, render_template, request, send_from_directory

# ---------- Paths & constants ----------

# __file__ = __init__.py (dans app_parts/) ou app.py (a la racine)
# On remonte jusqu'a la racine du projet dans les deux cas.
_FILE_DIR = Path(__file__).resolve().parent
BASE_DIR   = _FILE_DIR.parent if _FILE_DIR.name == "app_parts" else _FILE_DIR
del _FILE_DIR
DATA_DIR        = BASE_DIR / "data"
SCREENSHOTS_DIR = DATA_DIR / "screenshots"
BACKUPS_DIR     = DATA_DIR / "backups"
DB_PATH         = DATA_DIR / "journal.db"

DATA_DIR.mkdir(exist_ok=True)
SCREENSHOTS_DIR.mkdir(exist_ok=True)

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}
MAX_SCREENSHOT_SIZE = 5 * 1024 * 1024  # 5 Mo par screenshot
# Lecture des instruments, strategies et alias depuis config.json
_CONFIG_PATH = BASE_DIR / "config.json"
_CONFIG_DATA = json.loads(_CONFIG_PATH.read_text(encoding="utf-8")) if _CONFIG_PATH.exists() else {}

INSTRUMENTS       = _CONFIG_DATA.get("instruments", ["BTC", "ETH", "NQ", "ES"])
STRATEGIES        = _CONFIG_DATA.get("strategies", ["midnight_model", "london_model", "ny_model"])
INSTRUMENT_ALIASES = _CONFIG_DATA.get("instrument_aliases", {"NAS": "NQ"})
STRATEGY_ALIASES   = _CONFIG_DATA.get("strategy_aliases", {
    "midnight": "midnight_model",
    "london": "london_model",
    "ny": "ny_model",
})
STRATEGY_LABELS    = _CONFIG_DATA.get("strategy_labels", {
    "midnight_model": "Midnight Model",
    "london_model": "London Model",
    "ny_model": "NY Model",
})
SCHEMA_VERSION = 6
MAX_BACKUPS    = 50

# Limites de taille pour les champs textes
MAX_TEXT_SHORT  = 1000   # htf_bias, session, caption
MAX_TEXT_MEDIUM = 5000   # why_trade, why_entry, scenario, etc.
MAX_TEXT_LONG   = 10000  # daily_notes, htf_context, lessons_learned

# Whitelists pour la normalisation des payloads
DAY_TEXT_FIELDS   = ["htf_bias", "htf_context", "session", "daily_notes"]
TRADE_TEXT_FIELDS = [
    "strategy", "direction",
    "why_trade", "why_entry", "why_stop", "why_tp",
    "scenario",
    "thesis_validated", "lessons_learned",
    "plan_model", "plan_direction", "plan_alignment",
    "plan_override_reason", "plan_snapshot",
]
TRADE_NUMERIC_FIELDS = ["pnl", "rr", "entry_price", "stop_loss", "take_profit", "exit_price", "position_size", "leverage"]
TRADE_INT_FIELDS     = ["execution_quality", "plan_score"]


