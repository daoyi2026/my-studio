import * as THREE from "three";
import { CAMERA } from "../config.js?v=8";
import { fitDistance, frameExtents, poseForBox, surfaceFrame } from "../utils/geometry.js";

const ease = (t) => t * t * t * (t * (t * 6 - 15) + 10);

function finiteVector(vector) {
  return vector && [vector.x, vector.y, vector.z].every(Number.isFinite);
}

export class CameraDirector extends EventTarget {
  constructor(perspectiveCamera, orthographicCamera, controls, onCameraChange = null) {
    super();
    this.perspectiveCamera = perspectiveCamera;
    this.orthographicCamera = orthographicCamera;
    this.camera = perspectiveCamera;
    this.controls = controls;
    this.onCameraChange = onCameraChange;
    this.aspect = perspectiveCamera.aspect;
    this.orthographicHalfHeight = 1;
    this.level = "global";
    this.region = null;
    this.active = null;
    this.home = null;
    this.currentPose = null;
    this.regionPose = null;
    this.tween = null;
    this.projectionTween = null;
    this.lastInput = performance.now();
    this.idlePhase = 0;
  }

  configure(roomBounds, roomCenter) {
    this.roomBounds = roomBounds.clone();
    this.roomCenter = roomCenter.clone();
    const direction = new THREE.Vector3(4.4, 3.45, 5.5).normalize();
    const extents = frameExtents(roomBounds, direction, new THREE.Vector3(0,1,0));
    const distance = fitDistance(this.perspectiveCamera, extents.width, extents.height, extents.depth, CAMERA.globalFov, CAMERA.globalFill);
    const orthographicHalfHeight = Math.max(
      extents.height / (2 * CAMERA.globalFill),
      extents.width / (2 * this.aspect * CAMERA.globalFill),
    );
    const target = roomCenter.clone().add(new THREE.Vector3(0, extents.height * .025, 0));
    const roomDiagonal = roomBounds.getSize(new THREE.Vector3()).length();
    this.globalNear = Math.max(.012, roomDiagonal / 400);
    this.focusNear = Math.max(.00035, roomDiagonal / 12000);
    this.home = { position: target.clone().addScaledVector(direction, distance), target, up: new THREE.Vector3(0,1,0), fov: CAMERA.globalFov, near: this.globalNear, projection: "orthographic", orthographicHalfHeight, label: "全局轴测视角" };
    this.homeDistance = distance;
    this.perspectiveCamera.near = this.globalNear;
    this.perspectiveCamera.far = roomDiagonal * 12;
    this.orthographicCamera.near = this.globalNear;
    this.orthographicCamera.far = roomDiagonal * 12;
    this.apply(this.home);
    // Global framing used to impose a large minimum orbit distance. OrbitControls
    // re-applies that limit at the end of every tween, which made close-ups snap
    // straight back to the room view. Keep the limits scene-relative instead.
    this.controls.minDistance = this.focusNear * 1.5;
    this.controls.maxDistance = distance * 1.8;
    this.controls.minZoom = 1;
    this.controls.target.copy(target);
    this.configureControlEnvelope("global", this.home);
    this.controls.update();
    this.controls.addEventListener("start", () => this.noteInput());
  }

  updateOrthographicProjection(halfHeight = this.orthographicHalfHeight) {
    this.orthographicHalfHeight = halfHeight;
    const camera = this.orthographicCamera;
    camera.left = -halfHeight * this.aspect;
    camera.right = halfHeight * this.aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.zoom = 1;
    camera.updateProjectionMatrix();
  }

