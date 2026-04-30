# ---------- Trade parser ----------

def _norm(text):
    """Normalize accents and lowercase text for keyword matching."""
    return "".join(
        c for c in unicodedata.normalize("NFD", str(text or "").lower())
        if unicodedata.category(c) != "Mn"
    )


def _contains_any(normalized_text, keywords):
    return any(_norm(kw) in normalized_text for kw in keywords)


def _dedupe_keep_order(values):
    seen = set()
    out = []
    for value in values:
        key = str(value).strip()
        if not key:
            continue
        if key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


def _as_float_or_none(value):
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        return None


def _coerce_is_win(value):
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, int) and value in (0, 1):
        return value
    raw = _norm(value)
    if raw in {"1", "win", "gain", "profit"}:
        return 1
    if raw in {"0", "loss", "perte"}:
        return 0
    return None


def _kw_match(text, kwmap):
    normalized = _norm(text)
    best_key, best_len = None, 0
    for value, kws in kwmap.items():
        for kw in kws:
            key_norm = _norm(kw)
            if key_norm in normalized and len(kw) > best_len:
                best_key, best_len = value, len(kw)
    return best_key


_STRATEGY_KW = {
    "midnight_model": ["midnight model", "model midnight", "midnight setup", "midnight", "po3", "power of three"],
    "london_model": ["london model", "model london", "london setup", "setup london", "london"],
    "ny_model": ["ny model", "new york model", "model ny", "new york setup", "new york"],
}
_DIRECTION_KW = {
    "long": ["long", "achat", "buy", "a l achat", "a l'achat"],
    "short": ["short", "vente", "sell", "a la vente"],
}
_SESSION_KW = {
    "asia": ["session asie", "session asia", "asia", "asie", "tokyo"],
    "london": ["session london", "london", "lse", "europe"],
    "ny_am": ["ny am", "new york am", "nyam", "new york open", "nyo"],
    "ny_pm": ["ny pm", "new york pm", "nypm"],
}
_BIAS_KW = {
    "bullish": ["bullish", "haussier", "a la hausse", "long bias", "bull"],
    "bearish": ["bearish", "baissier", "a la baisse", "short bias", "bear"],
    "neutral": ["neutral", "neutre", "mixte", "sans biais"],
}
_EMO_KW = {
    "calm": ["calm", "calme", "serein", "tranquille", "detendu", "zen"],
    "focused": ["focused", "focus", "concentre", "dans la zone", "in the zone"],
    "anxious": ["anxious", "anxieux", "stresse", "nerveux"],
    "fomo": ["fomo", "peur de rater", "peur de manquer"],
    "revenge": ["revenge", "revanche", "tilt", "en tilt", "tilte"],
    "overconfident": ["overconfident", "trop confiant", "arrogant"],
}
_THESIS_KW = {
    "yes": ["these validee", "these valide", "thesis validated", "comme prevu", "these ok", "scenario valide", "scenario validee", "scenario produit"],
    "no": ["these invalidee", "these invalide", "thesis invalid", "hors these", "pas comme prevu", "these ko"],
    "partial": ["partiellement", "partielle", "en partie", "partial"],
}
_WIN_KW = {
    1: ["win", "gagne", "profitable", "en profit", "positif", "dans le vert", "tp touche", "tp atteint"],
    0: ["loss", "perdu", "en perte", "negatif", "dans le rouge", "stop touche", "stop atteint"],
}

_MIDNIGHT_CONTEXT_KW = [
    "midnight",
    "po3",
    "power of three",
    "stdv",
    "ifvg",
    "breaker",
    "order block",
    "ote",
    "smt",
]

_MIDNIGHT_LONG_HINTS = [
    "achat",
    "buy",
    "long",
    "liquidite au dessus",
    "distribution a la hausse",
    "se retourner",
    "retournement haussier",
    "local bottom",
    "daily low",
]

