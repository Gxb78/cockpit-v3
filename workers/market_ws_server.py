#!/usr/bin/env python3
"""
Market WebSocket Server — port 8765
Fournit les données en temps réel au V6 Orderflow :
  - aggTrades → trades, delta buckets (CVD), footprint candles
  - depth stream → order book (DOM)
  - VWAP calculé depuis les trades (session 1d)
  - candle history relayé depuis Flask /api/market/klines
"""

import asyncio
import json
import time
import urllib.request
import urllib.error
import sys
import os
from collections import defaultdict, deque

try:
    import websockets
except ImportError:
    print("pip install websockets", file=sys.stderr)
    sys.exit(1)

# ── Configuration ──
WS_HOST = "0.0.0.0"
WS_PORT = 8765
BINANCE_WS = "wss://stream.binance.com:9443/ws"
def get_flask_api_url():
    if "PORT" in os.environ:
        return f"http://127.0.0.1:{os.environ['PORT']}"
    for p in ["5001", "5000"]:
        try:
            req = urllib.request.Request(f"http://127.0.0.1:{p}/api/market/time")
            with urllib.request.urlopen(req, timeout=0.2) as resp:
                if resp.status == 200:
                    return f"http://127.0.0.1:{p}"
        except Exception:
            pass
    return "http://127.0.0.1:5001"

FLASK_API = get_flask_api_url()
CVD_INTERVALS_MS = [60000, 300000]     # 1m, 5m
CANDLE_HISTORY_INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d"]
FOOTPRINT_INTERVAL_MS = 60000          # 1m candles
VWAP_SESSION_MS = 86400000             # 1d
MAX_TRADE_BUFFER = 50000               # max trades en mémoire
ORDERBOOK_TOP = 50                     # top N levels DOM
FOOTPRINT_TICK = 10                    # $10 buckets pour BTC
FOOTPRINT_MAX_CANDLES = 500            # max bougies footprint en mémoire
CANDLE_HISTORY_LIMIT = 1000            # max bougies historiques par requête
DEPTH_HISTORY_MAX = 1000            # max points d'historique depth

# ── État global ──
connected_clients = set()
trades = deque(maxlen=MAX_TRADE_BUFFER)
cvd_buckets = {}       # {interval_ms: {startTime: bucket}}
vwap_state = {}        # {symbol: {cumPV, cumVol, sessionStart, ...}}
footprint_candles = {} # {symbol+openTime: candle}
order_book = {}        # {symbol: {bids: [[p,q],...], asks: [[p,q],...], ts}}
last_price = {}        # {symbol: price}
depth_history = deque(maxlen=DEPTH_HISTORY_MAX)  # [{ts, bestBid, bestAsk, spread, mid, bidVol, askVol, imbalance}]

# ── Helpers ──

def now():
    return int(time.time() * 1000)


def nice_price_step(minv, maxv):
    """Calcule un step de prix lisible pour les ranges du order book."""
    raw = (maxv - minv) / 10
    exp = 10 ** int(math.log10(raw)) if raw > 0 else 1
    mant = raw / exp if raw > 0 else 1
    if mant < 1.5: return exp
    if mant < 3.5: return 2 * exp
    if mant < 7.5: return 5 * exp
    return 10 * exp


import math  # needed for nice_price_step


# ── Gestion CVD ──