  activateCamera(projection, { matchView = false } = {}) {
    const next = projection === "orthographic" ? this.orthographicCamera : this.perspectiveCamera;
    if (next === this.camera) return;
    const previous = this.camera;
    next.position.copy(previous.position);
    next.quaternion.copy(previous.quaternion);
    next.up.copy(previous.up);
    next.near = previous.near;
    next.far = previous.far;
    if (matchView && next.isPerspectiveCamera && previous.isOrthographicCamera) {
      next.fov = CAMERA.localFov;
      const direction = previous.position.clone().sub(this.controls.target).normalize();
      const distance = this.orthographicHalfHeight / Math.tan(THREE.MathUtils.degToRad(next.fov) * .5);
      next.position.copy(this.controls.target).addScaledVector(direction, distance);
    } else if (matchView && next.isOrthographicCamera && previous.isPerspectiveCamera) {
      const distance = previous.position.distanceTo(this.controls.target);
      this.updateOrthographicProjection(distance * Math.tan(THREE.MathUtils.degToRad(previous.fov) * .5));
    }
    this.camera = next;
    this.controls.object = next;
    this.onCameraChange?.(next);
  }

  setAspect(aspect) {
    this.aspect = aspect;
    this.perspectiveCamera.aspect = aspect;
    this.perspectiveCamera.updateProjectionMatrix();
    this.orthographicCamera.aspect = aspect;
    this.updateOrthographicProjection();
  }

  apply(pose) {
    this.activateCamera(pose.projection || "perspective", { matchView: true });
    this.camera.position.copy(pose.position);
    this.camera.up.copy(pose.up);
    if (this.camera.isPerspectiveCamera) this.camera.fov = pose.fov;
    if (this.camera.isOrthographicCamera && pose.orthographicHalfHeight) this.updateOrthographicProjection(pose.orthographicHalfHeight);
    if (pose.near) this.camera.near = pose.near;
    this.camera.lookAt(pose.target);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(pose.target);
    this.currentPose = pose;
  }

  transition(pose, { level = this.level, region = this.region, duration = 1250 } = {}) {
    if (!this.isValidPose(pose)) {
      console.warn(`[camera] Ignored invalid ${pose?.label || "focus"} pose`);
      return false;
    }
    this.projectionTween = null;
    this.noteInput();
    if (this.camera.isOrthographicCamera && (pose.projection || "perspective") === "perspective") {
      this.beginHybridDolly(pose, { level, region, duration });
      return true;
    }
    this.activateCamera(pose.projection || "perspective", { matchView: true });
    this.tween = {
      start: performance.now(), duration,
      from: { position: this.camera.position.clone(), target: this.controls.target.clone(), up: this.camera.up.clone(), fov: this.camera.fov, near: this.camera.near, orthographicHalfHeight: this.orthographicHalfHeight },
      to: pose,
    };
    this.level = level;
    this.region = region;
    this.controls.enabled = false;
    this.dispatchEvent(new CustomEvent("viewchange", { detail: { level, region, label: pose.label } }));
    return true;
  }

  isValidPose(pose) {
    if (!pose || !finiteVector(pose.position) || !finiteVector(pose.target) || !finiteVector(pose.up)) return false;
    if (![pose.fov, pose.near].filter((value) => value != null).every((value) => Number.isFinite(value) && value > 0)) return false;
    const view = pose.target.clone().sub(pose.position);
    if (view.lengthSq() <= 1e-12 || pose.up.lengthSq() <= 1e-12) return false;
    return Math.abs(view.normalize().dot(pose.up.clone().normalize())) < .9999;
  }

  beginHybridDolly(pose, { level, region, duration }) {
    const source = this.camera;
    const from = { position: source.position.clone(), target: this.controls.target.clone(), up: source.up.clone(), near: source.near, orthographicHalfHeight: this.orthographicHalfHeight };
    const phase = .26;
    const finalFov = pose.fov ?? CAMERA.localFov;
    const finalVisibleHalfHeight = pose.position.distanceTo(pose.target) * Math.tan(THREE.MathUtils.degToRad(finalFov) * .5);
    this.projectionTween = {
      start: performance.now(), duration, from, to: pose, hybrid: true, phase,
      finalVisibleHalfHeight,
      switched: false,
    };
    this.level = level;
    this.region = region;
    this.controls.enabled = false;
    this.dispatchEvent(new CustomEvent("viewchange", { detail: { level, region, label: pose.label } }));
  }

