import * as THREE from "three";

const CONTACTS = [
  { name: "AGREED_iMac_Cylinder", opacity: .075, expand: 1.22 },
  { name: "AGREED_iMac_Plane.003", opacity: .055, expand: 1.06 },
  { name: "AGREED_MacBook_laptop14_body.001", opacity: .07, expand: 1.04 },
  { name: "REPL-v63-phone-001", opacity: .08, expand: 1.12 },
  { name: "ASSET-v61-ClayCup-Clay cup", opacity: .1, expand: 1.26 },
  { name: "GEO-v58-Notebook_Cover", opacity: .06, expand: 1.04 },
];

function radialTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 3, 64, 64, 62);
  gradient.addColorStop(0, "rgba(20,18,15,.92)");
  gradient.addColorStop(.38, "rgba(20,18,15,.52)");
  gradient.addColorStop(1, "rgba(20,18,15,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function addContactShadows(scene, room) {
  const group = new THREE.Group();
  group.name = "RUNTIME_CONTACT_SHADOWS";
  const texture = radialTexture();
  CONTACTS.forEach(({ name, opacity, expand }) => {
    const object = room.getObjectByName(name);
    if (!object) return;
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const width = Math.max(size.x * expand, .018);
    const depth = Math.max(size.z * expand, .018);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      toneMapped: false,
    });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
    shadow.name = `CONTACT_${name}`;
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(center.x, box.min.y + .00035, center.z);
    shadow.renderOrder = 3;
    group.add(shadow);
  });
  scene.add(group);
  return group;
}
