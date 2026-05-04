# ---------- Midnight Engine ----------
#
# Module de calcul du contexte de marche pour le modele Midnight.
# Base de tout le systeme : bornes temporelles NY, extraction de features,
# classification de scenarios et outcome journalier.
#
# Routes :
#   GET /api/models/midnight/day?symbol=BTCUSDT&date=YYYY-MM-DD


from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo

from flask import jsonify, request

NY = ZoneInfo("America/New_York")

# ---------- Time helpers ----------


def ny_now():
    return datetime.now(NY)


def utc_now_ts():
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def ny_date_iso(date_ny=None):
    if date_ny is None:
        return ny_now().strftime("%Y-%m-%d")
    return date_ny


def ny_midnight_ms(date_ny=None):
    """Retourne le timestamp (ms) de 00:00 NY pour une date donnee (ou aujourd'hui)."""
    d = _parse_ny_date(date_ny)
    dt_ny = datetime.combine(d, time(0, 0), tzinfo=NY)
    return int(dt_ny.timestamp() * 1000)


def ny_timestamp_to_utc_ms(ny_dt):
    """Convertit une datetime NY tz-aware en timestamp UTC ms."""
    return int(ny_dt.timestamp() * 1000)


def _parse_ny_date(date_ny=None):
    if date_ny is None:
        return ny_now().date()
    return datetime.strptime(date_ny, "%Y-%m-%d").date()


# ---------- Windows ----------


def get_midnight_windows(date_ny=None):
    """Calcule les 3 fenetres : pre-midnight, midnight, post-open.

    Retourne des couples (start_ms, end_ms) UTC.

    Pre-midnight : 22:00 NY (veille) → 00:00 NY
    Midnight     : 00:00 NY → 00:30 NY
    Post-open    : 00:30 NY → 02:00 NY
    """
    d = _parse_ny_date(date_ny)

    # Veille 22:00 NY
    from datetime import timedelta
    pre_start_ny = datetime.combine(d - timedelta(days=1), time(22, 0), tzinfo=NY)
    pre_end_ny   = datetime.combine(d, time(0, 0), tzinfo=NY)

    mid_start_ny = datetime.combine(d, time(0, 0), tzinfo=NY)
    mid_end_ny   = datetime.combine(d, time(0, 30), tzinfo=NY)

    post_start_ny = datetime.combine(d, time(0, 30), tzinfo=NY)
    post_end_ny   = datetime.combine(d, time(2, 0), tzinfo=NY)

    return {
        "date_ny": d.isoformat(),
        "pre_midnight": {
            "start_utc": ny_timestamp_to_utc_ms(pre_start_ny),
            "end_utc": ny_timestamp_to_utc_ms(pre_end_ny),
            "start_ny_iso": pre_start_ny.isoformat(),
            "end_ny_iso": pre_end_ny.isoformat(),
        },
        "midnight": {
            "start_utc": ny_timestamp_to_utc_ms(mid_start_ny),
            "end_utc": ny_timestamp_to_utc_ms(mid_end_ny),
            "start_ny_iso": mid_start_ny.isoformat(),
            "end_ny_iso": mid_end_ny.isoformat(),
        },
        "post_open": {
            "start_utc": ny_timestamp_to_utc_ms(post_start_ny),
            "end_utc": ny_timestamp_to_utc_ms(post_end_ny),
            "start_ny_iso": post_start_ny.isoformat(),
            "end_ny_iso": post_end_ny.isoformat(),
        },
    }


# ---------- Klines fetching ----------


def _fetch_klines_range(symbol, interval, start_ms, end_ms, limit=500):
    """Fetch klines pour une plage temporelle via le cache klines existant."""

    # Reutilise le cache de 23_routes_market (deja charge dans le namespace)
    import app_parts
    data, _status = app_parts.fetch_klines(
        symbol, interval, limit, start_ms, end_ms
    )
    return data.get("klines", []) if isinstance(data, dict) else []


# ---------- Feature extraction ----------


def _ohlc_from_klines(klines):
    """Extrait OHLC arrays a partir de klines normalisees.

    Chaque kline : {"time": unix_s, "open": float, "high": float, "low": float, "close": float}
    """
    opens  = [k["open"] for k in klines]
    highs  = [k["high"] for k in klines]
    lows   = [k["low"] for k in klines]
    closes = [k["close"] for k in klines]
    return opens, highs, lows, closes


