package roverd

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	hostStatsInterval = 1 * time.Second
	rootFilesystem    = "/"
)

// HostStats is the wire format sent from roverd to the server. It avoids
// Roomba-specific sensor naming so the browser can treat these values as Pi
// host health, not robot telemetry.
type HostStats struct {
	UptimeSec         *float64          `json:"uptimeSec,omitempty"`
	CPUTempC          *float64          `json:"cpuTempC,omitempty"`
	CPUUsedPct        *float64          `json:"cpuUsedPct,omitempty"`
	CoreVoltageV      *float64          `json:"coreVoltageV,omitempty"`
	LoadAvg1m         *float64          `json:"loadAvg1m,omitempty"`
	MemoryTotalKb     *uint64           `json:"memoryTotalKb,omitempty"`
	MemoryAvailableKb *uint64           `json:"memoryAvailableKb,omitempty"`
	MemoryUsedPct     *float64          `json:"memoryUsedPct,omitempty"`
	DiskTotalBytes    *uint64           `json:"diskTotalBytes,omitempty"`
	DiskFreeBytes     *uint64           `json:"diskFreeBytes,omitempty"`
	DiskUsedPct       *float64          `json:"diskUsedPct,omitempty"`
	WiFi              *WiFiStats        `json:"wifi,omitempty"`
	Media             *MediaTransports  `json:"media,omitempty"`
	ThrottledRaw      string            `json:"throttledRaw,omitempty"`
	UndervoltageNow   *bool             `json:"undervoltageNow,omitempty"`
	UndervoltageSeen  *bool             `json:"undervoltageSeen,omitempty"`
	FrequencyCapNow   *bool             `json:"frequencyCappedNow,omitempty"`
	FrequencyCapSeen  *bool             `json:"frequencyCappedSeen,omitempty"`
	ThrottledNow      *bool             `json:"throttledNow,omitempty"`
	ThrottledSeen     *bool             `json:"throttledSeen,omitempty"`
	SoftTempLimitNow  *bool             `json:"softTempLimitNow,omitempty"`
	SoftTempLimitSeen *bool             `json:"softTempLimitSeen,omitempty"`
	Errors            map[string]string `json:"errors,omitempty"`
}

// WiFiStats contains only network details that are useful in the UI. The
// wireless interface name is intentionally not part of this struct because the
// rover fleet has one active Wi-Fi interface and the user asked not to display
// it.
type WiFiStats struct {
	SSIDSample    string   `json:"ssidSample,omitempty"`
	FrequencyMhz  *int     `json:"frequencyMhz,omitempty"`
	SignalDbm     *float64 `json:"signalDbm,omitempty"`
	Quality       *float64 `json:"quality,omitempty"`
	QualityMax    *float64 `json:"qualityMax,omitempty"`
	NoiseDbm      *float64 `json:"noiseDbm,omitempty"`
	RXBitrateMbit *float64 `json:"rxBitrateMbit,omitempty"`
	TXBitrateMbit *float64 `json:"txBitrateMbit,omitempty"`
	RXBytes       *uint64  `json:"rxBytes,omitempty"`
	TXBytes       *uint64  `json:"txBytes,omitempty"`
	RXPackets     *uint64  `json:"rxPackets,omitempty"`
	TXPackets     *uint64  `json:"txPackets,omitempty"`
	DownloadMbps  *float64 `json:"downloadMbps,omitempty"`
	UploadMbps    *float64 `json:"uploadMbps,omitempty"`
	InactiveMs    *int     `json:"inactiveMs,omitempty"`

	// networkSampledAt records the instant associated with the kernel byte
	// counters. Keeping it out of JSON lets the websocket loop calculate rates
	// with monotonic Go timestamps without expanding the browser contract with
	// an implementation-only value.
	networkSampledAt time.Time
}

// networkRateSample is scoped to one rover websocket connection. A new
// connection intentionally starts a new baseline so counters from an old boot
// or network interface lifetime can never create an artificial traffic spike.
type networkRateSample struct {
	rxBytes   uint64
	txBytes   uint64
	sampledAt time.Time
}