_MIDNIGHT_SHORT_HINTS = [
    "vente",
    "sell",
    "short",
    "liquidite en dessous",
    "distribution a la baisse",
    "retournement baissier",
    "daily high",
]

_MIDNIGHT_AUTO_TAGS = {
    "price_up_pre_open": "pre_open_up",
    "previous_day_drop": "prev_day_drop",
    "htf_bear_trend": "htf_bearish",
    "daily_ob_bullish": "daily_ob_bullish",
    "ote_zone": "ote",
    "po3": "po3",
    "open_drop": "open_drop",
    "open_rise": "open_rise",
    "seek_low_then_reverse": "seek_low_reverse",
    "draw_stdv_on_open_leg": "stdv_open_leg",
    "ifvg": "ifvg",
    "breaker": "breaker",
    "premium_discount_rule": "premium_discount_rule",
    "fvg_15m": "fvg_15m",
    "smt": "smt",
    "liquidity_above": "liquidity_above",
    "liquidity_below": "liquidity_below",
}


def _extract_stdv_level(text):
    lower = str(text or "").lower()
    patterns = [
        r"\bstdv\s*[:\-=]?\s*([1-5](?:[.,]5)?)\b",
        r"\b([1-5](?:[.,]5)?)\s*(?:sigma|σ)\b",
        r"(?:target|cible|viser?|vise|touch(?:e|er)?)\s*(?:le|la|les)?\s*([1-5](?:[.,]5)?)\s*(?:du|de|sur)?\s*stdv\b",
        r"\bniveau(?:\s+des?)?\s*([1-5](?:[.,]5)?)\s*(?:du|de)?\s*stdv\b",
    ]
    for pattern in patterns:
        match = _re.search(pattern, lower)
        if not match:
            continue
        value = _as_float_or_none(match.group(1))
        if value is None:
            continue
        half_steps = abs(value * 2 - round(value * 2)) < 1e-9
        if 1 <= value <= 5 and half_steps:
            return value
    return None


def _extract_midnight_signals(text, result):
    normalized = _norm(text)
    stdv_hint = result.get("stdv_level")
    if stdv_hint is None:
        stdv_hint = _extract_stdv_level(text)

    open_related = _contains_any(normalized, ["a l open", "avant l open", "pre open", "open"])
    context_related = _contains_any(normalized, _MIDNIGHT_CONTEXT_KW)
    is_midnight_context = bool(result.get("strategy") == "midnight_model" or (open_related and context_related))

    signals = {
        "is_midnight_context": is_midnight_context,
        "price_up_pre_open": _contains_any(normalized, ["prix a monte avant l open", "monte avant l open", "hausse avant l open", "pre open haussier"]),
        "previous_day_drop": _contains_any(normalized, ["veille on a fortement drop", "la veille on a fortement drop", "fort drop", "grosse baisse la veille"]),
        "htf_bear_trend": _contains_any(normalized, ["tendance baissiere htf", "htf baissier", "biais htf baissier"]),
        "daily_ob_bullish": _contains_any(normalized, ["bullish order block daily", "order block daily bullish", "ob bullish daily", "ob daily bullish"]),
        "ote_zone": _contains_any(normalized, ["ote"]),
        "po3": _contains_any(normalized, ["po3", "power of three"]),
        "open_drop": _contains_any(normalized, ["a l open le prix descend", "prix descend a l open", "open baisse", "open baissier"]),
        "open_rise": _contains_any(normalized, ["a l open le prix monte", "prix monte a l open", "open hausse", "open haussier"]),
        "seek_low_then_reverse": _contains_any(normalized, ["chercher le plus bas", "seek low", "local bottom", "daily low", "se retourner", "retournee"]),
        "draw_stdv_on_open_leg": _contains_any(normalized, ["trace le stdv", "tracer le stdv", "stdv sur le mouvement baissier de l open", "mouvement baissier de l open", "high/low"]),
        "stdv_level_hint": stdv_hint,
        "ifvg": _contains_any(normalized, ["ifvg"]),
        "breaker": _contains_any(normalized, ["breaker block", "breaker"]),
        "premium_discount_rule": _contains_any(normalized, ["premium", "discount", "au dessus de 50", "en dessous de 50", "50%"]),
        "fvg_15m": _contains_any(normalized, ["fvg en 15", "15min", "15 min", "m15", "15m"]),
        "smt": _contains_any(normalized, ["smt"]),
        "liquidity_above": _contains_any(normalized, ["liquidite au dessus", "liquidity above", "target une liquidite au dessus", "vise la liquidite au dessus"]),
        "liquidity_below": _contains_any(normalized, ["liquidite en dessous", "liquidity below", "target une liquidite en dessous", "vise la liquidite en dessous"]),
        "mentions_entry": _contains_any(normalized, ["entree", "setup d entree", "setup entree", "ifvg", "breaker"]),
        "mentions_stop": _contains_any(normalized, ["stop", "invalidation"]),
        "mentions_target": _contains_any(normalized, ["target", "objectif", "liquidite", "take profit", "tp"]),
        "mentions_result": _contains_any(normalized, ["pnl", "rr", "gain", "perte", "win", "loss", "tp touche", "stop touche"]),
    }
    signals["has_entry_trigger"] = bool(signals["ifvg"] or signals["breaker"])
    return signals


