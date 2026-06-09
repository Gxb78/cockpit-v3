"""Phase 5: Layout picker + panel close smoke tests."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _lp_js():
    return (ROOT / 'static/js/split/091_v6_layout_picker.js').read_text(encoding='utf-8')


def _shell_js():
    return (ROOT / 'static/js/split/080_v6_layout_shell.js').read_text(encoding='utf-8')


def _lp_css():
    return (ROOT / 'static/css/split/078_v6_layout_picker.css').read_text(encoding='utf-8')


# ── Layout picker JS ───────────────────────────────────────────────

def test_layout_picker_file_exists():
    assert (ROOT / 'static/js/split/091_v6_layout_picker.js').exists()


def test_layout_picker_registered():
    assert "register('UI', 'LayoutPicker'" in _lp_js()


def test_layout_picker_has_init():
    assert 'init:' in _lp_js() or 'init :' in _lp_js()


def test_layout_picker_has_open():
    assert 'open:' in _lp_js() or 'open :' in _lp_js()


def test_layout_picker_has_close():
    assert 'close:' in _lp_js() or 'close :' in _lp_js()


def test_preset_keys_present():
    src = _lp_js()
    for key in ['single', 'vsplit', 'hsplit', 'one-plus-two', 'three', '2x2']:
        assert key in src, f"Preset key '{key}' missing"


def test_sync_toggles_symbol_interval_crosshair():
    src = _lp_js()
    for key in ['symbol', 'interval', 'crosshair']:
        assert key in src, f"SYNC key '{key}' missing"


def test_add_panel_logic():
    assert 'data-v6-add-panel' in _lp_js()


def test_build_schema_exported():
    assert 'buildSchema' in _lp_js()


def test_popover_html_function():
    assert 'popoverHtml' in _lp_js()


def test_no_hardcoded_hex_in_js():
    src = _lp_js()
    assert not re.search(r"'#[0-9a-fA-F]{3,6}'", src), "Hardcoded hex color string in picker JS"


# ── Shell JS ──────────────────────────────────────────────────────

def test_shell_wires_panel_close():
    assert "panel-close" in _shell_js()


def test_shell_calls_layout_picker_init():
    assert 'LayoutPicker.init' in _shell_js()


def test_panel_close_removes_from_schema():
    src = _shell_js()
    assert 'filter' in src, "panel-close handler should filter schema arrays"


# ── Layout picker CSS ─────────────────────────────────────────────

def test_lp_css_file_exists():
    assert (ROOT / 'static/css/split/078_v6_layout_picker.css').exists()


def test_lp_css_no_important():
    no_comments = re.sub(r'/\*.*?\*/', '', _lp_css(), flags=re.DOTALL)
    assert '!important' not in no_comments


def test_lp_css_no_hardcoded_hex():
    no_comments = re.sub(r'/\*.*?\*/', '', _lp_css(), flags=re.DOTALL)
    # rgba(0,0,0,...) for box-shadow shadow opacity is allowed; forbid token-replacing hex
    assert not re.search(r'(?<![a-z]):\s*#[0-9a-fA-F]{3,6}', no_comments), \
        "Hardcoded hex token color found"


def test_lp_css_preset_class():
    assert '.v6-lp-preset' in _lp_css()


def test_lp_css_sync_class():
    assert '.v6-lp-sync' in _lp_css()


def test_lp_css_add_chip():
    assert '.v6-lp-add-chip' in _lp_css()
