# kinect probe

This is a standalone Kinect v1/libfreenect probe. It does not load the rover
server, does not open sockets, and does not keep running after the capture
attempt finishes.

Build it:

```bash
cd server/tools/kinect-probe
make
```

Run it:

```bash
./kinect_probe
```

By default it writes into `./kinect-probe-output`:

- `kinect-color.ppm`: raw RGB color frame
- `kinect-depth.pgm`: registered 16-bit depth frame
- `kinect-status.json`: startup/capture timings and frame counters

You can choose a different output directory:

```bash
./kinect_probe /tmp/kinect-probe
```

The probe prints every important libfreenect startup step to stderr so failures
show the exact point where the native path diverges from `freenect-regview`.
