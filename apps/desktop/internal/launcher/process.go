package launcher

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"sync"
	"time"
)

// ManagedProcess is a single child process started by the desktop app. Only
// processes started here are ever stopped — we never kill by image name.
type ManagedProcess struct {
	Name string
	cmd  *exec.Cmd
	mu   sync.Mutex
}

// Spec describes how to start a child process.
type Spec struct {
	Name string
	Bin  string   // executable
	Args []string
	Dir  string   // working directory
	Env  []string // extra "KEY=VALUE" entries appended to the parent env
	Log  io.Writer
}

// Start launches the process and returns a handle. The caller owns Stop().
func Start(spec Spec) (*ManagedProcess, error) {
	cmd := exec.Command(spec.Bin, spec.Args...)
	cmd.Dir = spec.Dir
	cmd.Env = append(os.Environ(), spec.Env...)
	if spec.Log != nil {
		cmd.Stdout = spec.Log
		cmd.Stderr = spec.Log
	}
	// Hide the console window on Windows — sidecar processes run silently.
	hideConsole(cmd)
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start %s: %w", spec.Name, err)
	}
	return &ManagedProcess{Name: spec.Name, cmd: cmd}, nil
}

// PID returns the OS process id (0 if not started).
func (p *ManagedProcess) PID() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.cmd == nil || p.cmd.Process == nil {
		return 0
	}
	return p.cmd.Process.Pid
}

// Stop terminates ONLY this child process (and is a no-op if already gone).
// It tries a graceful kill, then waits briefly. Never touches other processes.
func (p *ManagedProcess) Stop() error {
	p.mu.Lock()
	cmd := p.cmd
	p.mu.Unlock()
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	pid := cmd.Process.Pid

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()

	// Already exited?
	select {
	case <-done:
		return nil
	default:
	}

	if runtime.GOOS == "windows" {
		// On Windows, forcefully kill the process tree to prevent orphaned child
		// processes spawned by PyInstaller single-file bootloader.
		killCmd := exec.Command("taskkill", "/F", "/T", "/PID", fmt.Sprintf("%d", pid))
		_ = killCmd.Run()
	} else {
		if err := cmd.Process.Kill(); err != nil {
			return fmt.Errorf("kill %s pid=%d: %w", p.Name, pid, err)
		}
	}

	select {
	case <-done:
	case <-time.After(5 * time.Second):
	}
	return nil
}

// Manager tracks all children so the app can stop exactly what it started.
type Manager struct {
	mu        sync.Mutex
	processes []*ManagedProcess
}

func NewManager() *Manager { return &Manager{} }

func (m *Manager) Add(p *ManagedProcess) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.processes = append(m.processes, p)
}

// StopAll stops every tracked child in reverse start order, returning the PIDs
// that were stopped (for logging). Other user processes are never affected.
func (m *Manager) StopAll() []int {
	m.mu.Lock()
	procs := make([]*ManagedProcess, len(m.processes))
	copy(procs, m.processes)
	m.processes = nil
	m.mu.Unlock()

	var stopped []int
	for i := len(procs) - 1; i >= 0; i-- {
		pid := procs[i].PID()
		if err := procs[i].Stop(); err == nil && pid != 0 {
			stopped = append(stopped, pid)
		}
	}
	return stopped
}

// PIDs returns the currently tracked child PIDs.
func (m *Manager) PIDs() []int {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]int, 0, len(m.processes))
	for _, p := range m.processes {
		if pid := p.PID(); pid != 0 {
			out = append(out, pid)
		}
	}
	return out
}