def _range_pct(high, low):
    """Range en pourcentage du prix."""
    if low <= 0:
        return 0.0
    return ((high - low) / low) * 100.0


def _direction(open_price, close_price):
    if close_price > open_price:
        return "bullish"
    if close_price < open_price:
        return "bearish"
    return "neutral"


def _displacement_score(open_price, high, low, close, body_ratio_thresh=0.3):
    """Score de deplacement 0-1 base sur le body ratio et la direction.

    Retourne (score, direction_sign) ou direction_sign = +1 (bullish) / -1 (bearish) / 0 (neutral).
    """
    total_range = high - low
    if total_range <= 0:
        return 0.0, 0

    body = abs(close - open_price)
    body_ratio = body / total_range

    if close > open_price:
        return min(1.0, body_ratio / body_ratio_thresh), 1
    elif close < open_price:
        return min(1.0, body_ratio / body_ratio_thresh), -1
    return 0.0, 0


def _high_first_or_low_first(klines):
    """Determine si le high est atteint avant le low (ou l'inverse).

    Retourne "high_first", "low_first", ou None si pas assez de donnees.
    """
    if len(klines) < 2:
        return None

    opens, highs, lows, closes = _ohlc_from_klines(klines)
    high_val = max(highs)
    low_val  = min(lows)

    high_idx = next(i for i, h in enumerate(highs) if h >= high_val)
    low_idx  = next(i for i, l in enumerate(lows) if l <= low_val)

    if high_idx < low_idx:
        return "high_first"
    if low_idx < high_idx:
        return "low_first"
    return None


def extract_midnight_features(symbol, date_ny=None):
    """Extrait les features Midnight pour un jour donne.

    Retourne un dict contenant features, levels, labels.
    """
    windows = get_midnight_windows(date_ny)
    date_str = windows["date_ny"]

    # Fetch klines pour chaque fenetre
    pre_klines = _fetch_klines_range(
        symbol, "5m",
        windows["pre_midnight"]["start_utc"],
        windows["pre_midnight"]["end_utc"],
        limit=30
    )

    mid_klines = _fetch_klines_range(
        symbol, "1m",
        windows["midnight"]["start_utc"],
        windows["midnight"]["end_utc"],
        limit=35
    )

    post_klines = _fetch_klines_range(
        symbol, "5m",
        windows["post_open"]["start_utc"],
        windows["post_open"]["end_utc"],
        limit=20
    )

    # ---------- Pre-midnight features ----------
    pre_features = {}
    if pre_klines:
        _o, pre_h, pre_l, _c = _ohlc_from_klines(pre_klines)
        pre_high = max(pre_h)
        pre_low  = min(pre_l)
        pre_first_open = pre_klines[0]["open"]
        pre_last_close = pre_klines[-1]["close"]
        pre_features = {
            "pre_direction": _direction(pre_first_open, pre_last_close),
            "pre_range_pct": _range_pct(pre_high, pre_low),
            "pre_volatility_bucket": "high" if _range_pct(pre_high, pre_low) > 0.5 else "low",
            "pre_close_position": ((pre_last_close - pre_low) / (pre_high - pre_low)) if pre_high > pre_low else 0.5,
        }

    # ---------- Midnight features ----------
    mid_features = {}
    mid_levels = {}
    if mid_klines:
        opens, highs, lows, closes = _ohlc_from_klines(mid_klines)
        mid_open  = opens[0]
        mid_high  = max(highs)
        mid_low   = min(lows)
        mid_close = closes[-1]
        mid_range = mid_high - mid_low
        mid_body  = abs(mid_close - mid_open)
        body_ratio = mid_body / mid_range if mid_range > 0 else 0

        disp_score, disp_sign = _displacement_score(mid_open, mid_high, mid_low, mid_close)

        mid_features = {
            "mid_open": mid_open,
            "mid_high": mid_high,
            "mid_low": mid_low,
            "mid_close": mid_close,
            "mid_direction": _direction(mid_open, mid_close),
            "mid_shape": "doji" if body_ratio < 0.1 else ("marubozu" if body_ratio > 0.7 else "standard"),
            "mid_range_pct": _range_pct(mid_high, mid_low),
            "mid_body_ratio": round(body_ratio, 4),
            "mid_displacement_score": round(disp_score, 4),
            "mid_high_first_or_low_first": _high_first_or_low_first(mid_klines),
        }

        mid_levels = {
            "midnight_open": mid_open,
            "midnight_high": mid_high,
            "midnight_low": mid_low,
            "midnight_mid": round((mid_high + mid_low) / 2, 1),
        }

    # ---------- Post-open features ----------
    post_features = {}
    if post_klines and mid_klines:
        _o, post_h, post_l, post_c = _ohlc_from_klines(post_klines)
        mid_high = mid_levels.get("midnight_high", 0)
        mid_low  = mid_levels.get("midnight_low", 0)

        swept_high = any(h > mid_high for h in post_h) if mid_high > 0 else False
        swept_low  = any(l < mid_low for l in post_l) if mid_low > 0 else False
        returned_inside = False
        if swept_high or swept_low:
            last_close = post_c[-1] if post_c else 0
            returned_inside = mid_low <= last_close <= mid_high

        post_features = {
            "post_behavior": _direction(post_klines[0]["open"], post_c[-1]),
            "swept_midnight_high": swept_high,
            "swept_midnight_low": swept_low,
            "returned_inside_midnight_range": returned_inside,
            "accepted_above_midnight_high": post_c[-1] > mid_high if mid_high > 0 else False,
            "accepted_below_midnight_low": post_c[-1] < mid_low if mid_low > 0 else False,
        }

    return {
        "date_ny": date_str,
        "symbol": symbol,
        "windows": windows,
        "features": {
            "pre_midnight": pre_features,
            "midnight": mid_features,
            "post_open": post_features,
        },
        "levels": mid_levels,
    }


