import * as THREE from "three";

export function frameExtents(box, normal, up) {
  const right = new THREE.Vector3().crossVectors(up, normal).normalize();
  const center = box.getCenter(new THREE.Vector3());
  let width = 0, height = 0, depth = 0;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const offset = new THREE.Vector3(x, y, z).sub(center);
    width = Math.max(width, Math.abs(offset.dot(right)) * 2);
    height = Math.max(height, Math.abs(offset.dot(up)) * 2);
    depth = Math.max(depth, Math.abs(offset.dot(normal)) * 2);
  }
  return { width, height, depth, right };
}

export function fitDistance(camera, width, height, depth, fov, fill) {
  const verticalFov = THREE.MathUtils.degToRad(fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  return Math.max(
    height / (2 * Math.tan(verticalFov / 2) * fill),
    width / (2 * Math.tan(horizontalFov / 2) * fill),
  ) + depth * .55;
}

export function poseForBox(camera, box, normal, fov, fill, label = "view", up = new THREE.Vector3(0, 1, 0)) {
  const target = box.getCenter(new THREE.Vector3());
  const viewNormal = normal.clone().normalize();
  const viewUp = up.clone().normalize();
  const extents = frameExtents(box, viewNormal, viewUp);
  const distance = fitDistance(camera, extents.width, extents.height, extents.depth, fov, fill);
  return { position: target.clone().addScaledVector(viewNormal, distance), target, fov, up: viewUp, label };
}

export function localBoxForMaterial(mesh, pattern) {
  if (!mesh?.geometry?.attributes?.position) return null;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const valid = materials.map((m, i) => pattern.test(m?.name || "") ? i : -1).filter((i) => i >= 0);
  if (!valid.length) return null;
  const geometry = mesh.geometry;
  const positions = geometry.attributes.position;
  const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: geometry.index?.count ?? positions.count, materialIndex: 0 }];
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const group of groups.filter((g) => valid.includes(g.materialIndex))) {
    for (let cursor = group.start; cursor < group.start + group.count; cursor += 1) {
      const index = geometry.index ? geometry.index.getX(cursor) : cursor;
      box.expandByPoint(point.fromBufferAttribute(positions, index));
    }
  }
  return box.isEmpty() ? null : box;
}

export function surfaceFrame(mesh, localBox = null, viewerPosition = null) {
  mesh.updateWorldMatrix(true, false);
  mesh.geometry?.computeBoundingBox();
  const geometryBox = localBox?.clone() || mesh.geometry?.boundingBox?.clone();
  if (!geometryBox) return null;
  const center = geometryBox.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
  const size = geometryBox.getSize(new THREE.Vector3());
  const quaternion = mesh.getWorldQuaternion(new THREE.Quaternion());
  const scale = mesh.getWorldScale(new THREE.Vector3());
  const axes = [new THREE.Vector3(1,0,0), new THREE.Vector3(0,1,0), new THREE.Vector3(0,0,1)].map((axis) => axis.applyQuaternion(quaternion).normalize());
  const lengths = [Math.abs(size.x * scale.x), Math.abs(size.y * scale.y), Math.abs(size.z * scale.z)];
  const thin = lengths.indexOf(Math.min(...lengths));
  let normal = axes[thin].clone();
  if (viewerPosition && normal.dot(viewerPosition.clone().sub(center)) < 0) normal.negate();
  const plane = [0,1,2].filter((i) => i !== thin);
  let upIndex = Math.abs(axes[plane[0]].y) >= Math.abs(axes[plane[1]].y) ? plane[0] : plane[1];
  if (Math.abs(normal.y) > .76) upIndex = lengths[plane[0]] >= lengths[plane[1]] ? plane[0] : plane[1];
  let up = axes[upIndex].clone();
  if (Math.abs(normal.y) < .76 && up.y < 0) up.negate();
  const right = new THREE.Vector3().crossVectors(up, normal).normalize();
  up = new THREE.Vector3().crossVectors(normal, right).normalize();
  const widthIndex = plane.find((i) => i !== upIndex);
  return { center, normal, up, right, width: lengths[widthIndex], height: lengths[upIndex], localBox: geometryBox };
}
