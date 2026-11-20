import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// The former local Leica prototype established tuple/picking preservation, not
// a frame-rate gain. Only these two opaque, noninteractive static groups apply.
const ROOT = "GEO-DisplayAsset_02_Mesh";
const GROUPS = [
  { material: "MAT-v62-Camera-Leica_02_Material_006", count: 35, excluded: ["GEO-v62-Camera-Leica_05_Cylinder_172"] },
  { material: "MAT-v62-Camera-Leica_03_Material_008", count: 12, excluded: [] },
];
const CALLBACKS = ["onBeforeRender", "onAfterRender", "onBeforeShadow", "onAfterShadow"];
const requireContract = (condition, reason) => { if (!condition) throw new Error(reason); };
const layout = geometry => JSON.stringify(Object.entries(geometry.attributes).sort(([a], [b]) => a.localeCompare(b)).map(([name, a]) =>
  [name, a.itemSize, a.array.constructor.name, a.normalized, a.gpuType || null]));

function geometryInFrame(mesh, inverseFrame) {
  const copy = mesh.geometry.clone();
  // Normalized GLB directions must be decoded before transformation, avoiding
  // re-quantization into the original Int8 arrays. Source buffers stay intact.
  for (const name of ["position", "normal", "tangent"]) {
    const source = mesh.geometry.attributes[name];
    if (!source) continue;
    const array = new Float32Array(source.count * source.itemSize);
    for (let vertex = 0; vertex < source.count; vertex++) for (let axis = 0; axis < source.itemSize; axis++) array[vertex * source.itemSize + axis] = source.getComponent(vertex, axis);
    copy.setAttribute(name, new THREE.BufferAttribute(array, source.itemSize));
  }
  copy.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverseFrame, mesh.matrixWorld));
  return copy;
}

