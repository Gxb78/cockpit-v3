from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
CANVAS_CHART_JS = ROOT / "static" / "js" / "split" / "077_v6_canvas_chart.js"
FOOTPRINT_INTEGRATION_JS = ROOT / "static" / "js" / "split" / "094_v6_footprint_integration.js"
FOOTPRINT_RENDERER_JS = ROOT / "static" / "js" / "split" / "093_v6_footprint_renderer.js"


class OrderflowHtfFootprintAggregationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = CANVAS_CHART_JS.read_text(encoding="utf-8")
        cls.integration_source = FOOTPRINT_INTEGRATION_JS.read_text(encoding="utf-8")
        cls.renderer_source = FOOTPRINT_RENDERER_JS.read_text(encoding="utf-8")

    def test_live_footprints_are_aggregated_for_higher_timeframes(self):
        self.assertIn("function aggregateFootprintsToTimeframe(footprints, tf, tickSize)", self.source)
        self.assertIn("function mergeCandlesByOpenTime(history, liveCandles, tf)", self.source)
        self.assertRegex(
            self.source,
            re.compile(
                r"var\s+liveCandles\s*=\s*aggregateFootprintsToTimeframeCached"
                r"\(fp,\s*tf,\s*tickSize\);"
            ),
        )
        self.assertIn("mergeCandlesByOpenTime(hist, liveCandles, tf)", self.source)

    def test_higher_timeframe_merge_no_longer_drops_live_footprints(self):
        self.assertNotIn("if (tf !== '1m') {\n      out = hist.length ? hist : [];", self.source)

    def test_aggregated_live_candles_keep_footprint_identity(self):
        self.assertIn("source: 'live-aggregate'", self.source)
        self.assertIn("analyticsSource: 'live-footprint-aggregate'", self.source)
        self.assertIn("mergeFootprintLevels(bucket._levelsByPrice, fp.levels, tickSize)", self.source)

    def test_aggregated_live_levels_are_keyed_by_tick_size(self):
        self.assertIn("function quantizeFootprintPrice(price, tickSize)", self.source)
        self.assertIn("function footprintPriceKey(price, tickSize)", self.source)
        self.assertIn("_aggregatedFpTickSize === tickSize", self.source)

    def test_rendered_footprints_are_price_aligned_to_authoritative_klines(self):
        self.assertIn("function alignFootprintsToKlines(footprints, klines)", self.source)
        self.assertIn("var renderFootprints = alignFootprintsToKlines(footprintCandles, baseCandles);", self.source)
        self.assertIn("cloneFootprintLevelWithPrice(level, remapFootprintPriceToKline", self.source)
        self.assertIn("out.poc = remapFootprintPriceToKline(footprint.poc, footprint, kline)", self.source)
        self.assertIn("out.va.high = remapFootprintPriceToKline(footprint.va.high, footprint, kline)", self.source)
        self.assertIn("_priceAlignedToKline = true", self.source)

    def test_footprint_integration_timeframe_parser_matches_chart_timeframes(self):
        src = self.integration_source
        self.assertIn("String(tf).match(/^(\\d+)([mhdwM])$/)", src)
        self.assertIn("if (unit === 'm') return val * 60000;", src)
        self.assertIn("if (unit === 'h') return val * 3600000;", src)
        self.assertIn("if (unit === 'd') return val * 86400000;", src)
        self.assertIn("if (unit === 'w') return val * 604800000;", src)
        self.assertIn("if (unit === 'M') return val * 2592000000;", src)
        self.assertNotIn("toLowerCase()", src)

    def test_footprint_level_height_uses_tick_size_not_visible_range(self):
        renderer = self.renderer_source
        integration = self.integration_source
        self.assertIn("function priceLevelHeight(vp, price, tickSize)", renderer)
        self.assertIn("var yTick = vp.priceToY(price + tickSize);", renderer)
        self.assertIn("var h = Math.abs(y - yTick);", renderer)
        self.assertIn("var tickSize = normalizeTickSize(options, candle);", renderer)
        self.assertIn("drawImbalanceHighlight(ctx, x, x + width, level.price, vp, tickSize)", renderer)
        self.assertIn("tickSize: settings && settings.tickSize", integration)
        self.assertNotIn("(vp.priceMax - vp.priceMin) / 100", renderer)
        self.assertNotIn("price - 1", renderer)

    def test_footprint_bar_opacity_handles_hex_colors(self):
        renderer = self.renderer_source
        self.assertIn("function colorWithAlpha(color, alpha)", renderer)
        self.assertIn("color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)", renderer)
        self.assertIn("return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';", renderer)
        self.assertIn("ctx.fillStyle = colorWithAlpha(color, opacity);", renderer)
        self.assertNotIn("color.replace('rgb('", renderer)

    def test_footprint_render_errors_are_rate_limited_and_disable_renderer(self):
        src = self.integration_source
        self.assertIn("var MAX_RENDER_FAILURES = 3;", src)
        self.assertIn("var renderFailureCount = 0;", src)
        self.assertIn("var renderDisabled = false;", src)
        self.assertIn("var renderErrorLogged = false;", src)
        self.assertIn("if (renderDisabled) return false;", src)
        self.assertIn("renderFailureCount += 1;", src)
        self.assertIn("if (!renderErrorLogged) {", src)
        self.assertIn("if (renderFailureCount >= MAX_RENDER_FAILURES) {", src)
        self.assertIn("V6OF.footprintRenderDisabled = {", src)
        self.assertIn("function resetRenderCircuitBreaker()", src)
        self.assertIn("resetRenderCircuitBreaker: resetRenderCircuitBreaker", src)

    def test_footprint_logs_are_debug_gated(self):
        parser = (ROOT / "static" / "js" / "split" / "092_v6_footprint_parser.js").read_text(encoding="utf-8")
        renderer = self.renderer_source
        integration = self.integration_source

        for src in (parser, renderer, integration):
            self.assertIn("function footprintDebugEnabled()", src)
            self.assertIn("V6OF.debugFootprint || V6OF.DEBUG_FOOTPRINT", src)

        self.assertIn("function footprintDebugLog()", integration)
        self.assertIn("function footprintDebugError()", integration)
        self.assertIn("footprintDebugLog('[Footprint Integration] Initialized successfully');", integration)
        self.assertIn("footprintDebugError('[Footprint Integration] Missing dependencies", integration)
        self.assertIn("footprintDebugError('[Footprint Integration] Render error; disabling footprint", integration)
        self.assertNotIn("V6OF.debugLog('[Footprint Integration] Initialized successfully');", integration)
        self.assertNotIn("console.error('[Footprint Integration] Missing dependencies", integration)
        self.assertNotIn("console.error('[Footprint Parser] FootprintCore not available');", parser)
        self.assertNotIn("console.error('[Footprint Renderer] FootprintCore not available');", renderer)

    def test_live_arrays_are_versioned_without_replacing_refs(self):
        chart = self.source
        engine = (ROOT / "static" / "js" / "split" / "078_v6_local_engine_client.js").read_text(encoding="utf-8")

        self.assertIn("function mutateVersionedArray(existing, nextItems)", engine)
        self.assertIn("list._v6ArrayVersion = (Number(list._v6ArrayVersion) || 0) + 1;", engine)
        self.assertIn("patch.trades = mutateVersionedArray(state.trades, tradeBuffer.slice(0, tradeWindow));", engine)
        self.assertIn("patch.tradesVersion = patch.trades._v6ArrayVersion;", engine)
        self.assertIn("patch.deltaBuckets = mutateVersionedArray(state.deltaBuckets, selectedDeltaWindow);", engine)
        self.assertIn("patch.deltaBucketsVersion = patch.deltaBuckets._v6ArrayVersion;", engine)
        self.assertIn("patch.heatmapFrames = mutateVersionedArray(state.heatmapFrames, frames);", engine)
        self.assertIn("patch.heatmapFramesVersion = patch.heatmapFrames._v6ArrayVersion;", engine)
        self.assertIn("patch.footprintCandles = mutateVersionedArray(state.footprintCandles, candles);", engine)
        self.assertIn("patch.footprintCandlesVersion = patch.footprintCandles._v6ArrayVersion;", engine)

        store = (ROOT / "static" / "js" / "split" / "071_v6_orderflow_store.js").read_text(encoding="utf-8")
        self.assertIn("tradesVersion: 'trader'", store)
        self.assertIn("heatmapFramesVersion: 'trader'", store)
        self.assertIn("footprintCandlesVersion: 'trader'", store)
        self.assertIn("deltaBucketsVersion: 'trader'", store)

        self.assertIn("function arrayVersion(list)", chart)
        self.assertIn("var fpVersion = arrayVersion(footprints);", chart)
        self.assertIn("_aggregatedFpVersion === fpVersion", chart)
        self.assertIn("var dataVersion = tf + '|' + tickSize + '|' + arrayVersion(hist) + '|' + arrayVersion(fp);", chart)
        self.assertIn("var framesVersion = arrayVersion(frames);", chart)
        merged = chart[chart.index("function mergedChartCandles"):chart.index("function visiblePriceRange")]
        bounds = chart[chart.index("function computeLiveBounds"):chart.index("function firstFrameIndexAtOrBefore")]
        overlay = chart[chart.index("function internalDrawOverlay"):chart.index("function drawCountdownLabelOnly")]
        self.assertNotIn("state._stateVersion", merged)
        self.assertNotIn("state._stateVersion", bounds)
        self.assertNotIn("state._stateVersion", overlay)

    def test_build_render_data_is_memoized_by_state_signature(self):
        chart = self.source
        self.assertIn("var _renderDataCache = null;", chart)
        self.assertIn("var _renderDataSig = '';", chart)
        self.assertIn("function renderDataSignature(state, win, baseCandles, heatmapFrames, footprintCandles)", chart)
        self.assertIn("arrayVersion(baseCandles)", chart)
        self.assertIn("arrayVersion(heatmapFrames)", chart)
        self.assertIn("arrayVersion(footprintCandles)", chart)
        self.assertIn("Number(settings.tickSize) || 0", chart)

        render_data = chart[chart.index("function buildRenderData"):chart.index("function cloneFootprintLevelWithPrice")]
        self.assertIn("var sig = renderDataSignature(state, win, baseCandles, heatmapFrames, footprintCandles);", render_data)
        self.assertIn("if (_renderDataCache &&", render_data)
        self.assertIn("_renderDataSig === sig", render_data)
        self.assertIn("_renderDataBaseRef === baseCandles", render_data)
        self.assertIn("return _renderDataCache;", render_data)
        self.assertIn("_renderDataCache = {", render_data)
        self.assertIn("_renderDataSig = sig;", render_data)

        cleanup = chart[chart.index("cleanup: function"):chart.index("function drawTimelineBookmarks")]
        self.assertIn("_renderDataCache = null;", cleanup)
        self.assertIn("_renderDataSig = '';", cleanup)

    def test_deep_klines_json_parse_runs_in_worker(self):
        engine = (ROOT / "static" / "js" / "split" / "078_v6_local_engine_client.js").read_text(encoding="utf-8")

        self.assertIn("function ensureCandleWorker()", engine)
        self.assertIn("function candleWorkerRequest(payload)", engine)
        self.assertIn("function fetchRestCandlesInWorker(url, interval, retries)", engine)
        self.assertIn("mode: 'fetch-normalize'", engine)
        self.assertIn("return res.text();", engine)
        self.assertIn("var data=JSON.parse(text);", engine)
        self.assertIn("ok(normalize(data&&data.candles,m.interval));", engine)

        deep = engine[engine.index("function fetchDeepHistory"):engine.index("// Tracks the last footprint history fetch")]
        self.assertIn("fetchRestCandlesInWorker(url, interval, 2).then(function (older)", deep)
        self.assertNotIn("tryFetch(url, 2).then(function (data)", deep)
        self.assertNotIn("res.json()", deep)


if __name__ == "__main__":
    unittest.main()