def _infer_direction_from_midnight_cues(text, signals):
    normalized = _norm(text)
    long_score = 0
    short_score = 0

    if _contains_any(normalized, _MIDNIGHT_LONG_HINTS):
        long_score += 2
    if _contains_any(normalized, _MIDNIGHT_SHORT_HINTS):
        short_score += 2

    if signals.get("liquidity_above"):
        long_score += 2
    if signals.get("liquidity_below"):
        short_score += 2

    if signals.get("open_drop") and signals.get("seek_low_then_reverse"):
        long_score += 2
    if signals.get("open_rise") and signals.get("seek_low_then_reverse"):
        short_score += 1

    if long_score > short_score:
        return "long"
    if short_score > long_score:
        return "short"
    return None


def _merge_tags(result, signals):
    existing = result.get("tags") or []
    if not isinstance(existing, list):
        existing = [str(existing)]
    auto_tags = []
    for signal_name, tag_name in _MIDNIGHT_AUTO_TAGS.items():
        if signals.get(signal_name):
            auto_tags.append(tag_name)
    stdv_level = result.get("stdv_level")
    if stdv_level is not None:
        auto_tags.append(f"stdv_{str(stdv_level).replace('.', '_')}")
    merged = _dedupe_keep_order([*existing, *auto_tags])
    if merged:
        result["tags"] = merged