export function applyStaticRoomBatches(room, lightingSample) {
  if (!room.userData.phoneFreeContract || lightingSample?.status !== "applied"
    || lightingSample.sourceSha256 !== "a09a008b7b9298edddacba4994755fa1ada00f02ad660b0221e1628d29fb9666") return { status: "skipped", reason: "Exact phone-free/R7 identity required" };
  const roots = room.getObjectsByProperty("name", ROOT), records = [], helpers = [], fragments = [], hidden = [];
  const report = { status: "rejected", assembly: ROOT, groups: [], sourceMeshes: 0, helpers: 0, singlePassDrawReduction: 0 };
  try {
    requireContract(roots.length === 1, "Static Leica root is not unique");
    const root = roots[0]; room.updateMatrixWorld(true);
    requireContract(root.matrixWorld.determinant() > 0 && new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).length() < .4, "Unsupported Leica assembly frame");
    const inverse = root.matrixWorld.clone().invert();
    for (const group of GROUPS) {
      const meshes = [];
      root.traverse(mesh => { if (mesh.isMesh && !Array.isArray(mesh.material) && mesh.material?.name === group.material) meshes.push(mesh); });
      requireContract(meshes.length === group.count, `Unexpected ${group.material} membership`);
      const selected = meshes.filter(mesh => !group.excluded.includes(mesh.name));
      for (const name of group.excluded) requireContract(meshes.filter(mesh => mesh.name === name && mesh.matrixWorld.determinant() < 0).length === 1, "Negative-determinant exclusion changed");
      const first = selected[0], material = first?.material, expectedLayout = layout(first.geometry);
      requireContract(selected.length > 1 && material && !material.transparent && !material.transmission && !material.wireframe && material.visible && !material.clippingPlanes?.length && !material.userData.r7StaticAO, "Non-opaque or R7 material");
      requireContract(material.onBeforeCompile === THREE.Material.prototype.onBeforeCompile && material.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey, "Custom shader callback");
      for (const mesh of selected) {
        const geometry = mesh.geometry, count = geometry.index?.count || geometry.attributes.position?.count;
        requireContract((/^GEO-v62-Camera-Leica_/.test(mesh.name) || /^GEO-v62-Camera-Leica_/.test(mesh.parent?.name || "")) && mesh.type === "Mesh" && !mesh.children.length && !mesh.animations.length && !mesh.isInstancedMesh && !mesh.isSkinnedMesh && !mesh.morphTargetInfluences && !geometry.isInstancedBufferGeometry && !Object.keys(geometry.morphAttributes).length, `Dynamic or unknown Leica part: ${mesh.name}`);
        requireContract(mesh.visible && mesh.frustumCulled && mesh.matrixWorld.determinant() > 0 && mesh.raycast === THREE.Mesh.prototype.raycast && !mesh.customDepthMaterial && !mesh.customDistanceMaterial && CALLBACKS.every(key => mesh[key] === THREE.Object3D.prototype[key]), "Custom object state");
        requireContract(mesh.material === material && layout(geometry) === expectedLayout && mesh.castShadow === first.castShadow && mesh.receiveShadow === first.receiveShadow && mesh.renderOrder === first.renderOrder && mesh.layers.mask === first.layers.mask, "Incompatible material/layout/render state");
        requireContract(count && count % 3 === 0 && geometry.drawRange.start === 0 && (geometry.drawRange.count === Infinity || geometry.drawRange.count === count) && !geometry.groups.length, "Unsupported draw range/groups");
        for (const [name, a] of Object.entries(geometry.attributes)) requireContract(/^(position|normal|tangent|uv\d*|color)$/.test(name) && a.itemSize <= 4 && !a.isInstancedBufferAttribute && !a.data?.isInstancedInterleavedBuffer && (a.usage ?? a.data?.usage) === THREE.StaticDrawUsage, "Unknown/dynamic attribute");
        for (let ancestor = mesh.parent; ancestor && ancestor !== room; ancestor = ancestor.parent) requireContract(ancestor.visible && !ancestor.animations.length && CALLBACKS.every(key => ancestor[key] === THREE.Object3D.prototype[key]), `Dynamic/custom ancestor: ${ancestor.name}`);
      }
      const copies = selected.map(mesh => { const copy = geometryInFrame(mesh, inverse); fragments.push(copy); return copy; });
      const merged = mergeGeometries(copies, false); requireContract(merged, "Static geometry merge failed");
      merged.computeBoundingBox(); merged.computeBoundingSphere();
      const helper = new THREE.Mesh(merged, material); helpers.push(helper);
      helper.name = `STATIC-LEICA-${group.material.endsWith("006") ? "006" : "008"}`;
      helper.castShadow = first.castShadow; helper.receiveShadow = first.receiveShadow; helper.renderOrder = first.renderOrder; helper.layers.mask = first.layers.mask;
      helper.raycast = () => {}; helper.visible = false; root.add(helper); helper.updateWorldMatrix(true, false);
      // Preserve original semantic objects/geometry/transforms for bounds and
      // picking; only their draws/shadow submissions are replaced by the helper.
      for (const mesh of selected) {
        const invisible = material.clone(); invisible.visible = false; hidden.push(invisible);
        records.push({ mesh, material, invisible, castShadow: mesh.castShadow });
      }
      report.groups.push({ material: group.material, members: selected.map(mesh => mesh.name), excluded: group.excluded, triangles: merged.index.count / 3 });
    }
    for (const record of records) { record.mesh.material = record.invisible; record.mesh.castShadow = false; }
    for (const helper of helpers) helper.visible = true;
    report.status = "applied"; report.sourceMeshes = records.length; report.helpers = helpers.length; report.singlePassDrawReduction = records.length - helpers.length;
    let disposed = false;
    return { ...report, dispose() {
      if (disposed) return;
      disposed = true;
      for (const record of records) { if (record.mesh.material === record.invisible) record.mesh.material = record.material; record.mesh.castShadow = record.castShadow; }
      for (const helper of helpers) { helper.removeFromParent(); helper.geometry.dispose(); }
      for (const material of hidden) material.dispose();
    } };
  } catch (error) {
    for (const helper of helpers) { helper.removeFromParent(); helper.geometry.dispose(); }
    for (const material of hidden) material.dispose();
    return { ...report, status: "rejected", reason: error.message };
  } finally { for (const fragment of fragments) fragment.dispose(); }
}
