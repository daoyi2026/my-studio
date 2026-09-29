const STATES = Object.freeze({
  BOOT: "BOOT",
  DRAWING: "DRAWING",
  WAITING: "WAITING",
  COMPLETING: "COMPLETING",
  TRANSITION: "TRANSITION",
  READY: "READY",
  ERROR: "ERROR",
});

const SVG_NS = "http://www.w3.org/2000/svg";

const DEFAULT_PROGRESS_STAGES = Object.freeze([
  { start: 0, end: 28, label: "ORGANIZING ROOM" },
  { start: 28, end: 56, label: "ARRANGING BOOKSHELF" },
  { start: 56, end: 82, label: "ORGANIZING DESK" },
  { start: 82, end: 96, label: "PLACING ROOM OBJECTS" },
  { start: 96, end: 100, label: "FINAL CHECK" },
]);

const PATH_STAGE_RANGES = Object.freeze({
  architecture: { start: 0, end: 0.28 },
  // Keep the stage windows adjacent. The authored group windows in older SVGs
  // overlap by design, but the loader must serialize those groups globally.
  // Give the shelf-to-desk sequence its full authored interval. Compressing
  // all furniture back into 28%-56% makes the desk leak into the shelf phase.
  furniture: { start: 0.28, end: 0.72 },
  objects: { start: 0.72, end: 0.94 },
  details: { start: 0.94, end: 1 },
  fallback: { start: 0, end: 1 },
});

// A stroke's first few pixels are often just the endpoint of a curved
// Freestyle contour. Showing that endpoint on its own reads as a floating
// dot, especially in the black opening frame. Hold that tiny head back and
// begin the visible dash once enough of the stroke can read as a line.
const PATH_MIN_VISIBLE_FRACTION = 0.08;
// A few Freestyle outputs are mathematically valid but render as isolated
// pixels at the review size. Keep short strokes that actually join another
// contour, while dropping sub-pixel noise and unconnected fragments.
const HARD_MIN_STROKE_SCREEN_PIXELS = 1.0;
const ISOLATED_FRAGMENT_SCREEN_PIXELS = 2.4;
const ISOLATED_FRAGMENT_RADIUS_PIXELS = 5;

// A few authored detail groups are dense meshes rather than clean furniture
// contours. The third shelf tier is the known example: the photo frame and
// sculpture are useful, but their source meshes also produce dozens of tiny
// Freestyle fragments. Keep this policy local to that group so the small
// articulated lamp, telescope stand, and chair details remain readable.
const DENSE_DETAIL_FRAGMENT_POLICIES = Object.freeze({
  "shelf-layer-03-items": Object.freeze({
    minScreenLength: 10,
    joinRadius: 1.75,
  }),
});

// Legacy or hand-authored SVGs may not carry per-stroke data-stage metadata.
// Keep their review behavior honest by spreading untyped strokes over the
// same visual phases instead of treating the entire drawing as architecture.
const UNTAGGED_STAGE_BREAKS = Object.freeze([
  { end: 0.18, stage: "architecture" },
  { end: 0.60, stage: "furniture" },
  { end: 0.88, stage: "objects" },
  { end: 1, stage: "details" },
]);

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function visiblePathProgress(pathProgress) {
  if (pathProgress <= PATH_MIN_VISIBLE_FRACTION) return 0;
  return clamp((pathProgress - PATH_MIN_VISIBLE_FRACTION) / (1 - PATH_MIN_VISIBLE_FRACTION));
}

function getPathPoint(path, length, atEnd = false) {
  try {
    const point = path.getPointAtLength(atEnd ? length : 0);
    return { x: point.x, y: point.y };
  } catch {
    return null;
  }
}

function pointDistance(left, right) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  return Math.hypot(left.x - right.x, left.y - right.y);
}

/**
 * Order strokes as a pen would travel through them. Object order remains the
 * outer boundary when the exporter supplied it (for example, lamp arms before
 * the shade); within each object, the nearest endpoint wins. The queue keeps
 * that continuity as an ordering hint while each path still grows from its
 * authored start, so hidden paths cannot expose a reversed cap as a dot.
 */
function orderForContinuousStroke(records) {
  const hasExplicitSequence = records.length > 0
    && records.every((record) => Number.isFinite(record.sequenceOrder));
  if (hasExplicitSequence) {
    return records.slice().sort((left, right) => (
      left.sequenceOrder - right.sequenceOrder
      || Number(left.path.dataset.introPathIndex) - Number(right.path.dataset.introPathIndex)
    ));
  }

  const buckets = new Map();
  const hasObjectOrder = records.some((record) => Number.isFinite(record.objectOrder));
  records.forEach((record) => {
    const key = hasObjectOrder && Number.isFinite(record.objectOrder)
      ? record.objectOrder
      : "single-object-queue";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(record);
  });

  const ordered = [];
  [...buckets.entries()]
    .sort(([left], [right]) => (
      typeof left === "number" && typeof right === "number"
        ? left - right
        : typeof left === "number" ? -1 : typeof right === "number" ? 1 : 0
    ))
    .forEach(([, bucket]) => {
      const remaining = bucket.slice().sort((left, right) => (
        Number(left.path.dataset.introPathIndex) - Number(right.path.dataset.introPathIndex)
      ));
      if (!remaining.length) return;

      let current = remaining.shift();
      current.reverse = false;
      ordered.push(current);
      let exitPoint = current.endPoint;

      while (remaining.length) {
        let bestIndex = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        let bestReverse = false;
        remaining.forEach((candidate, index) => {
          const distanceToStart = pointDistance(exitPoint, candidate.startPoint);
          const distanceToEnd = pointDistance(exitPoint, candidate.endPoint);
          const reverse = distanceToEnd < distanceToStart;
          const distance = reverse ? distanceToEnd : distanceToStart;
          if (
            distance < bestDistance
            || (distance === bestDistance && Number(candidate.path.dataset.introPathIndex)
              < Number(remaining[bestIndex]?.path.dataset.introPathIndex))
          ) {
            bestIndex = index;
            bestDistance = distance;
            bestReverse = reverse;
          }
        });

        current = remaining.splice(bestIndex, 1)[0];
        current.reverse = bestReverse;
        ordered.push(current);
        exitPoint = current.reverse ? current.startPoint : current.endPoint;
      }
    });
  return ordered;
}

