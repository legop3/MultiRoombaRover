CXX ?= g++
PKG_CONFIG ?= pkg-config

# This probe is intentionally tiny and native.  It links straight against
# libfreenect so it can be compared with freenect-regview without any Node,
# Python, Socket.IO, or browser code in the way.
CXXFLAGS ?= -O2 -std=c++17 -Wall -Wextra -pedantic
CPPFLAGS += $(shell $(PKG_CONFIG) --cflags libfreenect 2>/dev/null)
LDLIBS += $(shell $(PKG_CONFIG) --libs libfreenect 2>/dev/null) -pthread

# Fedora's libfreenect package may not ship a pkg-config file in every install
# shape, so keep the common include/library fallback explicit and boring.
ifeq ($(strip $(CPPFLAGS)),)
CPPFLAGS += -I/usr/include/libfreenect -I/usr/include/libusb-1.0
endif
ifeq ($(filter -lfreenect,$(LDLIBS)),)
LDLIBS += -lfreenect
endif

TARGET := kinect_probe
SRC := kinect_probe.cpp

.PHONY: all clean run

all: $(TARGET)

$(TARGET): $(SRC)
	$(CXX) $(CXXFLAGS) $(CPPFLAGS) -o $@ $< $(LDLIBS)

run: $(TARGET)
	./$(TARGET)

clean:
	rm -f $(TARGET)
