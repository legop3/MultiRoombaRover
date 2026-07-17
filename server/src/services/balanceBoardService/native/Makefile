CXX ?= g++

# The bridge deliberately uses the stable Linux input and Bluetooth management
# ABIs directly. Keeping it free of third-party libraries makes installation on
# the Fedora server predictable and avoids binding the rover service to an old
# Wii-specific userspace package.
CXXFLAGS ?= -O2 -std=c++17 -Wall -Wextra -pedantic
LDLIBS += -pthread

TARGET := balance_board_worker
SRC := balance_board_worker.cpp

.PHONY: all clean

all: $(TARGET)

$(TARGET): $(SRC)
	$(CXX) $(CXXFLAGS) -o $@ $< $(LDLIBS)

clean:
	rm -f $(TARGET)
