from pathlib import Path


ROOT = Path(__file__).resolve().parent


def load_js_source() -> str:
    bundle = ROOT / "static" / "app.js"
    if bundle.exists():
        return bundle.read_text(encoding="utf-8")

    split_dir = ROOT / "static" / "js" / "split"
    parts = sorted(split_dir.glob("*.js"), key=lambda p: p.name)
    if not parts:
        raise FileNotFoundError("No JS source found: static/app.js or static/js/split/*.js")

    chunks = [
        f"// ---- {p.name} ----\n{p.read_text(encoding='utf-8').lstrip(chr(0xFEFF)).rstrip()}"
        for p in parts
    ]
    return "\n\n".join(chunks) + "\n"
