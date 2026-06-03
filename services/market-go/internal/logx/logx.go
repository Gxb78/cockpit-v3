package logx

import (
	"io"
	"log"
)

type Logger struct {
	base *log.Logger
}

func New(out io.Writer) *Logger {
	return &Logger{base: log.New(out, "[market-go] ", log.LstdFlags|log.Lmicroseconds)}
}

func (l *Logger) Infof(format string, args ...any) {
	if l == nil || l.base == nil {
		return
	}
	l.base.Printf("INFO "+format, args...)
}

func (l *Logger) Errorf(format string, args ...any) {
	if l == nil || l.base == nil {
		return
	}
	l.base.Printf("ERROR "+format, args...)
}
