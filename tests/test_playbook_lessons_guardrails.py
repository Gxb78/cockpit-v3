import re
import unittest
from pathlib import Path


class PlaybookLessonsGuardrailsTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parent.parent
        self.playbook = self.root / "AI_DEVELOPMENT_PLAYBOOK.md"
        self.critical_targets = [
            self.root / "app_parts",
            self.root / "static" / "js" / "split" / "020_trade_form.js",
            self.root / "static" / "js" / "split" / "038_custom_blocks.js",
            self.root / "static" / "js" / "split" / "040_wizard_core.js",
            self.root / "static" / "js" / "split" / "045_bindwizard.js",
            self.root / "static" / "js" / "split" / "012_data_loading.js",
            self.root / "static" / "js" / "split" / "015_calendar.js",
            self.root / "templates" / "partials" / "overlays" / "modal" / "trade_form",
            self.root / "templates" / "partials" / "tabs" / "journal_tab.html",
            self.root / "app.py",
        ]

    def _iter_target_files(self):
        for target in self.critical_targets:
            if target.is_dir():
                for p in target.rglob("*"):
                    if p.suffix not in (".pyc", ".pyo"):
                        yield p
            elif target.exists():
                yield target

    def test_playbook_has_structured_lessons_section(self):
        self.assertTrue(self.playbook.exists(), "Playbook manquant")
        text = self.playbook.read_text(encoding="utf-8")

        self.assertIn(
            "## 9) Lessons apprises et bugs a ne pas reproduire",
            text,
            "Section lessons absente du playbook",
        )

        lesson_headers = list(
            re.finditer(r"^### BUG-(\d{8})-(\d{2}) - .+$", text, flags=re.MULTILINE)
        )
        self.assertGreaterEqual(
            len(lesson_headers),
            3,
            "Au moins 3 lessons BUG-... sont requises dans le playbook",
        )

        required_fields = [
            "- Symptome:",
            "- Cause racine:",
            "- Regle de prevention:",
            "- Test de non-regression:",
            "- Fichiers a surveiller:",
        ]

        for idx, match in enumerate(lesson_headers):
            start = match.start()
            end = lesson_headers[idx + 1].start() if idx + 1 < len(lesson_headers) else len(text)
            block = text[start:end]
            for field in required_fields:
                self.assertIn(
                    field,
                    block,
                    f"Lesson incomplete ({match.group(0)}): champ manquant {field}",
                )

    def test_playbook_not_older_than_critical_files(self):
        self.assertTrue(self.playbook.exists(), "Playbook manquant")
        playbook_ts = self.playbook.stat().st_mtime

        latest_path = None
        latest_ts = 0.0
        for path in self._iter_target_files():
            if not path.is_file():
                continue
            ts = path.stat().st_mtime
            if ts > latest_ts:
                latest_ts = ts
                latest_path = path

        self.assertIsNotNone(latest_path, "Aucun fichier critique detecte")
        self.assertGreaterEqual(
            playbook_ts,
            latest_ts,
            (
                "Le playbook est plus ancien que les fichiers critiques. "
                "Ajoute une nouvelle lesson (bug a ne pas reproduire) ou mets a jour "
                "les lessons existantes avant de livrer.\n"
                f"Playbook: {self.playbook}\n"
                f"Dernier fichier critique: {latest_path}"
            ),
        )


if __name__ == "__main__":
    unittest.main()
