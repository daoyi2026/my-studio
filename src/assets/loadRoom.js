import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const rugTextureCache = new WeakMap();
const ROOM_LOAD_RETRY_DELAYS_MS = [0, 800, 1800];

function isRetryableRoomLoadError(error) {
  const message = String(error?.message || error || "");
  return /failed to fetch|load failed|networkerror|network request failed/i.test(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function paleGreyGreenRugTexture(source) {
  if (!source?.image || rugTextureCache.has(source)) return rugTextureCache.get(source) || source;
  const image = source.image, canvas = document.createElement("canvas");
  canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height), data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const red = data[i] / 255, green = data[i + 1] / 255, blue = data[i + 2] / 255;
    const max = Math.max(red, green, blue), min = Math.min(red, green, blue);
    const light = (max + min) * .5;
    const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(max + min - 1));
    // Preserve substantially more of the authored luminance range than R2.
    // R2 compressed every texel into 0.68..0.82, which erased the pattern.
    const targetLight = THREE.MathUtils.clamp(.42 + light * .38, .43, .80);
    const targetSat = THREE.MathUtils.clamp(.055 + saturation * .055, .055, .12);
    const c = (1 - Math.abs(2 * targetLight - 1)) * targetSat, x = c * (1 - Math.abs((108 / 60) % 2 - 1)), m = targetLight - c / 2;
    // 108° keeps a restrained sage-green bias while the original texel
    // contrast remains visible.
    data[i] = (x + m) * 255; data[i + 1] = (c + m) * 255; data[i + 2] = m * 255;
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `${source.name || "rug"}__PALE_GREY_GREEN`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = source.flipY;
  texture.wrapS = source.wrapS;
  texture.wrapT = source.wrapT;
  texture.repeat.copy(source.repeat);
  texture.offset.copy(source.offset);
  texture.center.copy(source.center);
  texture.rotation = source.rotation;
  texture.matrixAutoUpdate = source.matrixAutoUpdate;
  if (!source.matrixAutoUpdate) texture.matrix.copy(source.matrix);
  texture.magFilter = source.magFilter;
  texture.minFilter = source.minFilter;
  texture.generateMipmaps = source.generateMipmaps;
  texture.anisotropy = source.anisotropy;
  rugTextureCache.set(source, texture); return texture;
}

function loadRoomOnce(url, onProgress) {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => resolve(gltf.scene), (event) => {
      if (!event.total) return;
      // Some GitHub Pages responses report a compressed byte total that is
      // smaller than the decoded stream. Keep transport progress inside the
      // room-loading phase so it can never announce 100% before parsing and
      // the later scene gates have completed.
      const ratio = Math.min(1, Math.max(0, event.loaded / event.total));
      onProgress?.(ratio);
    }, reject);
  });
}

export async function loadRoom(url, onProgress) {
  let lastError;
  for (let attempt = 0; attempt < ROOM_LOAD_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await wait(ROOM_LOAD_RETRY_DELAYS_MS[attempt]);
    try {
      return await loadRoomOnce(url, onProgress);
    } catch (error) {
      lastError = error;
      const finalAttempt = attempt === ROOM_LOAD_RETRY_DELAYS_MS.length - 1;
      if (finalAttempt || !isRetryableRoomLoadError(error)) throw error;
    }
  }
  throw lastError;
}

