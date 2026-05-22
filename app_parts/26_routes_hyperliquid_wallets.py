# ---------- Routes API : Hyperliquid wallet tracker (read-only) ----------
#
# Public wallet data only. No API keys, no signatures, no trading calls.

import re as _hl_wallet_re


_HL_ADDRESS_RE = _hl_wallet_re.compile(r"0[xX][a-fA-F0-9]{40}")
_HL_WALLET_MAX_TAGS = 12
_HL_WALLET_EVENT_LIMIT = 500


def _hl_normalize_address(address):
    value = str(address or "").strip()
    value = "".join(ch for ch in value if not ch.isspace() and ch not in "\u200b\u200c\u200d\ufeff")
    match = _HL_ADDRESS_RE.search(value)
    if not match:
        return None
    return match.group(0).lower()


def _hl_wallet_tags(value):
    if value is None:
        return []
    if isinstance(value, str):
        raw = [x.strip() for x in value.split(",")]
    elif isinstance(value, list):
        raw = [str(x).strip() for x in value]
    else:
        raw = []
    tags = []
    seen = set()
    for item in raw:
        if not item:
            continue
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        tags.append(item[:32])
        if len(tags) >= _HL_WALLET_MAX_TAGS:
            break
    return tags


def _hl_wallet_row(row):
    if not row:
        return None
    try:
        tags = json.loads(row["tags"] or "[]")
        if not isinstance(tags, list):
            tags = []
    except Exception:
        tags = []
    return {
        "id": row["id"],
        "address": row["address"],
        "label": row["label"] or "",
        "notes": row["notes"] or "",
        "tags": tags,
        "color": row["color"] or "",
        "is_active": bool(row["is_active"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _hl_wallet_payload(data, existing=None):
    data = data or {}
    raw_address = data.get("address", existing.get("address") if existing else None)
    address = _hl_normalize_address(raw_address)
    if not address:
        raise ValueError("Adresse Hyperliquid invalide")

    label = str(data.get("label", existing.get("label", "") if existing else "") or "").strip()[:80]
    notes = str(data.get("notes", existing.get("notes", "") if existing else "") or "").strip()[:1000]
    color = str(data.get("color", existing.get("color", "") if existing else "") or "").strip()[:32]
    tags = _hl_wallet_tags(data.get("tags", existing.get("tags", []) if existing else []))
    is_active = data.get("is_active", existing.get("is_active", True) if existing else True)
    is_active = 1 if bool(is_active) else 0
    return {
        "address": address,
        "label": label,
        "notes": notes,
        "tags": tags,
        "color": color,
        "is_active": is_active,
    }


def _hl_get_wallet(wallet_id):
    row = get_db().execute(
        "SELECT * FROM hyperliquid_wallets WHERE id=?",
        (wallet_id,),
    ).fetchone()
    return _hl_wallet_row(row)


def _hl_wallet_or_address(wallet_id=None):
    if wallet_id is not None:
        wallet = _hl_get_wallet(wallet_id)
        if not wallet:
            return None, ({"ok": False, "error": "Wallet introuvable"}, 404)
        return wallet, None

    address = _hl_normalize_address(request.args.get("address"))
    if not address:
        return None, ({"ok": False, "error": "Adresse Hyperliquid invalide"}, 400)
    return {
        "id": None,
        "address": address,
        "label": "",
        "notes": "",
        "tags": [],
        "color": "",
        "is_active": True,
        "created_at": None,
        "updated_at": None,
    }, None


def _hl_wallet_info(payload, cache_key, ttl=2, force=False):
    return _hl_info_cached(payload, cache_key, ttl, force=force)


def _hl_wallet_perp_dex_names(force=False):
    raw, err = _hl_wallet_info({"type": "perpDexs"}, "hl:perpDexs", ttl=600, force=force)
    if err:
        return [], err
    names = []
    seen = set()
    for item in raw if isinstance(raw, list) else []:
        name = _hl_dex_name(item)
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        names.append(name)
    return names, None


def _hl_position_float(value):
    try:
        if value in (None, ""):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _hl_wallet_prefixed_coin(coin, dex=None):
    if not coin:
        return coin
    coin = str(coin)
    dex = str(dex or "").strip()
    if not dex or ":" in coin:
        return coin
    return f"{dex}:{coin}"


def _hl_normalize_position(item, dex=None):
    position = item.get("position") if isinstance(item, dict) else None
    if not isinstance(position, dict):
        position = item if isinstance(item, dict) else {}

    size = _hl_position_float(position.get("szi"))
    if size is None:
        size = _hl_position_float(position.get("size"))
    abs_size = abs(size) if size is not None else None
    side = "flat"
    if size is not None and size > 0:
        side = "long"
    elif size is not None and size < 0:
        side = "short"

    return {
        "coin": _hl_wallet_prefixed_coin(position.get("coin"), dex),
        "nativeCoin": position.get("coin"),
        "dex": dex or "",
        "side": side,
        "size": size,
        "absSize": abs_size,
        "entryPx": _hl_position_float(position.get("entryPx")),
        "positionValue": _hl_position_float(position.get("positionValue")),
        "unrealizedPnl": _hl_position_float(position.get("unrealizedPnl")),
        "returnOnEquity": _hl_position_float(position.get("returnOnEquity")),
        "liquidationPx": _hl_position_float(position.get("liquidationPx")),
        "marginUsed": _hl_position_float(position.get("marginUsed")),
        "maxLeverage": _hl_position_float(position.get("maxLeverage")),
        "leverage": position.get("leverage"),
        "cumFunding": position.get("cumFunding"),
        "raw": item,
    }


def _hl_normalize_wallet_state(raw, dex=None):
    raw = raw if isinstance(raw, dict) else {}
    positions = []
    for item in raw.get("assetPositions") or []:
        pos = _hl_normalize_position(item, dex=dex)
        if pos.get("coin") and pos.get("side") != "flat":
            positions.append(pos)
    return {
        "marginSummary": raw.get("marginSummary") or {},
        "crossMarginSummary": raw.get("crossMarginSummary") or {},
        "withdrawable": _hl_position_float(raw.get("withdrawable")),
        "time": raw.get("time"),
        "positions": positions,
        "count": len(positions),
        "raw": raw,
    }


def _hl_normalize_order(order, dex=None):
    if not isinstance(order, dict):
        return {"raw": order}
    return {
        "coin": _hl_wallet_prefixed_coin(order.get("coin"), dex),
        "nativeCoin": order.get("coin"),
        "dex": dex or "",
        "side": str(order.get("side") or "").lower(),
        "limitPx": _hl_position_float(order.get("limitPx") or order.get("px")),
        "size": _hl_position_float(order.get("sz") or order.get("size")),
        "oid": order.get("oid"),
        "timestamp": order.get("timestamp"),
        "raw": order,
    }


def _hl_fill_side(fill):
    side = str(fill.get("side") or "").upper()
    if side == "B":
        return "buy"
    if side == "A":
        return "sell"
    return str(fill.get("side") or "").lower()


def _hl_fill_event_type(fill):
    direction = str(fill.get("dir") or "").lower()
    if "open" in direction:
        return "open"
    if "close" in direction:
        return "close"
    if "long" in direction or "short" in direction:
        return "position_change"
    return "fill"


def _hl_normalize_fill(fill, dex=None):
    if not isinstance(fill, dict):
        return {"raw": fill}
    return {
        "coin": _hl_wallet_prefixed_coin(fill.get("coin"), dex),
        "nativeCoin": fill.get("coin"),
        "dex": dex or "",
        "eventType": _hl_fill_event_type(fill),
        "dir": fill.get("dir"),
        "side": _hl_fill_side(fill),
        "price": _hl_position_float(fill.get("px")),
        "size": _hl_position_float(fill.get("sz")),
        "closedPnl": _hl_position_float(fill.get("closedPnl")),
        "fee": _hl_position_float(fill.get("fee")),
        "feeToken": fill.get("feeToken"),
        "time": fill.get("time"),
        "hash": fill.get("hash"),
        "oid": fill.get("oid"),
        "tid": fill.get("tid"),
        "raw": fill,
    }


def _hl_derive_wallet_events(fills, positions):
    events = []
    for fill in fills:
        event_type = fill.get("eventType") or "fill"
        label = event_type
        if event_type == "close" and fill.get("size") is not None:
            label = "partial_or_close"
        events.append({
            "type": event_type,
            "label": label,
            "coin": fill.get("coin"),
            "side": fill.get("side"),
            "dir": fill.get("dir"),
            "price": fill.get("price"),
            "size": fill.get("size"),
            "closedPnl": fill.get("closedPnl"),
            "time": fill.get("time"),
            "source": "fill",
            "fill": fill,
        })

    for pos in positions:
        events.append({
            "type": "position_open",
            "label": "current_position",
            "coin": pos.get("coin"),
            "side": pos.get("side"),
            "price": pos.get("entryPx"),
            "size": pos.get("absSize"),
            "unrealizedPnl": pos.get("unrealizedPnl"),
            "time": None,
            "source": "state",
            "position": pos,
        })
    events.sort(key=lambda e: e.get("time") or 0, reverse=True)
    return events


def _hl_wallet_state_for_address(address, force=False):
    raw, err = _hl_wallet_info(
        {"type": "clearinghouseState", "user": address},
        f"hl:wallet:state:{address}:native",
        ttl=2,
        force=force,
    )
    if err:
        return None, err

    merged = _hl_normalize_wallet_state(raw)
    merged["dexStates"] = [{"dex": "", "state": raw}]
    merged["upstreamErrors"] = []
    seen = {str(pos.get("coin")).lower() for pos in merged["positions"]}

    dex_names, dex_err = _hl_wallet_perp_dex_names(force=force)
    if dex_err:
        merged["upstreamErrors"].append({"scope": "perpDexs", "error": dex_err[0]})

    for dex in dex_names:
        dex_raw, dex_state_err = _hl_wallet_info(
            {"type": "clearinghouseState", "user": address, "dex": dex},
            f"hl:wallet:state:{address}:dex:{dex}",
            ttl=2,
            force=force,
        )
        if dex_state_err:
            merged["upstreamErrors"].append({"scope": f"dex:{dex}", "error": dex_state_err[0]})
            continue
        dex_state = _hl_normalize_wallet_state(dex_raw, dex=dex)
        merged["dexStates"].append({"dex": dex, "state": dex_raw})
        for pos in dex_state["positions"]:
            key = str(pos.get("coin")).lower()
            if key in seen:
                continue
            seen.add(key)
            merged["positions"].append(pos)

    merged["count"] = len(merged["positions"])
    return merged, None


def _hl_wallet_orders_for_address(address, force=False):
    raw, err = _hl_wallet_info(
        {"type": "frontendOpenOrders", "user": address},
        f"hl:wallet:orders:{address}:native",
        ttl=2,
        force=force,
    )
    if err:
        return None, err
    orders = [_hl_normalize_order(o) for o in (raw or [])]

    dex_names, _dex_err = _hl_wallet_perp_dex_names(force=force)
    seen = {str(order.get("oid") or "") + ":" + str(order.get("coin") or "") for order in orders}
    for dex in dex_names:
        dex_raw, dex_err = _hl_wallet_info(
            {"type": "frontendOpenOrders", "user": address, "dex": dex},
            f"hl:wallet:orders:{address}:dex:{dex}",
            ttl=2,
            force=force,
        )
        if dex_err:
            continue
        for order in [_hl_normalize_order(o, dex=dex) for o in (dex_raw or [])]:
            key = str(order.get("oid") or "") + ":" + str(order.get("coin") or "")
            if key in seen:
                continue
            seen.add(key)
            orders.append(order)
    return orders, None


def _hl_wallet_fills_for_address(address, start_time=None, end_time=None, force=False):
    if start_time is not None or end_time is not None:
        payload = {"type": "userFillsByTime", "user": address}
        if start_time is not None:
            payload["startTime"] = start_time
        if end_time is not None:
            payload["endTime"] = end_time
        key = f"hl:wallet:fillsByTime:{address}:{start_time}:{end_time}:native"
    else:
        payload = {"type": "userFills", "user": address}
        key = f"hl:wallet:fills:{address}:native"

    raw, err = _hl_wallet_info(payload, key, ttl=10, force=force)
    if err:
        return None, err
    fills = [_hl_normalize_fill(f) for f in (raw or [])]

    dex_names, _dex_err = _hl_wallet_perp_dex_names(force=force)
    seen = {str(f.get("hash") or "") + ":" + str(f.get("tid") or "") + ":" + str(f.get("coin") or "") for f in fills}
    for dex in dex_names:
        dex_payload = dict(payload)
        dex_payload["dex"] = dex
        dex_raw, dex_err = _hl_wallet_info(
            dex_payload,
            f"{key}:dex:{dex}",
            ttl=10,
            force=force,
        )
        if dex_err:
            continue
        for fill in [_hl_normalize_fill(f, dex=dex) for f in (dex_raw or [])]:
            fill_key = str(fill.get("hash") or "") + ":" + str(fill.get("tid") or "") + ":" + str(fill.get("coin") or "")
            if fill_key in seen:
                continue
            seen.add(fill_key)
            fills.append(fill)
    fills.sort(key=lambda f: f.get("time") or 0)
    return fills, None


@app.get("/api/hyperliquid/wallets")
def hyperliquid_wallets_list():
    include_inactive = str(request.args.get("includeInactive", "0")).lower() in ("1", "true", "yes")
    db = get_db()
    if include_inactive:
        rows = db.execute("SELECT * FROM hyperliquid_wallets ORDER BY updated_at DESC, id DESC").fetchall()
    else:
        rows = db.execute("SELECT * FROM hyperliquid_wallets WHERE is_active=1 ORDER BY updated_at DESC, id DESC").fetchall()
    return jsonify({"ok": True, "wallets": [_hl_wallet_row(r) for r in rows]})


@app.post("/api/hyperliquid/wallets")
def hyperliquid_wallets_create():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"ok": False, "error": "Payload JSON invalide"}), 400
    try:
        payload = _hl_wallet_payload(data)
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400

    db = get_db()
    now = now_iso()
    try:
        cur = db.execute("""
            INSERT INTO hyperliquid_wallets
                (address, label, notes, tags, color, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            payload["address"], payload["label"], payload["notes"],
            json.dumps(payload["tags"], ensure_ascii=False), payload["color"],
            payload["is_active"], now, now,
        ))
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({"ok": False, "error": "Wallet deja suivi"}), 409

    return jsonify({"ok": True, "wallet": _hl_get_wallet(cur.lastrowid)}), 201


@app.put("/api/hyperliquid/wallets/<int:wallet_id>")
def hyperliquid_wallets_update(wallet_id):
    existing = _hl_get_wallet(wallet_id)
    if not existing:
        return jsonify({"ok": False, "error": "Wallet introuvable"}), 404
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"ok": False, "error": "Payload JSON invalide"}), 400
    try:
        payload = _hl_wallet_payload(data, existing=existing)
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400

    db = get_db()
    try:
        db.execute("""
            UPDATE hyperliquid_wallets
            SET address=?, label=?, notes=?, tags=?, color=?, is_active=?, updated_at=?
            WHERE id=?
        """, (
            payload["address"], payload["label"], payload["notes"], json.dumps(payload["tags"], ensure_ascii=False),
            payload["color"], payload["is_active"], now_iso(), wallet_id,
        ))
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({"ok": False, "error": "Wallet deja suivi"}), 409
    return jsonify({"ok": True, "wallet": _hl_get_wallet(wallet_id)})


@app.delete("/api/hyperliquid/wallets/<int:wallet_id>")
def hyperliquid_wallets_delete(wallet_id):
    if not _hl_get_wallet(wallet_id):
        return jsonify({"ok": False, "error": "Wallet introuvable"}), 404
    db = get_db()
    db.execute("DELETE FROM hyperliquid_wallets WHERE id=?", (wallet_id,))
    db.commit()
    return jsonify({"ok": True})


@app.get("/api/hyperliquid/wallets/state")
def hyperliquid_wallets_state_all():
    force = _hl_force_param()
    db = get_db()
    rows = db.execute("SELECT * FROM hyperliquid_wallets WHERE is_active=1 ORDER BY updated_at DESC, id DESC").fetchall()
    out = []
    errors = []
    for row in rows:
        wallet = _hl_wallet_row(row)
        state, err = _hl_wallet_state_for_address(wallet["address"], force=force)
        orders, orders_err = _hl_wallet_orders_for_address(wallet["address"], force=force)
        if err:
            errors.append({"wallet": wallet, "error": err[0]})
            state = None
        if orders_err:
            orders = []
        out.append({
            "wallet": wallet,
            "state": state,
            "openOrders": orders,
            "positions": state.get("positions", []) if state else [],
        })
    return jsonify({"ok": True, "wallets": out, "errors": errors})


@app.get("/api/hyperliquid/wallets/<int:wallet_id>/state")
def hyperliquid_wallet_state(wallet_id):
    wallet, err = _hl_wallet_or_address(wallet_id)
    if err:
        return jsonify(err[0]), err[1]
    force = _hl_force_param()
    state, state_err = _hl_wallet_state_for_address(wallet["address"], force=force)
    if state_err:
        return jsonify(state_err[0]), state_err[1]
    orders, orders_err = _hl_wallet_orders_for_address(wallet["address"], force=force)
    if orders_err:
        orders = []
    return jsonify({"ok": True, "wallet": wallet, "state": state, "positions": state["positions"], "openOrders": orders})


@app.get("/api/hyperliquid/wallet-state")
def hyperliquid_wallet_state_by_address():
    wallet, err = _hl_wallet_or_address()
    if err:
        return jsonify(err[0]), err[1]
    force = _hl_force_param()
    state, state_err = _hl_wallet_state_for_address(wallet["address"], force=force)
    if state_err:
        return jsonify(state_err[0]), state_err[1]
    orders, orders_err = _hl_wallet_orders_for_address(wallet["address"], force=force)
    if orders_err:
        orders = []
    return jsonify({"ok": True, "wallet": wallet, "state": state, "positions": state["positions"], "openOrders": orders})


@app.get("/api/hyperliquid/wallets/<int:wallet_id>/fills")
def hyperliquid_wallet_fills(wallet_id):
    wallet, err = _hl_wallet_or_address(wallet_id)
    if err:
        return jsonify(err[0]), err[1]
    try:
        start_time = _hl_parse_int("startTime")
        end_time = _hl_parse_int("endTime")
        limit = _hl_parse_int("limit", 200, 1, 2000)
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    fills, fills_err = _hl_wallet_fills_for_address(wallet["address"], start_time, end_time, force=_hl_force_param())
    if fills_err:
        return jsonify(fills_err[0]), fills_err[1]
    return jsonify({"ok": True, "wallet": wallet, "fills": fills[-limit:], "count": min(len(fills), limit)})


@app.get("/api/hyperliquid/wallets/<int:wallet_id>/events")
def hyperliquid_wallet_events(wallet_id):
    wallet, err = _hl_wallet_or_address(wallet_id)
    if err:
        return jsonify(err[0]), err[1]
    try:
        start_time = _hl_parse_int("startTime")
        end_time = _hl_parse_int("endTime")
        limit = _hl_parse_int("limit", 200, 1, _HL_WALLET_EVENT_LIMIT)
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400

    force = _hl_force_param()
    state, state_err = _hl_wallet_state_for_address(wallet["address"], force=force)
    if state_err:
        return jsonify(state_err[0]), state_err[1]
    fills, fills_err = _hl_wallet_fills_for_address(wallet["address"], start_time, end_time, force=force)
    if fills_err:
        fills = []
    events = _hl_derive_wallet_events(fills, state.get("positions", []))
    return jsonify({
        "ok": True,
        "wallet": wallet,
        "events": events[:limit],
        "positions": state.get("positions", []),
        "count": min(len(events), limit),
    })
