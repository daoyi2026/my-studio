export class LoadingScreen {
  constructor() {
    this.root = document.querySelector("#loader");
    this.progress = document.querySelector("#loader-progress");
    this.fill = document.querySelector("#loader-progress-fill");
    this.title = document.querySelector("#liquid-title");
    this.percent = document.querySelector("#loader-percent");
    this.status = document.querySelector("#loader-status");
    this.value = 0;
    this.target = 0;
    this.raf = 0;
    this.started = performance.now();
    this.minimumDuration = 4800;
  }

  setProgress(value, status = "Arranging the room") {
    this.target = Math.max(this.target, Math.min(100, value));
    this.status.textContent = status;
    if (!this.raf) this.raf = requestAnimationFrame(() => this.tick());
  }

  tick() {
    const elapsed = performance.now() - this.started;
    const timeCeiling = Math.min(100, Math.max(4, elapsed / this.minimumDuration * 100));
    const visibleTarget = Math.min(this.target, timeCeiling);
    this.value += (visibleTarget - this.value) * 0.095;
    if (Math.abs(visibleTarget - this.value) < 0.08) this.value = visibleTarget;
    const rounded = Math.round(this.value);
    this.percent.textContent = String(rounded);
    this.progress.setAttribute("aria-valuenow", String(rounded));
    this.fill.style.width = `${this.value}%`;
    this.title.style.setProperty("--liquid-fill", `${this.value}%`);
    this.raf = 0;
    if (this.value !== this.target || timeCeiling < this.target) this.raf = requestAnimationFrame(() => this.tick());
  }

  async finish() {
    this.setProgress(100, "Arranging the room");
    await new Promise((resolve) => {
      const wait = () => {
        if (this.value >= 99.5 && performance.now() - this.started >= this.minimumDuration) resolve();
        else requestAnimationFrame(wait);
      };
      wait();
    });
    this.value = 100;
    this.percent.textContent = "100";
    this.progress.setAttribute("aria-valuenow", "100");
    this.fill.style.width = "100%";
    this.title.style.setProperty("--liquid-fill", "100%");
    this.status.textContent = "Room ready";
    this.title.classList.add("is-complete");
    await new Promise((resolve) => setTimeout(resolve, 420));
    this.root.setAttribute("aria-busy", "false");
    this.root.classList.add("is-done");
  }
}