// CollectHostStats gathers every source independently so one missing kernel
// file, firmware utility, or Wi-Fi utility does not suppress the remaining Pi
// health data.
func CollectHostStats(ctx context.Context) HostStats {
	stats := HostStats{Errors: map[string]string{}}

	if uptime, err := readUptimeSec(); err != nil {
		stats.addError("uptime", err)
	} else {
		stats.UptimeSec = &uptime
	}

	if temp, err := readCPUTempC(); err != nil {
		stats.addError("cpuTemp", err)
	} else {
		stats.CPUTempC = &temp
	}

	if cpuUsedPct, err := readCPUUsedPct(); err != nil {
		stats.addError("cpuUsed", err)
	} else {
		stats.CPUUsedPct = &cpuUsedPct
	}

	if load, err := readLoadAvg1m(); err != nil {
		stats.addError("loadAvg", err)
	} else {
		stats.LoadAvg1m = &load
	}

	if memTotal, memAvailable, err := readMemoryKb(); err != nil {
		stats.addError("memory", err)
	} else {
		stats.MemoryTotalKb = &memTotal
		stats.MemoryAvailableKb = &memAvailable
		if memTotal > 0 {
			usedPct := roundOneDecimal(float64(memTotal-memAvailable) / float64(memTotal) * 100)
			stats.MemoryUsedPct = &usedPct
		}
	}

	if diskTotal, diskFree, err := readDiskBytes(rootFilesystem); err != nil {
		stats.addError("disk", err)
	} else {
		stats.DiskTotalBytes = &diskTotal
		stats.DiskFreeBytes = &diskFree
		if diskTotal > 0 {
			usedPct := roundOneDecimal(float64(diskTotal-diskFree) / float64(diskTotal) * 100)
			stats.DiskUsedPct = &usedPct
		}
	}

	if coreV, err := readCoreVoltage(ctx); err != nil {
		stats.addError("coreVoltage", err)
	} else {
		stats.CoreVoltageV = &coreV
	}

	if raw, flags, err := readThrottleFlags(ctx); err != nil {
		stats.addError("throttled", err)
	} else {
		stats.ThrottledRaw = raw
		stats.applyThrottleFlags(flags)
	}

	if wifi, err := collectWiFiStats(ctx); err != nil {
		stats.addError("wifi", err)
		if wifi != nil {
			stats.WiFi = wifi
		}
	} else {
		stats.WiFi = wifi
	}

	// Reads state the publisher scripts wrote; it never runs a command or touches hardware,
	// so it cannot fail in a way worth reporting. Absent state means no publisher has
	// reported yet, which is a normal condition and not an error.
	stats.Media = readMediaTransports(mediaStateDir())

	if len(stats.Errors) == 0 {
		stats.Errors = nil
	}
	return stats
}

func (s *HostStats) addError(source string, err error) {
	if err == nil {
		return
	}
	if s.Errors == nil {
		s.Errors = map[string]string{}
	}
	s.Errors[source] = err.Error()
}

func (s *HostStats) applyThrottleFlags(flags uint64) {
	undervoltageNow := flags&(1<<0) != 0
	frequencyCapNow := flags&(1<<1) != 0
	throttledNow := flags&(1<<2) != 0
	softTempLimitNow := flags&(1<<3) != 0
	undervoltageSeen := flags&(1<<16) != 0
	frequencyCapSeen := flags&(1<<17) != 0
	throttledSeen := flags&(1<<18) != 0
	softTempLimitSeen := flags&(1<<19) != 0

	s.UndervoltageNow = &undervoltageNow
	s.FrequencyCapNow = &frequencyCapNow
	s.ThrottledNow = &throttledNow
	s.SoftTempLimitNow = &softTempLimitNow
	s.UndervoltageSeen = &undervoltageSeen
	s.FrequencyCapSeen = &frequencyCapSeen
	s.ThrottledSeen = &throttledSeen
	s.SoftTempLimitSeen = &softTempLimitSeen
}

func readUptimeSec() (float64, error) {
	raw, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0, err
	}
	fields := strings.Fields(string(raw))
	if len(fields) == 0 {
		return 0, fmt.Errorf("missing uptime value")
	}
	return strconv.ParseFloat(fields[0], 64)
}

func readCPUTempC() (float64, error) {
	raw, err := os.ReadFile("/sys/class/thermal/thermal_zone0/temp")
	if err != nil {
		return 0, err
	}
	milliC, err := strconv.ParseFloat(strings.TrimSpace(string(raw)), 64)
	if err != nil {
		return 0, err
	}
	return roundOneDecimal(milliC / 1000), nil
}

func readCPUUsedPct() (float64, error) {
	first, err := readCPUTimeSample()
	if err != nil {
		return 0, err
	}

	// CPU utilization is a rate, not a directly stored value. Sampling twice
	// over a short window gives the UI a true percentage without carrying global
	// collector state between websocket messages.
	time.Sleep(150 * time.Millisecond)

	second, err := readCPUTimeSample()
	if err != nil {
		return 0, err
	}
	totalDelta := second.total - first.total
	idleDelta := second.idle - first.idle
	if totalDelta == 0 {
		return 0, fmt.Errorf("zero CPU sample delta")
	}
	usedPct := (1 - (float64(idleDelta) / float64(totalDelta))) * 100
	return roundOneDecimal(usedPct), nil
}

