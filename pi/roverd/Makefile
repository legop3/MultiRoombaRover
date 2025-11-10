BIN_DIR ?= ../../dist
GOOS ?= linux
GOARCH ?= arm
GOARM ?= 6

.PHONY: build pi-build clean

build:
	go build -o $(BIN_DIR)/roverd ./cmd/roverd

pi-build:
	GOOS=$(GOOS) GOARCH=$(GOARCH) GOARM=$(GOARM) go build -trimpath -ldflags="-s -w" -o $(BIN_DIR)/roverd ./cmd/roverd

clean:
	rm -f $(BIN_DIR)/roverd
