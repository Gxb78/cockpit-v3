//go:build !windows

package launcher

import (
	"os/exec"
)

// hideConsole is a no-op on non-Windows platforms where console windows
// behave differently or don't apply.
func hideConsole(cmd *exec.Cmd) {
	// No-op
}
