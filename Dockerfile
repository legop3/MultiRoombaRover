# syntax=docker/dockerfile:1

# MultiRover Production Application Image
# Purpose: Builds the web application, Node dependencies, native hardware
# workers, and pinned runtime tools into one amd64 server image.
# Scope: Packages the main application only. Compose, host hardware access, and
# lifecycle/update control remain separate deployment concerns.

ARG FEDORA_VERSION=43

FROM fedora:${FEDORA_VERSION} AS architecture-check
ARG TARGETARCH
# The central server is currently deployed and verified only on amd64. Failing
# here avoids publishing an ARM image whose native workers and hardware paths
# have never been exercised on a real ARM server.
RUN test "${TARGETARCH}" = "amd64" || (echo "MultiRover server images support only linux/amd64." >&2; exit 1)

FROM architecture-check AS webui-build
RUN dnf install -y --setopt=install_weak_deps=False nodejs npm \
    && dnf clean all
WORKDIR /build
# Copy dependency manifests first so ordinary source edits retain the expensive
# npm cache layer. npm ci makes the checked-in lockfile the exact dependency
# source rather than resolving a new tree during image publication.
COPY webui/package.json webui/package-lock.json ./webui/
RUN --mount=type=cache,target=/root/.npm \
    cd webui && npm ci
COPY webui ./webui
# Vite deliberately emits into ../server/public. Create that destination in the
# isolated builder and copy only its finished files into the runtime stage.
RUN mkdir -p server/public && cd webui && npm run build

FROM architecture-check AS server-dependencies
RUN dnf install -y --setopt=install_weak_deps=False nodejs npm gcc-c++ make python3 \
    && dnf clean all
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
# Native Node modules compile here when a matching prebuild is unavailable;
# neither the compiler nor npm's download cache is copied into the final image.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

FROM architecture-check AS native-workers
RUN dnf install -y --setopt=install_weak_deps=False \
      bluez-libs-devel \
      gcc-c++ \
      libcap \
      libfreenect-devel \
      libusb1-devel \
      make \
      pkgconf-pkg-config \
      wiiuse-devel \
    && dnf clean all
WORKDIR /build
COPY server/src/services/kinectService/native ./kinect
COPY server/src/services/balanceBoardService/native ./balance-board
# Build both hardware workers from source for the image's Fedora ABI instead of
# copying workstation binaries whose linked libraries may not match.
RUN make -C kinect \
    && make -C balance-board

FROM architecture-check AS packaged-tools
ARG MEDIAMTX_VERSION=1.15.3
ARG MEDIAMTX_SHA256=cddc98d17f23689848d5a935151264e117cfb27cee2db87b5079b19572e4b48d
ARG NEOLINK_VERSION=0.6.2
ARG NEOLINK_SHA256=0cb963b44dca7ccc5333154092186e1536c687aef0e1ad119b7f310a7471dbbb
ARG GOOGLE_TTS_VERSION=26.5
ARG GOOGLE_TTS_SHA256=6a9eae6726871788da52e767dad964a1c83e7feb7e7dbac508a2574a2345ac24
RUN dnf install -y --setopt=install_weak_deps=False curl findutils tar unzip xz \
    && dnf clean all
WORKDIR /build/tools
# Each external artifact is pinned and checked before extraction. A changed or
# truncated upstream download therefore fails the image build instead of being
# silently promoted as the new production server.
RUN curl --fail --location --retry 3 \
      "https://github.com/bluenviron/mediamtx/releases/download/v${MEDIAMTX_VERSION}/mediamtx_v${MEDIAMTX_VERSION}_linux_amd64.tar.gz" \
      --output mediamtx.tar.gz \
    && echo "${MEDIAMTX_SHA256}  mediamtx.tar.gz" | sha256sum --check --strict \
    && tar -xzf mediamtx.tar.gz mediamtx \
    && install -D -m 0755 mediamtx /output/usr/local/bin/mediamtx
RUN curl --fail --location --retry 3 \
      "https://github.com/QuantumEntangledAndy/neolink/releases/download/v${NEOLINK_VERSION}/neolink_linux_x86_64_ubuntu.zip" \
      --output neolink.zip \
    && echo "${NEOLINK_SHA256}  neolink.zip" | sha256sum --check --strict \
    && unzip -q neolink.zip -d neolink \
    && neolink_binary="$(find neolink -type f -name neolink -print -quit)" \
    && test -n "${neolink_binary}" \
    && install -D -m 0755 "${neolink_binary}" /output/usr/local/bin/neolink
