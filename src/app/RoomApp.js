import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CAMERA, CONTENT, MODEL_URL, PHOTO_BINDINGS, REGION_PATTERNS } from "../config.js?v=14";
import { loadRoom, configureRoomMaterials, boxForPatterns } from "../assets/loadRoom.js?v=12";
import { applyPhotos } from "../assets/applyPhotos.js?v=11";
import { CameraDirector } from "../camera/CameraDirector.js?v=15";
import { ScreenLayer } from "../rendering/ScreenLayer.js?v=12";
import { LightDirector } from "../lighting/LightDirector.js?v=8";
import { addContactShadows } from "../lighting/ContactShadowLayer.js";
import { applyStaticOcclusionSample } from "../lighting/StaticOcclusionSample.js?v=2";
import { InteractionDirector } from "../interaction/InteractionDirector.js?v=19";
import { IntroLoader } from "../intro/IntroLoader.js?v=6";
import { Cursor } from "../ui/Cursor.js?v=4";
import { surfaceFrame } from "../utils/geometry.js";
import { AWARDS, BOOKS, PLAYLIST } from "../content/roomContent.js?v=4";

const INTRO_LINE_ART_URL = "./public/assets/intro/room-line-art-native-grouped-v14-sketch-v5.svg?rev=production-clean-wall-v5";

export class RoomApp {
  constructor() {
    this.root = document.querySelector("#app");
    this.webglHost = document.querySelector("#webgl-layer");
    this.screenHost = document.querySelector("#screen-layer");
    this.loading = new IntroLoader(document.querySelector("#loader"), {
      lineArtUrl: INTRO_LINE_ART_URL,
    });
    this.cursor = new Cursor();
    this.clock = new THREE.Clock();
    this.pointerTime = performance.now();
    this.mode = "night";
    this.firstOrdinaryClickPending = false;
    this.panel = document.querySelector("#interaction-panel");
    this.panelContent = this.panel.querySelector(".panel-content");
    this.musicIndex = 0;
    this.musicPlaying = false;
    this.musicElapsed = 0;
    this.musicDuration = 0;
    this.musicAudio = null;
    this.bookIndex = 0;
    this.idlePixelRatio = Math.min(devicePixelRatio, 1.25);

    this.scene = new THREE.Scene();
    this.perspectiveCamera = new THREE.PerspectiveCamera(13.5, innerWidth / innerHeight, .02, 100);
    this.orthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, .02, 100);
    this.camera = this.perspectiveCamera;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(this.idlePixelRatio);
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.webglHost.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .07;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.zoomSpeed = CAMERA.zoomSpeed;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    this.controls.touches.ONE = THREE.TOUCH.ROTATE;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    this.cameraDirector = new CameraDirector(
      this.perspectiveCamera,
      this.orthographicCamera,
      this.controls,
      (camera) => this.setActiveCamera(camera),
    );
    this.screens = new ScreenLayer(this.screenHost, this.camera, this.scene);
    this.lights = new LightDirector(this.scene, this.renderer);

