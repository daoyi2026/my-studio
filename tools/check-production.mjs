import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

const requiredFiles = [
  "index.html",
  "src/main.js",
  "src/config.js",
  "src/lighting/StaticOcclusionSample.js",
  "public/vendor/three/three.module.js",
  "public/vendor/draco/draco_decoder.wasm",
  "public/model/myroom-studio-v1.glb",
  "public/assets/lighting/r7/manifest.json",
  "public/assets/lighting/r7/atlas.png",
  "public/assets/audio/miracle-mountain.m4a",
  "public/assets/audio/piece-of-art.mp3",
  "public/assets/audio/zoo.mp3",
  "public/assets/audio/flowing-water.mp3",
  "public/assets/audio/waiting-for-love.m4a",
  "public/assets/audio/tomorrow-will-be-better.m4a",
  "public/assets/portfolio/portfolio-00.png",
  "public/assets/portfolio/portfolio-26.png",
  "public/content/kinetic-life-os/index.html",
  "public/experiences/galaxy/index.html",
];

const expectedHashes = new Map([
  ["public/model/myroom-studio-v1.glb", "6698b7fba6c7f7c51e8ab198ef54242083b603f930dc5eeb4ffa417d01e33de2"],
  ["public/assets/lighting/r7/atlas.png", "5283ef5892e8289181194d88864f63f04d7af2430f82cd32dad9373ffc542aaa"],
]);

for (const file of requiredFiles) {
  const info = await stat(new URL(`../${file}`, import.meta.url));
  if (!info.isFile() || info.size === 0) throw new Error(`Missing production file: ${file}`);
}

for (const [file, expected] of expectedHashes) {
  const bytes = await readFile(new URL(`../${file}`, import.meta.url));
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new Error(`Production hash mismatch: ${file}`);
}

const config = await readFile(new URL("../src/config.js", import.meta.url), "utf8");
if (!config.includes("./public/model/myroom-studio-v1.glb?rev=6698b7fb")) {
  throw new Error("Production model is not the default route");
}
if (config.includes("./reports/")) throw new Error("Production config references development reports");

const lighting = await readFile(new URL("../src/lighting/StaticOcclusionSample.js", import.meta.url), "utf8");
if (!lighting.includes("./public/assets/lighting/r7/")) throw new Error("Production R7 lighting path is missing");
if (lighting.includes('query.get("lightingSample")')) throw new Error("Production lighting still requires a review query");

console.log("Production check passed: model, R7 lighting, media, and entry points are complete.");
