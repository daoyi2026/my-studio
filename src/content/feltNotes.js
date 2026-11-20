import * as THREE from "three";
import { surfaceFrame } from "../utils/geometry.js";

export const FELT_NOTES_KEY = "daoyi-room-felt-notes-v2";

export const feltNoteMessage = note => typeof note === "string" ? note : typeof note?.message === "string" ? note.message : "";
export const feltNoteName = note => typeof note?.name === "string" ? note.name : "";
const validNote = note => typeof note === "string" || (note && typeof note.message === "string" && typeof note.name === "string");
const storedNote = note => typeof note === "string" ? note : { message: note.message, name: note.name };

export function createFeltNoteStore({ key = FELT_NOTES_KEY, storage } = {}) {
  try { storage ??= globalThis.localStorage; } catch { storage = null; }
  let notes = [], unsavedSession = false;
  const read = () => {
    if (!unsavedSession) try { const saved = JSON.parse(storage?.getItem(key) || "[]"); if (Array.isArray(saved)) notes = saved.filter(validNote).slice(-12).map(storedNote); } catch { /* Keep a usable in-session list. */ }
    return notes.map(storedNote);
  };
  read();
  return {
    read,
    appendAccepted(message, name = "") {
      if (typeof message !== "string" || !message.trim()) throw new Error("A confirmed note needs message text.");
      const note = typeof name === "string" && name.trim() ? { message, name: name.trim() } : message;
      notes = [...read(), note].slice(-12); unsavedSession = true;
      try { if (!storage) return false; storage.setItem(key, JSON.stringify(notes)); unsavedSession = false; return true; } catch { return false; }
    },
  };
}

