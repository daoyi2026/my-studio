import assert from "node:assert/strict";
import { IntroLoader } from "../src/intro/IntroLoader.js";

const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
let scheduled;
const cleared = [];

globalThis.setTimeout = (callback, delay) => {
  scheduled = { callback, delay };
  return 41;
};
globalThis.clearTimeout = (timer) => cleared.push(timer);
globalThis.cancelAnimationFrame = (frame) => cleared.push(frame);

try {
  const earlyLoader = {
    animationCompletionFallbackTimer: 0,
    getLineDrawSpeed: () => 18,
    lineArtReady: false,
    lineProgress: 98.5,
    options: { lineDrawMaxSpeedPercentPerSecond: 18 },
    progress: 99,
    progressLastAdvancedAt: performance.now(),
    progressRate: 0,
    progressSampleAt: performance.now(),
    reducedMotion: false,
    renderDebug() {},
    renderProgress() {},
    resolveAnimation: () => {},
    runToken: 2,
    schedulePathAnimationCompletionFallback: IntroLoader.prototype.schedulePathAnimationCompletionFallback,
  };

  IntroLoader.prototype.setProgress.call(earlyLoader, 100);
  assert.equal(earlyLoader.animationCompletionFallbackTimer, 41);
  assert.equal(scheduled.delay, 484);

  let resolved = 0;
  const loader = {
    animationCompletionFallbackTimer: 0,
    animationFrame: 7,
    getLineDrawSpeed: () => 18,
    lineArtReady: false,
    lineProgress: 98,
    options: { lineDrawMaxSpeedPercentPerSecond: 18 },
    pathRecords: [{ path: { style: {} } }],
    progress: 100,
    resolveAnimation: () => { resolved += 1; },
    runToken: 3,
    completePathAnimation: IntroLoader.prototype.completePathAnimation,
  };

  IntroLoader.prototype.schedulePathAnimationCompletionFallback.call(loader, 3);
  assert.equal(scheduled.delay, 512);
  assert.equal(loader.animationCompletionFallbackTimer, 41);

  scheduled.callback();
  assert.equal(loader.lineProgress, 100);
  assert.equal(loader.pathRecords[0].path.style.strokeDashoffset, "0px");
  assert.equal(resolved, 1);
  assert.equal(loader.animationCompletionFallbackTimer, 0);
  assert.equal(IntroLoader.prototype.completePathAnimation.call(loader, 3), false);
  assert.equal(resolved, 1);

  loader.animationCompletionFallbackTimer = 52;
  loader.lineArtReady = false;
  loader.resolveAnimation = () => { resolved += 1; };
  assert.equal(IntroLoader.prototype.completePathAnimation.call(loader, 3), true);
  assert.ok(cleared.includes(52));
} finally {
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
}

console.log("Intro loader completion fallback check passed.");
