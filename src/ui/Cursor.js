export class Cursor {
  constructor() {
    this.el = document.querySelector("#cursor");
    this.trails = Array.from({ length: 3 }, (_, index) => {
      const trail = document.createElement("i");
      trail.className = "cursor-trail";
      trail.style.setProperty("--trail-index", index);
      this.el.before(trail);
      return { el: trail, x: innerWidth / 2, y: innerHeight / 2 };
    });
    this.x = innerWidth / 2;
    this.y = innerHeight / 2;
    this.tx = this.x;
    this.ty = this.y;
    this.sceneAction = false;
    this.domAction = false;
    this.pressed = false;
    this.dragging = false;
    this.pressX = this.x;
    this.pressY = this.y;
    this.actionSelector = "button, a, input, textarea, select, [role='button'], [data-cursor-action]";
    this.el.style.transform = `translate3d(${this.x}px, ${this.y}px, 0)`;
    addEventListener("pointermove", (event) => {
      this.x = this.tx = event.clientX;
      this.y = this.ty = event.clientY;
      // The primary cursor must remain attached to the native pointer. Only
      // the optional drag trail is eased; easing the main dot makes every
      // interaction feel slower than the underlying scene actually is.
      this.el.style.transform = `translate3d(${this.x}px, ${this.y}px, 0)`;
      if (this.pressed && Math.hypot(event.clientX - this.pressX, event.clientY - this.pressY) > 5) {
        this.dragging = true;
        this.syncState();
      }
    }, { passive: true });
    addEventListener("pointerover", (event) => {
      this.domAction = Boolean(event.target.closest?.(this.actionSelector));
      this.syncState();
    }, { passive: true });
    addEventListener("pointerout", (event) => {
      this.domAction = Boolean(event.relatedTarget?.closest?.(this.actionSelector));
      this.syncState();
    }, { passive: true });
    addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this.pressed = true;
      this.dragging = false;
      this.pressX = event.clientX;
      this.pressY = event.clientY;
      this.syncState();
    }, { passive: true });
    const release = () => {
      this.pressed = false;
      this.dragging = false;
      this.syncState();
    };
    addEventListener("pointerup", release, { passive: true });
    addEventListener("pointercancel", release, { passive: true });
    addEventListener("blur", release);
    this.loop();
  }

  setAction(active) {
    this.sceneAction = active;
    this.syncState();
  }

  syncState() {
    this.el.classList.toggle("is-action", this.sceneAction || this.domAction);
    this.el.classList.toggle("is-pressed", this.pressed);
    this.el.classList.toggle("is-dragging", this.dragging);
    this.trails.forEach(({ el }) => el.classList.toggle("is-visible", this.dragging));
  }

  loop() {
    // Active iframes use the native cursor. The decorative trail remains
    // intentionally eased, while the primary dot is updated by pointermove.
    this.trails.forEach((trail, index) => {
      const target = index === 0 ? { x: this.x, y: this.y } : this.trails[index - 1];
      const ease = .23 - index * .035;
      trail.x += (target.x - trail.x) * ease;
      trail.y += (target.y - trail.y) * ease;
      trail.el.style.transform = `translate3d(${trail.x}px, ${trail.y}px, 0)`;
    });
    requestAnimationFrame(() => this.loop());
  }
}