function noteTexture(note, index, width) {
  const message = feltNoteMessage(note), name = feltNoteName(note);
  const handwriting = '"HanziPen SC", "Kaiti SC", "KaiTi", "STKaiti", "Segoe Print", "Bradley Hand", cursive';
  const canvas = document.createElement("canvas"); canvas.width = 512;
  const context = canvas.getContext("2d");
  context.font = `34px ${handwriting}`;
  const lines = []; let line = "";
  for (const char of message) {
    if (char === "\n") { lines.push(line); line = ""; continue; }
    if (line && context.measureText(line + char).width > 432) { lines.push(line); line = char; } else line += char;
  }
  if (line) lines.push(line);
  // Keep a consistent ink scale while letting longer notes hang farther down.
  const height = Math.min(.2, Math.max(.082, .04 + lines.length * .0085));
  canvas.height = Math.round(canvas.width * height / width);
  context.fillStyle = ["#f3e3ab", "#dce7c6", "#eed5c8"][index % 3]; context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(115,94,55,.16)"; context.lineWidth = 2; context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  context.fillStyle = "#46443c"; context.textBaseline = "top";
  context.font = `24px ${handwriting}`; context.fillText("TO DAOYI", 40, 28);
  context.font = `34px ${handwriting}`;
  const visibleLines = Math.max(1, Math.floor((canvas.height - 174) / 38));
  lines.slice(0, visibleLines).forEach((text, row) => context.fillText(text, 40, 82 + row * 38));
  // The bounded physical preview keeps its signature; the viewer shows all text.
  if (lines.length > visibleLines) context.fillText("…", 40, 82 + visibleLines * 38);
  if (name) {
    context.font = `28px ${handwriting}`;
    let signature = name;
    while (context.measureText(signature).width > 432 && [...signature].length > 1) signature = [...signature].slice(0, -2).join("") + "…";
    context.textAlign = "right"; context.fillText(signature, 472, canvas.height - 50);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4; return { texture, height };
}

export function createPhysicalFeltNotes(room) {
  const boards = room.getObjectsByProperty("name", "GEO-v57-WallDisplay_FeltBoard");
  const board = boards.length === 1 ? boards[0] : null;
  const source = board && !Array.isArray(board.material) ? board.material : null;
  const originalBox = board?.geometry?.boundingBox?.clone();
  const frame = board?.isMesh ? surfaceFrame(board, originalBox) : null;
  // GLTF accessor bounds can differ from recomputed Float32 bounds by a few
  // nanometers. Keep the authored cached focus bounds exactly as they were.
  if (originalBox) board.geometry.boundingBox.copy(originalBox);
  if (!frame || source?.name !== "MAT-v57-WallBoard_WoodenParticleBoard01" || Math.abs(frame.width - 1.895141602) > .002 || Math.abs(frame.height - .883300784) > .002) {
    return { status: "skipped", reason: "Unknown felt board layout", setNotes() {}, dispose() {} };
  }
  const group = new THREE.Group(); group.name = "LOCAL-FELT-NOTES";
  // Keep papers beside the original board in the room tree. They must not
  // enlarge the original board's focus bounds or replace any photo/pin mesh.
  room.add(group); room.updateMatrixWorld(true);
  const localFromWorld = room.matrixWorld.clone().invert(), basis = new THREE.Matrix4().makeBasis(frame.right, frame.up, frame.normal);
  const size = frame.localBox.getSize(new THREE.Vector3()).multiply(board.getWorldScale(new THREE.Vector3()));
  const paperDepth = Math.min(Math.abs(size.x), Math.abs(size.y), Math.abs(size.z)) * .5 + .0005;
  const width = Math.min(.112, frame.width / 15), height = Math.min(.108, frame.height * .122);
  // Pin centers land in bare-board gaps. Paper bodies can extend over photos.
  // The last coordinate shifts a body sideways relative to its pin.
  const extraPins = [
    [.919, .38, -.04], [.919, .17, -.04], [.919, -.06, -.04],
    [.466, .34, -.04], [.466, .11, -.04],
    [.56, -.03, 0], [.72, -.03, 0], [.20, .42, 0], [-.095, .29, 0],
  ];
  const surfaces = [];
  room.traverse(object => {
    if (!/^GEO-v57-WallDisplay_board_(?:photo_\d+|center_portrait|dancer_(?:upper|lower))$/.test(object.name)) return;
    const box = new THREE.Box3();
    object.traverse(part => { if (part.isMesh) box.union(new THREE.Box3().setFromObject(part)); });
    if (box.isEmpty()) return;
    const points = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const point = new THREE.Vector3(x, y, z).sub(frame.center);
      points.push([point.dot(frame.right), point.dot(frame.up), point.dot(frame.normal)]);
    }
    surfaces.push({ left: Math.min(...points.map(p => p[0])), right: Math.max(...points.map(p => p[0])), bottom: Math.min(...points.map(p => p[1])), top: Math.max(...points.map(p => p[1])), depth: Math.max(...points.map(p => p[2])) });
  });
  const pinGeometry = new THREE.SphereGeometry(.0033, 8, 6), pinMaterial = new THREE.MeshStandardMaterial({ color: 0x8a8068, metalness: .55, roughness: .5 });
  let signature = null, disposed = false;
  const clear = () => {
    for (const child of [...group.children]) { child.removeFromParent(); if (child.userData.feltNotePaper) { child.geometry.dispose(); child.material.map.dispose(); child.material.dispose(); } }
  };
  return {
    status: "ready", group, frame, width, height,
    setNotes(messages) {
      if (disposed) return;
      const notes = messages.filter(validNote).slice(-12), next = JSON.stringify(notes);
      if (next === signature) return; signature = next; clear();
      notes.forEach((message, index) => {
        const defaultPinY = -frame.height * .5 + .02 + height * .37;
        const [pinX, pinY, bodyOffsetX] = index < 3
          ? [frame.width * .5 - width * .5 - .06 - index * .14, defaultPinY, 0]
          : extraPins[index - 3];
        const x = pinX + bodyOffsetX;
        const { texture, height: paperHeight } = noteTexture(message, index, width);
        const top = pinY + height * .13, y = top - paperHeight * .5;
        // Bridge any photo beneath the paper, without moving the pin's XY anchor
        // onto that photo or changing the original paper/text dimensions.
        const pad = .006;
        const depth = surfaces.reduce((front, surface) => x + width * .5 + pad > surface.left && x - width * .5 - pad < surface.right && top + pad > surface.bottom && top - paperHeight - pad < surface.top ? Math.max(front, surface.depth + .0005) : front, paperDepth);
        const center = frame.center.clone().addScaledVector(frame.right, x).addScaledVector(frame.up, y).addScaledVector(frame.normal, depth);
        const paper = new THREE.Mesh(new THREE.PlaneGeometry(width, paperHeight), new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0, side: THREE.DoubleSide }));
        paper.name = `LOCAL-FELT-NOTE-${index + 1}`; paper.userData.localFeltNoteIndex = index; paper.userData.feltNotePaper = true;
        paper.position.copy(center.applyMatrix4(localFromWorld)); paper.quaternion.setFromRotationMatrix(new THREE.Matrix4().extractRotation(localFromWorld).multiply(basis));
        paper.rotateZ([-.045, .025, -.018, .04][index % 4]); paper.castShadow = true; paper.receiveShadow = true;
        const pin = new THREE.Mesh(pinGeometry, pinMaterial); pin.name = `LOCAL-FELT-NOTE-PIN-${index + 1}`; pin.userData.localFeltNoteIndex = index;
        pin.position.copy(frame.center).addScaledVector(frame.right, pinX).addScaledVector(frame.up, pinY).addScaledVector(frame.normal, depth + .0026).applyMatrix4(localFromWorld);
        pin.castShadow = true; pin.receiveShadow = true; group.add(paper, pin);
      });
      group.updateMatrixWorld(true);
    },
    dispose() { if (disposed) return; disposed = true; clear(); group.removeFromParent(); pinGeometry.dispose(); pinMaterial.dispose(); },
  };
}
