package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	roverd "multiroombarover/pi/roverd"
)

func main() {
	var cfgPath string
	flag.StringVar(&cfgPath, "config", "/etc/roverd.yaml", "path to roverd configuration file")
	flag.Parse()

	cfg, err := roverd.LoadConfig(cfgPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	if err := roverd.UpdatePublisherEnv(cfg.Media); err != nil {
		log.Fatalf("prepare media env: %v", err)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	logger := log.New(os.Stdout, "roverd: ", log.LstdFlags|log.Lmicroseconds|log.LUTC)

	serialPort, err := roverd.OpenSerial(cfg.Serial)
	if err != nil {
		logger.Fatalf("open serial: %v", err)
	}
	defer serialPort.Close()

	var pulser *roverd.BRCPulser
	if cfg.BRC.Enabled() {
		pulser, err = roverd.NewBRCPulser(cfg.BRC, logger)
		if err != nil {
			logger.Fatalf("init BRC pulser: %v", err)
		}
		defer pulser.Close()
		pulser.Start(ctx)
	}

	sensorFrames := make(chan []byte, 8)
	sensorSamples := make(chan roverd.SensorSample, 8)
	eventStream := make(chan roverd.RoverEvent, 16)

	streamer := roverd.NewSensorStreamer(serialPort, sensorFrames, sensorSamples, logger)
	go streamer.Run(ctx)

	adapter := roverd.NewSerialAdapter(serialPort, logger)

	mediaSupervisor := roverd.NewMediaSupervisor(cfg.Media, logger)
	if mediaSupervisor != nil {
		mediaSupervisor.Start(ctx)
	}

	autoCharge := roverd.NewAutoChargeController(adapter, eventStream, logger)
	go autoCharge.Run(ctx, sensorSamples)

	client := roverd.NewWSClient(cfg, adapter, sensorFrames, eventStream, mediaSupervisor, logger)

	retryDelay := time.Second
	for ctx.Err() == nil {
		if err := client.Run(ctx); err != nil {
			logger.Printf("websocket loop ended: %v", err)
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(retryDelay):
		}

		if retryDelay < 30*time.Second {
			retryDelay *= 2
		}
	}
}