function dashOffsetForProgress(record, pathProgress) {
  const dashLength = record.dashLength ?? record.length;
  // Keep the hidden state identical for every path. A negative offset for a
  // not-yet-started reversed path can expose the round line cap as a dot in
  // some SVG engines. Queue continuity still controls which path starts next;
  // the dash itself always grows from its authored start.
  return dashLength * (1 - pathProgress);
}

function samePathGroup(left, right) {
  if (left.group !== right.group) return false;
  if (Number.isFinite(left.objectOrder) && Number.isFinite(right.objectOrder)) {
    return left.objectOrder === right.objectOrder;
  }
  return true;
}

function filterFragmentRecords(records, viewportScale) {
  const scale = Math.max(0.0001, viewportScale);
  return records.filter((record) => {
    const policy = DENSE_DETAIL_FRAGMENT_POLICIES[record.group] || {
      minScreenLength: ISOLATED_FRAGMENT_SCREEN_PIXELS,
      joinRadius: ISOLATED_FRAGMENT_RADIUS_PIXELS,
    };
    const screenLength = record.length * scale;
    if (screenLength <= HARD_MIN_STROKE_SCREEN_PIXELS) return false;
    if (screenLength >= policy.minScreenLength) return true;
    return records.some((candidate) => (
      candidate !== record
      && samePathGroup(record, candidate)
      && candidate.length * scale >= policy.minScreenLength
      && Math.min(
        pointDistance(record.startPoint, candidate.startPoint),
        pointDistance(record.startPoint, candidate.endPoint),
        pointDistance(record.endPoint, candidate.startPoint),
        pointDistance(record.endPoint, candidate.endPoint),
      ) <= policy.joinRadius / scale
    ));
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function resolveAssetUrl(assetPath) {
  return new URL(assetPath, document.baseURI).href;
}

function mediaPrefersReducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function debugRequested() {
  const params = new URLSearchParams(window.location.search);
  return params.get("introDebug") === "1" || params.get("introDebug") === "true";
}

/**
 * Independent intro-loader controller.
 *
 * The controller owns only the temporary line-art layer. The host application
 * owns the Three.js scene and opens the second gate with markSceneReady().
 * The loader never changes materials, lights, models, cameras, or controls.
 */
export class IntroLoader {
  static STATES = STATES;

  constructor(root, options = {}) {
    if (!root) throw new Error("IntroLoader requires a root element");

    const legacySlowNetworkAfterMs = options.slowNetworkAfterMs;
    this.root = root;
    this.options = {
      lineArtUrl: "./public/assets/intro/test-line-art.svg",
      minimumIntroDurationMs: 0,
      completeHoldMs: 450,
      crossfadeDurationMs: 7000,
      reducedMotionDurationMs: 500,
      comfortLeadPercent: 2.5,
      comfortStallCapPercent: 6,
      visualCompletionGuardPercent: 1.5,
      // A stalled host still gets a visible, bounded pen advance. The cap
      // keeps this reassuring motion honest without allowing the line art to
      // overtake a genuinely slow scene by more than a small amount.
      comfortDriftSpeedPercentPerSecond: 1.8,
      lineDrawMinSpeedPercentPerSecond: 7,
      lineDrawMaxSpeedPercentPerSecond: 18,
      lineDrawSpeedMultiplier: 1.1,
      // Keep the first real frame visually empty. The host reports a small
      // bootstrap percentage before the SVG has a readable stroke to show;
      // mapping that window to zero prevents a compound wall path from
      // appearing as several lines in the opening frame.
      visualStartPercent: 3,
      slowHoldAfterMs: legacySlowNetworkAfterMs ?? 1800,
      slowMessageAfterMs: 10000,
      slowStatus: "STILL WORKING",
      progressStages: DEFAULT_PROGRESS_STAGES,
      reducedMotion: null,
      debug: debugRequested(),
      onRetry: null,
      ...options,
    };
    this.options.debug = options.debug ?? this.options.debug;
    this.options.slowHoldAfterMs = options.slowHoldAfterMs ?? legacySlowNetworkAfterMs ?? this.options.slowHoldAfterMs;

    this.lineArtHost = root.querySelector("[data-intro-line-art]");
    this.statusElement = root.querySelector("[data-intro-status]");
    this.progressElement = root.querySelector("[data-intro-progress-label]");
    this.percentElement = root.querySelector("[data-intro-percent]");
    this.errorElement = root.querySelector("[data-intro-error]");
    this.retryButton = root.querySelector("[data-intro-retry]");
    this.debugElement = root.querySelector("[data-intro-debug]");

    if (!this.lineArtHost) throw new Error("IntroLoader requires [data-intro-line-art]");
    this.lineArtHost.dataset.introVisible = "false";

    this.state = STATES.BOOT;
    this.progress = 0;
    this.lineProgress = 0;
    this.lastComfortTarget = 0;
    this.sceneReady = false;
    this.lineArtReady = false;
    this.warmupStatus = "pending";
    this.lineArtSource = "pending";
    this.slowMode = false;
    this.pathRecords = [];
    this.lastRenderedProgress = -1;
    this.stateListeners = new Set();
    this.reducedMotion = this.options.reducedMotion == null ? mediaPrefersReducedMotion() : Boolean(this.options.reducedMotion);
    this.startedAt = performance.now();
    this.progressSampleAt = this.startedAt;
    this.progressLastAdvancedAt = this.startedAt;
    this.progressRate = 0;
    this.slowTimer = 0;
    this.slowMessageTimer = 0;
    this.completionTimer = 0;
    this.animationCompletionFallbackTimer = 0;
    this.animationFrame = 0;
    this.lastAnimationTime = 0;
    this.resolveAnimation = null;
    this.runToken = 0;
    this.runPromise = null;
    this.revealRequested = false;
    this.completionPending = false;
    this.transitionStarted = false;
    this.revealPromise = null;
    this.resolveReveal = null;

    this.root.classList.add("intro-loader");
    this.root.dataset.introState = STATES.BOOT;
    this.root.dataset.introMotion = this.reducedMotion ? "reduced" : "full";
    this.root.setAttribute("aria-busy", "true");
    this.retryButton?.addEventListener("click", () => {
      if (this.options.onRetry) this.options.onRetry(this.lastError);
      else window.location.reload();
    });
    this.renderDebug();
    this.setProgress(0);
    this.resizeHandler = () => {
      const svg = this.lineArtHost.querySelector("svg[data-intro-camera]");
      if (svg) {
        this.fitSvgToViewport(svg);
        this.syncPathDashMetrics();
      }
    };
    window.addEventListener("resize", this.resizeHandler, { passive: true });
  }

  onStateChange(listener) {
    if (typeof listener !== "function") return () => {};
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  getSnapshot() {
    return {
      state: this.state,
      progress: this.progress,
      loadProgress: this.progress,
      displayProgress: this.lineProgress,
      lineProgress: this.lineProgress,
      sceneReady: this.sceneReady,
      lineArtReady: this.lineArtReady,
      pathCount: this.pathRecords.length,
      lineArtSource: this.lineArtSource,
      warmupStatus: this.warmupStatus,
      reducedMotion: this.reducedMotion,
      slowMode: this.slowMode,
      elapsedMs: Math.round(performance.now() - this.startedAt),
    };
  }

  setState(nextState, reason = "") {
    if (!Object.values(STATES).includes(nextState)) throw new Error(`Unknown intro state: ${nextState}`);
    this.state = nextState;
    this.root.dataset.introState = nextState;
    if (reason) this.root.dataset.introReason = reason;
    this.stateListeners.forEach((listener) => listener(this.getSnapshot()));
    this.renderDebug();
  }

  setStatus(message, { visible = Boolean(message) } = {}) {
    if (this.statusElement) {
      this.statusElement.textContent = message;
      this.statusElement.hidden = !visible;
    }
    if (message) this.root.setAttribute("aria-label", message);
  }

  /**
   * Host hook retained for the future integration adapter. The review page
   * renders this as a quiet textual status and percentage, never as a bar.
   */
  setProgress(value, status = null) {
    const nextProgress = Math.max(this.progress, clamp(Number(value) / 100) * 100);
    const now = performance.now();
    const elapsedSeconds = Math.max(0, now - this.progressSampleAt) / 1000;
    if (nextProgress > this.progress && elapsedSeconds > 0) {
      const observedRate = (nextProgress - this.progress) / elapsedSeconds;
      this.progressRate = this.progressRate > 0
        ? this.progressRate * .75 + observedRate * .25
        : observedRate;
    }
    this.progressSampleAt = now;
    if (nextProgress > this.progress) this.progressLastAdvancedAt = now;
    this.progress = nextProgress;
    if (this.progress >= 100) this.schedulePathAnimationCompletionFallback(this.runToken);
    this.renderProgress(status);
    this.renderDebug();
  }

  renderProgress(status = null) {
    // Before the line art finishes, the visible frontier follows the drawing;
    // after that, it follows the host until the scene gate opens. The shared
    // value may still move by the small bounded comfort allowance during a
    // stall, but it must never announce readiness for only one gate.
    // A completed line drawing is not the same thing as a ready Three.js
    // scene. Keep the displayed percentage tied to the host until both gates
    // are open; otherwise the decorative SVG can announce 100% while
    // RoomApp is still inside renderer warm-up.
    const completionReady = this.sceneReady && this.lineArtReady;
    const visibleProgress = completionReady
      ? 100
      : this.lineArtReady
        ? Math.min(99.4, this.progress)
        : this.lineProgress;
    const roundedProgress = Math.round(visibleProgress);
    const slowSuffix = this.slowMode && this.root.classList.contains("is-slow-message")
      ? ` · ${this.options.slowStatus}`
      : "";
    const progressStage = completionReady
      ? "ROOM READY"
      : `${this.getProgressStage(visibleProgress)}${slowSuffix}`;
    if (roundedProgress !== this.lastRenderedProgress) {
      if (this.progressElement) this.progressElement.textContent = progressStage;
      if (this.percentElement) this.percentElement.textContent = `${roundedProgress}%`;
      this.lastRenderedProgress = roundedProgress;
    } else if (this.progressElement && this.progressElement.textContent !== progressStage) {
      this.progressElement.textContent = progressStage;
    }
  }

  /** Update real host progress; it gates completion and drives the shared visible progress. */
  updateLoadProgress(value, status = null) {
    this.setProgress(value, status);
  }

  getProgressStage(value) {
    const stage = this.options.progressStages.find(({ start, end }, index) => (
      value >= start && (value < end || index === this.options.progressStages.length - 1)
    ));
    return stage?.label || this.options.progressStages.at(-1)?.label || "ORGANIZING ROOM";
  }

  getVisualTarget(actualProgress) {
    // A true zero-progress frame must remain empty. The comfort lead is only
    // allowed after the host has reported the first real loading increment.
    if (actualProgress <= 0) return 0;
    if (actualProgress >= 100) return 100;
    const visualStartPercent = clamp(Number(this.options.visualStartPercent) / 100) * 100;
    if (actualProgress <= visualStartPercent) return 0;
    const visualProgress = ((actualProgress - visualStartPercent) / Math.max(1, 100 - visualStartPercent)) * 100;
    const completionGuard = clamp(Number(this.options.visualCompletionGuardPercent) / 100) * 100;
    const latestSafeTarget = Math.max(0, 100 - completionGuard);
    return Math.min(latestSafeTarget, visualProgress + this.options.comfortLeadPercent);
  }

  getLineDrawSpeed() {
    const minimum = this.options.lineDrawMinSpeedPercentPerSecond;
    const maximum = this.options.lineDrawMaxSpeedPercentPerSecond;
    const estimated = this.progressRate > 0
      ? this.progressRate * this.options.lineDrawSpeedMultiplier
      : minimum;
    return Math.min(maximum, Math.max(minimum, estimated));
  }

  getComfortTarget(actualProgress) {
    const baseTarget = this.getVisualTarget(actualProgress);
    if (actualProgress <= 0) {
      this.lastComfortTarget = 0;
      return 0;
    }
    if (actualProgress >= 100) {
      this.lastComfortTarget = 100;
      return 100;
    }
    const stalledSeconds = Math.max(0, performance.now() - this.progressLastAdvancedAt) / 1000;
    const comfortDrift = Math.min(
      this.options.comfortStallCapPercent,
      stalledSeconds * this.options.comfortDriftSpeedPercentPerSecond,
    );
    const target = Math.min(
      100 - this.options.visualCompletionGuardPercent,
      baseTarget + comfortDrift,
    );
    // A small real-progress update must not pull the visual frontier backward
    // after it has already provided reassurance during a stall. Keeping this
    // target monotonic prevents a visible freeze-and-catch-up rhythm.
    this.lastComfortTarget = Math.max(this.lastComfortTarget, target);
    return this.lastComfortTarget;
  }

  /** Start loading and drawing a line-art source without touching the host app. */
  async start(lineArtUrl = this.options.lineArtUrl) {
    if ([STATES.DRAWING, STATES.WAITING, STATES.COMPLETING, STATES.TRANSITION].includes(this.state)) {
      return this.runPromise;
    }

    this.resetForRun();
    const token = ++this.runToken;
    this.runPromise = this.loadAndDraw(lineArtUrl, token);
    return this.runPromise;
  }

  resetForRun() {
    cancelAnimationFrame(this.animationFrame);
    clearTimeout(this.slowTimer);
    clearTimeout(this.slowMessageTimer);
    clearTimeout(this.completionTimer);
    clearTimeout(this.animationCompletionFallbackTimer);
    this.animationFrame = 0;
    this.slowTimer = 0;
    this.slowMessageTimer = 0;
    this.completionTimer = 0;
    this.animationCompletionFallbackTimer = 0;
    this.lastAnimationTime = 0;
    this.resolveAnimation = null;
    this.state = STATES.BOOT;
    this.progress = 0;
    this.lastComfortTarget = 0;
    this.progressSampleAt = performance.now();
    this.progressLastAdvancedAt = this.progressSampleAt;
    this.progressRate = 0;
    this.lineProgress = 0;
    this.sceneReady = false;
    this.lineArtReady = false;
    this.warmupStatus = "pending";
    this.lineArtSource = "pending";
    this.slowMode = false;
    this.pathRecords = [];
    this.lastRenderedProgress = -1;
    this.lastError = null;
    this.revealRequested = false;
    this.completionPending = false;
    this.transitionStarted = false;
    this.revealPromise = null;
    this.resolveReveal = null;
    this.root.classList.remove("is-revealing", "is-complete", "is-error", "is-slow", "is-slow-message");
    this.root.style.removeProperty("--intro-crossfade-duration");
    this.root.setAttribute("aria-busy", "true");
    this.root.dataset.introState = STATES.BOOT;
    this.root.dataset.introMotion = this.reducedMotion ? "reduced" : "full";
    if (this.errorElement) {
      this.errorElement.hidden = true;
      this.errorElement.textContent = "";
    }
    if (this.retryButton) this.retryButton.hidden = true;
    this.setProgress(0);
    this.lineArtHost.dataset.introVisible = "false";
    this.lineArtHost.replaceChildren();
    this.renderDebug();
  }

  async loadAndDraw(lineArtUrl, token) {
    this.startedAt = performance.now();
    this.progressLastAdvancedAt = this.startedAt;
    this.setState(STATES.BOOT, "line-art-request");
    this.beginSlowTimers();

    let svg;
    try {
      svg = await this.fetchSvg(lineArtUrl);
      this.lineArtSource = lineArtUrl;
    } catch (error) {
      // A missing future export remains a visible, recoverable single-path
      // proof. Production integration may replace this with a stricter error
      // policy without changing the state machine contract.
      this.lineArtSource = "fallback-single-path";
      this.lastError = error;
      svg = this.createFallbackSvg();
    }

    if (token !== this.runToken) return this.getSnapshot();
    this.installSvg(svg);
    this.setState(STATES.DRAWING, this.lineArtSource === "fallback-single-path" ? "fallback" : "path-growth");
    this.setProgress(0);
    await this.animatePaths(token);
    if (token !== this.runToken || this.state === STATES.ERROR) return this.getSnapshot();

    this.lineArtReady = true;
    this.lineProgress = 100;
    if (this.sceneReady) {
      this.setProgress(100, "ROOM READY");
      this.setState(STATES.COMPLETING, "line-art-complete");
    } else {
      // Do not promote the host progress to 100 just because the decorative
      // line art finished first. The scene gate may still be warming shaders
      // or completing its final render preparation.
      this.renderProgress();
      this.setState(STATES.WAITING, "line-art-complete");
    }
    this.renderDebug();
    this.maybeComplete();
    return this.getSnapshot();
  }

  completePathAnimation(token) {
    if (token !== this.runToken || this.lineArtReady || !this.resolveAnimation) return false;
    clearTimeout(this.animationCompletionFallbackTimer);
    this.animationCompletionFallbackTimer = 0;
    cancelAnimationFrame(this.animationFrame);
    this.pathRecords.forEach(({ path }) => { path.style.strokeDashoffset = "0px"; });
    this.lineProgress = 100;
    this.animationFrame = 0;
    this.resolveAnimation?.();
    this.resolveAnimation = null;
    return true;
  }

  schedulePathAnimationCompletionFallback(token) {
    if (
      this.reducedMotion
      || this.animationCompletionFallbackTimer
      || this.progress < 100
      || this.lineArtReady
      || !this.resolveAnimation
    ) return;
    const drawSpeed = Math.max(this.getLineDrawSpeed(), this.options.lineDrawMaxSpeedPercentPerSecond);
    const remainingMs = Math.ceil(Math.max(0, 100 - this.lineProgress) / drawSpeed * 1000);
    // Only recover when real progress reached 100% but the final rAF was lost.
    this.animationCompletionFallbackTimer = setTimeout(() => {
      this.animationCompletionFallbackTimer = 0;
      if (token !== this.runToken || this.progress < 100) return;
      this.completePathAnimation(token);
    }, remainingMs + 400);
  }

  beginSlowTimers() {
    this.slowTimer = setTimeout(() => {
      if (this.state === STATES.READY || this.state === STATES.ERROR || (this.sceneReady && this.lineArtReady)) return;
      this.root.classList.add("is-slow");
      this.slowMode = true;
      this.renderDebug();
      this.slowMessageTimer = setTimeout(() => {
        if (
          this.state === STATES.READY
          || this.state === STATES.ERROR
          || this.state === STATES.COMPLETING
          || this.state === STATES.TRANSITION
          || (this.sceneReady && this.lineArtReady)
        ) return;
        this.root.classList.add("is-slow-message");
        this.setStatus("");
        this.setProgress(this.progress, `${this.getProgressStage(this.progress)} · ${this.options.slowStatus}`);
        this.renderDebug();
      }, Math.max(0, this.options.slowMessageAfterMs - this.options.slowHoldAfterMs));
    }, this.options.slowHoldAfterMs);
  }

  async fetchSvg(lineArtUrl) {
    const response = await fetch(resolveAssetUrl(lineArtUrl), {
      headers: { Accept: "image/svg+xml" },
    });
    if (!response.ok) throw new Error(`Line-art request failed (${response.status})`);
    const markup = await response.text();
    const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
    if (parsed.querySelector("parsererror")) throw new Error("Line-art SVG could not be parsed");
    const source = parsed.documentElement;
    const paths = [...source.querySelectorAll("path")];
    if (source.nodeName.toLowerCase() !== "svg" || !paths.length) throw new Error("Line-art SVG contains no path elements");

    const svg = document.createElementNS(SVG_NS, "svg");
    ["viewBox", "preserveAspectRatio", "width", "height"].forEach((attribute) => {
      if (source.hasAttribute(attribute)) svg.setAttribute(attribute, source.getAttribute(attribute));
    });
    source.getAttributeNames()
      .filter((attribute) => attribute.startsWith("data-intro-camera"))
      .forEach((attribute) => svg.setAttribute(attribute, source.getAttribute(attribute)));
    if (!svg.hasAttribute("viewBox")) svg.setAttribute("viewBox", "0 0 1600 1000");
    paths.forEach((path) => svg.appendChild(document.importNode(path, true)));
    return svg;
  }

  fitSvgToViewport(svg) {
    if (!svg?.dataset.introCamera) return;
    const widthExtent = Number(svg.dataset.introCameraWidthExtent);
    const heightExtent = Number(svg.dataset.introCameraHeightExtent);
    const fill = Number(svg.dataset.introCameraFill);
    if (![widthExtent, heightExtent, fill].every(Number.isFinite) || fill <= 0) return;
    const hostWidth = this.lineArtHost.clientWidth || window.innerWidth;
    const hostHeight = this.lineArtHost.clientHeight || window.innerHeight;
    if (!hostWidth || !hostHeight) return;
    const aspect = hostWidth / hostHeight;
    const halfHeight = Math.max(
      heightExtent / (2 * fill),
      widthExtent / (2 * aspect * fill),
    );
    const halfWidth = halfHeight * aspect;
    svg.setAttribute("viewBox", `${-halfWidth} ${-halfHeight} ${halfWidth * 2} ${halfHeight * 2}`);
    svg.dataset.introCameraAspect = String(aspect);
    svg.dataset.introCameraHalfHeight = String(halfHeight);
  }

  getSvgViewportScale(svg) {
    const viewBox = svg?.viewBox?.baseVal;
    const rect = svg?.getBoundingClientRect?.();
    if (!viewBox?.width || !viewBox.height || !rect?.width || !rect.height) return 1;
    // preserveAspectRatio="xMidYMid meet" uses the smaller axis scale.
    return Math.min(rect.width / viewBox.width, rect.height / viewBox.height);
  }

  syncPathDashMetrics() {
    const svg = this.lineArtHost.querySelector("svg");
    if (!svg || !this.pathRecords.length) return;
    const scale = this.getSvgViewportScale(svg);
    const timeline = clamp(this.lineProgress / 100);
    this.pathRecords.forEach((record) => {
      const pathT = visiblePathProgress(clamp((timeline - record.timelineStart) / (record.timelineEnd - record.timelineStart)));
      // The SVG is responsive, so CSS pixels are the stable dash coordinate
      // for the rendered path. A single full-length dash is hidden at its
      // full offset and grows linearly toward zero.
      record.dashLength = record.length * scale;
      record.path.style.strokeDasharray = `${record.dashLength}px ${record.dashLength * 2}px`;
      record.path.style.strokeDashoffset = `${dashOffsetForProgress(record, pathT)}px`;
      record.renderedPathProgress = pathT;
    });
    this.lineArtHost.dataset.introVisible = this.lineProgress > 0 ? "true" : "false";
  }

  renderPathProgress(force = false) {
    const timeline = clamp(this.lineProgress / 100);
    this.lineArtHost.dataset.introVisible = this.lineProgress > 0 ? "true" : "false";
    this.pathRecords.forEach((record) => {
      const pathT = visiblePathProgress(clamp(
        (timeline - record.timelineStart) / (record.timelineEnd - record.timelineStart),
      ));
      // Hundreds of completed SVG paths used to receive the same inline style
      // on every animation frame. On mobile that competed directly with WebGL
      // shader warm-up. Only the currently growing contour now mutates the DOM.
      if (!force && Math.abs(pathT - (record.renderedPathProgress ?? -1)) < 0.0005) return;
      record.path.style.strokeDashoffset = `${dashOffsetForProgress(record, pathT)}px`;
      record.renderedPathProgress = pathT;
    });
  }

  createFallbackSvg() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 1600 1000");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    const path = document.createElementNS(SVG_NS, "path");
    path.dataset.stage = "fallback";
    path.setAttribute("d", "M220 760V280L790 105L1380 280V760L220 760 M220 760L800 905L1380 760");
    svg.appendChild(path);
    return svg;
  }

  installSvg(svg) {
    // Never attach a raw Blender SVG with its source stroke visible. The
    // browser may paint once between DOM attachment and metric setup; hiding
    // paths before attachment guarantees the first visible frame is 0%.
    const paths = [...svg.querySelectorAll("path")];
    paths.forEach((path) => { path.style.visibility = "hidden"; });
    this.lineArtHost.replaceChildren(svg);
    this.fitSvgToViewport(svg);
    const measuredPaths = paths.map((path) => {
      let length = 0;
      try { length = path.getTotalLength(); } catch { length = 0; }
      return { path, length };
    });
    const hasStageMetadata = measuredPaths.some(({ path }) => path.dataset.stage && PATH_STAGE_RANGES[path.dataset.stage]);
    const hasExplicitTimelines = measuredPaths.some(({ path }) => (
      Number.isFinite(Number(path.dataset.introStart)) && Number.isFinite(Number(path.dataset.introEnd))
    ));
    this.pathRecords = measuredPaths.map(({ path, length }, index) => {
      path.style.fill = "none";
      path.removeAttribute("pathLength");
      path.removeAttribute("stroke-dasharray");
      path.removeAttribute("stroke-dashoffset");
      path.style.strokeDasharray = "none";
      path.style.strokeDashoffset = "0px";
      path.dataset.introPathIndex = String(index);
      if (!hasStageMetadata) {
        const progress = paths.length > 1 ? index / (paths.length - 1) : 1;
        path.dataset.stage = UNTAGGED_STAGE_BREAKS.find(({ end }) => progress <= end)?.stage || "details";
      }
      return {
        path,
        length,
        stage: path.dataset.stage || "architecture",
        group: path.dataset.introGroup || "",
        objectOrder: Number.isFinite(Number(path.dataset.introObjectOrder))
          ? Number(path.dataset.introObjectOrder)
          : Number.POSITIVE_INFINITY,
        sequenceOrder: Number.isFinite(Number(path.dataset.introSegmentOrder))
          ? Number(path.dataset.introSegmentOrder)
          : Number.POSITIVE_INFINITY,
        explicitTimeline: hasExplicitTimelines && Number.isFinite(Number(path.dataset.introStart)) && Number.isFinite(Number(path.dataset.introEnd)),
        authoredTimelineStart: Number(path.dataset.introStart),
        authoredTimelineEnd: Number(path.dataset.introEnd),
        startPoint: getPathPoint(path, length),
        endPoint: getPathPoint(path, length, true),
        reverse: false,
        timelineStart: 0,
        timelineEnd: 1,
      };
    }).filter((record) => record.length > 0);
    if (!this.pathRecords.length) throw new Error("Line-art SVG has no measurable paths");
    const viewportScale = this.getSvgViewportScale(svg);
    const visibleRecords = filterFragmentRecords(this.pathRecords, viewportScale);
    this.pathRecords.forEach((record) => {
      if (!visibleRecords.includes(record)) record.path.remove();
    });
    this.pathRecords = visibleRecords;
    if (!this.pathRecords.length) throw new Error("Line-art SVG has no readable contour paths");
    this.assignPathTimelines();
    this.syncPathDashMetrics();
    this.pathRecords.forEach(({ path }) => { path.style.visibility = "visible"; });
    this.renderDebug();
  }

  assignPathTimelines() {
    const authoredRecords = this.pathRecords.filter((record) => record.explicitTimeline);
    if (authoredRecords.length) {
      const groupedRecords = new Map();
      authoredRecords.forEach((record) => {
        const groupKey = record.group || `${record.stage}:${record.authoredTimelineStart}:${record.authoredTimelineEnd}`;
        if (!groupedRecords.has(groupKey)) groupedRecords.set(groupKey, []);
        groupedRecords.get(groupKey).push(record);
      });

      const groupEntries = [...groupedRecords.entries()].map(([key, records]) => ({
        key,
        records,
        stage: records[0]?.stage || "details",
        authoredStart: Math.min(...records.map((record) => record.authoredTimelineStart)),
        authoredEnd: Math.max(...records.map((record) => record.authoredTimelineEnd)),
        firstPathIndex: Math.min(...records.map((record) => Number(record.path.dataset.introPathIndex))),
      }));
      const unAuthoredRecords = this.pathRecords.filter((record) => !record.explicitTimeline);
      if (unAuthoredRecords.length) {
        groupEntries.push({
          key: "__untagged-details",
          records: unAuthoredRecords,
          stage: "details",
          authoredStart: PATH_STAGE_RANGES.details.start,
          authoredEnd: PATH_STAGE_RANGES.details.end,
          firstPathIndex: Math.min(...unAuthoredRecords.map((record) => Number(record.path.dataset.introPathIndex))),
        });
      }

      // Older exporter versions authored overlapping group windows. Treat
      // those windows as ordering hints, then pack every group into its stage
      // range so no furniture can begin before the previous furniture ends.
      const stageOrder = ["architecture", "furniture", "objects", "details"];
      stageOrder.forEach((stage) => {
        const range = PATH_STAGE_RANGES[stage];
        const entries = groupEntries
          .filter((entry) => entry.stage === stage)
          .sort((left, right) => (
            left.authoredStart - right.authoredStart
            || left.authoredEnd - right.authoredEnd
            || left.firstPathIndex - right.firstPathIndex
          ));
        if (!range || !entries.length) return;

        const stageSpan = range.end - range.start;
        const totalWeight = entries.reduce((sum, entry) => (
          sum + Math.max(0.0001, entry.authoredEnd - entry.authoredStart)
        ), 0);
        let cursor = range.start;
        entries.forEach((entry, entryIndex) => {
          const weight = Math.max(0.0001, entry.authoredEnd - entry.authoredStart);
          const groupStart = cursor;
          const groupEnd = entryIndex === entries.length - 1
            ? range.end
            : cursor + stageSpan * (weight / totalWeight);
          const orderedRecords = orderForContinuousStroke(entry.records);
          const groupSpan = Math.max(0.0001, groupEnd - groupStart);
          const startInterval = groupSpan / orderedRecords.length;
          orderedRecords.forEach((record, index) => {
            record.timelineStart = groupStart + startInterval * index;
            record.timelineEnd = Math.min(groupEnd, record.timelineStart + startInterval);
          });
          cursor = groupEnd;
        });
      });
      return;
    }

    const groupedRecords = new Map();
    this.pathRecords.forEach((record) => {
      if (!groupedRecords.has(record.stage)) groupedRecords.set(record.stage, []);
      groupedRecords.get(record.stage).push(record);
    });

    groupedRecords.forEach((records, stage) => {
      const range = PATH_STAGE_RANGES[stage] || PATH_STAGE_RANGES.details;
      const span = range.end - range.start;
      const orderedRecords = orderForContinuousStroke(records);
      const startInterval = span / orderedRecords.length;
      orderedRecords.forEach((record, index) => {
        record.timelineStart = range.start + startInterval * index;
        record.timelineEnd = Math.min(range.end, record.timelineStart + startInterval);
      });
    });
  }

  animatePaths(token) {
    if (this.reducedMotion) {
      this.lastAnimationTime = performance.now();
      return new Promise((resolve) => {
        this.resolveAnimation = resolve;
        const tick = () => {
          if (token !== this.runToken) {
            this.resolveAnimation = null;
            resolve();
            return;
          }
          this.lineProgress = this.getVisualTarget(this.progress);
          this.renderPathProgress();
          this.renderProgress();
          this.renderDebug();
          if (this.progress >= 100) {
            this.pathRecords.forEach(({ path }) => { path.style.strokeDashoffset = "0px"; });
            this.lineProgress = 100;
            this.animationFrame = 0;
            this.resolveAnimation = null;
            resolve();
            return;
          }
          this.animationFrame = requestAnimationFrame(tick);
        };
        tick();
      });
    }

    this.lastAnimationTime = performance.now();
    return new Promise((resolve) => {
      this.resolveAnimation = resolve;
      this.schedulePathAnimationCompletionFallback(token);
      const tick = (now) => {
        if (token !== this.runToken) {
          this.resolveAnimation = null;
          resolve();
          return;
        }
        const deltaSeconds = Math.min(.1, Math.max(0, (now - this.lastAnimationTime) / 1000));
        this.lastAnimationTime = now;
        const actualProgress = this.progress;
        const visualTarget = this.getComfortTarget(actualProgress);
        const gap = visualTarget - this.lineProgress;
        if (gap > 0) {
          // Keep the authored stroke queue continuous. A host progress jump
          // must never reveal an entire group in one frame; the pen catches
          // up at a bounded speed instead. Once it has caught up to the real
          // load, a stalled host gets only the capped comfort drift above.
          const actualHasRoom = actualProgress >= this.lineProgress;
          const drawSpeed = actualProgress >= 100
            ? Math.max(this.getLineDrawSpeed(), this.options.lineDrawMaxSpeedPercentPerSecond)
            : actualHasRoom
              ? this.getLineDrawSpeed()
              : this.options.comfortDriftSpeedPercentPerSecond;
          this.lineProgress = Math.min(visualTarget, this.lineProgress + drawSpeed * deltaSeconds);
        }
        // The line drawing is a visual representation of the host's real
        // loading progress. It may lead by a small, capped comfort allowance
        // while the host is stalled, but it cannot finish before the real
        // progress reaches 100%. This keeps a slow load visibly alive without
        // inventing a fake percentage or skipping over intermediate strokes.
        this.renderPathProgress();
        this.renderProgress();
        this.renderDebug();
        if (actualProgress >= 100 && this.lineProgress >= 99.999) {
          this.completePathAnimation(token);
          return;
        }
        this.animationFrame = requestAnimationFrame(tick);
      };
      this.animationFrame = requestAnimationFrame(tick);
    });
  }

  /** Mark the host scene ready only after its asset and renderer warm-up gates pass. */
  markSceneReady({ warmup = "complete" } = {}) {
    if (this.state === STATES.ERROR) return;
    this.sceneReady = true;
    this.warmupStatus = warmup;
    this.setState(this.lineArtReady ? STATES.COMPLETING : STATES.WAITING, "host-ready");
    this.maybeComplete();
  }

  /** Request the reveal; it remains gated until both scene and line art are ready. */
  revealWhenReady() {
    if (this.state === STATES.ERROR) return Promise.resolve(this.getSnapshot());
    if (this.state === STATES.READY) return Promise.resolve(this.getSnapshot());
    if (this.revealPromise) return this.revealPromise;
    this.revealRequested = true;
    this.revealPromise = new Promise((resolve) => {
      this.resolveReveal = resolve;
      this.maybeComplete();
    });
    return this.revealPromise;
  }

  maybeComplete() {
    if (!this.revealRequested || !this.sceneReady || !this.lineArtReady) return;
    if (this.completionPending || this.transitionStarted || this.state === STATES.ERROR || this.state === STATES.READY) return;
    clearTimeout(this.slowTimer);
    clearTimeout(this.slowMessageTimer);
    if (this.state !== STATES.COMPLETING) this.setState(STATES.COMPLETING, "gates-open");

    const minimumDuration = this.reducedMotion ? 600 : this.options.minimumIntroDurationMs;
    const remaining = Math.max(0, minimumDuration - (performance.now() - this.startedAt));
    this.completionPending = true;
    this.completionTimer = setTimeout(() => {
      this.completionPending = false;
      if (!this.sceneReady || !this.lineArtReady || this.state === STATES.ERROR) return;
      this.completionTimer = setTimeout(() => this.beginTransition(), this.reducedMotion ? 0 : this.options.completeHoldMs);
    }, remaining);
  }

  async beginTransition() {
    if (this.transitionStarted || this.state === STATES.ERROR) return;
    this.transitionStarted = true;
    clearTimeout(this.slowTimer);
    clearTimeout(this.slowMessageTimer);
    this.root.classList.remove("is-slow", "is-slow-message");
    this.slowMode = false;
    this.setStatus("");
    this.setState(STATES.TRANSITION, "gates-open");
    const duration = this.reducedMotion ? this.options.reducedMotionDurationMs : this.options.crossfadeDurationMs;
    this.root.style.setProperty("--intro-crossfade-duration", `${duration}ms`);
    this.root.classList.add("is-revealing");
    await wait(duration);
    if (this.state === STATES.ERROR) return;
    this.root.classList.add("is-complete");
    this.root.setAttribute("aria-busy", "false");
    this.setState(STATES.READY, "crossfade-complete");
    this.resolveReveal?.(this.getSnapshot());
    this.resolveReveal = null;
  }

  fail(error) {
    const failure = error instanceof Error ? error : new Error(String(error || "Unknown intro-loader error"));
    this.lastError = failure;
    clearTimeout(this.slowTimer);
    clearTimeout(this.slowMessageTimer);
    clearTimeout(this.completionTimer);
    clearTimeout(this.animationCompletionFallbackTimer);
    this.animationCompletionFallbackTimer = 0;
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
    this.runToken += 1;
    this.resolveAnimation?.();
    this.resolveAnimation = null;

    if (!this.pathRecords.length) {
      try {
        this.installSvg(this.createFallbackSvg());
        this.pathRecords.forEach(({ path }) => { path.style.strokeDashoffset = "0px"; });
        this.lineProgress = 100;
      } catch {
        // The error UI remains actionable even if the fallback cannot mount.
      }
    }

    this.root.classList.add("is-error");
    this.root.classList.remove("is-slow", "is-slow-message", "is-revealing");
    this.root.setAttribute("aria-busy", "false");
    this.setState(STATES.ERROR, "host-error");
    this.setStatus("ROOM PREPARATION FAILED", { visible: true });
    if (this.errorElement) {
      this.errorElement.hidden = false;
      this.errorElement.textContent = failure.message;
    }
    if (this.retryButton) this.retryButton.hidden = false;
    this.resolveReveal?.({ ...this.getSnapshot(), error: failure.message });
    this.resolveReveal = null;
    return this.getSnapshot();
  }

  renderDebug() {
    if (!this.debugElement) return;
    this.debugElement.hidden = !this.options.debug;
    if (!this.options.debug) return;
    const snapshot = this.getSnapshot();
    const values = {
      state: snapshot.state,
      progress: `${Math.round(snapshot.progress)}%`,
      paths: String(snapshot.pathCount),
      line: snapshot.lineProgress >= 100
        ? "100% complete"
        : snapshot.lineProgress > 0
          ? `${Math.round(snapshot.lineProgress)}% growing`
          : "0% pending",
      scene: snapshot.sceneReady ? "ready" : "waiting",
      warmup: snapshot.warmupStatus,
      motion: snapshot.reducedMotion ? "reduced" : "full",
      slow: snapshot.slowMode ? "yes" : "no",
      source: snapshot.lineArtSource,
      elapsed: `${snapshot.elapsedMs}ms`,
    };
    Object.entries(values).forEach(([key, value]) => {
      const element = this.debugElement.querySelector(`[data-intro-debug-value="${key}"]`);
      if (element) element.textContent = value;
    });
  }
}

/**
 * Renderer warm-up helper for the later RoomApp integration.
 * It accepts plain renderer/scene/camera interfaces so this module stays
 * independent from the project's Three.js import graph.
 */
export async function warmRendererScene({ renderer, scene, cameras = [], renderFrames = 2, onStatus = null }) {
  const usableCameras = cameras.filter(Boolean);
  let compiled = false;
  let compileError = null;

  if (renderer?.compileAsync && usableCameras.length) {
    try {
      for (const camera of usableCameras) {
        onStatus?.("compileAsync");
        await renderer.compileAsync(scene, camera);
      }
      compiled = true;
    } catch (error) {
      compileError = error;
      console.warn("[intro-loader] renderer.compileAsync warm-up failed; render warm-up will continue", error);
    }
  }

  let rendered = 0;
  if (renderer?.render && usableCameras.length) {
    for (const camera of usableCameras) {
      for (let index = 0; index < renderFrames; index += 1) {
        renderer.render(scene, camera);
        rendered += 1;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    }
  }

  return {
    compiled,
    rendered,
    compileError,
    status: compiled ? "compileAsync+render" : rendered ? "render-only" : "unavailable",
  };
}

export { STATES as INTRO_LOADER_STATES };