export function configureRoomMaterials(root, renderer) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    const suppressWallCast = /^(?:GEO-v48-Shelf_Post_\d+|GEO-v57-WallDisplay_FeltBoard)$/i.test(object.name || "");
    object.castShadow = !/glass|window/i.test(object.name) && !suppressWallCast;
    object.receiveShadow = true;
    const path = objectPath(object);
    if (/GEO-v58-Notebook_(?:Left|Right)PageSurface/i.test(object.name)) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const corrected = materials.map((material) => {
        const copy = material.clone();
        if (copy.map) {
          copy.map = copy.map.clone();
          copy.map.wrapS = THREE.RepeatWrapping;
          copy.map.repeat.x = -Math.abs(copy.map.repeat.x || 1);
          copy.map.offset.x = 1 - (copy.map.offset.x || 0);
          copy.map.needsUpdate = true;
        }
        copy.needsUpdate = true;
        return copy;
      });
      object.material = Array.isArray(object.material) ? corrected : corrected[0];
    }
    const uprightShelfBook = /ASSET-v55-Books-Layer5-Cube00[1-7]/i.test(path);
    const stackedShelfBook = /ASSET-v55-Books-Layer5-Cube(?:010|012)/i.test(path);
    const stabilizedShelfBook = uprightShelfBook || stackedShelfBook;
    const special = /GEO-v62-Trophy|REPL-v64-trophy|REPL-v63-telescope|REPL-v63-chair|REPL-v63-drawing-desk|Shelf|Rug_OverTheEdge/i.test(path) || stabilizedShelfBook;
    if (special) {
      object.material = Array.isArray(object.material)
        ? object.material.map((material) => material?.clone())
        : object.material?.clone();
    }
    if (/GEO-v62-Trophy/i.test(path)) {
      const sources = Array.isArray(object.material) ? object.material : [object.material];
      const stableGold = sources.map((material) => {
        const gold = new THREE.MeshBasicMaterial({
          name: `${material?.name || "Trophy"}__STABLE_GOLD`,
          color: 0xd3a13d,
          side: material?.side ?? THREE.FrontSide,
          toneMapped: false,
          fog: false,
        });
        gold.userData.r4StableGold = true;
        return gold;
      });
      object.material = Array.isArray(object.material) ? stableGold : stableGold[0];
      object.castShadow = true;
      object.receiveShadow = true;
      return;
    }
    if (/REPL-v64-trophy/i.test(path)) {
      // The R5 review GLB carries Luna's accepted trophy geometry but its
      // exported material can resolve as an unlit white surface. Keep the
      // asset intact and apply a scoped PBR gold finish only to that group.
      const sources = Array.isArray(object.material) ? object.material : [object.material];
      const metallicGold = sources.map((material) => {
        const gold = new THREE.MeshStandardMaterial({
          name: `${material?.name || "Luna Trophy"}__R6_METALLIC_GOLD`,
          color: 0xc99732,
          metalness: .92,
          roughness: .24,
          envMapIntensity: 1.45,
          side: material?.side ?? THREE.FrontSide,
        });
        gold.userData.r6LunaTrophyGold = true;
        return gold;
      });
      object.material = Array.isArray(object.material) ? metallicGold : metallicGold[0];
      object.castShadow = true;
      object.receiveShadow = true;
      return;
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      if (!material) return;
      const name = material.name || "";
      if (material.map) {
        material.map.colorSpace = THREE.SRGBColorSpace;
        material.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      }
      const reconstructedUprightSurface = uprightShelfBook && /^MAT-BOOK-\d+-(?:COVER|SPINE(?:-RECONSTRUCTED)?)$/i.test(name);
      if ((stackedShelfBook && !/^paper\./i.test(name)) || reconstructedUprightSurface) {
        // These cover/spine surfaces sit only fractions of a millimetre above
        // the authored book blocks. At the global camera that falls below
        // depth-buffer precision and the faces alternate visibility. Bias only
        // the visible book surfaces without moving or rescaling the books.
        material.polygonOffset = true;
        material.polygonOffsetFactor = -1;
        material.polygonOffsetUnits = -2;
      } else if (/Shelf_(?:Tier|Post)|ASSET_Shelf/i.test(path)) {
        // The authored dark bitmap multiplied the metal to near-black in the
        // runtime room environment. Use the PBR silver surface directly.
        material.map = null;
        material.color?.setHex(0xdde3e5);
        material.metalness = .72;
        material.roughness = .32;
        material.envMapIntensity = .85;
        material.emissive?.setHex(0x3c4548);
        material.emissiveIntensity = .28;
      } else if (/Rug_OverTheEdge/i.test(path)) {
        // Preserve the authored texture but pull its broad base color toward a
        // quiet neutral so the rug no longer dominates the composition.
        // Blender keeps the textured source; this light-green multiplier is
        // deliberately shared with the R2 source treatment instead of reviving
        // the previous brown-grey runtime override.
        material.color?.setHex(0xeef1eb);
        material.map = paleGreyGreenRugTexture(material.map);
        material.roughness = Math.max(material.roughness ?? 0, .72);
      } else if (/REPL-v63-drawing-desk/i.test(path) && /Dark Walnut/i.test(name)) {
        // The authored plant-side support is already present in the GLB. Its
        // rear faces disappeared at the review angle under FrontSide culling.
        material.side = THREE.DoubleSide;
      } else if (/REPL-v63-chair/i.test(path) && /MWC-Seat(?:Side)?|PlasticDull|PlasticShiny/i.test(name)) {
        material.color?.setHex(0xc99566);
        material.metalness = 0;
        material.roughness = /Shiny/i.test(name) ? .34 : .48;
        material.envMapIntensity = .75;
      } else if (/REPL-v63-telescope/i.test(path)) {
        if (/Glass/i.test(name)) {
          material.color?.setHex(0xb9d5df);
          material.metalness = 0;
          material.roughness = .08;
          material.transparent = true;
          material.opacity = .42;
          material.depthWrite = false;
          material.side = THREE.DoubleSide;
          if ("transmission" in material) material.transmission = .35;
        } else if (/Gold/i.test(name)) {
          material.color?.setHex(0xc89b45);
          material.metalness = .9;
          material.roughness = .2;
          material.envMapIntensity = 1.35;
        } else if (/bronze/i.test(name)) {
          material.color?.setHex(/orange/i.test(name) ? 0x9a6338 : 0x76503a);
          material.metalness = .82;
          material.roughness = .3;
          material.envMapIntensity = 1.15;
        } else if (/Weight grey|Dark Pewter|Aged Steel/i.test(name)) {
          material.color?.setHex(/Dark Pewter/i.test(name) ? 0x4f5354 : 0x85898a);
          material.metalness = .78;
          material.roughness = .3;
          material.envMapIntensity = 1.2;
        } else if (/Wood/i.test(name)) {
          material.color?.setHex(0x805b3d);
          material.metalness = 0;
          material.roughness = .5;
        }
      }
      if (/silver|metal|aluminium|aluminum|chrome/i.test(name)) {
        material.metalness = Math.max(material.metalness ?? 0, 0.72);
        material.roughness = Math.min(material.roughness ?? 1, 0.3);
        material.envMapIntensity = Math.max(material.envMapIntensity ?? 1, 1.15);
      }
      material.needsUpdate = true;
    });
  });
}

export function boxForPatterns(root, patterns, fallback = null) {
  const box = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!object.visible || !patterns.some((pattern) => pattern.test(object.name || ""))) return;
    box.expandByObject(object);
  });
  return box.isEmpty() ? fallback?.clone() ?? new THREE.Box3().setFromObject(root) : box;
}

export function objectPath(object) {
  const path = [];
  for (let current = object; current; current = current.parent) path.push(current.name || "");
  return path.join(" ");
}
