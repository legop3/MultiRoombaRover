// Kinect native worker.
//
// Purpose:
// Keep the proven libfreenect camera/depth callback path running in one native
// process and answer snapshot commands from Node.  Node owns auth, cooldowns,
// JPEG encoding, and Socket.IO fan-out; this worker owns only USB streaming and
// binary frame extraction.
//
// Protocol:
// stdin receives one JSON command per line, for example {"id":1,"mode":"color"}.
// stdout returns one JSON metadata line followed by payloadBytes raw bytes.  All
// diagnostics go to stderr so libfreenect logs can never corrupt binary frames.

#include <libfreenect.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
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
constexpr int kFrameStaleMs = 5000;
constexpr int kCommandFrameWaitMs = 3000;

struct FrameCache {
  std::mutex mutex;
  std::condition_variable cv;
  std::vector<uint8_t> rgb = std::vector<uint8_t>(kRgbBytes);
  std::vector<uint16_t> depth = std::vector<uint16_t>(kDepthPixels);
  bool has_rgb = false;
  bool has_depth = false;
  uint32_t valid_depth_pixels = 0;
  uint64_t rgb_at_ms = 0;
  uint64_t depth_at_ms = 0;
  uint64_t rgb_frames = 0;
  uint64_t depth_frames = 0;
};

FrameCache cache;
std::atomic<bool> running{true};
freenect_context* freenect_ctx = nullptr;
freenect_device* freenect_dev = nullptr;

// libfreenect's video callback expects us to hand back a replacement buffer.
// The cache receives its own copy, so this buffer can be reused solely for USB
// streaming without Node ever reading from memory libfreenect still owns.
std::vector<uint8_t> video_back_buffer(kRgbBytes);

