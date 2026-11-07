(() => {
  const hook = Symbol.for("fantasy-mod.waypoint-map");
  const mod = window.mod ?? (window.mod = {});
  mod.waypointRenderStatus = "Aguardando renderizador do mapa";

  function drawWaypoint(renderer, floor, tileSize) {
    const hunt = mod.hunt;
    const point = hunt?.currentWaypoint?.active
      ? hunt.currentWaypoint
      : mod.waypoints?.[hunt?.waypointIndex ?? 0];
    if (!point || !Number.isInteger(point.x) || !Number.isInteger(point.y)
      || !Number.isInteger(point.floor) || point.floor !== floor
      || mod.myself?.floor !== floor) return;

    // toScreen uses the same camera and pixel snapping as drawWorld's tiles.
    // Draw in world pixels; present() applies zoom and letterboxing afterwards.
    const [x, y] = renderer.toScreen(point.x, point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)
      || x + tileSize <= 0 || y + tileSize <= 0
      || x >= renderer.viewW || y >= renderer.viewH) return;

    const color = [255, 32, 32];
    const border = 1;
    renderer.fillRect(x, y, tileSize, tileSize, color, 0.18);
    renderer.fillRect(x, y, tileSize, border, color);
    renderer.fillRect(x, y + tileSize - border, tileSize, border, color);
    renderer.fillRect(x, y + border, border, tileSize - border * 2, color);
    renderer.fillRect(x + tileSize - border, y + border, border, tileSize - border * 2, color);
  }

  async function install() {
    // Import the same module URL as the game's entry point so existing renderer
    // instances also use this prototype. No dependency on minified frame names
    // or on the optional gameDebug API.
    const entry = [...document.querySelectorAll('script[type="module"][src]')]
      .find(script => new URL(script.src, document.baseURI).pathname.endsWith("/main.mjs"));
    if (!entry) return;
    try {
      const url = new URL("./render.mjs", entry.src).href;
      const { Renderer, TILE } = await import(url);
      const prototype = Renderer?.prototype;
      if (typeof prototype?.drawWorld !== "function"
        || typeof prototype.toScreen !== "function"
        || typeof prototype.fillRect !== "function" || !(TILE >= 4)) {
        throw new Error("Renderizador do jogo incompatível");
      }
      if (!prototype[hook]) {
        const drawWorld = prototype.drawWorld;
        prototype.drawWorld = function (floor, ...args) {
          const result = drawWorld.call(this, floor, ...args);
          // Add the marker after the ground and before creatures, effects and
          // labels. fillRect uses the game's WebGL batch or its 2D fallback.
          try {
            drawWaypoint(this, floor, TILE);
          } catch (error) {
            reportError(error);
          }
          return result;
        };
        Object.defineProperty(prototype, hook, { value: true });
      }
      mod.waypointRenderStatus = "Waypoints integrados ao renderizador do mapa";
    } catch (error) {
      reportError(error);
    }
  }

  function reportError(error) {
    const status = `Falha ao desenhar waypoint: ${error?.message ?? error}`;
    if (mod.waypointRenderStatus === status) return;
    mod.waypointRenderStatus = status;
    mod.log?.("warn", status);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
