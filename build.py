import hashlib
import sys
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parent
TOKEN = None  # calcule apres le build a partir du hash du contenu


def build_js_with_terser():
    """Bundles and minifies JS splits using Terser with sourcemaps."""
    js_dir = ROOT / "static" / "js"
    js_split_dir = js_dir / "split"
    js_files = sorted(js_split_dir.glob("*.js"), key=lambda p: p.name)
    js_args = [str(p.relative_to(ROOT)) for p in js_files]
    
    js_cmd = [
        "npx", "terser"
    ] + js_args + [
        "--compress",
        "--no-mangle",
        "--comments", "all",
        "--source-map", "filename=static/app.js.map,url=app.js.map",
        "--output", "static/app.js"
    ]
    
    res = subprocess.run(js_cmd, shell=True, capture_output=True, text=True, cwd=str(ROOT))
    if res.returncode != 0:
        print(f"Error bundling JS:\n{res.stderr}")
        sys.exit(1)
    
    return len(js_files), ROOT / "static" / "app.js"


def build_css_with_esbuild():
    """Bundles and minifies CSS splits using ESBuild with sourcemaps."""
    css_dir = ROOT / "static" / "css"
    css_split_dir = css_dir / "split"
    css_files = sorted(css_split_dir.glob("*.css"), key=lambda p: p.name)
    
    css_entry_content = "\n".join(f'@import "./split/{p.name}";' for p in css_files)
    css_entry_path = css_dir / "style_entry.css"
    css_entry_path.write_text(css_entry_content, encoding="utf-8")
    
    css_cmd = [
        "npx", "esbuild",
        str(css_entry_path.relative_to(ROOT)),
        "--bundle",
        "--minify",
        "--sourcemap",
        f"--outfile=static/style.css"
    ]
    
    try:
        res = subprocess.run(css_cmd, shell=True, capture_output=True, text=True, cwd=str(ROOT))
        if res.returncode != 0:
            print(f"Error bundling CSS:\n{res.stderr}")
            sys.exit(1)
    finally:
        if css_entry_path.exists():
            css_entry_path.unlink()
            
    return len(css_files), ROOT / "static" / "style.css"


def concat(src_dir: str, pattern: str, out_file: str, marker: str):
    """Concatene/Minifie/Module les fichiers split. Retourne (compte, chemin_du_bundle)."""
    if pattern.endswith(".js"):
        return build_js_with_terser()
    elif pattern.endswith(".css"):
        return build_css_with_esbuild()
    else:
        raise ValueError(f"Pattern non supporte: {pattern}")


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
        bundle_tag = f'<script src="/static/app.js?v={{{{ ASSET_VERSION }}}}"></script>'
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
        bundle_tag = f'<link rel="stylesheet" href="/static/style.css?v={{{{ ASSET_VERSION }}}}" />'
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
            f'<script src="/static/js/split/{p.name}?v={{{{ ASSET_VERSION }}}}"></script>'
            for p in sorted(js_dir.glob("*.js"), key=lambda p: p.name)
        )
        text = text.rstrip() + "\n" + js_tags + "\n"
    if css and "static/css/split/" not in text:
        css_dir = ROOT / "static" / "css" / "split"
        css_tags = "\n".join(
            f'<link rel="stylesheet" href="/static/css/split/{p.name}?v={{{{ ASSET_VERSION }}}}" />'
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
elif len(sys.argv) > 1 and sys.argv[1] == "--watch":
    import time
    import os

    def _mtime_map(directory, pattern):
        """Retourne un dict {filename: mtime} pour tous les fichiers du repertoire."""
        m = {}
        for p in sorted((ROOT / directory).glob(pattern), key=lambda p: p.name):
            try:
                m[p.name] = p.stat().st_mtime
            except OSError:
                pass
        return m

    js_dir = "static/js/split"
    css_dir = "static/css/split"
    print(f"👁️  Watcher actif. Surveillance de {js_dir}/ et {css_dir}/...")
    print("   Modifie un fichier split → rebuild auto. Ctrl+C pour arreter.\n")

    prev_js = _mtime_map(js_dir, "*.js")
    prev_css = _mtime_map(css_dir, "*.css")

    while True:
        time.sleep(1.0)
        cur_js = _mtime_map(js_dir, "*.js")
        cur_css = _mtime_map(css_dir, "*.css")

        changed = []
        for name, mtime in cur_js.items():
            if name not in prev_js or prev_js[name] != mtime:
                changed.append(f"js/{name}")
        for name, mtime in cur_css.items():
            if name not in prev_css or prev_css[name] != mtime:
                changed.append(f"css/{name}")

        if changed:
            print(f"\n📝 Change detecte: {', '.join(changed)}")
            # Rebuild
            js_count, js_path = concat("static/js/split", "*.js", "static/app.js", "// ---- {name} ----")
            css_count, css_path = concat("static/css/split", "*.css", "static/style.css", "/* ---- {name} ---- */")
            TOKEN = _file_hash(js_path) + _file_hash(css_path)
            switch_to_bundles("templates/partials/overlays/scripts.html", bundle_js="static/app.js", bundle_css=None)
            switch_to_bundles("templates/partials/layout/head_assets_css.html", bundle_js=None, bundle_css="static/style.css")
            print(f"   ✅ Build: {js_count} JS + {css_count} CSS (token: {TOKEN})")
            prev_js = cur_js
            prev_css = cur_css
else:
    js_count, js_path = concat("static/js/split", "*.js", "static/app.js", "// ---- {name} ----")
    css_count, css_path = concat("static/css/split", "*.css", "static/style.css", "/* ---- {name} ---- */")
    TOKEN = _file_hash(js_path) + _file_hash(css_path)
    switch_to_bundles("templates/partials/overlays/scripts.html", bundle_js="static/app.js", bundle_css=None)
    switch_to_bundles("templates/partials/layout/head_assets_css.html", bundle_js=None, bundle_css="static/style.css")
    print(f"Built static/app.js from {js_count} modules (hash: {_file_hash(js_path)})")
    print(f"Built static/style.css from {css_count} modules (hash: {_file_hash(css_path)})")
    print(f"Switched templates to bundle mode (token: {TOKEN})")
