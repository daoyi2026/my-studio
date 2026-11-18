// Preserve the original model bounds and the lights configured from its screen.
// Remove phone presentation only after scene setup, before content can start.
export function hidePhone(room, scene, screens, contactShadows) {
  const roots = [], helpers = [];
  room.traverse((node) => { if (node.name === "REPL-v63-phone-Group") roots.push(node); });
  scene.traverse((node) => { if (node.name === "WEB_SCREEN_OCCLUSION_PHONE") helpers.push(node); });
  const phone = screens.screens.phone;
  const body = room.getObjectByName("REPL-v63-phone-001");
  if (roots.length !== 1 || helpers.length !== 1 || !body || !phone
    || phone.kind !== "phone" || phone.contentStarted || phone.iframe.getAttribute("src") !== "about:blank"
    || phone.fallback?.name !== "WEB_SCREEN_TRANSITION_PHONE") {
    throw new Error("Unstarted phone assembly contract unavailable");
  }
  const nodes = [];
  roots[0].traverse((node) => nodes.push(node));
  if (!nodes.includes(body) || !nodes.includes(phone.mesh) || !nodes.some((node) => node.isMesh)) {
    throw new Error("Phone screen/body is outside the phone assembly");
  }

  for (const node of nodes) {
    node.visible = false;
    if (node.isMesh) {
      node.castShadow = false;
      node.raycast = () => {};
    }
  }
  phone.object.removeFromParent();
  phone.element.remove();
  phone.iframe.remove();
  phone.fallback.removeFromParent();
  helpers[0].removeFromParent();
  const contact = contactShadows?.getObjectByName("CONTACT_REPL-v63-phone-001");
  if (contact) contact.visible = false;
  delete screens.screens.phone;
  screens.cameraState = null;
}
