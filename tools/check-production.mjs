import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

const requiredFiles = [
  "index.html",
  "src/main.js",
  "src/config.js",
  "src/intro/IntroLoader.js",
  "src/intro/intro-loader.css",
  "src/lighting/StaticOcclusionSample.js",
  "public/vendor/three/three.module.js",
  "public/vendor/draco/draco_decoder.wasm",
  "public/model/myroom-studio-v1.glb",
  "public/assets/lighting/r7/manifest.json",
  "public/assets/lighting/r7/atlas.png",
  "public/assets/intro/room-line-art-native-grouped-v14-sketch-v5.svg",
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
  ["public/assets/intro/room-line-art-native-grouped-v14-sketch-v5.svg", "735da47c000fc49699ffe47c9656d74eb4e80c15041f39d16148889532eab6dd"],
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
if (!config.includes("https://daoyi2026.github.io/Moonrise/")) {
  throw new Error("Production window portal does not reference Moonrise");
}

const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
if (!index.includes("./src/intro/intro-loader.css") || !index.includes("data-intro-line-art")) {
  throw new Error("Production intro loader markup or stylesheet is missing");
}

const roomApp = await readFile(new URL("../src/app/RoomApp.js", import.meta.url), "utf8");
if (!roomApp.includes("room-line-art-native-grouped-v14-sketch-v5.svg")) {
  throw new Error("Production RoomApp does not reference the approved line-art loader");
}

const lighting = await readFile(new URL("../src/lighting/StaticOcclusionSample.js", import.meta.url), "utf8");
if (!lighting.includes("./public/assets/lighting/r7/")) throw new Error("Production R7 lighting path is missing");
if (lighting.includes('query.get("lightingSample")')) throw new Error("Production lighting still requires a review query");

console.log("Production check passed: model, R7 lighting, media, and entry points are complete.");
