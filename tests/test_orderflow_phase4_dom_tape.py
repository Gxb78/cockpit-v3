"""Phase 4: DOM + Tape redesign smoke tests."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


# ── DOM JS ──────────────────────────────────────────────────────────────

def _dom_js():
    return (ROOT / 'static/js/split/075_v6_dom_panel.js').read_text(encoding='utf-8')


def test_dom_premium_header_tick():
    assert 'v6-panel-tick' in _dom_js(), "DOM header missing .v6-panel-tick"


def test_dom_premium_header_title():
    assert 'v6-panel-title' in _dom_js(), "DOM header missing .v6-panel-title"


def test_dom_premium_header_meta():
    assert 'v6-panel-meta' in _dom_js(), "DOM header missing .v6-panel-meta"


def test_dom_sigma_footer_present():
    src = _dom_js()
    assert 'v6-dom-sigma-footer' in src, "DOM sigma footer container missing"
    assert 'data-dom-sigma="bid"' in src, "DOM sigma bid slot missing"
    assert 'data-dom-sigma="ask"' in src, "DOM sigma ask slot missing"


def test_dom_sigma_sum_logic():
    src = _dom_js()
    assert 'sumBid' in src and 'sumAsk' in src, "DOM renderStats missing sigma sum logic"


def test_dom_grouping_in_header():
    src = _dom_js()
    assert 'v6-panel-grp' in src, "DOM grouping select not in premium header"


# ── DOM CSS ─────────────────────────────────────────────────────────────

def _dom_css():
    return (ROOT / 'static/css/split/076_v6_dom_redesign.css').read_text(encoding='utf-8')


def test_dom_css_file_exists():
    assert (ROOT / 'static/css/split/076_v6_dom_redesign.css').exists()


def test_dom_css_no_important():
    no_comments = re.sub(r'/\*.*?\*/', '', _dom_css(), flags=re.DOTALL)
    assert '!important' not in no_comments


def test_dom_css_no_hardcoded_colors():
    no_comments = re.sub(r'/\*.*?\*/', '', _dom_css(), flags=re.DOTALL)
    assert not re.search(r'(?<!var\():\s*#[0-9a-fA-F]{3,6}', no_comments), \
        "Hardcoded hex color found"


def test_dom_css_wall_classes():
    css = _dom_css()
    assert 'is-wall-major' in css, "DOM CSS missing is-wall-major"
    assert 'is-wall-soft' in css, "DOM CSS missing is-wall-soft"


def test_dom_css_depth_bars():
    css = _dom_css()
    assert '.v6-dom-bar.is-bid' in css, "DOM CSS missing .v6-dom-bar.is-bid"
    assert '.v6-dom-bar.is-ask' in css, "DOM CSS missing .v6-dom-bar.is-ask"


def test_dom_css_mid_band():
    assert 'is-mid' in _dom_css(), "DOM CSS missing is-mid band"


def test_dom_css_sigma_footer():
    assert 'v6-dom-sigma-footer' in _dom_css(), "DOM CSS missing sigma footer"


# ── Tape JS ─────────────────────────────────────────────────────────────

def _tape_js():
    return (ROOT / 'static/js/split/074_v6_tape_panel.js').read_text(encoding='utf-8')


def test_tape_premium_header():
    assert 'v6-tape-header' in _tape_js(), "Tape shell missing .v6-tape-header"


def test_tape_pressure_bar():
    src = _tape_js()
    assert 'v6-tape-pressure-bar' in src, "Tape missing pressure bar"
    assert 'pressureBuy' in src, "Tape missing pressureBuy update logic"


def test_tape_szbar_in_row():
    assert 'v6-tape-szbar' in _tape_js(), "renderTapeRow missing .v6-tape-szbar"


def test_tape_is_big_class():
    assert 'is-big' in _tape_js(), "renderTapeRow missing is-big class"


# ── Tape CSS ────────────────────────────────────────────────────────────

def _tape_css():
    return (ROOT / 'static/css/split/077_v6_tape_redesign.css').read_text(encoding='utf-8')


def test_tape_css_file_exists():
    assert (ROOT / 'static/css/split/077_v6_tape_redesign.css').exists()


def test_tape_css_no_important():
    no_comments = re.sub(r'/\*.*?\*/', '', _tape_css(), flags=re.DOTALL)
    assert '!important' not in no_comments


def test_tape_css_no_hardcoded_hex():
    no_comments = re.sub(r'/\*.*?\*/', '', _tape_css(), flags=re.DOTALL)
    assert not re.search(r'(?<!var\():\s*#[0-9a-fA-F]{3,6}', no_comments), \
        "Hardcoded hex color found in tape CSS"


def test_tape_css_pressure_bar():
    assert 'v6-tape-pressure-bar' in _tape_css()


def test_tape_css_szbar():
    assert 'v6-tape-szbar' in _tape_css()


def test_tape_css_is_big():
    assert 'is-big' in _tape_css()
