import os
import sys
import time
import threading
from pathlib import Path

# En mode developpement (non frozen), on insere la racine du projet dans sys.path
# pour pouvoir importer app_parts.
if not getattr(sys, 'frozen', False):
    repo_root = Path(__file__).resolve().parent.parent.parent
    sys.path.insert(0, str(repo_root))

# Configuration des variables d'environnement specifiques au desktop.
os.environ["PORT"] = os.environ.get("PORT", "5001")
os.environ["OPEN_BROWSER"] = "0"
os.environ["HOST"] = os.environ.get("HOST", "127.0.0.1")

def monitor_parent_process():
    """
    Monitor the parent process (the PyInstaller bootloader or Wails).
    If the parent process terminates, shut down the server cleanly to prevent orphaned processes.
    """
    parent_pid = os.getppid()
    # On Windows/Unix, os.getppid() is the parent PID. If it is <= 1, there's no parent to monitor.
    if parent_pid <= 1:
        return
    
    def check_parent():
        while True:
            time.sleep(1)
            try:
                # Signal 0 checks for process existence without sending any signal
                os.kill(parent_pid, 0)
            except OSError:
                # Parent has exited, shut down immediately
                os._exit(0)
                
    t = threading.Thread(target=check_parent, daemon=True)
    t.start()

if __name__ == "__main__":
    if getattr(sys, 'frozen', False):
        monitor_parent_process()
        
    from app_parts import launch
    launch()
