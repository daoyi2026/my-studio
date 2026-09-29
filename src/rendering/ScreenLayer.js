import * as THREE from "three";
import { CSS3DObject, CSS3DRenderer } from "three/addons/renderers/CSS3DRenderer.js";
import { CONTENT } from "../config.js?v=8";

const CONTRACTS = {
  imac: { prefix: "IMAC", material: /^screen$/i, logicalWidth: 1440 },
  macbook: { prefix: "MACBOOK", material: /laptop14_screen/i, logicalWidth: 1440, proxyShell: true },
  phone: { prefix: "PHONE", material: /^iPhone Screen$/i, logicalWidth: 393, phone: true },
};

const PREVIEW_URLS = {
  imac: "./public/assets/screens/imac-home.png",
  macbook: "./public/assets/screens/macbook-home.png",
  phone: "./public/assets/screens/phone-home.png",
};

function materialsFor(object) {
  return Array.isArray(object.material) ? object.material : [object.material];
}

function objectPath(object) {
  const parts = [];
  for (let current = object; current; current = current.parent) parts.unshift(current.name || "");
  return parts.join("/");
}

function cutoutMaterial(material) {
  const copy = material?.clone() || new THREE.MeshBasicMaterial();
  copy.name = `${material?.name || "screen"}__WEB_CUTOUT`;
  copy.transparent = false;
  copy.opacity = 1;
  copy.depthTest = true;
  copy.depthWrite = true;
  copy.colorWrite = false;
  copy.blending = THREE.NoBlending;
  copy.side = THREE.DoubleSide;
  copy.needsUpdate = true;
  return copy;
}

function applyDisplayCutout(mesh, matcher) {
  const source = materialsFor(mesh);
  const next = source.map((material) => matcher.test(material?.name || "") ? cutoutMaterial(material) : material);
  mesh.material = Array.isArray(mesh.material) ? next : next[0];
}

function anchorPosition(room, name) {
  const anchor = room.getObjectByName(name);
  return anchor?.getWorldPosition(new THREE.Vector3()) || null;
}

function contractFrame(room, prefix) {
  const tl = anchorPosition(room, `${prefix}_SCREEN_TL`);
  const tr = anchorPosition(room, `${prefix}_SCREEN_TR`);
  const br = anchorPosition(room, `${prefix}_SCREEN_BR`);
  const bl = anchorPosition(room, `${prefix}_SCREEN_BL`);
  const centerAnchor = anchorPosition(room, `${prefix}_SCREEN_CENTER`);
  const normalAnchor = anchorPosition(room, `${prefix}_SCREEN_NORMAL`);
  if (![tl, tr, br, bl, centerAnchor, normalAnchor].every(Boolean)) return null;

  const center = tl.clone().add(tr).add(br).add(bl).multiplyScalar(.25);
  const right = tr.clone().sub(tl).add(br.clone().sub(bl)).multiplyScalar(.5).normalize();
  const up = tl.clone().sub(bl).add(tr.clone().sub(br)).multiplyScalar(.5).normalize();
  const normal = normalAnchor.clone().sub(centerAnchor).normalize();
  if (new THREE.Vector3().crossVectors(right, up).dot(normal) < 0) normal.negate();
  return {
    center,
    right,
    up,
    normal,
    width: (tl.distanceTo(tr) + bl.distanceTo(br)) * .5,
    height: (tl.distanceTo(bl) + tr.distanceTo(br)) * .5,
  };
}

function orient(object, frame, offset = 0) {
  const basis = new THREE.Matrix4().makeBasis(frame.right, frame.up, frame.normal);
  object.quaternion.setFromRotationMatrix(basis);
  object.position.copy(frame.center).addScaledVector(frame.normal, offset);
}

function plane(width, height, material, frame, offset = 0, name = "WEB_SCREEN_PLANE") {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.name = name;
  orient(mesh, frame, offset);
  return mesh;
}

