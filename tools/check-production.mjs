import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat, readdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const modelHash = "4ce10f1bb16cfe7fe89f90e25c171635f3392e2801e49fcbd6911f3a5baaf547";
const expectedHashes = new Map([
  ["public/model/myroom-studio-v1.glb", modelHash],
  ["public/assets/lighting/r7/manifest.json", "93a3844cca6be9fb8ed08ab6a0f12c28f04ada40b072a8ed8a477c716d59a208"],
  ["public/assets/lighting/r7/atlas.png", "8930c236593ac5583188f0c224ffda25c15935d4c065bb7d9d758bf1beedd138"],
  ["public/assets/intro/room-line-art-native-grouped-v14-sketch-v5.svg", "735da47c000fc49699ffe47c9656d74eb4e80c15041f39d16148889532eab6dd"],
  ["public/assets/models/rotring-800-v1.glb", "3ecd7135ba64c0ae76393f97fac6d29b9f9315fe611188bed898f1e6530f342d"],
  ["public/assets/notebook/room-notes-left-v5.webp", "848e9c94b6d3d6f1022fba0dc62d39ed317f7675008dc563f92e9a6a5361c6ec"],
  ["public/assets/notebook/room-notes-right-v4.webp", "b98d9a344bbe8ff37764edc9a06ec9eec1d4c60f6ec8406a66df56e687fc59f1"],
  ["public/assets/screens/macbook-github-pages-desk-review-v03-1425x947.jpg", "5d45185a01a28965077d051634eb9aeb8a88207787f079281fa907fec93c1599"],
  ["public/assets/branding/substack-logo.png", "933248bfcc6f071686edca4a5f024012ac4b821063ec2a9c5f068327c3dce68a"],
]);
const requiredFiles = [
  "index.html", "src/main.js", "src/config.js", "src/intro/IntroLoader.js", "src/intro/intro-loader.css",
  "public/vendor/three/three.module.js", "public/vendor/draco/draco_decoder.wasm",
  "public/assets/models/rotring-800-CREDITS.txt", "public/content/substack-posts.json", "tools/sync-substack.py",
  "public/content/kinetic-life-os/index.html", "public/experiences/galaxy/index.html",
  ...Array.from({ length: 27 }, (_, i) => `public/assets/portfolio/portfolio-${String(i).padStart(2, "0")}.png`),
  ...Array.from({ length: 14 }, (_, i) => `public/assets/photos/red-${String(i + 1).padStart(2, "0")}.jpg`),
  ...Array.from({ length: 7 }, (_, i) => `public/assets/photos/green-${String(i + 1).padStart(2, "0")}.jpg`),
  ...expectedHashes.keys(),
];
async function requireFile(url) {
  const info = await stat(url);
  assert.ok(info.isFile() && info.size > 0, `Missing production file: ${url.pathname}`);
}
for (const file of requiredFiles) await requireFile(new URL(file, root));
for (const [file, expected] of expectedHashes) {
  const bytes = await readFile(new URL(file, root));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), expected, `Production hash mismatch: ${file}`);
}

function glbJSON(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "glTF");
  assert.equal(bytes.readUInt32LE(4), 2); assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  return JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
}
const model = glbJSON(await readFile(new URL("public/model/myroom-studio-v1.glb", root)));
for (const prefix of ["IMAC", "MACBOOK", "PHONE"]) for (const suffix of ["TL", "TR", "BR", "BL", "CENTER", "NORMAL"]) {
  assert.equal(model.nodes.filter(node => node.name === `${prefix}_SCREEN_${suffix}`).length, 1, `Unique ${prefix} screen anchor ${suffix}`);
}
assert.ok(model.materials.some(material => /laptop14_screen/i.test(material.name)), "Physical MacBook screen binding");
const pen = glbJSON(await readFile(new URL("public/assets/models/rotring-800-v1.glb", root)));
const penTriangles = pen.meshes.flatMap(mesh => mesh.primitives).reduce((sum, primitive) => sum + pen.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3, 0);
assert.equal(penTriangles, 463); assert.equal(pen.materials.length, 5);
const manifest = JSON.parse(await readFile(new URL("public/assets/lighting/r7/manifest.json", root)));
assert.equal(manifest.version, "r7-ao-desk-vintage-v01"); assert.equal(manifest.sourceSha256, modelHash);
assert.equal(manifest.receivers.length, 10); assert.equal(new Set(manifest.receivers.map(receiver => receiver.name)).size, 10);
assert.equal(manifest.textureSha256, expectedHashes.get("public/assets/lighting/r7/atlas.png"));
const atlas = await readFile(new URL("public/assets/lighting/r7/atlas.png", root));
assert.equal(atlas.length, manifest.textureBytes); assert.equal(atlas.readUInt32BE(16), manifest.width); assert.equal(atlas.readUInt32BE(20), manifest.height);
for (const receiver of manifest.receivers) {
  assert.equal(receiver.uv.length, receiver.indexCount * 2);
  assert.ok(receiver.uv.every(value => Number.isFinite(value) && value > 0 && value < 1));
}

