package main

import (
	"context"
	"flag"
	"fmt"
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
	console := roverd.NewConsoleNotifier(logger)

	serialPort, err := roverd.OpenSerial(cfg.Serial)
	if err != nil {
		logger.Fatalf("open serial: %v", err)
	}
	defer serialPort.Close()

	// Peripheral discovery is intentionally a boot-time operation. The manager
	// keeps successful USB ports open across server WebSocket reconnects and is
	// rebuilt only when the roverd process itself restarts.
	peripherals, err := roverd.DiscoverPeripheralManager(ctx, cfg.Serial.Device, logger)
	if err != nil {
		console.Notify(fmt.Sprintf("Rover peripheral startup failed: %v", err))
		logger.Fatalf("discover rover peripherals: %v", err)
	}
	defer peripherals.Close()
	for _, message := range peripherals.StartupBroadcasts() {
		console.Notify(message)
	}

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

	// Backend selection is identical on Pi and laptop hosts: enabled native
	// GPIO wins, otherwise a discovered ESP32 may provide the built-in role.
	hardwareControllers, err := roverd.ResolveRoverHardwareControllers(cfg, peripherals, logger)
	if err != nil {
		console.Notify(fmt.Sprintf("Rover peripheral startup failed while selecting hardware: %v", err))
		logger.Fatalf("resolve rover hardware controllers: %v", err)
	}
	defer hardwareControllers.Close()
	for _, message := range hardwareControllers.StartupBroadcasts() {
		console.Notify(message)
	}

	// A peripheral is never hot-reconnected. Report the first terminal serial
	// failure for each discovered board and tell the local operator exactly what
	// recovery action the fixed boot-time lifecycle requires.
	go func() {
		for {
			select {
			case failure := <-peripherals.Failures():
				console.Notify(fmt.Sprintf(
					"Rover peripheral %q (%s) disconnected: %v. Reconnect it and restart roverd.",
					failure.Name,
					failure.ID,
					failure.Err,
				))
			case <-ctx.Done():
				return
			}
		}
	}()

	autoCharge := roverd.NewAutoChargeController(adapter, eventStream, logger)
	go autoCharge.Run(ctx, sensorSamples)

	client := roverd.NewWSClient(cfg, adapter, sensorFrames, eventStream, mediaSupervisor, hardwareControllers.CameraServo, hardwareControllers.Headlight, hardwareControllers.Laser, peripherals, logger, console)

	// Startup is announced only after every configured hardware dependency has
	// initialized successfully. A message here therefore means the control loop
	// is genuinely ready, rather than merely that systemd launched the process.
	console.Notify("roverd started and hardware initialization completed.")
	defer console.Notify("roverd stopped.")

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
