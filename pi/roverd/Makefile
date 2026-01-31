BIN_DIR ?= ../../dist
GOOS ?= linux
GOARCH ?= arm
GOARM ?= 6

.PHONY: build pi-build dummy clean

build:
	go build -o $(BIN_DIR)/roverd ./cmd/roverd

pi-build:
	GOOS=$(GOOS) GOARCH=$(GOARCH) GOARM=$(GOARM) go build -trimpath -ldflags="-s -w" -o $(BIN_DIR)/roverd ./cmd/roverd
	GOOS=$(GOOS) GOARCH=$(GOARCH) GOARM=$(GOARM) go build -trimpath -ldflags="-s -w" -o $(BIN_DIR)/servoverifier ./cmd/servoverifier
	GOOS=$(GOOS) GOARCH=$(GOARCH) GOARM=$(GOARM) go build -trimpath -ldflags="-s -w" -o $(BIN_DIR)/hornverifier ./cmd/hornverifier

dummy:
	GOOS=linux GOARCH=amd64 go build -tags dummy -o $(BIN_DIR)/roverd-dummy ./cmd/roverd

clean:
	rm -f $(BIN_DIR)/roverd $(BIN_DIR)/servoverifier $(BIN_DIR)/hornverifier
