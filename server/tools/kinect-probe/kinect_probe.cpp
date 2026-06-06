// Standalone Kinect v1 probe.
//
// Why this exists:
// The rover app previously mixed several concerns at once: Kinect startup,
// frame capture, JPEG/point-cloud conversion, Socket.IO fan-out, and React UI.
// This probe deliberately removes everything except "can libfreenect produce
// one RGB frame and one registered depth frame on this machine?".  If this
// succeeds, the app integration can reuse the proven native path.  If it fails,
// the stderr step log tells us exactly which libfreenect call failed.

#include <libfreenect.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <sstream>
#include <string>
#include <sys/time.h>
#include <thread>
#include <vector>

namespace {

constexpr int kWidth = 640;
constexpr int kHeight = 480;
constexpr int kRgbBytes = kWidth * kHeight * 3;
constexpr int kDepthPixels = kWidth * kHeight;
constexpr int kCaptureTimeoutMs = 12000;

struct CaptureState {
  std::mutex mutex;
  std::condition_variable cv;

  // Each callback copies into these vectors immediately.  Keeping our own copy
  // matters because libfreenect reuses its callback buffers after the callback
  // returns, so writing files directly from callback memory would be racy.
  std::vector<uint8_t> rgb = std::vector<uint8_t>(kRgbBytes);
  std::vector<uint16_t> depth = std::vector<uint16_t>(kDepthPixels);