type cpuTimeSample struct {
	total uint64
	idle  uint64
}

func readCPUTimeSample() (cpuTimeSample, error) {
	raw, err := os.ReadFile("/proc/stat")
	if err != nil {
		return cpuTimeSample{}, err
	}
	lines := strings.Split(string(raw), "\n")
	if len(lines) == 0 {
		return cpuTimeSample{}, fmt.Errorf("missing /proc/stat cpu line")
	}
	fields := strings.Fields(lines[0])
	if len(fields) < 5 || fields[0] != "cpu" {
		return cpuTimeSample{}, fmt.Errorf("invalid /proc/stat cpu line")
	}

	var values []uint64
	for _, field := range fields[1:] {
		value, err := strconv.ParseUint(field, 10, 64)
		if err != nil {
			return cpuTimeSample{}, err
		}
		values = append(values, value)
	}

	var total uint64
	for _, value := range values {
		total += value
	}

	// Linux reports idle time as idle+iowait. Treating iowait as idle matches
	// common CPU usage tools and avoids making disk waits look like CPU work.
	idle := values[3]
	if len(values) > 4 {
		idle += values[4]
	}
	return cpuTimeSample{total: total, idle: idle}, nil
}

func readLoadAvg1m() (float64, error) {
	raw, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0, err
	}
	fields := strings.Fields(string(raw))
	if len(fields) == 0 {
		return 0, fmt.Errorf("missing load average value")
	}
	load, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0, err
	}
	return roundTwoDecimals(load), nil
}

func readMemoryKb() (uint64, uint64, error) {
	file, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0, err
	}
	defer file.Close()

	var total uint64
	var available uint64
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		key, value, ok := parseMeminfoLine(scanner.Text())
		if !ok {
			continue
		}
		switch key {
		case "MemTotal":
			total = value
		case "MemAvailable":
			available = value
		}
	}
	if err := scanner.Err(); err != nil {
		return 0, 0, err
	}
	if total == 0 || available == 0 {
		return 0, 0, fmt.Errorf("missing MemTotal or MemAvailable")
	}
	return total, available, nil
}

func parseMeminfoLine(line string) (string, uint64, bool) {
	parts := strings.Fields(line)
	if len(parts) < 2 {
		return "", 0, false
	}
	value, err := strconv.ParseUint(parts[1], 10, 64)
	if err != nil {
		return "", 0, false
	}
	return strings.TrimSuffix(parts[0], ":"), value, true
}

func readDiskBytes(path string) (uint64, uint64, error) {
	var fs syscall.Statfs_t
	if err := syscall.Statfs(path, &fs); err != nil {
		return 0, 0, err
	}
	total := fs.Blocks * uint64(fs.Bsize)
	free := fs.Bavail * uint64(fs.Bsize)
	return total, free, nil
}

func readCoreVoltage(ctx context.Context) (float64, error) {
	out, err := runCommand(ctx, "vcgencmd", "measure_volts", "core")
	if err != nil {
		return 0, err
	}
	raw := strings.TrimSpace(out)
	raw = strings.TrimPrefix(raw, "volt=")
	raw = strings.TrimSuffix(raw, "V")
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0, err
	}
	return roundThreeDecimals(value), nil
}

func readThrottleFlags(ctx context.Context) (string, uint64, error) {
	out, err := runCommand(ctx, "vcgencmd", "get_throttled")
	if err != nil {
		return "", 0, err
	}
	raw := strings.TrimSpace(out)
	valueText := strings.TrimPrefix(raw, "throttled=")
	flags, err := strconv.ParseUint(valueText, 0, 64)
	if err != nil {
		return raw, 0, err
	}
	return valueText, flags, nil
}

func collectWiFiStats(ctx context.Context) (*WiFiStats, error) {
	iface, stats, err := readWirelessStats()
	if err != nil {
		return nil, err
	}

	// The interface is used only for local collection. It is not copied into
	// WiFiStats because the UI does not need to expose Linux device names.
	iwErr := enrichWiFiWithIW(ctx, iface, stats)

	// Read the kernel counters after iw because iw also provides cumulative station
	// counters. The kernel interface values deliberately win for both bytes AND packets:
	// mixing the two sources put interface-lifetime bytes next to association-lifetime
	// packets in the same field. Link capacity still comes independently from iw's bitrate
	// fields, which describe the negotiated rate rather than traffic.
	counterErr := enrichWiFiWithNetworkCounters(iface, stats)
	return stats, errors.Join(counterErr, iwErr)
}

