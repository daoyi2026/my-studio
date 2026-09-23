import * as THREE from "three";
import { objectPath } from "../assets/loadRoom.js";
import { BOOK_INDEX_BY_MODEL_ID } from "../content/roomContent.js";

export const RULES = [
  { id: "imac", label: "iMac · 个人官网", pattern: /AGREED_iMac/i, region: "desk", screen: "imac" },
  { id: "macbook", label: "MacBook · 个人工作台", pattern: /AGREED_MacBook/i, region: "desk", screen: "macbook" },
  { id: "phone", label: "手机 · App 体验", pattern: /REPL-v63-phone/i, anchor: "REPL-v63-phone-001", region: "desk", screen: "phone" },
  { id: "window", label: "窗户 · 数字银河", pattern: /ARCH_Window/i, anchor: "ARCH_WindowGlass", region: "drawing", portal: true },
  { id: "telescope", label: "望远镜 · 数字银河", pattern: /REPL-v63-telescope/i, anchor: "REPL-v63-telescope-Group", region: "drawing", portal: true },
  { id: "ukulele", label: "Ukulele · Music player", pattern: /GEO-DisplayAsset_03_Mesh|REPL-v64-ukelele/i, anchor: "REPL-v64-ukelele-Group", region: "drawing", panel: "music" },
  { id: "frame", label: "相框 · 照片", pattern: /ASSET-v52-PhotoFrame/i, anchor: "ASSET-v52-PhotoFrame", region: "desk", panel: "frame" },
  { id: "deskLamp", label: "台灯", pattern: /ASSET-v50-BellLamp/i, anchor: "ASSET-v50-BellLamp", region: "desk", direct: "desk" },
  { id: "floorLamp", label: "落地灯", pattern: /REPL-v63-floor-lamp|AGREED_FloorLamp/i, anchor: "REPL-v63-floor-lamp-Group", region: "shelf", direct: "floor" },
  { id: "drawingLamp", label: "画板灯", pattern: /lamp[ _]?180/i, anchor: "lamp_180", region: "drawing", direct: "drawing" },
  { id: "trophy", label: "Trophy · Awards", pattern: /GEO-v62-Trophy|REPL-v64-trophy/i, anchor: "GEO-v62-Trophy-SportCup_Anchor", region: "shelf", panel: "trophy" },
  { id: "drawing", label: "画板 · 绘画作品", pattern: /DraftingBoard|drawing-desk/i, anchor: "GEO-v62-DraftingBoard-Paper_Placeholder", region: "drawing", panel: "drawing" },
  { id: "felt", label: "毛毡板 · 留言", pattern: /WallDisplay_FeltBoard/i, anchor: "GEO-v57-WallDisplay_FeltBoard", region: "desk", panel: "felt" },
  { id: "notebook", label: "本子 · Brainstorming", pattern: /GEO-v58-Notebook/i, anchor: "GEO-v58-Notebook_Cover", region: "desk", panel: "notebook" },
  { id: "book", label: "Bookshelf", pattern: /Books-Layer/i, region: "shelf", panel: "book" },
];

function isFeltSurface(path) {
  return /WallDisplay_FeltBoard|WallDisplay_board_/i.test(path);
}

const DRAWING_LAMP_PARTS = new Set(["lamp_180", "lamp 180", "circle", "sphere", "circle008"]);

function isDrawingLampPart(object) {
  let current = object;
  let isLampPart = false;
  while (current) {
    if (DRAWING_LAMP_PARTS.has((current.name || "").toLowerCase())) isLampPart = true;
    if (current.name === "REPL-v63-drawing-desk-Group") return isLampPart;
    current = current.parent;
  }
  return false;
}

function ruleFor(object) {
  const path = objectPath(object);
  // Only the felt board and its overlapping board_* papers share this target.
  // Decorative top_* posters remain ordinary desk-region hits.
  if (isFeltSurface(path)) return RULES.find((rule) => rule.id === "felt");
  // The articulated drawing lamp is nested beside the drafting board, so its
  // own geometry must win before the broad drawing-desk ancestor rule.
  if (isDrawingLampPart(object)) return RULES.find((rule) => rule.id === "drawingLamp");
  return RULES.find((rule) => rule.pattern.test(path)) || null;
}

