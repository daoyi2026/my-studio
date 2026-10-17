import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const roomSource = await readFile(new URL("../src/app/RoomApp.js", import.meta.url), "utf8");
const screenSource = await readFile(new URL("../src/rendering/ScreenLayer.js", import.meta.url), "utf8");
const warmSource = roomSource.slice(roomSource.indexOf("  async warmFrames("), roomSource.indexOf("\n  updateMotion("));
const warmFrames = new Function(`return (${warmSource.replace("async warmFrames(", "async function(")});`)();
const nextTask = () => new Promise(setImmediate);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function fixture({ compile = "success", renderError = false, fence = true, gpuFailure = false } = {}) {
  const calls = [];
  const texture = { isTexture: true };
  const target = { name: "original-target" };
  let currentTarget = target;
  let waits = 0;
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1, TIMEOUT_EXPIRED: 2, WAIT_FAILED: 3,
    flush() { calls.push("flush"); },
    clientWaitSync() { calls.push("gpu-wait"); return gpuFailure ? 3 : waits++ ? 4 : 2; },
    deleteSync() { calls.push("delete-fence"); },
  };
  if (fence) gl.fenceSync = () => { calls.push("fence"); return {}; };
  const renderer = {
    shadowMap: { autoUpdate: false, needsUpdate: false },
    getRenderTarget: () => currentTarget,
    getActiveCubeFace: () => 2,
    getActiveMipmapLevel: () => 1,
    setRenderTarget(next, face, mip) {
      assert.equal(next, target);
      assert.equal(face, 2);
      assert.equal(mip, 1);
      currentTarget = next;
      calls.push("restore-target");
    },
    initTexture(value) { assert.equal(value, texture); calls.push("upload"); },
    render() {
      assert.equal(this.shadowMap.autoUpdate, true);
      assert.equal(this.shadowMap.needsUpdate, true);
      calls.push("render");
      currentTarget = null;
      if (renderError) throw new Error("draw failed");
    },
    getContext: () => gl,
  };
  if (compile !== "absent") renderer.compileAsync = async () => {
    calls.push("compile");
    if (compile === "failure") throw new Error("compile unavailable");
  };
  const app = {
    renderer,
    scene: {
      background: texture,
      environment: { isTexture: true, isRenderTargetTexture: true },
      traverseVisible(visit) {
        visit({ material: [{ visible: true, map: texture, normalMap: texture }, { visible: false, map: { isTexture: true } }] });
        visit({ isLight: true, map: texture });
      },
    },
    camera: {},
    screens: {
      async waitForPreviews() { calls.push("previews"); },
      render(force) { assert.equal(force, true); calls.push("screens"); },
    },
  };
  return { app, calls, assertRestored() {
    assert.deepEqual(renderer.shadowMap, { autoUpdate: false, needsUpdate: false });
    assert.equal(currentTarget, target);
  } };
}

// A pending preview must keep every renderer operation behind the readiness gate.
{
  const test = fixture();
  const previews = deferred();
  test.app.screens.waitForPreviews = () => previews.promise;
  let completed = false;
  const result = warmFrames.call(test.app).then((status) => { completed = true; return status; });
  await nextTask();
  assert.deepEqual(test.calls, []);
  assert.equal(completed, false);
  previews.resolve();
  assert.equal(await result, "compileAsync+textures+render");
  assert.equal(test.calls.filter((call) => call === "compile").length, 1);
  assert.equal(test.calls.filter((call) => call === "upload").length, 1);
  assert.ok(test.calls.indexOf("compile") < test.calls.indexOf("upload"));
  assert.ok(test.calls.indexOf("upload") < test.calls.indexOf("render"));
  assert.ok(test.calls.indexOf("render") < test.calls.indexOf("gpu-wait"));
  assert.equal(test.calls.filter((call) => call === "gpu-wait").length, 2);
  assert.ok(test.calls.includes("delete-fence"));
  test.assertRestored();
}

// Unsupported or failed parallel compilation still requires a complete real draw.
for (const compile of ["absent", "failure"]) {
  const test = fixture({ compile, fence: false });
  assert.equal(await warmFrames.call(test.app), "textures+render");
  assert.equal(test.calls.filter((call) => call === "render").length, 1);
  test.assertRestored();
}

// Draw/GPU errors must reject readiness and restore the caller's render state.
for (const options of [{ renderError: true }, { gpuFailure: true }]) {
  const test = fixture(options);
  await assert.rejects(warmFrames.call(test.app), /draw failed|could not finish/);
  test.assertRestored();
  if (options.gpuFailure) assert.ok(test.calls.includes("delete-fence"));
}

// Failed previews settle using the original fallback; successful ones replace it.
const previewStart = screenSource.indexOf("    const previewReady = new Promise(");
const previewEnd = screenSource.indexOf("\n    const fallback =", previewStart);
const makePreview = new Function("THREE", "PREVIEW_URLS", "fallbackMaterial", "kind", `${screenSource.slice(previewStart, previewEnd)}\nreturn previewReady;`);
for (const success of [false, true]) {
  let onLoad;
  let onError;
  let disposed = false;
  const fallback = { dispose() { disposed = true; } };
  const material = { map: fallback };
  const loaded = {};
  const THREE = {
    SRGBColorSpace: "srgb",
    TextureLoader: class { load(_url, ready, _progress, fail) { onLoad = ready; onError = fail; } },
  };
  const preview = makePreview.call({ webglScene: { userData: { maxAnisotropy: 8 } } }, THREE, { macbook: "preview.jpg" }, material, "macbook");
  if (success) onLoad(loaded);
  else onError(new Error("preview unavailable"));
  await preview;
  assert.equal(disposed, success);
  assert.equal(material.map, success ? loaded : fallback);
  if (success) {
    assert.equal(loaded.colorSpace, "srgb");
    assert.equal(loaded.anisotropy, 4);
  }
}

console.log("Room startup readiness checks passed: preview gate, one compile, unique uploads, full-shadow draw, GPU completion, fallback paths, and error-state restoration.");
