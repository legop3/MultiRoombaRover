BIN_DIR ?= ../../dist
ARCH ?= amd64
GOARCH := $(ARCH)
GOARM :=
ifneq ($(filter armv6 armv7,$(ARCH)),)
GOARCH := arm
GOARM := $(patsubst armv%,%,$(ARCH))
endif

.PHONY: build all armv6 armv7 arm64 amd64 dummy verifier-tools clean

# Binaries are committed to the repository; no release publishing is needed.
build:
	CGO_ENABLED=0 GOOS=linux GOARCH=$(GOARCH) GOARM=$(GOARM) go build -trimpath -ldflags="-s -w" -o $(BIN_DIR)/roverd-linux-$(ARCH) ./cmd/roverd

all: armv6 armv7 arm64 amd64

armv6 armv7 arm64 amd64:
	$(MAKE) build ARCH=$@

verifier-tools:
	CGO_ENABLED=0 GOOS=linux GOARCH=$(GOARCH) GOARM=$(GOARM) go build -trimpath -ldflags="-s -w" -o $(BIN_DIR)/servoverifier-linux-$(ARCH) ./cmd/servoverifier
	CGO_ENABLED=0 GOOS=linux GOARCH=$(GOARCH) GOARM=$(GOARM) go build -trimpath -ldflags="-s -w" -o $(BIN_DIR)/hornverifier-linux-$(ARCH) ./cmd/hornverifier

dummy:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -tags dummy -o $(BIN_DIR)/roverd-dummy ./cmd/roverd

clean:
	rm -f $(BIN_DIR)/roverd-linux-* $(BIN_DIR)/roverd-dummy $(BIN_DIR)/servoverifier-linux-* $(BIN_DIR)/hornverifier-linux-*
