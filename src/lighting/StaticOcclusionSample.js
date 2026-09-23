import * as THREE from "three";

const BASE = "./public/assets/lighting/r7/";
const SOURCE_SHA = "6be02ce29010409f2aeb0b442ffa4393beab34ddfd8717609a6455917d09d178";
const PRODUCTION_MODEL_SHA = "6698b7fba6c7f7c51e8ab198ef54242083b603f930dc5eeb4ffa417d01e33de2";

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
}

async function checkedFetch(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`R7 asset HTTP ${response.status}: ${url}`);
  return response;
}

function requireContract(condition, message) {
  if (!condition) throw new Error(`R7 AO mapping rejected: ${message}`);
}

// The accepted R7 layer adds only ambient occlusion. Three.js's native aoMap
// affects indirect diffuse and environment specular, never direct light terms.
export async function applyStaticOcclusionSample(room, modelUrl) {
  try {
    const manifest = await (await checkedFetch(`${BASE}manifest.json`)).json();
    requireContract(manifest.version === "r7-ao-v3-r13" && manifest.sourceSha256 === SOURCE_SHA, "manifest identity");
    requireContract(await sha256(await (await checkedFetch(modelUrl)).arrayBuffer()) === PRODUCTION_MODEL_SHA, "production GLB SHA-256");
    requireContract(manifest.receivers.length === 10 && new Set(manifest.receivers.map((r) => r.name)).size === 10, "receiver set");
    room.updateMatrixWorld(true);
    const pending = [];
    for (const entry of manifest.receivers) {
      const matches = [];
      room.traverse((object) => { if (object.name === entry.name) matches.push(object); });
      requireContract(matches.length === 1 && matches[0].isMesh, entry.name);
      const mesh = matches[0], geometry = mesh.geometry, position = geometry.getAttribute("position");
      requireContract(position?.count === entry.vertexCount && geometry.index?.count === entry.indexCount, `${entry.name} counts`);
      const positions = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) positions.set([position.getX(i), position.getY(i), position.getZ(i)], i * 3);
      const indices = new Uint32Array(geometry.index.count);
      for (let i = 0; i < indices.length; i++) indices[i] = geometry.index.getX(i);
      requireContract(await sha256(positions.buffer) === entry.positionSha256, `${entry.name} positions`);
      requireContract(await sha256(indices.buffer) === entry.indexSha256, `${entry.name} indices`);
      requireContract(mesh.matrixWorld.elements.every((v, i) => Math.abs(v - entry.worldMatrix[i]) < 1e-5), `${entry.name} transform`);
      requireContract(entry.uv.length === entry.indexCount * 2 && entry.uv.every((v) => Number.isFinite(v) && v > 0 && v < 1), `${entry.name} UVs`);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      requireContract(materials.every((m) => m?.isMeshStandardMaterial && !m.aoMap), `${entry.name} material/AO`);
      pending.push({ mesh, entry, materials });
    }
    const textureBytes = await (await checkedFetch(`${BASE}${manifest.texture}`)).arrayBuffer();
    requireContract(await sha256(textureBytes) === manifest.textureSha256, "atlas SHA-256");
    const blobUrl = URL.createObjectURL(new Blob([textureBytes], { type: "image/png" }));
    let texture;
    try { texture = await new THREE.TextureLoader().loadAsync(blobUrl); }
    finally { URL.revokeObjectURL(blobUrl); }
    requireContract(texture.image.width === manifest.width && texture.image.height === manifest.height, "atlas dimensions");
    texture.name = "R7_STATIC_OCCLUSION_NON_COLOR";
    texture.colorSpace = THREE.NoColorSpace;
    texture.flipY = false;
    texture.channel = 1;
    // Chart padding protects bilinear samples. Disable mipmaps to prevent tiny
    // distant charts mixing unrelated surfaces across the atlas.
    texture.generateMipmaps = false;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    for (const { mesh, entry, materials } of pending) {
      const geometry = mesh.geometry.toNonIndexed();
      geometry.setAttribute("uv1", new THREE.Float32BufferAttribute(entry.uv, 2));
      const copies = materials.map((source) => {
        const material = source.clone();
        material.aoMap = texture;
        material.aoMapIntensity = .75;
        material.userData.r7StaticAO = true;
        material.needsUpdate = true;
        return material;
      });
      mesh.geometry = geometry;
      mesh.material = Array.isArray(mesh.material) ? copies : copies[0];
    }
    return { status: "applied", version: manifest.version, receivers: pending.map(({ mesh }) => mesh.name),
      samples: manifest.samples, rayCount: manifest.rayCount, sourceSha256: SOURCE_SHA,
      suppressedContactNames: ["CONTACT_ASSET-v61-ClayCup-Clay cup"],
      technique: manifest.technique, textureBytes: manifest.textureBytes };
  } catch (error) {
    console.warn("R7 static AO failed closed; original room retained", error);
    return { status: "rejected", reason: error.message };
  }
}