def update_cvd(trade):
    """Ajoute un trade aux buckets CVD de tous les intervalles."""
    ts = trade.get("tsExchange") or now()
    for interval_ms in CVD_INTERVALS_MS:
        start = (ts // interval_ms) * interval_ms
        key = (interval_ms, start)
        bucket = cvd_buckets.get(key)
        if not bucket:
            bucket = {
                "exchange": "binance",
                "symbol": trade["symbol"],
                "intervalMs": interval_ms,
                "startTime": start,
                "endTime": start + interval_ms,
                "buyVol": 0.0,
                "sellVol": 0.0,
                "delta": 0.0,
                "cvd": 0.0,
                "closed": False,
                "tsLocal": now(),
            }
            cvd_buckets[key] = bucket
        vol = trade.get("qty", 0) * trade.get("price", 0)  # notional
        if trade.get("side") == "buy":
            bucket["buyVol"] += vol
            bucket["delta"] += vol
        else:
            bucket["sellVol"] += vol
            bucket["delta"] -= vol
        bucket["cvd"] = bucket.get("_cumulative", 0) + bucket["delta"]
        bucket["tsLocal"] = now()

        # Close old buckets
        for k in list(cvd_buckets.keys()):
            b = cvd_buckets[k]
            if b["endTime"] < ts and not b["closed"]:
                b["closed"] = True
                b["_cumulative"] = (b.get("_cumulative", 0) + b["delta"])


def get_cvd_buckets(interval_ms):
    """Retourne les buckets CVD pour un intervalle, tries par temps."""
    buckets = [b for k, b in cvd_buckets.items() if k[0] == interval_ms]
    buckets.sort(key=lambda b: b["startTime"])
    return buckets


# ── Gestion VWAP ──

def update_vwap(trade):
    """Met à jour le VWAP pour le symbole."""
    sym = trade["symbol"]
    ts = trade.get("tsExchange") or now()
    session_start = (ts // VWAP_SESSION_MS) * VWAP_SESSION_MS

    state = vwap_state.get(sym)
    if not state or state["sessionStart"] != session_start:
        state = {
            "sessionStart": session_start,
            "coverageStart": ts,
            "cumPV": 0.0,
            "cumVol": 0.0,
            "lastTradeTs": 0,
        }
        vwap_state[sym] = state

    price = trade.get("price", 0)
    qty = trade.get("qty", 0)
    state["cumPV"] += price * qty
    state["cumVol"] += qty
    state["lastTradeTs"] = ts

    value = state["cumPV"] / state["cumVol"] if state["cumVol"] > 0 else price
    return {
        "exchange": "binance",
        "symbol": sym,
        "sessionId": str(session_start),
        "sessionStart": session_start,
        "coverageStart": state["coverageStart"],
        "lastUpdateTs": ts,
        "cumPV": state["cumPV"],
        "cumVol": state["cumVol"],
        "value": value,
        "source": "live",
        "isWarm": state["cumVol"] > 100,  # warm after 100 units
        "tsLocal": now(),
    }


# ── Gestion Footprint ──

def update_footprint(trade):
    """Ajoute un trade à la bougie footprint en cours."""
    sym = trade["symbol"]
    ts = trade.get("tsExchange") or now()
    open_time = (ts // FOOTPRINT_INTERVAL_MS) * FOOTPRINT_INTERVAL_MS
    price = trade.get("price", 0)
    qty = trade.get("qty", 0)
    side = trade.get("side", "buy")
    tick = FOOTPRINT_TICK
    bucket_price = round(price / tick) * tick

    key = sym + str(open_time)
    candle = footprint_candles.get(key)
    if not candle:
        candle = {
            "exchange": "binance",
            "symbol": sym,
            "intervalMs": FOOTPRINT_INTERVAL_MS,
            "openTime": open_time,
            "closeTime": open_time + FOOTPRINT_INTERVAL_MS,
            "open": price,
            "high": price,
            "low": price,
            "close": price,
            "volume": 0.0,
            "buyVol": 0.0,
            "sellVol": 0.0,
            "delta": 0.0,
            "poc": 0,
            "closed": False,
            "levels": {},
            "source": "trades",
            "tsLocal": now(),
        }
        footprint_candles[key] = candle

    candle["high"] = max(candle["high"], price)
    candle["low"] = min(candle["low"], price)
    candle["close"] = price
    candle["volume"] += qty
    if side == "buy":
        candle["buyVol"] += qty
        candle["delta"] += qty
    else:
        candle["sellVol"] += qty
        candle["delta"] -= qty

    # Niveau de prix
    level_key = str(bucket_price)
    level = candle["levels"].get(level_key)
    if not level:
        level = {"price": bucket_price, "bid": 0.0, "ask": 0.0, "delta": 0.0, "totalVol": 0.0}
        candle["levels"][level_key] = level
    if side == "buy":
        level["ask"] += qty
        level["delta"] += qty
    else:
        level["bid"] += qty
        level["delta"] -= qty
    level["totalVol"] += qty

    # Close la bougie si dépassée
    if open_time + FOOTPRINT_INTERVAL_MS <= now():
        candle["closed"] = True

    # POC (plus grand volume)
    poc_price = 0
    poc_vol = 0
    for lk, lv in candle["levels"].items():
        if lv["totalVol"] > poc_vol:
            poc_vol = lv["totalVol"]
            poc_price = lv["price"]
    candle["poc"] = poc_price

    # Tronquer les vieilles bougies footprint
    keys = sorted(footprint_candles.keys())
    while len(keys) > FOOTPRINT_MAX_CANDLES:
        del footprint_candles[keys[0]]
        keys = keys[1:]

    return candle


def serialize_footprint(candle):
    """Convertit les levels dict en liste pour le JSON."""
    if not candle:
        return None
    levels = sorted(candle["levels"].values(), key=lambda x: x["price"])
    return {
        "exchange": candle["exchange"],
        "symbol": candle["symbol"],
        "intervalMs": candle["intervalMs"],
        "openTime": candle["openTime"],
        "closeTime": candle["closeTime"],
        "open": candle["open"],
        "high": candle["high"],
        "low": candle["low"],
        "close": candle["close"],
        "volume": round(candle["volume"], 4),
        "buyVol": round(candle["buyVol"], 4),
        "sellVol": round(candle["sellVol"], 4),
        "delta": round(candle["delta"], 4),
        "poc": candle["poc"],
        "closed": candle["closed"],
        "levels": [{"price": l["price"], "bid": round(l["bid"], 4), "ask": round(l["ask"], 4),
                     "delta": round(l["delta"], 4), "totalVol": round(l["totalVol"], 4)}
                    for l in levels],
        "source": candle["source"],
        "tsLocal": candle["tsLocal"],
    }


# ── Order book depuis Binance REST ──

async def fetch_orderbook(symbol="BTCUSDT"):
    """Récupère le carnet d'ordres depuis Binance REST."""
    url = f"https://api.binance.com/api/v3/depth?symbol={symbol}&limit={ORDERBOOK_TOP}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Journal/1.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
        bids = [[float(p), float(q)] for p, q in data.get("bids", [])]
        asks = [[float(p), float(q)] for p, q in data.get("asks", [])]
        ts = now()
        order_book[symbol] = {"bids": bids, "asks": asks, "ts": ts}

        # Calculer les ranges pour l'affichage
        all_prices = [p for p, _ in bids] + [p for p, _ in asks]
        if all_prices:
            min_p = min(all_prices)
            max_p = max(all_prices)
            step = nice_price_step(min_p, max_p)
            bid_ranges = []
            ask_ranges = []
            p = min_p
            while p <= max_p:
                bid_vol = sum(q for bp, q in bids if p <= bp < p + step)
                ask_vol = sum(q for ap, q in asks if p <= ap < p + step)
                if bid_vol or ask_vol:
                    bid_ranges.append({"price": round(p, 2), "vol": round(bid_vol, 4)})
                    ask_ranges.append({"price": round(p, 2), "vol": round(ask_vol, 4)})
                p += step

        # Convertir le format Binance brut en format V6 (objets avec price/size/cumulative/orders)
        best_bid = bids[0][0] if bids else None
        best_ask = asks[0][0] if asks else None
        v6_bids = []
        cum = 0
        for p, q in bids:
            cum += q
            v6_bids.append({"price": p, "size": q, "orders": 0, "cumulative": round(cum, 6)})
        v6_asks = []
        cum = 0
        for p, q in reversed(asks):
            cum += q
            v6_asks.append({"price": p, "size": q, "orders": 0, "cumulative": round(cum, 6)})
        v6_asks.reverse()

        spread = (best_ask - best_bid) if (best_bid and best_ask) else None
        mid = (best_bid + best_ask) / 2 if (best_bid and best_ask) else None

        # Enregistrer un point d'historique depth
        total_bid_vol = sum(q for _, q in bids)
        total_ask_vol = sum(q for _, q in asks)
        imbalance = ((total_bid_vol - total_ask_vol) / (total_bid_vol + total_ask_vol + 1e-9)
                     if (total_bid_vol + total_ask_vol) > 0 else 0)
        depth_history.append({
            "ts": ts,
            "bestBid": best_bid,
            "bestAsk": best_ask,
            "spread": spread,
            "mid": mid,
            "bidVol": total_bid_vol,
            "askVol": total_ask_vol,
            "imbalance": round(imbalance, 4),
        })

        return {
            "exchange": "binance",
            "symbol": symbol,
            "tsLocal": ts,
            "tsExchange": ts,
            "bids": v6_bids,
            "asks": v6_asks,
            "bestBid": best_bid,
            "bestAsk": best_ask,
            "mid": mid,
            "spread": spread,
            "depth": len(v6_bids) + len(v6_asks),
            "source": "live",
            "bidRanges": bid_ranges if all_prices else [],
            "askRanges": ask_ranges if all_prices else [],
        }
    except Exception as e:
        print(f"[WS] orderbook fetch error: {e}")
        return order_book.get(symbol)


# ── Candle history via Flask ──

def fetch_candle_history(symbol="BTCUSDT"):
    """Récupère l'historique des bougies via Hyperliquid API."""
    results = {}
    coin = symbol.replace("USDT", "")
    for interval in CANDLE_HISTORY_INTERVALS:
        url = f"{FLASK_API}/api/hyperliquid/klines?market={coin}&interval={interval}&limit={CANDLE_HISTORY_LIMIT}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Journal/1.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode())

            raw = data.get("candles", [])
            if not raw:
                continue

            history = []
            for c in raw:
                history.append({
                    "symbol": symbol,
                    "openTime": int(c["openTime"]),
                    "closeTime": int(c.get("closeTime", c["openTime"] + 60000)),
                    "open": float(c["open"]),
                    "high": float(c["high"]),
                    "low": float(c["low"]),
                    "close": float(c["close"]),
                    "volume": float(c.get("volume", 0)),
                    "intervalMs": int(c.get("closeTime", c["openTime"] + 60000)) - int(c["openTime"]),
                    "source": "backfill",
                })
            results[interval] = history
            print(f"[WS] loaded {len(history)} {interval} candles from Hyperliquid")
        except Exception as e:
            print(f"[WS] candle history error for {interval}: {e}")

    if results:
        return {"symbol": symbol, "intervals": results}
    return None


# ── Binance WebSocket ──

async def binance_agg_trade_loop():
    """Se connecte au stream aggTrade Binance et traite les messages."""
    symbol = "btcusdt"
    url = f"{BINANCE_WS}/{symbol}@aggTrade"
    while True:
        try:
            async with websockets.connect(url, ping_interval=20) as ws:
                print(f"[WS] Connected to Binance {symbol}@aggTrade")
                async for raw in ws:
                    msg = json.loads(raw)
                    if msg.get("e") != "aggTrade":
                        continue
                    trade = {
                        "exchange": "binance",
                        "symbol": "BTCUSDT",
                        "tradeId": f"{msg['f']}-{msg['l']}",
                        "tsExchange": msg["E"],
                        "tsLocal": now(),
                        "price": float(msg["p"]),
                        "qty": float(msg["q"]),
                        "side": "sell" if msg["m"] else "buy",
                    }
                    trades.append(trade)
                    last_price["BTCUSDT"] = trade["price"]

                    # Mettre à jour les dérivés
                    update_cvd(trade)
                    vwap = update_vwap(trade)
                    fp = update_footprint(trade)

                    # Diffuser aux clients connectés
                    if connected_clients:
                        msg_trade = {
                            "type": "trade",
                            "payload": trade,
                        }
                        msg_vwap = {
                            "type": "vwap",
                            "payload": vwap,
                        }
                        msg_fp = {
                            "type": "footprint_candle",
                            "payload": serialize_footprint(fp),
                        }

                        # Delta buckets fermés
                        closed_buckets = [b for k, b in cvd_buckets.items()
                                          if b["closed"] and k not in sent_buckets]
                        for b in closed_buckets:
                            sent_buckets.add(b["startTime"])

                        bucket_msgs = []
                        for interval_ms in CVD_INTERVALS_MS:
                            buckets = get_cvd_buckets(interval_ms)
                            closed = [b for b in buckets if b["closed"]]
                            if closed:
                                for b in closed:
                                    bucket_msgs.append({
                                        "type": "delta_bucket",
                                        "payload": b,
                                    })

                        # Envoyer tout en une fois
                        for client in connected_clients.copy():
                            try:
                                await client.send(json.dumps(msg_trade))
                                await client.send(json.dumps(msg_vwap))
                                if fp:
                                    await client.send(json.dumps(msg_fp))
                                for bm in bucket_msgs:
                                    await client.send(json.dumps(bm))
                            except Exception:
                                connected_clients.discard(client)
        except Exception as e:
            print(f"[WS] Binance aggTrade error: {e}, reconnecting in 5s...")
            await asyncio.sleep(5)


sent_buckets = set()


# ── Historique CVD ──

async def fetch_historical_trades(symbol="BTCUSDT"):
    """Récupère les aggTrades récents via l'API Flask pour backfill CVD."""
    url = f"{FLASK_API}/api/market/aggtrades?symbol={symbol}&limit=8000"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Journal/1.0"})
        loop = asyncio.get_event_loop()
        def do_fetch():
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read().decode())
        data = await loop.run_in_executor(None, do_fetch)
        raw_trades = data.get("trades", [])
        trades_list = []
        for t in raw_trades:
            trades_list.append({
                "exchange": "binance",
                "symbol": symbol,
                "tradeId": t["id"],
                "tsExchange": t["time"],
                "tsLocal": now(),
                "price": float(t["price"]),
                "qty": float(t["qty"]),
                "side": t["side"],
            })
        return trades_list
    except Exception as e:
        print(f"[WS] historical trades error from Flask API: {e}, falling back to Binance direct")
        fallback_url = f"https://api.binance.com/api/v3/aggTrades?symbol={symbol}&limit=1000"
        try:
            req = urllib.request.Request(fallback_url, headers={"User-Agent": "Journal/1.0"})
            loop = asyncio.get_event_loop()
            def do_fallback():
                with urllib.request.urlopen(req, timeout=10) as resp:
                    return json.loads(resp.read().decode())
            data = await loop.run_in_executor(None, do_fallback)
            trades_list = []
            for t in data:
                trades_list.append({
                    "exchange": "binance",
                    "symbol": symbol,
                    "tradeId": f"{t['f']}-{t['l']}",
                    "tsExchange": t["E"],
                    "tsLocal": now(),
                    "price": float(t["p"]),
                    "qty": float(t["q"]),
                    "side": "sell" if t["m"] else "buy",
                })
            return trades_list
        except Exception as ex:
            print(f"[WS] historical trades fallback error: {ex}")
            return []


def parse_timeframe_to_ms(tf):
    if not tf:
        return 60000
    try:
        val = int(tf[:-1])
        unit = tf[-1].lower()
        if unit == "m":
            return val * 60000
        elif unit == "h":
            return val * 3600000
        elif unit == "d":
            return val * 86400000
    except Exception:
        pass
    return 60000


def compute_size_cvd_history(timeframe="1m"):
    """Calcule l'historique CVD par taille notionnelle (s, m, l) sur bougies de la timeframe demandée
    à partir des trades stockés en mémoire.
    """
    buckets_config = [
        {"key": "s", "min": 1, "max": 1000},
        {"key": "m", "min": 1000, "max": 10000},
        {"key": "l", "min": 10000, "max": 1e12},
    ]
    interval_ms = parse_timeframe_to_ms(timeframe)
    trades_by_minute = defaultdict(list)
    for t in trades:
        ts = t.get("tsExchange") or t.get("tsLocal") or now()
        bucket_start = (ts // interval_ms) * interval_ms
        trades_by_minute[bucket_start].append(t)

    sorted_minutes = sorted(trades_by_minute.keys())
    running_cvd = {"s": 0.0, "m": 0.0, "l": 0.0}
    series = {"s": [], "m": [], "l": []}
    delta_vol = []

    for minute in sorted_minutes:
        minute_trades = trades_by_minute[minute]
        minute_deltas = {"s": 0.0, "m": 0.0, "l": 0.0}
        net_delta = 0.0
        for t in minute_trades:
            price = float(t.get("price") or 0)
            qty = float(t.get("qty") or 0)
            notional = qty * price
            if notional <= 0:
                continue
            side = t.get("side", "buy")
            signed = -qty if side == "sell" else qty
            bucket_key = None
            for b in buckets_config:
                if notional >= b["min"] and notional < b["max"]:
                    bucket_key = b["key"]
                    break
            if bucket_key:
                minute_deltas[bucket_key] += signed
            net_delta += signed

        for k in ["s", "m", "l"]:
            running_cvd[k] += minute_deltas[k]
            series[k].append({"t": minute, "v": running_cvd[k]})
        delta_vol.append({"t": minute, "delta": net_delta})

    return {
        "series": series,
        "deltaVol": delta_vol,
        "cvd": running_cvd
    }


async def send_cvd_history(ws, timeframe="1m"):
    """Envoie l'historique CVD complet à un client qui se connecte."""
    history = compute_size_cvd_history(timeframe)
    try:
        await ws.send(json.dumps({
            "type": "cvd_init",
            "payload": history,
        }))
        total_pts = sum(len(pts) for pts in history["series"].values())
        print(f"[WS] sent CVD history ({timeframe}): {total_pts} points")
    except Exception as e:
        print(f"[WS] error sending CVD history: {e}")


async def send_depth_history(ws):
    """Envoie l'historique depth complet à un client qui se connecte."""
    if not depth_history:
        return
    points = list(depth_history)
    try:
        await ws.send(json.dumps({
            "type": "depth_history",
            "payload": {"points": points},
        }))
        print(f"[WS] sent depth history: {len(points)} points")
    except Exception as e:
        print(f"[WS] error sending depth history: {e}")


async def binance_depth_loop():
    """Récupère l'order book périodiquement et le diffuse."""
    while True:
        await asyncio.sleep(2)  # every 2 seconds
        book = await fetch_orderbook()
        if book and connected_clients:
            # Ajouter le dernier point depth_history au message
            depth_point = list(depth_history)[-1] if depth_history else None
            if depth_point:
                book["depthHistoryPoint"] = depth_point
            msg = {"type": "order_book", "payload": book}
            for client in connected_clients.copy():
                try:
                    await client.send(json.dumps(msg))
                except Exception:
                    connected_clients.discard(client)


# ── Gestion des clients WebSocket ──

async def handler(ws):
    """Gère un client WebSocket V6."""
    connected_clients.add(ws)
    addr = ws.remote_address
    print(f"[WS] Client connected: {addr}")

    # Envoyer l'historique CVD initial au nouveau client (timeframe par défaut 1m)
    await send_cvd_history(ws, "1m")
    # Envoyer l'historique depth au nouveau client
    await send_depth_history(ws)

    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            if not isinstance(msg, dict):
                continue

            # Le client peut demander du candle history
            if msg.get("type") == "candle_history":
                sym = msg.get("symbol", "BTCUSDT")
                history = fetch_candle_history(sym)
                if history:
                    await ws.send(json.dumps({
                        "type": "candle_history",
                        "payload": history,
                    }))
            
            # Le client demande l'historique CVD d'une timeframe
            elif msg.get("type") == "cvd_history_request":
                tf = msg.get("timeframe", "1m")
                print(f"[WS] Client requested CVD history for timeframe: {tf}")
                await send_cvd_history(ws, tf)

    except websockets.exceptions.ConnectionClosed:
         pass
    finally:
        connected_clients.discard(ws)
        print(f"[WS] Client disconnected: {addr}")


# ── Message heartbeat périodique ──

async def heartbeat_loop():
    """Envoie un heartbeat toutes les 5 secondes."""
    while True:
        await asyncio.sleep(5)
        if connected_clients:
            msg = {"type": "heartbeat", "ts": now()}
            for client in connected_clients.copy():
                try:
                    await client.send(json.dumps(msg))
                except Exception:
                    connected_clients.discard(client)


# ── Démarrage ──

async def backfill_cvd():
    """Backfill les trades historiques Binance pour initialiser le CVD."""
    # Attendre que Flask API soit disponible (max 10s)
    for attempt in range(20):
        try:
            req = urllib.request.Request(FLASK_API + "/api/market/time")
            with urllib.request.urlopen(req, timeout=1) as resp:
                if resp.status == 200:
                    break
        except Exception:
            await asyncio.sleep(0.5)
    historical = await fetch_historical_trades()
    if historical:
        for t in historical:
            trades.append(t)
            update_cvd(t)
        print(f"[WS] CVD backfilled: {len(historical)} historical trades processed. Global trades size: {len(trades)}")
    else:
        print("[WS] CVD backfill: no historical trades fetched")


async def main():
    print(f"[WS] Starting market server on {WS_HOST}:{WS_PORT}")

    # Backfill CVD depuis l'historique Binance
    await backfill_cvd()

    # Lancer les boucles Binance + heartbeat en arrière-plan
    asyncio.create_task(binance_agg_trade_loop())
    asyncio.create_task(binance_depth_loop())
    asyncio.create_task(heartbeat_loop())

    # Serveur WS
    async with websockets.serve(handler, WS_HOST, WS_PORT):
        print(f"[WS] Ready on ws://{WS_HOST}:{WS_PORT}/stream")
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    asyncio.run(main())
