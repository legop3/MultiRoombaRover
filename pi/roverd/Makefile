BIN_DIR ?= ../../dist
GOOS ?= linux
GOARCH ?= arm
GOARM ?= 6

.PHONY: build pi-build debian-laptop dummy verifier-tools clean

build: pi-build debian-laptop dummy

verifier-tools:
	GOOS=$(GOOS) GOARCH=$(GOARCH) GOARM=$(GOARM) go build -trimpath -ldflags="-s -w" -o $(BIN_DIR)/servoverifier ./cmd/servoverifier
	GOOS=$(GOOS) GOARCH=$(GOARCH) GOARM=$(GOARM) go build -trimpath -ldflags="-s -w" -o $(BIN_DIR)/hornverifier ./cmd/hornverifier

pi-build: verifier-tools
	GOOS=$(GOOS) GOARCH=$(GOARCH) GOARM=$(GOARM) go build -trimpath -ldflags="-s -w" -o $(BIN_DIR)/roverd ./cmd/roverd

debian-laptop:
	GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -tags debian_laptop -o $(BIN_DIR)/roverd-debian-laptop ./cmd/roverd

dummy:
	GOOS=linux GOARCH=amd64 go build -tags dummy -o $(BIN_DIR)/roverd-dummy ./cmd/roverd

clean:
	rm -f $(BIN_DIR)/roverd $(BIN_DIR)/roverd-debian-laptop $(BIN_DIR)/roverd-dummy $(BIN_DIR)/servoverifier $(BIN_DIR)/hornverifier
