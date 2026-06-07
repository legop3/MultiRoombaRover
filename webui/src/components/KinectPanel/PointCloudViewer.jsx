// Kinect Point Cloud Viewer
// Purpose: Renders a requested Kinect point-cloud frame as an interactive local Three.js scene.
// Scope: Owns lazy-loading Three.js, converting binary point data into geometry, and pausing work off-screen.
import { useCallback, useEffect, useRef } from 'react';

export default function PointCloudViewer({ frame }) {
  const hostRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const sceneRef = useRef(null);
  const objectRef = useRef(null);
  const controlsRef = useRef(null);
  const threeRef = useRef(null);
  const visibleRef = useRef(false);
  const frameRef = useRef(frame);

  const renderOnce = useCallback(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera || !visibleRef.current) return;
    renderer.render(scene, camera);
  }, []);

  const disposeRenderedObject = useCallback(() => {
    const object = objectRef.current;
    if (!object) return;
    sceneRef.current?.remove(object);
    object.geometry?.dispose();
    object.material?.dispose();
    objectRef.current = null;
  }, []);

  const rebuildGeometry = useCallback(() => {
    const scene = sceneRef.current;
    const currentFrame = frameRef.current;
    const THREE = threeRef.current;
    if (!scene || !THREE || !currentFrame?.buffer || !visibleRef.current) return;

    const pointCount = Number(currentFrame.meta?.pointCount) || 0;
    const strideBytes = Number(currentFrame.meta?.strideBytes) || 16;
    if (!pointCount || strideBytes < 16) return;

    const view = new DataView(currentFrame.buffer);
    const width = Number(currentFrame.meta?.width) || 0;
    const height = Number(currentFrame.meta?.height) || 0;
    const gridPointCount = width * height;
    const isGridFrame = Boolean(currentFrame.meta?.grid) && gridPointCount > 0;
    const vertexCount = isGridFrame ? gridPointCount : pointCount;
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const valid = isGridFrame ? new Uint8Array(vertexCount) : null;
    const zValues = isGridFrame ? new Float32Array(vertexCount) : null;

    // The server sends x/y/z as little-endian floats followed by rgba bytes.
    // Building typed arrays only when the canvas is visible keeps expensive
    // browser-side point conversion from happening while the card is off-screen.
    for (let index = 0; index < vertexCount; index += 1) {
      const source = index * strideBytes;
      const target = index * 3;
      positions[target + 0] = view.getFloat32(source + 0, true);
      positions[target + 1] = view.getFloat32(source + 4, true);
      const z = view.getFloat32(source + 8, true);
      positions[target + 2] = -z;
      colors[target + 0] = view.getUint8(source + 12) / 255;
      colors[target + 1] = view.getUint8(source + 13) / 255;
      colors[target + 2] = view.getUint8(source + 14) / 255;
      if (isGridFrame) {
        valid[index] = view.getUint8(source + 15) > 0 ? 1 : 0;
        zValues[index] = z;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    let object = null;
    if (isGridFrame) {
      const indices = [];
      const maxDepthStepMeters = 0.12;
      const canConnect = (a, b, c) => {
        if (!valid[a] || !valid[b] || !valid[c]) return false;
        const minZ = Math.min(zValues[a], zValues[b], zValues[c]);
        const maxZ = Math.max(zValues[a], zValues[b], zValues[c]);
        return maxZ - minZ <= maxDepthStepMeters;
      };

      // Kinect depth is a regular image.  Each 2x2 pixel cell can become two
      // triangles, but only when all vertices are valid and close in depth.  The
      // depth-step check prevents the mesh from drawing sheets across object
      // edges, missing-depth holes, or foreground/background gaps.
      for (let y = 0; y < height - 1; y += 1) {
        for (let x = 0; x < width - 1; x += 1) {
          const a = y * width + x;
          const b = a + 1;
          const c = a + width;
          const d = c + 1;
          if (canConnect(a, c, b)) indices.push(a, c, b);
          if (canConnect(b, c, d)) indices.push(b, c, d);
        }
      }

      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const material = new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
      });
      object = new THREE.Mesh(geometry, material);
    } else {
      const material = new THREE.PointsMaterial({
        size: 0.018,
        vertexColors: true,
        sizeAttenuation: true,
      });
      object = new THREE.Points(geometry, material);
    }

    geometry.computeBoundingSphere();
    disposeRenderedObject();
    objectRef.current = object;
    scene.add(object);
    renderOnce();
  }, [disposeRenderedObject, renderOnce]);

  useEffect(() => {
    frameRef.current = frame;
    rebuildGeometry();
  }, [frame, rebuildGeometry]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    let cancelled = false;
    let resizeObserver = null;
    let intersectionObserver = null;

    async function initRenderer() {
      // Three.js is loaded only after a point-cloud frame exists and this view
      // mounts.  The import resolves from locally built assets, so the viewer
      // still works without internet access.
      const [threeModule, controlsModule] = await Promise.all([
        import('three'),
        import('three/examples/jsm/controls/OrbitControls.js'),
      ]);
      if (cancelled) return;

      const THREE = threeModule;
      const { OrbitControls } = controlsModule;
      threeRef.current = THREE;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0a0a0a);
      const camera = new THREE.PerspectiveCamera(55, 4 / 3, 0.01, 20);
      camera.position.set(0, 0.15, 2.2);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(host.clientWidth || 640, host.clientHeight || 480, false);
      host.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = false;
      controls.target.set(0, 0, -1.4);
      controls.addEventListener('change', renderOnce);

      sceneRef.current = scene;
      cameraRef.current = camera;
      rendererRef.current = renderer;
      controlsRef.current = controls;

      resizeObserver = new ResizeObserver(([entry]) => {
        const width = Math.max(1, entry.contentRect.width);
        const height = Math.max(1, entry.contentRect.height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        renderOnce();
      });
      resizeObserver.observe(host);

      intersectionObserver = new IntersectionObserver(
        ([entry]) => {
          const nextVisible = Boolean(entry?.isIntersecting);
          visibleRef.current = nextVisible;
          if (nextVisible) {
            // When the card becomes visible again, rebuild from the latest
            // cached frame so users see current data without rendering while
            // hidden.
            rebuildGeometry();
            renderOnce();
          }
        },
        { threshold: 0.01 },
      );
      intersectionObserver.observe(host);
    }

    initRenderer();

    return () => {
      cancelled = true;
      intersectionObserver?.disconnect();
      resizeObserver?.disconnect();
      controlsRef.current?.removeEventListener('change', renderOnce);
      controlsRef.current?.dispose();
      disposeRenderedObject();
      rendererRef.current?.dispose();
      rendererRef.current?.domElement?.remove();
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      controlsRef.current = null;
      threeRef.current = null;
    };
  }, [disposeRenderedObject, rebuildGeometry, renderOnce]);

  return <div ref={hostRef} className="h-full w-full" />;
}