func enrichWiFiWithNetworkCounters(iface string, stats *WiFiStats) error {
	basePath := "/sys/class/net/" + iface + "/statistics/"
	rxBytes, err := readUintFile(basePath + "rx_bytes")
	if err != nil {
		return fmt.Errorf("read %s receive bytes: %w", iface, err)
	}
	txBytes, err := readUintFile(basePath + "tx_bytes")
	if err != nil {
		return fmt.Errorf("read %s transmit bytes: %w", iface, err)
	}

	stats.RXBytes = &rxBytes
	stats.TXBytes = &txBytes

	/*
		Packets come from here too, not just bytes.

		Previously iw supplied both and this function overwrote only the byte counters, so the
		UI rendered kernel interface-lifetime bytes beside iw's per-association packet counts -
		two different measurement windows in one "54.1 GB / 281.2m" field. They agree only
		while the association has lasted as long as the interface has been up; after any
		reconnect the packet count restarts and the pairing becomes silently wrong.

		A packet read failure is tolerated rather than fatal: bytes are the more useful figure
		and drive the Mbps calculation, so losing packet counts must not discard them.
	*/
	if rxPackets, err := readUintFile(basePath + "rx_packets"); err == nil {
		stats.RXPackets = &rxPackets
	}
	if txPackets, err := readUintFile(basePath + "tx_packets"); err == nil {
		stats.TXPackets = &txPackets
	}

	// Capture the timestamp immediately beside the counter reads so unrelated
	// host-stat collection latency cannot distort the elapsed-time divisor.
	stats.networkSampledAt = time.Now()
	return nil
}

func readUintFile(path string) (uint64, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	return strconv.ParseUint(strings.TrimSpace(string(raw)), 10, 64)
}

func applyNetworkThroughput(stats *WiFiStats, previous *networkRateSample) *networkRateSample {
	if stats == nil || stats.RXBytes == nil || stats.TXBytes == nil || stats.networkSampledAt.IsZero() {
		// Do not discard the last valid baseline during a temporary read failure.
		// The next successful calculation then covers the full elapsed interval and
		// remains an accurate average for all traffic transferred during the gap.
		return previous
	}

	current := &networkRateSample{
		rxBytes:   *stats.RXBytes,
		txBytes:   *stats.TXBytes,
		sampledAt: stats.networkSampledAt,
	}
	if previous == nil {
		return current
	}

	elapsed := current.sampledAt.Sub(previous.sampledAt).Seconds()
	// Linux counters can return to zero after an interface reset. Re-baselining
	// on any decrease prevents unsigned underflow from becoming a huge false
	// throughput spike in the host-stat card.
	if elapsed <= 0 || current.rxBytes < previous.rxBytes || current.txBytes < previous.txBytes {
		return current
	}

	downloadMbps := bytesToMbps(current.rxBytes-previous.rxBytes, elapsed)
	uploadMbps := bytesToMbps(current.txBytes-previous.txBytes, elapsed)
	stats.DownloadMbps = &downloadMbps
	stats.UploadMbps = &uploadMbps
	return current
}

func bytesToMbps(byteDelta uint64, elapsedSeconds float64) float64 {
	// Mbps uses decimal megabits, matching network equipment and link-rate
	// conventions: eight bits per byte and 1,000,000 bits per megabit.
	return roundOneDecimal((float64(byteDelta) * 8) / elapsedSeconds / 1_000_000)
}