def _build_midnight_narrative_fields(result, signals):
    direction = result.get("direction")

    if not result.get("scenario"):
        parts = []
        if signals.get("price_up_pre_open"):
            parts.append("Prix en hausse avant l'open.")
        if signals.get("previous_day_drop") or signals.get("htf_bear_trend"):
            parts.append("La veille a fortement baisse avec un contexte HTF baissier.")
        if signals.get("daily_ob_bullish") and signals.get("ote_zone"):
            parts.append("Le prix a touche un OB daily bullish en zone OTE.")
        if signals.get("po3"):
            parts.append("Scenario PO3 attendu: sweep du low a l'open puis reversal.")
        if signals.get("open_drop"):
            parts.append("A l'open le prix descend, on cherche la formation du low de la journee.")
        if signals.get("liquidity_above"):
            parts.append("Objectif final: liquidite situee au-dessus.")
        if signals.get("liquidity_below"):
            parts.append("Objectif final: liquidite situee en dessous.")
        if parts:
            result["scenario"] = " ".join(parts)

    if not result.get("why_trade"):
        lines = []
        if signals.get("daily_ob_bullish"):
            lines.append("Confluence HTF: reaction sur OB daily bullish")
        if signals.get("ote_zone"):
            lines.append("positionne en zone OTE")
        if signals.get("po3"):
            lines.append("avec schema PO3 a l'open")
        if lines:
            result["why_trade"] = ", ".join(lines) + "."

    if not result.get("why_entry"):
        trigger_bits = []
        if signals.get("draw_stdv_on_open_leg"):
            trigger_bits.append("trace STDV sur la jambe d'open")
        if result.get("stdv_level") is not None:
            trigger_bits.append(f"attente du niveau {result['stdv_level']} STDV")
        if signals.get("ifvg"):
            trigger_bits.append("trigger IFVG")
        if signals.get("breaker"):
            trigger_bits.append("trigger breaker block")
        if signals.get("fvg_15m"):
            trigger_bits.append("confluence FVG 15m")
        if signals.get("premium_discount_rule"):
            if direction == "short":
                trigger_bits.append("zone Premium obligatoire pour vendre")
            elif direction == "long":
                trigger_bits.append("zone Discount obligatoire pour acheter")
            else:
                trigger_bits.append("regle Premium/Discount respectee")
        if signals.get("smt"):
            trigger_bits.append("SMT validee autour du contact STDV")
        if trigger_bits:
            result["why_entry"] = ", ".join(trigger_bits) + "."

    if not result.get("why_stop"):
        if direction == "long":
            result["why_stop"] = "Stop sous le low de validation (sweep/open low) pour invalider le PO3 haussier."
        elif direction == "short":
            result["why_stop"] = "Stop au-dessus du high de validation pour invalider le PO3 baissier."

    if not result.get("why_tp"):
        if signals.get("liquidity_above"):
            result["why_tp"] = "TP sur la liquidite au-dessus du niveau d'entree."
        elif signals.get("liquidity_below"):
            result["why_tp"] = "TP sur la liquidite en dessous du niveau d'entree."
        elif result.get("stdv_level") is not None:
            result["why_tp"] = f"TP autour des pools de liquidite proches du niveau {result['stdv_level']} STDV."


def _build_follow_up_questions(result, signals):
    missing = []
    questions = []

    def ask(field, question):
        missing.append(field)
        questions.append({"field": field, "question": question})

    if not result.get("direction"):
        ask("direction", "Challenge rapide 1/10: direction finale long ou short ?")
    if result.get("stdv_level") is None:
        ask("stdv_level", "Challenge rapide 5/10: quel niveau STDV a ete touche (1 a 5 par pas de 0.5) ?")
    if not signals.get("has_entry_trigger"):
        ask("entry_trigger", "Challenge rapide 6/10: trigger au contact du STDV (IFVG, breaker, ou les deux) ?")
    if not signals.get("premium_discount_rule"):
        ask("premium_discount_rule", "Challenge rapide 7/10: zone conforme a la regle 50% (short=Premium / long=Discount) ?")
    if not signals.get("smt"):
        ask("smt", "Challenge rapide 8/10: SMT de confirmation au contact STDV (ou juste avant/apres) ?")
    if not result.get("why_stop"):
        ask("why_stop", "Challenge stop: ou places-tu l'invalidation du setup Midnight ?")
    if not result.get("why_tp"):
        ask("why_tp", "Challenge 9/10: quelle liquidite precise vises-tu pour le take-profit ?")

    if signals.get("mentions_entry") and result.get("entry_price") is None:
        ask("entry_price", "Challenge execution: quel est ton prix d'entree ?")
    if (signals.get("mentions_stop") or result.get("entry_price") is not None) and result.get("stop_loss") is None:
        ask("stop_loss", "Challenge execution: quel est ton stop loss chiffre ?")
    if signals.get("mentions_target") and result.get("take_profit") is None:
        ask("take_profit", "Challenge execution: quel est ton take-profit chiffre ?")

    if signals.get("mentions_result") or any(result.get(k) is not None for k in ("pnl", "rr", "is_win")):
        if result.get("pnl") is None:
            ask("pnl", "Challenge resultat: quel est le PnL final ?")
        if result.get("rr") is None:
            ask("rr", "Challenge resultat: quel est le R:R final (ou vise) ?")
        if result.get("is_win") is None:
            ask("is_win", "Challenge resultat: ce trade est WIN (1) ou LOSS (0) ?")

    return missing, questions


