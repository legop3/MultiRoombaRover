// Wii Balance Board native bridge.
//
// Purpose:
// Pair one original Nintendo RVL-WBC-01 through modern BlueZ, then connect to
// its Bluetooth HID channels directly with wiiuse and expose calibrated sensor
// readings as newline-delimited JSON for the Node server.
//
// Why this process exists:
// BlueZ removed its Wii PIN helper in 2025. A Wii device expects six raw PIN
// bytes equal to the host Bluetooth adapter address in wire order. D-Bus represents PINs
// as UTF-8 strings and cannot safely carry arbitrary bytes, so this bridge races
// BlueZ's agent response with the correct raw MGMT_OP_PIN_CODE_REPLY. Only the
// board currently being commissioned is eligible for that reply.
//
// After commissioning, this worker owns both directions of the HID transport.
// Red Sync uses wiiuse's normal outbound connection; the front power button is
// accepted through always-open control and interrupt listeners. This is
// important rather than stylistic: BlueZ's
// input profile applies medium security to bonded HID devices, and an original
// Balance Board rejects that request with EACCES. Direct low-security sockets
// match the board and avoid the failing profile entirely.
//
// Security boundary:
// The installed binary receives CAP_NET_ADMIN solely for the Bluetooth
// management socket and CAP_NET_BIND_SERVICE solely for the reserved HID PSMs.
// The much larger Node server remains unprivileged. Normal sensor access uses
// ordinary Bluetooth L2CAP sockets through wiiuse.

#include <wiiuse.h>
#include <bluetooth/l2cap.h>

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
#include <cmath>
#include <fcntl.h>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <optional>
#include <poll.h>
#include <sstream>
#include <string>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>
#include <vector>

// Wiiuse exports these two handshake functions from its shared library but
// keeps them out of the public header because ordinary callers receive sockets
// from wiiuse_connect(). The Balance Board's front button reverses the normal
// connection direction for both HID channels, so this bridge must accept those
// sockets and then start the exact same upstream handshake explicitly.
extern "C" void wiiuse_handshake(struct wiimote_t* board, byte* data, uint16_t length);
extern "C" int wiiuse_set_report_type(struct wiimote_t* board);

