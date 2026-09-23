import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { surfaceFrame } from "../utils/geometry.js";

const WARM = 0xffd6a0;

function archCookie() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 384;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.beginPath();
  context.moveTo(22, 364);
  context.lineTo(234, 364);
  context.lineTo(234, 132);
  context.arc(128, 132, 106, 0, Math.PI, true);
  context.closePath();
  context.clip();
  const glow = context.createLinearGradient(0, 0, 0, 384);
  glow.addColorStop(0, "rgba(255,255,255,.72)");
  glow.addColorStop(.55, "rgba(255,255,255,.94)");
  glow.addColorStop(1, "rgba(255,255,255,.5)");
  context.fillStyle = glow;
  context.fillRect(0, 0, 256, 384);
  context.globalCompositeOperation = "destination-out";
  context.fillStyle = "rgba(0,0,0,.82)";
  context.fillRect(121, 25, 14, 344);
  context.fillRect(24, 202, 208, 13);
  context.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function patchMaterial(color, texture) {
  return new THREE.MeshBasicMaterial({
    color,
    map: texture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function projectedOpeningGeometry(windowMesh, frame, direction, floorY, wallGap) {
  const source = windowMesh.geometry;
  const position = source.getAttribute("position");
  if (!position) return null;
  windowMesh.updateWorldMatrix(true, false);
  const side = frame.right.clone();
  const projected = new Float32Array(position.count * 3);
  const uvs = new Float32Array(position.count * 2);
  const world = new THREE.Vector3();
  const floorPoint = frame.center.clone().setY(floorY);
  for (let index = 0; index < position.count; index += 1) {
    world.fromBufferAttribute(position, index).applyMatrix4(windowMesh.matrixWorld).sub(frame.center);
    // Reuse the actual opening vertices: width travels along the floor and the
    // opening height becomes the depth of the thrown silhouette, at 1:1 scale.
    const lateral = world.dot(side);
    const sourceHeight = world.dot(frame.up);
    // Start at the bottom of the opening, then leave a real gap from the wall.
    // Day and night share this exact 1:1 geometry and differ only by direction.
    const openingDepth = sourceHeight + frame.height * .5 + wallGap;
    world.copy(floorPoint).addScaledVector(side, lateral).addScaledVector(direction, openingDepth);
    projected[index * 3] = world.x;
    projected[index * 3 + 1] = floorY + .003;
    projected[index * 3 + 2] = world.z;
    // Window glass has no exportable UVs. Project a stable 0..1 coordinate
    // from the real opening frame so the muntin cookie remains registered to
    // the 1:1 silhouette rather than sampling transparently out of range.
    uvs[index * 2] = THREE.MathUtils.clamp(.5 + lateral / frame.width, 0, 1);
    uvs[index * 2 + 1] = THREE.MathUtils.clamp(.5 + sourceHeight / frame.height, 0, 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(projected, 3));
  if (source.index) geometry.setIndex(source.index.clone());
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return { geometry, openingHeight: frame.height };
}

function lampGroup(room, kind) {
  if (kind === "desk") return room.getObjectByName("ASSET-v50-BellLamp");
  if (kind === "floor") return room.getObjectByName("REPL-v63-floor-lamp-Group");
  return room.getObjectByName("lamp_180") || room.getObjectByName("lamp 180") || room.getObjectByName("REPL-v63-drawing-desk-Group");
}

function lampOrigin(group, kind) {
  let emitter = group;
  if (kind === "desk") {
    group.traverse((object) => {
      const materials = object.isMesh ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
      if (materials.some((material) => /^Material\.019$/i.test(material?.name || ""))) emitter = object;
    });
  }
  if (kind === "floor") emitter = group.getObjectByName("Cube002") || emitter;
  const box = new THREE.Box3().setFromObject(emitter);
  const center = box.getCenter(new THREE.Vector3());
  if (kind === "floor") center.y = box.min.y + box.getSize(new THREE.Vector3()).y * .12;
  return { origin: center, emitter, box };
}

export class LightDirector {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.mode = "night";
    this.lampState = { desk: true, floor: true, drawing: true };
    this.modeBlend = 0;
    this.modeTransition = null;
    this.modeTransitionDuration = 4800;
    this.lampBlend = { desk: 1, floor: 1, drawing: 1 };
    this.lampTransitions = {};
    this.lampTransitionDuration = 1500;
    this.r7Polish = false;
    this.rig = {};
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
    scene.environment = this.environment;
  }

  configure(room, roomBounds) {
    const size = roomBounds.getSize(new THREE.Vector3());
    const center = roomBounds.getCenter(new THREE.Vector3());
    const hemi = new THREE.HemisphereLight(0xe9efff, 0x5e5649, .42);
    this.scene.add(hemi);
    const ambient = new THREE.AmbientLight(0xfff8e8, .18);
    this.scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xfff4d8, 1.6);
    sun.position.copy(center).add(new THREE.Vector3(-size.x * .7, size.y * 1.45, size.z * .8));
    sun.target.position.copy(center);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    const radius = Math.max(size.x, size.z) * .8;
    Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: .05, far: size.length() * 3 });
    sun.shadow.bias = -.00018;
    sun.shadow.normalBias = .018;
    this.scene.add(sun, sun.target);
    const nightFill = new THREE.DirectionalLight(0xb8c6d9, .2);
    nightFill.position.copy(center).add(new THREE.Vector3(0, size.y * 1.4, 0));
    nightFill.target.position.copy(center);
    this.scene.add(nightFill, nightFill.target);
    this.rig = { hemi, ambient, sun, nightFill, lamps: {}, screenLights: {} };
    this.nightFog = new THREE.FogExp2(0x11120f, .018);

    ["desk", "floor", "drawing"].forEach((kind) => this.addPractical(room, kind, size));
    this.addWindowPatches(room, roomBounds);
    this.setMode("night", true);
  }

  addPractical(room, kind, roomSize) {
    const group = lampGroup(room, kind);
    if (!group) return;
    const emitterData = lampOrigin(group, kind);
    const origin = emitterData.origin;
    const emitterSize = emitterData.box.getSize(new THREE.Vector3());
    const bulbRadius = kind === "drawing" ? roomSize.length() * .0024 : Math.max(.012, Math.min(emitterSize.x, emitterSize.z) * .22);
    const bulbGeometry = new THREE.SphereGeometry(bulbRadius, 20, 12);
    const bulb = new THREE.Mesh(bulbGeometry, new THREE.MeshBasicMaterial({ color: 0xfff1cf, toneMapped: false, side: THREE.DoubleSide }));
    bulb.position.copy(origin);
    this.scene.add(bulb);
    const spot = new THREE.SpotLight(WARM, 0, roomSize.length() * (kind === "floor" ? 1.05 : .78), kind === "drawing" ? .72 : kind === "floor" ? .96 : .84, .76, 1.35);
    spot.position.copy(origin);
    let target = origin.clone().add(new THREE.Vector3(0, kind === "desk" ? -.28 : -roomSize.y * .48, 0));
    if (kind === "floor") target.y = .045;
    if (kind === "drawing") {
      const paper = room.getObjectByName("GEO-v62-DraftingBoard-Paper_Placeholder");
      if (paper) target = new THREE.Box3().setFromObject(paper).getCenter(new THREE.Vector3());
    }
    spot.target.position.copy(target);
    spot.castShadow = kind !== "drawing";
    spot.shadow.mapSize.set(768, 768);
    spot.shadow.bias = -.00015;
    const halo = new THREE.PointLight(WARM, 0, roomSize.length() * .42, 1.65);
    halo.position.copy(origin);
    this.scene.add(spot, spot.target, halo);
    this.rig.lamps[kind] = { group, bulb, spot, halo };
  }

  addScreenLight(screen) {
    const frame = screen.frame;
    const light = new THREE.PointLight(0xd9f0e0, 0, Math.max(frame.width, frame.height) * 2.4, 2.1);
    light.position.copy(frame.center).addScaledVector(frame.normal, .05);
    this.scene.add(light);
    this.rig.screenLights[screen.kind] = light;
  }

  addWindowPatches(room, roomBounds) {
    const windowMesh = room.getObjectByName("ARCH_WindowGlass");
    if (!windowMesh?.isMesh) return;
    windowMesh.geometry.computeBoundingBox();
    const frame = surfaceFrame(windowMesh, windowMesh.geometry.boundingBox.clone());
    if (!frame) return;
    const floor = room.getObjectByName("ARCH_Floor");
    const rug = room.getObjectByName("GEO-v57-Rug_OverTheEdgeLoftyApple");
    const floorTop = floor ? new THREE.Box3().setFromObject(floor).max.y : roomBounds.min.y;
    const rugTop = rug ? new THREE.Box3().setFromObject(rug).max.y : floorTop;
    const floorY = Math.max(floorTop, rugTop) + .004;
    const roomCenter = roomBounds.getCenter(new THREE.Vector3());
    const inward = roomCenter.clone().sub(frame.center).setY(0).normalize();
    const roomSize = roomBounds.getSize(new THREE.Vector3());
    this.rig.sun.position.copy(frame.center)
      .addScaledVector(inward, -roomSize.length() * 1.15)
      .add(new THREE.Vector3(0, roomSize.y * .72, 0));
    this.rig.sun.target.position.copy(frame.center)
      .addScaledVector(inward, roomSize.length() * .36)
      .setY(floorY);
    this.rig.sun.target.updateMatrixWorld();
    const cookie = archCookie();
    const wallGap = frame.height * .18;
    const makePatch = (inside) => {
      const direction = inward.clone().multiplyScalar(inside ? 1 : -1);
      const opening = projectedOpeningGeometry(windowMesh, frame, direction, floorY, wallGap);
      if (!opening) return null;
      const group = new THREE.Group();
      group.name = inside ? "RUNTIME_WINDOW_SILHOUETTE_DAY" : "RUNTIME_WINDOW_SILHOUETTE_NIGHT";
      const glow = new THREE.Mesh(opening.geometry.clone(), patchMaterial(inside ? 0xffedb0 : 0xffc978, cookie));
      group.add(glow);
      glow.rotation.set(0, 0, 0);
      glow.renderOrder = 11;
      this.scene.add(group);
      return { group, glow };
    };
    this.rig.dayPatch = makePatch(true);
    this.rig.nightPatch = makePatch(false);
  }

  setLamp(kind, value = !this.lampState[kind]) {
    this.lampState[kind] = value;
    this.lampTransitions[kind] = { from: this.lampBlend[kind] ?? 0, to: value ? 1 : 0, elapsed: 0 };
    return value;
  }

  setR7Polish(enabled) { this.r7Polish = Boolean(enabled); }

  lampTargets(kind) {
    const enabled = this.lampBlend[kind] ?? (this.lampState[kind] ? 1 : 0);
    const daylightFactor = THREE.MathUtils.lerp(1, .18, this.modeBlend);
    return {
      spot: enabled * daylightFactor * (kind === "floor" ? 120 : kind === "drawing" ? 20 : 18),
      halo: enabled * daylightFactor * (kind === "floor" ? 3 : kind === "drawing" ? .7 : .8),
      bulb: enabled * THREE.MathUtils.lerp(1, .62, this.modeBlend),
    };
  }

  setMode(mode, immediate = false) {
    this.mode = mode;
    if (immediate) {
      this.modeBlend = mode === "day" ? 1 : 0;
      this.modeTransition = null;
      this.applyEnvironment();
      this.applyLampTargets();
    } else {
      this.modeTransition = { from: this.modeBlend, to: mode === "day" ? 1 : 0, elapsed: 0 };
    }
  }

  applyEnvironment() {
    const day = this.modeBlend;
    this.rig.sun.intensity = THREE.MathUtils.lerp(0, 2, day);
    this.rig.hemi.intensity = THREE.MathUtils.lerp(.018, this.r7Polish ? .12 : .16, day);
    this.rig.ambient.intensity = THREE.MathUtils.lerp(.008, this.r7Polish ? .014 : .02, day);
    this.rig.nightFill.intensity = THREE.MathUtils.lerp(this.r7Polish ? .09 : .12, 0, day);
    this.scene.environmentIntensity = THREE.MathUtils.lerp(this.r7Polish ? .05 : .055, this.r7Polish ? .28 : .32, day);
    Object.values(this.rig.screenLights).forEach((light) => { light.intensity = THREE.MathUtils.lerp(.18, .02, day); });
    if (this.rig.dayPatch) this.rig.dayPatch.glow.material.opacity = .68 * day;
    if (this.rig.nightPatch) this.rig.nightPatch.glow.material.opacity = .78 * (1 - day);
    this.renderer.toneMappingExposure = THREE.MathUtils.lerp(.78, .92, day);
    this.nightFog.density = THREE.MathUtils.lerp(.018, 0, day);
    this.scene.fog = this.nightFog;
  }

  applyLampTargets() {
    Object.entries(this.rig.lamps).forEach(([kind, lamp]) => {
      const target = this.lampTargets(kind);
      lamp.spot.intensity = target.spot;
      lamp.halo.intensity = target.halo;
      lamp.bulb.material.transparent = true;
      lamp.bulb.material.opacity = target.bulb;
      lamp.bulb.visible = target.bulb > .01;
    });
  }

  update(delta) {
    if (this.modeTransition) {
      this.modeTransition.elapsed += Math.max(delta, 0) * 1000;
      const raw = Math.min(1, this.modeTransition.elapsed / this.modeTransitionDuration);
      const eased = raw * raw * (3 - 2 * raw);
      this.modeBlend = THREE.MathUtils.lerp(this.modeTransition.from, this.modeTransition.to, eased);
      if (raw === 1) this.modeTransition = null;
    }
    Object.entries(this.lampTransitions).forEach(([kind, transition]) => {
      transition.elapsed += Math.max(delta, 0) * 1000;
      const raw = Math.min(1, transition.elapsed / this.lampTransitionDuration);
      const eased = raw * raw * (3 - 2 * raw);
      this.lampBlend[kind] = THREE.MathUtils.lerp(transition.from, transition.to, eased);
      if (raw === 1) delete this.lampTransitions[kind];
    });
    this.applyEnvironment();
    this.applyLampTargets();
  }
}
