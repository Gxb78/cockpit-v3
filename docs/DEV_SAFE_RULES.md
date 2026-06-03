# Cockpit V6 - Development Safety Rules

These rules protect the existing Journal, chart, VWAP, Hyperliquid, journal, and AI behavior while Cockpit V6 is added incrementally.

## Git and Branch Safety

- Work on `feat/cockpit-v6-orderflow` for V6 changes.
- Never commit without explicit user approval.
- Never run `git reset`, `git checkout --`, stash, or destructive cleanup without explicit user approval.
- Treat a dirty working tree as user-owned unless the change was made in the current task.
- Before each phase, run `git status --short` and separate existing changes from new phase changes.

## Scope Control

- Keep each phase small and reversible.
- Do not refactor unrelated modules while adding V6 foundations.
- Do not modify existing chart, VWAP, Hyperliquid, journal, AI, or orderflow behavior unless the phase explicitly requires it.
- Do not delete files without a written reason and user approval.
- Prefer isolated additions under new V6 paths before touching shared code.

## Verification

Preferred commands from this repo:

```bash
.venv_linux/bin/python build.py
.venv_linux/bin/python -m unittest discover -s tests -v
node --check static/app.js
```

Windows fallback when WSL or `.venv_linux` is unavailable:

```powershell
.\.venv\Scripts\python.exe build.py
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
node --check static/app.js
```

If a command fails, document the exact command, exit status, and relevant output before changing code.

## Generated Assets

- `build.py` rebuilds `static/app.js`, `static/style.css`, and bundle tokens in templates.
- Do not manually edit generated bundles when the matching split source files exist.
- If generated files change during verification, record that the build command caused it.

## Market Data and Legal Boundaries

- Use public exchange data first, starting with Binance Futures.
- Do not copy proprietary product code, private APIs, paid APIs without authorization, brands, or visual assets.
- Do not reverse-engineer subscription terminals or bypass authentication.

## Phase Gates

- Phase 1 is documentation and verification only.
- Phase 2 may add an isolated V6 route or page only after Phase 1 is accepted.
- Go, Wails, live exchange streams, and orderflow feature work start only in later approved phases.