function matchingAncestor(object, pattern, root) {
  let current = object;
  while (current && current !== root) {
    if (pattern.test(current.name || "")) return current;
    current = current.parent;
  }
  return object;
}

function isHorizontalBook(object) {
  if (/(?:^|-)Books-Layer4(?:-|$)/i.test(object?.name || "")) return true;
  const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
  return size.y < Math.min(size.x, size.z) * .42;
}

export class InteractionDirector {
  constructor({ camera, canvas, room, cameraDirector, regionBoxes, screens, onLight, onPortal, onPanel, onHover }) {
    this.camera = camera;
    this.canvas = canvas;
    this.room = room;
    this.cameraDirector = cameraDirector;
    this.regionBoxes = regionBoxes;
    this.screens = screens;
    this.onLight = onLight;
    this.onPortal = onPortal;
    this.onPanel = onPanel;
    this.onHover = onHover;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hovered = null;
    this.activeRule = null;
    this.regionPose = null;
    this.pointerDown = null;
    this.drawingLampVisuals = [];
    cameraDirector.addEventListener("viewchange", (event) => {
      if (event.detail.level !== "interaction" || event.detail.region !== "drawing") this.setDrawingLampOcclusion(false);
      if (event.detail.level !== "interaction") {
        this.activeRule = null;
        this.resetBookMotion();
      }
    });
    canvas.addEventListener("pointerdown", (event) => { this.pointerDown = { x: event.clientX, y: event.clientY }; });
    canvas.addEventListener("pointermove", (event) => this.move(event));
    canvas.addEventListener("pointerup", (event) => this.up(event));
  }