  bool has_rgb = false;
  bool has_depth = false;
  uint64_t rgb_frames = 0;
  uint64_t depth_frames = 0;
  uint64_t first_rgb_ms = 0;
  uint64_t first_depth_ms = 0;
};

struct ProbeStats {
  uint64_t start_ms = 0;
  uint64_t init_ms = 0;
  int device_count = 0;
  bool opened = false;
  bool depth_started = false;
  bool video_started = false;
  bool wrote_color = false;
  bool wrote_depth = false;
  std::string error;
};

CaptureState state;
ProbeStats stats;
std::atomic<bool> running{true};
freenect_context* freenect_ctx = nullptr;
freenect_device* freenect_dev = nullptr;

// libfreenect video streaming uses caller-provided buffers.  The callback hands
// one replacement buffer back to libfreenect after copying the just-received
// frame into CaptureState.  This mirrors the simple double-buffer style used by
// libfreenect examples, but only one replacement is enough for this one-shot
// diagnostic tool because we are not trying to render every frame.
std::vector<uint8_t> video_back_buffer(kRgbBytes);

uint64_t now_ms() {
  using namespace std::chrono;
  return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

void log_step(const std::string& message) {
  std::cerr << "[kinect-probe] " << message << "\n";
}

std::string escape_json(const std::string& value) {
  std::ostringstream out;
  for (const char ch : value) {
    switch (ch) {
      case '\\':
        out << "\\\\";
        break;
      case '"':
        out << "\\\"";
        break;
      case '\n':
        out << "\\n";
        break;
      case '\r':
        out << "\\r";
        break;
      case '\t':
        out << "\\t";
        break;
      default:
        if (static_cast<unsigned char>(ch) < 0x20) {
          out << "\\u" << std::hex << std::setw(4) << std::setfill('0')
              << static_cast<int>(static_cast<unsigned char>(ch));
        } else {
          out << ch;
        }
        break;
    }
  }
  return out.str();
}

void depth_callback(freenect_device*, void* depth_data, uint32_t) {
  const auto* depth = static_cast<const uint16_t*>(depth_data);
  std::lock_guard<std::mutex> lock(state.mutex);

  // Registered depth lines up with the RGB image, so preserving the full 16-bit
  // millimeter-ish values gives us a useful artifact for later point-cloud work.
  std::memcpy(state.depth.data(), depth, kDepthPixels * sizeof(uint16_t));
  state.depth_frames += 1;
  if (!state.has_depth) {
    state.has_depth = true;
    state.first_depth_ms = now_ms();
    log_step("first registered depth frame received");
  }
  state.cv.notify_all();
}

void video_callback(freenect_device* device, void* rgb_data, uint32_t) {
  const auto* rgb = static_cast<const uint8_t*>(rgb_data);
  std::lock_guard<std::mutex> lock(state.mutex);

  // The probe writes a PPM so there is no encoder dependency and no chance that
  // a JPEG/PNG library hides whether raw Kinect RGB data was actually received.
  std::memcpy(state.rgb.data(), rgb, kRgbBytes);
  state.rgb_frames += 1;
  if (!state.has_rgb) {
    state.has_rgb = true;
    state.first_rgb_ms = now_ms();
    log_step("first rgb frame received");
  }

  freenect_set_video_buffer(device, video_back_buffer.data());
  state.cv.notify_all();
}

bool write_color_ppm(const std::filesystem::path& path) {
  std::vector<uint8_t> rgb;
  {
    std::lock_guard<std::mutex> lock(state.mutex);
    rgb = state.rgb;
  }

  std::ofstream out(path, std::ios::binary);
  if (!out) {
    stats.error = "could not open color output file";
    return false;
  }

  // P6 is the simplest standard RGB image format: ASCII header, then packed
  // 8-bit RGB bytes.  It is intentionally chosen here to avoid adding image
  // library dependencies to a hardware probe.
  out << "P6\n" << kWidth << " " << kHeight << "\n255\n";
  out.write(reinterpret_cast<const char*>(rgb.data()), static_cast<std::streamsize>(rgb.size()));
  return static_cast<bool>(out);
}

bool write_depth_pgm(const std::filesystem::path& path) {
  std::vector<uint16_t> depth;
  {
    std::lock_guard<std::mutex> lock(state.mutex);
    depth = state.depth;
  }

  std::ofstream out(path, std::ios::binary);
  if (!out) {
    stats.error = "could not open depth output file";
    return false;
  }

  // PGM with max value above 255 stores two bytes per pixel.  The Netpbm spec
  // expects big-endian byte order, so write the high byte first even though the
  // host machine is probably little-endian.  Keeping 16-bit depth avoids losing
  // range information before we know the camera path is stable.
  out << "P5\n" << kWidth << " " << kHeight << "\n10000\n";
  for (const uint16_t value : depth) {
    const uint16_t clamped = value > 10000 ? 10000 : value;
    const char high = static_cast<char>((clamped >> 8) & 0xff);
    const char low = static_cast<char>(clamped & 0xff);
    out.write(&high, 1);
    out.write(&low, 1);
  }
  return static_cast<bool>(out);
}

bool write_status_json(const std::filesystem::path& path) {
  uint64_t rgb_frames = 0;
  uint64_t depth_frames = 0;
  uint64_t first_rgb_delta_ms = 0;
  uint64_t first_depth_delta_ms = 0;
  {
    std::lock_guard<std::mutex> lock(state.mutex);
    rgb_frames = state.rgb_frames;
    depth_frames = state.depth_frames;
    first_rgb_delta_ms = state.first_rgb_ms ? state.first_rgb_ms - stats.start_ms : 0;
    first_depth_delta_ms = state.first_depth_ms ? state.first_depth_ms - stats.start_ms : 0;
  }

  std::ofstream out(path, std::ios::binary);
  if (!out) {
    std::cerr << "[kinect-probe] could not open status output file: " << path << "\n";
    return false;
  }

  // The status file is meant to make terminal logs less fragile.  If the user
  // pastes only the JSON later, it still carries the important timing and frame
  // count facts from the run.
  out << "{\n"
      << "  \"deviceCount\": " << stats.device_count << ",\n"
      << "  \"opened\": " << (stats.opened ? "true" : "false") << ",\n"
      << "  \"depthStarted\": " << (stats.depth_started ? "true" : "false") << ",\n"
      << "  \"videoStarted\": " << (stats.video_started ? "true" : "false") << ",\n"
      << "  \"rgbFrames\": " << rgb_frames << ",\n"
      << "  \"depthFrames\": " << depth_frames << ",\n"
      << "  \"firstRgbMs\": " << first_rgb_delta_ms << ",\n"
      << "  \"firstDepthMs\": " << first_depth_delta_ms << ",\n"
      << "  \"wroteColor\": " << (stats.wrote_color ? "true" : "false") << ",\n"
      << "  \"wroteDepth\": " << (stats.wrote_depth ? "true" : "false") << ",\n"
      << "  \"error\": \"" << escape_json(stats.error) << "\"\n"
      << "}\n";
  return static_cast<bool>(out);
}

void cleanup_freenect() {
  running = false;
  if (freenect_dev) {
    log_step("closing kinect device");
    freenect_stop_depth(freenect_dev);
    freenect_stop_video(freenect_dev);
    freenect_close_device(freenect_dev);
    freenect_dev = nullptr;
  }
  if (freenect_ctx) {
    log_step("shutting down libfreenect");
    freenect_shutdown(freenect_ctx);
    freenect_ctx = nullptr;
  }
}

bool init_freenect() {
  log_step("initializing libfreenect");
  const int init_result = freenect_init(&freenect_ctx, nullptr);
  if (init_result < 0) {
    stats.error = "freenect_init failed with result " + std::to_string(init_result);
    return false;
  }
  stats.init_ms = now_ms() - stats.start_ms;

  // Use DEBUG while probing so libfreenect prints the low-level USB reason near
  // the high-level step log.  This is intentionally noisy because the probe is
  // not a production service.
  freenect_set_log_level(freenect_ctx, FREENECT_LOG_DEBUG);

  // The first app integration should not touch the motor/LED/audio siblings.
  // Your working freenect-regview run proves the camera/depth path can work
  // even while LED/motor operations are unhappy, so this probe selects only the
  // camera subdevice and leaves tilt for a later isolated test.
  log_step("selecting camera subdevice only");
  freenect_select_subdevices(
      freenect_ctx,
      static_cast<freenect_device_flags>(FREENECT_DEVICE_CAMERA));

  stats.device_count = freenect_num_devices(freenect_ctx);
  log_step("device count: " + std::to_string(stats.device_count));
  if (stats.device_count < 1) {
    stats.error = "no kinect devices found";
    return false;
  }

  log_step("opening kinect device 0");
  const int open_result = freenect_open_device(freenect_ctx, &freenect_dev, 0);
  if (open_result < 0) {
    stats.error = "freenect_open_device failed with result " + std::to_string(open_result);
    return false;
  }
  stats.opened = true;
  return true;
}

bool start_streams() {
  log_step("configuring callbacks and stream modes");
  freenect_set_depth_callback(freenect_dev, depth_callback);
  freenect_set_video_callback(freenect_dev, video_callback);
  freenect_set_video_buffer(freenect_dev, video_back_buffer.data());

  const freenect_frame_mode video_mode =
      freenect_find_video_mode(FREENECT_RESOLUTION_MEDIUM, FREENECT_VIDEO_RGB);
  const freenect_frame_mode depth_mode =
      freenect_find_depth_mode(FREENECT_RESOLUTION_MEDIUM, FREENECT_DEPTH_REGISTERED);

  log_step("applying rgb video mode");
  if (freenect_set_video_mode(freenect_dev, video_mode) < 0) {
    stats.error = "freenect_set_video_mode failed";
    return false;
  }

  log_step("applying registered depth mode");
  if (freenect_set_depth_mode(freenect_dev, depth_mode) < 0) {
    stats.error = "freenect_set_depth_mode failed";
    return false;
  }

  // Start depth before video to match the previous worker and common
  // libfreenect examples.  The step log makes it easy to reverse this later if
  // freenect-regview's exact order turns out to matter on this machine.
  log_step("starting depth stream");
  const int depth_result = freenect_start_depth(freenect_dev);
  if (depth_result < 0) {
    stats.error = "freenect_start_depth failed with result " + std::to_string(depth_result);
    return false;
  }
  stats.depth_started = true;

  log_step("starting video stream");
  const int video_result = freenect_start_video(freenect_dev);
  if (video_result < 0) {
    stats.error = "freenect_start_video failed with result " + std::to_string(video_result);
    return false;
  }
  stats.video_started = true;
  return true;
}

void event_loop_until_ready() {
  log_step("processing libfreenect events until both frame types arrive");
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(kCaptureTimeoutMs);

  while (running && std::chrono::steady_clock::now() < deadline) {
    {
      std::lock_guard<std::mutex> lock(state.mutex);
      if (state.has_rgb && state.has_depth) {
        log_step("both rgb and depth frames are available");
        return;
      }
    }

    // A short timeout keeps the one-shot probe responsive when the camera stops
    // talking.  It also prevents a failed USB state from hanging the terminal.
    timeval timeout;
    timeout.tv_sec = 0;
    timeout.tv_usec = 100000;
    const int event_result = freenect_process_events_timeout(freenect_ctx, &timeout);
    if (event_result < 0) {
      stats.error = "freenect_process_events_timeout failed with result " + std::to_string(event_result);
      log_step(stats.error);
      return;
    }
  }

  uint64_t rgb_frames = 0;
  uint64_t depth_frames = 0;
  {
    std::lock_guard<std::mutex> lock(state.mutex);
    rgb_frames = state.rgb_frames;
    depth_frames = state.depth_frames;
  }
  stats.error = "timed out waiting for frames; rgbFrames=" + std::to_string(rgb_frames) +
                " depthFrames=" + std::to_string(depth_frames);
  log_step(stats.error);
}

bool ensure_output_dir(const std::filesystem::path& output_dir) {
  std::error_code err;
  std::filesystem::create_directories(output_dir, err);
  if (err) {
    stats.error = "could not create output directory: " + err.message();
    return false;
  }
  return true;
}

bool write_outputs(const std::filesystem::path& output_dir) {
  {
    std::lock_guard<std::mutex> lock(state.mutex);
    if (!state.has_rgb || !state.has_depth) {
      return false;
    }
  }

  const auto color_path = output_dir / "kinect-color.ppm";
  const auto depth_path = output_dir / "kinect-depth.pgm";

  log_step("writing color image: " + color_path.string());
  stats.wrote_color = write_color_ppm(color_path);
  if (!stats.wrote_color) {
    return false;
  }

  log_step("writing depth image: " + depth_path.string());
  stats.wrote_depth = write_depth_pgm(depth_path);
  return stats.wrote_depth;
}

}  // namespace

int main(int argc, char** argv) {
  stats.start_ms = now_ms();
  const std::filesystem::path output_dir =
      argc > 1 ? std::filesystem::path(argv[1]) : std::filesystem::path("kinect-probe-output");

  log_step("output directory: " + output_dir.string());
  if (!ensure_output_dir(output_dir)) {
    write_status_json(output_dir / "kinect-status.json");
    return 1;
  }

  bool ok = false;
  if (init_freenect() && start_streams()) {
    event_loop_until_ready();
    ok = write_outputs(output_dir);
  } else {
    log_step(stats.error);
  }

  // Write status before shutdown so the status file records the frame counters
  // from the active device state, then close streams/devices so the terminal
  // returns with no background Kinect ownership left behind.
  write_status_json(output_dir / "kinect-status.json");
  cleanup_freenect();

  if (ok) {
    log_step("probe completed successfully");
    return 0;
  }

  if (stats.error.empty()) {
    stats.error = "probe failed before writing both output files";
  }
  log_step("probe failed: " + stats.error);
  return 1;
}