def _post_process_parse_result(result, text):
    parsed = dict(result or {})
    parsed["is_win"] = _coerce_is_win(parsed.get("is_win"))

    for field in ("pnl", "rr", "entry_price", "stop_loss", "take_profit", "exit_price", "position_size"):
        if field in parsed:
            parsed[field] = _as_float_or_none(parsed.get(field))
            if parsed[field] is None:
                parsed.pop(field, None)

    stdv = _as_float_or_none(parsed.get("stdv_level"))
    if stdv is not None:
        half_steps = abs(stdv * 2 - round(stdv * 2)) < 1e-9
        if 1 <= stdv <= 5 and half_steps:
            parsed["stdv_level"] = stdv
        else:
            parsed.pop("stdv_level", None)

    strategy = _canonical_strategy(parsed.get("strategy"))
    if strategy:
        parsed["strategy"] = strategy

    direction = str(parsed.get("direction") or "").strip().lower()
    if direction in {"long", "short"}:
        parsed["direction"] = direction
    else:
        parsed.pop("direction", None)

    tags = parsed.get("tags")
    if isinstance(tags, str):
        tags = [t.strip().lstrip("#") for t in _re.split(r"[,\s]+", tags) if t.strip()]
    if isinstance(tags, list):
        parsed["tags"] = _dedupe_keep_order([str(t).strip().lstrip("#") for t in tags if str(t).strip()])

    signals = _extract_midnight_signals(text, parsed)
    if not signals.get("is_midnight_context"):
        return parsed

    parsed["strategy"] = "midnight_model"
    if parsed.get("stdv_level") is None and signals.get("stdv_level_hint") is not None:
        parsed["stdv_level"] = signals["stdv_level_hint"]

    if not parsed.get("direction"):
        inferred_direction = _infer_direction_from_midnight_cues(text, signals)
        if inferred_direction:
            parsed["direction"] = inferred_direction

    if not parsed.get("thesis_validated") and signals.get("po3") and signals.get("seek_low_then_reverse"):
        parsed["thesis_validated"] = "yes"

    _build_midnight_narrative_fields(parsed, signals)
    _merge_tags(parsed, signals)

    missing, questions = _build_follow_up_questions(parsed, signals)
    parsed["_flow"] = "midnight_model"
    parsed["_missing_fields"] = missing
    parsed["_follow_up_questions"] = questions
    parsed["_completion_score"] = 100 if not missing else max(0, 100 - min(90, len(missing) * 10))
    return parsed


