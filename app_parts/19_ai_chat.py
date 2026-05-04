# ---------- AI Chat : DeepSeek integration ----------
#
# Endpoint POST /api/ai/chat
# Tool/function calling compatible OpenAI format pour DeepSeek v4 Flash
# Lit TOUTES les donnees (days, trades, stats), cree/modifie des days/trades
# Guide l'utilisateur dans un chat conversationnel

import hashlib as _hashlib
import json
import os
import time as _time_mod
import urllib.error
import urllib.request

DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions"
DEEPSEEK_MODEL   = "deepseek-v4-flash"

# ---------- Pending images (upload via chat) ----------

import base64 as _b64
import uuid as _uuid

_PENDING_IMAGES = {}  # token -> {"path": Path, "ts": timestamp}
_PENDING_IMAGES_TTL = 600  # 10 minutes

def _cleanup_stale_pending():
    now = _time_mod.time()
    stale = [k for k, v in _PENDING_IMAGES.items() if now - v["ts"] > _PENDING_IMAGES_TTL]
    for k in stale:
        try:
            _PENDING_IMAGES[k]["path"].unlink(missing_ok=True)
        except Exception:
            pass
        del _PENDING_IMAGES[k]

def _save_pending_image(file_storage):
    """Sauvegarde un fichier uploade dans un dossier temp et retourne un token.

    L'extension est determinee par sniffing du contenu reel, pas par le nom
    de fichier declare (evite image.exe contenant un vrai PNG).
    """
    sniffed = _sniff_image_extension(file_storage)
    if not sniffed:
        raise ValueError("Format d'image non supporte")

    file_storage.stream.seek(0, 2)
    file_size = file_storage.stream.tell()
    file_storage.stream.seek(0)

    if file_size > MAX_SCREENSHOT_SIZE:
        raise ValueError("Image trop volumineuse")

    token = _uuid.uuid4().hex
    pending_dir = DATA_DIR / "_pending"
    pending_dir.mkdir(exist_ok=True)
    dest = pending_dir / f"{token}.{sniffed}"
    file_storage.save(str(dest))
    _PENDING_IMAGES[token] = {"path": dest, "ts": _time_mod.time()}
    _cleanup_stale_pending()
    return token

# ---------- Cache LRU + circuit breaker (meme pattern que parse_trade) ----------

_AI_CHAT_CACHE     = {}
_AI_CHAT_CACHE_MAX = 50
_AI_CIRCUIT        = {
    "failures": 0,
    "max_failures": 3,
    "open_until": 0.0,
    "cooldown": 60.0,
}


def _ai_cache_key(messages_json):
    return _hashlib.md5(messages_json.encode("utf-8")).hexdigest()


def _ai_cache_get(messages_json):
    key = _ai_cache_key(messages_json)
    entry = _AI_CHAT_CACHE.get(key)
    if entry is None:
        return None
    return entry["result"]


def _ai_cache_put(messages_json, result):
    key = _ai_cache_key(messages_json)
    _AI_CHAT_CACHE[key] = {"result": result, "ts": _time_mod.time()}
    if len(_AI_CHAT_CACHE) > _AI_CHAT_CACHE_MAX:
        oldest = min(_AI_CHAT_CACHE.keys(), key=lambda k: _AI_CHAT_CACHE[k]["ts"])
        del _AI_CHAT_CACHE[oldest]


def _ai_circuit_allowed():
    state = _AI_CIRCUIT
    now = _time_mod.time()
    if state["failures"] >= state["max_failures"]:
        if now < state["open_until"]:
            return False
        log.info("AI circuit half-open apres %ss de cooldown", state['cooldown'])
    return True


def _ai_circuit_success():
    _AI_CIRCUIT["failures"] = 0
    _AI_CIRCUIT["open_until"] = 0.0


def _ai_circuit_failure():
    state = _AI_CIRCUIT
    state["failures"] += 1
    if state["failures"] >= state["max_failures"]:
        state["open_until"] = _time_mod.time() + state["cooldown"]
        log.warning(
            "AI circuit ouvert pour %ss (%s echecs consecutifs)",
            state['cooldown'], state['failures'],
        )


# =========================================================================
# SYSTEM PROMPT
# =========================================================================

_AI_SYSTEM_PROMPT = """Tu es COCKPIT Assistant, l'assistant IA du Trading Journal COCKPIT v3.

Tu aides le trader a analyser, creer et modifier ses donnees de trading.
Tu peux LIRE toutes les donnees (days, trades, stats) et CREER/MODIFIER des days et trades via les outils (tools) mis a ta disposition.

INSTRUCTIONS GENERALES :
1. Sois concis et utile. Utilise le francais (ou la langue de l'utilisateur).
2. Quand l'utilisateur parle d'un trade, identifie le contexte (day_id, date, instrument) avant d'agir.
3. Pour creer un trade, guide l'utilisateur etape par etape si les infos sont incompletes.
4. Pour creer un nouveau jour (day), verifie d'abord s'il existe deja via get_days ou get_day.
5. Les trades sont attaches a un day_id (jour de trading). Un jour peut avoir N trades.
6. Utilise systematiquement les outils mis a disposition plutot que de donner des conseils generiques.

|FORMAT DES DONNEES :

Un DAY contient :
- date (YYYY-MM-DD), instrument (BTC/ETH/NAS/ES)
- htf_bias (bullish/bearish/neutral), session (asia/london/ny_am/ny_pm)
- htf_context, daily_notes (texte libre)
- tags (liste de mots-cles)

Un TRADE contient :
- day_id (FK vers days), strategy (midnight_model/london_model/ny_model)
- direction (long/short), entry_price, stop_loss, take_profit (alias : TP, aussi appele exit_price)
- position_size (en contrats pour les futures), leverage (levier)
- pnl : calcule AUTOMATIQUEMENT depuis entry_price + exit_price (= take_profit) + position_size + leverage
- note : exit_price et take_profit designent la MEME chose (prix de sortie = take-profit)
- rr, is_win (1=gagne/0=perdu, aussi deduit auto du PnL)
- why_trade, why_entry (pourquoi entree), why_stop (pourquoi stop)
- why_tp (pourquoi take profit / TP — pourquoi ce niveau de sortie)
- stdv_level (1 a 5 par pas de 0.5), scenario
- thesis_validated (yes/no/partial), execution_quality (1-5)
- lessons_learned, tags (liste)

STRATEGIES DISPONIBLES :
- midnight_model : Midnight Model (ouverture NY, PO3, STDV)
- london_model : London Model (session Londres)
- ny_model : NY Model (session New York complete)

INSTRUMENTS : BTC, ETH, NQ, ES

REGLES DE VALIDATION :
- En LONG : stop_loss < entry_price < take_profit
- En SHORT : take_profit < entry_price < stop_loss
- is_win=1 si PnL positif, is_win=0 si PnL negatif
- execution_quality : entier entre 1 et 5

QUAND L'UTILISATEUR VEUT CREER UN TRADE :
1. Demande/lit le contexte (date, instrument) ou cherche le day_id
2. Demande les informations essentielles progressivement :
   a. Strategy et direction
   b. Prix d'entree, stop loss, take profit (ou "TP" — je comprends TP = take_profit)
   c. Pourquoi ce trade (narratif)
   d. StdV level et scenario pour midnight_model
   e. Position (nombre de contrats) et levier pour les futures
3. Confirme les donnees avant de creer
4. Apres creation, propose de modifier si besoin ou de continuer
5. IMPORTANT : Le PnL est calcule AUTOMATIQUEMENT a partir de entry_price, exit_price (= take_profit/TP) et position_size + leverage. Ne demande JAMAIS le PnL manuellement si ces infos sont fournies. Pour ES multiplier x50, NQ x20, BTC/ETH x1 avec levier.

QUAND L'UTILISATEUR DEMANDE UNE ANALYSE :
1. Utilise get_stats pour les stats globales
2. Utilise get_days/get_day pour les jours specifiques
3. Utilise get_trades avec le day_id pour les trades d'un jour
4. Fournis des insights utiles : winrate, PnL, patterns, R:R moyen
5. Le tool get_stats retourne des donnees riches :
   - total_pnl, winrate, avg_rr, nb de trades
   - PnL cumule (pour analyse de courbe de profit)
   - Drawdown max et courant
   - Performance par instrument, strategie (by_setup), session, biais HTF, jour de la semaine, tags
   - Comparaison mois courant vs mois precedent
   - Distribution des RR
   - Insights textuels generes automatiquement
   - Streak (sequence de jours gagnants/perdants)

CONTEXTE DE TRADING MIDNIGHT MODEL (specifique) :
- PO3 = Power Of Three (sweep + reversal)
- STDV = Standard Deviation (niveaux 1 a 5 par pas de 0.5)
- IFVG = Inversion Fair Value Gap (trigger d'entree)
- OTE = Optimal Trade Entry (zone de retracement)
- SMT = Smart Money Trap (divergence)
- Premium = zone au-dessus de 50%, Discount = zone en dessous de 50%
- Liquidity above/below = liquidite visee pour le TP

SUPPRESSION DE DONNEES :
- Tu as les outils delete_trade et delete_day pour supprimer des donnees.
- delete_trade supprime un trade et ses screenshots. Necessite un trade_id.
- delete_day supprime un jour de trading, TOUS ses trades et TOUS ses screenshots. Necessite un day_id.
- Avant de supprimer, utilise get_day/get_trades pour trouver l'ID exact.
- Confirme TOUJOURS avec l'utilisateur avant de supprimer ("Je vais supprimer le trade X du jour Y, confirme ?").
- Apres suppression, informe l'utilisateur du resultat.

DATES ET JOURS DE LA SEMAINE :
- Ne devine JAMAIS le jour de la semaine d'une donnee. Utilise TOUJOURS get_day/get_days pour verifier.
- Les jours feries n'existent pas dans le systeme. Si l'utilisateur dit qu'un jour existe, verifie avec get_day avant de refuser.
- Le format de date est YYYY-MM-DD.

SCREENSHOTS / IMAGES :
- L'utilisateur peut coller (Ctrl+V) ou uploader une image dans le chat.
- L'outil attach_screenshot permet de lier une image uploadee a un trade.
- L'image_token est fourni automatiquement dans le contexte quand une image est en attente.
- Utilise attach_screenshot(trade_id=..., image_token=..., caption=...) quand l'utilisateur te demande d'attacher l'image a un trade.
- Le token expire apres 10 minutes. Si expire, demande a l'utilisateur de re-uploader l'image."""
# fmt: on


