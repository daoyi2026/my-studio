import * as THREE from "three";

export const NOTEBOOK_TEXT = {
  "zh": "哎呀，被你发现我的笔记本了～\n欢迎来我的房间玩！\n书架上的每一本书，我都写了一点小书评，不知道有没有哪一段能让你会心一笑。画板上放着我的几幅作品，打字机上留着我写的文章。如果想听点什么，麦克风那边还有我录的播客，欢迎收听～\n对了，虽然我们还不认识，但我有点好奇：偶然来到这里的你，会想对我说些什么呢？可以点击墙上的毛毡板，给我留一条消息。\n最后，偷偷告诉你一个小秘密：记得用望远镜看看窗外哦。\n窗外的世界会随着我的心情悄悄改变。也许下一次来，你就会看到完全不同的风景。\n祝你在这里玩得开心！",
  "en": "Oh! You found my notebook~\nWelcome to my room!\nI've written a little review of every book on the shelf. I wonder if any of them will make you smile. A few of my artworks are on the drawing board, and you'll find my writing at the typewriter. If you'd like something to listen to, you'll find some podcasts I've recorded over by the microphone. Feel free to have a listen~\nBy the way, we haven't met, but I'm a little curious: now that you've stumbled into my room, is there anything you'd like to say to me? You can click the felt board on the wall and leave me a message.\nFinally, here's a little secret: remember to look out the window through the telescope.\nThe world outside quietly changes with my mood. Maybe next time you visit, you'll see a completely different view.\nI hope you have fun here!"
};

const PAGES = [
  { name: "GEO-v58-Notebook_LeftPageSurface", material: "MAT-v58-Notebook_LeftPage", url: "./public/assets/notebook/room-notes-left-v5.webp" },
  { name: "GEO-v58-Notebook_RightPageSurface", material: "MAT-v58-Notebook_RightPage", url: "./public/assets/notebook/room-notes-right-v4.webp" },
];

function preservePrintedInk(material, source) {
  const previousCompile = source.onBeforeCompile;
  const previousKey = source.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    previousCompile.call(this, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace("#include <colorspace_fragment>", `
#include <colorspace_fragment>
#ifdef USE_MAP
  // NOTEBOOK_PRINTED_INK_BEGIN: leave the blank paper's PBR output untouched.
  vec3 notebookPrintedColor = linearToOutputTexel( vec4( sampledDiffuseColor.rgb, 1.0 ) ).rgb;
  vec3 notebookPaperColor = vec3( 247.0, 243.0, 237.0 ) / 255.0;
  vec3 notebookInkDifference = notebookPaperColor - notebookPrintedColor;
  float notebookInkCoverage = smoothstep( 0.01, 0.08, max( max( notebookInkDifference.r, notebookInkDifference.g ), notebookInkDifference.b ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, min( gl_FragColor.rgb, notebookPrintedColor ), notebookInkCoverage );
  // NOTEBOOK_PRINTED_INK_END: dark shadows are never brightened.
#endif`);
  };
  material.customProgramCacheKey = () => `${previousKey}|notebook-printed-ink-v1`;
}

export async function applyNotebookPages(root) {
  const pages = PAGES.map((binding) => {
    const matches = root.getObjectsByProperty("name", binding.name);
    const mesh = matches.length === 1 ? matches[0] : null;
    const material = mesh?.material;
    return mesh?.isMesh && !Array.isArray(material) && material?.name === binding.material && material.map
      ? { ...binding, mesh, material } : null;
  });
  if (pages.some((page) => !page)) return { status: "disabled", applied: [] };

  const loader = new THREE.TextureLoader();
  const results = await Promise.allSettled(pages.map((page) => loader.loadAsync(page.url)));
  if (results.some((result) => result.status === "rejected")) {
    results.forEach((result) => { if (result.status === "fulfilled") result.value.dispose(); });
    return { status: "fallback", applied: [] };
  }
  pages.forEach((page, index) => {
    const loaded = results[index].value;
    const material = page.material.clone();
    const map = page.material.map.clone();
    // Retain the GLB's UV quantization transform and the existing page flip.
    // Replace Source itself so the embedded image shared elsewhere is untouched.
    map.source = loaded.source;
    map.name = `NOTEBOOK_ROOM_NOTES_${index === 0 ? "ZH" : "EN"}`;
    map.needsUpdate = true;
    material.map = map;
    preservePrintedInk(material, page.material);
    material.needsUpdate = true;
    page.mesh.material = material;
    if (index === 0 && !page.mesh.userData.roomNotesSurfaceRaised) {
      // The printed surface intersected the paper block by up to 0.306 mm at
      // the first two glyphs. Preserve the block and separate only this decal.
      const raised = page.mesh.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, .0004, 0));
      page.mesh.position.copy(page.mesh.parent ? page.mesh.parent.worldToLocal(raised) : raised);
      page.mesh.userData.roomNotesSurfaceRaised = .0004;
      page.mesh.updateWorldMatrix(false, false);
    }
    loaded.dispose();
  });
  return { status: "applied", applied: pages.map((page) => page.name) };
}