const config = await readFile(new URL("src/config.js", root), "utf8");
assert.ok(config.includes("./public/model/myroom-studio-v1.glb?rev=4ce10f1b"), "Accepted model is the production default");
assert.ok(config.includes("https://daoyi2026.github.io/Moonrise/") && config.includes('macbook: "https://daoyi2026.github.io/"'));
const index = await readFile(new URL("index.html", root), "utf8");
assert.ok(index.includes("./src/main.js?v=122") && index.includes("data-intro-line-art"));
assert.ok(index.includes('href="mailto:rendaoyi@outlook.com"'));
const lighting = await readFile(new URL("src/lighting/StaticOcclusionSample.js", root), "utf8");
assert.ok(lighting.includes("./public/assets/lighting/r7/") && lighting.includes(modelHash));
assert.ok(!lighting.includes('query.get("lightingSample")'), "Production R7 needs no review query");
const screens = await readFile(new URL("src/rendering/ScreenLayer.js", root), "utf8");
assert.ok(screens.includes('macbook: "./public/assets/screens/macbook-github-pages-desk-review-v03-1425x947.jpg"'));
assert.ok(!screens.includes('get("reviewModel")'), "Production fallback is independent of a review query");
const roomApp = await readFile(new URL("src/app/RoomApp.js", root), "utf8");
assert.match(roomApp, /new IntroLoader\([^;]*lineArtUrl: INTRO_LINE_ART_URL/);
assert.ok(roomApp.includes('const INTRO_LINE_ART_URL = "./public/assets/intro/room-line-art-native-grouped-v14-sketch-v5.svg?rev=production-clean-wall-v5"'));

// Check the actual reachable module graph, including vendor-relative imports.
const importPattern = /(?:^\s*import\s+(?:[^;"']*?\s+from\s*)?|^\s*export\s+(?:\{[^}]*\}|\*)\s+from\s*)["']([^"']+)["']/gm;
const visited = new Set();
async function checkModule(url) {
  url = new URL(url); url.search = ""; url.hash = "";
  assert.ok(url.href.startsWith(root.href), "Module stays inside the static site");
  if (visited.has(url.href)) return; visited.add(url.href);
  await requireFile(url);
  const source = await readFile(url, "utf8");
  for (const [, specifier] of source.matchAll(importPattern)) {
    const dependency = specifier === "three" ? new URL("public/vendor/three/three.module.js", root)
      : specifier.startsWith("three/addons/") ? new URL(`public/vendor/three/addons/${specifier.slice(13)}`, root)
        : specifier.startsWith(".") ? new URL(specifier, url) : null;
    assert.ok(dependency, `Unexpected external module: ${specifier}`);
    await checkModule(dependency);
  }
}
await checkModule(new URL("src/main.js", root));
for (const [, reference] of index.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
  if (reference.startsWith(".")) await requireFile(new URL(reference, root));
}
async function checkRuntimeText(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) { await checkRuntimeText(url); continue; }
    if (!/\.(?:js|css)$/.test(entry.name)) continue;
    const source = await readFile(url, "utf8");
    assert.ok(!/(?:\.\/reports\/|\/Users\/|\/tmp\/|shadowAudit|render-cost-audit|iframe-isolation|static-batch-prototype)/.test(source), `Development reference in ${url.pathname}`);
    for (const [, reference] of source.matchAll(/["'`](\.\/public\/[^"'`\s]+)["'`]/g)) {
      if (reference.includes("${")) continue;
      // The sole production loader always supplies the verified SVG above.
      // Its reusable class's unused demo default is not a shipping asset.
      if (url.pathname.endsWith("/src/intro/IntroLoader.js") && reference === "./public/assets/intro/test-line-art.svg") continue;
      const asset = new URL(reference, root); asset.search = "";
      if (asset.pathname.endsWith("/")) assert.ok((await stat(asset)).isDirectory());
      else await requireFile(asset);
    }
  }
}
await checkRuntimeText(new URL("src/", root));
const { BOOKS, PLAYLIST } = await import(new URL("src/content/roomContent.js", root));
for (const reference of [...BOOKS.map(book => book.cover), ...PLAYLIST.map(track => track.audioUrl)]) await requireFile(new URL(reference, root));
const { validateWritingFeed } = await import(new URL("src/content/writingFeed.js", root));
validateWritingFeed(JSON.parse(await readFile(new URL("public/content/substack-posts.json", root))));
console.log(`Production check passed: exact model/R7/pen/pages, 18 screen anchors, ${visited.size} reachable modules and all runtime asset references.`);
