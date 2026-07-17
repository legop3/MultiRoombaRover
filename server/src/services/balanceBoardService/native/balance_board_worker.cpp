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
constexpr const char* kDiscoveryTimeoutSeconds = "86400";
constexpr int kBluetoothMonitorIntervalMs = 2000;
constexpr int kReconnectAttemptIntervalMs = 3000;
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
  std::string input_state = "not-detected";
  std::string input_error;
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

struct BluetoothDeviceState {
  bool available = false;
  bool paired = false;
  bool trusted = false;
  bool connected = false;
  bool wake_allowed = false;
  std::string error;
};

struct InputProbe {
  std::optional<std::string> path;
  std::string state = "not-detected";
  std::string error;
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

void emit_diagnostics(const std::string& address,
                      const BluetoothDeviceState& bluetooth,
                      const std::string& input_state,
                      const std::string& input_error,
                      const std::string& reconnect_detail) {
  // Bluetooth bonding, the current radio link, and Linux evdev readiness are
  // separate layers. Report each one explicitly so the server never has to
  // infer all hardware failures from the absence of weight frames.
  std::ostringstream fields;
  fields << "\"type\":\"diagnostics\","
         << "\"address\":\"" << json_escape(address) << "\","
         << "\"bluetooth\":{"
         << "\"available\":" << (bluetooth.available ? "true" : "false") << ","
         << "\"paired\":" << (bluetooth.paired ? "true" : "false") << ","
         << "\"trusted\":" << (bluetooth.trusted ? "true" : "false") << ","
         << "\"connected\":" << (bluetooth.connected ? "true" : "false") << ","
         << "\"wakeAllowed\":" << (bluetooth.wake_allowed ? "true" : "false") << "},"
         << "\"inputState\":\"" << json_escape(input_state) << "\"";
  if (!bluetooth.error.empty()) {
    fields << ",\"bluetoothError\":\"" << json_escape(bluetooth.error) << "\"";
  }
  if (!input_error.empty()) {
    fields << ",\"inputError\":\"" << json_escape(input_error) << "\"";
  }
  if (!reconnect_detail.empty()) {
    fields << ",\"reconnectDetail\":\"" << json_escape(reconnect_detail) << "\"";
  }
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

std::optional<BluetoothAddress> take_discovered_board(RunningCommand* discovery,
                                                       bool* discovery_started) {
  if (!discovery) return std::nullopt;
  std::size_t newline = discovery->pending_output.find('\n');
  while (newline != std::string::npos) {
    const std::string line = discovery->pending_output.substr(0, newline);
    discovery->pending_output.erase(0, newline + 1);

    // bluetoothctl reports filter setup before StartDiscovery completes. Treat
    // only this explicit event as proof that button presses can now be seen;
    // `SetDiscoveryFilter success` alone is not an active Bluetooth scan.
    if (discovery_started && line.find("Discovery started") != std::string::npos) {
      *discovery_started = true;
    }

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
  int ansi_state = 0;
  for (unsigned char ch : raw) {
    // bluetoothctl emits terminal color CSI sequences even when its output is
    // captured by a pipe. Drop the entire ESC ... final-byte sequence so the UI
    // never exposes fragments such as `[[0;93mCHG[0m]` as hardware diagnostics.
    if (ch == 0x1b) {
      ansi_state = 1;
      continue;
    }
    if (ansi_state == 1) {
      ansi_state = ch == '[' ? 2 : 0;
      continue;
    }
    if (ansi_state == 2) {
      if (ch >= 0x40 && ch <= 0x7e) ansi_state = 0;
      continue;
    }
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

bool command_succeeded(const CommandResult& result) {
  if (result.exit_code != 0) return false;
  return result.output.find("Failed") == std::string::npos &&
         result.output.find("not available") == std::string::npos;
}

bool bluetooth_property_is_yes(const std::string& output, const std::string& property) {
  return output.find(property + ": yes") != std::string::npos;
}

BluetoothDeviceState inspect_bluetooth_device(const std::string& address) {
  const CommandResult info = run_command({
      "bluetoothctl", "--timeout", "3", "info", address});
  BluetoothDeviceState state;
  state.available = command_succeeded(info) &&
      info.output.find("Device " + address) != std::string::npos;
  if (!state.available) {
    state.error = command_error_summary(info.output, "BlueZ did not return device information");
    return state;
  }
  state.paired = bluetooth_property_is_yes(info.output, "Paired");
  state.trusted = bluetooth_property_is_yes(info.output, "Trusted");
  state.connected = bluetooth_property_is_yes(info.output, "Connected");
  state.wake_allowed = bluetooth_property_is_yes(info.output, "WakeAllowed");
  return state;
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

std::string prepare_known_device(const BluetoothAddress& address) {
  const CommandResult trust = run_command({
      "bluetoothctl", "--timeout", "8", "trust", address.display});
  if (!command_succeeded(trust)) {
    return "trust failed: " + command_error_summary(trust.output, "BlueZ returned no detail");
  }
  // WakeAllowed tells current BlueZ releases to accept the board's incoming HID
  // connection after its front power button is pressed. Older releases may not
  // implement the command; trust + the stored link key still remain effective.
  const CommandResult wake = run_command({
      "bluetoothctl", "--timeout", "8", "wake", address.display, "on"});
  if (!command_succeeded(wake)) {
    return "wake policy failed: " + command_error_summary(wake.output, "BlueZ returned no detail");
  }
  return "";
}

std::string trust_and_connect(const BluetoothAddress& address) {
  if (const std::string prepare_error = prepare_known_device(address);
      !prepare_error.empty()) {
    return prepare_error;
  }
  // A board remains awake for only a short window after Sync. Connecting the
  // HID profile immediately is what teaches it to initiate future connections
  // when its front power button is pressed.
  const CommandResult connect = run_command({
      "bluetoothctl", "--timeout", "8", "connect", address.display});
  if (!command_succeeded(connect)) {
    return "initial connection failed: " +
        command_error_summary(connect.output, "BlueZ returned no detail");
  }
  return "";
}

void connection_monitor_loop(PairingSharedState* shared) {
  uint64_t last_reconnect_attempt_at = 0;
  while (running.load()) {
    std::optional<std::string> address;
    std::string input_state;
    std::string input_error;
    {
      std::lock_guard<std::mutex> lock(shared->mutex);
      address = shared->commissioned_address;
      input_state = shared->input_state;
      input_error = shared->input_error;
    }

    if (!address.has_value()) {
      std::this_thread::sleep_for(std::chrono::milliseconds(250));
      continue;
    }

    BluetoothDeviceState bluetooth = inspect_bluetooth_device(*address);
    std::string reconnect_detail;
    const uint64_t now = monotonic_ms();
    if (bluetooth.available && !bluetooth.connected &&
        now - last_reconnect_attempt_at >= kReconnectAttemptIntervalMs) {
      // A bonded Balance Board normally pages its remembered host after the
      // front button is pressed, but adapters and BlueZ versions do not handle
      // that incoming reconnect consistently. Page the known address while the
      // server is waiting so the several-second blue-light wake window is caught
      // from either direction without requiring another red-Sync operation.
      last_reconnect_attempt_at = now;
      const CommandResult reconnect = run_command({
          "bluetoothctl", "--timeout", "4", "connect", *address});
      // Query again because Connect() may have changed several properties before
      // returning. The diagnostics should describe the resulting state, not the
      // stale snapshot taken immediately before the attempt.
      bluetooth = inspect_bluetooth_device(*address);
      if (bluetooth.connected) {
        reconnect_detail = "Bluetooth link established; waiting for the Balance Board input device";
      } else if (!command_succeeded(reconnect)) {
        reconnect_detail = command_error_summary(
            reconnect.output, "Bluetooth reconnect attempt did not complete");
      } else {
        // bluetoothctl's timeout can end a command without a D-Bus error even
        // though the device never connected. Trust the resulting Connected
        // property rather than presenting process exit status as hardware success.
        reconnect_detail = "Reconnect attempt finished without establishing a Bluetooth link";
      }
    }

    {
      std::lock_guard<std::mutex> lock(shared->mutex);
      // Forget/recommission can complete while bluetoothctl is returning. Never
      // publish an old board's result after the selected address has changed.
      if (shared->commissioned_address != address) continue;
      input_state = shared->input_state;
      input_error = shared->input_error;
    }
    emit_diagnostics(*address, bluetooth, input_state, input_error, reconnect_detail);

    for (int elapsed = 0;
         elapsed < kBluetoothMonitorIntervalMs && running.load(); elapsed += 100) {
      std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
  }
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
    // BlueZ's command-line client exits after the SetDiscoveryFilter callback
    // unless non-interactive mode has a timeout. A one-day timeout keeps the
    // client alive for unattended commissioning; the worker normally stops it
    // itself as soon as the board appears and restarts it if the day expires.
    RunningCommand discovery = start_command({
        "bluetoothctl", "--timeout", kDiscoveryTimeoutSeconds, "scan", "bredr"});
    if (discovery.pid < 0) {
      emit_status("error", "", "could not start Bluetooth discovery: " +
          command_error_summary(discovery.transcript, "unknown process error"));
      std::this_thread::sleep_for(std::chrono::milliseconds(kDiscoveryRestartDelayMs));
      continue;
    }

    std::optional<BluetoothAddress> address;
    bool discovery_started = false;
    while (running.load() && !address.has_value()) {
      const bool discovery_running = collect_command_output(&discovery);
      const bool was_started = discovery_started;
      address = take_discovered_board(&discovery, &discovery_started);
      if (!was_started && discovery_started) {
        // This status clears any prior scanner error and tells the browser that
        // the server is genuinely listening for the board's red Sync button.
        emit_status("discovering");
      }
      if (address.has_value()) break;
      if (!discovery_running) {
        const std::string detail = command_error_summary(
            discovery.transcript, "bluetoothctl exited unexpectedly");
        emit_status("error", "", discovery_started
            ? "Bluetooth scanner stopped unexpectedly; retrying automatically: " + detail
            : "Bluetooth scanner exited before discovery started; retrying automatically: " + detail);
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

    const std::string initial_connection_error = trust_and_connect(*address);
    {
      std::lock_guard<std::mutex> lock(shared->mutex);
      shared->commissioned_address = address->display;
      shared->commissioning = false;
    }
    emit_json("\"type\":\"paired\",\"address\":\"" + json_escape(address->display) + "\"");
    emit_status("waiting", address->display, initial_connection_error);
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

InputProbe probe_board_input() {
  InputProbe probe;
  DIR* directory = opendir("/dev/input");
  if (!directory) {
    probe.state = "input-directory-unavailable";
    probe.error = std::strerror(errno);
    return probe;
  }

  while (dirent* entry = readdir(directory)) {
    if (std::strncmp(entry->d_name, "event", 5) != 0) continue;
    const std::string path = std::string("/dev/input/") + entry->d_name;
    // Read the sysfs name before opening evdev. The name remains readable when
    // device permissions are wrong, allowing diagnostics to distinguish “the
    // kernel never created it” from “the service user cannot open it.”
    std::ifstream name_file(std::string("/sys/class/input/") + entry->d_name + "/device/name");
    std::string name;
    std::getline(name_file, name);
    if (name != kBoardInputName) continue;

    const int fd = open(path.c_str(), O_RDONLY | O_NONBLOCK | O_CLOEXEC);
    if (fd < 0) {
      probe.state = errno == EACCES ? "permission-denied" : "open-failed";
      probe.error = std::strerror(errno);
      break;
    }
    close(fd);
    probe.path = path;
    probe.state = "detected";
    break;
  }
  closedir(directory);
  return probe;
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
  BluetoothDeviceState simulated_bluetooth;
  simulated_bluetooth.available = true;
  simulated_bluetooth.paired = true;
  simulated_bluetooth.trusted = true;
  simulated_bluetooth.connected = true;
  simulated_bluetooth.wake_allowed = true;
  // Exercise the same diagnostics contract as real hardware so development UI
  // builds cannot silently break the status table merely because CI lacks a
  // Bluetooth adapter and physical Balance Board.
  emit_diagnostics("SIMULATED", simulated_bluetooth, "ready", "", "");
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
  std::thread connection_monitor_thread(connection_monitor_loop, &pairing);
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
      const InputProbe probe = probe_board_input();
      {
        std::lock_guard<std::mutex> lock(pairing.mutex);
        pairing.input_state = probe.state;
        pairing.input_error = probe.error;
      }
      if (probe.path.has_value()) {
        input_fd = open_board_input(*probe.path, &readings);
        if (input_fd >= 0) {
          std::string address;
          {
            std::lock_guard<std::mutex> lock(pairing.mutex);
            address = pairing.commissioned_address.value_or("");
            pairing.input_state = "ready";
            pairing.input_error.clear();
          }
          emit_status("connected", address);
        } else {
          std::lock_guard<std::mutex> lock(pairing.mutex);
          pairing.input_state = errno == EACCES ? "permission-denied" : "open-failed";
          pairing.input_error = std::strerror(errno);
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
        pairing.input_state = "not-detected";
        pairing.input_error = "Balance Board input device closed";
      }
      emit_status("waiting", address);
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }

  if (input_fd >= 0) close(input_fd);
  if (management_fd >= 0) close(management_fd);
  if (input_thread.joinable()) input_thread.detach();
  if (commission_thread.joinable()) commission_thread.join();
  if (connection_monitor_thread.joinable()) connection_monitor_thread.join();
  return 0;
}