func readWirelessStats() (string, *WiFiStats, error) {
	file, err := os.Open("/proc/net/wireless")
	if err != nil {
		return "", nil, err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	lineNumber := 0
	for scanner.Scan() {
		lineNumber++
		if lineNumber <= 2 {
			continue
		}
		iface, stats, ok := parseWirelessLine(scanner.Text())
		if ok {
			return iface, stats, nil
		}
	}
	if err := scanner.Err(); err != nil {
		return "", nil, err
	}
	return "", nil, fmt.Errorf("no active wireless stats")
}

func parseWirelessLine(line string) (string, *WiFiStats, bool) {
	parts := strings.Fields(strings.TrimSpace(line))
	if len(parts) < 5 {
		return "", nil, false
	}
	iface := strings.TrimSuffix(parts[0], ":")
	if iface == "" {
		return "", nil, false
	}

	stats := &WiFiStats{}
	if quality, err := parseWirelessFloat(parts[2]); err == nil {
		stats.Quality = &quality
		qualityMax := 70.0
		stats.QualityMax = &qualityMax
	}
	if signal, err := parseWirelessFloat(parts[3]); err == nil && signal > -200 {
		stats.SignalDbm = &signal
	}
	if noise, err := parseWirelessFloat(parts[4]); err == nil && noise > -200 {
		stats.NoiseDbm = &noise
	}
	return iface, stats, true
}

func parseWirelessFloat(raw string) (float64, error) {
	return strconv.ParseFloat(strings.TrimSuffix(raw, "."), 64)
}

func enrichWiFiWithIW(ctx context.Context, iface string, stats *WiFiStats) error {
	out, err := runCommand(ctx, "iw", "dev", iface, "link")
	if err != nil {
		return err
	}
	for _, line := range strings.Split(out, "\n") {
		parseIWLine(strings.TrimSpace(line), stats)
	}
	return nil
}

func parseIWLine(line string, stats *WiFiStats) {
	switch {
	case strings.HasPrefix(line, "SSID:"):
		ssid := strings.TrimSpace(strings.TrimPrefix(line, "SSID:"))
		stats.SSIDSample = sampleSSID(ssid)
	case strings.HasPrefix(line, "freq:"):
		if value, ok := parseFirstInt(strings.TrimSpace(strings.TrimPrefix(line, "freq:"))); ok {
			stats.FrequencyMhz = &value
		}
	case strings.HasPrefix(line, "signal:"):
		if value, ok := parseFirstFloat(strings.TrimSpace(strings.TrimPrefix(line, "signal:"))); ok {
			stats.SignalDbm = &value
		}
	case strings.HasPrefix(line, "rx bitrate:"):
		if value, ok := parseFirstFloat(strings.TrimSpace(strings.TrimPrefix(line, "rx bitrate:"))); ok {
			stats.RXBitrateMbit = &value
		}
	case strings.HasPrefix(line, "tx bitrate:"):
		if value, ok := parseFirstFloat(strings.TrimSpace(strings.TrimPrefix(line, "tx bitrate:"))); ok {
			stats.TXBitrateMbit = &value
		}
	case strings.HasPrefix(line, "inactive time:"):
		if value, ok := parseFirstInt(strings.TrimSpace(strings.TrimPrefix(line, "inactive time:"))); ok {
			stats.InactiveMs = &value
		}
	case strings.HasPrefix(line, "RX:"):
		parseIWPackedCounter(strings.TrimSpace(strings.TrimPrefix(line, "RX:")), &stats.RXBytes, &stats.RXPackets)
	case strings.HasPrefix(line, "TX:"):
		parseIWPackedCounter(strings.TrimSpace(strings.TrimPrefix(line, "TX:")), &stats.TXBytes, &stats.TXPackets)
	}
}

func parseIWPackedCounter(raw string, bytesTarget **uint64, packetsTarget **uint64) {
	fields := strings.Fields(raw)
	if len(fields) == 0 {
		return
	}
	if bytes, err := strconv.ParseUint(fields[0], 10, 64); err == nil {
		*bytesTarget = &bytes
	}
	for idx, field := range fields {
		if strings.HasPrefix(field, "(") && idx+1 < len(fields) {
			packetText := strings.TrimPrefix(field, "(")
			if packets, err := strconv.ParseUint(packetText, 10, 64); err == nil {
				*packetsTarget = &packets
			}
			return
		}
	}
}

func sampleSSID(ssid string) string {
	runes := []rune(ssid)
	var builder strings.Builder
	for idx, r := range runes {
		if idx%2 == 0 {
			builder.WriteRune(r)
		}
	}
	return builder.String()
}

func parseFirstFloat(raw string) (float64, bool) {
	fields := strings.Fields(raw)
	if len(fields) == 0 {
		return 0, false
	}
	value, err := strconv.ParseFloat(fields[0], 64)
	return value, err == nil
}

func parseFirstInt(raw string) (int, bool) {
	fields := strings.Fields(raw)
	if len(fields) == 0 {
		return 0, false
	}
	value, err := strconv.Atoi(fields[0])
	return value, err == nil
}

func runCommand(ctx context.Context, name string, args ...string) (string, error) {
	cmdCtx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, name, args...)
	out, err := cmd.Output()
	if cmdCtx.Err() != nil {
		return "", cmdCtx.Err()
	}
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func roundOneDecimal(value float64) float64 {
	return math.Round(value*10) / 10
}

func roundTwoDecimals(value float64) float64 {
	return math.Round(value*100) / 100
}

func roundThreeDecimals(value float64) float64 {
	return math.Round(value*1000) / 1000
}
