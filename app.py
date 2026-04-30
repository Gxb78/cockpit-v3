"""Trading Journal COCKPIT v3 - modular app loader.

Loads all app_parts modules into a single shared namespace in dependency order.
See app_parts/__init__.py for the loading logic.

Usage:
    python app.py          # starts the server
    import app as mod      # from tests / scripts
"""

from app_parts import *  # noqa: F401,F403

# Lancement du serveur (seulement quand le fichier est execute directement)
if __name__ == "__main__":
    launch()