    addEventListener("resize", () => this.resize());
    addEventListener("pointermove", () => this.cameraDirector.noteInput(), { passive: true });
    this.renderer.domElement.addEventListener("wheel", (event) => {
      const transitioning = this.cameraDirector.enterPerspectiveFromGlobal(event.deltaY);
      if (transitioning) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      this.cameraDirector.noteInput();
    }, { passive: false, capture: true });
    this.bindUI();
  }

  setActiveCamera(camera) {
    this.camera = camera;
    this.screens?.setCamera(camera);
    if (this.interactions) this.interactions.camera = camera;
  }

  async start() {
    const introRun = this.loading.start(INTRO_LINE_ART_URL);
    introRun.catch((error) => this.loading.fail(error));
    try {
      this.loading.updateLoadProgress(3, "CHECKING ROOM");
      this.room = await loadRoom(MODEL_URL, (ratio) => this.loading.updateLoadProgress(5 + ratio * 67, "ORGANIZING ROOM"));
      this.room.name = "MYROOM_V64_WEB";
      configureRoomMaterials(this.room, this.renderer);
      this.lightingSample = await applyStaticOcclusionSample(this.room, MODEL_URL);
      this.root.dataset.lightingSample = this.lightingSample.status;
      this.lights.setR7Polish(this.lightingSample.status === "applied");
      this.scene.add(this.room);
      this.loading.updateLoadProgress(74, "ORGANIZING DESK");
      this.photoReport = await applyPhotos(this.room, PHOTO_BINDINGS, this.renderer, (ratio) => this.loading.updateLoadProgress(74 + ratio * 14, "PLACING PHOTOS"));
      this.root.dataset.photoCount = String(this.photoReport.applied.length);
      if (this.photoReport.missing.length) this.root.dataset.photoMissing = this.photoReport.missing.join("|");
      this.configureScene();
      this.loading.updateLoadProgress(92, "PREPARING SCENE");
      await this.warmFrames(({ progress, status }) => this.loading.updateLoadProgress(progress, status));
      // The room is predominantly static. Keep the generated shadow maps and
      // refresh them only when day/night or a practical light changes.
      this.renderer.shadowMap.autoUpdate = false;
      this.loading.updateLoadProgress(100, "ROOM READY");
      // The room deliberately opens at night. The first ordinary page click
      // then reveals daytime once; the explicit mode toggle retains its own
      // repeatable behavior and is excluded below.
      this.firstOrdinaryClickPending = true;
      this.animate();
      this.loading.markSceneReady({ warmup: "compileAsync+render" });
      await this.loading.revealWhenReady();
    } catch (error) {
      console.error(error);
      this.loading.fail(error);
      this.root.dataset.error = "true";
    }
  }

  configureScene() {
    this.room.updateMatrixWorld(true);
    this.roomBounds = new THREE.Box3().setFromObject(this.room);
    this.roomCenter = this.roomBounds.getCenter(new THREE.Vector3());
    this.cameraDirector.configure(this.roomBounds, this.roomCenter);
    this.regionBoxes = {
      desk: boxForPatterns(this.room, REGION_PATTERNS.desk, this.roomBounds),
      drawing: boxForPatterns(this.room, REGION_PATTERNS.drawing, this.roomBounds),
      shelf: boxForPatterns(this.room, REGION_PATTERNS.shelf, this.roomBounds),
    };
    this.regionBoxes.desk.min.y = Math.max(this.regionBoxes.desk.min.y, .46);
    this.configureShelfLevels();
    this.lights.configure(this.room, this.roomBounds);
    this.contactShadows = addContactShadows(this.scene, this.room);
    if (this.lightingSample.status === "applied") {
      this.lightingSample.suppressedContactNames.forEach((name) => {
        const contact = this.contactShadows.getObjectByName(name);
        if (contact) contact.visible = false;
      });
    }
    this.screens.configure(this.room);
    Object.values(this.screens.screens).forEach((screen) => this.lights.addScreenLight(screen));
    this.updateLightButtons();
    this.configureMotion();
    this.configureArtwork();
    this.interactions = new InteractionDirector({
      camera: this.camera,
      canvas: this.renderer.domElement,
      room: this.room,
      cameraDirector: this.cameraDirector,
      regionBoxes: this.regionBoxes,
      screens: this.screens,
      onLight: (kind) => this.toggleLight(kind),
      onPortal: (rule, object) => this.openGalaxy(rule, object),
      onPanel: (kind, rule) => this.showPanel(kind, rule),
      onHover: (active) => this.cursor.setAction(active),
    });
    this.screens.addEventListener("outsideclick", () => this.interactions.exitActive());
    this.cameraDirector.addEventListener("viewchange", (event) => this.updateViewUI(event.detail));
    this.resize();
  }

  configureShelfLevels() {
    const tiers = [];
    for (let i = 1; i <= 6; i += 1) {
      const object = this.room.getObjectByName(`GEO-v47-Shelf_Tier_${String(i).padStart(2, "0")}`);
      if (object) tiers.push({ y: new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3()).y, object });
    }
    tiers.sort((a, b) => a.y - b.y);
    const levels = {};
    for (let level = 1; level <= 5; level += 1) {
      const minY = tiers[level - 1]?.y ?? this.regionBoxes.shelf.min.y;
      const maxY = tiers[level]?.y ?? this.regionBoxes.shelf.max.y;
      const box = new THREE.Box3();
      this.room.traverse((object) => {
        if (!object.isMesh || !REGION_PATTERNS.shelf.some((pattern) => pattern.test(object.name || ""))) return;
        const objectBox = new THREE.Box3().setFromObject(object);
        const y = objectBox.getCenter(new THREE.Vector3()).y;
        if (y >= minY - .03 && y <= maxY + .03) box.union(objectBox);
      });
      if (!box.isEmpty()) levels[level] = box;
    }
    this.regionBoxes.shelfTiers = tiers;
    this.regionBoxes.shelfLevels = levels;
  }

  configureMotion() {
    // The chair base stays planted; only the seat/back/arm assembly turns.
    this.chair = this.room.getObjectByName("REPL-v63-chair-002");
    if (this.chair) this.chairBaseRotation = this.chair.rotation.y;
    this.pencil = this.room.getObjectByName("GEO-v58-Notebook_PencilBody");
    if (this.pencil) {
      this.pencilBase = { position: this.pencil.position.clone(), rotation: this.pencil.rotation.clone() };
    }
    const cup = this.room.getObjectByName("ASSET-v61-ClayCup-Anchor") || this.room.getObjectByName("ASSET-v61-ClayCup-Clay cup");
    if (cup) this.createSteam(cup);
  }

  createSteam(cup) {
    const box = new THREE.Box3().setFromObject(cup);
    const center = box.getCenter(new THREE.Vector3());
    const height = box.getSize(new THREE.Vector3()).y;
    const count = 58;
    const positions = new Float32Array(count * 3);
    const seeds = [];
    for (let i = 0; i < count; i += 1) {
      const seed = Math.random(); seeds.push(seed);
      positions[i * 3] = center.x + (Math.random() - .5) * height * .2;
      positions[i * 3 + 1] = box.max.y + seed * height * 1.3;
      positions[i * 3 + 2] = center.z + (Math.random() - .5) * height * .2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0xfffdf3, size: height * .16, transparent: true, opacity: .34, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    this.steam = { points: new THREE.Points(geometry, material), center, height, seeds };
    this.scene.add(this.steam.points);
  }

  configureArtwork() {
    this.drawingPaper = this.room.getObjectByName("GEO-v62-DraftingBoard-Paper_Placeholder");
    this.drawingPaper?.traverse((object) => {
      if (!object.isMesh || object.geometry.getAttribute("uv")) return;
      object.geometry = object.geometry.clone();
      object.geometry.computeBoundingBox();
      const { min, max } = object.geometry.boundingBox;
      const position = object.geometry.getAttribute("position");
      const uv = new Float32Array(position.count * 2);
      const width = Math.max(1e-6, max.x - min.x);
      const height = Math.max(1e-6, max.z - min.z);
      for (let index = 0; index < position.count; index += 1) {
        uv[index * 2] = (position.getX(index) - min.x) / width;
        uv[index * 2 + 1] = (position.getZ(index) - min.z) / height;
      }
      object.geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    });
    this.artworkLoader = new THREE.TextureLoader();
    this.artworkUrls = Array.from(
      { length: 27 },
      (_, index) => `./public/assets/portfolio/portfolio-${String(index).padStart(2, "0")}.png`,
    );
    this.artworkTextureRecords = new Map();
    this.artworkRequestToken = 0;
    this.artworkIndex = 0;
    this.setArtwork(0);
  }

  setArtwork(index) {
    if (!this.drawingPaper || !this.artworkUrls?.length) return;
    this.artworkIndex = (index + this.artworkUrls.length) % this.artworkUrls.length;
    const requestedIndex = this.artworkIndex;
    const token = ++this.artworkRequestToken;
    const record = this.getArtworkTextureRecord(requestedIndex);
    const applyRequestedTexture = () => {
      if (token !== this.artworkRequestToken || requestedIndex !== this.artworkIndex) return;
      this.applyArtworkTexture(record.texture);
      this.pruneArtworkTextureCache();
    };
    if (record.ready) applyRequestedTexture();
    else record.callbacks.push(applyRequestedTexture);

    this.getArtworkTextureRecord((requestedIndex + 1) % this.artworkUrls.length);
  }

  getArtworkTextureRecord(index) {
    const cached = this.artworkTextureRecords.get(index);
    if (cached) return cached;
    const record = { texture: null, ready: false, callbacks: [] };
    const texture = this.artworkLoader.load(
      this.artworkUrls[index],
      () => {
        record.ready = true;
        record.callbacks.splice(0).forEach((callback) => callback());
        this.pruneArtworkTextureCache();
      },
      undefined,
      (error) => {
        this.artworkTextureRecords.delete(index);
        console.warn(`[portfolio] Failed to load page ${index}`, error);
      },
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    record.texture = texture;
    this.artworkTextureRecords.set(index, record);
    return record;
  }

  pruneArtworkTextureCache() {
    if (!this.artworkTextureRecords || !this.artworkUrls?.length) return;
    const count = this.artworkUrls.length;
    const keep = new Set([
      this.artworkIndex,
      (this.artworkIndex + 1) % count,
      (this.artworkIndex - 1 + count) % count,
    ]);
    this.artworkTextureRecords.forEach((record, index) => {
      if (keep.has(index) || !record.ready) return;
      record.texture.dispose();
      this.artworkTextureRecords.delete(index);
    });
  }

  applyArtworkTexture(texture) {
    this.drawingPaper.traverse((object) => {
      if (!object.isMesh) return;
      const source = Array.isArray(object.material) ? object.material : [object.material];
      const next = source.map((material) => {
        if (material.userData.portfolioPrint) {
          material.map = texture;
          material.needsUpdate = true;
          return material;
        }
        const print = new THREE.MeshBasicMaterial({
          map: texture,
          color: 0xffffff,
          side: material.side,
          toneMapped: false,
        });
        print.name = `${material.name || "DrawingPaper"}-PortfolioPrint`;
        print.userData.portfolioPrint = true;
        return print;
      });
      object.material = Array.isArray(object.material) ? next : next[0];
    });
  }

  bindUI() {
    this.modeToggle = document.querySelector("#mode-toggle");
    this.root.addEventListener("click", (event) => {
      if (!this.firstOrdinaryClickPending || event.target.closest("#mode-toggle")) return;
      this.firstOrdinaryClickPending = false;
      this.setMode("day");
    }, { capture: true });
    this.modeToggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.setMode(this.mode === "night" ? "day" : "night");
    });
    document.querySelector("#reset-view").addEventListener("click", () => { this.interactions?.exitActive(); this.cameraDirector.goGlobal(); });
    document.querySelector(".brand").addEventListener("click", (event) => { event.preventDefault(); this.interactions?.exitActive(); this.cameraDirector.goGlobal(); });
    document.querySelectorAll("[data-light]").forEach((button) => button.addEventListener("click", () => this.toggleLight(button.dataset.light)));
    const closePanel = () => this.interactions ? this.interactions.exitActive() : this.showPanel(null);
    this.panel.querySelector(".panel-close").setAttribute("aria-label", "Close panel");
    this.panel.querySelector(".panel-close").addEventListener("click", closePanel);
    this.panel.querySelector(".panel-backdrop").addEventListener("pointerdown", closePanel);
    addEventListener("keydown", (event) => { if (event.key === "Escape" && !this.panel.hidden) this.interactions?.exitActive(); });
    addEventListener("message", (event) => {
      if (event.data !== "exit-galaxy" || event.source !== this.galaxy?.contentWindow) return;
      const galaxyOrigin = new URL(CONTENT.galaxy, window.location.href).origin;
      if (event.origin !== galaxyOrigin) return;
      this.closeGalaxy();
    });
  }

  setMode(mode) {
    if (mode !== "day" && mode !== "night") return false;
    this.mode = mode;
    this.root.dataset.mode = mode;
    this.lights.setMode(mode);
    const action = mode === "night" ? "day" : "night";
    const label = action === "day" ? "Switch to day mode" : "Switch to night mode";
    this.modeToggle.dataset.action = action;
    this.modeToggle.setAttribute("aria-label", label);
    this.modeToggle.setAttribute("title", label);
    this.updateLightButtons();
    return true;
  }

  toggleLight(kind) {
    this.lights.setLamp(kind);
    this.updateLightButtons();
  }

  updateLightButtons() {
    document.querySelectorAll("[data-light]").forEach((button) => {
      const on = this.lights.lampState[button.dataset.light];
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-pressed", String(on));
    });
  }

  updateViewUI({ level }) {
    this.root.dataset.level = level;
    this.screens.setInteractive(null);
    this.showPanel(null);
    document.querySelector("#hint").textContent = level === "global" ? "Click a room area to explore · Scroll to dolly · Drag to orbit" : level === "local" ? "Click an object to focus · Scroll and drag stay in this view" : "Use the object · Click nearby to return";
  }

  showPanel(kind, rule) {
    if (!kind) {
      this.stopMusic();
      this.panel.hidden = true;
      this.panel.removeAttribute("data-kind");
      this.interactions?.resetBookMotion();
      return;
    }
    if (kind === "drawing") {
      this.setArtwork(this.artworkIndex + 1);
      this.panel.hidden = true;
      return;
    }
    if (kind === "book" && Number.isInteger(rule?.bookIndex)) this.bookIndex = rule.bookIndex;
    const templates = {
      trophy: this.trophyPanelTemplate(),
      music: this.musicPanelTemplate(),
      felt: `<div class="media-card note-compose-card"><form class="note-form"><textarea maxlength="120" placeholder="Write something…" aria-label="Note text" required></textarea><button type="submit" aria-label="Add note"><span aria-hidden="true">↵</span> add note</button></form></div><div class="note-cloud"><p class="panel-eyebrow">Pinned notes</p><div class="note-list"></div></div><div class="note-viewer" hidden><article><button type="button" class="note-viewer-close" data-note-viewer-close aria-label="Close enlarged note">×</button><p></p></article></div>`,
      frame: `<p class="panel-eyebrow">Room memory</p><h2>A photograph</h2><p>A small moment kept inside the room.</p>`,
      book: this.bookPanelTemplate(),
      notebook: `<p class="panel-eyebrow">Working notes</p><h2>Brainstorming notebook</h2><p>24/07/2024 · Gamification ideas · User profiles · New app integration.</p>`,
    };
    this.panelContent.innerHTML = templates[kind] || "";
    this.panel.dataset.kind = kind;
    this.panel.hidden = false;
    if (kind === "felt") this.bindNotes();
    if (kind === "music") this.bindMusicPanel();
    if (kind === "book") this.bindBookPanel();
  }

  musicPanelTemplate() {
    const track = PLAYLIST[this.musicIndex];
    const queue = PLAYLIST.map((item, index) => `<button type="button" class="queue-row${index === this.musicIndex ? " is-active" : ""}" data-music-index="${index}"><span>${String(index + 1).padStart(2, "0")}</span><strong>${item.title}</strong><em>${item.artist}</em><i aria-hidden="true">${index === this.musicIndex ? "▮▮▮" : ""}</i></button>`).join("");
    return `<div class="media-card now-playing"><p class="panel-eyebrow">Now playing</p><h2>${track.title}</h2><p class="music-artist">${track.artist}</p><audio class="local-audio" src="${track.audioUrl}" preload="metadata"></audio><div class="music-progress"><input type="range" min="0" max="${track.duration}" value="0" step="0.1" aria-label="Playback progress"><div><time data-current-time>00:00</time><time data-duration>${this.formatTime(track.duration)}</time></div></div><div class="music-controls"><button type="button" data-music-action="previous" aria-label="Previous track">◀</button><button type="button" class="music-play" data-music-action="toggle" aria-label="Play">▶</button><button type="button" data-music-action="next" aria-label="Next track">▶</button><span>${PLAYLIST.length} tracks</span></div><p class="music-status" role="status">Ready</p></div><div class="media-card queue-card"><p class="panel-eyebrow">Up next</p><div class="music-queue">${queue}</div></div>`;
  }

  trophyPanelTemplate() {
    const awards = AWARDS.map((award, index) => `<li><span>${String(index + 1).padStart(2, "0")}</span><strong>${award}</strong></li>`).join("");
    return `<div class="media-card trophy-lead"><p class="panel-eyebrow">Selected recognition</p><h2>Awards</h2><p>Projects recognized across architecture, public space and emerging design.</p></div><div class="media-card awards-card"><p class="panel-eyebrow">Recognition archive</p><ol class="award-list">${awards}</ol></div>`;
  }

  bookPanelTemplate() {
    const book = BOOKS[this.bookIndex];
    const shelf = BOOKS.map((item, index) => `<button type="button" class="shelf-row${index === this.bookIndex ? " is-active" : ""}" data-book-index="${index}"><span>${String(index + 1).padStart(2, "0")}</span><strong>${item.title}</strong><em>${item.author}</em><i aria-hidden="true">${index === this.bookIndex ? "▮▮▮" : ""}</i></button>`).join("");
    return `<div class="media-card reading-card"><p class="panel-eyebrow">Reading now</p><div class="book-detail"><img class="book-cover-image" src="${book.cover}" alt="${book.title} cover"><div class="book-copy"><h2>${book.title}</h2><p class="book-author">${book.author}</p><p>${book.review}</p></div></div></div><div class="media-card bookshelf-card"><p class="panel-eyebrow">My bookshelf</p><div class="bookshelf-list">${shelf}</div></div>`;
  }

  bindMusicPanel() {
    const audio = this.panelContent.querySelector(".local-audio");
    this.musicAudio = audio;
    this.musicElapsed = 0;
    this.musicDuration = PLAYLIST[this.musicIndex].duration;
    this.panelContent.querySelectorAll("[data-music-index]").forEach((button) => button.addEventListener("click", () => {
      this.selectMusic(Number(button.dataset.musicIndex));
    }));
    this.panelContent.querySelector('[data-music-action="toggle"]')?.addEventListener("click", () => this.toggleMusic());
    this.panelContent.querySelector('[data-music-action="previous"]')?.addEventListener("click", () => this.advanceMusic(-1));
    this.panelContent.querySelector('[data-music-action="next"]')?.addEventListener("click", () => this.advanceMusic(1));
    this.panelContent.querySelector(".music-progress input")?.addEventListener("input", (event) => {
      this.musicElapsed = Number(event.target.value);
      if (this.musicAudio) this.musicAudio.currentTime = this.musicElapsed;
      this.updateMusicProgress();
    });
    if (!audio) return;
    const updateDuration = () => {
      if (this.musicAudio !== audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
      this.musicDuration = audio.duration;
      const range = this.panelContent.querySelector(".music-progress input");
      const duration = this.panelContent.querySelector("[data-duration]");
      if (range) range.max = String(audio.duration);
      if (duration) duration.textContent = this.formatTime(audio.duration);
    };
    audio.addEventListener("loadedmetadata", updateDuration);
    audio.addEventListener("durationchange", updateDuration);
    audio.addEventListener("canplay", () => {
      if (this.musicAudio === audio) this.setMusicStatus("Ready", "ready");
    });
    audio.addEventListener("play", () => {
      if (this.musicAudio !== audio) return;
      this.setMusicPlaying(true);
      this.setMusicStatus("Playing", "playing");
    });
    audio.addEventListener("pause", () => {
      if (this.musicAudio !== audio || audio.ended) return;
      this.setMusicPlaying(false);
      this.setMusicStatus("Paused", "ready");
    });
    audio.addEventListener("timeupdate", () => {
      if (this.musicAudio !== audio) return;
      this.musicElapsed = audio.currentTime;
      this.updateMusicProgress();
    });
    audio.addEventListener("ended", () => {
      if (this.musicAudio === audio) this.advanceMusic(1);
    });
    audio.addEventListener("error", () => {
      if (this.musicAudio !== audio) return;
      this.setMusicPlaying(false);
      this.setMusicStatus("Audio could not be loaded", "error");
    });
  }

  advanceMusic(direction) {
    this.selectMusic((this.musicIndex + direction + PLAYLIST.length) % PLAYLIST.length);
  }

  selectMusic(index) {
    if (!Number.isInteger(index) || !PLAYLIST[index] || index === this.musicIndex) return;
    const audio = this.musicAudio;
    audio?.pause();
    this.musicIndex = index;
    this.musicElapsed = 0;
    this.musicDuration = PLAYLIST[index].duration;
    const track = PLAYLIST[index];
    const title = this.panelContent.querySelector(".now-playing h2");
    const artist = this.panelContent.querySelector(".music-artist");
    const range = this.panelContent.querySelector(".music-progress input");
    const duration = this.panelContent.querySelector("[data-duration]");
    if (title) title.textContent = track.title;
    if (artist) artist.textContent = track.artist;
    if (range) {
      range.max = String(track.duration);
      range.value = "0";
    }
    if (duration) duration.textContent = this.formatTime(track.duration);
    if (audio) {
      audio.src = track.audioUrl;
      audio.load();
      this.musicAudio = audio;
    }
    this.setMusicPlaying(false);
    this.setMusicStatus("Ready", "ready");
    this.updateMusicProgress();
    this.panelContent.querySelectorAll("[data-music-index]").forEach((button) => {
      const active = Number(button.dataset.musicIndex) === index;
      button.classList.toggle("is-active", active);
      const indicator = button.querySelector("i");
      if (indicator) indicator.textContent = active ? "▮▮▮" : "";
    });
  }

  formatTime(seconds) {
    const safe = Math.max(0, Math.floor(seconds || 0));
    return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
  }

  setMusicStatus(message, state = "") {
    const status = this.panelContent.querySelector(".music-status");
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  }

  setMusicPlaying(playing) {
    this.musicPlaying = playing;
    const button = this.panelContent.querySelector('[data-music-action="toggle"]');
    if (!button) return;
    button.textContent = playing ? "Ⅱ" : "▶";
    button.setAttribute("aria-label", playing ? "Pause" : "Play");
  }

  async toggleMusic() {
    const audio = this.musicAudio;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    try {
      await audio.play();
    } catch {
      if (this.musicAudio === audio) this.setMusicStatus("Playback was blocked — tap play again", "error");
    }
  }

  updateMusicProgress() {
    const track = PLAYLIST[this.musicIndex];
    if (!track) return;
    const duration = this.musicDuration || track.duration;
    const range = this.panelContent.querySelector(".music-progress input");
    const time = this.panelContent.querySelector("[data-current-time]");
    if (range) range.value = String(Math.min(duration, this.musicElapsed));
    if (time) time.textContent = this.formatTime(this.musicElapsed);
  }

  stopMusic() {
    const audio = this.musicAudio;
    this.musicAudio = null;
    audio?.pause();
    this.musicPlaying = false;
    this.musicElapsed = 0;
    this.musicDuration = 0;
  }

  bindBookPanel() {
    this.panelContent.querySelectorAll("[data-book-index]").forEach((button) => button.addEventListener("click", () => {
      this.selectBook(Number(button.dataset.bookIndex));
    }));
  }

  selectBook(index) {
    if (!Number.isInteger(index) || !BOOKS[index] || index === this.bookIndex) return;
    this.bookIndex = index;
    const book = BOOKS[index];
    const cover = this.panelContent.querySelector(".book-cover-image");
    const title = this.panelContent.querySelector(".book-copy h2");
    const author = this.panelContent.querySelector(".book-author");
    const review = this.panelContent.querySelector(".book-copy p:last-child");
    if (cover) {
      cover.src = book.cover;
      cover.alt = `${book.title} cover`;
    }
    if (title) title.textContent = book.title;
    if (author) author.textContent = book.author;
    if (review) review.textContent = book.review;
    this.panelContent.querySelectorAll("[data-book-index]").forEach((button) => {
      const active = Number(button.dataset.bookIndex) === index;
      button.classList.toggle("is-active", active);
      const indicator = button.querySelector("i");
      if (indicator) indicator.textContent = active ? "▮▮▮" : "";
    });
  }

  bindNotes() {
    const key = "daoyi-room-felt-notes-v2";
    localStorage.removeItem("daoyi-room-felt-notes");
    const form = this.panelContent.querySelector(".note-form");
    const cloud = this.panelContent.querySelector(".note-cloud");
    const list = this.panelContent.querySelector(".note-list");
    const read = () => {
      try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
    };
    const viewer = this.panelContent.querySelector(".note-viewer");
    const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
    const hashNote = (value) => {
      let hash = 2166136261;
      for (const char of value) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    };
    const noteStyle = (note, index) => {
      let seed = hashNote(`${note}:${index}`) || 1;
      const random = () => {
        seed += 0x6D2B79F5;
        let value = seed;
        value = Math.imul(value ^ value >>> 15, value | 1);
        value ^= value + Math.imul(value ^ value >>> 7, value | 61);
        return ((value ^ value >>> 14) >>> 0) / 4294967296;
      };
      const columns = 4;
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = Math.max(0, Math.min(82, column * 25 + (random() - .5) * 12));
      const y = 22 + row * 68 + (random() - .5) * 20;
      const rotation = (random() - .5) * 14;
      const scale = .84 + random() * .18;
      const shape = Math.floor(random() * 3);
      const color = Math.floor(random() * 3);
      return { shape, color, style: `--note-x:${x.toFixed(2)}%;--note-y:${y.toFixed(2)}px;--note-r:${rotation.toFixed(2)}deg;--note-scale:${scale.toFixed(3)};--note-z:${1 + Math.floor(random() * 5)}` };
    };
    const render = () => {
      const notes = read();
      const rows = Math.max(1, Math.ceil(notes.length / 4));
      cloud?.style.setProperty("--note-rows", rows);
      list.style.setProperty("--note-rows", rows);
      list.innerHTML = notes.map((note, index) => {
        const variant = noteStyle(note, index);
        return `<button type="button" class="note-paper note-paper--shape-${variant.shape} note-paper--color-${variant.color}" style="${variant.style}" data-note-index="${index}" aria-label="Open note ${index + 1}"><span>${escape(note)}</span></button>`;
      }).join("") || "<small>还没有纸条。</small>";
      list.querySelectorAll("[data-note-index]").forEach((button) => button.addEventListener("click", () => {
        const note = read()[Number(button.dataset.noteIndex)];
        const paper = viewer?.querySelector("article");
        if (!viewer || !paper || typeof note !== "string") return;
        paper.className = `${button.classList[1]} ${button.classList[2]}`;
        paper.querySelector("p").textContent = note;
        viewer.hidden = false;
      }));
    };
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const field = form.querySelector("textarea");
      const value = field.value.trim();
      if (!value) return;
      localStorage.setItem(key, JSON.stringify([...read(), value].slice(-12)));
      field.value = "";
      render();
    });
    viewer?.querySelectorAll("[data-note-viewer-close]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      viewer.hidden = true;
    }));
    render();
  }

  openGalaxy(rule, object) {
    if (this.galaxy) return;
    let mesh = object?.isMesh ? object : null;
    object?.traverse?.((candidate) => { if (!mesh && candidate.isMesh) mesh = candidate; });
    const frame = mesh ? surfaceFrame(mesh, null, this.camera.position) : null;
    const projected = frame?.center.clone().project(this.camera);
    const iframe = document.createElement("iframe");
    iframe.className = "galaxy-shell";
    iframe.src = CONTENT.galaxy;
    iframe.title = "数字银河";
    iframe.style.setProperty("--portal-x", `${projected ? (projected.x + 1) * 50 : 50}%`);
    iframe.style.setProperty("--portal-y", `${projected ? (1 - projected.y) * 50 : 50}%`);
    document.body.appendChild(iframe);
    this.galaxy = iframe;

    if (rule.id === "window" && frame) {
      this.cameraDirector.goSurface(mesh, mesh.geometry?.boundingBox || null, rule.label, frame);
      this.galaxyTimers = [
        setTimeout(() => {
          const depth = Math.max(frame.width, frame.height) * 1.25;
          const through = {
            position: frame.center.clone().addScaledVector(frame.normal, -depth * .45),
            target: frame.center.clone().addScaledVector(frame.normal, -depth * 1.7),
            up: frame.up,
            fov: 46,
            near: this.cameraDirector.focusNear,
            label: rule.label,
          };
          this.cameraDirector.transition(through, { level: "interaction", region: "drawing", duration: 1250 });
        }, 1050),
        setTimeout(() => iframe.classList.add("is-visible"), 1370),
      ];
    } else {
      this.cameraDirector.goObject(object, rule.label, { fill: .9, duration: 1500 });
      this.galaxyTimers = [setTimeout(() => iframe.classList.add("is-visible"), 1150)];
    }
  }

  closeGalaxy() {
    if (!this.galaxy) return;
    this.galaxyTimers?.forEach(clearTimeout);
    this.galaxyTimers = [];
    const iframe = this.galaxy;
    iframe.classList.remove("is-visible");
    setTimeout(() => iframe.remove(), 900);
    this.galaxy = null;
    this.cameraDirector.goGlobal();
  }

  async warmFrames(onProgress = null) {
    const report = (progress, status) => onProgress?.({ progress, status });
    report(93, "PREPARING SCENE");
    // Compile the perspective-camera shader variants while the loading cover
    // is still present. Otherwise the first orthographic-to-perspective move
    // can pay that cost in the middle of the visible transition.
    const warmCamera = this.perspectiveCamera.clone();
    warmCamera.position.copy(this.camera.position);
    warmCamera.up.copy(this.camera.up);
    warmCamera.fov = CAMERA.localFov;
    warmCamera.lookAt(this.controls.target);
    warmCamera.updateProjectionMatrix();
    if (this.renderer.compileAsync) {
      report(94, "WARMING MATERIALS");
      await this.renderer.compileAsync(this.scene, warmCamera);
      report(96, "REFINING RENDER STATE");
    } else {
      report(95, "REFINING RENDER STATE");
    }
    // `compileAsync` prepares shader programs but does not pay every first
    // perspective render cost. Draw behind the loading cover so the visible
    // orthographic-to-perspective handoff does not inherit those slow frames.
    for (let i = 0; i < 3; i += 1) {
      this.renderer.render(this.scene, warmCamera);
      report(96 + (i + 1) * .8, "REFINING RENDER STATE");
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    for (let i = 0; i < 3; i += 1) {
      this.renderer.render(this.scene, this.camera);
      this.screens.render();
      report(98.4 + (i + 1) * .45, "FINAL CHECK");
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }

  updateMotion(elapsed) {
    if (this.chair) this.chair.rotation.y = this.chairBaseRotation + Math.sin(elapsed * 1.15) * .52;
    if (this.pencil) {
      this.pencil.position.x = this.pencilBase.position.x + Math.sin(elapsed * .7) * .012;
      this.pencil.rotation.z = this.pencilBase.rotation.z + Math.sin(elapsed * .7) * .12;
    }
    if (this.steam) {
      const attr = this.steam.points.geometry.attributes.position;
      for (let i = 0; i < attr.count; i += 1) {
        const phase = (this.steam.seeds[i] + elapsed * .09) % 1;
        attr.setXYZ(i,
          this.steam.center.x + Math.sin(elapsed * 1.1 + i) * this.steam.height * .12 * phase,
          this.steam.center.y + this.steam.height * (.55 + phase * 1.55),
          this.steam.center.z + Math.cos(elapsed * .9 + i * .7) * this.steam.height * .1 * phase,
        );
      }
      attr.needsUpdate = true;
      this.steam.points.material.opacity = .24 + Math.sin(elapsed * .8) * .055;
    }
  }

  resize() {
    this.cameraDirector.setAspect(innerWidth / innerHeight);
    this.renderer.setSize(innerWidth, innerHeight);
    this.screens.resize(innerWidth, innerHeight);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    const elapsed = this.clock.getElapsedTime();
    const now = performance.now();
    const delta = Math.min(.05, Math.max(0, (now - (this.lastFrameTime ?? now)) / 1000));
    this.lastFrameTime = now;
    this.cameraDirector.update(now);
    this.cameraDirector.ensureControlState();
    const cameraMoving = Boolean(this.cameraDirector.tween || this.cameraDirector.projectionTween);
    if (!this.cameraDirector.tween && this.controls.enabled) this.controls.update();
    if (this.interactions) this.interactions.update();
    this.updateMotion(elapsed);
    this.lights.update(delta);
    // A global orthographic view enters a screen through `projectionTween`,
    // not `tween`. Mounting the flattened input overlay during that hybrid
    // transition freezes its first, tiny CSS3D rectangle and leaves a large
    // empty screen shell. Wait until both transition types are complete.
    const screenFocusSettled = !cameraMoving;
    const focusedScreen = this.cameraDirector.level === "interaction" ? this.interactions?.activeRule?.screen : null;
    this.screens.setTransitioning(focusedScreen && !screenFocusSettled ? focusedScreen : null);
    const activeScreen = screenFocusSettled ? focusedScreen : null;
    this.screens.setInteractive(activeScreen || null);
    this.renderer.render(this.scene, this.camera);
    this.screens.render();
  }
}
