import hashlib
import sys
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
TOKEN = None  # calcule apres le build a partir du hash du contenu


def concat(src_dir: str, pattern: str, out_file: str, marker: str):
    """Concatene les fichiers split en un bundle. Retourne (compte, chemin_du_bundle)."""
    files = sorted((ROOT / src_dir).glob(pattern), key=lambda p: p.name)
    chunks = [
        f"{marker.format(name=p.name)}\n{p.read_text(encoding='utf-8').lstrip(chr(0xFEFF)).rstrip()}"
        for p in files
    ]
    content = "\n\n".join(chunks) + "\n"
    dest = ROOT / out_file
    # Utiliser write_bytes pour eviter la conversion \n → \r\n sur Windows
    # qui change le hash MD5 et casse la coherence Win/WSL
    dest.write_bytes(content.encode("utf-8"))
    return len(files), dest


def _file_hash(path):
    """Retourne les 12 premiers caracteres du hash MD5 d'un fichier."""
    h = hashlib.md5(path.read_bytes()).hexdigest()[:12]
    return h


def _glob_hash(base_dir, pattern):
    """Hash MD5 combine de tous les fichiers correspondant au pattern."""
    h = hashlib.md5()
    for p in sorted((ROOT / base_dir).glob(pattern), key=lambda p: p.name):
        h.update(p.read_bytes())
    return h.hexdigest()[:12]


def switch_to_bundles(target_path: str, bundle_js: str, bundle_css: str):
    """Remplace les <script src=...> / <link ...> dans le template par les bundles."""
    target = ROOT / target_path
    text = target.read_text(encoding="utf-8")

    if bundle_js:
        # Supprimer les <script> split existants
        text = re.sub(
            r'<script src="/static/js/split/[^"]+">\s*</script>\s*',
            "",
            text,
        )
        text = re.sub(
            r'<script src="/static/app\.js[^"]*">\s*</script>\s*',
            "",
            text,
        )
        # Ajouter le bundle a la fin
        bundle_tag = f'<script src="/static/app.js?v={TOKEN}"></script>'
        text = text.rstrip() + "\n" + bundle_tag + "\n"

    if bundle_css:
        # Supprimer les <link> split ou bundle existants
        text = re.sub(
            r'<link rel="stylesheet" href="/static/css/split/[^"]+"\s*/>\s*',
            "",
            text,
        )
        text = re.sub(
            r'<link rel="stylesheet" href="/static/style\.css[^"]*"\s*/>\s*',
            "",
            text,
        )
        # Ajouter le bundle en tete
        bundle_tag = f'<link rel="stylesheet" href="/static/style.css?v={TOKEN}" />'
        if re.search(r'<link[^>]+rel="stylesheet"', text):
            text = re.sub(
                r'(<link[^>]+rel="stylesheet")',
                bundle_tag + "\n" + r"\1",
                text,
                count=1,
            )
        else:
            text = text.rstrip() + "\n" + bundle_tag + "\n"

    target.write_text(text, encoding="utf-8")
    return text


def restore_splits(target_path: str, js=True, css=True):
    """Restore les templates pour utiliser les fichiers split individuellement.

    Args:
        target_path: chemin vers le template
        js: si True, restaure les <script> tags pour les fichiers JS split
        css: si True, restaure les <link> tags pour les fichiers CSS split
    """
    target = ROOT / target_path
    text = target.read_text(encoding="utf-8")
    # Supprimer les references aux bundles si presentes
    text = re.sub(r'<script src="/static/app\.js[^"]*">\s*</script>\s*', "", text)
    text = re.sub(r'<link rel="stylesheet" href="/static/style\.css[^"]*"\s*/>\s*', "", text)

    # Re-ajouter les tags split si absents
    if js and "static/js/split/" not in text:
        js_dir = ROOT / "static" / "js" / "split"
        js_tags = "\n".join(
            f'<script src="/static/js/split/{p.name}?v={TOKEN}"></script>'
            for p in sorted(js_dir.glob("*.js"), key=lambda p: p.name)
        )
        text = text.rstrip() + "\n" + js_tags + "\n"
    if css and "static/css/split/" not in text:
        css_dir = ROOT / "static" / "css" / "split"
        css_tags = "\n".join(
            f'<link rel="stylesheet" href="/static/css/split/{p.name}?v={TOKEN}" />'
            for p in sorted(css_dir.glob("*.css"), key=lambda p: p.name)
        )
        if "<link" in text:
            text = re.sub(r'(<link rel="stylesheet")', css_tags + "\n" + r"\1", text, count=1)
        else:
            text = css_tags + "\n" + text
    target.write_text(text, encoding="utf-8")
    return text


if len(sys.argv) > 1 and sys.argv[1] == "--restore":
    TOKEN = _glob_hash("static/js/split", "*.js") + _glob_hash("static/css/split", "*.css")
    restore_splits("templates/partials/overlays/scripts.html", js=True, css=False)
    restore_splits("templates/partials/layout/head_assets_css.html", js=False, css=True)
    print(f"Restored templates to split-file mode (token: {TOKEN})")
else:
    js_count, js_path = concat("static/js/split", "*.js", "static/app.js", "// ---- {name} ----")
    css_count, css_path = concat("static/css/split", "*.css", "static/style.css", "/* ---- {name} ---- */")
    TOKEN = _file_hash(js_path) + _file_hash(css_path)
    switch_to_bundles("templates/partials/overlays/scripts.html", bundle_js="static/app.js", bundle_css=None)
    switch_to_bundles("templates/partials/layout/head_assets_css.html", bundle_js=None, bundle_css="static/style.css")
    print(f"Built static/app.js from {js_count} modules (hash: {_file_hash(js_path)})")
    print(f"Built static/style.css from {css_count} modules (hash: {_file_hash(css_path)})")
    print(f"Switched templates to bundle mode (token: {TOKEN})")
