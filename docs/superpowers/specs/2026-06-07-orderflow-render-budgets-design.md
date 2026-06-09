# Orderflow render budgets — separate chart / DOM / CVD redraws

**Date:** 2026-06-07
**Status:** Approved (A/B/C/D validated, incl. 1-frame deferral + per-root namespacing)
**Type:** Frontend refactor, perf — break the synchronous redraw cascade.

## Problem

Every store update (high-frequency: trades, deltas, footprints from the engine
client's `notify()`) fires the orderflow `store.subscribe` handlers
**synchronously**. The central `render(root, state)` in `073_v6_orderflow_layout.js`
redraws, in one synchronous pass: DOM panel → CVD (`renderCvdInto`) → `syncInputs`
→ chart canvas (`CanvasChart.draw`). A second subscriber in `080_v6_layout_shell.js`
also redraws CVD + inspector + chrome on every update. Slice-diffing
(`shouldRender` / `sameSlice`) gates *whether* a surface redraws, but all checks
and draws run in the same tick, coupled to the main canvas. A burst on one stream
forces the whole pass and can double-draw CVD — a cascade with no per-surface
render budget.

A global `RenderScheduler` already exists (`072_v6_orderflow_helpers.js`): it
dedupes named jobs into one `requestAnimationFrame` and records per-job timing
stats. It is under-used — the real draws bypass it.

## Goal & constraints

- **Break the cascade**: an update relevant to only one surface must not run the
  others' draw work.
- **Visually identical (~60fps)**: pure coalescing/decoupling, no rate-limiting
  or priority changes (Q1).
- **Whole hot path**: route every costly draw of *both* subscribers through the
  scheduler — chart, dom, cvd, inspector, chrome (Q2). Dedup by key unifies the
  CVD double-draw.
- Accepted behavior change: **1-frame deferral** (draws move from synchronous in
  the subscribe to the next rAF job). Paths already on rAF are unchanged.

## A. Mechanism

Keep `RenderScheduler` (072) as-is (key dedup + single rAF + stats). Route draws
through it instead of calling `draw()` synchronously inside `store.subscribe`.
Accessed via `V6OF.RenderScheduler.queue(key, fn)`.

## B. Cascade break (core)

In `render()` (073) and the subscribe (080), for each surface: keep the existing
slice-diff (`shouldRender` / `sameSlice`) as the **change gate**, but replace the
synchronous `draw(...)` with `V6OF.RenderScheduler.queue(key, function () { draw(...); })`.

- Only surfaces whose slice changed are enqueued; others are never touched.
- The queued closure captures the freshest `state`; re-queueing the same key
  overwrites with the latest fn, so the job draws once per frame with newest data.
- The CVD double-draw (073 + 080) collapses because both enqueue the same key
  `cvd:<rootId>` → one draw per frame.

## C. Job keys & multi-root

Stores are scoped per root (`V6OF.getStore(root)`). Job keys are **namespaced per
root** so a second root cannot clobber another's job:
`'chart:'+rootId`, `'dom:'+rootId`, `'cvd:'+rootId`, `'inspector:'+rootId`,
`'chrome:'+rootId`. `rootId` is a stable id assigned once per root element
(lazy: `root.__v6RenderId` set to an incrementing counter on first use). Single
root today; the namespacing is cheap insurance.

## D. Behavior nuance & testing

- **1-frame deferral**: accepted (Q1). Visually identical at ~60fps.
- **Tests** (`tests/test_orderflow_render_scheduler.py`, node-vm with a fake
  `requestAnimationFrame`):
  1. **Coalescing** — queueing one key N times runs the fn once per frame.
  2. **Multi-source dedup** — two sources queueing `cvd:<id>` run one draw/frame.
  3. **Independent keys** — queueing only `chart:<id>` does not run `dom`/`cvd`
     jobs (no cascade).
  4. **Latest-wins** — the last fn queued for a key is the one executed.
- Existing Python suite (template/orderflow/settings) stays green; rebuild the
  JS bundle (`python build.py`).

## Non-goals (YAGNI)

- No per-surface rate-limiting / priorities / time budget (Q1 chose pure
  decoupling).
- No rewrite merging the two subscribers into one.
- No change to `RenderScheduler` internals beyond what routing requires (none).
- No change to slice-diff logic (`shouldRender` / `sameSlice`) — reused as gates.
