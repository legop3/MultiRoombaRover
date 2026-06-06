CXX ?= g++
PKG_CONFIG ?= pkg-config

# Build the production Kinect worker from native C++ so it uses the same
# libfreenect callback/event path that the standalone probe proved reliable.
CXXFLAGS ?= -O2 -std=c++17 -Wall -Wextra -pedantic
CPPFLAGS += $(shell $(PKG_CONFIG) --cflags libfreenect 2>/dev/null)
LDLIBS += $(shell $(PKG_CONFIG) --libs libfreenect 2>/dev/null) -pthread

# Fedora installations do not always provide libfreenect.pc, so keep explicit
# fallback paths for the package layout installed by install_server.sh.
ifeq ($(strip $(CPPFLAGS)),)
CPPFLAGS += -I/usr/include/libfreenect -I/usr/include/libusb-1.0
endif
ifeq ($(filter -lfreenect,$(LDLIBS)),)
LDLIBS += -lfreenect
endif

TARGET := kinect_worker
SRC := kinect_worker.cpp

.PHONY: all clean

all: $(TARGET)

$(TARGET): $(SRC)
	$(CXX) $(CXXFLAGS) $(CPPFLAGS) -o $@ $< $(LDLIBS)

clean:
	rm -f $(TARGET)
