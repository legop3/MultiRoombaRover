CXX ?= g++

# Wiiuse owns the Balance Board's HID control/interrupt channels and applies the
# calibration stored in the board. This deliberately avoids BlueZ's generic HID
# profile: current BlueZ requests medium link security for a bonded board, and
# the original Balance Board rejects that negotiation before an input device is
# created.
CXXFLAGS ?= -O2 -std=c++17 -Wall -Wextra -pedantic
LDLIBS += -lwiiuse -lbluetooth -pthread

TARGET := balance_board_worker
SRC := balance_board_worker.cpp

.PHONY: all clean

all: $(TARGET)

$(TARGET): $(SRC)
	$(CXX) $(CXXFLAGS) -o $@ $< $(LDLIBS)

clean:
	rm -f $(TARGET)