namespace {

constexpr const char* kBoardBluetoothName = "Nintendo RVL-WBC-01";
constexpr int kBluetoothProtocolHci = 1;
constexpr uint16_t kHciChannelControl = 3;
constexpr uint16_t kHciDeviceNone = 0xffff;
constexpr uint16_t kMgmtCommandCompleteEvent = 0x0001;
constexpr uint16_t kMgmtCommandStatusEvent = 0x0002;
constexpr uint16_t kMgmtNewSettingsEvent = 0x0006;
constexpr uint16_t kMgmtPinCodeRequestEvent = 0x000e;
constexpr uint16_t kMgmtDeviceFoundEvent = 0x0012;
constexpr uint16_t kMgmtDiscoveringEvent = 0x0013;
constexpr uint16_t kMgmtPinCodeReplyCommand = 0x0016;
constexpr uint16_t kMgmtSetConnectableCommand = 0x0007;
constexpr uint16_t kMgmtSetFastConnectableCommand = 0x0008;
constexpr uint16_t kMgmtStartDiscoveryCommand = 0x0023;
constexpr uint16_t kMgmtStopDiscoveryCommand = 0x0024;
constexpr uint16_t kPrimaryControllerIndex = 0;
constexpr uint8_t kBluetoothClassicAddressType = 0;
constexpr uint8_t kBluetoothClassicDiscoveryMask = 1U << 0;
constexpr uint32_t kDeviceFoundLegacyPairingFlag = 1U << 1;
constexpr uint8_t kEirClassOfDeviceType = 0x0d;
constexpr uint32_t kBalanceBoardClassOfDevice = 0x00002504;
constexpr uint32_t kControllerConnectableSetting = 1U << 1;
constexpr uint32_t kControllerFastConnectableSetting = 1U << 2;
constexpr int kManagementCommandTimeoutMs = 2000;
constexpr int kFrameIntervalMs = 50;
constexpr int kDiscoveryRestartDelayMs = 1000;
constexpr int kDiscoveryStartDeadlineMs = 5000;
constexpr uint16_t kHidControlPsm = 0x0011;
constexpr uint16_t kHidInterruptPsm = 0x0013;
constexpr int kCommissioningConnectWindowMs = 15000;
constexpr int kIncomingChannelPairTimeoutMs = 5000;
constexpr int kHandshakeWarningMs = 10000;
constexpr int kMovementThresholdCentiKg = 50;
constexpr int kStillSleepDelayMs = 2 * 60 * 1000;

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
  // Discovery commands and events use the same kernel management socket as
  // raw Wii PIN replies. The main thread owns socket reads while the
  // commissioning thread consumes this small synchronized state, avoiding a
  // second reader that could steal PIN or controller-setting events.
  std::optional<BluetoothAddress> discovery_candidate;
  std::string discovery_error;
  bool discovery_start_pending = false;
  bool discovery_stop_pending = false;
  bool discovery_session_started = false;
  bool discovery_active = false;
  bool commissioning = false;
  bool outbound_connection_requested = false;
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

struct ManagementRuntimeState {
  // Runtime reassertions are asynchronous so a temporary controller setting
  // change cannot block PIN or HID handling. Track each outstanding opcode to
  // avoid submitting the same command repeatedly while BlueZ is acknowledging
  // the first request.
  bool connectable_pending = false;
  bool fast_connectable_pending = false;
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

BluetoothAddress address_from_management_wire(const uint8_t* wire) {
  BluetoothAddress address;
  if (!wire) return address;

  // Management packets carry Bluetooth addresses least-significant byte first,
  // while every BlueZ command and user-facing status expects the conventional
  // most-significant-byte-first representation. Preserve both forms because
  // the original wire bytes are later compared with the kernel PIN request.
  std::copy(wire, wire + address.wire.size(), address.wire.begin());
  char address_buffer[18]{};
  std::snprintf(
      address_buffer, sizeof(address_buffer), "%02X:%02X:%02X:%02X:%02X:%02X",
      address.wire[5], address.wire[4], address.wire[3],
      address.wire[2], address.wire[1], address.wire[0]);
  address.display = address_buffer;
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

bool candidate_is_balance_board(const BluetoothAddress& address) {
  const CommandResult info = run_command({
      "bluetoothctl", "--timeout", "2", "info", address.display});
  if (info.output.find(kBoardBluetoothName) != std::string::npos) return true;

  // Original Wii input devices identify as legacy-pairing gaming peripherals.
  // This fallback is deliberately applied only to an address delivered by the
  // kernel's legacy-pairing Device Found event during active commissioning.
  // That physical red-Sync action is the selection boundary when an adapter
  // cannot resolve Nintendo's remote name in time.
  const bool gaming_peripheral =
      info.output.find("Class: 0x00002504") != std::string::npos &&
      info.output.find("Icon: input-gaming") != std::string::npos;
  const bool legacy_pairing =
      info.output.find("LegacyPairing: yes") != std::string::npos;
  return gaming_peripheral && legacy_pairing;
}

std::string command_error_summary(const std::string& raw, const std::string& fallback) {
  std::string summary;
  summary.reserve(std::min<std::size_t>(raw.size(), 400));
  bool previous_was_space = false;
  int ansi_state = 0;
  for (unsigned char ch : raw) {
    // bluetoothctl emits terminal color CSI sequences even when its output is
    // captured by a pipe. Drop the entire ESC ... final-byte sequence so the UI
    // never exposes fragments such as `[[0;93mCHG[0m]` as a pairing error.
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
  // bluetoothctl has returned exit code zero for some D-Bus failures across
  // releases. Check its stable failure text as well so commissioning never
  // stores an address when BlueZ did not actually finish the bond.
  return result.exit_code == 0 &&
      result.output.find("Failed") == std::string::npos &&
      result.output.find("not available") == std::string::npos;
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

bool start_management_discovery(int fd, PairingSharedState* shared,
                                std::string* error);
void stop_management_discovery(int fd, PairingSharedState* shared);

void commissioning_loop(PairingSharedState* shared, int management_fd) {
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
    // Discovery is deliberately performed through the kernel management
    // socket already required for Wii PIN replies. Long-running bluetoothctl
    // output proved version- and terminal-dependent on the production server;
    // MGMT Device Found events are the stable interface underneath BlueZ and
    // arrive on this socket without parsing human-oriented terminal output.
    std::string discovery_error;
    if (!start_management_discovery(
            management_fd, shared, &discovery_error)) {
      emit_status("error", "", "Bluetooth discovery could not start: " +
          discovery_error);
      std::this_thread::sleep_for(std::chrono::milliseconds(kDiscoveryRestartDelayMs));
      continue;
    }

    std::optional<BluetoothAddress> address;
    while (running.load() && !address.has_value()) {
      std::optional<BluetoothAddress> candidate;
      bool still_commissioning = false;
      {
        std::lock_guard<std::mutex> lock(shared->mutex);
        still_commissioning = shared->commissioning &&
            !shared->commissioned_address.has_value();
        candidate = shared->discovery_candidate;
        shared->discovery_candidate.reset();
        discovery_error = shared->discovery_error;
      }
      if (!still_commissioning) break;
      if (!discovery_error.empty()) {
        emit_status("error", "", discovery_error);
        break;
      }

      if (candidate.has_value()) {
        emit_status("device-detected", candidate->display,
                    "Classic Bluetooth device detected; checking whether it is the Balance Board.");
        // Class, icon, and legacy-pairing properties can arrive just after the
        // first raw inquiry result. Retry that bounded local property lookup at
        // quarter-second intervals while the board is awake; this replaces the
        // old dependence on a later human-readable bluetoothctl change line.
        // The exact identity gate remains mandatory, so an unrelated controller
        // can never arm the privileged Wii PIN response.
        for (int attempt = 0; attempt < 5 && !address.has_value(); ++attempt) {
          if (candidate_is_balance_board(*candidate)) {
            address = candidate;
            break;
          }
          if (attempt < 4) {
            std::this_thread::sleep_for(std::chrono::milliseconds(250));
          }
        }
      }
      std::this_thread::sleep_for(std::chrono::milliseconds(25));
    }

    if (!address.has_value()) {
      stop_management_discovery(management_fd, shared);
      if (running.load()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(kDiscoveryRestartDelayMs));
      }
      continue;
    }

    const auto controller = find_default_controller();
    if (!controller.has_value()) {
      stop_management_discovery(management_fd, shared);
      emit_status("error", address->display,
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
    // Keep kernel discovery alive through Pair(). BlueZ pairing by address
    // requires the fresh device record, and the board's Sync window is too
    // short to stop and recreate discovery before bonding begins.
    stop_management_discovery(management_fd, shared);

    {
      std::lock_guard<std::mutex> lock(shared->mutex);
      shared->active_target.reset();
      shared->active_pin.reset();
    }

    if (!command_succeeded(pair_result)) {
      emit_status("error", address->display,
                  "pairing failed: " + command_error_summary(
                      pair_result.output, "BlueZ returned an unknown pairing error"));
      std::this_thread::sleep_for(std::chrono::milliseconds(kDiscoveryRestartDelayMs));
      continue;
    }

    {
      std::lock_guard<std::mutex> lock(shared->mutex);
      shared->commissioned_address = address->display;
      shared->commissioning = false;
      // Red Sync makes the board discoverable rather than initiating its normal
      // host reconnect. Give wiiuse one bounded outbound window immediately
      // after commissioning; every later front-button wake arrives through the
      // two HID listeners instead.
      shared->outbound_connection_requested = true;
    }
    emit_json("\"type\":\"paired\",\"address\":\"" + json_escape(address->display) + "\"");
    // The direct connection loop notices this address immediately. Pairing and
    // sensor transport stay separate so the red Sync button is needed only for
    // commissioning; later front-button wakes are caught automatically.
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

uint16_t read_u16_le(const uint8_t* input) {
  return static_cast<uint16_t>(input[0] | (input[1] << 8));
}

uint32_t read_u32_le(const uint8_t* input) {
  return static_cast<uint32_t>(input[0]) |
      (static_cast<uint32_t>(input[1]) << 8) |
      (static_cast<uint32_t>(input[2]) << 16) |
      (static_cast<uint32_t>(input[3]) << 24);
}

bool management_event_has_balance_board_class(const uint8_t* payload,
                                               uint16_t payload_size) {
  // Device Found has a fixed 14-byte prefix followed by standard EIR fields.
  // Each field begins with a byte count that includes its one-byte type. Parse
  // defensively because this data originates over the radio and a malformed
  // length must never let commissioning inspect beyond the management packet.
  constexpr std::size_t fixed_size = 14;
  if (!payload || payload_size < fixed_size) return false;
  const uint16_t eir_size = read_u16_le(payload + 12);
  if (eir_size > payload_size - fixed_size) return false;

  const uint8_t* eir = payload + fixed_size;
  std::size_t offset = 0;
  while (offset < eir_size) {
    const uint8_t field_size = eir[offset];
    if (field_size == 0) break;
    if (offset + 1 + field_size > eir_size) return false;

    const uint8_t field_type = eir[offset + 1];
    const std::size_t data_size = field_size - 1;
    if (field_type == kEirClassOfDeviceType && data_size >= 3) {
      const uint32_t device_class =
          static_cast<uint32_t>(eir[offset + 2]) |
          (static_cast<uint32_t>(eir[offset + 3]) << 8) |
          (static_cast<uint32_t>(eir[offset + 4]) << 16);
      return device_class == kBalanceBoardClassOfDevice;
    }
    offset += 1 + field_size;
  }
  return false;
}

std::string management_status_description(uint8_t status) {
  // These are the management statuses that setting controller modes can
  // realistically return. Retain the numeric value as well because it remains
  // actionable if a newer kernel introduces a status this worker does not yet
  // name.
  const char* description = "unknown management status";
  switch (status) {
    case 0x00: description = "success"; break;
    case 0x03: description = "failed"; break;
    case 0x0a: description = "busy"; break;
    case 0x0c: description = "not supported"; break;
    case 0x0d: description = "invalid parameters"; break;
    case 0x0f: description = "controller not powered"; break;
    case 0x11: description = "invalid controller index"; break;
    case 0x14: description = "permission denied"; break;
  }
  std::ostringstream result;
  result << description << " (0x" << std::hex << std::setw(2)
         << std::setfill('0') << static_cast<int>(status) << ")";
  return result.str();
}

bool write_management_boolean_command(int fd, uint16_t opcode, bool enabled) {
  if (fd < 0) return false;
  constexpr std::size_t header_size = 6;
  std::array<uint8_t, header_size + 1> packet{};
  write_u16_le(packet.data(), opcode);
  write_u16_le(packet.data() + 2, kPrimaryControllerIndex);
  write_u16_le(packet.data() + 4, 1);
  packet[header_size] = enabled ? 1 : 0;
  return write(fd, packet.data(), packet.size()) ==
      static_cast<ssize_t>(packet.size());
}

bool write_management_discovery_command(int fd, uint16_t opcode) {
  if (fd < 0) return false;
  constexpr std::size_t header_size = 6;
  std::array<uint8_t, header_size + 1> packet{};
  write_u16_le(packet.data(), opcode);
  write_u16_le(packet.data() + 2, kPrimaryControllerIndex);
  write_u16_le(packet.data() + 4, 1);
  // The Balance Board is a Classic Bluetooth device. Restricting discovery to
  // BR/EDR avoids irrelevant LE advertisements and ensures every Device Found
  // event uses the address type expected by the Wii pairing path.
  packet[header_size] = kBluetoothClassicDiscoveryMask;
  return write(fd, packet.data(), packet.size()) ==
      static_cast<ssize_t>(packet.size());
}

bool start_management_discovery(int fd, PairingSharedState* shared,
                                std::string* error) {
  if (fd < 0 || !shared) {
    if (error) *error = "Bluetooth management socket is unavailable";
    return false;
  }

  {
    std::lock_guard<std::mutex> lock(shared->mutex);
    shared->discovery_candidate.reset();
    shared->discovery_error.clear();
    shared->discovery_start_pending = true;
    shared->discovery_stop_pending = false;
    shared->discovery_session_started = false;
    shared->discovery_active = false;
  }
  if (!write_management_discovery_command(fd, kMgmtStartDiscoveryCommand)) {
    const std::string detail = "could not send Start Discovery: " +
        std::string(std::strerror(errno));
    {
      std::lock_guard<std::mutex> lock(shared->mutex);
      shared->discovery_start_pending = false;
      shared->discovery_error = detail;
    }
    if (error) *error = detail;
    return false;
  }

  // Command Complete proves the kernel accepted the session, while the
  // Discovering event proves inquiry is actually active on the controller.
  // Require both so the UI can never repeat the earlier false "listening"
  // state where a process existed but no radio scan was running.
  const uint64_t deadline = monotonic_ms() + kDiscoveryStartDeadlineMs;
  while (running.load() && monotonic_ms() < deadline) {
    std::string discovery_error;
    bool ready = false;
    {
      std::lock_guard<std::mutex> lock(shared->mutex);
      discovery_error = shared->discovery_error;
      ready = shared->discovery_session_started && shared->discovery_active;
    }
    if (!discovery_error.empty()) {
      if (error) *error = discovery_error;
      return false;
    }
    if (ready) return true;
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }

  if (error) *error = "kernel accepted no active BR/EDR discovery session within 5 seconds";
  stop_management_discovery(fd, shared);
  return false;
}

void stop_management_discovery(int fd, PairingSharedState* shared) {
  if (fd < 0 || !shared) return;

  bool should_stop = false;
  {
    std::lock_guard<std::mutex> lock(shared->mutex);
    should_stop = shared->discovery_start_pending ||
        shared->discovery_session_started || shared->discovery_active;
    shared->discovery_candidate.reset();
    if (should_stop) shared->discovery_stop_pending = true;
  }
  if (!should_stop) return;

  if (!write_management_discovery_command(fd, kMgmtStopDiscoveryCommand)) {
    std::lock_guard<std::mutex> lock(shared->mutex);
    shared->discovery_stop_pending = false;
    shared->discovery_error = "could not send Stop Discovery: " +
        std::string(std::strerror(errno));
    return;
  }

  // Pairing retries should not collide with a previous inquiry session. Wait
  // briefly for the matching command response, but never let a misbehaving
  // adapter hold server shutdown or commissioning indefinitely.
  const uint64_t deadline = monotonic_ms() + kManagementCommandTimeoutMs;
  while (running.load() && monotonic_ms() < deadline) {
    bool stopped = false;
    {
      std::lock_guard<std::mutex> lock(shared->mutex);
      stopped = !shared->discovery_stop_pending &&
          !shared->discovery_session_started;
    }
    if (stopped) return;
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
}

bool set_management_boolean_and_wait(int fd, uint16_t opcode,
                                     const std::string& setting_name,
                                     std::string* error) {
  if (!write_management_boolean_command(fd, opcode, true)) {
    if (error) *error = "could not send the " + setting_name + " command: " +
        std::string(std::strerror(errno));
    return false;
  }

  // A successful write only queues a request to the kernel. Wait for the
  // matching Command Complete/Status event so the worker never advertises a
  // reliable wake listener when the adapter actually rejected the setting.
  const uint64_t deadline = monotonic_ms() + kManagementCommandTimeoutMs;
  while (running.load()) {
    const uint64_t now = monotonic_ms();
    if (now >= deadline) break;
    const int remaining = static_cast<int>(deadline - now);
    pollfd descriptor{fd, POLLIN, 0};
    const int ready = poll(&descriptor, 1, std::max(1, remaining));
    if (ready < 0) {
      if (errno == EINTR) continue;
      if (error) *error = "could not wait for the " + setting_name +
          " response: " + std::string(std::strerror(errno));
      return false;
    }
    if (ready == 0) break;

    std::array<uint8_t, 1024> response{};
    const ssize_t count = read(fd, response.data(), response.size());
    if (count < 9) continue;
    const uint16_t event = read_u16_le(response.data());
    const uint16_t response_opcode = read_u16_le(response.data() + 6);
    if ((event != kMgmtCommandCompleteEvent && event != kMgmtCommandStatusEvent) ||
        response_opcode != opcode) {
      // Startup occurs before pairing and connection threads exist, so the only
      // expected extra packet is New Settings generated by the command itself.
      // The matching completion is still queued immediately after it.
      continue;
    }

    const uint8_t status = response[8];
    if (status == 0) return true;
    if (error) *error = setting_name + " was rejected: " +
        management_status_description(status);
    return false;
  }

  if (error) *error = "timed out waiting for the " + setting_name + " response";
  return false;
}

bool enable_incoming_connections(int fd, std::string* error) {
  if (fd < 0) {
    if (error) *error = "management socket is unavailable";
    return false;
  }

  // Set Connectable enables the BR/EDR page scan that accepts the board's
  // incoming front-button connection. Fast Connectable increases the page-scan
  // duty cycle so the controller can catch the board during its unusually short
  // one-to-two-second wake attempt. A stationary server can accept the modest
  // adapter power cost in exchange for reliable unattended operation.
  if (!set_management_boolean_and_wait(
          fd, kMgmtSetConnectableCommand, "connectable setting", error)) {
    return false;
  }
  return set_management_boolean_and_wait(
      fd, kMgmtSetFastConnectableCommand, "fast connectable setting", error);
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

void queue_runtime_management_setting(int fd, uint16_t opcode,
                                      const std::string& setting_name,
                                      bool* pending) {
  if (!pending || *pending) return;
  if (!write_management_boolean_command(fd, opcode, true)) {
    emit_status("error", "", "Could not restore the Bluetooth " + setting_name +
        ": " + std::string(std::strerror(errno)));
    return;
  }
  *pending = true;
}

void process_management_events(int fd, PairingSharedState* shared,
                               ManagementRuntimeState* management) {
  if (fd < 0) return;
  std::array<uint8_t, 1024> buffer{};
  ssize_t count = 0;
  while ((count = read(fd, buffer.data(), buffer.size())) > 0) {
    if (count < 6) continue;
    const uint16_t event = read_u16_le(buffer.data());
    const uint16_t adapter_index = read_u16_le(buffer.data() + 2);
    const uint16_t payload_size = read_u16_le(buffer.data() + 4);
    if (count < 6 + payload_size) continue;

    if ((event == kMgmtCommandCompleteEvent || event == kMgmtCommandStatusEvent) &&
        payload_size >= 3) {
      const uint16_t opcode = read_u16_le(buffer.data() + 6);
      const uint8_t status = buffer[8];

      if (opcode == kMgmtStartDiscoveryCommand ||
          opcode == kMgmtStopDiscoveryCommand) {
        std::lock_guard<std::mutex> lock(shared->mutex);
        if (opcode == kMgmtStartDiscoveryCommand) {
          shared->discovery_start_pending = false;
          if (status == 0) {
            shared->discovery_session_started = true;
          } else {
            shared->discovery_session_started = false;
            shared->discovery_active = false;
            shared->discovery_error = "Start Discovery was rejected: " +
                management_status_description(status);
          }
        } else {
          shared->discovery_stop_pending = false;
          if (status == 0) {
            shared->discovery_start_pending = false;
            shared->discovery_session_started = false;
            shared->discovery_active = false;
          } else {
            shared->discovery_error = "Stop Discovery was rejected: " +
                management_status_description(status);
          }
        }
        continue;
      }

      bool recognized = false;
      std::string setting_name;
      if (management && opcode == kMgmtSetConnectableCommand) {
        management->connectable_pending = false;
        recognized = true;
        setting_name = "connectable setting";
      } else if (management && opcode == kMgmtSetFastConnectableCommand) {
        management->fast_connectable_pending = false;
        recognized = true;
        setting_name = "fast connectable setting";
      }
      if (recognized && status != 0) {
        emit_status("error", "", "Bluetooth " + setting_name +
            " reassertion was rejected: " + management_status_description(status));
      }
      continue;
    }

    if (event == kMgmtDiscoveringEvent && payload_size >= 2 &&
        adapter_index == kPrimaryControllerIndex) {
      const uint8_t address_types = buffer[6];
      const bool active = buffer[7] != 0;
      bool announce_discovery = false;
      {
        std::lock_guard<std::mutex> lock(shared->mutex);
        if (shared->commissioning &&
            (address_types & kBluetoothClassicDiscoveryMask) != 0) {
          announce_discovery = active && !shared->discovery_active;
          shared->discovery_active = active;
        }
      }
      if (announce_discovery) emit_status("discovering");
      continue;
    }

    if (event == kMgmtDeviceFoundEvent && payload_size >= 14 &&
        adapter_index == kPrimaryControllerIndex) {
      const uint8_t* payload = buffer.data() + 6;
      const uint8_t address_type = payload[6];
      const uint32_t flags = read_u32_le(payload + 8);
      const bool balance_board_class =
          management_event_has_balance_board_class(payload, payload_size);

      // Some controllers provide the gaming-device class in the first inquiry
      // result and add Legacy Pairing only after name resolution; others do the
      // reverse. Either radio-level signal is narrow enough to justify the
      // bounded BlueZ property check, while ordinary Classic devices never
      // disturb the panel or launch repeated identity commands.
      if (address_type == kBluetoothClassicAddressType &&
          (balance_board_class ||
           (flags & kDeviceFoundLegacyPairingFlag) != 0)) {
        const BluetoothAddress candidate =
            address_from_management_wire(payload);
        std::lock_guard<std::mutex> lock(shared->mutex);
        if (shared->commissioning &&
            !shared->commissioned_address.has_value()) {
          shared->discovery_candidate = candidate;
        }
      }
      continue;
    }

    if (event == kMgmtNewSettingsEvent && payload_size >= 4 &&
        adapter_index == kPrimaryControllerIndex && management) {
      const uint32_t settings = read_u32_le(buffer.data() + 6);
      // BlueZ or another controller operation can replace the page-scan modes
      // after worker startup. Reassert only missing modes and let their normal
      // command responses below report any rejection; pending flags prevent a
      // burst of New Settings events from queuing duplicate commands.
      if ((settings & kControllerConnectableSetting) == 0) {
        queue_runtime_management_setting(
            fd, kMgmtSetConnectableCommand, "connectable setting",
            &management->connectable_pending);
      } else if ((settings & kControllerFastConnectableSetting) == 0) {
        // Fast Connectable is meaningful only after ordinary Connectable has
        // taken effect. Sequencing them avoids a transient Busy/Rejected reply
        // when a controller reset removed both modes at the same time.
        queue_runtime_management_setting(
            fd, kMgmtSetFastConnectableCommand, "fast connectable setting",
            &management->fast_connectable_pending);
      }
      continue;
    }

    if (event == kMgmtPinCodeRequestEvent && payload_size >= 8) {
      std::optional<BluetoothAddress> target;
      std::optional<BluetoothAddress> pin;
      {
        std::lock_guard<std::mutex> lock(shared->mutex);
        target = shared->active_target;
        pin = shared->active_pin;
      }
      if (target.has_value() && pin.has_value() &&
          std::equal(target->wire.begin(), target->wire.end(), buffer.begin() + 6)) {
        answer_pin_request(fd, adapter_index, *target, *pin);
      }
      continue;
    }
  }
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
  (void)shared;
  const std::string command = extract_command_value(line, "command").value_or("");
  // Pairing and reconnect are deliberately automatic. The only command the
  // Node supervisor needs is a clean shutdown signal; removing manual pair,
  // forget, and disconnect modes keeps the hardware flow single-purpose.
  if (command == "stop") {
    running.store(false);
  }
}

void stdin_loop(PairingSharedState* shared) {
  std::string line;
  while (running.load() && std::getline(std::cin, line)) handle_command(line, shared);
}

bool sleeping_connection_error(int error_number) {
  // A powered-off board normally answers an outgoing page with one of these
  // transport errors. They mean "keep waiting for the front button," not that
  // installation is broken. Every other errno is surfaced verbatim in the UI.
  return error_number == EHOSTDOWN || error_number == EHOSTUNREACH ||
      error_number == ETIMEDOUT || error_number == ECONNREFUSED;
}

void close_wiiuse_sockets(wiimote_t* board) {
  if (!board) return;

  // Wiiuse 0.15.5 can leave a socket allocated when the second L2CAP connect
  // fails. Close both descriptors explicitly so an unattended server can page
  // a sleeping board forever without leaking one descriptor per attempt.
  const int output_socket = board->out_sock;
  const int input_socket = board->in_sock;
  if (output_socket >= 0) close(output_socket);
  if (input_socket >= 0 && input_socket != output_socket) close(input_socket);
  board->out_sock = -1;
  board->in_sock = -1;
}

void prepare_wiiuse_address(wiimote_t* board, const std::string& address) {
  // Supplying the saved address and DEV_FOUND flag tells wiiuse to skip its own
  // discovery pass. That makes every reconnect a direct page of the one board
  // already commissioned to this server.
  str2ba(address.c_str(), &board->bdaddr);
  std::snprintf(board->bdaddr_str, sizeof(board->bdaddr_str), "%s", address.c_str());
  board->state |= WIIMOTE_STATE_DEV_FOUND;
}

wiimote_t** initialize_wiiuse() {
  // wiiuse_init prints one version banner directly to stdout rather than using
  // its logger. Suppress only that initialization call before any worker
  // threads exist, then restore stdout for the JSON protocol.
  std::fflush(stdout);
  const int saved_stdout = dup(STDOUT_FILENO);
  const int null_output = open("/dev/null", O_WRONLY | O_CLOEXEC);
  if (saved_stdout >= 0 && null_output >= 0) dup2(null_output, STDOUT_FILENO);
  wiimote_t** boards = wiiuse_init(1);
  std::fflush(stdout);
  if (saved_stdout >= 0) {
    dup2(saved_stdout, STDOUT_FILENO);
    close(saved_stdout);
  }
  if (null_output >= 0) close(null_output);

  // Wiiuse resets its log targets inside wiiuse_init, so configure them after
  // initialization. Retain actual library errors on stderr, but discard normal
  // connect/disconnect chatter that repeats for every page while the board is
  // asleep; structured JSON already describes that state for the panel.
  wiiuse_set_output(LOGLEVEL_ERROR, stderr);
  wiiuse_set_output(LOGLEVEL_WARNING, nullptr);
  wiiuse_set_output(LOGLEVEL_INFO, nullptr);
  wiiuse_set_output(LOGLEVEL_DEBUG, nullptr);
  return boards;
}

bool request_low_bluetooth_security(int fd, std::string* error) {
  bt_security security{};
  security.level = BT_SECURITY_LOW;
  if (setsockopt(fd, SOL_BLUETOOTH, BT_SECURITY, &security, sizeof(security)) == 0) {
    return true;
  }
  if (error) *error = std::strerror(errno);
  return false;
}

int open_hid_listener(uint16_t psm, std::string* error) {
  const int fd = socket(AF_BLUETOOTH,
                        SOCK_SEQPACKET | SOCK_CLOEXEC | SOCK_NONBLOCK,
                        BTPROTO_L2CAP);
  if (fd < 0) {
    if (error) *error = std::strerror(errno);
    return -1;
  }

  // The bonded BlueZ input profile requested medium security and produced the
  // original EACCES failure. Wii hardware HID channels are intentionally low
  // security; applying that level to the listener also makes it inherit onto
  // every accepted front-button connection.
  if (!request_low_bluetooth_security(fd, error)) {
    close(fd);
    return -1;
  }

  sockaddr_l2 local{};
  local.l2_family = AF_BLUETOOTH;
  local.l2_psm = htobs(psm);
  // Value initialization leaves l2_bdaddr at the all-zero BDADDR_ANY value.
  // Avoid BlueZ's C-only compound-literal macro, which is not valid C++17.
  if (bind(fd, reinterpret_cast<const sockaddr*>(&local), sizeof(local)) != 0 ||
      listen(fd, 1) != 0) {
    if (error) *error = std::strerror(errno);
    close(fd);
    return -1;
  }
  return fd;
}

std::optional<int> accept_board_channel(int listener,
                                        const std::string& expected_address,
                                        std::string* error) {
  sockaddr_l2 remote{};
  socklen_t remote_size = sizeof(remote);
  const int fd = accept4(listener, reinterpret_cast<sockaddr*>(&remote),
                         &remote_size, SOCK_CLOEXEC);
  if (fd < 0) {
    if (errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR && error) {
      *error = std::strerror(errno);
    }
    return std::nullopt;
  }

  char remote_text[18]{};
  ba2str(&remote.l2_bdaddr, remote_text);
  const auto normalized = parse_address(remote_text);
  if (!normalized.has_value() || normalized->display != expected_address) {
    // Both HID PSMs are global to the adapter. The installer dedicates them to
    // this worker, but still reject any unrelated controller instead of
    // attaching an arbitrary input device to the Balance Board parser.
    close(fd);
    return std::nullopt;
  }
  return fd;
}

void attach_incoming_board(wiimote_t* board, int control_fd, int interrupt_fd,
                           const std::string& address) {
  // A reconnecting Wii device opens both channels toward the remembered host:
  // control on PSM 0x11 followed by interrupt on PSM 0x13. Once both accepted
  // sockets exist, their direction and semantics are identical to the pair
  // created by wiiuse_connect(). Attach them and run the upstream handshake.
  close_wiiuse_sockets(board);
  wiiuse_disconnected(board);
  prepare_wiiuse_address(board, address);
  board->out_sock = control_fd;
  board->in_sock = interrupt_fd;
  board->state |= WIIMOTE_STATE_CONNECTED;
  wiiuse_handshake(board, nullptr, 0);
  wiiuse_set_report_type(board);
}

struct PendingIncomingChannels {
  int control_fd = -1;
  int interrupt_fd = -1;
  uint64_t first_channel_at = 0;
};

void close_pending_channels(PendingIncomingChannels* pending) {
  if (!pending) return;
  if (pending->control_fd >= 0) close(pending->control_fd);
  if (pending->interrupt_fd >= 0 && pending->interrupt_fd != pending->control_fd) {
    close(pending->interrupt_fd);
  }
  pending->control_fd = -1;
  pending->interrupt_fd = -1;
  pending->first_channel_at = 0;
}

void direct_connection_loop(PairingSharedState* shared, wiimote_t** boards) {
  wiimote_t* board = boards ? boards[0] : nullptr;
  if (!board) {
    emit_status("error", "", "wiiuse could not initialize the Balance Board connection");
    return;
  }

  std::string control_listener_error;
  const int control_listener = open_hid_listener(kHidControlPsm, &control_listener_error);
  if (control_listener < 0) {
    emit_status("error", "",
                "Cannot listen for the Balance Board control channel: " +
                    control_listener_error +
                    ". Run the installer to configure the dedicated Bluetooth listener.");
    return;
  }
  std::string interrupt_listener_error;
  const int interrupt_listener = open_hid_listener(
      kHidInterruptPsm, &interrupt_listener_error);
  if (interrupt_listener < 0) {
    close(control_listener);
    emit_status("error", "",
                "Cannot listen for the Balance Board interrupt channel: " +
                    interrupt_listener_error +
                    ". Run the installer to configure the dedicated Bluetooth listener.");
    return;
  }

  std::string prepared_address;
  uint64_t outbound_connect_until = 0;
  PendingIncomingChannels pending;
  while (running.load()) {
    std::optional<std::string> address;
    bool outbound_requested = false;
    {
      std::lock_guard<std::mutex> lock(shared->mutex);
      address = shared->commissioned_address;
      outbound_requested = shared->outbound_connection_requested;
      shared->outbound_connection_requested = false;
    }
    if (!address.has_value()) {
      std::this_thread::sleep_for(std::chrono::milliseconds(100));
      continue;
    }

    if (prepared_address != *address) {
      // Never combine a channel from the previous configured board with a
      // channel from the new one. This normally matters only after Forget and
      // re-pair, but keeping the socket pair atomic prevents a misleading
      // handshake failure during that transition.
      close_pending_channels(&pending);
      close_wiiuse_sockets(board);
      wiiuse_disconnected(board);
      prepare_wiiuse_address(board, *address);
      prepared_address = *address;
    }

    if (outbound_requested) {
      outbound_connect_until = monotonic_ms() + kCommissioningConnectWindowMs;
    }

    bool transport_connected = false;
    std::string control_error;
    if (auto control_fd = accept_board_channel(
            control_listener, *address, &control_error)) {
      if (pending.control_fd >= 0) close(pending.control_fd);
      pending.control_fd = *control_fd;
      if (pending.first_channel_at == 0) {
        pending.first_channel_at = monotonic_ms();
        emit_status("link-detected", *address,
                    "Front button reached the Bluetooth control channel.");
      }
    } else if (!control_error.empty()) {
      emit_status("connection-failed", *address,
                  "Balance Board control listener failed: " + control_error);
    }

    std::string interrupt_error;
    if (auto interrupt_fd = accept_board_channel(
            interrupt_listener, *address, &interrupt_error)) {
      if (pending.interrupt_fd >= 0) close(pending.interrupt_fd);
      pending.interrupt_fd = *interrupt_fd;
      if (pending.first_channel_at == 0) {
        pending.first_channel_at = monotonic_ms();
        emit_status("link-detected", *address,
                    "Front button reached the Bluetooth interrupt channel.");
      }
    } else if (!interrupt_error.empty()) {
      emit_status("connection-failed", *address,
                  "Balance Board interrupt listener failed: " + interrupt_error);
    }

    if (pending.control_fd >= 0 && pending.interrupt_fd >= 0) {
      attach_incoming_board(
          board, pending.control_fd, pending.interrupt_fd, *address);
      pending.control_fd = -1;
      pending.interrupt_fd = -1;
      pending.first_channel_at = 0;
      transport_connected = true;
    } else if (pending.first_channel_at != 0 &&
               monotonic_ms() - pending.first_channel_at >=
                   kIncomingChannelPairTimeoutMs) {
      const bool control_arrived = pending.control_fd >= 0;
      close_pending_channels(&pending);
      emit_status(
          "connection-failed", *address,
          control_arrived
              ? "Front button reached the control channel, but the interrupt channel did not arrive."
              : "Front button reached the interrupt channel, but the control channel did not arrive.");
    }

    if (!transport_connected && pending.first_channel_at == 0 &&
        monotonic_ms() < outbound_connect_until) {
      // Red Sync makes the board discoverable instead of reconnecting to the
      // remembered host. During the short post-commissioning window only,
      // retain wiiuse's normal outbound connector so the first session starts
      // without asking for a second physical button press.
      errno = 0;
      const int connected_count = wiiuse_connect(boards, 1);
      const int connection_error = errno;
      if (connected_count == 1 && WIIMOTE_IS_CONNECTED(board)) {
        transport_connected = true;
        outbound_connect_until = 0;
        emit_status("link-detected", *address);
      } else {
        close_wiiuse_sockets(board);
        wiiuse_disconnected(board);
        prepare_wiiuse_address(board, *address);
        if (connection_error != 0 && !sleeping_connection_error(connection_error)) {
          emit_status("connection-failed", *address,
                      "Initial Balance Board connection failed: " +
                          std::string(std::strerror(connection_error)));
        }
      }
    }

    if (!transport_connected) {
      std::this_thread::sleep_for(std::chrono::milliseconds(25));
      continue;
    }

    bool board_ready = false;
    bool handshake_warning_sent = false;
    bool intentional_sleep = false;
    std::optional<BoardReadings> activity_reference;
    uint64_t connected_at = monotonic_ms();
    uint64_t last_movement_at = connected_at;
    uint64_t last_frame_at = 0;
    while (running.load() && WIIMOTE_IS_CONNECTED(board)) {
      wiiuse_poll(boards, 1);
      if (board->event == WIIUSE_DISCONNECT ||
          board->event == WIIUSE_UNEXPECTED_DISCONNECT) {
        break;
      }

      if (board->exp.type == EXP_WII_BOARD) {
        if (!board_ready) {
          board_ready = true;
          // The Balance Board has one blue player light. Wiiuse clears all LEDs
          // during its handshake, which leaves the light flashing even though
          // measurements work. A solid first LED is the unambiguous connected
          // indication used for the rest of this session.
          wiiuse_set_leds(board, WIIMOTE_LED_1);
          emit_status("connected", *address);
        }
        const uint64_t now = monotonic_ms();
        if (now - last_frame_at >= kFrameIntervalMs) {
          // Wiiuse interpolates each sensor using the board's factory 0/17/34kg
          // calibration values. Preserve the existing centi-kilogram wire unit
          // so Node can apply its persisted installation zero per corner without
          // losing the native sensor resolution.
          const wii_board_t& weights = board->exp.wb;
          BoardReadings readings{
              static_cast<int>(std::lround(std::max(0.0F, weights.tr) * 100.0F)),
              static_cast<int>(std::lround(std::max(0.0F, weights.br) * 100.0F)),
              static_cast<int>(std::lround(std::max(0.0F, weights.tl) * 100.0F)),
              static_cast<int>(std::lround(std::max(0.0F, weights.bl) * 100.0F)),
          };
          const int battery = static_cast<int>(std::lround(
              std::clamp(board->battery_level, 0.0F, 1.0F) * 100.0F));
          emit_frame(readings, battery);
          last_frame_at = now;

          if (!activity_reference.has_value()) {
            activity_reference = readings;
            last_movement_at = now;
          } else {
            // Compare against the last meaningful activity snapshot rather
            // than the immediately previous frame. That lets slow movement
            // accumulate past the noise threshold while ordinary sensor jitter
            // cannot keep the board awake forever. All four corners matter, so
            // shifting a load without changing total weight still counts.
            const int movement =
                std::abs(readings.top_right - activity_reference->top_right) +
                std::abs(readings.bottom_right - activity_reference->bottom_right) +
                std::abs(readings.top_left - activity_reference->top_left) +
                std::abs(readings.bottom_left - activity_reference->bottom_left);
            if (movement >= kMovementThresholdCentiKg) {
              activity_reference = readings;
              last_movement_at = now;
            }
          }

          if (now - last_movement_at >= kStillSleepDelayMs) {
            intentional_sleep = true;
            emit_status("sleeping", *address,
                        "Board is asleep. Press the front power button to wake it.");
            break;
          }
        }
      } else if (!handshake_warning_sent &&
                 monotonic_ms() - connected_at >= kHandshakeWarningMs) {
        // A live ACL connection without the permanent Balance Board expansion
        // means sensor calibration never completed. Report that precise stage
        // while continuing to poll, since a delayed response can still recover.
        handshake_warning_sent = true;
        emit_status("connection-failed", *address,
                    "Bluetooth connected, but the board did not finish sensor calibration.");
      }
      std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }

    close_wiiuse_sockets(board);
    wiiuse_disconnected(board);
    prepare_wiiuse_address(board, *address);
    if (intentional_sleep) {
      // Closing both HID channels makes the board abandon the host connection
      // and power itself down. Both HID listeners stay open without paging it,
      // so only a later front-button connection starts another session.
    } else {
      emit_status("waiting", *address, "Board disconnected. Press the front power button.");
    }
  }

  close_pending_channels(&pending);
  close(control_listener);
  close(interrupt_listener);
  close_wiiuse_sockets(board);
  wiiuse_disconnected(board);
}

void simulated_loop() {
  // Exercise the same status contract as real hardware so development UI
  // builds cannot silently break merely because CI lacks a physical board.
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

  wiimote_t** boards = initialize_wiiuse();

  PairingSharedState pairing;
  const std::string configured_address = std::getenv("BALANCE_BOARD_ADDRESS")
      ? std::getenv("BALANCE_BOARD_ADDRESS") : "";
  if (auto parsed = parse_address(configured_address)) {
    pairing.commissioned_address = parsed->display;
  } else {
    pairing.commissioning = true;
  }

  const int management_fd = open_management_socket();
  bool bluetooth_startup_ready = true;
  std::string incoming_connection_error;
  if (management_fd < 0) {
    // The socket now serves both commissioning and front-button wake: it sends
    // the raw six-byte PIN and keeps hci0 connectable for incoming pages. Never
    // pretend an already-known address can wake reliably without it.
    pairing.commissioning = false;
    bluetooth_startup_ready = false;
    emit_status("error", configured_address,
                "Bluetooth management socket unavailable; install the worker capability");
  } else if (!enable_incoming_connections(
                 management_fd, &incoming_connection_error)) {
    bluetooth_startup_ready = false;
    emit_status("error", configured_address,
                "Could not enable reliable incoming Bluetooth connections on hci0: " +
                    incoming_connection_error);
  }

  std::thread commission_thread;
  std::thread connection_thread;
  if (bluetooth_startup_ready) {
    commission_thread = std::thread(
        commissioning_loop, &pairing, management_fd);
    connection_thread = std::thread(direct_connection_loop, &pairing, boards);
  }
  std::thread input_thread(stdin_loop, &pairing);
  if (bluetooth_startup_ready &&
      (management_fd >= 0 || pairing.commissioned_address.has_value())) {
    emit_status(pairing.commissioning ? "commissioning" : "waiting", configured_address);
  }

  ManagementRuntimeState management;
  while (running.load()) {
    process_management_events(management_fd, &pairing, &management);
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }

  if (management_fd >= 0) close(management_fd);
  if (input_thread.joinable()) input_thread.detach();
  if (commission_thread.joinable()) commission_thread.join();
  if (connection_thread.joinable()) connection_thread.join();
  if (boards) wiiuse_cleanup(boards, 1);
  return 0;
}
