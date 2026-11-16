package roverd

import (
	"testing"
	"time"
)

func TestApplyNetworkThroughputCalculatesMbpsFromActualElapsedTime(t *testing.T) {
	startedAt := time.Unix(100, 0)
	previous := &networkRateSample{rxBytes: 1_000, txBytes: 2_000, sampledAt: startedAt}
	rxBytes := uint64(2_001_000)
	txBytes := uint64(1_002_000)
	stats := &WiFiStats{
		RXBytes:          &rxBytes,
		TXBytes:          &txBytes,
		networkSampledAt: startedAt.Add(2 * time.Second),
	}

	next := applyNetworkThroughput(stats, previous)

	if stats.DownloadMbps == nil || *stats.DownloadMbps != 8.0 {
		t.Fatalf("expected 8.0 Mbps download, got %v", stats.DownloadMbps)
	}
	if stats.UploadMbps == nil || *stats.UploadMbps != 4.0 {
		t.Fatalf("expected 4.0 Mbps upload, got %v", stats.UploadMbps)
	}
	if next == nil || next.rxBytes != rxBytes || next.txBytes != txBytes {
		t.Fatalf("expected current counters to become the next baseline, got %#v", next)
	}
}

func TestApplyNetworkThroughputFirstSampleOnlyEstablishesBaseline(t *testing.T) {
	rxBytes := uint64(100)
	txBytes := uint64(200)
	stats := &WiFiStats{RXBytes: &rxBytes, TXBytes: &txBytes, networkSampledAt: time.Unix(100, 0)}

	next := applyNetworkThroughput(stats, nil)

	if stats.DownloadMbps != nil || stats.UploadMbps != nil {
		t.Fatalf("expected no rates for the first sample, got download=%v upload=%v", stats.DownloadMbps, stats.UploadMbps)
	}
	if next == nil {
		t.Fatal("expected the first valid sample to establish a baseline")
	}
}

func TestApplyNetworkThroughputCounterResetEstablishesNewBaseline(t *testing.T) {
	startedAt := time.Unix(100, 0)
	previous := &networkRateSample{rxBytes: 10_000, txBytes: 20_000, sampledAt: startedAt}
	rxBytes := uint64(10)
	txBytes := uint64(20)
	stats := &WiFiStats{RXBytes: &rxBytes, TXBytes: &txBytes, networkSampledAt: startedAt.Add(time.Second)}

	next := applyNetworkThroughput(stats, previous)

	if stats.DownloadMbps != nil || stats.UploadMbps != nil {
		t.Fatalf("expected no rates after a counter reset, got download=%v upload=%v", stats.DownloadMbps, stats.UploadMbps)
	}
	if next == nil || next.rxBytes != rxBytes || next.txBytes != txBytes {
		t.Fatalf("expected reset counters to become the new baseline, got %#v", next)
	}
}

func TestApplyNetworkThroughputInvalidElapsedTimeEstablishesNewBaseline(t *testing.T) {
	sampledAt := time.Unix(100, 0)
	previous := &networkRateSample{rxBytes: 100, txBytes: 200, sampledAt: sampledAt}
	rxBytes := uint64(200)
	txBytes := uint64(300)
	stats := &WiFiStats{RXBytes: &rxBytes, TXBytes: &txBytes, networkSampledAt: sampledAt}

	next := applyNetworkThroughput(stats, previous)

	if stats.DownloadMbps != nil || stats.UploadMbps != nil {
		t.Fatalf("expected no rates with zero elapsed time, got download=%v upload=%v", stats.DownloadMbps, stats.UploadMbps)
	}
	if next == nil || next.sampledAt != sampledAt {
		t.Fatalf("expected invalid timing sample to become the new baseline, got %#v", next)
	}
}
