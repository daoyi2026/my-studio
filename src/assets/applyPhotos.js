import * as THREE from "three";
import { surfaceFrame } from "../utils/geometry.js";

function planeAspect(mesh) {
  mesh.geometry?.computeBoundingBox();
  const size = mesh.geometry?.boundingBox?.getSize(new THREE.Vector3()) ?? new THREE.Vector3(1, 1, .01);
  const axes = [Math.abs(size.x), Math.abs(size.y), Math.abs(size.z)].sort((a, b) => b - a);
  return Math.max(.05, axes[0] / Math.max(axes[1], .0001));
}

function rebuildPlanarUV(mesh) {
  const source = mesh.geometry;
  const position = source?.attributes?.position;
  if (!position) return;
  const geometry = source.clone();
  mesh.updateMatrixWorld(true);
  const worldPoints = [];
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (let i = 0; i < position.count; i += 1) {
    const point = new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(mesh.matrixWorld);
    worldPoints.push(point);
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxY = Math.max(bounds.maxY, point.y);
  }
  const width = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const height = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i += 1) {
    uv[i * 2] = (worldPoints[i].x - bounds.minX) / width;
    uv[i * 2 + 1] = (worldPoints[i].y - bounds.minY) / height;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  mesh.geometry = geometry;
  mesh.userData.photoAspect = Math.max(.05, width / height);
}

function coverTexture(texture, targetAspect) {
  const imageAspect = texture.image.width / texture.image.height;
  texture.flipY = true;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(1, 1);
  texture.offset.set(0, 0);
  if (imageAspect > targetAspect) {
    texture.repeat.x = targetAspect / imageAspect;
    texture.offset.x = (1 - texture.repeat.x) * .5;
  } else {
    texture.repeat.y = imageAspect / targetAspect;
    texture.offset.y = (1 - texture.repeat.y) * .5;
  }
  texture.needsUpdate = true;
}

function containTexture(texture, targetAspect, inset = 1) {
  const image = texture.image;
  const longEdge = 1024;
  const canvas = document.createElement("canvas");
  if (targetAspect >= 1) {
    canvas.width = longEdge;
    canvas.height = Math.max(1, Math.round(longEdge / targetAspect));
  } else {
    canvas.height = longEdge;
    canvas.width = Math.max(1, Math.round(longEdge * targetAspect));
  }
  const context = canvas.getContext("2d");
  context.fillStyle = "#faf9f5";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / image.width, canvas.height / image.height) * inset;
  const width = image.width * scale;
  const height = image.height * scale;
  context.drawImage(image, (canvas.width - width) * .5, (canvas.height - height) * .5, width, height);
  const contained = new THREE.CanvasTexture(canvas);
  contained.name = `${texture.name || "photo"}__CONTAINED`;
  contained.colorSpace = THREE.SRGBColorSpace;
  contained.anisotropy = texture.anisotropy;
  contained.wrapS = contained.wrapT = THREE.ClampToEdgeWrapping;
  contained.needsUpdate = true;
  texture.dispose();
  return contained;
}

function replaceMatchingMaterial(mesh, matcher, texture, forceNamedPlane = false) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const hasNamedMatch = materials.some((material) => material && matcher.test(material.name || ""));
  let replaced = false;
  const next = materials.map((material) => {
    if (!material || (!matcher.test(material.name || "") && !(forceNamedPlane && !hasNamedMatch))) return material;
    const copy = material.clone();
    copy.map = texture;
    copy.color.set(0xffffff);
    copy.side = THREE.DoubleSide;
    if (copy.emissive) {
      copy.emissive.set(0xffffff);
      copy.emissiveMap = texture;
      copy.emissiveIntensity = .12;
    }
    copy.metalness = 0;
    copy.roughness = .72;
    copy.needsUpdate = true;
    replaced = true;
    return copy;
  });
  if (replaced) mesh.material = Array.isArray(mesh.material) ? next : next[0];
  return replaced;
}

function stabilizeCollageDepth(object, root, layer) {
  if (!object?.isMesh || layer < 0) return null;
  const roomCenter = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
  const frame = surfaceFrame(object, null, roomCenter);
  if (!frame) return null;
  // The fourteen authored cards overlap in X/Z but their front faces were
  // exactly coplanar. Preserve that layout while giving each card a sub-mm
  // physical stack depth toward the room.
  const offset = (layer + 1) * .00045;
  const worldPosition = object.getWorldPosition(new THREE.Vector3()).addScaledVector(frame.normal, offset);
  if (object.parent) object.position.copy(object.parent.worldToLocal(worldPosition));
  else object.position.copy(worldPosition);
  object.updateMatrixWorld(true);
  object.renderOrder = 20 + layer;
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  materials.forEach((material) => {
    if (!material) return;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -(layer + 1);
    material.needsUpdate = true;
  });
  object.userData.photoDepthLayer = layer + 1;
  object.userData.photoDepthOffset = offset;
  return { object: object.name, layer: layer + 1, offset, normal: frame.normal.toArray() };
}

export async function applyPhotos(root, bindings, renderer, onProgress) {
  const loader = new THREE.TextureLoader();
  let complete = 0;
  const report = { expected: bindings.length + 1, applied: [], missing: [], depthStabilized: [] };
  for (const [bindingIndex, binding] of bindings.entries()) {
    const container = root.getObjectByName(binding.object);
    let object = container?.isMesh ? container : null;
    container?.traverse((candidate) => {
      if (object || !candidate.isMesh) return;
      const materials = Array.isArray(candidate.material) ? candidate.material : [candidate.material];
      if (materials.some((material) => binding.material.test(material?.name || ""))) object = candidate;
    });
    if (!object) {
      report.missing.push(binding.object);
      continue;
    }
    let texture = await loader.loadAsync(binding.url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    rebuildPlanarUV(object);
    const targetAspect = object.userData.photoAspect || planeAspect(object);
    if (binding.fit === "contain") texture = containTexture(texture, targetAspect, binding.inset ?? 1);
    else coverTexture(texture, targetAspect);
    const replaced = replaceMatchingMaterial(object, binding.material, texture, true);
    if (replaced) {
      report.applied.push({ object: binding.object, url: binding.url, fit: binding.fit || "cover" });
      if (/WallDisplay_board_photo_\d{2}$/i.test(binding.object)) {
        const depth = stabilizeCollageDepth(object, root, bindingIndex);
        if (depth) report.depthStabilized.push(depth);
      }
    }
    else report.missing.push(`${binding.object}/material`);
    complete += 1;
    onProgress?.(complete / (bindings.length + 1));
  }

  let frame = null;
  root.traverse((object) => {
    if (frame || !object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some((material) => /^Photo$/i.test(material?.name || ""))) frame = object;
  });
  if (frame?.isMesh) {
    const texture = await loader.loadAsync("./public/assets/photos/frame.jpg");
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    rebuildPlanarUV(frame);
    coverTexture(texture, frame.userData.photoAspect || planeAspect(frame));
    const replaced = replaceMatchingMaterial(frame, /^Photo$/i, texture, true);
    if (replaced) report.applied.push({ object: frame.name, url: "./public/assets/photos/frame.jpg" });
    else report.missing.push(`${frame.name}/material`);
  } else {
    report.missing.push("PhotoFrame/Photo");
  }
  onProgress?.(1);
  console.info(`[photos] ${report.applied.length}/${report.expected} images applied`, report);
  return report;
}