  goGlobal(options = {}) {
    if (!this.home) return;
    this.active = null;
    this.regionPose = null;
    this.transition(this.home, { level: "global", region: null, duration: options.duration ?? 1350 });
  }

  createRegionPose(box, normal, label) {
    const pose = poseForBox(this.perspectiveCamera, box, normal, CAMERA.localFov, CAMERA.localFill, label);
    pose.near = Math.max(this.focusNear * 3, Math.min(this.globalNear, pose.position.distanceTo(pose.target) / 80));
    pose.projection = "perspective";
    return pose;
  }

  setRegionContext(pose, region) {
    this.regionPose = pose;
    this.region = region;
  }

  goRegion(box, normal, label, region) {
    const pose = this.createRegionPose(box, normal, label);
    this.active = null;
    this.setRegionContext(pose, region);
    this.transition(pose, { level: "local", region, duration: 1250 });
    return pose;
  }

  goObject(object, label, options = {}) {
    const box = options.box?.clone() || new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) {
      console.warn(`[camera] Ignored empty ${label || object?.name || "object"} focus bounds`);
      return false;
    }
    const center = box.getCenter(new THREE.Vector3());
    const normal = options.normal?.clone() || this.camera.position.clone().sub(center).setY(options.keepElevation ? this.camera.position.y - center.y : 0).normalize();
    if (normal.lengthSq() < .001) normal.set(0, 0, 1);
    const pose = poseForBox(this.perspectiveCamera, box, normal, options.fov ?? CAMERA.interactionFov, options.fill ?? CAMERA.interactionFill, label, options.up || new THREE.Vector3(0,1,0));
    pose.near = Math.max(this.focusNear, Math.min(this.globalNear, pose.position.distanceTo(pose.target) / 100));
    pose.projection = "perspective";
    const transitioned = this.transition(pose, { level: "interaction", region: this.region, duration: options.duration ?? 1050 });
    if (transitioned) this.active = object;
    return transitioned;
  }

  goSurface(mesh, localBox, label, frameOverride = null) {
    const frame = frameOverride || surfaceFrame(mesh, localBox, this.camera.position);
    if (!frame) return this.goObject(mesh, label);
    const distance = fitDistance(this.perspectiveCamera, frame.width, frame.height, Math.min(frame.width, frame.height) * .02, CAMERA.interactionFov, CAMERA.interactionFill);
    const pose = {
      position: frame.center.clone().addScaledVector(frame.normal, Math.max(distance, this.focusNear * 2)),
      target: frame.center.clone(),
      up: frame.up,
      fov: CAMERA.interactionFov,
      // A very small near plane amplifies depth precision loss while the
      // screen and room geometry fill the viewport. Keep the screen focus
      // close enough for the bezel, but large enough to prevent striped wall
      // and model artifacts during the dolly.
      near: Math.max(this.focusNear * 3, Math.min(this.globalNear, distance / 120)),
      projection: "perspective",
      label,
    };
    this.active = mesh;
    this.transition(pose, { level: "interaction", region: this.region, duration: 1150 });
  }

  goDrawingBoard(paper, window, label = "画板 · 绘画作品") {
    const box = new THREE.Box3().setFromObject(paper);
    const center = box.getCenter(new THREE.Vector3());
    const frame = surfaceFrame(paper, paper.geometry?.boundingBox || null, this.camera.position);
    const normal = frame?.normal?.clone() || new THREE.Vector3(0, 1, 0);
    const windowCenter = window ? new THREE.Box3().setFromObject(window).getCenter(new THREE.Vector3()) : center.clone().add(new THREE.Vector3(0, 0, 1));
    const towardWindow = windowCenter.sub(center).projectOnPlane(normal);
    if (towardWindow.lengthSq() < .0001) towardWindow.set(0, 0, 1);
    towardWindow.normalize();
    const viewNormal = normal;
    const size = box.getSize(new THREE.Vector3());
    const distance = fitDistance(this.perspectiveCamera, Math.max(size.x, size.z), Math.max(size.x, size.z), size.y, CAMERA.interactionFov, .9);
    // Keep the second stage optically perpendicular to the paper, but offset
    // the look point within its surface so the physical lamp does not sit in
    // the camera-to-paper ray.
    const target = center.clone().addScaledVector(towardWindow, Math.min(size.x, size.z) * .28);
    const pose = {
      position: target.clone().addScaledVector(viewNormal, Math.max(distance, this.focusNear * 4)),
      target,
      // Keep the direct focus normal to the paper and preserve the accepted R3
      // clockwise orientation. The lamp parts are hidden before this tween.
      up: frame?.right?.clone().negate() || new THREE.Vector3(-1, 0, 0),
      fov: CAMERA.interactionFov,
      near: this.focusNear,
      projection: "perspective",
      label: `${label} · 俯视`,
    };
    this.active = paper;
    this.transition(pose, { level: "interaction", region: "drawing", duration: 1050 });
  }

  exitInteraction(regionPose = this.regionPose, duration = 950) {
    if (this.level !== "interaction") return;
    this.active = null;
    if (regionPose) this.transition(regionPose, { level: "local", region: this.region, duration });
    else this.goGlobal();
  }

  noteInput() { this.lastInput = performance.now(); }

  enterPerspectiveFromGlobal(wheelDelta = 0) {
    if (this.level !== "global" || !this.camera.isOrthographicCamera || this.tween || this.projectionTween) return false;
    const sourceCamera = this.camera;
    const direction = sourceCamera.position.clone().sub(this.controls.target).normalize();
    const matchedDistance = this.orthographicHalfHeight / Math.tan(THREE.MathUtils.degToRad(CAMERA.localFov) * .5);
    const zoomFactor = Math.exp(THREE.MathUtils.clamp(wheelDelta, -140, 140) * .00135);
    const targetDistance = THREE.MathUtils.clamp(matchedDistance * zoomFactor, this.controls.minDistance, this.globalPerspectiveDistance());
    const toPosition = this.controls.target.clone().addScaledVector(direction, targetDistance);

    const pose = { position: toPosition, target: this.controls.target.clone(), up: sourceCamera.up.clone(), fov: CAMERA.localFov, near: sourceCamera.near, projection: "perspective", label: "Global perspective" };
    this.beginHybridDolly(pose, { level: "global", region: null, duration: 780 });
    return true;
  }

  configureControlEnvelope(level, pose = this.currentPose || this.home) {
    if (!pose) return;
    const direction = pose.position.clone().sub(pose.target);
    const spherical = new THREE.Spherical().setFromVector3(direction);
    const horizontal = THREE.MathUtils.degToRad(CAMERA.horizontalLimit);
    const upward = THREE.MathUtils.degToRad(CAMERA.globalUpwardLimit);
    const downward = THREE.MathUtils.degToRad(CAMERA.globalDownwardLimit);
    this.controls.minAzimuthAngle = spherical.theta - horizontal;
    this.controls.maxAzimuthAngle = spherical.theta + horizontal;
    this.controls.minPolarAngle = Math.max(.03, spherical.phi - upward);
    this.controls.maxPolarAngle = Math.min(Math.PI - .03, spherical.phi + downward);
    this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.controls.maxDistance = level === "global" ? this.globalPerspectiveDistance() : this.homeDistance * 1.8;
    const interactive = level === "interaction";
    this.controls.enableRotate = !interactive;
    this.controls.enablePan = !interactive;
    this.controls.enableZoom = !interactive;
  }

  globalPerspectiveDistance() {
    return this.orthographicHalfHeight / Math.tan(THREE.MathUtils.degToRad(CAMERA.localFov) * .5);
  }

  ensureControlState() {
    if (this.tween || this.projectionTween) return;
    const interactive = this.level === "interaction";
    this.controls.enabled = !interactive;
    this.controls.enableRotate = !interactive;
    this.controls.enablePan = !interactive;
    this.controls.enableZoom = !interactive;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  }

  updateGlobalLens() {
    if (this.level !== "global" || this.tween || !this.camera.isPerspectiveCamera) return;
    if (Math.abs(this.camera.fov - CAMERA.localFov) < .005) return;
    this.camera.fov = CAMERA.localFov;
    this.camera.updateProjectionMatrix();
  }

  update(now) {
    if (this.projectionTween) {
      const raw = Math.min(1, (now - this.projectionTween.start) / this.projectionTween.duration);
      const tween = this.projectionTween;
      // Use one easing curve for the entire move. The previous implementation
      // eased both sides of the projection handoff independently, forcing the
      // camera to stop and restart at `phase` even when rendering stayed fast.
      const t = ease(raw);
      const visibleHalfHeight = THREE.MathUtils.lerp(tween.from.orthographicHalfHeight, tween.finalVisibleHalfHeight, t);
      this.camera.position.lerpVectors(tween.from.position, tween.to.position, t);
      this.controls.target.lerpVectors(tween.from.target, tween.to.target, t);
      this.camera.up.lerpVectors(tween.from.up, tween.to.up || tween.from.up, t).normalize();
      this.camera.near = THREE.MathUtils.lerp(tween.from.near, tween.to.near ?? tween.from.near, t);
      this.camera.lookAt(this.controls.target);

      if (!tween.switched && raw < tween.phase) {
        this.updateOrthographicProjection(visibleHalfHeight);
      } else {
        if (!tween.switched) {
          // Match the perspective lens to the orthographic view height at the
          // exact handoff frame so the projection changes without a scale pop.
          this.updateOrthographicProjection(visibleHalfHeight);
          this.activateCamera("perspective");
          tween.switched = true;
        }
        const radius = Math.max(1e-6, this.camera.position.distanceTo(this.controls.target));
        this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(visibleHalfHeight / radius));
        this.camera.lookAt(this.controls.target);
        this.camera.updateProjectionMatrix();
      }
      if (raw === 1) {
        this.camera.position.copy(tween.to.position);
        this.controls.target.copy(tween.to.target);
        this.camera.up.copy(tween.to.up || this.camera.up);
        this.camera.near = tween.to.near ?? this.camera.near;
        this.camera.fov = tween.to.fov ?? CAMERA.localFov;
        this.camera.updateProjectionMatrix();
        this.currentPose = tween.to;
        this.projectionTween = null;
        this.configureControlEnvelope(this.level, this.currentPose);
        this.controls.enabled = true;
        this.controls.update();
      }
      return;
    }
    if (this.tween) {
      const raw = Math.min(1, (now - this.tween.start) / this.tween.duration);
      const t = ease(raw);
      this.camera.position.lerpVectors(this.tween.from.position, this.tween.to.position, t);
      this.controls.target.lerpVectors(this.tween.from.target, this.tween.to.target, t);
      this.camera.up.lerpVectors(this.tween.from.up, this.tween.to.up, t).normalize();
      if (this.camera.isPerspectiveCamera) this.camera.fov = THREE.MathUtils.lerp(this.tween.from.fov, this.tween.to.fov, t);
      if (this.camera.isOrthographicCamera) {
        this.updateOrthographicProjection(THREE.MathUtils.lerp(
          this.tween.from.orthographicHalfHeight,
          this.tween.to.orthographicHalfHeight || this.tween.from.orthographicHalfHeight,
          t,
        ));
      }
      this.camera.near = THREE.MathUtils.lerp(this.tween.from.near ?? this.globalNear, this.tween.to.near ?? this.globalNear, t);
      this.camera.lookAt(this.controls.target);
      this.camera.updateProjectionMatrix();
      if (raw === 1) {
        this.currentPose = this.tween.to;
        this.tween = null;
        this.configureControlEnvelope(this.level, this.currentPose);
        this.controls.enabled = this.level !== "interaction";
        if (this.controls.enabled) this.controls.update();
      }
      return;
    }
    this.updateGlobalLens();
  }
}
