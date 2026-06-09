"""Orderbook panel smoke tests."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _ob_js():
    return (ROOT / 'static/js/split/093_v6_orderbook_panel.js').read_text(encoding='utf-8')


def _shell_js():
    return (ROOT / 'static/js/split/080_v6_layout_shell.js').read_text(encoding='utf-8')


def _layout_js():
    return (ROOT / 'static/js/split/073_v6_orderflow_layout.js').read_text(encoding='utf-8')


def _ob_css():
    return (ROOT / 'static/css/split/080_v6_orderbook_panel.css').read_text(encoding='utf-8')


# ── Orderbook JS ──────────────────────────────────────────────────

def test_orderbook_panel_file_exists():
    assert (ROOT / 'static/js/split/093_v6_orderbook_panel.js').exists()


def test_orderbook_panel_exported():
    assert 'Panels.OrderbookPanel' in _ob_js()


def test_orderbook_render_into():
    assert 'renderInto' in _ob_js()


def test_orderbook_uses_bids_asks():
    src = _ob_js()
    assert 'snap.bids' in src or "'bids'" in src
    assert 'snap.asks' in src or "'asks'" in src


def test_orderbook_spread_row():
    assert 'spreadRowHtml' in _ob_js() or 'v6-ob-spread' in _ob_js()


def test_orderbook_depth_bar():
    assert 'v6-ob-bar' in _ob_js()


def test_orderbook_cumulative_scaling():
    assert 'maxCum' in _ob_js()


def test_orderbook_empty_state():
    assert 'No orderbook data' in _ob_js()


def test_orderbook_premium_header():
    src = _ob_js()
    assert 'v6-panel-tick' in src
    assert 'v6-panel-title' in src


def test_orderbook_no_hardcoded_hex():
    assert not re.search(r"'#[0-9a-fA-F]{3,6}'", _ob_js())


# ── Shell wiring ──────────────────────────────────────────────────

def test_shell_has_orderbook_panel_spec():
    assert "'orderbook'" in _shell_js() or '"orderbook"' in _shell_js()


def test_shell_default_schema_includes_orderbook():
    src = _shell_js()
    assert 'orderbook' in src


# ── Layout wiring ─────────────────────────────────────────────────

def test_layout_has_orderbook_panel_html():
    assert 'v6-panel-orderbook' in _layout_js() or 'data-v6-ob-panel' in _layout_js()


def test_layout_calls_orderbook_render():
    assert 'OrderbookPanel.renderInto' in _layout_js()


# ── CSS ───────────────────────────────────────────────────────────

def test_ob_css_file_exists():
    assert (ROOT / 'static/css/split/080_v6_orderbook_panel.css').exists()


def test_ob_css_no_important():
    no_comments = re.sub(r'/\*.*?\*/', '', _ob_css(), flags=re.DOTALL)
    assert '!important' not in no_comments


def test_ob_css_no_hardcoded_hex():
    no_comments = re.sub(r'/\*.*?\*/', '', _ob_css(), flags=re.DOTALL)
    assert not re.search(r'(?<![a-z]):\s*#[0-9a-fA-F]{3,6}', no_comments)


def test_ob_css_depth_bar():
    assert '.v6-ob-bar' in _ob_css()


def test_ob_css_spread_row():
    assert '.v6-ob-spread' in _ob_css()
