// Wii Balance Board native bridge.
//
// Purpose:
// Pair one original Nintendo RVL-WBC-01 through modern BlueZ, then expose the
// calibrated Linux input readings as newline-delimited JSON for the Node server.
//
// Why this process exists:
// The Linux hid-wiimote driver already performs the board-specific calibration,
// but BlueZ removed its Wii PIN helper in 2025. A Wii device expects six raw PIN
// bytes equal to the host Bluetooth adapter address in wire order. D-Bus represents PINs
// as UTF-8 strings and cannot safely carry arbitrary bytes, so this bridge races
// BlueZ's agent response with the correct raw MGMT_OP_PIN_CODE_REPLY. Only the
// board currently being commissioned is eligible for that reply.
//
// Security boundary:
// The installed binary receives CAP_NET_ADMIN solely to open the Bluetooth
// management socket. The much larger Node server remains unprivileged. Normal
// sensor access happens through a narrowly scoped udev rule.

#include <linux/input.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cerrno>
#include <chrono>
#include <csignal>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <dirent.h>
#include <fcntl.h>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <optional>
#include <poll.h>
#include <sstream>
#include <string>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>
#include <vector>

namespace {

constexpr const char* kBoardBluetoothName = "Nintendo RVL-WBC-01";
constexpr const char* kBoardInputName = "Nintendo Wii Remote Balance Board";
constexpr int kBluetoothProtocolHci = 1;
constexpr uint16_t kHciChannelControl = 3;
constexpr uint16_t kHciDeviceNone = 0xffff;
constexpr uint16_t kMgmtPinCodeRequestEvent = 0x000e;
constexpr uint16_t kMgmtPinCodeReplyCommand = 0x0016;
constexpr uint8_t kBluetoothClassicAddressType = 0;
constexpr int kFrameIntervalMs = 50;
constexpr int kDeviceScanIntervalMs = 500;
constexpr int kDiscoveryRestartDelayMs = 1000;
constexpr int kBatteryRefreshMs = 5000;

std::atomic<bool> running{true};
std::mutex output_mutex;

struct BluetoothAddress {
  std::string display;
  // The kernel Bluetooth management API carries addresses least-significant
  // byte first. These exact six bytes are also the Wii pairing PIN.
  std::array<uint8_t, 6> wire{};
};

struct PairingSharedState {
  std::mutex mutex;
  std::optional<BluetoothAddress> active_target;
  std::optional<BluetoothAddress> active_pin;
  std::optional<std::string> commissioned_address;
  bool commissioning = false;
  bool pairing_available = true;
};

struct BoardReadings {
  int top_right = 0;
  int bottom_right = 0;
  int top_left = 0;
  int bottom_left = 0;
};

struct CommandResult {
  int exit_code = -1;
  std::string output;
};

struct RunningCommand {
  pid_t pid = -1;
  int output_fd = -1;
  std::string pending_output;
  std::string transcript;
};

uint64_t monotonic_ms() {
  using namespace std::chrono;
  return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

std::string json_escape(const std::string& value) {
  std::ostringstream out;
  for (unsigned char ch : value) {
    switch (ch) {
      case '\\': out << "\\\\"; break;
      case '"': out << "\\\""; break;
      case '\n': out << "\\n"; break;
      case '\r': out << "\\r"; break;
      case '\t': out << "\\t"; break;
      default:
        if (ch < 0x20) {
          out << "\\u" << std::hex << std::setw(4) << std::setfill('0')
              << static_cast<int>(ch) << std::dec;
        } else {
          out << static_cast<char>(ch);
        }
    }
  }
  return out.str();
}

void emit_json(const std::string& fields) {
  // Pairing and input monitoring run on separate threads. Serialize complete
  // lines so two status changes can never interleave and corrupt Node's parser.
  std::lock_guard<std::mutex> lock(output_mutex);
  std::cout << "{" << fields << "}\n";
  std::cout.flush();
}

void emit_status(const std::string& state, const std::string& address = "",
                 const std::string& error = "") {
  std::ostringstream fields;
  fields << "\"type\":\"status\",\"state\":\"" << json_escape(state) << "\"";
  if (!address.empty()) fields << ",\"address\":\"" << json_escape(address) << "\"";
  if (!error.empty()) fields << ",\"error\":\"" << json_escape(error) << "\"";
  emit_json(fields.str());
}

void emit_frame(const BoardReadings& readings, std::optional<int> battery_percent = std::nullopt) {
  std::ostringstream fields;
  fields << "\"type\":\"frame\",\"corners\":{"
         << "\"topRight\":" << readings.top_right << ","
         << "\"bottomRight\":" << readings.bottom_right << ","
         << "\"topLeft\":" << readings.top_left << ","
         << "\"bottomLeft\":" << readings.bottom_left << "}";
  if (battery_percent.has_value()) fields << ",\"batteryPercent\":" << *battery_percent;
  emit_json(fields.str());
}

std::optional<int> read_board_battery() {
  static uint64_t last_read_at = 0;
  static std::optional<int> cached;
  const uint64_t now = monotonic_ms();
  if (now - last_read_at < kBatteryRefreshMs) return cached;
  last_read_at = now;

  DIR* directory = opendir("/sys/class/power_supply");
  if (!directory) return cached;
  while (dirent* entry = readdir(directory)) {
    if (std::strncmp(entry->d_name, "wiimote_battery_", 16) != 0) continue;
    std::ifstream capacity(std::string("/sys/class/power_supply/") + entry->d_name + "/capacity");
    int value = -1;
    if (capacity >> value) cached = std::max(0, std::min(100, value));
    break;
  }
  closedir(directory);
  return cached;
}

void signal_handler(int) {
  running.store(false);
}

std::optional<BluetoothAddress> parse_address(const std::string& raw) {
  std::array<unsigned int, 6> bytes{};
  if (std::sscanf(raw.c_str(), "%2x:%2x:%2x:%2x:%2x:%2x",
                  &bytes[0], &bytes[1], &bytes[2], &bytes[3], &bytes[4], &bytes[5]) != 6) {
    return std::nullopt;
  }

  BluetoothAddress address;
  char normalized[18]{};
  std::snprintf(normalized, sizeof(normalized), "%02X:%02X:%02X:%02X:%02X:%02X",
                bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
  address.display = normalized;
  for (std::size_t i = 0; i < address.wire.size(); ++i) {
    address.wire[i] = static_cast<uint8_t>(bytes[address.wire.size() - 1 - i]);
  }
  return address;
}

CommandResult run_command(const std::vector<std::string>& args) {
  CommandResult result;
  if (args.empty()) return result;

  int pipe_fds[2]{};
  if (pipe(pipe_fds) != 0) {
    result.output = std::strerror(errno);
    return result;
  }

  const pid_t pid = fork();
  if (pid == 0) {
    dup2(pipe_fds[1], STDOUT_FILENO);
    dup2(pipe_fds[1], STDERR_FILENO);
    close(pipe_fds[0]);
    close(pipe_fds[1]);

    std::vector<char*> argv;
    argv.reserve(args.size() + 1);
    for (const auto& arg : args) argv.push_back(const_cast<char*>(arg.c_str()));
    argv.push_back(nullptr);
    execvp(argv[0], argv.data());
    _exit(127);
  }

  close(pipe_fds[1]);
  if (pid < 0) {
    close(pipe_fds[0]);
    result.output = std::strerror(errno);
    return result;
  }

  std::array<char, 1024> buffer{};
  ssize_t count = 0;
  while ((count = read(pipe_fds[0], buffer.data(), buffer.size())) > 0) {
    result.output.append(buffer.data(), static_cast<std::size_t>(count));
  }
  close(pipe_fds[0]);

  int status = 0;
  while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {}
  if (WIFEXITED(status)) result.exit_code = WEXITSTATUS(status);
  return result;
}

RunningCommand start_command(const std::vector<std::string>& args) {
  RunningCommand command;
  if (args.empty()) return command;

  int pipe_fds[2]{};
  if (pipe(pipe_fds) != 0) {
    command.transcript = std::strerror(errno);
    return command;
  }

  const pid_t pid = fork();
  if (pid == 0) {
    dup2(pipe_fds[1], STDOUT_FILENO);
    dup2(pipe_fds[1], STDERR_FILENO);
    close(pipe_fds[0]);
    close(pipe_fds[1]);

    std::vector<char*> argv;
    argv.reserve(args.size() + 1);
    for (const auto& arg : args) argv.push_back(const_cast<char*>(arg.c_str()));
    argv.push_back(nullptr);
    execvp(argv[0], argv.data());
    _exit(127);
  }

  close(pipe_fds[1]);
  if (pid < 0) {
    command.transcript = std::strerror(errno);
    close(pipe_fds[0]);
    return command;
  }

  // Discovery has no predetermined completion time: it must remain active until
  // the user wakes the board. A nonblocking pipe lets the commissioning thread
  // consume BlueZ events while still honoring server shutdown and maintenance
  // commands promptly.
  const int current_flags = fcntl(pipe_fds[0], F_GETFL, 0);
  if (current_flags >= 0) fcntl(pipe_fds[0], F_SETFL, current_flags | O_NONBLOCK);
  command.pid = pid;
  command.output_fd = pipe_fds[0];
  return command;
}

bool collect_command_output(RunningCommand* command) {
  if (!command || command->pid < 0) return false;

  std::array<char, 1024> buffer{};
  ssize_t count = 0;
  while ((count = read(command->output_fd, buffer.data(), buffer.size())) > 0) {
    const std::string chunk(buffer.data(), static_cast<std::size_t>(count));
    command->pending_output += chunk;
    command->transcript += chunk;
    // A busy Bluetooth environment can produce an unbounded stream of RSSI
    // updates. Retain only the most recent diagnostics instead of allowing a
    // commissioning session left open for days to grow the worker indefinitely.
    constexpr std::size_t max_transcript_size = 8192;
    if (command->transcript.size() > max_transcript_size) {
      command->transcript.erase(0, command->transcript.size() - max_transcript_size);
    }
  }

  int status = 0;
  const pid_t waited = waitpid(command->pid, &status, WNOHANG);
  if (waited == 0) return true;
  if (waited == command->pid) {
    command->pid = -1;
  }
  return false;
}

void stop_command(RunningCommand* command) {
  if (!command) return;
  if (command->pid > 0) {
    // bluetoothctl normally exits immediately on SIGTERM. Bound that grace
    // period so a wedged D-Bus client cannot prevent the server from stopping.
    kill(command->pid, SIGTERM);
    for (int attempt = 0; attempt < 50 && command->pid > 0; ++attempt) {
      collect_command_output(command);
      if (command->pid > 0) usleep(10000);
    }
    if (command->pid > 0) {
      kill(command->pid, SIGKILL);
      int status = 0;
      while (waitpid(command->pid, &status, 0) < 0 && errno == EINTR) {}
      command->pid = -1;
    }
  }
  if (command->output_fd >= 0) {
    close(command->output_fd);
    command->output_fd = -1;
  }
}

std::optional<BluetoothAddress> take_discovered_board(RunningCommand* discovery) {
  if (!discovery) return std::nullopt;
  std::size_t newline = discovery->pending_output.find('\n');
  while (newline != std::string::npos) {
    const std::string line = discovery->pending_output.substr(0, newline);
    discovery->pending_output.erase(0, newline + 1);

    // A Classic device is initially announced by address and receives its name
    // in a later change event. Parse every complete scan line so either BlueZ
    // form works, but require the exact Nintendo board name before accepting an
    // address. A nearby Wiimote must never become eligible for the raw PIN.
    if (line.find(kBoardBluetoothName) != std::string::npos) {
      const std::size_t device_prefix = line.find("Device ");
      if (device_prefix != std::string::npos && line.size() >= device_prefix + 24) {
        if (auto address = parse_address(line.substr(device_prefix + 7, 17))) return address;
      }
    }
    newline = discovery->pending_output.find('\n');
  }
  return std::nullopt;
}

std::string command_error_summary(const std::string& raw, const std::string& fallback) {
  std::string summary;
  summary.reserve(std::min<std::size_t>(raw.size(), 400));
  bool previous_was_space = false;
  for (unsigned char ch : raw) {
    const bool is_space = ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r';
    if (is_space) {
      if (!summary.empty() && !previous_was_space) summary.push_back(' ');
    } else if (ch >= 0x20) {
      summary.push_back(static_cast<char>(ch));
    }
    previous_was_space = is_space;
    if (summary.size() >= 400) break;
  }
  while (!summary.empty() && summary.back() == ' ') summary.pop_back();
  return summary.empty() ? fallback : summary;
}

std::optional<BluetoothAddress> find_default_controller() {
  const CommandResult controller = run_command({"bluetoothctl", "show"});
  std::istringstream lines(controller.output);
  std::string line;
  while (std::getline(lines, line)) {
    const std::size_t controller_prefix = line.find("Controller ");
    if (controller_prefix == std::string::npos || line.size() < controller_prefix + 28) continue;
    if (auto address = parse_address(line.substr(controller_prefix + 11, 17))) return address;
  }
  return std::nullopt;
}

bool command_succeeded(const CommandResult& result) {
  if (result.exit_code != 0) return false;
  return result.output.find("Failed") == std::string::npos &&
         result.output.find("not available") == std::string::npos;
}

void prepare_known_device(const BluetoothAddress& address) {
  run_command({"bluetoothctl", "--timeout", "8", "trust", address.display});
  // WakeAllowed tells current BlueZ releases to accept the board's incoming HID
  // connection after its front power button is pressed. Older releases may not
  // implement the command; trust + the stored link key still remain effective.
  run_command({"bluetoothctl", "--timeout", "8", "wake", address.display, "on"});
}

void trust_and_connect(const BluetoothAddress& address) {
  prepare_known_device(address);
  // A board remains awake for only a short window after Sync. Connecting the
  // HID profile immediately is what teaches it to initiate future connections
  // when its front power button is pressed.
  run_command({"bluetoothctl", "--timeout", "8", "connect", address.display});
}

void commissioning_loop(PairingSharedState* shared) {
  while (running.load()) {
    bool should_commission = false;
    {
      std::lock_guard<std::mutex> lock(shared->mutex);
      should_commission = shared->commissioning && !shared->commissioned_address.has_value();
    }

    if (!should_commission) {
      std::this_thread::sleep_for(std::chrono::milliseconds(250));
      continue;
    }

    emit_status("commissioning");
    // Commissioning must be listening before the board's short red-Sync window
    // begins. Keep one BlueZ discovery client alive continuously and consume its
    // own event stream. The previous bounded scan exited for twelve seconds at a
    // time and then queried a second client, making successful discovery depend
    // on when the physical button happened to be pressed.
    RunningCommand discovery = start_command({"bluetoothctl", "scan", "bredr"});
    if (discovery.pid < 0) {
      emit_status("error", "", "could not start Bluetooth discovery: " +
          command_error_summary(discovery.transcript, "unknown process error"));
      std::this_thread::sleep_for(std::chrono::milliseconds(kDiscoveryRestartDelayMs));
      continue;
    }

    std::optional<BluetoothAddress> address;
    while (running.load() && !address.has_value()) {
      const bool discovery_running = collect_command_output(&discovery);
      address = take_discovered_board(&discovery);
      if (address.has_value()) break;
      if (!discovery_running) {
        emit_status("error", "", "Bluetooth discovery stopped: " +
            command_error_summary(discovery.transcript, "bluetoothctl exited unexpectedly"));
        break;
      }

      bool still_commissioning = false;
      {
        std::lock_guard<std::mutex> lock(shared->mutex);
        still_commissioning = shared->commissioning &&
            !shared->commissioned_address.has_value();
      }
      if (!still_commissioning) break;
      std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }

    if (!address.has_value()) {
      stop_command(&discovery);
      if (running.load()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(kDiscoveryRestartDelayMs));
      }
      continue;
    }

    const auto controller = find_default_controller();
    if (!controller.has_value()) {
      stop_command(&discovery);
      emit_status("commissioning", address->display,
                  "no powered Bluetooth controller is available for pairing");
      std::this_thread::sleep_for(std::chrono::milliseconds(kDiscoveryRestartDelayMs));
      continue;
    }

    {
      std::lock_guard<std::mutex> lock(shared->mutex);
      shared->active_target = address;
      // Red-Sync commissioning stores the host as the board's future reconnect
      // target. BlueZ's retired wiimote plugin therefore used the local adapter
      // address—not the board address—as the six raw PIN bytes.
      shared->active_pin = controller;
    }
    emit_status("pairing", address->display);

    // The management-socket listener answers the PIN request while this command
    // keeps BlueZ's normal device, SDP, bonding, and input-profile machinery in
    // charge of everything else.
    const CommandResult pair_result = run_command({
        "bluetoothctl", "--timeout", "12", "--agent", "NoInputNoOutput", "pair", address->display});
    // Keep the discovery owner alive through Pair(). BlueZ documents pairing by
    // address as requiring an active scan report, and the board may stop its
    // Sync window before a new discovery client could be established.
    stop_command(&discovery);

    {
      std::lock_guard<std::mutex> lock(shared->mutex);
      shared->active_target.reset();
      shared->active_pin.reset();
    }

    if (!command_succeeded(pair_result)) {
      emit_status("commissioning", address->display,
                  "pairing failed: " + command_error_summary(
                      pair_result.output, "BlueZ returned an unknown pairing error"));
      std::this_thread::sleep_for(std::chrono::milliseconds(kDiscoveryRestartDelayMs));
      continue;
    }

    trust_and_connect(*address);
    {
      std::lock_guard<std::mutex> lock(shared->mutex);
      shared->commissioned_address = address->display;
      shared->commissioning = false;
    }
    emit_json("\"type\":\"paired\",\"address\":\"" + json_escape(address->display) + "\"");
    emit_status("waiting", address->display);
  }
}

#pragma pack(push, 1)
struct SockaddrHci {
  uint16_t family;
  uint16_t device;
  uint16_t channel;
};
#pragma pack(pop)

int open_management_socket() {
  const int fd = socket(AF_BLUETOOTH, SOCK_RAW | SOCK_CLOEXEC | SOCK_NONBLOCK,
                        kBluetoothProtocolHci);
  if (fd < 0) return -1;

  const SockaddrHci address{
      static_cast<uint16_t>(AF_BLUETOOTH), kHciDeviceNone, kHciChannelControl};
  if (bind(fd, reinterpret_cast<const sockaddr*>(&address), sizeof(address)) != 0) {
    close(fd);
    return -1;
  }
  return fd;
}

void write_u16_le(uint8_t* output, uint16_t value) {
  output[0] = static_cast<uint8_t>(value & 0xff);
  output[1] = static_cast<uint8_t>((value >> 8) & 0xff);
}

void answer_pin_request(int fd, uint16_t adapter_index,
                        const BluetoothAddress& target,
                        const BluetoothAddress& pin) {
  // Packet layout is a six-byte mgmt header followed by mgmt_addr_info,
  // pin_len, and the fixed sixteen-byte PIN buffer. Serializing by hand avoids
  // compiler padding and documents every privileged byte sent to the kernel.
  constexpr std::size_t header_size = 6;
  constexpr std::size_t payload_size = 7 + 1 + 16;
  std::array<uint8_t, header_size + payload_size> packet{};
  write_u16_le(packet.data(), kMgmtPinCodeReplyCommand);
  write_u16_le(packet.data() + 2, adapter_index);
  write_u16_le(packet.data() + 4, payload_size);
  std::copy(target.wire.begin(), target.wire.end(), packet.begin() + header_size);
  packet[header_size + 6] = kBluetoothClassicAddressType;
  packet[header_size + 7] = 6;
  std::copy(pin.wire.begin(), pin.wire.end(), packet.begin() + header_size + 8);
  if (write(fd, packet.data(), packet.size()) != static_cast<ssize_t>(packet.size())) {
    emit_status("error", target.display, "failed to answer the Wii pairing PIN request");
  }
}

void process_management_events(int fd, PairingSharedState* shared) {
  if (fd < 0) return;
  std::array<uint8_t, 1024> buffer{};
  ssize_t count = 0;
  while ((count = read(fd, buffer.data(), buffer.size())) > 0) {
    if (count < 14) continue;
    const uint16_t event = static_cast<uint16_t>(buffer[0] | (buffer[1] << 8));
    const uint16_t adapter_index = static_cast<uint16_t>(buffer[2] | (buffer[3] << 8));
    const uint16_t payload_size = static_cast<uint16_t>(buffer[4] | (buffer[5] << 8));
    if (event != kMgmtPinCodeRequestEvent || payload_size < 8 || count < 6 + payload_size) continue;

    std::optional<BluetoothAddress> target;
    std::optional<BluetoothAddress> pin;
    {
      std::lock_guard<std::mutex> lock(shared->mutex);
      target = shared->active_target;
      pin = shared->active_pin;
    }
    if (!target.has_value() || !pin.has_value() ||
        !std::equal(target->wire.begin(), target->wire.end(), buffer.begin() + 6)) {
      continue;
    }
    answer_pin_request(fd, adapter_index, *target, *pin);
  }
}

std::optional<std::string> find_board_input_path() {
  DIR* directory = opendir("/dev/input");
  if (!directory) return std::nullopt;

  std::optional<std::string> found;
  while (dirent* entry = readdir(directory)) {
    if (std::strncmp(entry->d_name, "event", 5) != 0) continue;
    const std::string path = std::string("/dev/input/") + entry->d_name;
    const int fd = open(path.c_str(), O_RDONLY | O_NONBLOCK | O_CLOEXEC);
    if (fd < 0) continue;
    std::array<char, 256> name{};
    if (ioctl(fd, EVIOCGNAME(name.size()), name.data()) >= 0 &&
        std::string(name.data()) == kBoardInputName) {
      found = path;
      close(fd);
      break;
    }
    close(fd);
  }
  closedir(directory);
  return found;
}

void read_initial_axis(int fd, unsigned int axis, int* destination) {
  input_absinfo info{};
  if (ioctl(fd, EVIOCGABS(axis), &info) == 0) *destination = std::max(0, info.value);
}

int open_board_input(const std::string& path, BoardReadings* readings) {
  const int fd = open(path.c_str(), O_RDONLY | O_NONBLOCK | O_CLOEXEC);
  if (fd < 0) return -1;
  // hid-wiimote applies factory calibration before these values reach evdev.
  // Reading the current axes prevents the first JSON frame from showing three
  // zero corners merely because only one axis changed after the file was opened.
  read_initial_axis(fd, ABS_HAT0X, &readings->top_right);
  read_initial_axis(fd, ABS_HAT0Y, &readings->bottom_right);
  read_initial_axis(fd, ABS_HAT1X, &readings->top_left);
  read_initial_axis(fd, ABS_HAT1Y, &readings->bottom_left);
  return fd;
}

bool process_input_events(int fd, BoardReadings* readings, uint64_t* last_frame_at) {
  std::array<input_event, 64> events{};
  const ssize_t bytes = read(fd, events.data(), sizeof(events));
  if (bytes == 0) return false;
  if (bytes < 0) return errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR;

  const std::size_t count = static_cast<std::size_t>(bytes) / sizeof(input_event);
  bool synchronized = false;
  for (std::size_t i = 0; i < count; ++i) {
    const input_event& event = events[i];
    if (event.type == EV_ABS) {
      const int value = std::max(0, event.value);
      if (event.code == ABS_HAT0X) readings->top_right = value;
      if (event.code == ABS_HAT0Y) readings->bottom_right = value;
      if (event.code == ABS_HAT1X) readings->top_left = value;
      if (event.code == ABS_HAT1Y) readings->bottom_left = value;
    } else if (event.type == EV_SYN && event.code == SYN_REPORT) {
      synchronized = true;
    }
  }

  const uint64_t now = monotonic_ms();
  if (synchronized && now - *last_frame_at >= kFrameIntervalMs) {
    // Reading capacity asks hid-wiimote for a fresh status report, so cache it
    // for several seconds instead of injecting a Bluetooth command per frame.
    emit_frame(*readings, read_board_battery());
    *last_frame_at = now;
  }
  return true;
}

std::optional<std::string> extract_command_value(const std::string& line, const std::string& key) {
  const std::string token = "\"" + key + "\"";
  const std::size_t key_at = line.find(token);
  if (key_at == std::string::npos) return std::nullopt;
  const std::size_t colon = line.find(':', key_at + token.size());
  const std::size_t first_quote = line.find('"', colon + 1);
  const std::size_t second_quote = line.find('"', first_quote + 1);
  if (colon == std::string::npos || first_quote == std::string::npos || second_quote == std::string::npos) {
    return std::nullopt;
  }
  return line.substr(first_quote + 1, second_quote - first_quote - 1);
}

void handle_command(const std::string& line, PairingSharedState* shared) {
  const std::string command = extract_command_value(line, "command").value_or("");
  if (command == "pair") {
    std::lock_guard<std::mutex> lock(shared->mutex);
    if (!shared->pairing_available) {
      emit_status("error", "", "Bluetooth pairing capability is unavailable; reinstall the bridge capability");
      return;
    }
    shared->commissioned_address.reset();
    shared->commissioning = true;
  } else if (command == "forget") {
    std::optional<std::string> address;
    {
      std::lock_guard<std::mutex> lock(shared->mutex);
      if (!shared->pairing_available) {
        emit_status("error", address.value_or(""),
                    "cannot forget the board while Bluetooth pairing capability is unavailable");
        return;
      }
      address = shared->commissioned_address;
      shared->commissioned_address.reset();
      // Do not let the discovery loop race the BlueZ removal. It may otherwise
      // rediscover and attempt to pair the still-bonded object before `remove`
      // has finished deleting its keys and cached SDP record.
      shared->commissioning = false;
    }
    if (address.has_value()) run_command({"bluetoothctl", "--timeout", "8", "remove", *address});
    {
      std::lock_guard<std::mutex> lock(shared->mutex);
      shared->commissioning = true;
    }
    emit_status("commissioning");
  } else if (command == "disconnect") {
    std::optional<std::string> address;
    {
      std::lock_guard<std::mutex> lock(shared->mutex);
      address = shared->commissioned_address;
    }
    // Idle disconnect is intentionally host-initiated only after the server has
    // observed an empty station for its configured delay. The bond remains, so
    // the next front power-button press still reconnects without commissioning.
    if (address.has_value()) {
      run_command({"bluetoothctl", "--timeout", "8", "disconnect", *address});
    }
  } else if (command == "stop") {
    running.store(false);
  }
}

void stdin_loop(PairingSharedState* shared) {
  std::string line;
  while (running.load() && std::getline(std::cin, line)) handle_command(line, shared);
}

void simulated_loop() {
  emit_status("waiting", "SIMULATED");
  const std::array<BoardReadings, 12> sequence{{
      {0, 0, 0, 0}, {0, 0, 0, 0}, {40, 30, 35, 25}, {95, 82, 90, 76},
      {103, 97, 101, 99}, {104, 98, 101, 99}, {103, 98, 102, 99},
      {103, 98, 101, 100}, {104, 98, 101, 99}, {75, 65, 70, 60},
      {20, 12, 15, 10}, {0, 0, 0, 0},
  }};
  while (running.load()) {
    emit_status("connected", "SIMULATED");
    for (const auto& readings : sequence) {
      for (int frame = 0; frame < 12 && running.load(); ++frame) {
        emit_frame(readings, 82);
        std::this_thread::sleep_for(std::chrono::milliseconds(kFrameIntervalMs));
      }
    }
    emit_status("waiting", "SIMULATED");
    for (int pause = 0; pause < 30 && running.load(); ++pause) {
      std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
  }
}

}  // namespace

int main() {
  std::signal(SIGINT, signal_handler);
  std::signal(SIGTERM, signal_handler);

  const std::string simulation = std::getenv("BALANCE_BOARD_SIMULATE")
      ? std::getenv("BALANCE_BOARD_SIMULATE") : "";
  if (simulation == "1" || simulation == "true" || simulation == "cycle") {
    simulated_loop();
    return 0;
  }

  PairingSharedState pairing;
  const std::string configured_address = std::getenv("BALANCE_BOARD_ADDRESS")
      ? std::getenv("BALANCE_BOARD_ADDRESS") : "";
  if (auto parsed = parse_address(configured_address)) {
    pairing.commissioned_address = parsed->display;
    // A sleeping commissioned board is expected at server startup. Trust and
    // wake policy are idempotent, but do not page the sleeping device or delay
    // startup; its front power button will initiate the actual HID connection.
    prepare_known_device(*parsed);
  } else {
    pairing.commissioning = true;
  }

  const int management_fd = open_management_socket();
  if (management_fd < 0) {
    pairing.pairing_available = false;
    if (!pairing.commissioned_address.has_value()) {
      // An already bonded board can reconnect and stream through evdev without
      // the management socket. Missing capability is fatal only when the bridge
      // actually needs to create a new bond.
      pairing.commissioning = false;
      emit_status("error", configured_address,
                  "Bluetooth management socket unavailable; install the worker capability");
    }
  }

  std::thread commission_thread(commissioning_loop, &pairing);
  std::thread input_thread(stdin_loop, &pairing);
  if (management_fd >= 0 || pairing.commissioned_address.has_value()) {
    emit_status(pairing.commissioning ? "commissioning" : "waiting", configured_address);
  }

  int input_fd = -1;
  BoardReadings readings;
  uint64_t last_device_scan_at = 0;
  uint64_t last_frame_at = 0;

  while (running.load()) {
    process_management_events(management_fd, &pairing);

    if (input_fd < 0 && monotonic_ms() - last_device_scan_at >= kDeviceScanIntervalMs) {
      last_device_scan_at = monotonic_ms();
      if (auto path = find_board_input_path()) {
        input_fd = open_board_input(*path, &readings);
        if (input_fd >= 0) {
          std::string address;
          {
            std::lock_guard<std::mutex> lock(pairing.mutex);
            address = pairing.commissioned_address.value_or("");
          }
          emit_status("connected", address);
        }
      }
    }

    if (input_fd >= 0 && !process_input_events(input_fd, &readings, &last_frame_at)) {
      close(input_fd);
      input_fd = -1;
      std::string address;
      {
        std::lock_guard<std::mutex> lock(pairing.mutex);
        address = pairing.commissioned_address.value_or("");
      }
      emit_status("waiting", address);
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }

  if (input_fd >= 0) close(input_fd);
  if (management_fd >= 0) close(management_fd);
  if (input_thread.joinable()) input_thread.detach();
  if (commission_thread.joinable()) commission_thread.join();
  return 0;
}
