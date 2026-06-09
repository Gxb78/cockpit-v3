"""Phase 6: Per-panel settings flyout + responsive hardening smoke tests."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _ps_js():
    return (ROOT / 'static/js/split/092_v6_panel_settings.js').read_text(encoding='utf-8')


def _shell_js():
    return (ROOT / 'static/js/split/080_v6_layout_shell.js').read_text(encoding='utf-8')


def _ps_css():
    return (ROOT / 'static/css/split/079_v6_panel_settings.css').read_text(encoding='utf-8')


def _resp_css():
    return (ROOT / 'static/css/split/079_v6_responsive.css').read_text(encoding='utf-8')


# ── PanelSettings JS ──────────────────────────────────────────────

def test_panel_settings_file_exists():
    assert (ROOT / 'static/js/split/092_v6_panel_settings.js').exists()


def test_panel_settings_registered():
    assert "register('UI', 'PanelSettings'" in _ps_js()


def test_panel_settings_has_open():
    assert 'open:' in _ps_js() or 'open :' in _ps_js()


def test_panel_settings_has_close():
    assert 'close:' in _ps_js() or 'close :' in _ps_js()


def test_dom_fields_present():
    src = _ps_js()
    assert 'domDepth' in src
    assert 'wallScoreMin' in src


def test_tape_fields_present():
    src = _ps_js()
    assert 'minQty' in src
    assert 'maxRows' in src
    assert 'tapeFontSize' in src


def test_panel_settings_writes_to_store():
    assert 'updateSettings' in _ps_js()


def test_panel_settings_outside_click_close():
    assert 'outsideClose' in _ps_js()


def test_panel_settings_positioned_fixed():
    assert 'getBoundingClientRect' in _ps_js()


# ── Shell JS wiring ───────────────────────────────────────────────

def test_shell_wires_panel_settings():
    assert "panel-settings" in _shell_js()


def test_shell_calls_panel_settings_open():
    assert 'PanelSettings.open' in _shell_js()


# ── PanelSettings CSS ─────────────────────────────────────────────

def test_ps_css_file_exists():
    assert (ROOT / 'static/css/split/079_v6_panel_settings.css').exists()


def test_ps_css_flyout_class():
    assert '.v6-ps-flyout' in _ps_css()


def test_ps_css_input_class():
    assert '.v6-ps-input' in _ps_css()


def test_ps_css_no_important():
    no_comments = re.sub(r'/\*.*?\*/', '', _ps_css(), flags=re.DOTALL)
    assert '!important' not in no_comments


def test_ps_css_no_hardcoded_hex():
    no_comments = re.sub(r'/\*.*?\*/', '', _ps_css(), flags=re.DOTALL)
    assert not re.search(r'(?<![a-z]):\s*#[0-9a-fA-F]{3,6}', no_comments)


# ── Responsive CSS ────────────────────────────────────────────────

def test_responsive_css_file_exists():
    assert (ROOT / 'static/css/split/079_v6_responsive.css').exists()


def test_responsive_has_media_queries():
    assert '@media' in _resp_css()


def test_responsive_center_col_min_width():
    assert 'v6-center-col' in _resp_css()


def test_responsive_right_col_min_width():
    assert 'v6-right-col' in _resp_css()


def test_responsive_no_hardcoded_hex():
    no_comments = re.sub(r'/\*.*?\*/', '', _resp_css(), flags=re.DOTALL)
    assert not re.search(r'(?<![a-z]):\s*#[0-9a-fA-F]{3,6}', no_comments)