def parse_trade_text(text):
    result = {}
    lower = str(text or "").lower()

    pnl_patterns = [
        r"pnl\s*[:\-=]?\s*([+-]?\d+(?:[.,]\d+)?)\s*[$€]?",
        r"profit(?:\s+de)?\s*[:\-=]?\s*\+?(\d+(?:[.,]\d+)?)\s*[$€]?",
        r"gain(?:\s+de)?\s*[:\-=]?\s*\+?(\d+(?:[.,]\d+)?)\s*[$€]?",
        r"perte(?:\s+de)?\s*[:\-=]?\s*-?(\d+(?:[.,]\d+)?)\s*[$€]?",
        r"([+-]\d+(?:[.,]\d+)?)\s*[$€]",
        r"perdu\s+(\d+(?:[.,]\d+)?)\s*[$€]?",
    ]
    for pattern in pnl_patterns:
        match = _re.search(pattern, lower)
        if not match:
            continue
        value = _as_float_or_none(match.group(1))
        if value is None:
            continue
        if any(k in pattern for k in ("perte", "perdu")) and value > 0:
            value = -value
        result["pnl"] = value
        break

    rr_patterns = [
        r"(\d+(?:[.,]\d+)?)\s*r\b(?!\w)",
        r"\br[:\-=\s]+([+-]?\d+(?:[.,]\d+)?)",
        r"rr\s*[:\-=]?\s*([+-]?\d+(?:[.,]\d+)?)",
    ]
    for pattern in rr_patterns:
        match = _re.search(pattern, lower)
        if not match:
            continue
        value = _as_float_or_none(match.group(1))
        if value is not None:
            result["rr"] = value
            break

    stdv_level = _extract_stdv_level(text)
    if stdv_level is not None:
        result["stdv_level"] = stdv_level

    level_patterns = {
        "entry_price": [
            r"(?:entry|entree)\s*(?:price|prix)?\s*[:=@\-]?\s*([0-9]+(?:[.,][0-9]+)?)",
            r"\bentree\s+([0-9]+(?:[.,][0-9]+)?)",
        ],
        "stop_loss": [
            r"(?:stop(?:\s*loss)?|sl)\s*(?:price|prix)?\s*[:=@\-]?\s*([0-9]+(?:[.,][0-9]+)?)",
        ],
        "take_profit": [
            r"(?:take\s*profit|tp|target|objectif)\s*(?:price|prix)?\s*[:=@\-]?\s*([0-9]+(?:[.,][0-9]+)?)",
        ],
    }
    for field, patterns in level_patterns.items():
        for pattern in patterns:
            match = _re.search(pattern, lower)
            if not match:
                continue
            value = _as_float_or_none(match.group(1))
            if value is not None:
                result[field] = value
                break
        if field in result:
            continue

    for value, keywords in _WIN_KW.items():
        if any(_norm(kw) in _norm(lower) for kw in keywords):
            result["is_win"] = value
            break
    if result.get("is_win") is None and result.get("pnl") is not None:
        if result["pnl"] > 0:
            result["is_win"] = 1
        elif result["pnl"] < 0:
            result["is_win"] = 0

    for field, kwmap in [
        ("strategy", _STRATEGY_KW),
        ("direction", _DIRECTION_KW),
        ("_session", _SESSION_KW),
        ("_htf_bias", _BIAS_KW),
        ("thesis_validated", _THESIS_KW),
    ]:
        matched = _kw_match(text, kwmap)
        if matched:
            result[field] = matched

    tags = _re.findall(r"#(\w+)", text or "")
    if tags:
        result["tags"] = _dedupe_keep_order(tags)

    return result


# ---------- Cache + circuit breaker pour l'API Claude ----------

import hashlib as _hashlib
import time as _time_mod

_PARSE_CACHE = {}            # hash(texte) -> {resultat, timestamp}
_PARSE_CACHE_MAX = 100       # taille max du cache LRU
_CIRCUIT_STATE = {
    "failures": 0,            # echecs consecutifs
    "max_failures": 3,        # seuil d'ouverture du circuit
    "open_until": 0.0,        # timestamp jusqu'auquel le circuit est ouvert
    "cooldown": 60.0,         # secondes de refroidissement
}


def _cache_key(text):
    return _hashlib.md5(text.encode("utf-8")).hexdigest()


def _cache_get(text):
    key = _cache_key(text)
    entry = _PARSE_CACHE.get(key)
    if entry is None:
        return None
    return entry["result"]


def _cache_put(text, result):
    key = _cache_key(text)
    _PARSE_CACHE[key] = {"result": result, "ts": _time_mod.time()}
    # Eviction LRU simple si le cache depasse la taille max
    if len(_PARSE_CACHE) > _PARSE_CACHE_MAX:
        oldest = min(_PARSE_CACHE.keys(), key=lambda k: _PARSE_CACHE[k]["ts"])
        del _PARSE_CACHE[oldest]


def _circuit_allowed():
    """Retourne True si le circuit autorise un appel a l'API Claude."""
    state = _CIRCUIT_STATE
    now = _time_mod.time()
    if state["failures"] >= state["max_failures"]:
        if now < state["open_until"]:
            return False  # circuit ouvert
        # Half-open: on laisse passer un essai
        log.info("Circuit half-open apres %ss de cooldown", state['cooldown'])
    return True


