package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"cockpit-v6-market-go/internal/config"
	"cockpit-v6-market-go/internal/engine"
	"cockpit-v6-market-go/internal/logx"
	localws "cockpit-v6-market-go/internal/ws"
)

func main() {
	cfg := config.FromEnv()
	logger := logx.New(os.Stdout)
	marketEngine := engine.New(cfg, logger)
	server := localws.NewServer(cfg, marketEngine, logger)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := server.Run(ctx); err != nil {
		logger.Errorf("marketd stopped with error: %v", err)
		os.Exit(1)
	}
}