  pick(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.room, true).filter((hit) => hit.object.visible && hit.object.isMesh);
    const ukulele = hits.find((hit) => ruleFor(hit.object)?.id === "ukulele");
    if (ukulele) return ukulele;
    return hits[0] || null;
  }

  move(event) {
    if (this.cameraDirector.tween) return;
    const hit = this.pick(event);
    let rule = hit ? ruleFor(hit.object) : null;
    const book = rule?.id === "book" ? matchingAncestor(hit.object, /Books-Layer/i, this.room) : null;
    const disabledBook = book && !Number.isInteger(BOOK_INDEX_BY_MODEL_ID[book.name]);
    if (disabledBook) rule = null;
    this.onHover?.(disabledBook ? false : Boolean(rule || (hit && this.cameraDirector.level === "global")));
    const nextBook = rule?.id === "book" && this.cameraDirector.level === "local" ? book : null;
    if (nextBook !== this.hovered) {
      this.releaseBook();
      this.hovered = nextBook;
      if (this.hovered) {
        this.hovered.userData.baseY ??= this.hovered.position.y;
        this.hovered.userData.hoverTarget = this.hovered.userData.baseY + (isHorizontalBook(this.hovered) ? 0 : .025);
      }
    }
  }

  releaseBook() {
    if (this.hovered && this.hovered !== this.selectedBook) this.hovered.userData.hoverTarget = this.hovered.userData.baseY;
    this.hovered = null;
  }

  up(event) {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6 || this.cameraDirector.tween) return;
    this.cameraDirector.noteInput();
    const hit = this.pick(event);
    if (!hit) return this.handleBlank();
    let rule = ruleFor(hit.object);
    const book = rule?.id === "book" ? matchingAncestor(hit.object, /Books-Layer/i, this.room) : null;
    if (book && !Number.isInteger(BOOK_INDEX_BY_MODEL_ID[book.name])) return;
    if (rule?.direct) return this.handleDirect(rule);
    if (this.cameraDirector.level === "global") {
      if (rule?.portal) return this.onPortal(rule, this.resolve(rule, hit.object));
      if (rule?.screen || rule?.id === "ukulele") {
        this.prepareRegionContext(hit.object, rule);
        return this.focus(rule, hit.object);
      }
      return this.enterRegionFor(rule ? this.resolve(rule, hit.object) : hit.object, rule);
    }
    if (this.cameraDirector.level === "local") {
      if (!rule) return this.handleBlank();
      if (rule.portal) return this.onPortal(rule, this.resolve(rule, hit.object));
      if (rule.id === "book") {
        if (this.selectedBook === book) {
          const bookIndex = BOOK_INDEX_BY_MODEL_ID[book.name];
          if (!Number.isInteger(bookIndex)) {
            console.warn(`[books] No content binding for interactive model ${book.name}`);
            return;
          }
          this.activeRule = rule;
          return this.activate({ ...rule, bookId: book.name, bookIndex });
        }
        if (this.selectedBook && this.selectedBook !== book) this.selectedBook.userData.hoverTarget = this.selectedBook.userData.baseY;
        this.selectedBook = book;
        book.userData.baseY ??= book.position.y;
        book.userData.hoverTarget = book.userData.baseY + (isHorizontalBook(book) ? 0 : .035);
        return;
      }
      return this.focus(rule, hit.object);
    }
    if (this.cameraDirector.level === "interaction") {
      if (this.activeRule?.id === "drawing" && rule?.id === "drawing") {
        return this.activate(rule);
      }
      if (this.activeRule?.id === rule?.id) return this.activate(rule);
      const path = objectPath(hit.object);
      if (this.activeRule?.id === "felt" && isFeltSurface(path)) return this.activate(this.activeRule);
      if (this.activeRule?.id === "drawing" && /DraftingBoard|drawing-desk/i.test(path)) return this.activate(this.activeRule);
      if (this.activeRule?.id === "notebook" && /Notebook/i.test(path)) return this.activate(this.activeRule);
      this.handleBlank();
    }
  }

  handleBlank() {
    if (this.cameraDirector.level === "interaction") {
      this.setDrawingLampOcclusion(false);
      this.cameraDirector.exitInteraction(this.regionPose, this.activeRule?.id === "ukulele" ? 550 : 950);
      this.activeRule = null;
      this.onPanel?.(null);
    }
  }

  exitActive() {
    if (this.cameraDirector.level === "interaction") return this.handleBlank();
    this.activeRule = null;
    this.resetBookMotion();
    this.onPanel?.(null);
  }

  resetBookMotion() {
    this.room.traverse((object) => {
      if (object.userData.baseY == null) return;
      object.position.y = object.userData.baseY;
      object.userData.hoverTarget = object.userData.baseY;
    });
    this.hovered = null;
    this.selectedBook = null;
  }

  handleDirect(rule) {
    this.onLight?.(rule.direct);
  }

  resolve(rule, hit) {
    return (rule.anchor && this.room.getObjectByName(rule.anchor)) || matchingAncestor(hit, rule.pattern, this.room);
  }

  setDrawingLampOcclusion(hidden) {
    if (!this.drawingLampVisuals.length) {
      const drawingDesk = this.room.getObjectByName("REPL-v63-drawing-desk-Group");
      // The imported articulated lamp is split into sibling nodes. `lamp_180`
      // is only its small pivot; the shade, bulb and collar are separate.
      // Hide just the parts that cross the perpendicular paper view.
      ["lamp_180", "lamp 180", "Circle", "Sphere", "Circle008"].forEach((name) => {
        const object = drawingDesk?.getObjectByName(name);
        if (object && !this.drawingLampVisuals.some((entry) => entry.object === object)) {
          this.drawingLampVisuals.push({ object, visible: object.visible });
        }
      });
    }
    this.drawingLampVisuals.forEach(({ object, visible }) => { object.visible = hidden ? false : visible; });
  }

  inferRegion(object, rule) {
    if (rule?.region) return rule.region;
    const path = objectPath(object);
    if (/Shelf|Books-Layer|Trophy/i.test(path)) return "shelf";
    if (/drawing|Drafting|Window|telescope|DisplayAsset_03/i.test(path)) return "drawing";
    return "desk";
  }

  shelfLevel(object) {
    const tiers = this.regionBoxes.shelfTiers;
    const y = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3()).y;
    let best = 1, distance = Infinity;
    tiers.forEach((tier, index) => {
      const d = Math.abs(tier.y - y);
      if (d < distance) { best = index + 1; distance = d; }
    });
    return best;
  }

  enterRegionFor(object, rule) {
    if (rule?.id === "book") {
      // A global book click enters a real close shelf context, but deliberately
      // does not select or open it. The existing local click -> select -> open
      // flow remains intact.
      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3());
      const padding = Math.max(.12, Math.max(size.x, size.y, size.z) * .8);
      box.expandByVector(new THREE.Vector3(padding, padding * .5, padding));
      this.regionPose = this.cameraDirector.goRegion(box, new THREE.Vector3(0, 0, 1), "Book shelf close-up", "shelf");
      return;
    }
    const { region, box, label } = this.regionDescriptor(object, rule);
    if (region === "drawing") {
      const pose = this.drawingRegionPose(box, label);
      this.regionPose = pose;
      this.cameraDirector.active = null;
      this.cameraDirector.setRegionContext(pose, region);
      this.cameraDirector.transition(pose, { level: "local", region, duration: 1250 });
      return;
    }
    this.regionPose = this.cameraDirector.goRegion(box, new THREE.Vector3(0, 0, 1), label, region);
  }

  prepareRegionContext(object, rule) {
    const { region, box, label } = this.regionDescriptor(object, rule);
    const pose = region === "drawing"
      ? this.drawingRegionPose(box, label)
      : this.cameraDirector.createRegionPose(box, new THREE.Vector3(0, 0, 1), label);
    this.regionPose = pose;
    this.cameraDirector.setRegionContext(pose, region);
  }

  drawingRegionPose(box, label) {
    const paper = this.room.getObjectByName("GEO-v62-DraftingBoard-Paper_Placeholder");
    const window = this.room.getObjectByName("ARCH_WindowGlass");
    if (!paper || !window) return this.cameraDirector.createRegionPose(box, new THREE.Vector3(0, 0, 1), label);

    const paperBox = new THREE.Box3().setFromObject(paper);
    const target = paperBox.getCenter(new THREE.Vector3());
    const windowCenter = new THREE.Box3().setFromObject(window).getCenter(new THREE.Vector3());
    const towardWindow = windowCenter.sub(target).setY(0);
    if (towardWindow.lengthSq() < .0001) towardWindow.set(0, 0, 1);
    towardWindow.normalize();

    // The first drawing-region view is deliberately a standing look across the
    // long side of the table: behind the paper relative to the window wall,
    // looking toward that wall, with an explicit downward angle. R5 tightens
    // this first regional composition before the direct perpendicular focus.
    const base = this.cameraDirector.createRegionPose(box, towardWindow.clone().negate(), label);
    const regionSize = box.getSize(new THREE.Vector3());
    const paperSize = paperBox.getSize(new THREE.Vector3());
    const rise = Math.max(.48, Math.min(1.1, regionSize.y * .62));
    const distance = Math.max(
      base.position.distanceTo(base.target) * .78,
      Math.max(regionSize.x, regionSize.z) * .62,
    );
    const horizontalDistance = Math.sqrt(Math.max(.01, distance * distance - rise * rise));
    const lateral = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), towardWindow).normalize();
    const lateralOffset = Math.min(paperSize.x, paperSize.z) * .16;
    const pose = {
      position: target.clone()
        .addScaledVector(towardWindow, -horizontalDistance)
        .addScaledVector(lateral, lateralOffset)
        .add(new THREE.Vector3(0, rise, 0)),
      target: target.clone().addScaledVector(towardWindow, Math.min(paperSize.x, paperSize.z) * .1),
      up: new THREE.Vector3(0, 1, 0),
      fov: base.fov,
      near: base.near,
      label,
    };
    return pose;
  }

  regionDescriptor(object, rule) {
    const region = this.inferRegion(object, rule);
    let box = rule?.id === "felt" ? new THREE.Box3().setFromObject(object) : this.regionBoxes[region];
    let label = region === "desk" ? "书桌视角" : region === "drawing" ? "画板视角" : "书架近景";
    if (rule?.id === "felt") label = "毛毡板近景";
    if (region === "shelf") {
      const level = this.shelfLevel(object);
      box = this.regionBoxes.shelfLevels[level] || box;
      label = `书架第 ${level} 层`;
    }
    return { region, box, label };
  }

  focus(rule, hit) {
    const object = this.resolve(rule, hit);
    this.activeRule = rule;
    this.onPanel?.(null);
    if (rule.screen) {
      const screen = this.screens?.screens?.[rule.screen];
      if (screen && rule.id === "phone") {
        // Frame the complete physical handset rather than the CSS3D surface;
        // use the calibrated screen frame so its live iframe stays aligned.
        this.cameraDirector.goObject(object, rule.label, { normal: screen.frame.normal, up: screen.frame.up, fill: .86 });
      } else if (screen) this.cameraDirector.goSurface(screen.mesh, screen.localBox, rule.label, screen.frame);
      else this.cameraDirector.goObject(object, rule.label);
      return;
    }
    if (rule.id === "drawing") {
      this.setDrawingLampOcclusion(true);
      return this.cameraDirector.goDrawingBoard(object, this.room.getObjectByName("ARCH_WindowGlass"), rule.label);
    }
    if (rule.id === "felt") {
      this.cameraDirector.goObject(object, rule.label);
      return this.activate(rule);
    }
    const ukuleleBox = rule.id === "ukulele" ? this.replacementGroupBox(object) : null;
    const options = rule.id === "ukulele" ? this.ukuleleCloseOptions(ukuleleBox)
      : rule.id === "notebook" || rule.id === "drawing" ? { normal: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0,0,-1), fill: .9 }
        : {};
    this.cameraDirector.goObject(object, rule.label, options);
  }

  replacementGroupBox(object) {
    const box = new THREE.Box3();
    const groupName = object?.name || "";
    this.room.traverse((candidate) => {
      if (candidate.userData?.replacement_group !== groupName) return;
      box.expandByObject(candidate);
    });
    if (box.isEmpty() && object) box.expandByObject(object);
    return box;
  }

  ukuleleCloseOptions(box) {
    const center = box.getCenter(new THREE.Vector3());
    const window = this.room.getObjectByName("ARCH_WindowGlass");
    const towardWindow = window
      ? new THREE.Box3().setFromObject(window).getCenter(new THREE.Vector3()).sub(center).setY(0)
      : new THREE.Vector3(-1, 0, 0);
    if (towardWindow.lengthSq() < .0001) towardWindow.set(-1, 0, 0);
    towardWindow.normalize();
    // p30/40: stable screen-up, neck left, body foreground, telescope behind.
    const up = new THREE.Vector3(0, 1, 0);
    const side = towardWindow.negate().applyAxisAngle(up, THREE.MathUtils.degToRad(30));
    const normal = side.multiplyScalar(Math.sin(THREE.MathUtils.degToRad(40)))
      .addScaledVector(up, Math.cos(THREE.MathUtils.degToRad(40)));
    const framingBox = box.clone();
    const telescope = this.room.getObjectByName("REPL-v63-telescope-Group");
    if (telescope) {
      const telescopeCenter = new THREE.Box3().setFromObject(telescope).getCenter(new THREE.Vector3());
      const towardTelescope = telescopeCenter.sub(center).setY(0);
      if (towardTelescope.lengthSq() > .0001) framingBox.translate(towardTelescope.normalize().multiplyScalar(.12));
    }
    return { normal, up, fill: 1.1, box: framingBox, duration: 550 };
  }

  activate(rule) {
    if (rule.screen) return;
    if (rule.panel) this.onPanel?.(rule.panel, rule);
  }

  update() {
    this.room.traverse((object) => {
      if (object.userData.hoverTarget == null) return;
      object.position.y += (object.userData.hoverTarget - object.position.y) * .14;
    });
  }
}
