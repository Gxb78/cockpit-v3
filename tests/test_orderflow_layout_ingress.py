import json
import os
import subprocess
import textwrap
import unittest


PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAYOUT_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "073_v6_orderflow_layout.js")
CANVAS_CHART_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "077_v6_canvas_chart.js")
RESIZABLE_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "088_v6_resizable_panels.js")
WORKSPACE_JS = os.path.join(PROJECT_DIR, "static", "js", "split", "089_v6_workspace_manager.js")
EXO_CSS = os.path.join(PROJECT_DIR, "static", "css", "split", "084_v6_exocharts_clean.css")


class OrderflowLayoutIngressTests(unittest.TestCase):
    def setUp(self):
        try:
            subprocess.run(["node", "--version"], capture_output=True, check=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
            self.skipTest("node non disponible")

    def _run_node(self, script):
        result = subprocess.run(
            ["node", "-e", script],
            cwd=PROJECT_DIR,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_resize_document_handlers_are_drag_scoped_and_idempotent(self):
        with open(LAYOUT_JS, encoding="utf-8") as fh:
            src = fh.read()
        self.assertIn("function cleanupActiveResizeDrag(ctx)", src)
        self.assertIn("function beginResizeDragListeners(handle, pointerId, moveFn, endFn)", src)
        self.assertIn("cleanupActiveResizeDrag(ctx);", src)
        self.assertIn("ctx.resizeDragAbortController", src)
        self.assertIn("setPointerCapture", src)
        self.assertIn("releasePointerCapture", src)
        self.assertIn("target.addEventListener('pointermove', moveFn", src)
        self.assertIn("target.addEventListener('pointerup', endFn", src)
        self.assertIn("target.addEventListener('pointercancel', endFn", src)
        self.assertIn("beginResizeDragListeners(resizeHandle, e.pointerId, onDomResizeMove, onDomResizeEnd)", src)
        self.assertIn("beginResizeDragListeners(cvdResizeHandle, e.pointerId, onCvdResizeMove, onCvdResizeEnd)", src)
        self.assertIn("addResizeListener(resizeHandle, 'pointerdown', onDomResizeStart)", src)
        self.assertIn("addResizeListener(cvdResizeHandle, 'pointerdown', onCvdResizeStart)", src)
        self.assertNotIn("addResizeListener(document, 'mousemove'", src)
        self.assertNotIn("addResizeListener(document, 'mouseup'", src)
        self.assertNotIn("addResizeListener(resizeHandle, 'mousedown'", src)
        self.assertNotIn("addResizeListener(cvdResizeHandle, 'mousedown'", src)

    def test_resize_drag_does_not_reallocate_canvas_buffers_per_frame(self):
        with open(LAYOUT_JS, encoding="utf-8") as fh:
            src = fh.read()
        self.assertIn("function scheduleResizePreview(ctx)", src)
        self.assertIn("function redrawResizeTargets(root, state)", src)
        self.assertIn("resizeOrderflowCanvases(root);\n    var st = V6OF.getStore", src)
        self.assertIn("if (st) redrawResizeTargets(root, st.getState());", src)
        final_resize = src[src.index("function finalResizeRender"):src.index("function scheduleWindowResizeRender")]
        self.assertNotIn("render(root", final_resize)
        self.assertIn("scheduleResizePreview(ctx);", src)
        dom_move = src[src.index("var onDomResizeMove"):src.index("var onDomResizeEnd")]
        cvd_move = src[src.index("var onCvdResizeMove"):src.index("var onCvdResizeEnd")]
        self.assertNotIn("resizeOrderflowCanvases(root)", dom_move)
        self.assertNotIn("resizeOrderflowCanvases(root)", cvd_move)

    def test_window_resize_is_throttled_with_debounced_final_render(self):
        with open(LAYOUT_JS, encoding="utf-8") as fh:
            src = fh.read()

        self.assertIn("function scheduleWindowResizeRender(root, store, ctx)", src)
        scheduler = src[src.index("function scheduleWindowResizeRender"):src.index("function redrawResizeTargets")]
        self.assertIn("ctx.windowResizeRaf", scheduler)
        self.assertIn("requestAnimationFrame(function ()", scheduler)
        self.assertIn("redrawResizeTargets(root, state);", scheduler)
        self.assertIn("ctx.windowResizeFinalTimer = setTimeout(function ()", scheduler)
        self.assertIn("render(root, store.getState(), true);", scheduler)

        listener_block = src[src.index("var onResize = function ()"):src.index("window.addEventListener('resize', onResize);")]
        self.assertIn("scheduleWindowResizeRender(root, store, ctx);", listener_block)
        self.assertNotIn("render(root", listener_block)

        cleanup_block = src[src.index("function cleanupResizeListeners"):src.index("function cleanupActiveResizeDrag")]
        self.assertIn("ctx.windowResizeRaf", cleanup_block)
        self.assertIn("ctx.windowResizeFinalTimer", cleanup_block)

    def test_post_toggle_rerenders_are_coalesced(self):
        with open(LAYOUT_JS, encoding="utf-8") as fh:
            src = fh.read()

        self.assertIn("function scheduleCoalescedRender(root, store, ctx, delayMs)", src)
        scheduler = src[src.index("function scheduleCoalescedRender"):src.index("function redrawResizeTargets")]
        self.assertIn("ctx.coalescedRenderTimer", scheduler)
        self.assertIn("clearTimeout(ctx.coalescedRenderTimer)", scheduler)
        self.assertIn("render(root, store.getState(), true);", scheduler)

        action_block = src[src.index("addPanelToggle('Chart'"):src.index("} else if (action === 'layer')")]
        self.assertIn("scheduleCoalescedRender(root, st, ctx, 50);", action_block)
        self.assertIn("scheduleCoalescedRender(root, _st1, ctx, 150);", action_block)
        self.assertIn("scheduleCoalescedRender(root, _st2, ctx, 150);", action_block)
        self.assertNotIn("setTimeout(function () { render(root", action_block)
        self.assertNotIn("setTimeout(function() { render(root", action_block)

        cleanup_block = src[src.index("function cleanupResizeListeners"):src.index("function cleanupActiveResizeDrag")]
        self.assertIn("ctx.coalescedRenderTimer", cleanup_block)

    def test_final_resize_redraws_only_canvases_and_ladder(self):
        with open(LAYOUT_JS, encoding="utf-8") as fh:
            src = fh.read()
        resize_redraw = src[src.index("function redrawResizeTargets"):src.index("function scheduleResizePreview")]
        self.assertIn("V6OF.CanvasChart.draw(chartCanvas, makeChartRenderState(state));", resize_redraw)
        self.assertIn("V6OF.Panels.CvdPanel.draw(cvdCanvas, state", resize_redraw)
        self.assertIn("V6OF.DomPanel.render(domList, V6OF.DomLadder ? V6OF.DomLadder.snapshot() : null, state);", resize_redraw)
        self.assertNotIn("render(root", resize_redraw)
        self.assertNotIn("syncInputs(root", resize_redraw)
        self.assertNotIn("OrderbookPanel.renderInto", resize_redraw)

    def test_exocharts_dom_width_has_no_legacy_right_col_writer(self):
        with open(LAYOUT_JS, encoding="utf-8") as fh:
            layout_src = fh.read()
        with open(RESIZABLE_JS, encoding="utf-8") as fh:
            resizable_src = fh.read()
        with open(WORKSPACE_JS, encoding="utf-8") as fh:
            workspace_src = fh.read()
        with open(EXO_CSS, encoding="utf-8") as fh:
            exo_css = fh.read()

        self.assertIn("grid-template-columns: var(--exo-tools) 1fr var(--exo-dom);", exo_css)
        exo_dom_block = exo_css[exo_css.index(".exo-dom-panel {"):exo_css.index(".exo-dom-panel.exo-dom-collapsed")]
        self.assertNotRegex(exo_dom_block, r"(?m)^\s*width\s*:")

        self.assertIn("root.style.setProperty('--exo-dom'", layout_src)
        self.assertNotIn("v6-right-col", layout_src)

        self.assertIn("function isExoLayout(root)", resizable_src)
        self.assertIn("if (isExoLayout(root)) return;", resizable_src)

        self.assertIn("function restoreExoSizes(root, config)", workspace_src)
        self.assertIn("root.style.setProperty('--exo-dom'", workspace_src)
        self.assertIn("!restoreExoSizes(root, config) && V6OF.ResizablePanels", workspace_src)

    def test_exocharts_uses_internal_clip_shell_for_rounded_corners(self):
        with open(LAYOUT_JS, encoding="utf-8") as fh:
            layout_src = fh.read()
        with open(EXO_CSS, encoding="utf-8") as fh:
            exo_css = fh.read()

        self.assertIn('<div class="exo-clip-shell" data-exo-clip-shell>', layout_src)
        self.assertLess(layout_src.index('<div class="exo-clip-shell" data-exo-clip-shell>'), layout_src.index('<header class="exo-topbar">'))
        self.assertLess(layout_src.index('</footer>'), layout_src.index("hiddenSettings,", layout_src.index('</footer>')))

        root_block = exo_css[exo_css.index(".v6-orderflow-root {"):exo_css.index(".exo-terminal,")]
        self.assertIn("border-radius: 14px;", root_block)
        self.assertIn("overflow: visible;", root_block)

        terminal_block = exo_css[exo_css.index(".exo-terminal,"):exo_css.index(".exo-clip-shell {")]
        self.assertIn("overflow: visible;", terminal_block)
        self.assertNotIn("display: grid;", terminal_block)

        clip_block = exo_css[exo_css.index(".exo-clip-shell {"):exo_css.index(".exo-terminal > :not(.exo-clip-shell)")]
        self.assertIn("display: grid;", clip_block)
        self.assertIn("border-radius: inherit;", clip_block)
        self.assertIn("overflow: hidden;", clip_block)

    def test_exocharts_has_reduced_motion_and_light_scheme_queries(self):
        with open(EXO_CSS, encoding="utf-8") as fh:
            exo_css = fh.read()

        self.assertIn("@media (prefers-reduced-motion: reduce)", exo_css)
        reduced = exo_css[exo_css.index("@media (prefers-reduced-motion: reduce)"):exo_css.index("@media (prefers-color-scheme: light)")]
        self.assertIn(".v6-orderflow-root *", reduced)
        self.assertIn("animation-duration: 0.001ms !important;", reduced)
        self.assertIn("transition-duration: 0.001ms !important;", reduced)
        self.assertIn("scroll-behavior: auto !important;", reduced)

        self.assertIn("@media (prefers-color-scheme: light)", exo_css)
        light = exo_css[exo_css.index("@media (prefers-color-scheme: light)"):]
        self.assertIn("color-scheme: light;", light)
        self.assertIn("--exo-bg:", light)
        self.assertIn("--exo-text:", light)
        self.assertIn(".exo-topbar,", light)
        self.assertIn(".exo-dom-body .v6-dom-cell-price", light)

    def test_countdown_ticker_install_is_strictly_idempotent(self):
        with open(CANVAS_CHART_JS, encoding="utf-8") as fh:
            src = fh.read()

        self.assertIn("var countdownTickerToken = 0;", src)
        self.assertIn("var countdownTickerInstalling = false;", src)
        self.assertIn("countdownTickerToken += 1;", src)
        self.assertIn("countdownTickerInstalling = false;", src)

        ticker = src[src.index("function ensureCountdownTicker"):src.index("function removeDprWatcher")]
        self.assertIn("if (countdownTickerId != null || countdownTickerInstalling) return;", ticker)
        self.assertIn("countdownTickerInstalling = true;", ticker)
        self.assertIn("var token = countdownTickerToken + 1;", ticker)
        self.assertIn("countdownTickerToken = token;", ticker)
        self.assertIn("if (token !== countdownTickerToken) return;", ticker)
        self.assertEqual(ticker.count("setInterval(function ()"), 1)

    def test_dpr_watcher_reinstall_does_not_stack_match_media_listeners(self):
        with open(CANVAS_CHART_JS, encoding="utf-8") as fh:
            src = fh.read()

        self.assertIn("var dprWatcherQuery = '';", src)
        self.assertIn("var dprWatcherInstalling = false;", src)
        cleanup = src[src.index("function removeDprWatcher"):src.index("function redrawAfterDprChange")]
        self.assertIn("dprWatcherQuery = '';", cleanup)
        self.assertIn("dprWatcherInstalling = false;", cleanup)

        install = src[src.index("function installDprWatcher"):src.index("V6OF.register('UI', 'CanvasChart'")]
        self.assertIn("if (!isOrderflowPageActive(activeChartCanvas))", install)
        self.assertIn("removeDprWatcher();", install)
        self.assertIn("if (dprWatcherInstalling) return;", install)
        self.assertIn("dprWatcherQuery === query", install)
        self.assertIn("dprWatcherInstalling = true;", install)
        self.assertIn("dprWatcherQuery = query;", install)
        self.assertIn("dprWatcherInstalling = false;", install)
        self.assertEqual(install.count("addEventListener('change', dprMediaHandler)"), 1)
        self.assertEqual(install.count("addListener(dprMediaHandler)"), 1)

    def test_rest_depth_fallback_waits_for_live_depth_silence(self):
        with open(LAYOUT_JS, encoding="utf-8") as fh:
            layout_src = fh.read()
        engine_js = os.path.join(PROJECT_DIR, "static", "js", "split", "078_v6_local_engine_client.js")
        with open(engine_js, encoding="utf-8") as fh:
            engine_src = fh.read()

        live_fresh = layout_src[layout_src.index("function isLiveDepthFresh"):layout_src.index("function shouldFetchDomDepthFallback")]
        self.assertIn("state.lastLiveDepthTs", live_fresh)
        self.assertIn("state.lastLiveDepthSymbol", live_fresh)
        self.assertIn("state.liveDepthCount", live_fresh)
        self.assertNotIn("if (book.source === 'rest-depth') return false;", live_fresh)

        refresh = layout_src[layout_src.index("function startDomDepthRefresh"):layout_src.index("function stopDomDepthRefresh")]
        self.assertIn("if (isLiveDepthFresh(store.getState ? store.getState() : {}, Date.now())) return;", refresh)
        self.assertIn("prefetchDomDepth(store, 'fallback');", refresh)

        self.assertIn("patch.lastLiveDepthTs = nextOrderBook.tsLocal || Date.now();", engine_src)
        self.assertIn("patch.lastLiveDepthSymbol = nextOrderBook.symbol || state.selectedDomSymbol || 'BTC';", engine_src)
        self.assertIn("lastLiveDepthTs: 0", layout_src)
        self.assertIn("lastLiveDepthSymbol: ''", layout_src)

    def test_resize_local_storage_reads_are_deferred_from_mount(self):
        with open(LAYOUT_JS, encoding="utf-8") as fh:
            layout_src = fh.read()
        with open(RESIZABLE_JS, encoding="utf-8") as fh:
            resizable_src = fh.read()

        self.assertIn("function readExoResizePrefs()", layout_src)
        self.assertIn("function restoreExoResizePrefsDeferred(root)", layout_src)
        self.assertIn("restoreExoResizePrefsDeferred(root);", layout_src)
        resize_wiring = layout_src[layout_src.index("var resizeHandle = root.querySelector"):layout_src.index("var logoBtn = root.querySelector")]
        self.assertNotIn("localStorage.getItem", resize_wiring)

        self.assertIn("function readSavedSizes()", resizable_src)
        self.assertIn("function restoreSavedSizesDeferred(root, rightCol, leftCol, cvdStrip)", resizable_src)
        init_block = resizable_src[resizable_src.index("init: function (root)"):resizable_src.index("// 1. Horizontal Resize")]
        self.assertIn("restoreSavedSizesDeferred(root, rightCol, leftCol, cvdStrip);", init_block)
        self.assertNotIn("localStorage.getItem", init_block)

    def test_canonicalizes_binance_rest_payloads(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const code = fs.readFileSync({json.dumps(LAYOUT_JS)}, 'utf8');
            const context = {{
              window: {{}},
              console: {{ log() {{}}, warn() {{}} }},
              Date: {{ now: () => 1710000000000 }},
              Object,
              Number,
              Array,
              String,
              parseInt,
              parseFloat,
              setInterval() {{}},
              clearInterval() {{}}
            }};
            context.window.V6OF = {{}};
            vm.runInNewContext(code, context);
            const n = context.window.V6OF.LayoutIngress;
            const out = {{
              symbol: n.normalizeSymbol('btc', 'binance'),
              book: n.normalizeOrderBook({{
                bids: [['100.5', '2'], ['bad', '1']],
                asks: [['101.25', '3']]
              }}, 'binance'),
              trades: n.normalizeTrades([
                {{ p: '100.5', q: '0.25', T: 1700000000000, m: false }},
                {{ p: 'bad', q: '1', T: 1700000000001, m: true }}
              ], 'binance', 'btc'),
              candles: n.normalizeCandles({{
                candles: [{{ time: 1700000000, open: '1', high: '2', low: '0.5', close: '1.5', volume: '42' }}]
              }}, 'binance', '1m')
            }};
            process.stdout.write(JSON.stringify(out));
            """
        )
        out = self._run_node(script)
        self.assertEqual(out["symbol"], "BTCUSDT")
        self.assertEqual(out["book"]["bestBid"], 100.5)
        self.assertEqual(out["book"]["bestAsk"], 101.25)
        self.assertEqual(out["book"]["tsLocal"], 1710000000000)
        self.assertEqual(out["trades"], [{
            "price": 100.5,
            "qty": 0.25,
            "time": 1700000000000,
            "side": "buy",
            "symbol": "BTCUSDT",
            "source": "binance_rest",
        }])
        self.assertEqual(out["candles"], [{
            "openTime": 1700000000000,
            "closeTime": 1700000059999,
            "open": 1,
            "high": 2,
            "low": 0.5,
            "close": 1.5,
            "volume": 42,
            "priceOnly": True,
            "analyticsSource": "price-only-rest",
            "source": "binance_rest_klines",
        }])

    def test_canonicalizes_hyperliquid_rest_payloads(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const code = fs.readFileSync({json.dumps(LAYOUT_JS)}, 'utf8');
            const context = {{
              window: {{}},
              console: {{ log() {{}}, warn() {{}} }},
              Date: {{ now: () => 1710000000000 }},
              Object,
              Number,
              Array,
              String,
              parseInt,
              parseFloat,
              setInterval() {{}},
              clearInterval() {{}}
            }};
            context.window.V6OF = {{}};
            vm.runInNewContext(code, context);
            const n = context.window.V6OF.LayoutIngress;
            const out = {{
              symbol: n.normalizeSymbol('BTCUSDT', 'hyperliquid'),
              book: n.normalizeOrderBook({{
                ok: true,
                bids: [{{ px: '100.5', sz: '2' }}],
                asks: [{{ px: '101.25', sz: '3' }}]
              }}, 'hyperliquid'),
              trades: n.normalizeTrades({{
                ok: true,
                trades: [{{ px: '100.5', sz: '0.25', time: 1700000000000, side: 'sell' }}]
              }}, 'hyperliquid', 'BTCUSDT'),
              candles: n.normalizeCandles({{
                ok: true,
                candles: [{{ openTime: 1700000000000, closeTime: 1700000059999, open: '1', high: '2', low: '0.5', close: '1.5', volume: '42' }}]
              }}, 'hyperliquid', '1m')
            }};
            process.stdout.write(JSON.stringify(out));
            """
        )
        out = self._run_node(script)
        self.assertEqual(out["symbol"], "BTC")
        self.assertEqual(out["book"]["bestBid"], 100.5)
        self.assertEqual(out["book"]["bestAsk"], 101.25)
        self.assertEqual(out["trades"], [{
            "price": 100.5,
            "qty": 0.25,
            "time": 1700000000000,
            "side": "sell",
            "symbol": "BTC",
            "source": "hyperliquid_rest",
        }])
        self.assertEqual(out["candles"], [{
            "openTime": 1700000000000,
            "closeTime": 1700000059999,
            "open": 1,
            "high": 2,
            "low": 0.5,
            "close": 1.5,
            "volume": 42,
            "priceOnly": True,
            "analyticsSource": "price-only-rest",
            "source": "hyperliquid_rest_klines",
        }])


if __name__ == "__main__":
    unittest.main()
