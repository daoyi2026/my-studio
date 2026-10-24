import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const PEN_URL = "./public/assets/models/rotring-800-v1.glb?rev=3ecd7135";
const BODY = "GEO-v58-Notebook_PencilBody";

function disposeComponent(component) {
  component?.traverse(object => {
    object.geometry?.dispose();
    (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material?.dispose());
  });
}

function worldVertices(object, visit) {
  object.traverse(mesh => {
    const positions = mesh.geometry?.attributes?.position;
    if (!positions) return;
    for (let i = 0; i < positions.count; i += 1) visit(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld));
  });
}

export async function applyNotebookPen(room) {
  const matches = room.getObjectsByProperty("name", BODY), carrier = matches.length === 1 ? matches[0] : null;
  if (!carrier?.isMesh || Array.isArray(carrier.material) || !carrier.geometry?.attributes?.position) return { status: "disabled" };
  if (carrier.userData.notebookRotringApplied) return carrier.userData.notebookRotringApplied;
  if (carrier.children.length || (carrier.geometry.index?.count ?? carrier.geometry.attributes.position.count) !== 108) return { status: "disabled" };
  const originalMaterial = carrier.material, originalCastShadow = carrier.castShadow;
  let component;
  try {
    const loaded = await new GLTFLoader().loadAsync(PEN_URL); component = loaded.scene;
    const meshes = []; component.traverse(object => { if (object.isMesh) meshes.push(object); });
    const triangles = meshes.reduce((count, mesh) => count + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3, 0);
    component.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(component), size = bounds.getSize(new THREE.Vector3());
    if (loaded.animations?.length || triangles !== 463 || meshes.length !== 5 || Math.abs(size.x - 1) > 1e-5 || size.y > .2 || size.z > .2) throw new Error("Invalid pen component contract");
    carrier.updateWorldMatrix(true, false); carrier.geometry.computeBoundingBox();
    const long = new THREE.Vector3(0, 1, 0).transformDirection(carrier.matrixWorld);
    const up = new THREE.Vector3(0, 0, -1).transformDirection(carrier.matrixWorld);
    const side = new THREE.Vector3().crossVectors(long, up).normalize(); up.crossVectors(side, long).normalize();
    let low = Infinity, high = -Infinity, oldBottom = Infinity;
    worldVertices(carrier, point => { const along = point.dot(long); low = Math.min(low, along); high = Math.max(high, along); oldBottom = Math.min(oldBottom, point.y); });
    const length = high - low;
    if (!Number.isFinite(length) || length < .10 || length > .15) throw new Error("Invalid original pencil length");
    const center = carrier.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(carrier.matrixWorld);
    const target = new THREE.Matrix4().makeBasis(long, up, side).scale(new THREE.Vector3().setScalar(length / size.x)).setPosition(center);
    let fittedBottom = Infinity;
    worldVertices(component, point => { fittedBottom = Math.min(fittedBottom, point.applyMatrix4(target).y); });
    target.elements[13] += oldBottom - fittedBottom;
    component.name = "GEO-v58-Notebook_Rotring800";
    component.matrixAutoUpdate = false;
    component.matrix.copy(carrier.matrixWorld.clone().invert().multiply(target));
    meshes.forEach((mesh, index) => {
      mesh.name = `GEO-v58-Notebook_Rotring800_Surface_${index + 1}`;
      mesh.castShadow = true; mesh.receiveShadow = true;
    });
    const invisible = carrier.material.clone(); invisible.visible = false;
    // Commit only after loading and fitting succeed. Keep the original semantic
    // mesh as the unchanged motion/picking carrier, with no duplicate shadow.
    carrier.material = invisible; carrier.castShadow = false; carrier.add(component); carrier.updateWorldMatrix(false, true);
    let finalBottom = Infinity;
    worldVertices(component, point => { finalBottom = Math.min(finalBottom, point.y); });
    const report = { status: "applied", asset: PEN_URL, triangles, originalTriangles: (carrier.geometry.index?.count ?? carrier.geometry.attributes.position.count) / 3,
      length, axis: long.toArray(), oldBottom, finalBottom, contactDelta: finalBottom - oldBottom, materialCount: new Set(meshes.map(mesh => mesh.material)).size };
    carrier.userData.notebookRotringApplied = report;
    return report;
  } catch (_) {
    if (component?.parent === carrier) carrier.remove(component);
    if (carrier.material !== originalMaterial) { carrier.material.dispose(); carrier.material = originalMaterial; }
    carrier.castShadow = originalCastShadow;
    disposeComponent(component);
    return { status: "fallback" };
  }
}
