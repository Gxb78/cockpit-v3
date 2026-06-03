//go:build windows

package launcher

import (
	"os/exec"
	"syscall"
)

// hideConsole prevents the child process from showing a CMD window.
// On Windows, the sidecar processes (Flask + marketd) should run silently
// in the background — the desktop window is the user-facing UI.
func hideConsole(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