# ---------- Scenario classification ----------


def classify_midnight_scenario(pre_features, mid_features, post_features):
    """Classifie le scenario de la journee a partir des features extraites.

    Retourne (signature, confidence) base sur la combinaison des 3 fenetres.
    """
    if not mid_features:
        return "NO_MIDNIGHT_DATA", 0.0

    mid_dir = mid_features.get("mid_direction", "neutral")
    mid_shape = mid_features.get("mid_shape", "standard")
    disp = mid_features.get("mid_displacement_score", 0)
    hilo = mid_features.get("mid_high_first_or_low_first", "")

    pre_dir = pre_features.get("pre_direction", "neutral")
    pre_range = pre_features.get("pre_range_pct", 0)

    swept_high = post_features.get("swept_midnight_high", False)
    swept_low  = post_features.get("swept_midnight_low", False)
    returned   = post_features.get("returned_inside_midnight_range", False)
    post_accept = post_features.get("accepted_above_midnight_high", False) or \
                  post_features.get("accepted_below_midnight_low", False)

    # Signature: PRE_{range}_{dir}__MID_{shape}_{dir}_{disp}__POST_{behavior}
    pre_tag = f"PRE_{'WIDE' if pre_range > 0.5 else 'TIGHT'}_{pre_dir.upper()}"
    mid_tag = f"MID_{mid_shape.upper()}_{mid_dir.upper()}_D{int(disp*10)}"
    
    if swept_high and swept_low:
        post_tag = "POST_DBL_SWEEP"
    elif swept_high:
        post_tag = "POST_SWEEP_H"
    elif swept_low:
        post_tag = "POST_SWEEP_L"
    elif returned:
        post_tag = "POST_RETURN"
    elif post_accept:
        post_tag = "POST_ACCEPT"
    else:
        post_tag = "POST_IDLE"

    signature = f"{pre_tag}__{mid_tag}__{post_tag}"

    # Confidence heuristique temporaire
    confidence = 0.5
    if disp > 0.7:
        confidence += 0.15
    if mid_shape == "marubozu":
        confidence += 0.10
    if mid_dir != "neutral":
        confidence += 0.05
    if swept_high or swept_low:
        confidence += 0.05
    if returned:
        confidence += 0.05

    return signature, round(min(confidence, 0.95), 2)


# ---------- Outcome computation ----------


