"""Trade math — Canonical backend logic for PnL, RR, direction, win/loss.

Mirrors deriveTradeMetrics() in static/js/split/001_utilities.js.
Single source of truth for all backend trade math.
"""

from __future__ import annotations

from typing import Any


def _to_float(value: Any) -> float | None:
    """Safely parse a value as float. Returns None if unparseable."""
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


_as_float = _to_float  # alias for backward compat with 03_core_helpers


def _infer_trade_direction(trade: dict) -> str | None:
    """Infer trade direction from explicit field or price levels.

    Checks direction field first, then falls back to entry/stop/target.
    """
    direction = (trade.get("direction") or "").strip().lower()
    if direction in {"long", "short"}:
        return direction
    entry = _to_float(trade.get("entry_price"))
    stop = _to_float(trade.get("stop_loss"))
    target = _to_float(trade.get("take_profit"))
    if entry is not None and stop is not None and stop != entry:
        return "long" if stop < entry else "short"
    if entry is not None and target is not None and target != entry:
        return "long" if target > entry else "short"
    return None


def derive_trade_metrics(trade: dict) -> dict:
    """Compute derived trade metrics: direction, pnl, rr, is_win.

    Mirrors deriveTradeMetrics() in 001_utilities.js.

    Returns:
        dict with keys: direction, pnl, pnl_known, is_win, rr
    """
    rr_value = _to_float(trade.get("rr"))
    pnl_value = _to_float(trade.get("pnl"))
    is_win = trade.get("is_win")
    entry = _to_float(trade.get("entry_price"))
    stop = _to_float(trade.get("stop_loss"))
    target = _to_float(trade.get("take_profit"))
    exit_price = _to_float(trade.get("exit_price"))
    qty = _to_float(trade.get("position_size"))
    if qty is None or qty <= 0:
        qty = 1.0

    direction = _infer_trade_direction(trade)

    # Derive PnL from exit price if not explicitly set
    pnl_derived = None
    if direction and entry is not None and exit_price is not None:
        if direction == "long":
            pnl_derived = (exit_price - entry) * qty
        else:
            pnl_derived = (entry - exit_price) * qty

    # Derive is_win from explicit flag, pnl, or derived pnl
    is_win_derived = None
    if is_win in (0, 1):
        is_win_derived = int(is_win)
    elif pnl_value is not None and pnl_value != 0:
        is_win_derived = 1 if pnl_value > 0 else 0
    elif pnl_derived is not None and pnl_derived != 0:
        is_win_derived = 1 if pnl_derived > 0 else 0

    # Derive RR from levels or exit
    rr_derived = rr_value
    if rr_derived is None and entry is not None and stop is not None and stop != entry:
        risk = abs(entry - stop)
        if risk > 0:
            if target is not None:
                rr_derived = abs(target - entry) / risk
            elif exit_price is not None:
                rr_derived = abs(exit_price - entry) / risk
                if is_win_derived == 0:
                    rr_derived = -rr_derived

    pnl_effective = pnl_value if pnl_value is not None else pnl_derived
    pnl_known = pnl_effective is not None
    if pnl_effective is None:
        pnl_effective = 0

    return {
        "direction": direction,
        "pnl": pnl_effective,
        "pnl_known": pnl_known,
        "is_win": is_win_derived,
        "rr": rr_derived,
    }


# Aliases for backward compatibility with 12_stats_math.py
_derive_trade_metrics = derive_trade_metrics
_infer_trade_direction_for_validation = _infer_trade_direction