function transitionTexture(kind) {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 600;
  const context = canvas.getContext("2d");
  const palette = kind === "phone"
    ? { background: "#f7f0f8", accent: "#b797bb", title: "DREAM GARDEN", detail: "A quiet place to grow" }
    : kind === "macbook"
      ? { background: "#f1f5ee", accent: "#73946a", title: "KINETIC LIFE OS", detail: "LIFE · WORK · RHYTHM" }
      : { background: "#eef4ee", accent: "#47dc70", title: "DAOYI©", detail: "CREATIVE DESIGNER · SHENZHEN" };
  context.fillStyle = palette.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = palette.accent;
  context.font = "700 54px -apple-system, BlinkMacSystemFont, sans-serif";
  context.letterSpacing = "2px";
  context.fillText(palette.title, 56, 92);
  context.globalAlpha = .72;
  context.font = "500 17px -apple-system, BlinkMacSystemFont, sans-serif";
  context.fillText(palette.detail, 58, 130);
  context.globalAlpha = .12;
  context.fillRect(58, 190, canvas.width - 116, 1);
  for (let index = 0; index < 3; index += 1) {
    context.fillRect(58, 242 + index * 76, canvas.width * (.72 - index * .08), 26);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export class ScreenLayer extends EventTarget {
  constructor(container, camera, webglScene) {
    super();
    this.container = container;
    this.camera = camera;
    this.webglScene = webglScene;
    this.scene = new THREE.Scene();
    this.renderer = new CSS3DRenderer();
    this.renderer.domElement.style.position = "absolute";
    this.renderer.domElement.style.inset = "0";
    // The CSS3D renderer root spans the viewport. It must not intercept the
    // screen itself; active descendants opt back into pointer events.
    this.renderer.domElement.style.pointerEvents = "none";
    container.appendChild(this.renderer.domElement);
    this.viewElement = this.renderer.domElement.firstElementChild;
    this.cameraElement = this.viewElement?.firstElementChild;
    this.screens = {};
    this.activeKind = null;
    this.cameraState = null;
    this.renderedFrames = 0;
    this.skippedFrames = 0;
    this.sceneMoving = false;
    this.mobileCompositing = matchMedia("(pointer: coarse)").matches || innerWidth <= 760;
    this.contentStartTimers = [];
    this.pendingInteractiveKind = null;
    container.addEventListener("pointerdown", (event) => {
      if (!this.activeKind || event.target.closest?.(".model-screen.is-interactive")) return;
      this.dispatchEvent(new CustomEvent("outsideclick", { detail: { kind: this.activeKind } }));
    });
    document.addEventListener("pointerdown", (event) => {
      if (!this.activeKind || event.target.closest?.(".model-screen")) return;
      this.dispatchEvent(new CustomEvent("outsideclick", { detail: { kind: this.activeKind } }));
    }, true);
  }

  configure(room) {
    room.updateMatrixWorld(true);
    for (const [kind, contract] of Object.entries(CONTRACTS)) {
      const frame = contractFrame(room, contract.prefix);
      if (!frame) {
        console.warn(`[screen] Missing ${contract.prefix} screen contract`);
        continue;
      }
      let displayMesh = null;
      room.traverse((object) => {
        if (displayMesh || !object.isMesh) return;
        const path = objectPath(object);
        const belongsToDevice = kind === "imac" ? /AGREED_iMac/i.test(path)
          : kind === "macbook" ? /AGREED_MacBook/i.test(path)
            : /REPL-v63-phone/i.test(path);
        if (belongsToDevice && materialsFor(object).some((material) => contract.material.test(material?.name || ""))) displayMesh = object;
      });
      if (!displayMesh) {
        console.warn(`[screen] Missing ${kind} display mesh`);
        continue;
      }
      applyDisplayCutout(displayMesh, contract.material);
      this.addDepthContract(kind, frame, contract);
      this.attach(kind, displayMesh, frame, CONTENT[kind], contract);
    }
    return this.screens;
  }

  addDepthContract(kind, frame, options) {
    const group = new THREE.Group();
    group.name = `WEB_SCREEN_OCCLUSION_${kind.toUpperCase()}`;
    const depthMaterial = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthTest: true,
      depthWrite: true,
      blending: THREE.NoBlending,
      side: THREE.DoubleSide,
    });
    const depth = plane(frame.width, frame.height, depthMaterial, frame, 0, `${group.name}_CONTENT_DEPTH`);
    depth.renderOrder = -100;
    group.add(depth);

    if (options.proxyShell) {
      const bezelX = frame.width * .045;
      const bezelY = frame.height * .075;
      const bottomOverlap = kind === "macbook" ? frame.height * .018 : 0;
      const outerWidth = frame.width + bezelX * 2;
      const outerHeight = frame.height + bezelY * 2;
      const shellMaterial = new THREE.MeshStandardMaterial({ color: 0x888983, metalness: .72, roughness: .28, side: THREE.DoubleSide });
      const backMaterial = shellMaterial.clone();
      backMaterial.side = THREE.BackSide;
      const back = plane(outerWidth, outerHeight, shellMaterial, frame, -.0025, `${group.name}_BACK`);
      back.material = backMaterial;
      group.add(back);
      const strips = [
        { width: outerWidth, height: bezelY, x: 0, y: (frame.height + bezelY) * .5 },
        { width: outerWidth, height: bezelY + bottomOverlap, x: 0, y: -(frame.height + bezelY + bottomOverlap) * .5 },
        { width: bezelX, height: frame.height, x: -(frame.width + bezelX) * .5, y: 0 },
        { width: bezelX, height: frame.height, x: (frame.width + bezelX) * .5, y: 0 },
      ];
      strips.forEach((strip, index) => {
        const stripFrame = { ...frame, center: frame.center.clone().addScaledVector(frame.right, strip.x).addScaledVector(frame.up, strip.y) };
        group.add(plane(strip.width, strip.height, shellMaterial, stripFrame, .0012, `${group.name}_BEZEL_${index + 1}`));
      });
    }
    this.webglScene.add(group);
  }

  attach(kind, mesh, frame, url, options) {
    const logicalWidth = options.logicalWidth;
    // Match the physical screen contract exactly. The old 393x852 phone page
    // was squeezed into a much wider authored display and distorted the app.
    const logicalHeight = Math.round(logicalWidth * frame.height / frame.width);
    const element = document.createElement("div");
    element.className = `model-screen model-screen-${kind}`;
    element.style.width = `${logicalWidth}px`;
    element.style.height = `${logicalHeight}px`;
    element.dataset.device = kind;
    const iframe = document.createElement("iframe");
    iframe.title = options.phone ? "Bloom Blossom Garden" : kind;
    iframe.loading = "eager";
    iframe.allow = options.phone ? "fullscreen" : "fullscreen; autoplay";
    iframe.dataset.src = url;
    iframe.src = "about:blank";
    element.appendChild(iframe);
    const object = new CSS3DObject(element);
    orient(object, frame, -.00035);
    object.scale.set(frame.width / logicalWidth, frame.height / logicalHeight, 1);
    this.scene.add(object);
    const fallbackMaterial = new THREE.MeshBasicMaterial({
      map: transitionTexture(kind),
      toneMapped: false,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    new THREE.TextureLoader().load(PREVIEW_URLS[kind], (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(4, this.webglScene.userData.maxAnisotropy || 4);
      fallbackMaterial.map?.dispose();
      fallbackMaterial.map = texture;
      fallbackMaterial.needsUpdate = true;
    });
    const fallback = plane(frame.width * 1.004, frame.height * 1.004, fallbackMaterial, frame, .0008, `WEB_SCREEN_TRANSITION_${kind.toUpperCase()}`);
    // Keep a local, GPU-cheap image on the physical screen while its page is
    // deferred. Loading three live websites during the 94% shader warm-up was
    // the main first-visit contention point on mobile.
    fallback.visible = true;
    fallback.renderOrder = 10;
    this.webglScene.add(fallback);
    this.screens[kind] = {
      kind, mesh, localBox: null, frame, element, object, iframe, fallback, url,
      logicalWidth, logicalHeight, iframeStartedAt: null, iframeLoadedAt: null,
      loadDuration: null, contentStarted: false, contentReady: false,
    };
    element.style.visibility = "hidden";
    iframe.addEventListener("load", () => {
      const screen = this.screens[kind];
      if (!screen?.contentStarted || iframe.src === "about:blank") return;
      screen.iframeLoadedAt = performance.now();
      screen.loadDuration = screen.iframeLoadedAt - screen.iframeStartedAt;
      screen.contentReady = true;
      element.dataset.ready = "true";
      this.applyScreenVisibility();
      if (this.pendingInteractiveKind === kind) this.setInteractive(kind);
    });
    this.cameraState = null;
  }

  startContent(kind) {
    const screen = this.screens[kind];
    if (!screen || screen.contentStarted) return;
    screen.contentStarted = true;
    screen.iframeStartedAt = performance.now();
    screen.iframe.src = screen.url;
  }

  startContentLoading() {
    // Mobile keeps the lightweight local previews until a screen is actually
    // selected. Two full external sites running behind the room were enough
    // to halve camera-transition frame rate on phones.
    if (this.mobileCompositing) return;
    this.contentStartTimers.forEach(clearTimeout);
    this.contentStartTimers = [];
    const order = ["macbook", "imac", "phone"].filter((kind) => this.screens[kind]);
    const start = (index) => {
      if (index >= order.length) return;
      const run = () => {
        this.startContent(order[index]);
        this.contentStartTimers.push(setTimeout(() => start(index + 1), 850));
      };
      if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 1200 });
      else this.contentStartTimers.push(setTimeout(run, 250));
    };
    start(0);
  }

  applyScreenVisibility() {
    Object.values(this.screens).forEach((screen) => {
      const mobileInteractive = this.mobileCompositing
        && !this.sceneMoving
        && this.overlayKind === screen.kind;
      // The preview texture is a current, pixel-matched capture of the live
      // page. Use it while any camera is moving so neither desktop nor mobile
      // needs to recomposite transformed iframe trees on every frame.
      const motionFallback = this.sceneMoving;
      const focusedPhoneFallback = screen.kind === this.transitionKind && screen.kind === "phone";
      const useFallback = this.mobileCompositing
        ? !mobileInteractive
        : !screen.contentReady || motionFallback || focusedPhoneFallback;
      screen.fallback.visible = useFallback;
      screen.element.style.contentVisibility = useFallback ? "hidden" : "visible";
      // `visibility:hidden` keeps animated cross-origin pages scheduled in
      // Chromium. `display:none` preserves their browsing context and state,
      // but lets the browser suspend painting while the matching preview is
      // carrying the screen during the camera move.
      screen.iframe.style.display = useFallback ? "none" : "block";
      if (!this.overlayKind || this.mobileCompositing) {
        screen.element.style.visibility = useFallback ? "hidden" : "visible";
      }
    });
    this.cameraState = null;
  }

  setTransitioning(kind, sceneMoving = false) {
    const next = kind && this.screens[kind] ? kind : null;
    if (next === this.transitionKind && sceneMoving === this.sceneMoving) return;
    this.transitionKind = next;
    this.sceneMoving = sceneMoving;
    this.applyScreenVisibility();
    if (!next) this.render(true);
  }

  setInteractive(kind) {
    const next = kind && this.screens[kind] ? kind : null;
    this.pendingInteractiveKind = next;
    if (next && !this.screens[next].contentReady) {
      this.startContent(next);
      this.applyScreenVisibility();
      return;
    }
    if (next === this.activeKind && (!next || this.overlayKind === next)) return;
    this.activeKind = next;
    if (this.overlayKind && this.overlayKind !== next) this.unmountInteractiveOverlay();
    // CSS3DRenderer uses a viewport root plus view/camera wrapper elements.
    // A child iframe cannot receive a hit while any one of these ancestors has
    // pointer-events:none. Enable that chain only for an active screen, while
    // leaving all non-active screen elements inert.
    this.renderer.domElement.querySelectorAll("*").forEach((element) => { element.style.pointerEvents = "none"; });
    this.renderer.domElement.style.pointerEvents = "none";
    if (next) {
      // Keep CSS3D wrappers transparent to hit testing. An explicit auto child
      // remains targetable through pointer-events:none ancestors.
      this.screens[next].element.style.pointerEvents = "auto";
      this.screens[next].element.querySelectorAll("*").forEach((element) => { element.style.pointerEvents = "auto"; });
      this.mountInteractiveOverlay(next);
    }
    this.container.classList.toggle("is-interactive", Boolean(next));
    const app = this.container.closest("#app");
    if (app) {
      if (next) app.dataset.screenActive = next;
      else delete app.dataset.screenActive;
    }
    Object.values(this.screens).forEach((screen) => screen.element.classList.toggle("is-interactive", screen.kind === next));
    this.applyScreenVisibility();
  }

  mountInteractiveOverlay(kind) {
    const screen = this.screens[kind];
    if (!screen || !this.cameraElement || this.overlayKind === kind) return;
    this.render(true);
    const { element } = screen;
    const rect = element.getBoundingClientRect();
    this.overlayStyle = { width: element.style.width, height: element.style.height, position: element.style.position, left: element.style.left, top: element.style.top, transform: element.style.transform, transformOrigin: element.style.transformOrigin, pointerEvents: element.style.pointerEvents };
    this.overlayViewTransform = this.viewElement.style.transform;
    this.overlayCameraTransform = this.cameraElement.style.transform;
    this.overlayScreenStyles = new Map(Object.values(this.screens).map((candidate) => [candidate.element, {
      display: candidate.element.style.display,
      visibility: candidate.element.style.visibility,
      pointerEvents: candidate.element.style.pointerEvents,
    }]));
    // Reparenting an iframe tears down its browsing context. That was nearly
    // invisible for the local MacBook page, but forced the external iMac and
    // phone apps to reload into a white frame on every interaction entry.
    // Keep every iframe under the CSS3D camera element and temporarily flatten
    // only that existing element into the measured viewport rectangle.
    this.viewElement.style.transform = "none";
    this.cameraElement.style.transform = "none";
    Object.values(this.screens).forEach((candidate) => {
      candidate.element.style.visibility = candidate.kind === kind ? "visible" : "hidden";
      candidate.element.style.pointerEvents = candidate.kind === kind ? "auto" : "none";
    });
    // CSS3D and WebGL rasterize the same fractional MacBook bounds separately.
    // Cover their rounding difference by two CSS pixels, well inside the
    // existing 4.5% proxy bezel, without changing the screen contract or input.
    const bleed = kind === "macbook" ? 2 : 0;
    const targetWidth = rect.width + bleed * 2;
    const targetHeight = rect.height + bleed * 2;
    Object.assign(element.style, {
      position: "absolute",
      left: `${rect.left - bleed}px`,
      top: `${rect.top - bleed}px`,
      // Keep the iframe's logical layout viewport unchanged. Only scale its
      // existing desktop-sized surface into the physical screen rectangle;
      // narrow browser windows therefore cannot trip the website's mobile
      // breakpoint, and the browsing context is never reloaded.
      width: `${screen.logicalWidth}px`,
      height: `${screen.logicalHeight}px`,
      transform: `scale(${targetWidth / screen.logicalWidth}, ${targetHeight / screen.logicalHeight})`,
      transformOrigin: "0 0",
      pointerEvents: "auto",
    });
    this.overlayKind = kind;
    this.applyScreenVisibility();
  }

  unmountInteractiveOverlay() {
    const screen = this.screens[this.overlayKind];
    if (!screen) return;
    Object.assign(screen.element.style, this.overlayStyle);
    this.viewElement.style.transform = this.overlayViewTransform;
    this.cameraElement.style.transform = this.overlayCameraTransform;
    this.overlayScreenStyles?.forEach((style, element) => Object.assign(element.style, style));
    this.overlayKind = null;
    this.overlayStyle = null;
    this.overlayViewTransform = null;
    this.overlayCameraTransform = null;
    this.overlayScreenStyles = null;
    this.applyScreenVisibility();
    this.render(true);
  }

  screenForObject(object) {
    for (const screen of Object.values(this.screens)) {
      if (object === screen.mesh || screen.mesh === object.parent) return screen;
    }
    return null;
  }

  setCamera(camera) { this.camera = camera; this.cameraState = null; }
  resize(width, height) { this.renderer.setSize(width, height); this.cameraState = null; }

  render(force = false) {
    if (this.overlayKind) return false;
    // The matching local screen previews are already visible during motion,
    // so the CSS3D scene can wait for the camera to settle and render once.
    if (this.sceneMoving && !force) {
      this.skippedFrames += 1;
      return false;
    }
    this.camera.updateMatrixWorld();
    const nextState = [...this.camera.projectionMatrix.elements, ...this.camera.matrixWorld.elements];
    const unchanged = this.cameraState?.length === nextState.length
      && nextState.every((value, index) => value === this.cameraState[index]);
    if (!force && unchanged) {
      this.skippedFrames += 1;
      return false;
    }
    this.renderer.render(this.scene, this.camera);
    this.cameraState = nextState;
    this.renderedFrames += 1;
    return true;
  }
}