def compute_midnight_outcome(symbol, date_ny, mid_levels):
    """Calcule l'outcome journalier : ou le high/low du jour se sont formes.

    Pour une date passee, fetch les klines 1h du jour complet.
    Retourne un dict outcome.
    """
    from datetime import timedelta

    d = _parse_ny_date(date_ny)
    day_start_ny = datetime.combine(d, time(0, 0), tzinfo=NY)
    day_end_ny   = datetime.combine(d + timedelta(days=1), time(0, 0), tzinfo=NY)

    day_klines = _fetch_klines_range(
        symbol, "30m",
        ny_timestamp_to_utc_ms(day_start_ny),
        ny_timestamp_to_utc_ms(day_end_ny),
        limit=50
    )

    if not day_klines:
        return {}

    opens, highs, lows, closes = _ohlc_from_klines(day_klines)
    daily_high = max(highs)
    daily_low  = min(lows)
    daily_open = opens[0]
    daily_close = closes[-1]

    mid_high = mid_levels.get("midnight_high", 0)
    mid_low  = mid_levels.get("midnight_low", 0)

    # Trouver les timestamps du high/low
    high_idx = highs.index(daily_high)
    low_idx  = lows.index(daily_low)
    high_time_ms = day_klines[high_idx].get("time", 0) * 1000
    low_time_ms  = day_klines[low_idx].get("time", 0) * 1000

    # Session du high/low
    midnight_end_ms = ny_timestamp_to_utc_ms(
        datetime.combine(d, time(0, 30), tzinfo=NY)
    )

    def session_label(ts_ms):
        if ts_ms <= midnight_end_ms:
            return "midnight"
        dt = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).astimezone(NY)
        h = dt.hour
        if h < 9:
            return "pre_market"
        if h < 16:
            return "regular"
        return "after_hours"

    mid_high_is_daily = abs(mid_high - daily_high) < (daily_high * 0.0001) if mid_high else False
    mid_low_is_daily  = abs(mid_low - daily_low) < (daily_low * 0.0001) if mid_low else False

    return {
        "daily_open": daily_open,
        "daily_high": daily_high,
        "daily_low": daily_low,
        "daily_close": daily_close,
        "daily_high_time": high_time_ms,
        "daily_low_time": low_time_ms,
        "daily_high_time_iso": datetime.fromtimestamp(high_time_ms / 1000, tz=timezone.utc).isoformat(),
        "daily_low_time_iso": datetime.fromtimestamp(low_time_ms / 1000, tz=timezone.utc).isoformat(),
        "daily_high_session": session_label(high_time_ms),
        "daily_low_session": session_label(low_time_ms),
        "midnight_high_became_daily_high": mid_high_is_daily,
        "midnight_low_became_daily_low": mid_low_is_daily,
        "high_first_or_low_first": _high_first_or_low_first(day_klines),
    }


# ---------- Main builder ----------


def build_midnight_context(db, symbol, date_ny=None):
    """Construit le contexte Midnight complet pour un jour donne.

    Retourne un dict pret a etre serialise en JSON.
    """
    result = extract_midnight_features(symbol, date_ny)
    date_str = result["date_ny"]

    pre_feat  = result["features"]["pre_midnight"]
    mid_feat  = result["features"]["midnight"]
    post_feat = result["features"]["post_open"]

    signature, confidence = classify_midnight_scenario(pre_feat, mid_feat, post_feat)
    outcome = compute_midnight_outcome(symbol, date_str, result["levels"])

    return {
        "date_ny": date_str,
        "symbol": symbol,
        "model_name": "midnight_engine",
        "windows": result["windows"],
        "features": result["features"],
        "levels": result["levels"],
        "labels": {
            "midnight_direction": mid_feat.get("mid_direction") if mid_feat else None,
            "midnight_displacement_score": mid_feat.get("mid_displacement_score") if mid_feat else None,
            "post_behavior": post_feat.get("post_behavior") if post_feat else None,
        },
        "outcome": outcome,
        "scenario_signature": signature,
        "confidence_score": confidence,
    }


# ---------- Route API ----------


@app.get("/api/models/midnight/day")
def midnight_day():
    symbol = request.args.get("symbol", "BTCUSDT").upper()
    date_ny = request.args.get("date", None)

    db = get_db()
    try:
        context = build_midnight_context(db, symbol, date_ny)
    except Exception as e:
        log.error("Midnight Engine error: %s", e)
        return jsonify({"error": str(e)}), 500

    return jsonify(context)
