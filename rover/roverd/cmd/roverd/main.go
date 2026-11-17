package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	roverd "multiroombarover/rover/roverd"
)

func main() {
	var cfgPath string
	var repoPath string
	flag.StringVar(&repoPath, "repo", "/opt/roverd", "managed repository checkout")
	flag.StringVar(&cfgPath, "config", "/etc/roverd.json", "path to roverd JSON configuration")
	printDefaults := flag.Bool("print-default-config", false, "print a complete initial JSON configuration and exit")
	printProfiles := flag.Bool("print-media-profiles", false, "read and print media profiles without running commands")
	printAudio := flag.Bool("print-audio-config", false, "print generated ALSA configuration without installing it")
	printSchema := flag.Bool("print-config-schema", false, "print the configuration JSON Schema and exit")
	checkConfig := flag.Bool("check-config", false, "validate configuration without opening hardware or connecting")
	flag.Parse()
	if *printProfiles {
		profiles, err := roverd.LoadMediaProfiles(repoPath)
		if err != nil {
			log.Fatal(err)
		}
		data, _ := json.MarshalIndent(profiles, "", "  ")
		fmt.Println(string(data))
		return
	}
	if *printDefaults {
		data, _ := json.MarshalIndent(roverd.DefaultConfig(), "", "  ")
		fmt.Println(string(data))
		return
	}
	if *printSchema {
		fmt.Println(string(roverd.ConfigurationSchema()))
		return
	}
	cfg, err := roverd.LoadConfig(cfgPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	if *printAudio {
		fmt.Print(roverd.AudioConfiguration(cfg.Audio))
		return
	}
	if *checkConfig {
		fmt.Println("Configuration valid")
		return
	}
	if run(cfg, cfgPath, repoPath) {
		executable, err := os.Executable()
		if err != nil {
			log.Fatal(err)
		}
		if err := syscall.Exec(executable, os.Args, os.Environ()); err != nil {
			log.Fatalf("restart roverd: %v", err)
		}
	}
}

func run(cfg *roverd.Config, cfgPath, repoPath string) bool {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	logger := log.New(os.Stdout, "roverd: ", log.LstdFlags|log.Lmicroseconds|log.LUTC)
	events := make(chan roverd.RoverEvent, 128)
	console := roverd.NewConsoleNotifier(logger)
	console.SetEvents(events)
	var restarting atomic.Bool
	management := roverd.NewManagementClient(cfg, cfgPath, events, logger, func() { restarting.Store(true); cancel() })
	if err := roverd.ConfigureAudio(cfg.Audio); err != nil {
		console.Notify(fmt.Sprintf("Audio routing unavailable: %v", err))
	}
	media, err := roverd.NewMediaSupervisor(cfg, repoPath, events, logger)
	if err != nil {
		console.Notify(fmt.Sprintf("Media profiles unavailable: %v", err))
	}
	management.SetMedia(media)
	management.SetRepository(repoPath)
	managementDone := make(chan struct{})
	go func() { defer close(managementDone); management.Run(ctx) }()
	if media != nil {
		media.Start(ctx)
		defer media.Stop()
	}
	if err := runHardware(ctx, cfg, events, management, media, logger, console); err != nil {
		console.Notify(fmt.Sprintf("Hardware unavailable: %v. Management remains connected.", err))
	}
	<-ctx.Done()
	<-managementDone
	return restarting.Load()
}

func runHardware(ctx context.Context, cfg *roverd.Config, eventStream chan roverd.RoverEvent, management *roverd.ManagementClient, mediaSupervisor *roverd.MediaSupervisor, logger *log.Logger, console *roverd.ConsoleNotifier) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	serialPort, err := roverd.OpenSerial(cfg.Serial)
	if err != nil {
		return fmt.Errorf("open serial: %w", err)
	}
	defer serialPort.Close()

	// Peripheral discovery is intentionally a boot-time operation. The manager
	// keeps successful USB ports open across server WebSocket reconnects and is
	// rebuilt only when the roverd process itself restarts.
	peripherals, err := roverd.DiscoverPeripheralManager(ctx, cfg.Serial.Device, logger)
	if err != nil {
		console.Notify(fmt.Sprintf("Rover peripheral startup failed: %v", err))
		return fmt.Errorf("discover rover peripherals: %w", err)
	}
	defer peripherals.Close()

	sensorFrames := make(chan []byte, 8)
	sensorSamples := make(chan roverd.SensorSample, 8)

	streamer := roverd.NewSensorStreamer(serialPort, sensorFrames, sensorSamples, logger)
	go streamer.Run(ctx)

	adapter := roverd.NewSerialAdapter(serialPort, logger)

	// Resolve roles across external and internal peripherals without transport priority.
	hardwareControllers, err := roverd.ResolveRoverHardwareControllers(cfg, peripherals, logger)
	if err != nil {
		console.Notify(fmt.Sprintf("Rover peripheral startup failed while selecting hardware: %v", err))
		return fmt.Errorf("resolve rover hardware controllers: %w", err)
	}
	defer hardwareControllers.Close()
	if err := peripherals.StartInternal(ctx); err != nil {
		logger.Printf("internal peripheral: %v", err)
		console.Notify(fmt.Sprintf("Pi GPIO background function unavailable: %v", err))
	}
	for _, message := range peripherals.StartupBroadcasts() {
		console.Notify(message)
	}

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

	client := roverd.NewWSClient(cfg, adapter, sensorFrames, eventStream, mediaSupervisor, hardwareControllers.CameraServo, hardwareControllers.Headlight, hardwareControllers.Laser, peripherals, logger, console)
	client.SetAutoCharge(autoCharge)
	go autoCharge.Run(ctx, sensorSamples)
	if !management.SetRuntime(client, mediaSupervisor) {
		return nil
	}
	defer client.PrepareShutdown()

	// The control loop is ready after startup resolution. Individual unavailable
	// peripheral roles have already been reported and do not prevent connection.
	console.Notify("roverd started and hardware initialization completed.")
	defer console.Notify("roverd stopped.")

	retryDelay := time.Second
	for ctx.Err() == nil {
		if err := client.Run(ctx); err != nil {
			logger.Printf("websocket loop ended: %v", err)
		}

		select {
		case <-ctx.Done():
			return nil
		case <-time.After(retryDelay):
		}

		if retryDelay < 30*time.Second {
			retryDelay *= 2
		}
	}

	return nil
}