uint64_t now_ms() {
  using namespace std::chrono;
  return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

void log_step(const std::string& message) {
  std::cerr << "[kinect-worker] " << message << "\n";
}

std::string json_escape(const std::string& value) {
  std::ostringstream out;
  for (char ch : value) {
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

int parse_id(const std::string& line) {
  const std::string key = "\"id\"";
  const auto key_pos = line.find(key);
  if (key_pos == std::string::npos) return 0;
  const auto colon = line.find(':', key_pos + key.size());
  if (colon == std::string::npos) return 0;
  std::size_t pos = colon + 1;
  while (pos < line.size() && (line[pos] == ' ' || line[pos] == '\t')) pos += 1;
  return std::atoi(line.c_str() + pos);
}

std::string parse_mode(const std::string& line) {
  const std::string key = "\"mode\"";
  const auto key_pos = line.find(key);
  if (key_pos == std::string::npos) return "";
  const auto colon = line.find(':', key_pos + key.size());
  if (colon == std::string::npos) return "";
  const auto first_quote = line.find('"', colon + 1);
  if (first_quote == std::string::npos) return "";
  const auto second_quote = line.find('"', first_quote + 1);
  if (second_quote == std::string::npos) return "";
  return line.substr(first_quote + 1, second_quote - first_quote - 1);
}

void write_packet(int id, const std::string& meta_fields, const std::vector<uint8_t>& payload) {
  std::cout << "{\"id\":" << id << ",\"ok\":true" << meta_fields
            << ",\"payloadBytes\":" << payload.size() << "}\n";
  std::cout.flush();
  if (!payload.empty()) {
    std::cout.write(reinterpret_cast<const char*>(payload.data()), static_cast<std::streamsize>(payload.size()));
    std::cout.flush();
  }
}

void write_error(int id, const std::string& message) {
  std::cout << "{\"id\":" << id << ",\"ok\":false,\"error\":\""
            << json_escape(message) << "\",\"payloadBytes\":0}\n";
  std::cout.flush();
}

void depth_callback(freenect_device*, void* depth_data, uint32_t) {
  const auto* depth = static_cast<const uint16_t*>(depth_data);
  std::lock_guard<std::mutex> lock(cache.mutex);
  std::memcpy(cache.depth.data(), depth, kDepthPixels * sizeof(uint16_t));
  uint32_t valid_depth_pixels = 0;
  for (int index = 0; index < kDepthPixels; index += 1) {
    if (depth[index] != 0) valid_depth_pixels += 1;
  }
  cache.has_depth = true;
  cache.valid_depth_pixels = valid_depth_pixels;
  cache.depth_at_ms = now_ms();
  cache.depth_frames += 1;
  cache.cv.notify_all();
}

void video_callback(freenect_device* device, void* rgb_data, uint32_t) {
  const auto* rgb = static_cast<const uint8_t*>(rgb_data);
  std::lock_guard<std::mutex> lock(cache.mutex);
  std::memcpy(cache.rgb.data(), rgb, kRgbBytes);
  cache.has_rgb = true;
  cache.rgb_at_ms = now_ms();
  cache.rgb_frames += 1;

  // Hand libfreenect a replacement immediately.  Node reads only from the
  // independent cache copy, which avoids a use-after-callback race.
  freenect_set_video_buffer(device, video_back_buffer.data());
  cache.cv.notify_all();
}

bool wait_for_frames(bool need_rgb, bool need_depth, std::string* error) {
  std::unique_lock<std::mutex> lock(cache.mutex);
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(kCommandFrameWaitMs);
  const auto ready = [&]() {
    const uint64_t now = now_ms();
    const bool rgb_ok = !need_rgb || (cache.has_rgb && now - cache.rgb_at_ms <= kFrameStaleMs);
    const bool depth_ok =
        !need_depth ||
        (cache.has_depth && cache.valid_depth_pixels > 0 && now - cache.depth_at_ms <= kFrameStaleMs);
    return rgb_ok && depth_ok;
  };

  while (!ready()) {
    if (cache.cv.wait_until(lock, deadline) == std::cv_status::timeout) break;
  }
  if (ready()) return true;

  const uint64_t now = now_ms();
  std::ostringstream msg;
  msg << "kinect frames unavailable";
  if (need_rgb) {
    msg << " rgb=" << (cache.has_rgb ? std::to_string(now - cache.rgb_at_ms) + "ms old" : "missing");
  }
  if (need_depth) {
    msg << " depth="
        << (cache.has_depth
                ? std::to_string(now - cache.depth_at_ms) + "ms old valid=" +
                      std::to_string(cache.valid_depth_pixels)
                : "missing");
  }
  *error = msg.str();
  return false;
}

void handle_color(int id) {
  std::string error;
  if (!wait_for_frames(true, false, &error)) {
    write_error(id, error);
    return;
  }

  std::vector<uint8_t> payload;
  uint64_t age = 0;
  {
    std::lock_guard<std::mutex> lock(cache.mutex);
    payload = cache.rgb;
    age = now_ms() - cache.rgb_at_ms;
  }

  std::ostringstream meta;
  meta << ",\"kind\":\"color\",\"format\":\"rgb24\",\"width\":" << kWidth
       << ",\"height\":" << kHeight << ",\"frameAgeMs\":" << age;
  write_packet(id, meta.str(), payload);
}

void handle_pointcloud(int id) {
  std::string error;
  if (!wait_for_frames(true, true, &error)) {
    write_error(id, error);
    return;
  }

  std::vector<uint8_t> rgb;
  std::vector<uint16_t> depth;
  uint64_t rgb_age = 0;
  uint64_t depth_age = 0;
  {
    std::lock_guard<std::mutex> lock(cache.mutex);
    rgb = cache.rgb;
    depth = cache.depth;
    const uint64_t now = now_ms();
    rgb_age = now - cache.rgb_at_ms;
    depth_age = now - cache.depth_at_ms;
  }

  std::vector<uint8_t> payload;
  payload.reserve(kDepthPixels * 16);
  uint32_t point_count = 0;
  const float focal_x = 525.0f;
  const float focal_y = 525.0f;
  const float center_x = static_cast<float>(kWidth - 1) / 2.0f;
  const float center_y = static_cast<float>(kHeight - 1) / 2.0f;

  auto append_float = [&](float value) {
    uint8_t bytes[sizeof(float)];
    std::memcpy(bytes, &value, sizeof(float));
    payload.insert(payload.end(), bytes, bytes + sizeof(float));
  };

  // Registered depth aligns with RGB, so each valid depth pixel can become a
  // colored point without an additional calibration lookup.  Invalid zero-depth
  // pixels are skipped to keep the payload and browser point count smaller.
  for (int y = 0; y < kHeight; y += 1) {
    for (int x = 0; x < kWidth; x += 1) {
      const int idx = y * kWidth + x;
      const uint16_t z_mm = depth[idx];
      if (z_mm == 0) continue;
      const float z = static_cast<float>(z_mm) / 1000.0f;
      const float world_x = (static_cast<float>(x) - center_x) * z / focal_x;
      const float world_y = -(static_cast<float>(y) - center_y) * z / focal_y;
      append_float(world_x);
      append_float(world_y);
      append_float(z);
      payload.push_back(rgb[idx * 3 + 0]);
      payload.push_back(rgb[idx * 3 + 1]);
      payload.push_back(rgb[idx * 3 + 2]);
      payload.push_back(255);
      point_count += 1;
    }
  }

  std::ostringstream meta;
  meta << ",\"kind\":\"pointCloud\",\"format\":\"xyzrgb-f32-u8\",\"width\":" << kWidth
       << ",\"height\":" << kHeight << ",\"pointCount\":" << point_count
       << ",\"rgbFrameAgeMs\":" << rgb_age << ",\"depthFrameAgeMs\":" << depth_age;
  write_packet(id, meta.str(), payload);
}

void handle_status(int id) {
  bool has_rgb = false;
  bool has_depth = false;
  uint64_t rgb_age = 0;
  uint64_t depth_age = 0;
  uint64_t rgb_frames = 0;
  uint64_t depth_frames = 0;
  uint32_t valid_depth_pixels = 0;
  {
    std::lock_guard<std::mutex> lock(cache.mutex);
    const uint64_t now = now_ms();
    has_rgb = cache.has_rgb;
    has_depth = cache.has_depth;
    rgb_age = has_rgb ? now - cache.rgb_at_ms : 0;
    depth_age = has_depth ? now - cache.depth_at_ms : 0;
    rgb_frames = cache.rgb_frames;
    depth_frames = cache.depth_frames;
    valid_depth_pixels = cache.valid_depth_pixels;
  }

  std::ostringstream meta;
  meta << ",\"kind\":\"status\",\"hasRgb\":" << (has_rgb ? "true" : "false")
       << ",\"hasDepth\":" << (has_depth ? "true" : "false")
       << ",\"rgbFrameAgeMs\":" << (has_rgb ? std::to_string(rgb_age) : "null")
       << ",\"depthFrameAgeMs\":" << (has_depth ? std::to_string(depth_age) : "null")
       << ",\"rgbFrames\":" << rgb_frames << ",\"depthFrames\":" << depth_frames
       << ",\"validDepthPixels\":" << valid_depth_pixels;
  write_packet(id, meta.str(), {});
}

bool init_freenect() {
  log_step("initializing libfreenect");
  const int init_result = freenect_init(&freenect_ctx, nullptr);
  if (init_result < 0) {
    log_step("freenect_init failed with result " + std::to_string(init_result));
    return false;
  }
  freenect_set_log_level(freenect_ctx, FREENECT_LOG_WARNING);

  // Use only the camera subdevice for this first app integration.  The probe
  // showed the LED/motor sibling can error while camera/depth still works, so
  // startup should not depend on motor access.
  freenect_select_subdevices(
      freenect_ctx,
      static_cast<freenect_device_flags>(FREENECT_DEVICE_CAMERA));

  const int device_count = freenect_num_devices(freenect_ctx);
  log_step("device count: " + std::to_string(device_count));
  if (device_count < 1) {
    log_step("no kinect devices found");
    return false;
  }

  const int open_result = freenect_open_device(freenect_ctx, &freenect_dev, 0);
  if (open_result < 0) {
    log_step("freenect_open_device failed with result " + std::to_string(open_result));
    return false;
  }
  return true;
}

bool start_streams() {
  log_step("starting camera/depth streams");
  freenect_set_depth_callback(freenect_dev, depth_callback);
  freenect_set_video_callback(freenect_dev, video_callback);
  freenect_set_video_buffer(freenect_dev, video_back_buffer.data());

  if (freenect_set_video_mode(
          freenect_dev,
          freenect_find_video_mode(FREENECT_RESOLUTION_MEDIUM, FREENECT_VIDEO_RGB)) < 0) {
    log_step("freenect_set_video_mode failed");
    return false;
  }
  if (freenect_set_depth_mode(
          freenect_dev,
          freenect_find_depth_mode(FREENECT_RESOLUTION_MEDIUM, FREENECT_DEPTH_REGISTERED)) < 0) {
    log_step("freenect_set_depth_mode failed");
    return false;
  }
  if (freenect_start_depth(freenect_dev) < 0) {
    log_step("freenect_start_depth failed");
    return false;
  }
  if (freenect_start_video(freenect_dev) < 0) {
    log_step("freenect_start_video failed");
    return false;
  }
  return true;
}

void event_loop() {
  while (running) {
    timeval timeout;
    timeout.tv_sec = 0;
    timeout.tv_usec = 100000;
    const int result = freenect_process_events_timeout(freenect_ctx, &timeout);
    if (result < 0) {
      log_step("libfreenect event loop failed with result " + std::to_string(result));
      running = false;
      break;
    }
  }
}

void shutdown_freenect() {
  running = false;
  if (freenect_dev) {
    freenect_stop_depth(freenect_dev);
    freenect_stop_video(freenect_dev);
    freenect_close_device(freenect_dev);
    freenect_dev = nullptr;
  }
  if (freenect_ctx) {
    freenect_shutdown(freenect_ctx);
    freenect_ctx = nullptr;
  }
}

}  // namespace

int main() {
  if (!init_freenect() || !start_streams()) {
    shutdown_freenect();
    return 1;
  }

  std::thread worker(event_loop);
  std::string line;
  while (running && std::getline(std::cin, line)) {
    const int id = parse_id(line);
    const std::string mode = parse_mode(line);
    if (mode == "color") {
      handle_color(id);
    } else if (mode == "pointcloud") {
      handle_pointcloud(id);
    } else if (mode == "status") {
      handle_status(id);
    } else {
      write_error(id, "unknown kinect command");
    }
  }

  running = false;
  if (worker.joinable()) {
    worker.join();
  }
  shutdown_freenect();
  return 0;
}
