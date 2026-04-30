import unittest
from pathlib import Path


class EncodingGuardrailsTests(unittest.TestCase):
    def test_runtime_sources_have_no_mojibake_markers(self):
        root = Path(__file__).resolve().parent.parent
        targets = [
            root / "app.py",
            root / "templates" / "index.html",
        ]
        targets += sorted((root / "app_parts").glob("*.py"))
        targets += sorted((root / "static" / "js" / "split").glob("*.js"))
        targets += sorted((root / "static" / "css" / "split").glob("*.css"))
        targets += sorted((root / "templates" / "partials").rglob("*.html"))

        bad_tokens = ["Ãƒ", "Ã¢â‚¬", "Ã¢â€ ", "Ã¢â€šÂ¬", "ÃÆ’", "\ufffd"]
        hits = []

        for path in targets:
            self.assertTrue(path.exists(), f"Fichier manquant: {path}")
            text = path.read_text(encoding="utf-8")
            for lineno, line in enumerate(text.splitlines(), start=1):
                for token in bad_tokens:
                    if token in line:
                        hits.append(f"{path}:{lineno}: contient '{token}'")

        self.assertFalse(hits, "Mojibake detecte:\n" + "\n".join(hits[:20]))


if __name__ == "__main__":
    unittest.main()
