"""Smoke-test: CvdPanel.draw is exported and accepts the viewport argument."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_cvd_panel_draw_exported():
    src = (ROOT / 'static/js/split/076_v6_cvd_panel.js').read_text(encoding='utf-8')
    assert 'Panels.CvdPanel.draw' in src, "CvdPanel.draw not exported"


def test_cvd_panel_draw_accepts_viewport():
    src = (ROOT / 'static/js/split/076_v6_cvd_panel.js').read_text(encoding='utf-8')
    assert re.search(r'CvdPanel\.draw\s*=\s*function\s*\([^)]*vp', src), \
        "CvdPanel.draw signature missing vp parameter"


def test_cvd_panel_draw_has_fallback():
    src = (ROOT / 'static/js/split/076_v6_cvd_panel.js').read_text(encoding='utf-8')
    assert 'Fallback' in src or 'fallback' in src, "CvdPanel.draw missing fallback path"


def test_chart_viewport_stored_on_canvas():
    src = (ROOT / 'static/js/split/077_v6_canvas_chart.js').read_text(encoding='utf-8')
    assert '_v6vp' in src, "Viewport not stored on canvas as _v6vp"


def test_suppress_bottom_gutter_flag():
    src = (ROOT / 'static/js/split/077_v6_canvas_chart.js').read_text(encoding='utf-8')
    assert 'suppressBottomGutter' in src, "suppressBottomGutter flag not present in chart renderer"


def test_css_chart_cell_file_exists():
    css = ROOT / 'static/css/split/075_v6_chart_cell.css'
    assert css.exists(), "075_v6_chart_cell.css not created"


def test_css_no_important():
    css = (ROOT / 'static/css/split/075_v6_chart_cell.css').read_text(encoding='utf-8')
    no_comments = re.sub(r'/\*.*?\*/', '', css, flags=re.DOTALL)
    assert '!important' not in no_comments, "!important found outside comments in 075_v6_chart_cell.css"


def test_css_no_hardcoded_colors():
    css = (ROOT / 'static/css/split/075_v6_chart_cell.css').read_text(encoding='utf-8')
    no_comments = re.sub(r'/\*.*?\*/', '', css, flags=re.DOTALL)
    assert not re.search(r':\s*#[0-9a-fA-F]{3,6}', no_comments), \
        "Hardcoded hex color found in 075_v6_chart_cell.css"
    assert not re.search(r':\s*rgba?\(', no_comments), \
        "Hardcoded rgba() found in 075_v6_chart_cell.css"