def _circuit_record_success():
    _CIRCUIT_STATE["failures"] = 0
    _CIRCUIT_STATE["open_until"] = 0.0


def _circuit_record_failure():
    state = _CIRCUIT_STATE
    state["failures"] += 1
    if state["failures"] >= state["max_failures"]:
        state["open_until"] = _time_mod.time() + state["cooldown"]
        log.warning("Circuit ouvert pour %ss (%s echecs consecutifs)",
                     state['cooldown'], state['failures'])


@app.post("/api/parse-trade")
@ratelimit(max_per_minute=20)
def parse_trade():
    data = request.get_json(force=True)
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "text requis"}), 400

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    warning = None

    if api_key:
        # Verifier le cache
        cached = _cache_get(text)
        if cached is not None:
            cached["_source"] = "claude_cache"
            cached["_retryable"] = False
            return jsonify(cached)

        if _circuit_allowed():
            try:
                result = _parse_with_claude(text, api_key)
                _circuit_record_success()
                _cache_put(text, result)
                result = _post_process_parse_result(result, text)
                result["_source"] = "claude"
                result["_retryable"] = False
                return jsonify(result)
            except Exception as exc:
                _circuit_record_failure()
                log.warning("Claude API failed: %s, fallback to regex", exc)
                warning = "Claude indisponible, fallback sur regex."
        else:
            warning = "API Claude temporairement indisponible (circuit ouvert), fallback regex."
            log.info("Circuit refuse, fallback regex")
    else:
        warning = "ANTHROPIC_API_KEY absente, fallback sur regex."

    result = parse_trade_text(text)
    result = _post_process_parse_result(result, text)
    result["_source"] = "regex"
    if warning:
        result["_warning"] = warning
    result["_retryable"] = bool(api_key)
    return jsonify(result)


def _parse_with_claude(text, api_key):
    import urllib.error
    import urllib.request

    prompt = f"""Extrait les donnees structurees de cette description de trade en JSON.
Champs possibles (inclure uniquement si mentionne ou clairement deduit):
- pnl: nombre (positif=gain, negatif=perte)
- rr: ratio risque/reward decimal
- is_win: 1 (gain) ou 0 (perte)
- strategy: midnight_model|london_model|ny_model
- direction: long|short
- _session: asia|london|ny_am|ny_pm
- _htf_bias: bullish|bearish|neutral
- thesis_validated: yes|no|partial
- why_trade: pourquoi ce trade (1-2 phrases)
- why_entry: pourquoi cette entree (1-2 phrases)
- why_stop: pourquoi ce stop loss (1-2 phrases)
- why_tp: pourquoi ce take profit (1-2 phrases)
- stdv_level: niveau STDV entre 1 et 5 par pas de 0.5 (ex: 2.5)
- scenario: resume du scenario (1-3 phrases)
- lessons_learned: lecon principale (1 phrase)
- tags: liste de mots-cles
Si le texte decrit un setup Midnight/PO3, utilise strategy=midnight_model.
Reponds en JSON brut uniquement, sans markdown.
Description: {text}"""

    payload = json.dumps(
        {
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 700,
            "messages": [{"role": "user", "content": prompt}],
        }
    ).encode()

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            body = json.loads(resp.read())
    except urllib.error.HTTPError as _exc:
        status = _exc.code
        detail = ""
        try:
            detail = _exc.read().decode("utf-8", errors="replace")[:200]
        except Exception:
            pass
        raise RuntimeError(
            f"Claude API HTTP {status}: {detail or _exc.reason}"
        ) from _exc
    except urllib.error.URLError as _exc:
        raise RuntimeError(
            f"Claude API reseau: {_exc.reason}"
        ) from _exc

    raw = str(body["content"][0]["text"]).strip()
    raw = _re.sub(r"^```(?:json)?\n?", "", raw).rstrip("`").strip()
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("Claude response is not a JSON object")
    return parsed