# =========================================================================
# OUTILS (TOOLS) — format OpenAI-compatible
# =========================================================================

_AI_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_days",
            "description": "Recherche des jours de trading. Retourne la liste des jours filtres par date, instrument, mois ou texte.",
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {
                        "type": "string",
                        "description": "Date exacte au format YYYY-MM-DD",
                    },
                    "instrument": {
                        "type": "string",
                        "enum": ["BTC", "ETH", "NQ", "ES"],
                        "description": "Filtrer par instrument",
                    },
                    "month": {
                        "type": "string",
                        "description": "Mois au format YYYY-MM",
                    },
                    "from": {
                        "type": "string",
                        "description": "Date debut de plage YYYY-MM-DD",
                    },
                    "to": {
                        "type": "string",
                        "description": "Date fin de plage YYYY-MM-DD",
                    },
                    "q": {
                        "type": "string",
                        "description": "Recherche textuelle dans les notes",
                    },
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_day",
            "description": "Recupere un jour de trading specifique avec ses trades. Soit par day_id, soit par date+instrument.",
            "parameters": {
                "type": "object",
                "properties": {
                    "day_id": {
                        "type": "integer",
                        "description": "ID du jour",
                    },
                    "date": {
                        "type": "string",
                        "description": "Date exacte YYYY-MM-DD (necessite instrument)",
                    },
                    "instrument": {
                        "type": "string",
                        "enum": ["BTC", "ETH", "NQ", "ES"],
                        "description": "Instrument (necessite date)",
                    },
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_day",
            "description": "Cree un nouveau jour de trading.",
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {
                        "type": "string",
                        "description": "Date au format YYYY-MM-DD (requis)",
                    },
                    "instrument": {
                        "type": "string",
                        "enum": ["BTC", "ETH", "NQ", "ES"],
                        "description": "Instrument (requis)",
                    },
                    "htf_bias": {
                        "type": "string",
                        "enum": ["bullish", "bearish", "neutral"],
                        "description": "Biais haute timeframe",
                    },
                    "session": {
                        "type": "string",
                        "enum": ["asia", "london", "ny_am", "ny_pm"],
                        "description": "Session de trading",
                    },
                    "htf_context": {
                        "type": "string",
                        "description": "Contexte HTF (texte libre)",
                    },
                    "daily_notes": {
                        "type": "string",
                        "description": "Notes du jour",
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Tags / mots-cles",
                    },
                },
                "required": ["date", "instrument"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_day",
            "description": "Modifie un jour de trading existant. Ne fournis que les champs a mettre a jour.",
            "parameters": {
                "type": "object",
                "properties": {
                    "day_id": {
                        "type": "integer",
                        "description": "ID du jour a modifier (requis)",
                    },
                    "instrument": {
                        "type": "string",
                        "enum": ["BTC", "ETH", "NQ", "ES"],
                        "description": "Nouvel instrument",
                    },
                    "date": {
                        "type": "string",
                        "description": "Nouvelle date au format YYYY-MM-DD",
                    },
                    "htf_bias": {
                        "type": "string",
                        "enum": ["bullish", "bearish", "neutral"],
                    },
                    "session": {
                        "type": "string",
                        "enum": ["asia", "london", "ny_am", "ny_pm"],
                    },
                    "htf_context": {"type": "string"},
                    "daily_notes": {"type": "string"},
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": ["day_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_trades",
            "description": "Recupere tous les trades attaches a un jour de trading.",
            "parameters": {
                "type": "object",
                "properties": {
                    "day_id": {
                        "type": "integer",
                        "description": "ID du jour (requis)",
                    },
                },
                "required": ["day_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_trade",
            "description": "Cree un nouveau trade attache a un jour de trading existant.",
            "parameters": {
                "type": "object",
                "properties": {
                    "day_id": {
                        "type": "integer",
                        "description": "ID du jour auquel rattacher ce trade (requis)",
                    },
                    "strategy": {
                        "type": "string",
                        "enum": ["midnight_model", "london_model", "ny_model"],
                        "description": "Strategie utilisee",
                    },
                    "direction": {
                        "type": "string",
                        "enum": ["long", "short"],
                        "description": "Direction du trade",
                    },
                    "entry_price": {
                        "type": "number",
                        "description": "Prix d'entree",
                    },
                    "stop_loss": {
                        "type": "number",
                        "description": "Prix du stop loss",
                    },
                    "take_profit": {
                        "type": "number",
                        "description": "Prix du take profit (alias exit_price). Meme chose que exit_price.",
                    },
                    "exit_price": {
                        "type": "number",
                        "description": "Prix de sortie = take_profit (alias tp). Meme chose que take_profit.",
                    },
                    "position_size": {
                        "type": "number",
                        "description": "Taille de la position",
                    },
                    "pnl": {
                        "type": "number",
                        "description": "PnL realise (positif=gain, negatif=perte). Si non fourni, calcule automatiquement depuis entry_price, exit_price, position_size et leverage.",
                    },
                    "leverage": {
                        "type": "integer",
                        "description": "Levier utilise (1 = pas de levier). Necessaire pour le calcul auto du PnL sur les futures.",
                    },
                    "rr": {
                        "type": "number",
                        "description": "Ratio risque/reward",
                    },
                    "is_win": {
                        "type": "integer",
                        "enum": [0, 1],
                        "description": "1 si gagnant, 0 si perdant",
                    },
                    "why_trade": {
                        "type": "string",
                        "description": "Pourquoi ce trade (narratif)",
                    },
                    "why_entry": {
                        "type": "string",
                        "description": "Pourquoi cette entree",
                    },
                    "why_stop": {
                        "type": "string",
                        "description": "Pourquoi ce stop loss",
                    },
                    "why_tp": {
                        "type": "string",
                        "description": "Pourquoi ce take profit",
                    },
                    "stdv_level": {
                        "type": "number",
                        "description": "Niveau STDV (1 a 5 par pas de 0.5)",
                    },
                    "scenario": {
                        "type": "string",
                        "description": "Scenario du trade",
                    },
                    "thesis_validated": {
                        "type": "string",
                        "enum": ["yes", "no", "partial"],
                        "description": "These validee ou non",
                    },
                    "execution_quality": {
                        "type": "integer",
                        "description": "Qualite d'execution (1 a 5)",
                    },
                    "lessons_learned": {
                        "type": "string",
                        "description": "Lecons apprises",
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Tags / mots-cles",
                    },
                },
                "required": ["day_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_trade",
            "description": "Modifie un trade existant. Ne fournis que les champs a mettre a jour.",
            "parameters": {
                "type": "object",
                "properties": {
                    "trade_id": {
                        "type": "integer",
                        "description": "ID du trade a modifier (requis)",
                    },
                    "strategy": {
                        "type": "string",
                        "enum": ["midnight_model", "london_model", "ny_model"],
                    },
                    "direction": {
                        "type": "string",
                        "enum": ["long", "short"],
                    },
                    "entry_price": {"type": "number"},
                    "stop_loss": {"type": "number"},
                    "take_profit": {"type": "number"},
                    "exit_price": {"type": "number"},
                    "position_size": {"type": "number"},
                    "pnl": {"type": "number", "description": "PnL realise. Calcule automatiquement si entry_price + exit_price + position_size + leverage sont fournis."},
                    "leverage": {"type": "integer", "description": "Levier utilise."},
                    "rr": {"type": "number"},
                    "is_win": {"type": "integer", "enum": [0, 1]},
                    "why_trade": {"type": "string"},
                    "why_entry": {"type": "string"},
                    "why_stop": {"type": "string"},
                    "why_tp": {"type": "string"},
                    "stdv_level": {"type": "number"},
                    "scenario": {"type": "string"},
                    "thesis_validated": {
                        "type": "string",
                        "enum": ["yes", "no", "partial"],
                    },
                    "execution_quality": {"type": "integer"},
                    "lessons_learned": {"type": "string"},
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": ["trade_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_stats",
            "description": "Recupere les statistiques globales de trading avec analyse complete : PnL total, winrate, avg R:R, PnL cumule, drawdown, performance par instrument/setup/session/biais HTF/jour/tags, distribution RR, heatmap d'activite, histogramme des PnL, comparaison de periodes, streaks de jours gagnants/perdants, et insights automatiques. Filtrable par instrument et plage de dates.",
            "parameters": {
                "type": "object",
                "properties": {
                    "instrument": {
                        "type": "string",
                        "enum": ["BTC", "ETH", "NQ", "ES", "ALL"],
                        "description": "Filtrer par instrument (par defaut: tous)",
                    },
                    "from": {
                        "type": "string",
                        "description": "Date debut YYYY-MM-DD",
                    },
                    "to": {
                        "type": "string",
                        "description": "Date fin YYYY-MM-DD",
                    },
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "parse_narration",
            "description": "Analyse un texte narratif de trading et extrait les donnees structurees (pnl, rr, strategie, direction, etc.). Utile pour pre-remplir un trade a partir d'une description en langage naturel.",
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "Description narrative du trade (requis)",
                    },
                },
                "required": ["text"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_trade",
            "description": "Supprime un trade et ses screenshots associes. Action irreversible !",
            "parameters": {
                "type": "object",
                "properties": {
                    "trade_id": {
                        "type": "integer",
                        "description": "ID du trade a supprimer (requis)",
                    },
                },
                "required": ["trade_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_day",
            "description": "Supprime un jour de trading, tous ses trades et ses screenshots associes. Action irreversible !",
            "parameters": {
                "type": "object",
                "properties": {
                    "day_id": {
                        "type": "integer",
                        "description": "ID du jour a supprimer (requis)",
                    },
                },
                "required": ["day_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "analyze_patterns",
            "description": "Analyse les patterns de trading et retourne les insights ML (meilleure strategie, pire session, sweet spot STDV, forces/faiblesses, etc.). Utilisable sans arguments pour tout analyser. Filtrable par instrument et plage de dates.",
            "parameters": {
                "type": "object",
                "properties": {
                    "instrument": {
                        "type": "string",
                        "enum": ["BTC", "ETH", "NQ", "ES", "ALL"],
                        "description": "Filtrer par instrument",
                    },
                    "from": {
                        "type": "string",
                        "description": "Date debut YYYY-MM-DD",
                    },
                    "to": {
                        "type": "string",
                        "description": "Date fin YYYY-MM-DD",
                    },
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_trader_profile",
            "description": "Retourne le profil complet du trader : forces, faiblesses, strategies preferees, instruments preferes, winrate global, PnL total.",
            "parameters": {
                "type": "object",
                "properties": {
                    "instrument": {
                        "type": "string",
                        "enum": ["BTC", "ETH", "NQ", "ES", "ALL"],
                        "description": "Filtrer par instrument",
                    },
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_similar_setups",
            "description": "Trouve des trades similaires a un trade de reference (meme strategie, direction, instrument). Utile pour comparer un trade recent a l'historique et voir si des patterns similaires ont ete gagnants ou perdants.",
            "parameters": {
                "type": "object",
                "properties": {
                    "trade_id": {
                        "type": "integer",
                        "description": "ID du trade de reference (requis)",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Nombre max de resultats (defaut 5)",
                    },
                },
                "required": ["trade_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "attach_screenshot",
            "description": "Attache une image (screenshot) a un trade. L'image doit d'abord etre uploadee via le bouton appareil photo dans le chat, ce qui genere un image_token. Utilise cet outil pour lier l'image a un trade.",
            "parameters": {
                "type": "object",
                "properties": {
                    "trade_id": {
                        "type": "integer",
                        "description": "ID du trade auquel attacher l'image (requis)",
                    },
                    "image_token": {
                        "type": "string",
                        "description": "Token de l'image uploadee (requis — recu automatiquement quand l'utilisateur colle/upload une image)",
                    },
                    "caption": {
                        "type": "string",
                        "description": "Legende optionnelle pour le screenshot",
                    },
                },
                "required": ["trade_id", "image_token"],
            "additionalProperties": False,
            },
        },
    },
]




def _execute_tool(tool_name, arguments):
    """Execute un tool et retourne son resultat."""
    db = get_db()

    if tool_name == "get_days":
        return _tool_get_days(db, arguments)
    elif tool_name == "get_day":
        return _tool_get_day(db, arguments)
    elif tool_name == "create_day":
        return _tool_create_day(db, arguments)
    elif tool_name == "update_day":
        return _tool_update_day(db, arguments)
    elif tool_name == "get_trades":
        return _tool_get_trades(db, arguments)
    elif tool_name == "create_trade":
        return _tool_create_trade(db, arguments)
    elif tool_name == "update_trade":
        return _tool_update_trade(db, arguments)
    elif tool_name == "get_stats":
        return _tool_get_stats(arguments)
    elif tool_name == "parse_narration":
        return _tool_parse_narration(arguments)
    elif tool_name == "delete_trade":
        return _tool_delete_trade(db, arguments)
    elif tool_name == "delete_day":
        return _tool_delete_day(db, arguments)
    elif tool_name == "analyze_patterns":
        return _tool_analyze_patterns(db, arguments)
    elif tool_name == "get_trader_profile":
        return _tool_get_trader_profile(db, arguments)
    elif tool_name == "find_similar_setups":
        return _tool_find_similar_setups(db, arguments)
    elif tool_name == "attach_screenshot":
        return _tool_attach_screenshot(db, arguments)
    else:
        return {"error": f"Tool inconnu: {tool_name}"}


def _tool_get_days(db, args):
    """Liste des jours avec filtres optionnels."""
    q, p = "SELECT * FROM days WHERE 1=1", []
    raw_from = args.get("from")
    raw_to = args.get("to")
    date_from = _validate_date_key(raw_from, "from") if raw_from else None
    date_to = _validate_date_key(raw_to, "to") if raw_to else None

    if args.get("date"):
        q += " AND date=?"
        p.append(args["date"])
    if args.get("instrument"):
        inst = _canonical_instrument(args["instrument"])
        if inst:
            q += " AND instrument=?"
            p.append(inst)
    if args.get("month"):
        q += " AND date LIKE ?"
        p.append(args["month"] + "%")
    if date_from:
        q += " AND date>=?"
        p.append(date_from)
    if date_to:
        q += " AND date<=?"
        p.append(date_to)
    if args.get("q"):
        q += " AND (daily_notes LIKE ? OR htf_context LIKE ?)"
        like = f"%{args['q']}%"
        p.extend([like, like])

    q += " ORDER BY date DESC LIMIT 100"
    rows = db.execute(q, p).fetchall()
    days = []
    for r in rows:
        d = row_to_dict(r)
        d["tags"] = _decode_json(d.get("tags"), [])
        days.append(d)
    return {"days": days, "count": len(days)}


def _tool_get_day(db, args):
    """Un jour specifique avec ses trades."""
    day_id = args.get("day_id")
    date = args.get("date")
    instrument = args.get("instrument")

    if day_id:
        d = fetch_day(day_id)
        if d:
            return {"day": d}
        return {"error": "Jour introuvable", "day": None}

    if date and instrument:
        inst = _canonical_instrument(instrument)
        row = db.execute(
            "SELECT * FROM days WHERE date=? AND instrument=?", (date, inst)
        ).fetchone()
        if row:
            day_id = row["id"]
            d = fetch_day(day_id)
            return {"day": d}
        return {"error": "Jour introuvable pour cette date et cet instrument", "day": None}

    return {"error": "Fournis day_id ou (date + instrument)"}


def _tool_create_day(db, args):
    """Cree un nouveau jour."""
    date_val = args.get("date")
    instrument = _canonical_instrument(args.get("instrument"))

    if not date_val or not instrument:
        return {"error": "date et instrument requis"}

    try:
        date_val = _validate_date_key(date_val, "date")
    except ValueError as exc:
        return {"error": str(exc)}

    if instrument not in INSTRUMENTS:
        return {"error": f"instrument doit etre parmi {INSTRUMENTS}"}

    payload = {
        "date": date_val,
        "instrument": instrument,
        "tags": json.dumps(args.get("tags", []), ensure_ascii=False) if args.get("tags") else None,
        "schema_version": SCHEMA_VERSION,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    for f in ("htf_bias", "session", "htf_context", "daily_notes"):
        if args.get(f) is not None:
            payload[f] = str(args[f])

    cols = _safe_columns(payload.keys(), "days")
    sql = f"INSERT INTO days ({','.join(cols)}) VALUES ({','.join(['?']*len(cols))})"
    try:
        cur = db.execute(sql, [payload[c] for c in cols])
        db.commit()
        d = fetch_day(cur.lastrowid)
        return {"day": d, "created": True}
    except sqlite3.IntegrityError:
        existing = db.execute(
            "SELECT id FROM days WHERE date=? AND instrument=?", (date_val, instrument)
        ).fetchone()
        if existing:
            d = fetch_day(existing[0])
            return {"day": d, "created": False, "warning": "Ce jour existe deja"}
        return {"error": "Erreur d'integrite lors de la creation"}


def _tool_update_day(db, args):
    """Modifie un jour existant."""
    day_id = args.get("day_id")
    if not day_id:
        return {"error": "day_id requis"}

    row = db.execute("SELECT id FROM days WHERE id=?", (day_id,)).fetchone()
    if not row:
        return {"error": "Jour introuvable"}

    updatable = {"htf_bias", "session", "htf_context", "daily_notes"}
    payload = {}
    for f in updatable:
        if f in args and args[f] is not None:
            payload[f] = str(args[f])

    if "tags" in args:
        tags = args["tags"]
        payload["tags"] = json.dumps(tags, ensure_ascii=False) if tags else None

    if args.get("instrument"):
        inst = _canonical_instrument(args["instrument"])
        if inst and inst in INSTRUMENTS:
            payload["instrument"] = inst
    if args.get("date"):
        try:
            new_date = _validate_date_key(args["date"], "date")
            payload["date"] = new_date
        except ValueError as exc:
            return {"error": f"Date invalide: {exc}"}

    if not payload:
        d = fetch_day(day_id)
        return {"day": d, "updated": False, "info": "Aucun champ a modifier"}

    payload["updated_at"] = now_iso()
    cols = _safe_columns(payload.keys(), "days")
    sets = ", ".join(f"{c}=?" for c in cols)
    db.execute(f"UPDATE days SET {sets} WHERE id=?", list(payload.values()) + [day_id])
    db.commit()
    d = fetch_day(day_id)
    return {"day": d, "updated": True}


def _tool_get_trades(db, args):
    """Tous les trades d'un jour."""
    day_id = args.get("day_id")
    if not day_id:
        return {"error": "day_id requis"}

    if not db.execute("SELECT id FROM days WHERE id=?", (day_id,)).fetchone():
        return {"error": "Jour introuvable", "trades": []}

    rows = db.execute("SELECT * FROM trades WHERE day_id=? ORDER BY id", (day_id,)).fetchall()
    trades = []
    for r in rows:
        t = row_to_dict(r)
        t["tags"] = _decode_json(t.get("tags"), [])
        t["custom_blocks"] = _decode_json(t.get("custom_blocks"), [])
        trades.append(t)
    return {"trades": trades, "count": len(trades)}


# Multiplicateurs de contrat par instrument (futures)
# ---------- Tools : creer / modifier trades via chat ----------


def _tool_create_trade(db, args):
    """Cree un nouveau trade."""
    day_id = args.get("day_id")
    if not day_id:
        return {"error": "day_id requis"}

    if not db.execute("SELECT id FROM days WHERE id=?", (day_id,)).fetchone():
        return {"error": "Jour introuvable"}

    # Construire le payload via le normalizer existant
    raw_payload = dict(args)
    # Ne pas passer day_id dans le normalizer, on le set a la main
    raw_payload.pop("day_id", None)
    payload, errors = normalize_trade_payload(raw_payload)
    if errors:
        return {"error": "; ".join(errors)}

    # Validation semantique
    semantic_errors = _validate_trade_semantics(payload)
    if semantic_errors:
        return {"error": "; ".join(semantic_errors)}

    # Auto-calcul du PnL si non fourni mais que les donnees sont la
    _auto_calc_pnl(payload, day_id, db)
    payload.update(evaluate_trade_plan(payload))

    payload.update({
        "day_id": day_id,
        "schema_version": SCHEMA_VERSION,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    })
    cols = _safe_columns(payload.keys(), "trades")
    cur = db.execute(
        f"INSERT INTO trades ({','.join(cols)}) VALUES ({','.join(['?']*len(cols))})",
        [payload[c] for c in cols],
    )
    db.commit()
    trade_id = cur.lastrowid
    t = row_to_dict(db.execute("SELECT * FROM trades WHERE id=?", (trade_id,)).fetchone())
    t["tags"] = _decode_json(t.get("tags"), [])
    t["custom_blocks"] = _decode_json(t.get("custom_blocks"), [])
    t["screenshots"] = []
    return {"trade": t, "created": True}


def _tool_update_trade(db, args):
    """Modifie un trade existant."""
    trade_id = args.get("trade_id")
    if not trade_id:
        return {"error": "trade_id requis"}

    existing = db.execute("SELECT * FROM trades WHERE id=?", (trade_id,)).fetchone()
    if not existing:
        return {"error": "Trade introuvable"}

    raw_payload = dict(args)
    raw_payload.pop("trade_id", None)
    payload, errors = normalize_trade_payload(raw_payload, for_update=True)
    if errors:
        return {"error": "; ".join(errors)}

    # Validation semantique sur le merge
    semantic_payload = row_to_dict(existing)
    semantic_payload.update(payload)
    semantic_errors = _validate_trade_semantics(semantic_payload)
    if semantic_errors:
        return {"error": "; ".join(semantic_errors)}

    _recalc_fields = {"entry_price", "exit_price", "take_profit", "stop_loss",
                      "position_size", "leverage", "direction"}
    if any(f in payload for f in _recalc_fields) and "pnl" not in payload:
        semantic_payload["pnl"] = None
        semantic_payload["is_win"] = None

    _auto_calc_pnl(semantic_payload, existing["day_id"], db)
    semantic_payload.update(evaluate_trade_plan(semantic_payload))

    if not payload:
        t = row_to_dict(existing)
        t["tags"] = _decode_json(t.get("tags"), [])
        t["custom_blocks"] = _decode_json(t.get("custom_blocks"), [])
        return {"trade": t, "updated": False, "info": "Aucun champ a modifier"}

    payload["updated_at"] = now_iso()
    cols = _safe_columns(payload.keys(), "trades")
    sets = ", ".join(f"{c}=?" for c in cols)
    db.execute(f"UPDATE trades SET {sets} WHERE id=?", list(payload.values()) + [trade_id])
    db.commit()
    t = row_to_dict(db.execute("SELECT * FROM trades WHERE id=?", (trade_id,)).fetchone())
    t["tags"] = _decode_json(t.get("tags"), [])
    t["custom_blocks"] = _decode_json(t.get("custom_blocks"), [])
    t["screenshots"] = _fetch_screenshots(trade_id)
    return {"trade": t, "updated": True}


def _tool_get_stats(args):
    """Stats globales avec pipeline complet : breakdowns, drawdown, period compare, insights, histograms, streaks, heatmap."""
    from datetime import datetime as _dt_cls
    db = get_db()

    instrument = _canonical_instrument(args.get("instrument"))
    date_from = args.get("from")
    date_to = args.get("to")

    day_q, day_p = "SELECT * FROM days WHERE 1=1", []
    if instrument and instrument != "ALL":
        day_q += " AND instrument=?"
        day_p.append(instrument)
    if date_from:
        try:
            date_from = _validate_date_key(date_from, "from")
        except ValueError:
            pass
        else:
            day_q += " AND date>=?"
            day_p.append(date_from)
    if date_to:
        try:
            date_to = _validate_date_key(date_to, "to")
        except ValueError:
            pass
        else:
            day_q += " AND date<=?"
            day_p.append(date_to)

    days = [row_to_dict(r) for r in db.execute(day_q, day_p)]
    day_ids = [d["id"] for d in days]
    day_by_id = {d["id"]: d for d in days}

    EMPTY = {
        "total_pnl": 0, "winrate": 0, "wins": 0, "losses": 0,
        "num_entries": 0, "num_trades": 0, "avg_rr": 0,
        "per_instrument": {}, "cumulative": [], "streak": 0, "best_streak": 0,
        "by_setup": {}, "by_session": {}, "by_bias": {}, "by_dow": {}, "by_tag": {},
        "activity": [], "rr_buckets": [0]*6, "insights": [],
        "drawdown": {"series": [], "max_drawdown": 0, "current_drawdown": 0},
        "pnl_histogram": [],
        "period_compare": {
            "label": "Mois courant vs precedent",
            "current": {"from": None, "to": None, "num_trades": 0, "pnl": 0, "wins": 0, "losses": 0, "winrate": 0},
            "previous": {"from": None, "to": None, "num_trades": 0, "pnl": 0, "wins": 0, "losses": 0, "winrate": 0},
            "delta": {"pnl": 0, "winrate": 0, "num_trades": 0},
        },
    }
    if not day_ids:
        return EMPTY

    ph = ",".join("?" * len(day_ids))
    trades = [row_to_dict(r) for r in db.execute(f"SELECT * FROM trades WHERE day_id IN ({ph})", day_ids)]

    # Enrichir chaque trade avec le contexte du jour + derive_trade_metrics
    for t in trades:
        d = day_by_id.get(t["day_id"], {})
        t["_date"]       = d.get("date")
        t["_instrument"] = d.get("instrument")
        t["_session"]    = d.get("session")
        t["_htf_bias"]   = d.get("htf_bias")
        t["tags"] = _decode_json(t.get("tags"), [])
        derived = _derive_trade_metrics(t)
        t["_direction_eff"] = derived["direction"]
        t["_pnl_eff"]       = derived["pnl_effective"]
        t["_pnl_known"]     = derived["pnl_known"]
        t["_is_win_eff"]    = derived["is_win_effective"]
        t["_rr_eff"]        = derived["rr_effective"]

    total_pnl = sum((t.get("_pnl_eff", t.get("pnl")) or 0) for t in trades)
    wins      = [t for t in trades if t.get("_is_win_eff") == 1]
    losses    = [t for t in trades if t.get("_is_win_eff") == 0]
    decided   = len(wins) + len(losses)
    winrate   = (len(wins) / decided * 100) if decided else 0
    rrs       = [t["_rr_eff"] for t in trades if t.get("_rr_eff") is not None]
    avg_rr    = (sum(rrs) / len(rrs)) if rrs else 0

    # Par instrument
    per_instr = {}
    for instr in INSTRUMENTS:
        i_days   = [d for d in days if d["instrument"] == instr]
        i_trades = [t for t in trades if t["_instrument"] == instr]
        if not i_trades and not i_days:
            continue
        i_wins    = sum(1 for t in i_trades if t.get("_is_win_eff") == 1)
        i_losses  = sum(1 for t in i_trades if t.get("_is_win_eff") == 0)
        i_decided = i_wins + i_losses
        i_rrs = [t["_rr_eff"] for t in i_trades if t.get("_rr_eff") is not None]
        per_instr[instr] = {
            "count": len(i_days), "entries": len(i_days), "trades": len(i_trades),
            "pnl": sum((t.get("_pnl_eff", t.get("pnl")) or 0) for t in i_trades),
            "wins": i_wins, "losses": i_losses,
            "winrate": (i_wins / i_decided * 100) if i_decided else 0,
            "avg_rr": (sum(i_rrs) / len(i_rrs)) if i_rrs else 0,
        }

    # Breakdowns
    by_setup   = _bucket(trades, lambda t: t.get("strategy"))
    by_session = _bucket(trades, lambda t: t.get("_session"))
    by_bias    = _bucket(trades, lambda t: t.get("_htf_bias"))
    by_tag     = _bucket_multi(trades, lambda t: t.get("tags"))

    def _dow_key(t):
        try:
            return _dt_cls.strptime(t["_date"], "%Y-%m-%d").weekday()
        except Exception:
            return None
    by_dow = _bucket(trades, _dow_key)

    # PnL cumule
    daily_pnl = {}
    for t in trades:
        if t.get("_date"):
            daily_pnl[t["_date"]] = daily_pnl.get(t["_date"], 0) + (t.get("_pnl_eff", t.get("pnl")) or 0)
    cum, cumulative = 0, []
    for d in sorted(daily_pnl):
        cum += daily_pnl[d]
        cumulative.append({"date": d, "pnl": daily_pnl[d], "cumulative": cum})

    # Heatmap d'activite
    activity = {}
    for d in days:
        a = activity.setdefault(d["date"], {"date": d["date"], "entries": 0, "pnl": 0, "wins": 0, "losses": 0})
        a["entries"] += 1
    for t in trades:
        key = t.get("_date")
        if key and key in activity:
            activity[key]["pnl"] += (t.get("_pnl_eff", t.get("pnl")) or 0)
            if t.get("_is_win_eff") == 1:
                activity[key]["wins"] += 1
            elif t.get("_is_win_eff") == 0:
                activity[key]["losses"] += 1

    # Distribution RR
    rr_buckets = [0]*6
    for v in rrs:
        if   v < 0:   rr_buckets[0] += 1
        elif v < 1:   rr_buckets[1] += 1
        elif v < 2:   rr_buckets[2] += 1
        elif v < 3:   rr_buckets[3] += 1
        elif v < 5:   rr_buckets[4] += 1
        else:         rr_buckets[5] += 1

    streak     = _streak_stats(days)
    insights   = _build_insights(trades, by_setup, by_session, by_bias, winrate, decided)
    drawdown   = _compute_drawdown_series(cumulative)
    pnl_histogram = _build_pnl_histogram([
        t.get("_pnl_eff", t.get("pnl"))
        for t in trades
        if t.get("_pnl_known") or t.get("pnl") is not None
    ])
    period_compare = _build_period_comparison(days, trades)

    return {
        "total_pnl": total_pnl, "winrate": winrate,
        "wins": len(wins), "losses": len(losses),
        "num_entries": len(days), "num_trades": len(trades), "avg_rr": avg_rr,
        "per_instrument": per_instr, "cumulative": cumulative,
        "streak": streak["current"], "best_streak": streak["best"],
        "by_setup": by_setup, "by_session": by_session,
        "by_bias": by_bias, "by_dow": by_dow, "by_tag": by_tag,
        "activity": sorted(activity.values(), key=lambda x: x["date"]),
        "rr_buckets": rr_buckets, "insights": insights,
        "drawdown": drawdown,
        "pnl_histogram": pnl_histogram,
        "period_compare": period_compare,
    }


def _tool_parse_narration(args):
    """Analyse un texte narratif avec le parseur existant."""
    text = (args.get("text") or "").strip()
    if not text:
        return {"error": "text requis"}

    # Delegue au parseur regex existant
    result = parse_trade_text(text)
    result = _post_process_parse_result(result, text)
    return {"parsed": result}


def _tool_delete_trade(db, args):
    """Supprime un trade et ses screenshots associes."""
    trade_id = args.get("trade_id")
    if not trade_id:
        return {"error": "trade_id requis"}

    existing = db.execute("SELECT id FROM trades WHERE id=?", (trade_id,)).fetchone()
    if not existing:
        return {"error": "Trade introuvable"}

    shots = db.execute(
        "SELECT filename FROM trade_screenshots WHERE trade_id=?", (trade_id,)
    ).fetchall()
    for s in shots:
        try:
            (SCREENSHOTS_DIR / s["filename"]).unlink(missing_ok=True)
        except Exception:
            pass
    db.execute("DELETE FROM trades WHERE id=?", (trade_id,))
    db.commit()
    return {"ok": True, "message": f"Trade #{trade_id} supprime avec ses screenshots"}


def _tool_delete_day(db, args):
    """Supprime un jour de trading, tous ses trades et ses screenshots."""
    day_id = args.get("day_id")
    if not day_id:
        return {"error": "day_id requis"}

    existing = db.execute("SELECT id FROM days WHERE id=?", (day_id,)).fetchone()
    if not existing:
        return {"error": "Jour introuvable"}

    shots = db.execute(
        """
        SELECT ts.filename FROM trade_screenshots ts
        JOIN trades t ON t.id = ts.trade_id
        WHERE t.day_id=?
    """,
        (day_id,),
    ).fetchall()
    for s in shots:
        try:
            (SCREENSHOTS_DIR / s["filename"]).unlink(missing_ok=True)
        except Exception:
            pass
    db.execute("DELETE FROM days WHERE id=?", (day_id,))
    db.commit()
    return {"ok": True, "message": f"Day #{day_id} supprime avec ses trades et screenshots"}


# =========================================================================
# ML TOOLS (pont vers 20_ml_engine.py)
# =========================================================================


def _tool_analyze_patterns(db, args):
    """Analyse les patterns de trading et retourne les insights ML."""
    instrument = _canonical_instrument(args.get("instrument"))
    date_from = args.get("from")
    date_to = args.get("to")
    try:
        cards = analyze_patterns(db, instrument, date_from, date_to)
        return {"patterns": cards, "count": len(cards)}
    except Exception as exc:
        return {"error": f"Erreur d'analyse ML: {exc}", "patterns": [], "count": 0}


def _tool_get_trader_profile(db, args):
    """Profil du trader : forces, faiblesses, preferences."""
    instrument = _canonical_instrument(args.get("instrument"))
    try:
        profile = build_trader_profile(db, instrument)
        return profile
    except Exception as exc:
        return {"error": f"Erreur de profil ML: {exc}"}


def _tool_find_similar_setups(db, args):
    """Trouve des trades similaires a un trade de reference."""
    trade_id = args.get("trade_id")
    limit = args.get("limit", 5)
    if not trade_id:
        return {"error": "trade_id requis", "similar_trades": []}
    try:
        result = find_similar_setups(db, trade_id, limit)
        return result
    except Exception as exc:
        return {"error": f"Erreur de similarite ML: {exc}", "similar_trades": []}


def _tool_attach_screenshot(db, args):
    """Attache une image uploadee (via image_token) a un trade."""
    trade_id = args.get("trade_id")
    image_token = args.get("image_token")
    caption = args.get("caption", "")

    if not trade_id or not image_token:
        return {"error": "trade_id et image_token requis"}

    # Verifier que le trade existe
    trade = db.execute("SELECT id FROM trades WHERE id=?", (trade_id,)).fetchone()
    if not trade:
        return {"error": f"Trade #{trade_id} introuvable"}

    # Recuperer l'image pending
    pending = _PENDING_IMAGES.get(image_token)
    if not pending:
        return {"error": "Image introuvable ou expiree. Re-uploade l'image."}

    src_path = pending["path"]
    if not src_path.exists():
        return {"error": "Fichier image introuvable sur le disque"}

    # Valider et copier vers SCREENSHOTS_DIR
    ext = src_path.suffix.lstrip(".") or "png"
    import uuid as _uuid2
    fname = f"{_uuid2.uuid4().hex}.{ext}"
    dest = SCREENSHOTS_DIR / fname
    try:
        import shutil as _shutil
        # Verifier que c'est bien une image valide
        with open(src_path, "rb") as _f:
            head = _f.read(32)
        sniffed = None
        if head.startswith(b"\x89PNG\r\n\x1a\n"):
            sniffed = "png"
        elif head.startswith(b"\xff\xd8\xff"):
            sniffed = "jpg"
        if not sniffed:
            return {"error": "Fichier non valide comme image"}
        _shutil.copy2(str(src_path), str(dest))
    except Exception as exc:
        return {"error": f"Erreur lors de la sauvegarde de l'image: {exc}"}

    # Enregistrer en DB
    cur = db.execute(
        "INSERT INTO trade_screenshots (trade_id, filename, caption, created_at) VALUES (?,?,?,?)",
        (trade_id, fname, caption, now_iso()),
    )
    db.commit()

    # Nettoyer le pending
    try:
        src_path.unlink(missing_ok=True)
    except Exception:
        pass
    del _PENDING_IMAGES[image_token]

    return {
        "ok": True,
        "screenshot_id": cur.lastrowid,
        "filename": fname,
        "message": f"Screenshot attache au trade #{trade_id}.",
    }


# =========================================================================
# APPEL DEEPSEEK API
# =========================================================================


def _deepseek_chat(messages, tools, api_key):
    """Appelle l'API DeepSeek avec tool calling support.

    Retourne le corps de la reponse complete (dict).
    Leve RuntimeError en cas d'erreur.
    """
    body = {
        "model": DEEPSEEK_MODEL,
        "messages": messages,
        "tools": tools,
        "tool_choice": "auto",
        "max_tokens": 4096,
    }

    payload = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        DEEPSEEK_API_URL,
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        status = exc.code
        detail = ""
        try:
            detail = exc.read().decode("utf-8", errors="replace")[:300]
        except Exception:
            pass
        raise RuntimeError(f"DeepSeek API HTTP {status}: {detail or exc.reason}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"DeepSeek API reseau: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"DeepSeek API reponse JSON invalide: {exc}") from exc


def _deepseek_tool_loop(messages, api_key, db=None, pending_image_token=None):
    """Effectue l'appel DeepSeek avec boucle de tool calling.

    retourne (reponse_text, nb_tool_calls).
    """
    # Injecter la date du jour dans le system prompt
    from datetime import date as _dt, timedelta as _td
    _today = _dt.today()
    _yesterday = _today - _td(days=1)
    _days_fr = {0:"Lundi",1:"Mardi",2:"Mercredi",3:"Jeudi",4:"Vendredi",5:"Samedi",6:"Dimanche"}

    _date_context = (
        f"\n\nCONTEXTE TEMPOREL (date actuelle) :\n"
        f"- Aujourd'hui : {_today.isoformat()} ({_days_fr[_today.weekday()]})\n"
        f"- Hier : {_yesterday.isoformat()} ({_days_fr[_yesterday.weekday()]})\n"
    )

    # Ajouter le contexte image si une image pending est disponible
    _image_context = ""
    if pending_image_token:
        if pending_image_token in _PENDING_IMAGES:
            _image_context = (
                f"\n\nIMAGE PENDING :\n"
                f"L'utilisateur a uploade une image (token: {pending_image_token}).\n"
                f"Utilise l'outil attach_screenshot avec image_token=\"{pending_image_token}\" "
                f"pour l'attacher a un trade, quand l'utilisateur t'indique quel trade concerne cette image.\n"
            )
        else:
            _image_context = (
                f"\n\nIMAGE PENDING (EXPIREE) :\n"
                f"L'utilisateur a uploade une image mais le token {pending_image_token} n'est plus valide "
                f"(expire apres 10 minutes). Dis-lui de re-uplader l'image.\n"
            )

    # Ajouter les jours recents de la DB si disponible
    if db is not None:
        try:
            _recent_days = db.execute("""
                SELECT date, instrument, 
                       (SELECT COUNT(*) FROM trades WHERE day_id=days.id) as trade_count
                FROM days 
                WHERE date IN (?, ?)
                ORDER BY date DESC
            """, (_today.isoformat(), _yesterday.isoformat())).fetchall()
            if _recent_days:
                _date_context += "\nJours de trading recents dans la DB :\n"
                for r in _recent_days:
                    _tc = r["trade_count"]
                    _date_context += f"- {r['date']} ({r['instrument']}, {_tc} trade{'s' if _tc>1 else ''})\n"
        except Exception:
            pass  # silencieux si erreur DB

    # Injecter le system prompt au debut si absent
    combined_context = _date_context + _image_context
    if not messages or messages[0].get("role") != "system":
        messages = [{"role": "system", "content": _AI_SYSTEM_PROMPT + combined_context}] + messages
    else:
        # System prompt deja present — on ajoute le contexte dedans
        messages[0]["content"] = messages[0]["content"] + combined_context

    tools = _AI_TOOLS
    max_iterations = 10
    total_calls = 0

    for iteration in range(max_iterations):
        response = _deepseek_chat(messages, tools, api_key)
        choice = response["choices"][0]
        msg = choice["message"]

        if msg.get("content") is None:
            msg["content"] = ""

        messages.append(msg)

        if not msg.get("tool_calls"):
            # Reponse finale (textuelle)
            return msg["content"], total_calls

        # Executer les appels d'outils
        for tc in msg["tool_calls"]:
            total_calls += 1
            tool_name = tc["function"]["name"]
            try:
                arguments = json.loads(tc["function"]["arguments"])
            except json.JSONDecodeError:
                arguments = {}

            log.info("AI tool call #%s: %s(%s)", tc["id"][:12], tool_name, json.dumps(arguments)[:200])

            try:
                result = _execute_tool(tool_name, arguments)
            except Exception as exc:
                log.error("AI tool %s error: %s", tool_name, exc)
                result = {"error": f"Erreur lors de l'execution de {tool_name}: {exc}"}

            messages.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": json.dumps(result, ensure_ascii=False, default=str),
            })

    # Si on atteint la limite d'iterations
    return "Je n'ai pas pu terminer le traitement dans le temps imparti. Reformule ta demande ou fais-la en plusieurs etapes.", total_calls


# =========================================================================
# ROUTE FLASK
# =========================================================================


# ---------- Endpoint d'upload d'image pour le chat ----------

import shutil as _shutil_upload

@app.post("/api/ai/chat/upload-image")
@ratelimit(max_per_minute=30)
def ai_chat_upload_image():
    """Upload temporaire d'une image depuis le chat.

    Accepte multipart/form-data avec un champ 'file'.
    Retourne un image_token a utiliser avec l'outil attach_screenshot.
    Le fichier est conserve 10 minutes dans data/_pending/.
    """
    if "file" not in request.files:
        return jsonify({"error": "Fichier requis (champ 'file')"}), 400
    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "Fichier sans nom"}), 400

    try:
        token = _save_pending_image(file)
        return jsonify({
            "ok": True,
            "image_token": token,
            "message": "Image uploadee. Dis a l'assistant de l'attacher a un trade.",
        })
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        log.error("Upload image chat error: %s", exc)
        return jsonify({"error": f"Erreur lors de l'upload: {exc}"}), 500


@app.route("/api/ai/chat", methods=["GET", "OPTIONS"])
def ai_chat_options():
    """Pre-flight CORS et doc."""
    if request.method == "OPTIONS":
        return jsonify({"ok": True})
    # GET = description de l'endpoint
    return jsonify({
        "endpoint": "/api/ai/chat",
        "method": "POST",
        "description": "Chat conversationnel avec DeepSeek v4 Flash. Envoie un historique de messages + option reset.",
        "body_schema": {
            "messages": [
                {"role": "user", "content": "ta question ici..."},
            ],
            "reset": False,
            "pending_image_token": "token_recu_apres_upload_image",
        },
        "tools_disponibles": [t["function"]["name"] for t in _AI_TOOLS],
        "note": "L'historique est gere cote client. Envoie toute la conversation a chaque requete.",
        "provider": "DeepSeek",
        "model": DEEPSEEK_MODEL,
    })


@app.post("/api/ai/chat")
@ratelimit(max_per_minute=20)
def ai_chat():
    """POST /api/ai/chat — Point d'entree du chatbot IA.

    Body JSON:
    {
        "messages": [
            {"role": "user", "content": "Bonjour, montre-moi mes trades BTC..."},
            ...
        ],
        "reset": false   // optionnel, efface le cache si true
    }

    Retourne:
    {
        "response": "Voici vos trades...",
        "tool_calls_count": 2,
        "model": "deepseek-v4-flash",
        "source": "deepseek"
    }
    """
    data = request.get_json(force=True) or {}

    # Extraire l'image_token pending si present
    pending_token = data.get("pending_image_token") or None

    # Option reset cache
    if data.get("reset"):
        _AI_CHAT_CACHE.clear()
        return jsonify({"response": "Conversation reinitialisee.", "tool_calls_count": 0, "model": DEEPSEEK_MODEL})

    messages = data.get("messages")
    if not messages or not isinstance(messages, list):
        return jsonify({"error": "messages requis (liste d'objets avec role/content)"}), 400

    # Valider que tous les messages ont role + content
    for i, m in enumerate(messages):
        if not isinstance(m, dict) or "role" not in m:
            return jsonify({"error": f"Message #{i}: objet avec 'role' requis"}), 400
        if m["role"] not in ("user", "assistant", "system", "tool"):
            return jsonify({"error": f"Message #{i}: role invalide '{m['role']}'"}), 400

    # Lire la cle API
    api_key = (os.environ.get("DEEPSEEK_API_KEY") or "").strip()
    if not api_key:
        return jsonify({
            "response": (
                "La cle API DeepSeek n'est pas configuree.\n\n"
                "Ajoute la ligne suivante dans ton fichier .env (a la racine du projet) :\n"
                "DEEPSEEK_API_KEY=sk-votre-cle-ici\n\n"
                "Tu peux aussi la definir comme variable d'environnement."
            ),
            "needs_api_key": True,
            "tool_calls_count": 0,
            "model": DEEPSEEK_MODEL,
        })

    # Verifier le circuit breaker
    if not _ai_circuit_allowed():
        return jsonify({
            "response": (
                "L'API DeepSeek est temporairement indisponible (trop d'erreurs consecutivees). "
                "Reessaye dans une minute."
            ),
            "circuit_open": True,
            "tool_calls_count": 0,
            "model": DEEPSEEK_MODEL,
        })

    # Verifier le cache
    messages_json_str = json.dumps(messages, ensure_ascii=False, sort_keys=True)
    cached = _ai_cache_get(messages_json_str)
    if cached:
        log.info("AI chat cache HIT (%s messages)", len(messages))
        return jsonify(cached)

    try:
        # Initialiser la DB pour le tool loop
        db = get_db()
        response_text, tool_count = _deepseek_tool_loop(messages, api_key, db=db, pending_image_token=pending_token)
        _ai_circuit_success()
    except RuntimeError as exc:
        _ai_circuit_failure()
        log.error("DeepSeek API error: %s", exc)
        return jsonify({
            "response": f"Erreur API DeepSeek : {exc}",
            "error": str(exc),
            "tool_calls_count": 0,
            "model": DEEPSEEK_MODEL,
        })
    except Exception as exc:
        _ai_circuit_failure()
        log.error("AI chat error: %s", exc, exc_info=True)
        return jsonify({
            "response": f"Erreur interne : {exc}",
            "error": str(exc),
            "tool_calls_count": 0,
            "model": DEEPSEEK_MODEL,
        })

    result = {
        "response": response_text,
        "tool_calls_count": tool_count,
        "model": DEEPSEEK_MODEL,
        "source": "deepseek",
    }

    # Mettre en cache seulement si pas d'appels d'outils (les resultats sont varies)
    if tool_count == 0:
        _ai_cache_put(messages_json_str, result)

    return jsonify(result)


@app.post("/api/ai/ping")
def ai_ping():
    """POST /api/ai/ping — Verifie que la cle API DeepSeek est valide.

    Fait un appel probe minimal (1 token) pour tester la connectivite.
    Retourne 200 si OK, 4xx si cle invalide, 503 si indisponible.
    """
    api_key = (os.environ.get("DEEPSEEK_API_KEY") or "").strip()
    if not api_key:
        return jsonify({"ok": False, "status": "no_key", "message": "Aucune cle API configuree."}), 200

    import urllib.request as _ur
    import json as _json

    body = {
        "model": DEEPSEEK_MODEL,
        "messages": [{"role": "user", "content": "Ping"}],
        "max_tokens": 1,
    }
    payload = _json.dumps(body).encode("utf-8")
    try:
        req = _ur.Request(
            DEEPSEEK_API_URL,
            data=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with _ur.urlopen(req, timeout=15) as resp:
            resp_data = _json.loads(resp.read())
            return jsonify({
                "ok": True,
                "status": "valid",
                "message": "Cle API valide (DeepSeek repond).",
                "model": resp_data.get("model", DEEPSEEK_MODEL),
            })
    except urllib.error.HTTPError as exc:
        status = exc.code
        detail = ""
        try:
            detail = exc.read().decode("utf-8", errors="replace")[:200]
        except Exception:
            pass
        return jsonify({
            "ok": False,
            "status": "invalid",
            "message": f"Cle API rejetee (HTTP {status}).",
            "detail": detail,
        })
    except urllib.error.URLError as exc:
        return jsonify({
            "ok": False,
            "status": "unreachable",
            "message": f"Impossible de joindre DeepSeek : {exc.reason}",
        })
    except Exception as exc:
        return jsonify({
            "ok": False,
            "status": "error",
            "message": f"Erreur de connexion : {exc}",
        })
