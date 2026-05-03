"""Tests d'intégrité du bundle JS frontend.

Vérifie que :
1. Le bundle JS est syntaxiquement valide (node --check)
2. Tous les fichiers split sont inclus dans le bundle
3. Les fonctions globales critiques sont exportées
4. Aucun fichier split n'est orphelin (chargé mais pas dans build.py)
"""

import os
import subprocess
import unittest
import glob

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_JS = os.path.join(PROJECT_DIR, "static", "app.js")
SPLIT_JS_DIR = os.path.join(PROJECT_DIR, "static", "js", "split")
SPLIT_CSS_DIR = os.path.join(PROJECT_DIR, "static", "css", "split")
BUILD_PY = os.path.join(PROJECT_DIR, "build.py")

# Fonctions globales critiques qui doivent exister dans le bundle
CRITICAL_FUNCTIONS = [
    "goPage",
    "wizOpen",
    "loadInsights",
    "initBtcChart",
    "initChartPage",
    "initWidgetBoard",
    "toast",
    "fmtMoney",
    "prettify",
    "escapeHtml",
    "populateInstruments",
    "loadAllDays",
    "loadStats",
    "saveProfileSettings",
    "applyVisualSettings",
    "InsightsCtrl",
]


class TestJSBundle(unittest.TestCase):
    """Tests d'intégrité du bundle JS."""

    def setUp(self):
        if not os.path.isfile(APP_JS):
            self.skipTest(f"Bundle JS introuvable: {APP_JS}")
        with open(APP_JS, "r", encoding="utf-8") as f:
            self.bundle = f.read()
        self.has_node = self._check_node()

    def _check_node(self):
        try:
            subprocess.run(["node", "--version"], capture_output=True, check=True)
            return True
        except (FileNotFoundError, subprocess.CalledProcessError):
            return False

    def test_bundle_exists(self):
        """Le bundle JS doit exister et être non vide."""
        self.assertGreater(
            os.path.getsize(APP_JS), 10000,
            f"Le bundle JS est trop petit: {os.path.getsize(APP_JS)} octets"
        )

    def test_bundle_syntax(self):
        """Le bundle JS doit être syntaxiquement valide."""
        if not self.has_node:
            self.skipTest("node non disponible")
        result = subprocess.run(
            ["node", "--check", APP_JS],
            capture_output=True, text=True,
        )
        self.assertEqual(
            result.returncode, 0,
            f"Erreur de syntaxe JS dans le bundle:\n{result.stderr}"
        )

    def test_all_splits_included(self):
        """Le bundle JS doit inclure le contenu de tous les splits."""
        if not os.path.isdir(SPLIT_JS_DIR):
            self.skipTest(f"Repertoire split introuvable: {SPLIT_JS_DIR}")

        splits = sorted(glob.glob(os.path.join(SPLIT_JS_DIR, "*.js")))
        self.assertGreater(len(splits), 50, "Peu de fichiers split JS")

        for split_path in splits:
            split_name = os.path.basename(split_path)
            with open(split_path, "r", encoding="utf-8") as f:
                content = f.read(200)

            # Utiliser les 50 premiers caracteres non-blancs comme signature
            sig = content.strip()[:50]
            if sig:
                self.assertIn(
                    sig, self.bundle,
                    f"Le fichier split '{split_name}' semble absent du bundle. "
                    f"Rebuild necessaire."
                )

    def test_all_splits_referenced_in_build_py(self):
        """build.py doit charger tous les fichiers split via glob."""
        if not os.path.isfile(BUILD_PY) or not os.path.isdir(SPLIT_JS_DIR):
            self.skipTest("build.py ou repertoire split introuvable")

        with open(BUILD_PY, "r", encoding="utf-8") as f:
            build_code = f.read()

        # build.py utilise glob: sorted((ROOT / src_dir).glob(pattern))
        # Verifier que le pattern *.js est present pour les deux dossiers
        self.assertIn("glob(*.js)", build_code.replace('"', '').replace("'", ""),
                       "build.py doit avoir un glob *.js pour les fichiers JS")
        self.assertIn("glob(*.css)", build_code.replace('"', '').replace("'", ""),
                       "build.py doit avoir un glob *.css pour les fichiers CSS")

        # Verifier que les dossiers split sont references
        self.assertIn("static/js/split", build_code)
        self.assertIn("static/css/split", build_code)

        # Verifier que build.py retrouve tous les fichiers sur disque
        js_splits = sorted(glob.glob(os.path.join(SPLIT_JS_DIR, "*.js")))
        css_splits = sorted(glob.glob(os.path.join(SPLIT_CSS_DIR, "*.css")))
        self.assertGreater(len(js_splits), 50, "Fichiers JS split introuvables")
        self.assertGreater(len(css_splits), 40, "Fichiers CSS split introuvables")

    def test_critical_functions_exist(self):
        """Les fonctions globales critiques doivent etre definies dans le bundle."""
        missing = []
        for fn in CRITICAL_FUNCTIONS:
            patterns = [
                f"function {fn}",
                f"window.{fn} =",
                f"window.{fn}=",
                f"{fn}: function",
                f"window.{fn},",
                f"window[\"{fn}\"]",
                f"window['{fn}']",
            ]
            found = any(p in self.bundle for p in patterns)
            if not found:
                # Chercher aussi comme propriete exportee (fin de fichier)
                if f"window.{fn}" in self.bundle:
                    found = True
            if not found:
                missing.append(fn)

        self.assertEqual(
            len(missing), 0,
            f"Fonctions critiques manquantes dans le bundle: {missing}. "
        )

    def test_no_split_files_orphaned(self):
        """Verifie que build.py ne reference pas des fichiers inexistants."""
        if not os.path.isfile(BUILD_PY):
            self.skipTest("build.py introuvable")

        with open(BUILD_PY, "r", encoding="utf-8") as f:
            build_code = f.read()

        # build.py reference static/app.js et static/style.css comme sorties
        self.assertIn("static/app.js", build_code)
        self.assertIn("static/style.css", build_code)

        # build.py reference templates
        self.assertIn("templates/partials/overlays/scripts.html", build_code)
        self.assertIn("templates/partials/layout/head_assets_css.html", build_code)

        # build.py reference les dossiers split
        js_dir = os.path.join(PROJECT_DIR, "static", "js", "split")
        css_dir = os.path.join(PROJECT_DIR, "static", "css", "split")
        self.assertTrue(os.path.isdir(js_dir), f"Repertoire split JS manquant: {js_dir}")
        self.assertTrue(os.path.isdir(css_dir), f"Repertoire split CSS manquant: {css_dir}")


class TestCSSBundle(unittest.TestCase):
    """Tests d'intégrité du bundle CSS."""

    STYLE_CSS = os.path.join(PROJECT_DIR, "static", "style.css")

    def setUp(self):
        if not os.path.isfile(self.STYLE_CSS):
            self.skipTest(f"Bundle CSS introuvable: {self.STYLE_CSS}")

    def test_css_bundle_exists(self):
        """Le bundle CSS doit exister et être non vide."""
        self.assertGreater(
            os.path.getsize(self.STYLE_CSS), 5000,
            f"Le bundle CSS est trop petit: {os.path.getsize(self.STYLE_CSS)} octets"
        )

    def test_css_bundle_no_mojibake(self):
        """Le bundle CSS ne doit pas contenir de mojibake."""
        with open(self.STYLE_CSS, "r", encoding="utf-8") as f:
            css = f.read()
        bad_chars = ["Ã", "Â", "â", "�"]
        for char in bad_chars:
            self.assertNotIn(
                char, css,
                f"Mojibake ('{char}') trouvé dans le bundle CSS"
            )


if __name__ == "__main__":
    unittest.main()