RUN curl --fail --location --retry 3 \
      "https://storage.googleapis.com/chromeos-localmirror/distfiles/googletts-${GOOGLE_TTS_VERSION}.tar.xz" \
      --output googletts.tar.xz \
    && echo "${GOOGLE_TTS_SHA256}  googletts.tar.xz" | sha256sum --check --strict \
    && tar -xf googletts.tar.xz en-us-x-multi.zvoice libchrometts_x86_64.so \
    && install -D -m 0644 libchrometts_x86_64.so /output/opt/roverd/googletts/libchrometts.so \
    && mkdir -p /output/opt/roverd/googletts/en-us-x-multi-r30 \
    && unzip -q en-us-x-multi.zvoice -d /output/opt/roverd/googletts/en-us-x-multi-r30 \
    && find /output/opt/roverd/googletts -type d -exec chmod 0755 {} + \
    && find /output/opt/roverd/googletts -type f -exec chmod 0644 {} +

FROM fedora:${FEDORA_VERSION} AS runtime
ARG FEDORA_VERSION
ARG TARGETARCH
RUN test "${TARGETARCH}" = "amd64" || (echo "MultiRover server images support only linux/amd64." >&2; exit 1)
# Fedora's restricted ffmpeg-free build omits the libx264 encoder used by every
# replay output path. Enable RPM Fusion Free before installing runtime packages
# so the image receives the complete FFmpeg build instead of requiring replay
# code to work around a deployment-only codec omission.
RUN dnf install -y --setopt=install_weak_deps=False \
      "https://download1.rpmfusion.org/free/fedora/rpmfusion-free-release-${FEDORA_VERSION}.noarch.rpm"
# This is the complete runtime package set. Build headers and compilers live in
# earlier stages, while media, TTS, USB, and Bluetooth libraries remain here
# because enabled services invoke them after startup. Weak dependencies are
# deliberately disabled: Fedora otherwise installs desktop portals, graphical
# themes, and GPU drivers that a headless server neither starts nor uses.
RUN dnf install -y --setopt=install_weak_deps=False \
      bluez \
      bluez-libs \
      espeak \
      ffmpeg \
      flite \
      gstreamer1 \
      gstreamer1-plugins-bad-free \
      gstreamer1-plugins-base \
      gstreamer1-plugins-good \
      gstreamer1-rtsp-server \
      libcxx \
      libcxxabi \
      libcap \
      libfreenect \
      libusb1 \
      nodejs \
      python3 \
      shadow-utils \
      tini \
      wiiuse \
    --allowerasing \
    && dnf clean all \
    && useradd --uid 1000 --create-home --home-dir /home/multirover --shell /sbin/nologin multirover \
    && install -d -o multirover -g multirover -m 0755 /data /opt/multirover/server

WORKDIR /opt/multirover/server
COPY server/index.js server/package.json server/package-lock.json ./
COPY server/src ./src
COPY server/assets ./assets
COPY server/prompts ./prompts
COPY --from=server-dependencies /build/server/node_modules ./node_modules
COPY --from=webui-build /build/server/public ./public
COPY --from=native-workers /build/kinect/kinect_worker ./src/services/kinectService/native/kinect_worker
COPY --from=native-workers /build/balance-board/balance_board_worker ./src/services/balanceBoardService/native/balance_board_worker
COPY --from=packaged-tools /output/ /
COPY --chmod=0755 server/bin/chromegtts-wav.py /usr/local/bin/chromegtts-wav
COPY --chmod=0755 server/mediamtx/rover-snapshot-writer.sh /usr/local/bin/rover-snapshot-writer.sh

# Only the audited Balance Board bridge receives its two required socket
# capabilities. Node and the rest of the application continue to run without
# ambient capabilities; Compose must also allow these capabilities when the
# optional Balance Board feature is used.
RUN setcap cap_net_admin,cap_net_bind_service+ep \
      ./src/services/balanceBoardService/native/balance_board_worker \
    && /usr/local/bin/chromegtts-wav \
      --text "test" \
      --voice tpf \
      --pitch 1 \
      --speed 1 \
      --output /tmp/chromegtts-smoke.wav \
    && test -s /tmp/chromegtts-smoke.wav \
    && rm /tmp/chromegtts-smoke.wav

ENV NODE_ENV=production \
    SERVER_DATA_DIR=/data \
    ROVER_SNAPSHOT_WRITER_BIN=/usr/local/bin/rover-snapshot-writer.sh

USER multirover
# Declaring the persistence boundary also protects direct `docker run` users:
# when no explicit host path or named volume is supplied, Docker still places
# `/data` on an anonymous volume rather than the replaceable image layer.
VOLUME ["/data"]
EXPOSE 8080/tcp 8554/tcp 8189/tcp 8189/udp
# Use Node's built-in fetch so container readiness does not require curl or a
# second probe binary in the runtime image. The endpoint verifies the writable
# data mount and MediaMTX; reaching it already proves Node is accepting HTTP.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(response=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "index.js"]

# OCI metadata links the unversioned latest image to its source without
# introducing release numbers or additional image tags.
LABEL org.opencontainers.image.source="https://github.com/legop3/MultiRoombaRover" \
      org.opencontainers.image.title="MultiRoombaRover"
