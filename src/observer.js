(() => {
  if (window.__gameMonitor) return;

  const NativeWebSocket = window.WebSocket;
  const packets = [];
  const sockets = [];
  let nextSocketId = 1;
  let gameSocket = null;
  let reconnectPending = false;
  let reconnectNextAt = 0;
  const intentionalCloses = new WeakSet();
  const socketDecoders = new WeakMap();
  const assetSockets = new WeakSet();
  let gameWorld = null;
  let monsterData = new Map();
  let monsterAssets = null;
  let translatedMonsterNames = {};
  let monsterCatalog = [];
  // Confirmation recognition stays in this script because all bot loaders use
  // a fixed list of four scripts. The pixel matcher has no browser dependencies.
  function confirmationTemplate(image) {
    const { width, height, data } = image;
    const pixels = [];
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      if (data[at + 3] < 240) continue;
      pixels.push([x, y, data[at], data[at + 1], data[at + 2]]);
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    if (pixels.length < 24) return null;
    const w = right - left + 1, h = bottom - top + 1;
    const count = Math.min(96, pixels.length);
    const samples = Array.from({ length: count }, (_, i) => {
      const [x, y, ...rgb] = pixels[Math.floor(i * pixels.length / count)];
      return [(x - left + .5) / w, (y - top + .5) / h, ...rgb];
    });
    // Spread the cheap first pass over the entire sprite, not just its head.
    const ordered = [];
    for (let offset = 0; offset < 8; offset++) for (let i = offset; i < count; i += 8) ordered.push(samples[i]);
    return { width: w, height: h, samples: ordered };
  }

  async function matchConfirmationImage(image, templates, columns, isActive, yieldTask) {
    const { width, height, data } = image;
    if (!Number.isInteger(columns) || columns < 2 || columns > 12 || !templates.length) return null;
    const scores = Array(columns).fill(0);
    const scoreAt = (points, x, y, count, minimum) => {
      let error = 0;
      const budget = count * (1 - minimum);
      for (let i = 0; i < count; i++) {
        const [dx, dy, r, g, b] = points[i];
        const at = ((y + dy) * width + x + dx) * 4;
        error += Math.min(1, Math.max(Math.abs(data[at] - r), Math.abs(data[at + 1] - g), Math.abs(data[at + 2] - b)) / 80);
        if (error > budget) return 0;
      }
      return 1 - error / count;
    };
    for (const template of templates) {
      const longest = Math.max(template.width, template.height);
      const maximum = Math.floor(Math.min(width / columns, height) * .96);
      for (let size = 12; size <= maximum; size += Math.max(1, Math.floor(size * .04))) {
        await yieldTask();
        if (!isActive()) return null;
        const w = Math.max(1, Math.round(template.width * size / longest));
        const h = Math.max(1, Math.round(template.height * size / longest));
        const step = Math.max(1, Math.floor(size / 20));
        for (const flip of [false, true]) {
          const points = template.samples.map(([x, y, ...rgb]) => [
            Math.min(w - 1, Math.floor((flip ? 1 - x : x) * w)), Math.min(h - 1, Math.floor(y * h)), ...rgb
          ]);
          for (let column = 0; column < columns; column++) {
            const start = Math.ceil(column * width / columns);
            const end = Math.floor((column + 1) * width / columns) - w;
            let candidate = null;
            for (let y = 0; y <= height - h; y += step) for (let x = start; x <= end; x += step) {
              if (scoreAt(points, x, y, Math.min(16, points.length), .6) < .6) continue;
              const score = scoreAt(points, x, y, points.length, Math.max(.6, candidate?.score ?? 0));
              if (score > (candidate?.score ?? .6)) candidate = { x, y, score };
            }
            if (!candidate) continue;
            // Recover translations between the coarse grid positions.
            for (let y = Math.max(0, candidate.y - step + 1); y <= Math.min(height - h, candidate.y + step - 1); y++) {
              for (let x = Math.max(start, candidate.x - step + 1); x <= Math.min(end, candidate.x + step - 1); x++) {
                scores[column] = Math.max(scores[column], scoreAt(points, x, y, points.length, scores[column]));
              }
            }
          }
        }
      }
    }
    if (!isActive()) return null;
    const ranked = scores.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score);
    const [best, second] = ranked;
    // These are similarity thresholds, not calibrated probabilities.
    return { index: best.index, score: best.score, margin: best.score - second.score,
      confident: best.score >= .82 && best.score - second.score >= .12, scores };
  }

  function createConfirmationController(deps) {
    let current = null;
    const state = { active: false, status: "Aguardando confirmação", result: null };
    const reset = socket => {
      if (socket && current?.socket !== socket) return;
      current = null;
      state.active = false;
      state.status = "Aguardando confirmação";
      state.result = null;
    };
    const answered = socket => {
      if (current?.socket !== socket) return;
      current.sent = true;
      state.status = "Resposta enviada; aguardando o jogo";
    };
    const receive = (socket, packet) => {
      if (packet?.t !== "vq" || !deps.isSocket(socket)) return;
      if (!packet.i) { reset(socket); return; }
      if (current?.socket === socket && current.image === packet.i && current.name === packet.n) return;
      const job = current = { socket, image: packet.i, name: packet.n, sent: false,
        until: deps.now() + Math.max(0, Number(packet.s) || 0) * 1000 - 1000 };
      state.active = true;
      state.result = null;
      const active = () => current === job && !job.sent && deps.enabled() && deps.isSocket(socket) && deps.now() < job.until;
      state.status = "Analisando confirmação de monstro";
      const manual = reason => {
        if (current !== job || job.sent) return;
        state.status = `Confirmação manual: ${reason}`;
        deps.log("warn", state.status);
      };
      if (!deps.enabled()) { manual("resposta automática desativada"); return; }
      if (packet.k !== 1 || !Number.isInteger(packet.c) || packet.c < 2 || packet.c > 12 || !packet.n) {
        manual("tipo de desafio não reconhecido"); return;
      }
      Promise.resolve().then(async () => {
        const templates = deps.templates(packet.n);
        if (!templates.length) { manual("sprite do monstro indisponível"); return; }
        const image = await deps.decode(packet.i);
        if (!active()) return;
        const result = await deps.match(image, templates, packet.c, active, deps.yieldTask);
        if (!active()) return;
        state.result = result;
        if (!result?.confident) { manual("comparação visual inconclusiva"); return; }
        const maxWaitSeconds = Math.min(20, Math.floor((job.until - deps.now() - 1) / 1000));
        if (maxWaitSeconds < 5) { manual("tempo insuficiente para aguardar pelo menos 5 segundos"); return; }
        const waitSeconds = 5 + Math.floor(deps.random() * (maxWaitSeconds - 4));
        state.status = `Confirmação reconhecida; aguardando ${waitSeconds} s para responder`;
        deps.log("info", state.status);
        await deps.wait(waitSeconds * 1000);
        if (!active()) { manual("espera cancelada ou prazo encerrado"); return; }
        job.sent = true;
        deps.send(socket, { t: "va", a: result.index });
        state.status = `Opção ${result.index + 1} enviada; aguardando o jogo`;
        deps.log("info", `Confirmação: ${packet.n}, opção ${result.index + 1} (semelhança ${result.score.toFixed(2)}).`);
      }).catch(error => {
        if (current !== job) return;
        // Never retry automatically: a send error may occur after transmission.
        state.status = `Confirmação manual: ${error?.message ?? error}`;
        deps.log("warn", state.status);
      }).finally(() => {
        if (current === job && !job.sent && state.status === "Analisando confirmação de monstro") manual("análise interrompida ou prazo encerrado");
      });
    };
    return { state, receive, answered, reset };
  }
  // End of browser-independent confirmation helpers.
  let potionReadyAt = 0;
  let currentWalls = [];
  let playerId = null;
  let playerEntity = {};
  const entities = new Map();
  // Recent attack events let hunting avoid creatures another player is engaging.
  const otherPlayerAttackUntil = new Map();
  let playerStats = {};
  const mod = window.mod && typeof window.mod === "object" ? window.mod : (window.mod = {});
  const diagnosticLog = window.__fantasyModConsole ?? (window.__fantasyModConsole = []);
  let nextDiagnosticId = 1;
  mod.log = (level, message) => {
    const entry = { id: nextDiagnosticId++, at: new Date().toISOString(), level, message: String(message).slice(0, 1200) };
    diagnosticLog.push(entry);
    if (diagnosticLog.length > 1000) diagnosticLog.splice(0, diagnosticLog.length - 1000);
    window.dispatchEvent(new CustomEvent("__fantasy_mod_console_update"));
    return entry;
  };
  const confirmationEnabled = () => {
    try { return localStorage.getItem("fantasy-mod-auto-confirmation") !== "false"; } catch { return true; }
  };
  const confirmation = createConfirmationController({
    enabled: confirmationEnabled,
    now: () => Date.now(),
    random: () => Math.random(),
    wait: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    isSocket: socket => socket === gameSocket && socket?.readyState === NativeWebSocket.OPEN && !assetSockets.has(socket),
    log: (level, message) => mod.log(level, message),
    send: (socket, packet) => socket.send(JSON.stringify(packet)),
    yieldTask: () => new Promise(resolve => setTimeout(resolve, 0)),
    match: matchConfirmationImage,
    templates: name => {
      const normalize = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
      const wanted = normalize(name);
      const monsters = (monsterAssets?.monsters ?? []).filter(monster => {
        const raw = monster.name ?? monster.n ?? monster.label;
        const names = typeof raw === "string" ? [raw, ...Object.values(translatedMonsterNames[raw] ?? {})] : Object.values(raw ?? {});
        return names.some(value => normalize(value) === wanted);
      });
      const atlas = monsterAssets?.c8;
      if (!atlas) return [];
      const indices = new Set(monsters.flatMap(monster => (monster.anims ?? []).flat(2)).filter(Number.isInteger));
      const templates = [];
      const seen = new Set();
      for (const index of indices) {
        const frame = monsterAssets?.entities?.monsters?.[index];
        if (!Array.isArray(frame) || frame.length < 4) continue;
        const [x, y, width, height] = frame;
        const key = [x, y, width, height].join(",");
        if (seen.has(key) || ![x, y, width, height].every(Number.isInteger) || width < 1 || height < 1 || width > 256 || height > 256) continue;
        seen.add(key);
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(atlas, x, y, width, height, 0, 0, width, height);
        const template = confirmationTemplate(context.getImageData(0, 0, width, height));
        if (template) templates.push(template);
      }
      return templates;
    },
    decode: base64 => new Promise((resolve, reject) => {
      if (typeof base64 !== "string" || base64.length > 4000000) { reject(new Error("imagem inválida")); return; }
      const image = new Image();
      image.onerror = () => reject(new Error("não foi possível ler a imagem"));
      image.onload = () => {
        try {
          if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 2048 || image.naturalHeight > 1024) throw new Error("dimensões da imagem não suportadas");
          const scale = Math.min(1, 640 / image.naturalWidth, 256 / image.naturalHeight);
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.imageSmoothingEnabled = false;
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(context.getImageData(0, 0, canvas.width, canvas.height));
        } catch (error) { reject(error); }
      };
      image.src = `data:image/png;base64,${base64}`;
    })
  });
  mod.confirmation = confirmation.state;
  if (!window.__fantasyModErrorHooks) {
    window.__fantasyModErrorHooks = true;
    window.addEventListener("error", event => {
      const source = event.filename ? ` (${event.filename}:${event.lineno ?? 0}:${event.colno ?? 0})` : "";
      mod.log("error", `${event.message || "Erro JavaScript"}${source}`);
    });
    window.addEventListener("unhandledrejection", event => {
      const reason = event.reason;
      mod.log("error", `Promise rejeitada: ${reason?.stack ?? reason?.message ?? String(reason)}`);
    });
  }
  if (!console.__fantasyModWrapped) {
    const originalError = console.error.bind(console);
    const wrappedError = (...args) => {
      const message = args.map(value => value instanceof Error ? (value.stack ?? value.message)
        : typeof value === "string" ? value : Object.prototype.toString.call(value)).join(" ");
      mod.log("error", `console.error: ${message}`);
      originalError(...args);
    };
    Object.defineProperty(wrappedError, "__fantasyModWrapped", { value: true });
    console.error = wrappedError;
    try { Object.defineProperty(console, "__fantasyModWrapped", { value: true }); } catch {}
  }
  // Suppress game shortcuts only while hunting/luring, while preserving text
  // entry and the standalone X shortcut for Focar.
  const gameShortcutCodes = new Set([
    "KeyW", "ArrowUp", "Numpad8", "KeyS", "ArrowDown", "Numpad2",
    "KeyA", "ArrowLeft", "Numpad4", "KeyD", "ArrowRight", "Numpad6",
    "Numpad9", "PageUp", "Numpad7", "Home", "Numpad1", "End",
    "Numpad3", "PageDown", "Digit1", "Digit2", "Digit3", "KeyH",
    "KeyJ", "KeyQ", "KeyE", "KeyX", "Space", "Escape", "Tab", "KeyM",
    "KeyI", "Enter"
  ]);
  function isGameShortcut(event) {
    if (gameShortcutCodes.has(event.code)) return true;
    // The game stores user remappings in fantasy.options. Read them at event
    // time too, so changes made after this extension loads take effect.
    try {
      const options = JSON.parse(localStorage.getItem("fantasy.options") ?? "{}");
      return Object.values(options.hotkeys ?? {}).some(keys => Array.isArray(keys) && keys.includes(event.code));
    } catch { return false; }
  }
  function blockGameShortcut(event) {
    const path = event.composedPath?.() ?? [];
    const inModPanel = path.some(node => node?.id === "fantasy-mod-panel-host");
    const target = event.target;
    const isTextInput = target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "");
    const huntActive = !!(window.mod?.hunt?.enabled || window.mod?.hunt?.lureEnabled || window.mod?.hunt?.resumeAfterReturn);
    if (inModPanel) {
      // Keep browser defaults (typing, arrows, checkbox toggles), but keep the
      // game listeners from seeing keys pressed while operating the mod panel.
      if (huntActive && isGameShortcut(event) && !(event.key === "Escape" && event.type === "keydown")) {
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (isTextInput) return;
    if (event.code === "KeyX" && event.type === "keydown" && !event.repeat) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      window.mod?.setFocusEnabled?.(!window.mod?.focus?.enabled);
      return;
    }
    if (!huntActive || !isGameShortcut(event)) return;
    if (event.code === "Space" && event.type === "keydown" && !event.repeat) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      window.mod.stopHunt?.();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }
  window.addEventListener("keydown", blockGameShortcut, true);
  window.addEventListener("keyup", blockGameShortcut, true);
  const myself = mod.myself ?? (mod.myself = {});
  mod.inventory = { known: false, full: null, used: null, capacity: null, bag: [] };
  mod.mapReady = false;
  mod.pathStatus = "Aguardando mapa do jogo";
  const POTION_COOLDOWN_MS = 1300;
  let specialReadyAt = 0;
  const huntState = mod.hunt ?? (mod.hunt = { enabled: false, names: [], types: [], radius: 11, status: "Parado" });
  huntState.enabled = false;
  huntState.lureEnabled = false;
  huntState.training = false;
  huntState.trainingClass = "melee";
  huntState.trainingEliteEnabled = false;
  huntState.trainingEliteClass = "melee";
  huntState.trainingExhaustedEnabled = false;
  huntState.trainingExhaustedClass = "melee";
  huntState.trainingWaypoints = false;
  huntState.trainingRadius = 4;
  huntState.trainingIdleMinutes = 0;
  huntState.trainingIdleRemainingSeconds = null;
  huntState.trainingTargetDelayMin = 0;
  huntState.trainingTargetDelayMax = 0;
  huntState.trainingCityBag = true;
  huntState.trainingCityArrows = true;
  huntState.trainingCityPotions = false;
  huntState.status = "Parado";
  const focusState = mod.focus ?? (mod.focus = { enabled: false, useSkill: false, followTarget: true, status: "Focar desligado" });
  focusState.enabled = false;
  try {
    focusState.useSkill = localStorage.getItem("fantasy-mod-focus-use-skill") === "true";
    focusState.followTarget = localStorage.getItem("fantasy-mod-focus-follow-target") !== "false";
  } catch {}
  focusState.status = "Focar desligado";
  huntState.attackAny ??= false;
  huntState.autoSellInProgress = false;
  window.__fantasyAutoSellInProgress = false;
  let huntWaypointIndex = 0;
  huntState.waypointIndex = huntWaypointIndex;
  const setHuntWaypointIndex = index => {
    huntWaypointIndex = index;
    huntState.waypointIndex = index;
  };
  let waypointDirection = 1;
  let waypointFirstReached = false;
  let waypointLastReached = false;
  let waypointCompletedLoops = 0;
  let waypointLoopFloor = null;
  let waypointReversePauseUntil = 0;
  huntState.waypointReverseEnabled = false;
  huntState.waypointReverseLoops = 1;
  huntState.waypointReverseDelay = 0;
  const resetWaypointDirection = () => {
    waypointDirection = 1; waypointFirstReached = false; waypointLastReached = false; waypointCompletedLoops = 0; waypointLoopFloor = null; waypointReversePauseUntil = 0;
  };
  let nextWaypointMoveAt = 0;
  let waypointMovePending = null;
  let waypointMoveFailures = 0;
  let waypointNoProgressFailures = 0;
  let lureArrivalWaypoint = null;
  let lureArrivalTolerance = 1;
  const lurePulledIds = new Set();
  huntState.lureProgress = { current: 0, target: huntState.lureCount ?? 5 };
  mod.waypoints = [];
  huntState.lureMoveDelayMs = 0;
  huntState.lureWaypointPauseMs = 0;
  try {
    const savedWaypoints = JSON.parse(localStorage.getItem("fantasy-mod-waypoints") ?? "[]");
    if (Array.isArray(savedWaypoints)) mod.waypoints = savedWaypoints.filter(point =>
      Number.isInteger(point?.x) && Number.isInteger(point?.y) && Number.isInteger(point?.floor));
    huntState.waypointsEnabled = localStorage.getItem("fantasy-mod-waypoints-enabled") === "true";
    huntState.waypointReverseEnabled = localStorage.getItem("fantasy-mod-waypoint-reverse-enabled") === "true";
    const reverseDelay = Number(localStorage.getItem("fantasy-mod-waypoint-reverse-delay"));
    if (Number.isFinite(reverseDelay) && reverseDelay >= 0 && reverseDelay <= 300) huntState.waypointReverseDelay = reverseDelay;
    const reverseLoops = Number(localStorage.getItem("fantasy-mod-waypoint-reverse-loops"));
    if (Number.isInteger(reverseLoops) && reverseLoops >= 1 && reverseLoops <= 1000) huntState.waypointReverseLoops = reverseLoops;
    const trainingClass = localStorage.getItem("fantasy-mod-training-class");
    if (["mage", "melee", "distance"].includes(trainingClass)) huntState.trainingClass = trainingClass;
    huntState.trainingEliteEnabled = localStorage.getItem("fantasy-mod-training-elite-enabled") === "true";
    const eliteClass = localStorage.getItem("fantasy-mod-training-elite-class");
    if (["mage", "melee", "distance"].includes(eliteClass)) huntState.trainingEliteClass = eliteClass;
    huntState.trainingExhaustedEnabled = localStorage.getItem("fantasy-mod-training-exhausted-enabled") === "true";
    const exhaustedClass = localStorage.getItem("fantasy-mod-training-exhausted-class");
    if (["mage", "melee", "distance"].includes(exhaustedClass)) huntState.trainingExhaustedClass = exhaustedClass;
    huntState.trainingWaypoints = localStorage.getItem("fantasy-mod-training-waypoints") === "true";
    const previousCityReturn = localStorage.getItem("fantasy-mod-training-city-return") !== "false";
    huntState.trainingCityBag = (localStorage.getItem("fantasy-mod-training-city-bag") ?? String(previousCityReturn)) === "true";
    huntState.trainingCityArrows = (localStorage.getItem("fantasy-mod-training-city-arrows") ?? String(previousCityReturn)) === "true";
    huntState.trainingCityPotions = localStorage.getItem("fantasy-mod-training-city-potions") === "true";
    const oldDelay = Number(localStorage.getItem("fantasy-mod-training-target-delay"));
    const minDelay = Number(localStorage.getItem("fantasy-mod-training-target-delay-min") ?? oldDelay);
    const maxDelay = Number(localStorage.getItem("fantasy-mod-training-target-delay-max") ?? oldDelay);
    if (Number.isFinite(minDelay) && Number.isFinite(maxDelay) && minDelay >= 0 && maxDelay <= 60 && minDelay <= maxDelay) {
      huntState.trainingTargetDelayMin = minDelay;
      huntState.trainingTargetDelayMax = maxDelay;
    }
    const trainingRadius = Number(localStorage.getItem("fantasy-mod-training-radius"));
    if (Number.isInteger(trainingRadius) && trainingRadius >= 1 && trainingRadius <= 100) huntState.trainingRadius = trainingRadius;
    const idleMinutes = Number(localStorage.getItem("fantasy-mod-training-idle-minutes"));
    if (Number.isFinite(idleMinutes) && idleMinutes >= 0 && idleMinutes <= 1440) huntState.trainingIdleMinutes = idleMinutes;
    localStorage.setItem("fantasy-mod-lure-enabled", "false");
    huntState.lureCount = Math.max(1, Math.min(50, Number(localStorage.getItem("fantasy-mod-lure-count")) || 5));
    huntState.lureStepTiles = Math.max(1, Math.min(10, Number(localStorage.getItem("fantasy-mod-lure-step-tiles")) || 3));
    localStorage.removeItem("fantasy-mod-lure-move-delay");
    localStorage.removeItem("fantasy-mod-lure-waypoint-pause");
    huntState.attackRange = Number(localStorage.getItem("fantasy-mod-attack-range")) === 4 ? 4 : 1;
    huntState.useSpecial = localStorage.getItem("fantasy-mod-lure-special") === "true";
  } catch {}
  const saveWaypoints = () => {
    try { localStorage.setItem("fantasy-mod-waypoints", JSON.stringify(mod.waypoints)); } catch {}
  };
  mod.addWaypoint = (x, y, floor = myself.floor) => {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(floor)) {
      return { ok: false, error: "Informe X e Y inteiros e aguarde a posição/andar do personagem." };
    }
    resetWaypointDirection();
    mod.waypoints.push({ x, y, floor });
    saveWaypoints();
    setHuntWaypointIndex(0);
    waypointMoveFailures = 0;
    waypointNoProgressFailures = 0;
    waypointMovePending = null;
    return { ok: true, waypoint: mod.waypoints.at(-1), count: mod.waypoints.length };
  };
  mod.waypointRecording = { enabled: false, status: "Gravação desligada" };
  let recordingPreviousPosition = null;
  const waypointDistance = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  mod.setWaypointRecording = enabled => {
    const recording = mod.waypointRecording;
    if (enabled) {
      if (huntState.enabled || huntState.lureEnabled || huntState.resumeAfterReturn) return { ok: false, error: "Pare a caça ou o treino antes de gravar waypoints." };
      if (!Number.isInteger(myself.x) || !Number.isInteger(myself.y) || !Number.isInteger(myself.floor)) return { ok: false, error: "Aguardando a posição do personagem." };
      const point = { x: myself.x, y: myself.y, floor: myself.floor };
      const last = mod.waypoints.at(-1);
      if (last && (last.floor !== point.floor || waypointDistance(last, point) > 9)) return { ok: false, error: "O último waypoint deve estar no mesmo andar e a até 9 tiles. Aproxime-se ou limpe a rota." };
      if (!last || waypointDistance(last, point) > 0) mod.addWaypoint(point.x, point.y, point.floor);
      recordingPreviousPosition = point;
      recording.enabled = true;
      recording.status = "Gravando: ande para adicionar waypoints a cada 9 tiles.";
    } else {
      const last = mod.waypoints.at(-1), point = recordingPreviousPosition;
      if (recording.enabled && last && point && last.floor === point.floor && waypointDistance(last, point) > 0 && waypointDistance(last, point) <= 9) mod.addWaypoint(point.x, point.y, point.floor);
      recording.enabled = false;
      recordingPreviousPosition = null;
      recording.status = "Gravação encerrada.";
    }
    return { ok: true, enabled: recording.enabled };
  };
  function recordWaypointPosition() {
    const recording = mod.waypointRecording;
    if (!recording.enabled || !Number.isInteger(myself.x) || !Number.isInteger(myself.y) || !Number.isInteger(myself.floor)) return;
    const point = { x: myself.x, y: myself.y, floor: myself.floor }, last = mod.waypoints.at(-1);
    if (!last || last.floor !== point.floor || (waypointDistance(last, point) > 9 && (!recordingPreviousPosition || waypointDistance(last, recordingPreviousPosition) > 9))) {
      recording.enabled = false;
      recording.status = "Gravação interrompida: mudança de andar ou salto de posição. Confira a rota.";
      recordingPreviousPosition = null;
      return;
    }
    if (waypointDistance(last, point) >= 9) {
      const next = waypointDistance(last, point) === 9 ? point : recordingPreviousPosition;
      if (waypointDistance(last, next) > 0) mod.addWaypoint(next.x, next.y, next.floor);
    }
    recordingPreviousPosition = point;
  }
  mod.removeWaypoint = index => {
    if (!Number.isInteger(index) || index < 0 || index >= mod.waypoints.length) return { ok: false, error: "Waypoint inválido." };
    resetWaypointDirection();
    mod.waypoints.splice(index, 1);
    saveWaypoints();
    setHuntWaypointIndex(Math.min(huntWaypointIndex, Math.max(0, mod.waypoints.length - 1)));
    waypointMoveFailures = 0;
    waypointNoProgressFailures = 0;
    waypointMovePending = null;
    return { ok: true, count: mod.waypoints.length };
  };
  mod.clearWaypoints = () => {
    resetWaypointDirection();
    mod.waypoints = [];
    saveWaypoints();
    setHuntWaypointIndex(0);
    waypointMoveFailures = 0;
    waypointNoProgressFailures = 0;
    waypointMovePending = null;
    return { ok: true };
  };
  mod.setWaypointReverse = (enabled, loops) => {
    const value = Number(loops);
    if (!Number.isInteger(value) || value < 1 || value > 1000) return { ok: false, error: "Informe um número inteiro de voltas entre 1 e 1000." };
    huntState.waypointReverseEnabled = !!enabled;
    huntState.waypointReverseLoops = value;
    resetWaypointDirection();
    try {
      localStorage.setItem("fantasy-mod-waypoint-reverse-enabled", String(huntState.waypointReverseEnabled));
      localStorage.setItem("fantasy-mod-waypoint-reverse-loops", String(value));
    } catch {}
    return { ok: true };
  };
  mod.setWaypointReverseDelay = seconds => {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value < 0 || value > 300) return { ok: false, error: "A pausa deve ficar entre 0 e 300 segundos." };
    huntState.waypointReverseDelay = value;
    try { localStorage.setItem("fantasy-mod-waypoint-reverse-delay", String(value)); } catch {}
    return { ok: true, seconds: value };
  };
  mod.setWaypointPatrol = enabled => {
    huntState.waypointsEnabled = !!enabled;
    if (!huntState.waypointsEnabled && !huntState.lureEnabled) huntState.currentWaypoint = null;
    try { localStorage.setItem("fantasy-mod-waypoints-enabled", String(huntState.waypointsEnabled)); } catch {}
    return { ok: true, enabled: huntState.waypointsEnabled };
  };
  mod.setLureEnabled = (enabled, reason = null) => {
    const wasHunting = !!(huntState.enabled || huntState.lureEnabled);
    if (enabled && huntState.training && wasHunting) return { ok: false, error: "Pare o treino antes de ativar o lure." };
    if (enabled) {
      const routeByFloor = new Map();
      for (const point of mod.waypoints) {
        if (!routeByFloor.has(point.floor)) routeByFloor.set(point.floor, new Set());
        routeByFloor.get(point.floor).add(`${point.x},${point.y}`);
      }
      if (![...routeByFloor.values()].some(points => points.size >= 2)) {
        const error = "Cadastre pelo menos dois waypoints distintos no mesmo andar para o lure percorrer a rota.";
        mod.log("warn", `Lure não iniciado: ${error}`);
        return { ok: false, error };
      }
    }
    if (enabled && !huntState.enabled && !huntState.names?.length && !huntState.attackAny) {
      const selectedTypes = Object.keys(mod.targets ?? {}).filter(type => mod.targets[type]);
      if (!selectedTypes.length) {
        const error = "Ative os tipos de criaturas em Alvos antes de iniciar o lure.";
        mod.log("warn", `Lure não iniciado: ${error}`);
        return { ok: false, error };
      }
      huntState.types = selectedTypes;
      huntState.enabled = true;
    }
    huntState.lureEnabled = !!enabled;
    if (!huntState.lureEnabled && !huntState.waypointsEnabled) huntState.currentWaypoint = null;
    lurePulledIds.clear();
    huntState.lureProgress = { current: 0, target: huntState.lureCount ?? 5 };
    try { localStorage.setItem("fantasy-mod-lure-enabled", String(huntState.lureEnabled)); } catch {}
    setHuntWaypointIndex(0);
    nextWaypointMoveAt = 0;
    waypointMovePending = null;
    waypointMoveFailures = 0;
    waypointNoProgressFailures = 0;
    lureArrivalWaypoint = null;
    lureArrivalTolerance = 1;
    mod.log("info", huntState.lureEnabled ? "Lure iniciado." : (reason ?? "Lure desativado pelo usuário."));
    if (huntState.lureEnabled && !wasHunting) queueInitialHuntTravel();
    return { ok: true, enabled: huntState.lureEnabled };
  };
  mod.targets ??= {};
  try { Object.assign(mod.targets, JSON.parse(localStorage.getItem("fantasy-mod-targets") ?? "{}")); } catch {}
  mod.setLureCount = count => {
    const value = Number(count);
    if (!Number.isInteger(value) || value < 1 || value > 50) return { ok: false, error: "A quantidade deve ficar entre 1 e 50 criaturas." };
    huntState.lureCount = value;
    huntState.lureProgress = { ...(huntState.lureProgress ?? {}), target: value };
    try { localStorage.setItem("fantasy-mod-lure-count", String(value)); } catch {}
    return { ok: true, count: value };
  };
  mod.setLureSettings = settings => {
    if (!settings || typeof settings !== "object") return { ok: false, error: "Configuração de lure inválida." };
    const step = Number(settings.stepTiles ?? huntState.lureStepTiles);
    // Legacy delay settings are accepted but no longer pause the lure route.
    const delay = 0;
    const pause = 0;
    if (!Number.isInteger(step) || step < 1 || step > 10) {
      return { ok: false, error: "Use passo de 1–10 tiles." };
    }
    huntState.lureStepTiles = step;
    huntState.lureMoveDelayMs = delay;
    huntState.lureWaypointPauseMs = pause;
    try {
      localStorage.setItem("fantasy-mod-lure-step-tiles", String(step));
      localStorage.setItem("fantasy-mod-lure-move-delay", String(delay));
      localStorage.setItem("fantasy-mod-lure-waypoint-pause", String(pause));
    } catch {}
    return { ok: true, stepTiles: step, moveDelayMs: delay, waypointPauseMs: pause };
  };
  mod.setTrainingOptions = (trainingClass, waypoints) => {
    if (!["mage", "melee", "distance"].includes(trainingClass)) return { ok: false, error: "Classe de treino inválida." };
    huntState.trainingClass = trainingClass;
    huntState.trainingWaypoints = !!waypoints;
    try {
      localStorage.setItem("fantasy-mod-training-class", trainingClass);
      localStorage.setItem("fantasy-mod-training-waypoints", String(huntState.trainingWaypoints));
    } catch {}
    return { ok: true };
  };
  mod.setTrainingCityOption = (option, enabled) => {
    const settings = { bag: "trainingCityBag", arrows: "trainingCityArrows", potions: "trainingCityPotions" };
    const key = settings[option];
    if (!key) return { ok: false, error: "Opção de retorno inválida." };
    huntState[key] = !!enabled;
    try { localStorage.setItem(`fantasy-mod-training-city-${option}`, String(huntState[key])); } catch {}
    return { ok: true, enabled: huntState[key] };
  };
  mod.setTrainingEliteOptions = (enabled, combatClass) => {
    if (!["mage", "melee", "distance"].includes(combatClass)) return { ok: false, error: "Classe de combate inválida." };
    huntState.trainingEliteEnabled = !!enabled;
    huntState.trainingEliteClass = combatClass;
    try {
      localStorage.setItem("fantasy-mod-training-elite-enabled", String(huntState.trainingEliteEnabled));
      localStorage.setItem("fantasy-mod-training-elite-class", combatClass);
    } catch {}
    if (!enabled && trainingElite?.kind !== "exhausted") finishTrainingElite();
    return { ok: true };
  };
  mod.setTrainingExhaustedOptions = (enabled, combatClass) => {
    if (!["mage", "melee", "distance"].includes(combatClass)) return { ok: false, error: "Classe de combate inválida." };
    huntState.trainingExhaustedEnabled = !!enabled;
    huntState.trainingExhaustedClass = combatClass;
    try {
      localStorage.setItem("fantasy-mod-training-exhausted-enabled", String(!!enabled));
      localStorage.setItem("fantasy-mod-training-exhausted-class", combatClass);
    } catch {}
    if (!enabled) {
      exhaustedTargetId = null;
      if (trainingElite?.kind === "exhausted") finishTrainingElite();
    }
    return { ok: true };
  };
  mod.setTrainingTargetDelay = (minSeconds, maxSeconds) => {
    const min = Number(minSeconds), max = Number(maxSeconds);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max > 60 || min > max) return { ok: false, error: "Use valores entre 0 e 60 segundos; o mínimo não pode superar o máximo." };
    huntState.trainingTargetDelayMin = min;
    huntState.trainingTargetDelayMax = max;
    try {
      localStorage.setItem("fantasy-mod-training-target-delay-min", String(min));
      localStorage.setItem("fantasy-mod-training-target-delay-max", String(max));
    } catch {}
    return { ok: true, min, max };
  };
  mod.setTrainingRadius = radius => {
    const value = Number(radius);
    if (!Number.isInteger(value) || value < 1 || value > 100) return { ok: false, error: "O raio deve ser um número inteiro entre 1 e 100 tiles." };
    huntState.trainingRadius = value;
    if (huntState.training) huntState.radius = value;
    try { localStorage.setItem("fantasy-mod-training-radius", String(value)); } catch {}
    return { ok: true, radius: value };
  };
  mod.setTrainingIdleMinutes = minutes => {
    const value = Number(minutes);
    if (!Number.isFinite(value) || value < 0 || value > 1440) return { ok: false, error: "O tempo deve ficar entre 0 e 1440 minutos." };
    huntState.trainingIdleMinutes = value;
    huntState.trainingIdleRemainingSeconds = null;
    trainingIdleWatch = null;
    trainingIdleMove = null;
    try { localStorage.setItem("fantasy-mod-training-idle-minutes", String(value)); } catch {}
    return { ok: true, minutes: value };
  };
  mod.setHuntAttackRange = range => {
    const value = Number(range);
    if (value !== 1 && value !== 4) return { ok: false, error: "O alcance de ataque deve ser 1 ou 4 tiles." };
    huntState.attackRange = value;
    try { localStorage.setItem("fantasy-mod-attack-range", String(value)); } catch {}
    return { ok: true, attackRange: value };
  };
  mod.setAttackAnyCreature = enabled => {
    huntState.attackAny = !!enabled;
    try { localStorage.setItem("fantasy-mod-attack-any-creature", String(huntState.attackAny)); } catch {}
    return { ok: true, enabled: huntState.attackAny };
  };
  mod.setLureSpecial = enabled => {
    huntState.useSpecial = !!enabled;
    try { localStorage.setItem("fantasy-mod-lure-special", String(huntState.useSpecial)); } catch {}
    return { ok: true, enabled: huntState.useSpecial };
  };
  mod.setFocusOption = (option, enabled) => {
    if (option !== "useSkill" && option !== "followTarget") return { ok: false, error: "Opção de Focar inválida." };
    focusState[option] = !!enabled;
    const key = option === "useSkill" ? "fantasy-mod-focus-use-skill" : "fantasy-mod-focus-follow-target";
    try { localStorage.setItem(key, String(focusState[option])); } catch {}
    return { ok: true, option, enabled: focusState[option] };
  };
  mod.setFocusEnabled = enabled => {
    if (enabled && huntState.training && (huntState.enabled || resumeHuntAfterReturn)) return { ok: false, error: "Pare o treino antes de ativar Focar." };
    focusState.enabled = !!enabled;
    focusState.status = focusState.enabled ? "Focar ativo; selecione um target no jogo." : "Focar desligado";
    if (focusState.enabled) {
      initialHuntTravel = null;
      huntTravelArrival = null;
      nextFocusMoveAt = 0;
    }
    return { ok: true, enabled: focusState.enabled };
  };
  mod.useHuntSpecial = () => {
    if (!gameSocket || gameSocket.readyState !== WebSocket.OPEN) return { ok: false, error: "WebSocket do jogo não está conectado." };
    const cls = playerStats.cls ?? playerStats.cl;
    // For Mage, the game toggles aim mode when autoSpecial is off.
    if (Number(cls) === 2 && playerStats.autoSpecial !== true) return { ok: false, error: "Ative o especial automático do personagem para usar essa habilidade." };
    const cooldown = Number(playerStats.specialReady);
    if (Number.isFinite(cooldown) && cooldown > 0) return { ok: false, error: "Habilidade especial em cooldown." };
    if (Date.now() < specialReadyAt) return { ok: false, error: "Aguardando cooldown da habilidade." };
    gameSocket.send(JSON.stringify({ t: "special" }));
    // This is only a duplicate-send guard; the server's specialReady value
    // above remains the authoritative cooldown for repeated casts.
    specialReadyAt = Date.now() + 300;
    return { ok: true };
  };
  Object.defineProperty(mod, "monsterCatalog", { configurable: true, get: () => monsterCatalog });
  mod.setTargetEnabled = (type, enabled) => {
    const key = String(type);
    mod.targets[key] = !!enabled;
    try { localStorage.setItem("fantasy-mod-targets", JSON.stringify(mod.targets)); } catch {}
    if (huntState.enabled || huntState.lureEnabled) {
      huntState.names = [];
      huntState.types = Object.keys(mod.targets).filter(targetType => mod.targets[targetType]);
      try { localStorage.setItem("fantasy-mod-hunt-names", "[]"); } catch {}
    }
    return { ok: true, type, enabled: mod.targets[key] };
  };
  mod.setTargetsEnabled = enabled => {
    for (const creature of monsterCatalog) mod.targets[String(creature.type)] = !!enabled;
    try { localStorage.setItem("fantasy-mod-targets", JSON.stringify(mod.targets)); } catch {}
    if (huntState.enabled || huntState.lureEnabled) {
      huntState.names = [];
      huntState.types = Object.keys(mod.targets).filter(targetType => mod.targets[targetType]);
      try { localStorage.setItem("fantasy-mod-hunt-names", "[]"); } catch {}
    }
    return { ok: true, enabled: !!enabled };
  };
  function rebuildMonsterCatalog() {
    const records = monsterAssets?.monsters ?? [];
    const frames = monsterAssets?.entities?.monsters ?? [];
    const atlas = monsterAssets?.c8;
    let lang = "pt";
    try { lang = (localStorage.getItem("fantasy.lang") ?? "pt").slice(0, 2).toLowerCase(); } catch {}
    monsterCatalog = records.map(monster => {
      const type = monster.type;
      const rawName = monster.name ?? monster.n ?? monster.label;
      const translations = typeof rawName === "string" ? translatedMonsterNames[rawName] : rawName;
      const name = typeof rawName === "string"
        ? (translations?.[lang] ?? translations?.pt ?? rawName)
        : (translations?.[lang] ?? translations?.pt ?? translations?.en ?? `Criatura ${type}`);
      const animation = monster.anims?.[0];
      const frameIndex = Array.isArray(animation) ? animation[0] : null;
      const frame = Number.isInteger(frameIndex) ? frames[frameIndex] : null;
      let sprite = null;
      if (atlas && Array.isArray(frame) && frame.length >= 4) {
        try {
          const [sx, sy, width, height] = frame;
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 48;
          const context = canvas.getContext("2d");
          const scale = Math.min(40 / width, 40 / height);
          context.drawImage(atlas, sx, sy, width, height,
            (48 - width * scale) / 2, (48 - height * scale) / 2, width * scale, height * scale);
          sprite = canvas.toDataURL("image/png");
        } catch {}
      }
      return { type, name: String(name), sprite };
    }).filter(creature => creature.type != null)
      .sort((a, b) => a.name.localeCompare(b.name, lang));
  }
  import(new URL("/shared/monster-names.mjs", location.origin).href)
    .then(module => { translatedMonsterNames = module.MONSTER_NAMES ?? {}; rebuildMonsterCatalog(); })
    .catch(() => {});
  try {
    huntState.names = JSON.parse(localStorage.getItem("fantasy-mod-hunt-names") ?? "[]");
    huntState.radius = 11;
    huntState.attackAny = localStorage.getItem("fantasy-mod-attack-any-creature") === "true";
    huntState.autoSell = localStorage.getItem("fantasy-mod-auto-sell") === "true";
    huntState.refillAfterSale = localStorage.getItem("fantasy-mod-refill-after-sale") === "true";
    mod.refill = {
      x: readDestinationCoordinate("fantasy-mod-refill-x", 314, 100000),
      y: readDestinationCoordinate("fantasy-mod-refill-y", 215, 100000),
      floor: readDestinationCoordinate("fantasy-mod-refill-floor", 0, 20),
      radius: Math.max(1, Math.min(10, Number(localStorage.getItem("fantasy-mod-refill-radius")) || 2)),
      items: JSON.parse(localStorage.getItem("fantasy-mod-refill-items") ?? "[]"),
      shopItems: [],
      status: "Pronto"
    };
    huntState.lootItemIds = JSON.parse(localStorage.getItem("fantasy-mod-loot-items") ?? "[]").map(String);
    mod.lootCatalog = JSON.parse(localStorage.getItem("fantasy-mod-loot-catalog") ?? "[]")
      .filter(item => item && item.id != null && typeof item.name === "string");
  } catch {}
  huntState.autoLoot = true;
  try { huntState.autoLootGold = localStorage.getItem("fantasy-mod-auto-loot-gold") !== "false"; }
  catch { huntState.autoLootGold = true; }
  mod.setAutoLootGold = enabled => {
    huntState.autoLootGold = !!enabled;
    try { localStorage.setItem("fantasy-mod-auto-loot-gold", String(huntState.autoLootGold)); } catch {}
    return { ok: true, enabled: huntState.autoLootGold };
  };
  mod.lootCatalog ??= [];
  huntState.lootItemIds ??= [];
  mod.refill ??= { x: 314, y: 215, floor: 0, radius: 2, status: "Pronto" };
  mod.refill.items ??= [];
  mod.refill.shopItems ??= [];
  if (!Array.isArray(mod.refill.items)) mod.refill.items = [];
  huntState.refillAfterSale ??= false;
  const lootItemKey = entity => String(entity?.it ?? normalizeName(entity?.n));
  const ignoredPlayerCoveredLoot = new Set();
  let lootItemNames = {};
  import(new URL("/shared/item-names.mjs", location.origin).href)
    .then(module => { lootItemNames = module.ITEM_NAMES ?? {}; })
    .catch(() => {});
  const lootSpriteAttempts = new Map();
  const getGameAssets = () => {
    try {
      const screens = window.gameDebug?.state?.().screens;
      return screens?.a ?? screens?.assets ?? (screens?.itemById ? screens : null);
    } catch { return null; }
  };
  const getAssetItem = (assets, id) => {
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) return null;
    return assets?.itemById?.get(numericId)
      ?? assets?.itemById?.get(String(id))
      ?? assets?.items?.find(item => String(item.id) === String(id))
      ?? null;
  };
  const captureLootSprite = entity => {
    try {
      const assets = getGameAssets();
      const itemId = Number(entity.it);
      const item = getAssetItem(assets, entity.it);
      const iconRegion = Number.isFinite(itemId) ? assets?.ui?.[`i_${itemId}`] : null;
      if (assets?.c1 && iconRegion) {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 40;
        const context = canvas.getContext("2d");
        context.imageSmoothingEnabled = false;
        const backgrounds = ["common_bg", "uncommon_bg", "rare_bg", "ultra_rare_bg", "legendary_bg", "mythic_bg"];
        const background = assets.ui?.[backgrounds[item?.rarity ?? 0]];
        if (background) context.drawImage(assets.c1, background[0], background[1], background[2], background[3], 0, 0, 40, 40);
        context.drawImage(assets.c1, iconRegion[0], iconRegion[1], iconRegion[2], iconRegion[3], 4, 4, 32, 32);
        return canvas.toDataURL("image/png");
      }
      const source = document.getElementById("world");
      const point = window.gameDebug?.canvasOf?.(entity.x, entity.y);
      if (!source || !point || point.length < 2 || source.width < 1) return null;
      const adjacent = window.gameDebug?.canvasOf?.(entity.x + 1, entity.y);
      const ratio = source.width / Math.max(1, window.innerWidth);
      const size = adjacent?.length >= 2 ? Math.abs(adjacent[0] - point[0]) : 24 * ratio;
      const x = point[0] - size / 2;
      const y = point[1] - size / 2;
      if (x < 0 || y < 0 || x + size > source.width || y + size > source.height) return null;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 48;
      const context = canvas.getContext("2d");
      context.imageSmoothingEnabled = false;
      context.drawImage(source, x, y, size, size, 0, 0, 48, 48);
      return canvas.toDataURL("image/png");
    } catch { return null; }
  };
  mod.updateLootCatalog = () => {
    const catalog = new Map((mod.lootCatalog ?? []).map(item => [String(item.id), item]));
    const assets = getGameAssets();
    mod.lootIconStatus = assets?.c1 && assets?.ui ? "Ícones do atlas disponíveis" : "Miniaturas capturadas dos drops visíveis";
    let changed = false;
    // Populate the picker before these items have appeared as drops.
    for (const item of assets?.items ?? assets?.itemById?.values?.() ?? []) {
      if (item?.id == null || catalog.has(String(item.id))) continue;
      const id = String(item.id);
      const rawName = item.name;
      const englishName = typeof rawName === "string" ? rawName
        : String(rawName?.pt ?? rawName?.en ?? rawName?.es ?? `Item ${id}`);
      const lang = (localStorage.getItem("fantasy.lang") ?? "pt").slice(0, 2);
      catalog.set(id, { id, name: lootItemNames[englishName]?.[lang] ?? englishName, sprite: null });
      changed = true;
    }
    for (const entity of entities.values()) {
      if (entity.k !== 3 || entity.it == null && !entity.n) continue;
      const id = lootItemKey(entity);
      const itemId = Number(entity.it);
      const assetItem = getAssetItem(assets, entity.it);
      const rawName = assetItem?.name ?? entity.n;
      const englishName = typeof rawName === "string" ? rawName
        : String(rawName?.pt ?? rawName?.en ?? rawName?.es ?? Object.values(rawName ?? {}).find(value => typeof value === "string") ?? `Item ${id}`);
      const lang = (localStorage.getItem("fantasy.lang") ?? "pt").slice(0, 2);
      const name = lootItemNames[englishName]?.[lang] ?? englishName;
      const previous = catalog.get(id);
      let sprite = previous?.sprite ?? null;
      if (!sprite && Date.now() - (lootSpriteAttempts.get(id) ?? 0) >= 2000) {
        lootSpriteAttempts.set(id, Date.now());
        const sample = { x: entity.x, y: entity.y };
        requestAnimationFrame(() => {
          const image = captureLootSprite(sample);
          if (!image) return;
          const current = new Map((mod.lootCatalog ?? []).map(item => [String(item.id), item]));
          const item = current.get(id);
          if (!item || item.sprite) return;
          current.set(id, { ...item, sprite: image });
          mod.lootCatalog = [...current.values()].sort((a, b) => a.name.localeCompare(b.name));
          try { localStorage.setItem("fantasy-mod-loot-catalog", JSON.stringify(mod.lootCatalog)); } catch {}
        });
      }
      if (!previous || previous.name.startsWith("Item ") && !name.startsWith("Item ")) {
        catalog.set(id, { id, name, sprite: previous?.sprite ?? null });
        changed = true;
      }
    }
    for (const [id, previous] of catalog) {
      const itemId = Number(id);
      const assetItem = getAssetItem(assets, id);
      if (!assetItem) continue;
      const rawName = assetItem.name;
      const englishName = typeof rawName === "string" ? rawName : String(rawName?.pt ?? rawName?.en ?? rawName?.es ?? `Item ${id}`);
      const lang = (localStorage.getItem("fantasy.lang") ?? "pt").slice(0, 2);
      const name = lootItemNames[englishName]?.[lang] ?? englishName;
      if ((previous.name.startsWith("Item ") || previous.name === englishName) && name !== previous.name) {
        catalog.set(id, { ...previous, name });
        changed = true;
      }
      if (!previous.sprite && assets.ui?.[`i_${itemId}`] && Date.now() - (lootSpriteAttempts.get(id) ?? 0) >= 2000) {
        lootSpriteAttempts.set(id, Date.now());
        requestAnimationFrame(() => {
          const image = captureLootSprite({ it: itemId });
          if (!image) return;
          const current = new Map((mod.lootCatalog ?? []).map(entry => [String(entry.id), entry]));
          const entry = current.get(id);
          if (!entry || entry.sprite) return;
          current.set(id, { ...entry, sprite: image });
          mod.lootCatalog = [...current.values()].sort((a, b) => a.name.localeCompare(b.name));
          try { localStorage.setItem("fantasy-mod-loot-catalog", JSON.stringify(mod.lootCatalog)); } catch {}
        });
      }
    }
    if (changed) {
      mod.lootCatalog = [...catalog.values()].sort((a, b) => a.name.localeCompare(b.name));
      try { localStorage.setItem("fantasy-mod-loot-catalog", JSON.stringify(mod.lootCatalog)); } catch {}
    }
    return mod.lootCatalog;
  };
  mod.setLootItemEnabled = (id, enabled) => {
    const key = String(id);
    const selected = new Set((huntState.lootItemIds ?? []).map(String));
    enabled ? selected.add(key) : selected.delete(key);
    huntState.lootItemIds = [...selected];
    try { localStorage.setItem("fantasy-mod-loot-items", JSON.stringify(huntState.lootItemIds)); } catch {}
    return { ok: true, id: key, enabled: !!enabled };
  };
  mod.setLootItemsEnabled = enabled => {
    huntState.lootItemIds = enabled ? (mod.lootCatalog ?? []).map(item => String(item.id)) : [];
    try { localStorage.setItem("fantasy-mod-loot-items", JSON.stringify(huntState.lootItemIds)); } catch {}
    return { ok: true, count: huntState.lootItemIds.length };
  };
  Object.defineProperty(mod, "potionCooldownRemaining", {
    configurable: true,
    get: () => Math.max(0, potionReadyAt - Date.now())
  });
  mod.potionCooldownMs = POTION_COOLDOWN_MS;

  const SPEED_OVERRIDE_KEY = "fantasy.speedOverride";
  mod.setSpeed = value => {
    const speed = Number(value);
    if (!Number.isFinite(speed) || speed <= 0 || speed > 10000) {
      return { ok: false, error: "Speed deve ser um número entre 1 e 10000." };
    }
    try { localStorage.setItem(SPEED_OVERRIDE_KEY, String(speed)); }
    catch { return { ok: false, error: "Não consegui salvar o override local de speed." }; }
    mod.speedTest = { active: true, localOnly: true, value: speed, setAt: Date.now() };
    mod.log("info", `Speed local definido para ${speed}; será aplicado quando chegar o próximo snapshot.`);
    return { ok: true, value: speed, localOnly: true, appliesOn: "próximo snapshot" };
  };
  mod.clearSpeedOverride = () => {
    try { localStorage.removeItem(SPEED_OVERRIDE_KEY); }
    catch { return { ok: false, error: "Não consegui remover o override local de speed." }; }
    mod.speedTest = { active: false, localOnly: true, clearedAt: Date.now() };
    mod.log("info", "Override local de speed removido; valor normal volta no próximo snapshot.");
    return { ok: true, appliesOn: "próximo snapshot" };
  };
  let speedTestTimer = null;
  mod.testSpeed = (value, durationMs = 5000) => {
    const duration = Number(durationMs);
    if (!Number.isFinite(duration) || duration < 1000 || duration > 10000) {
      return { ok: false, error: "A duração deve ficar entre 1000 e 10000 ms." };
    }
    let previous = null;
    try { previous = localStorage.getItem(SPEED_OVERRIDE_KEY); }
    catch { return { ok: false, error: "Não consegui ler o override local de speed." }; }
    const result = mod.setSpeed(value);
    if (!result.ok) return result;
    clearTimeout(speedTestTimer);
    speedTestTimer = setTimeout(() => {
      if (previous == null) mod.clearSpeedOverride();
      else {
        try { localStorage.setItem(SPEED_OVERRIDE_KEY, previous); } catch {}
        mod.speedTest = { active: false, localOnly: true, value: Number(previous), restoredAt: Date.now() };
      }
    }, duration);
    return { ...result, durationMs: duration, restoresPrevious: true };
  };

  mod.move = (x, y, { requireExact = false } = {}) => {
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      return { ok: false, error: "x e y precisam ser coordenadas inteiras de tiles." };
    }
    if (myself.id == null || myself.x == null || myself.y == null) {
      return { ok: false, error: "O personagem ainda não foi autenticado ou a posição ainda não chegou." };
    }
    if (!gameWorld) return { ok: false, error: mod.pathStatus };
    if (!gameSocket || gameSocket.readyState !== WebSocket.OPEN) {
      return { ok: false, error: "WebSocket do jogo não está conectado." };
    }
    const sx = myself.x, sy = myself.y, floor = myself.floor;
    if (!Number.isInteger(floor) || Math.abs(x - sx) > 20 || Math.abs(y - sy) > 20) {
      return { ok: false, error: "Destino precisa estar no mesmo andar e a até 20 tiles em cada eixo." };
    }
    const occupied = new Set();
    for (const [id, entity] of entities) {
      if (String(id) === String(myself.id) || entity.x == null || entity.y == null) continue;
      // Match the client's blocking-entity filter: ignore effects and entities
      // marked as non-blocking; the server uses k=3 for non-colliding entities.
      if (entity.k === 3 || entity.tr) continue;
      if (entity.f == null || entity.f === floor) occupied.add(`${entity.x},${entity.y}`);
    }
    const wallSet = new Set(currentWalls.map(([wx, wy]) => `${wx},${wy}`));
    const targetKey = `${x},${y}`;
    const targetBlocked = !gameWorld.isWalkable(floor, x, y) || wallSet.has(targetKey) || occupied.has(targetKey);
    if (requireExact && targetBlocked) {
      return { ok: false, error: `Destino (${x}, ${y}) bloqueado; procurando um tile alternativo.`, target: { x, y } };
    }
    const path = gameWorld.findPath(floor, sx, sy, x, y, {
      adjacent: targetBlocked,
      blocked: (tx, ty) => wallSet.has(`${tx},${ty}`) || occupied.has(`${tx},${ty}`),
      cost: () => 0,
      maxNodes: 4000,
      diagCost: 19
    });
    if (!path?.length || path.length > 40) return { ok: false, error: "Não encontrei uma rota válida para esse tile." };
    const message = { t: "walk", x, y, path: [[sx, sy], ...path.map(step => [step.x, step.y])] };
    gameSocket.send(JSON.stringify(message));
    return { ok: true, target: { x, y }, steps: path.length, reachedTarget: !targetBlocked };
  };

  const potionIds = { hp: [1, 104, 105, 575], mp: [2, 110, 111, 576] };
  function potionStatus(kind) {
    const stat = kind === "hp" ? "healthPotionID" : "manaPotionID";
    let selected = 0;
    try { selected = Number(localStorage.getItem(`fantasy.${String(myself.nick ?? "").toLowerCase()}.${stat}`)); } catch {}
    const selectedTier = potionTier(kind, selected);
    const requiredLevel = [0, 75, 150, 250];
    const validSelected = selectedTier >= 0 && (Number(playerStats.level ?? myself.level) || 0) >= requiredLevel[selectedTier];
    const tier = Math.max(0, Math.min(potionIds[kind].length - 1, Number(playerStats.bestPotion?.[kind] ?? myself.bestPotion?.[kind] ?? 0) | 0));
    const id = validSelected ? selected : potionIds[kind][tier];
    const inventory = playerStats.potions ?? myself.potions;
    const rawCount = inventory?.[id] ?? inventory?.[String(id)] ?? inventory?.[kind];
    const count = Number(rawCount);
    return { id, count: Number.isFinite(count) ? count : null };
  }
  const potionTier = (kind, id) => {
    const standard = potionIds[kind].indexOf(id);
    if (standard >= 0) return standard;
    if (id >= 986 && id <= 993 && ((kind === "hp" && id <= 989) || (kind === "mp" && id >= 990))) return (id - 986) % 4;
    if (id === (kind === "hp" ? 3001 : 3002)) return 0;
    return -1;
  };
  mod.potion = kind => {
    if (kind !== "hp" && kind !== "mp") return { ok: false, error: "Tipo de poção inválido (use hp ou mp)." };
    if (!gameSocket || gameSocket.readyState !== WebSocket.OPEN) return { ok: false, error: "WebSocket do jogo não está conectado." };
    const cooldownRemaining = Math.max(0, potionReadyAt - Date.now());
    if (cooldownRemaining > 0) return { ok: false, error: `Poção em cooldown por ${(cooldownRemaining / 1000).toFixed(1)} s.`, cooldownRemaining };
    const stat = kind === "hp" ? "healthPotionID" : "manaPotionID";
    const key = `fantasy.${String(myself.nick ?? "").toLowerCase()}.${stat}`;
    let selected = 0;
    try { selected = Number(localStorage.getItem(key)); } catch {}
    const selectedTier = potionTier(kind, selected);
    const requiredLevel = [0, 75, 150, 250];
    const validSelected = selectedTier >= 0 && (Number(myself.level) || 0) >= requiredLevel[selectedTier];
    const tier = Math.max(0, Math.min(potionIds[kind].length - 1, Number(myself.bestPotion?.[kind] ?? 0) | 0));
    const id = validSelected ? selected : potionIds[kind][tier];
    gameSocket.send(JSON.stringify({ t: "potion", k: kind, id }));
    potionReadyAt = Date.now() + POTION_COOLDOWN_MS;
    return { ok: true, kind, id };
  };

  mod.creaturesNearby = (radius = 10) => {
    const range = Number(radius);
    if (!Number.isFinite(range) || range < 0) return [];
    if (!Number.isInteger(myself.x) || !Number.isInteger(myself.y) || !Number.isInteger(myself.floor)) {
      mod.creatureSearchStatus = "Aguardando posição do personagem";
      return [];
    }
    const limit = Math.min(100, range);
    const found = [...entities.values()]
      .filter(entity => entity.k === 1 && Number.isInteger(entity.x) && Number.isInteger(entity.y)
        && (entity.f == null || entity.f === myself.floor) && !(Number.isFinite(entity.hp) && entity.hp <= 0))
      .map(entity => {
        const distance = Math.max(Math.abs(entity.x - myself.x), Math.abs(entity.y - myself.y));
        const monster = monsterData.get(entity.ty);
        const rawName = entity.n ?? monster?.name;
        let lang = "pt";
        try { lang = (localStorage.getItem("fantasy.lang") ?? "pt").slice(0, 2).toLowerCase(); } catch {}
        const name = typeof rawName === "string"
          ? (translatedMonsterNames[rawName]?.[lang] ?? translatedMonsterNames[rawName]?.pt ?? rawName)
          : (rawName?.[lang] ?? rawName?.pt ?? rawName?.en ?? rawName?.es);
        return {
          id: entity.id,
          type: entity.ty ?? null,
          name: name ?? `Criatura ${entity.ty ?? entity.id}`,
          aliases: [entity.n, monster?.name].flatMap(value => typeof value === "string" ? [value] : Object.values(value ?? {}).filter(item => typeof item === "string")),
          x: entity.x,
          y: entity.y,
          floor: entity.f ?? myself.floor,
          hp: entity.hp ?? null,
          distance
        };
      })
      .filter(entity => entity.distance <= limit)
      .sort((a, b) => a.distance - b.distance);
    mod.creatureSearchStatus = `${found.length} criatura(s) encontrada(s)`;
    return found;
  };

  const creaturePathDistanceCache = new Map();
  function creaturePathDistance(creature, maxNodes = 4000) {
    if (!gameWorld || !Number.isInteger(myself.x) || !Number.isInteger(myself.y)
      || !Number.isInteger(creature?.x) || !Number.isInteger(creature?.y)) return Infinity;
    if (myself.x === creature.x && myself.y === creature.y) return 0;
    const cacheKey = `${myself.floor}:${myself.x},${myself.y}:${creature.id}:${creature.x},${creature.y}`;
    if (creaturePathDistanceCache.has(cacheKey)) return creaturePathDistanceCache.get(cacheKey);
    const blocked = new Set(currentWalls.map(([x, y]) => `${x},${y}`));
    for (const [id, entity] of entities) {
      if (String(id) === String(myself.id) || entity.x == null || entity.y == null
        || entity.k === 3 || entity.tr || (entity.f != null && entity.f !== myself.floor)) continue;
      blocked.add(`${entity.x},${entity.y}`);
    }
    blocked.add(`${creature.x},${creature.y}`);
    const path = gameWorld.findPath(myself.floor, myself.x, myself.y, creature.x, creature.y, {
      adjacent: true,
      blocked: (x, y) => blocked.has(`${x},${y}`),
      maxNodes,
      diagCost: 19
    });
    const distance = path ? path.length : Infinity;
    creaturePathDistanceCache.set(cacheKey, distance);
    if (creaturePathDistanceCache.size > 500) creaturePathDistanceCache.clear();
    return distance;
  }

  function creaturesWithinPathRadius(radius = huntState.radius) {
    const limit = Math.max(0, Math.min(100, Number(radius) || 0));
    return mod.creaturesNearby(limit)
      .map(creature => ({ ...creature, pathDistance: creaturePathDistance(creature) }))
      .filter(creature => creature.pathDistance <= limit)
      .sort((a, b) => a.pathDistance - b.pathDistance);
  }

  function isAttackedByAnotherPlayer(creature) {
    const until = otherPlayerAttackUntil.get(String(creature?.id));
    if (!until) return false;
    if (until <= Date.now()) {
      otherPlayerAttackUntil.delete(String(creature.id));
      return false;
    }
    return true;
  }

  mod.targetCreature = id => {
    const entity = entities.get(id);
    if (!entity || entity.k !== 1) return { ok: false, error: "A criatura não está mais visível." };
    if (!gameSocket || gameSocket.readyState !== WebSocket.OPEN) return { ok: false, error: "WebSocket do jogo não está conectado." };
    const sendFromClient = window.gameDebug?.send;
    if (typeof sendFromClient === "function") sendFromClient({ t: "target", id });
    else gameSocket.send(JSON.stringify({ t: "target", id }));
    return { ok: true, id };
  };

  mod.startHunt = (names = huntState.names, radius = huntState.radius) => {
    if (myself.dead) return { ok: false, error: "O personagem morreu; a caça não pode ser iniciada." };
    const list = (Array.isArray(names) ? names : String(names).split(/[\n,;]+/))
      .map(name => String(name).trim()).filter(Boolean);
    if (!list.length) return { ok: false, error: "Informe pelo menos um nome de criatura." };
    const range = Number(radius);
    if (!Number.isFinite(range) || range < 1 || range > 100) return { ok: false, error: "O raio deve ficar entre 1 e 100 tiles." };
    huntState.training = false;
    huntState.names = [...new Set(list)];
    huntState.types = [];
    huntState.radius = Math.floor(range);
    huntState.enabled = true;
    huntState.status = "Caça ativa";
    try {
      localStorage.setItem("fantasy-mod-hunt-names", JSON.stringify(huntState.names));
      localStorage.setItem("fantasy-mod-hunt-radius", String(huntState.radius));
    } catch {}
    queueInitialHuntTravel();
    return { ok: true, names: huntState.names, radius: huntState.radius };
  };
  mod.startHuntTargets = (types = Object.keys(mod.targets).filter(type => mod.targets[type]), radius = huntState.radius, useLure = false, training = false) => {
    if (myself.dead) return { ok: false, error: "O personagem morreu; a caça não pode ser iniciada." };
    const list = [...new Set((Array.isArray(types) ? types : []).map(String))];
    if (!list.length && !huntState.attackAny) return { ok: false, error: "Ative uma criatura em Alvos ou habilite atacar qualquer criatura." };
    const range = Number(radius);
    if (!Number.isFinite(range) || range < 1 || range > 100) return { ok: false, error: "O raio deve ficar entre 1 e 100 tiles." };
    huntState.training = !!training;
    if (huntState.training) {
      trainingIdleWatch = null;
      trainingIdleMove = null;
      huntTargetId = null;
      huntTargetSent = null;
      nextTrainingTargetAt = 0;
      if (huntState.lureEnabled) mod.setLureEnabled(false);
      mod.setFocusEnabled(false);
    }
    huntState.types = list;
    huntState.names = [];
    huntState.radius = Math.floor(range);
    huntState.enabled = true;
    if (useLure) {
      const lure = mod.setLureEnabled(true);
      if (!lure.ok) {
        huntState.enabled = false;
        huntState.status = "Parado";
        return lure;
      }
    }
    huntState.status = "Caça ativa";
    try { localStorage.setItem("fantasy-mod-hunt-radius", String(huntState.radius)); } catch {}
    if (!huntState.training) queueInitialHuntTravel();
    else { initialHuntTravel = null; huntTravelArrival = null; huntState.status = "Treino ativo"; }
    return { ok: true, types: list, radius: huntState.radius, lureEnabled: huntState.lureEnabled };
  };
  mod.stopHunt = (reason = "Caça parada pelo usuário.", preserveResume = false) => {
    finishTrainingElite();
    if (!preserveResume) {
      deathRecovery = null;
      resumeHuntAfterReturn = false;
      resumeLureAfterReturn = false;
      trainingCityTrip = false;
    }
    huntState.enabled = false;
    huntState.currentWaypoint = null;
    initialHuntTravel = null;
    huntTravelArrival = null;
    if (huntState.lureEnabled) mod.setLureEnabled(false, "Lure interrompido porque a caça foi parada.");
    huntState.status = "Parado";
    mod.log("info", reason);
    if (gameSocket?.readyState === WebSocket.OPEN) gameSocket.send(JSON.stringify({ t: "untarget" }));
    return { ok: true };
  };

  let huntTargetId = null;
  let trainingElite = null;
  let exhaustedTargetId = null;
  const trainingEliteAttackers = new Map();
  const classIds = { melee: 0, distance: 1, mage: 2 };
  function sendTrainingClass(classId) {
    if (!Number.isInteger(classId) || gameSocket?.readyState !== WebSocket.OPEN) return false;
    const packet = { t: "class", c: classId };
    if (typeof window.gameDebug?.send === "function") window.gameDebug.send(packet);
    else gameSocket.send(JSON.stringify(packet));
    return true;
  }
  function finishTrainingElite() {
    if (trainingElite) sendTrainingClass(trainingElite.previousClass);
    trainingElite = null;
    exhaustedTargetId = null;
    trainingEliteAttackers.clear();
  }
  let nextTrainingTargetAt = 0;
  let trainingIdleWatch = null;
  let trainingIdleMove = null;

  function processTrainingIdleMovement() {
    if (!huntState.enabled || !huntState.training || !huntState.trainingIdleMinutes) {
      trainingIdleWatch = null;
      trainingIdleMove = null;
      return false;
    }
    const now = Date.now();
    const position = `${myself.floor}:${myself.x}:${myself.y}`;
    if (trainingIdleMove) {
      const move = trainingIdleMove;
      if (move.floor !== myself.floor || (myself.x === move.x && myself.y === move.y)) {
        trainingIdleMove = null;
      } else if (move.pending && now < move.deadline && (myself.x !== move.pending.x || myself.y !== move.pending.y)) {
        huntState.trainingIdleRemainingSeconds = Math.ceil(huntState.trainingIdleMinutes * 60);
        huntState.status = "Treino: aproximando do waypoint após ficar parado";
        return true;
      } else if (move.pending && now >= move.deadline && (myself.x !== move.pending.x || myself.y !== move.pending.y)) {
        mod.log("warn", "Treino: movimento de aproximação não chegou ao destino.");
        trainingIdleMove = null;
      } else {
        const point = {
          x: myself.x + Math.max(-20, Math.min(20, move.x - myself.x)),
          y: myself.y + Math.max(-20, Math.min(20, move.y - myself.y))
        };
        const outcome = mod.move(point.x, point.y, { requireExact: true });
        if (outcome.ok) {
          move.pending = point;
          move.deadline = now + Math.min(40000, 3000 + (outcome.steps ?? 1) * 800);
          huntState.trainingIdleRemainingSeconds = Math.ceil(huntState.trainingIdleMinutes * 60);
          huntState.status = "Treino: aproximando do waypoint após ficar parado";
          return true;
        }
        mod.log("warn", `Treino: não foi possível chegar à metade do caminho: ${outcome.error}`);
        trainingIdleMove = null;
      }
      trainingIdleWatch = null;
    }
    if (!trainingIdleWatch || trainingIdleWatch.position !== position || now - trainingIdleWatch.lastTick > 3000) {
      trainingIdleWatch = { position, since: now, lastTick: now };
      huntState.trainingIdleRemainingSeconds = Math.ceil(huntState.trainingIdleMinutes * 60);
      return false;
    }
    trainingIdleWatch.lastTick = now;
    huntState.trainingIdleRemainingSeconds = Math.max(0, Math.ceil((huntState.trainingIdleMinutes * 60000 - (now - trainingIdleWatch.since)) / 1000));
    if (now - trainingIdleWatch.since < huntState.trainingIdleMinutes * 60000) return false;
    const waypoint = mod.waypoints[huntWaypointIndex]?.floor === myself.floor
      ? mod.waypoints[huntWaypointIndex] : mod.waypoints.find(point => point.floor === myself.floor);
    trainingIdleWatch.since = now;
    huntState.trainingIdleRemainingSeconds = Math.ceil(huntState.trainingIdleMinutes * 60);
    if (!waypoint) {
      mod.log("warn", "Treino: nenhum waypoint cadastrado neste andar para sair da posição parada.");
      return false;
    }
    const dx = waypoint.x - myself.x, dy = waypoint.y - myself.y;
    if (!dx && !dy) return false;
    const halfway = {
      x: myself.x + Math.sign(dx) * Math.ceil(Math.abs(dx) / 2),
      y: myself.y + Math.sign(dy) * Math.ceil(Math.abs(dy) / 2),
      floor: myself.floor,
      pending: null
    };
    trainingIdleMove = halfway;
    waypointMovePending = null;
    mod.log("info", `Treino: aproximando até (${halfway.x}, ${halfway.y}), metade da distância ao waypoint.`);
    return processTrainingIdleMovement();
  }
  let nextHuntMoveAt = 0;
  let nextFocusMoveAt = 0;
  let huntTargetSent = null;
  let huntTargetSentAt = 0;
  let pendingIdleTravelConfirm = null;
  let nextTravelCombatMoveAt = 0;
  let pursuitGoal = null;
  const blockedMobPositions = new Map();
  const huntSkipLogAt = new Map();
  let huntLootId = null;
  let nextLootMoveAt = 0;
  let nextLootPickupAt = 0;
  function ensureHuntTarget(creature) {
    const id = String(creature.id);
    const now = Date.now();
    const serverReportsTarget = Object.hasOwn(playerStats, "target");
    if (serverReportsTarget && playerStats.target != null
      && String(playerStats.target) === id) {
      huntTargetSent = creature.id;
      huntTargetSentAt = now;
      return true;
    }
    if (String(huntTargetSent) === id
      && (!serverReportsTarget || now - huntTargetSentAt < 1200)) return true;
    const outcome = mod.targetCreature(creature.id);
    if (outcome.ok) {
      huntTargetSent = creature.id;
      huntTargetSentAt = now;
      return true;
    }
    huntState.status = outcome.error;
    return false;
  }
  function processFocusTarget() {
    const selected = playerStats.target;
    const targetId = selected && typeof selected === "object" ? selected.id : selected;
    if (targetId == null) {
      focusState.status = "Focar ativo; selecione um target no jogo.";
      return;
    }
    const creatureTarget = mod.creaturesNearby(100)
      .find(creature => String(creature.id) === String(targetId));
    const playerEntry = [...entities].find(([id, entity]) =>
      String(id) === String(targetId) && entity.k === 0
        && Number.isInteger(entity.x) && Number.isInteger(entity.y)
        && (entity.f == null || entity.f === myself.floor));
    const target = creatureTarget ?? (playerEntry ? (() => {
      const [id, entity] = playerEntry;
      return {
        id,
        type: "player",
        name: typeof entity.n === "string" ? entity.n : entity.n?.pt ?? entity.n?.en ?? "Jogador",
        x: entity.x,
        y: entity.y,
        floor: entity.f ?? myself.floor,
        hp: entity.hp ?? null,
        distance: Math.max(Math.abs(entity.x - myself.x), Math.abs(entity.y - myself.y))
      };
    })() : null);
    if (!target) {
      focusState.status = "Target selecionado, aguardando dados da criatura.";
      return;
    }
    const attackRange = 4;
    const canAttack = target.distance <= attackRange && hasAttackLine(myself.x, myself.y, target);
    if (focusState.followTarget && !canAttack) {
      if (Date.now() >= nextFocusMoveAt) {
        const outcome = moveTowardAttackRange(target, attackRange);
        focusState.status = outcome.ok
          ? `Seguindo ${target.name} · ${target.distance}/${attackRange} tiles`
          : `Não foi possível seguir ${target.name}: ${outcome.error}`;
        nextFocusMoveAt = Date.now() + (outcome.ok ? 900 : 1200);
      } else focusState.status = `Seguindo ${target.name} · ${target.distance}/${attackRange} tiles`;
    } else focusState.status = `Focando ${target.name} · ${target.distance} tiles`;
    if (focusState.useSkill && canAttack) {
      const outcome = mod.useHuntSpecial();
      if (!outcome.ok && !/cooldown|aguardando cooldown/i.test(outcome.error ?? "")) {
        focusState.status = `Focando ${target.name}: ${outcome.error}`;
      }
    }
  }
  let trainingCityTrip = false;
  let fullBagTravelStarted = false;
  let fullBagTravelPending = false;
  let fullBagTravelStage = 0;
  let fullBagSecondPacketAt = 0;
  let savedHuntPosition = null;
  let returnTravelPending = false;
  let returnTravelStage = 0;
  let returnSecondPacketAt = 0;
  let returnTravelStarted = false;
  let initialHuntTravel = null;
  let huntTravelArrival = null;
  let suppressShopDisplay = false;
  let suppressShopReopenUntilReturn = false;
  let resumeHuntAfterReturn = false;
  let resumeLureAfterReturn = false;
  let deathRecovery = null;
  Object.defineProperty(huntState, "resumeAfterReturn", { configurable: true, get: () => resumeHuntAfterReturn });
  let fullBagArrivalLogged = false;
  let fullBagNpcNamesLogged = false;
  let fullBagNpcSearchEmptyLogged = false;
  let fullBagNpcInteractionSent = false;
  let arrowsDepletionReturn = false;
  function readDestinationCoordinate(key, fallback, max) {
    try {
      const saved = localStorage.getItem(key);
      const value = saved === null ? fallback : Number(saved);
      return Number.isInteger(value) && value >= 0 && value <= max ? value : fallback;
    } catch { return fallback; }
  }
  const shopDestination = {
    x: readDestinationCoordinate("fantasy-mod-shop-x", 317, 100000),
    y: readDestinationCoordinate("fantasy-mod-shop-y", 231, 100000),
    floor: readDestinationCoordinate("fantasy-mod-shop-floor", 0, 20)
  };
  Object.defineProperty(mod, "shopDestination", { configurable: true, get: () => ({ ...shopDestination }) });
  mod.configureShop = settings => {
    const x = Number(settings?.x ?? shopDestination.x);
    const y = Number(settings?.y ?? shopDestination.y);
    const floor = Number(settings?.floor ?? shopDestination.floor);
    if (![x, y, floor].every(Number.isInteger) || x < 0 || x > 100000
      || y < 0 || y > 100000 || floor < 0 || floor > 20) {
      return { ok: false, error: "Use X e Y inteiros de 0 a 100000 e andar de 0 a 20." };
    }
    if (fullBagTravelPending || activeSellShop) {
      return { ok: false, error: "Aguarde a viagem ou venda atual terminar para alterar a loja." };
    }
    try {
      localStorage.setItem("fantasy-mod-shop-x", String(x));
      localStorage.setItem("fantasy-mod-shop-y", String(y));
      localStorage.setItem("fantasy-mod-shop-floor", String(floor));
    } catch { return { ok: false, error: "Não foi possível salvar as coordenadas da loja." }; }
    Object.assign(shopDestination, { x, y, floor });
    return { ok: true, ...shopDestination };
  };
  let gearMerchantNpcId = null;
  let travelCombat = null;
  let travelPosition = null;
  let travelPositionChangedAt = 0;
  let activeSellShop = null;
  let shopSellWaiting = false;
  let shopSellInventorySignature = "";
  let shopSellDeadline = 0;
  let nextShopSellAt = 0;
  let shopSellDoneLogged = false;
  let shopSoldCount = 0;
  let shopPendingItemName = "";
  let shopVisitFinishing = false;
  let shopFinishTimer = 0;
  let refillNpcId = null;
  let refillPurchaseQueue = [];
  let nextRefillBuyAt = 0;
  let refillTrip = null;
  let refillReturnTo = null;
  let guardedShopScreenManager = null;
  let originalShopScreenShow = null;
  let lastHuntDiagnostic = "";
  function logHuntProgress() {
    const snapshot = `${huntState.enabled ? 1 : 0}|${huntState.lureEnabled ? 1 : 0}|${huntState.status ?? ""}`;
    if (snapshot === lastHuntDiagnostic) return;
    lastHuntDiagnostic = snapshot;
    if (!huntState.enabled && !huntState.lureEnabled) return;
    const status = String(huntState.status ?? "");
    const level = /erro|falha|aguardando|cadastre|outro andar|indisponível|não foi|não encontrei|sem rota|rota válida/i.test(status) ? "warn" : "info";
    mod.log(level, `${huntState.lureEnabled ? "Lure" : "Caça"}: ${status || "em execução"}`);
  }
  function isIgnoredAtBlockedPosition(creature) {
    const blocked = blockedMobPositions.get(String(creature.id));
    if (!blocked) return false;
    if (blocked.x === creature.x && blocked.y === creature.y) return true;
    blockedMobPositions.delete(String(creature.id));
    return false;
  }
  function ignoreMobAtCurrentPosition(creature, reason) {
    if (!/rota válida/i.test(String(reason ?? ""))) return false;
    blockedMobPositions.set(String(creature.id), { x: creature.x, y: creature.y });
    if (String(huntTargetId) === String(creature.id)) {
      huntTargetId = null;
      huntTargetSent = null;
      pursuitGoal = null;
      nextHuntMoveAt = 0;
    }
    return true;
  }
  const normalizeName = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const AUTO_LOOT_RADIUS = 10;
  const isGoldDrop = entity => entity?.it === 4
    || /\b(ouro|gold|bronze|moeda|coin|coins)\b/.test(normalizeName(entity?.n));
  const isOwnLoot = entity => entity?.mine === true || entity?.mine === 1;
  function hasAttackLine(x0, y0, target) {
    if (!gameWorld || !Number.isInteger(x0) || !Number.isInteger(y0)
      || !Number.isInteger(target?.x) || !Number.isInteger(target?.y)) return false;
    const walls = new Set(currentWalls.map(([x, y]) => `${x},${y}`));
    const blockers = new Set();
    for (const [id, entity] of entities) {
      if (String(id) === String(myself.id) || String(id) === String(target.id)
        || entity.x == null || entity.y == null || entity.k === 3 || entity.tr
        || (entity.f != null && entity.f !== myself.floor)) continue;
      blockers.add(`${entity.x},${entity.y}`);
    }
    let x = x0, y = y0;
    const dx = Math.abs(target.x - x0), dy = Math.abs(target.y - y0);
    const sx = x0 < target.x ? 1 : -1, sy = y0 < target.y ? 1 : -1;
    let error = dx - dy;
    while (x !== target.x || y !== target.y) {
      const twice = 2 * error;
      if (twice > -dy) { error -= dy; x += sx; }
      if (twice < dx) { error += dx; y += sy; }
      if (x === target.x && y === target.y) break;
      const key = `${x},${y}`;
      if (!gameWorld.isWalkable(myself.floor, x, y) || walls.has(key) || blockers.has(key)) return false;
    }
    return true;
  }
  function isEliteCreature(creature) {
    if (!creature) return false;
    const entity = entities.get(creature.id) ?? {};
    const data = monsterData.get(creature.type) ?? {};
    return [entity, data].some(record => {
      const rank = record.rk ?? record.rank;
      return record.elite === true || record.isElite === true || record.is_elite === true
        || rank === true || (typeof rank === "number" && rank > 0)
        || (typeof rank === "string" && /elite/i.test(rank))
        || /\belite\b/i.test(String(record.name?.pt ?? record.name ?? record.n ?? ""));
    });
  }
  function processAutoLoot(target) {
    const collectGold = !huntState.training || huntState.autoLootGold;
    if (!huntState.autoLoot && !huntState.training) {
      huntState.lootStatus = huntState.lureEnabled
        ? `Reunindo criaturas: ${huntState.lureProgress.current}/${huntState.lureProgress.target}`
        : "Desativado";
      return false;
    }
    if (gameSocket?.readyState !== WebSocket.OPEN) {
      huntState.lootStatus = "Aguardando conexão para coletar";
      return false;
    }
    const visibleDrops = [...entities.values()]
      .filter(entity => entity.k === 3 && isOwnLoot(entity)
        && Number.isInteger(entity.x) && Number.isInteger(entity.y)
        && (entity.f == null || entity.f === myself.floor));
    // Once a player is seen standing on a drop, remember that drop's entity
    // ID for this session. It must not become a loot target after the player
    // walks away.
    for (const drop of visibleDrops) {
      const coveredByPlayer = [...entities.values()].some(entity =>
        String(entity.id) !== String(myself.id)
        && entity.k === 0
        && entity.x === drop.x && entity.y === drop.y
        && (entity.f == null || entity.f === myself.floor));
      if (coveredByPlayer) {
        ignoredPlayerCoveredLoot.add(String(drop.id));
        if (ignoredPlayerCoveredLoot.size > 5000) {
          ignoredPlayerCoveredLoot.delete(ignoredPlayerCoveredLoot.values().next().value);
        }
      }
    }
    const drops = visibleDrops
      .filter(entity => !ignoredPlayerCoveredLoot.has(String(entity.id))
        && Number.isInteger(entity.x) && Number.isInteger(entity.y)
        && (isGoldDrop(entity) ? collectGold : (mod.inventory.known && !mod.inventory.full)))
      .map(entity => ({ entity, distance: Math.max(Math.abs(entity.x - myself.x), Math.abs(entity.y - myself.y)) }))
      .filter(item => item.distance <= AUTO_LOOT_RADIUS)
      .sort((a, b) => a.distance - b.distance);
    const lootTileOccupied = item => [...entities.values()].some(entity =>
      String(entity.id) !== String(myself.id)
      && (entity.k === 0 || entity.k === 1)
      && entity.x === item.entity.x && entity.y === item.entity.y
      && (entity.f == null || entity.f === myself.floor));
    const loot = drops.find(item => !lootTileOccupied(item));
    if (!loot) {
      if (drops.length) {
        huntState.status = "Drop bloqueado por criatura ou jogador";
        huntState.lootStatus = "Aguardando liberar o tile do drop";
        return false;
      }
      huntState.lootStatus = mod.inventory.full
        ? `Mochila cheia (${mod.inventory.used}/${mod.inventory.capacity})${collectGold ? "; procurando apenas ouro" : ""}`
        : !mod.inventory.known ? (collectGold ? "Aguardando dados da mochila; apenas ouro pode ser coletado" : "Aguardando dados da mochila") : "Caçando; nenhum drop próximo";
      return false;
    }
    const id = loot.entity.id;
    if (String(huntLootId) !== String(id)) {
      huntLootId = id;
      nextLootMoveAt = 0;
    }
    if (loot.distance === 0) {
      const now = Date.now();
      if (now >= nextLootPickupAt) {
        gameSocket.send(JSON.stringify({ t: "pickup", id }));
        nextLootPickupAt = now + 500;
        huntState.status = `Coletando drop (${loot.entity.n ?? "item"})`;
        huntState.lootStatus = `Coletando ${loot.entity.n ?? "item"}`;
      } else {
        huntState.status = `Aguardando coleta (${loot.entity.n ?? "item"})`;
        huntState.lootStatus = "Intervalo antes do próximo envio";
      }
      return !target;
    }
    if (Date.now() >= nextLootMoveAt) {
      const outcome = mod.move(loot.entity.x, loot.entity.y);
      huntState.status = outcome.ok ? `Indo coletar drop (${loot.entity.n ?? "item"})` : outcome.error;
      huntState.lootStatus = outcome.ok ? `Indo até ${loot.entity.n ?? "drop"}` : outcome.error;
      nextLootMoveAt = Date.now() + (outcome.ok ? 3500 : 1200);
    }
    return true;
  }
  function shopItemName(itemId) {
    const item = getAssetItem(getGameAssets(), itemId);
    const rawName = item?.name;
    return typeof rawName === "string" ? rawName
      : rawName?.pt ?? rawName?.en ?? rawName?.es ?? `Item ${itemId}`;
  }
  function protectShopScreen() {
    const screens = window.gameDebug?.state?.().screens;
    if (!screens || typeof screens.show !== "function") return screens;
    if (guardedShopScreenManager !== screens) {
      guardedShopScreenManager = screens;
      originalShopScreenShow = screens.show;
      screens.show = function (name, ...args) {
        if ((suppressShopDisplay || suppressShopReopenUntilReturn)
          && (name === "shop" || name === "shopItem")) return;
        return originalShopScreenShow.call(this, name, ...args);
      };
    }
    return screens;
  }
  function restoreShopScreen() {
    if (guardedShopScreenManager && originalShopScreenShow) {
      guardedShopScreenManager.show = originalShopScreenShow;
      guardedShopScreenManager = null;
      originalShopScreenShow = null;
    }
  }
  function clickGameBackButton() {
    const canvas = document.getElementById("game");
    const rect = canvas?.getBoundingClientRect();
    if (!canvas || !rect || rect.width < 80 || rect.height < 80) return false;
    // The game's back arrow sits at the upper-right edge of the game canvas.
    const clientX = rect.right - Math.min(28, rect.width * 0.04);
    const clientY = rect.top + Math.min(38, rect.height * 0.08);
    const pointer = (type, buttons) => new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons,
      clientX,
      clientY
    });
    canvas.dispatchEvent(pointer("pointerdown", 1));
    canvas.dispatchEvent(pointer("pointerup", 0));
    canvas.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX,
      clientY
    }));
    return true;
  }
  function clickGameCanvasTopLeft() {
    const canvas = document.getElementById("game");
    const rect = canvas?.getBoundingClientRect();
    if (!canvas || !rect || rect.width < 80 || rect.height < 80) return false;
    const clientX = rect.left + Math.min(28, rect.width * 0.04);
    const clientY = rect.top + Math.min(38, rect.height * 0.08);
    const pointer = (type, buttons) => new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons,
      clientX,
      clientY
    });
    canvas.dispatchEvent(pointer("pointerdown", 1));
    canvas.dispatchEvent(pointer("pointerup", 0));
    canvas.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX,
      clientY
    }));
    return true;
  }
  function finishRefillPurchases() {
    if (refillPurchaseQueue.length) return;
    const returnTo = refillReturnTo ? { ...refillReturnTo } : null;
    mod.refill.status = returnTo ? "Voltando para a caça" : "Compras do refill enviadas";
    mod.log("info", returnTo
      ? "Refill concluído; fechando a loja e voltando à posição salva da caça."
      : "Refill concluído; fechando a loja pelo canto superior esquerdo do canvas.");
    setTimeout(() => {
      if (refillPurchaseQueue.length) return;
      const screens = protectShopScreen();
      if (screens?.current && ["shop", "shopItem"].includes(screens.current.name)) screens.current = null;
      const panel = document.getElementById("panel");
      if (panel && !panel.hidden) {
        const closeButton = panel.querySelector("button.close");
        if (closeButton) closeButton.click();
        if (!panel.hidden) panel.hidden = true;
      }
      const clicked = clickGameCanvasTopLeft();
      if (!clicked) mod.log("warn", "Refill concluído, mas não encontrei o canvas para clicar.");
      if (returnTo) {
        savedHuntPosition = returnTo;
        returnTravelPending = false;
        returnTravelStage = 0;
        returnTravelStarted = false;
        suppressShopReopenUntilReturn = true;
        suppressShopDisplay = true;
      } else {
        refillReturnTo = null;
        suppressShopReopenUntilReturn = false;
        suppressShopDisplay = false;
        restoreShopScreen();
      }
      if (switchServerEnabled()) {
        deathRecovery = { stage: "chooseChannel", nextAt: Date.now(), socket: gameSocket, origin: "refill", returnTo: !!returnTo };
        huntState.status = "Refill concluído; preparando troca de servidor";
      } else if (returnTo) {
        returnTravelPending = true;
        huntState.status = "Refill concluído; preparando retorno à caça";
      }
      mod.log("info", huntState.status);
    }, 1000);
  }
  function closeGameShopPanel() {
    try {
      const screens = protectShopScreen();
      if (screens?.current && ["shop", "shopItem"].includes(screens.current.name)) screens.current = null;
      if (screens?.current && ["shop", "shopItem"].includes(screens.current.name)) {
        mod.log("warn", `A tela da loja continua ativa (${screens.current.name}).`);
      } else if (!screens) mod.log("warn", "O controlador de telas do jogo não está disponível.");
    } catch (error) {
      mod.log("error", `Falha ao fechar a tela da loja: ${error?.message ?? error}`);
    }
    const panel = document.getElementById("panel");
    if (panel && !panel.hidden) {
      const closeButton = panel.querySelector("button.close");
      if (closeButton) closeButton.click();
      if (!panel.hidden) {
        // The game panel's close() only hides this root. Some UI refreshes can
        // replace the button between the sale response and this callback.
        panel.hidden = true;
      }
    }
    clickGameBackButton();
    return !panel || panel.hidden;
  }
  function finishShopVisit() {
    if (shopVisitFinishing || suppressShopReopenUntilReturn) return;
    shopVisitFinishing = true;
    mod.log("info", "Vendas encerradas; aguardando 1 segundo para fechar a loja e voltar.");
    shopFinishTimer = setTimeout(() => {
      shopFinishTimer = 0;
      suppressShopReopenUntilReturn = true;
      if (huntState.refillAfterSale || trainingCityTrip) {
        shopVisitFinishing = false;
        refillReturnTo = savedHuntPosition ? { ...savedHuntPosition } : null;
        refillTrip = {
          target: { ...mod.refill },
          returnTo: savedHuntPosition ? { ...savedHuntPosition } : null,
          stage: 0,
          startedAt: Date.now(),
          emptyLogged: false,
          foundLogged: false
        };
        returnTravelPending = false;
        huntState.status = `Venda concluída; indo para refill em (${mod.refill.x}, ${mod.refill.y})`;
        mod.log("info", `Venda concluída; iniciando refill em (${mod.refill.x}, ${mod.refill.y}), andar ${mod.refill.floor}.`);
      } else if (savedHuntPosition) {
        returnTravelPending = true;
        returnTravelStage = 0;
      } else {
        huntState.autoSellInProgress = false;
        window.__fantasyAutoSellInProgress = false;
        suppressShopDisplay = false;
        suppressShopReopenUntilReturn = false;
        restoreShopScreen();
      }
      closeGameShopPanel();
      setTimeout(closeGameShopPanel, 150);
      setTimeout(closeGameShopPanel, 600);
    }, 1000);
    activeSellShop = null;
  }
  function finishRefillTrip() {
    const completed = refillTrip;
    if (!completed) return;
    refillTrip = null;
    if (completed.returnTo) {
      savedHuntPosition = { ...completed.returnTo };
      refillReturnTo = { ...completed.returnTo };
      returnTravelPending = true;
      returnTravelStage = 0;
      huntState.status = "NPCs do refill localizados; preparando retorno à caça";
      mod.log("info", "Busca de NPCs do refill concluída; voltando à posição salva.");
    } else {
      huntState.status = "Teste de refill concluído; veja os NPCs no Console do Mod";
      mod.refill.status = "Busca concluída";
      mod.log("info", "Teste de refill concluído.");
    }
  }
  function processRefillTrip() {
    if (!refillTrip) return false;
    const trip = refillTrip;
    if (gameSocket?.readyState !== WebSocket.OPEN) {
      mod.refill.status = "Aguardando conexão";
      huntState.status = "Refill aguardando conexão com o jogo";
      return true;
    }
    const now = Date.now();
    try {
      if (trip.stage === 0) {
        const { x, y, floor } = trip.target;
        gameSocket.send(JSON.stringify({ t: "travel", id: 1, go: false, f: floor, x, y }));
        trip.stage = 1;
        trip.secondAt = now + 2000;
        mod.refill.status = `Preparando viagem para ${x}, ${y}`;
        huntState.status = `Refill preparando travel para (${x}, ${y})`;
        return true;
      }
      if (trip.stage === 1) {
        if (now < trip.secondAt) return true;
        const { x, y, floor } = trip.target;
        gameSocket.send(JSON.stringify({ t: "travel", id: 2, go: true, f: floor, x, y }));
        trip.stage = 2;
        trip.deadline = now + 120000;
        mod.refill.status = `Indo para ${x}, ${y}`;
        huntState.status = `Refill viajando para (${x}, ${y})`;
        mod.log("info", `Travel de refill iniciado para (${x}, ${y}), andar ${floor}.`);
        return true;
      }
      if (trip.stage === 2) {
        const { x, y, floor } = trip.target;
        const distance = Math.max(Math.abs(x - myself.x), Math.abs(y - myself.y));
        if (myself.floor === floor && distance <= 1) {
          trip.stage = 3;
          trip.searchUntil = now + 10000;
          mod.refill.status = "Procurando NPCs próximos";
          huntState.status = "Chegou ao ponto de refill; procurando NPCs próximos";
          mod.log("info", `Chegou ao ponto de refill (${x}, ${y}); procurando NPCs em até ${trip.target.radius} tiles.`);
        } else if (now >= trip.deadline) {
          mod.log("warn", "Viagem de refill não confirmou chegada dentro de 120 segundos.");
          finishRefillTrip();
          return true;
        } else return true;
      }
      if (trip.stage === 3) {
        const { radius, floor } = trip.target;
        const nearby = [...entities.values()]
          .filter(entity => entity.k === 2 && Number.isInteger(entity.x) && Number.isInteger(entity.y)
            && (entity.f == null || entity.f === floor))
          .map(entity => {
            const rawName = entity.nick ?? entity.name ?? entity.n;
            const nick = typeof rawName === "string" ? rawName
              : rawName?.pt ?? rawName?.en ?? rawName?.es ?? `NPC ${entity.id}`;
            return { id: entity.id, nick, distance: Math.max(Math.abs(entity.x - myself.x), Math.abs(entity.y - myself.y)) };
          })
          .filter(npc => npc.distance <= radius)
          .sort((a, b) => a.distance - b.distance);
        if (nearby.length) {
          if (!trip.foundLogged) {
            trip.foundLogged = true;
            mod.log("info", `NPCs do refill encontrados — nick: ${nearby.map(npc => `${npc.nick} (${npc.distance} tiles)`).join(", ")}`);
          }
          const suppliesMerchant = nearby.find(npc => normalizeName(npc.nick).trim() === "supplies merchant");
          if (suppliesMerchant && gameSocket?.readyState === WebSocket.OPEN) {
            refillNpcId = suppliesMerchant.id;
            gameSocket.send(JSON.stringify({ t: "talk", id: suppliesMerchant.id }));
            trip.stage = 4;
            trip.shopDeadline = now + 10000;
            mod.refill.status = "Abrindo Supplies Merchant";
            huntState.status = "Supplies Merchant encontrado; abrindo a loja";
            mod.log("info", `Interagindo com Supplies Merchant (${suppliesMerchant.distance} tile${suppliesMerchant.distance === 1 ? "" : "s"}); aguardando a janela da loja.`);
            return true;
          }
        }
        if (!trip.emptyLogged) {
          trip.emptyLogged = true;
          mod.log("info", `Ainda não encontrei NPCs em até ${radius} tiles do ponto de refill; continuarei procurando por 10 segundos.`);
        }
        if (now >= trip.searchUntil) {
          mod.log("warn", `Supplies Merchant não encontrado em até ${radius} tiles do ponto de refill.`);
          mod.refill.status = "Supplies Merchant não encontrado";
          finishRefillTrip();
        }
        return true;
      }
      if (trip.stage === 4) {
        if (now >= trip.shopDeadline) {
          refillNpcId = null;
          mod.log("warn", "Supplies Merchant não abriu a loja dentro de 10 segundos.");
          finishRefillTrip();
        }
        return true;
      }
    } catch (error) {
      mod.refill.status = `Erro: ${error?.message ?? error}`;
      mod.log("error", `Falha no travel de refill: ${error?.message ?? error}`);
      finishRefillTrip();
    }
    return true;
  }
  mod.configureRefill = settings => {
    const x = Number(settings?.x ?? mod.refill?.x ?? 314);
    const y = Number(settings?.y ?? mod.refill?.y ?? 215);
    const floor = Number(settings?.floor ?? mod.refill?.floor ?? 0);
    const radius = Number(settings?.radius ?? mod.refill?.radius ?? 2);
    if (![x, y, floor, radius].every(Number.isInteger) || x < 0 || y < 0 || floor < 0
      || x > 100000 || y > 100000 || floor > 20 || radius < 1 || radius > 10) {
      return { ok: false, error: "Use coordenadas inteiras e raio entre 1 e 10 tiles." };
    }
    mod.refill = { ...mod.refill, x, y, floor, radius };
    try {
      localStorage.setItem("fantasy-mod-refill-x", String(x));
      localStorage.setItem("fantasy-mod-refill-y", String(y));
      localStorage.setItem("fantasy-mod-refill-floor", String(floor));
      localStorage.setItem("fantasy-mod-refill-radius", String(radius));
    } catch {}
    return { ok: true, ...mod.refill };
  };
  mod.testRefill = settings => {
    const configured = mod.configureRefill(settings);
    if (!configured.ok) return configured;
    if (refillTrip || returnTravelPending || fullBagTravelPending || activeSellShop) {
      return { ok: false, error: "Já existe uma viagem ou venda em andamento." };
    }
    if (!Number.isInteger(myself.x) || !Number.isInteger(myself.y) || !Number.isInteger(myself.floor)) {
      return { ok: false, error: "A posição do personagem ainda não está disponível." };
    }
    const resumeHunt = !!(huntState.enabled || huntState.lureEnabled);
    const resumeLure = !!huntState.lureEnabled;
    const returnTo = { x: myself.x, y: myself.y, floor: myself.floor };
    mod.stopHunt();
    savedHuntPosition = returnTo;
    resumeHuntAfterReturn = resumeHunt;
    resumeLureAfterReturn = resumeLure;
    refillTrip = { target: { ...mod.refill }, returnTo, stage: 0, startedAt: Date.now(), emptyLogged: false, foundLogged: false };
    mod.refill.status = `Preparando teste para ${mod.refill.x}, ${mod.refill.y}`;
    huntState.status = "Teste de refill iniciado";
    mod.log("info", `Teste de refill iniciado para (${mod.refill.x}, ${mod.refill.y}), andar ${mod.refill.floor}.`);
    return { ok: true, target: { ...mod.refill } };
  };
  mod.setRefillItems = items => {
    if (!Array.isArray(items)) return { ok: false, error: "A lista de itens do refill é inválida." };
    const normalized = [];
    for (const item of items) {
      const id = String(item?.id ?? "");
      const quantity = Number(item?.quantity);
      if (!id || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000000) {
        return { ok: false, error: "Cada item precisa ter ID e estoque desejado entre 1 e 1.000.000." };
      }
      if (normalized.some(entry => entry.id === id)) continue;
      normalized.push({ id, name: String(item?.name ?? `Item ${id}`), quantity });
    }
    mod.refill.items = normalized;
    try { localStorage.setItem("fantasy-mod-refill-items", JSON.stringify(normalized)); } catch {}
    return { ok: true, items: normalized };
  };
  function ownedRefillStock(itemId) {
    const id = String(itemId);
    if (id === "3") return myself.arrows != null && Number.isFinite(Number(myself.arrows)) ? Number(myself.arrows) : null;
    const numericId = Number(id);
    const isPotion = Number.isInteger(numericId)
      && (potionTier("hp", numericId) >= 0 || potionTier("mp", numericId) >= 0);
    if (isPotion) {
      const potions = playerStats.potions ?? myself.potions;
      if (!potions || typeof potions !== "object") return null;
      const count = Number(potions[id] ?? 0);
      return Number.isFinite(count) ? count : null;
    }
    if (!mod.inventory.known) return null;
    return (mod.inventory.bag ?? []).reduce((total, entry) => {
      const entryId = Array.isArray(entry) ? entry[0] : entry;
      const quantity = Array.isArray(entry) ? Number(entry[1]) || 1 : 1;
      return String(entryId) === id ? total + quantity : total;
    }, 0);
  }
  function planRefillPackages(offers, deficit) {
    const usable = offers.map(offer => ({ ...offer, pack: Math.max(1, Math.floor(Number(offer.pack) || 1)) }))
      .filter(offer => offer.pack <= 1000000 && Number.isFinite(offer.price) && offer.price >= 0);
    if (!usable.length || !Number.isInteger(deficit) || deficit < 1) return [];
    const maxPack = Math.max(...usable.map(offer => offer.pack));
    const limit = deficit + maxPack - 1;
    const costs = new Float64Array(limit + 1);
    costs.fill(Infinity);
    const counts = new Uint32Array(limit + 1);
    const previous = new Int32Array(limit + 1);
    const selected = new Int32Array(limit + 1);
    previous.fill(-1);
    selected.fill(-1);
    costs[0] = 0;
    for (let amount = 0; amount <= limit; amount++) {
      if (!Number.isFinite(costs[amount])) continue;
      for (let index = 0; index < usable.length; index++) {
        const offer = usable[index];
        const next = amount + offer.pack;
        if (next > limit) continue;
        const nextCost = costs[amount] + offer.price;
        const nextCount = counts[amount] + 1;
        if (nextCost < costs[next] || nextCost === costs[next] && nextCount < counts[next]) {
          costs[next] = nextCost;
          counts[next] = nextCount;
          previous[next] = amount;
          selected[next] = index;
        }
      }
    }
    let bestAmount = -1;
    for (let amount = deficit; amount <= limit; amount++) {
      if (!Number.isFinite(costs[amount])) continue;
      if (bestAmount < 0 || costs[amount] < costs[bestAmount]
        || costs[amount] === costs[bestAmount] && (counts[amount] < counts[bestAmount]
          || counts[amount] === counts[bestAmount] && amount < bestAmount)) bestAmount = amount;
    }
    if (bestAmount < 0) return [];
    const packageCounts = new Map();
    for (let amount = bestAmount; amount > 0; amount = previous[amount]) {
      const offerIndex = selected[amount];
      if (offerIndex < 0 || previous[amount] < 0) return [];
      packageCounts.set(offerIndex, (packageCounts.get(offerIndex) ?? 0) + 1);
    }
    return [...packageCounts].map(([index, count]) => ({ offer: usable[index], count }));
  }
  function processRefillPurchases() {
    if (!refillPurchaseQueue.length) return false;
    if (gameSocket?.readyState !== WebSocket.OPEN || Date.now() < nextRefillBuyAt) return true;
    const purchase = refillPurchaseQueue[0];
    try {
      gameSocket.send(JSON.stringify({ t: "buy", npc: purchase.npc, i: purchase.index, q: 1 }));
      mod.log("info", `Compra ${purchase.order}/${purchase.orderCount}: ${purchase.units}x ${purchase.name} (ID ${purchase.id}), valor ${purchase.cost.toLocaleString()} moedas; estoque ${purchase.current} → ${purchase.target}.`);
      purchase.order++;
      if (purchase.order > purchase.orderCount) refillPurchaseQueue.shift();
      const packagesRemaining = refillPurchaseQueue.reduce((total, entry) => total + entry.orderCount - entry.order + 1, 0);
      mod.refill.status = packagesRemaining
        ? `Comprando ${purchase.name} (${packagesRemaining} pacote(s) restante(s))`
        : "Finalizando compras do refill";
      nextRefillBuyAt = Date.now() + 2000;
    } catch (error) {
      mod.log("error", `Falha ao comprar ${purchase.name}: ${error?.message ?? error}`);
      nextRefillBuyAt = Date.now() + 2000;
    }
    if (!refillPurchaseQueue.length) {
      setTimeout(finishRefillPurchases, 0);
    }
    return true;
  }
  function processShopAutoSell() {
    if (!(huntState.autoSell || trainingCityTrip) || !activeSellShop || activeSellShop.buys !== true || !mod.inventory.known) return false;
    const bag = mod.inventory.bag ?? [];
    const signature = JSON.stringify(bag);
    if (shopSellWaiting) {
      if (signature === shopSellInventorySignature) {
        if (Date.now() < shopSellDeadline) return true;
        shopSellWaiting = false;
        mod.log("warn", "Venda automática pausada: a mochila não atualizou após vender um item.");
        finishShopVisit();
        return true;
      }
      shopSellWaiting = false;
      shopSoldCount++;
      mod.log("info", `Venda confirmada: ${shopPendingItemName}.`);
      nextShopSellAt = Date.now() + 1000;
    }
    const selected = new Set((huntState.lootItemIds ?? []).map(String));
    const candidates = bag.map((itemId, index) => ({ itemId, index }))
      .filter(({ itemId }) => itemId != null && itemId !== false)
      .filter(({ itemId }) => {
        const assetItem = getAssetItem(getGameAssets(), itemId);
        const rawName = assetItem?.name;
        const names = typeof rawName === "string" ? [rawName]
          : Object.values(rawName ?? {}).filter(value => typeof value === "string");
        return (selected.has(String(itemId)) || names.some(name => selected.has(normalizeName(name))))
          && !(Number(assetItem?.rarity) >= 3);
      })
      .sort((a, b) => b.index - a.index);
    if (!candidates.length) {
      if (!shopSellDoneLogged) {
        shopSellDoneLogged = true;
        mod.log("info", shopSoldCount
          ? `Venda feita: ${shopSoldCount} item(ns) da lista de venda vendido(s).`
          : "Venda feita: nenhum item selecionado e vendável estava na mochila.");
      }
      finishShopVisit();
      return true;
    }
    if (Date.now() < nextShopSellAt) return true;
    if (gameSocket?.readyState !== WebSocket.OPEN) return true;
    const { itemId, index } = candidates[0];
    try {
      gameSocket.send(JSON.stringify({ t: "sell", npc: activeSellShop.npc, i: index }));
      shopSellInventorySignature = signature;
      shopSellDeadline = Date.now() + 3000;
      shopSellWaiting = true;
      const name = shopItemName(itemId);
      shopPendingItemName = name;
      mod.log("info", `Vendendo ${name} (slot ${index + 1}).`);
    } catch (error) {
      mod.log("error", `Falha ao vender item: ${error?.message ?? error}`);
      finishShopVisit();
    }
    return true;
  }
  function handleFullInventory() {
    const inventoryFull = mod.inventory.known && mod.inventory.full;
    const arrowsExhausted = myself.arrows != null
      && Number.isFinite(Number(myself.arrows)) && Number(myself.arrows) <= 0;
    const training = huntState.training;
    const lowPotions = training && huntState.trainingCityPotions && ["hp", "mp"].some(kind => {
      const { count } = potionStatus(kind);
      return count != null && count < 10;
    });
    const returnForArrows = arrowsExhausted && (!training || huntState.trainingCityArrows);
    const returnForBag = inventoryFull && (!training || huntState.trainingCityBag);
    const needsCityTrip = returnForBag || returnForArrows || lowPotions;
    const reason = returnForArrows ? "Flechas acabaram" : returnForBag ? "Mochila cheia" : "Poções abaixo de 10";
    if (!needsCityTrip && fullBagTravelStage !== 1) {
      fullBagTravelStarted = false;
      fullBagTravelPending = false;
      fullBagTravelStage = 0;
      fullBagArrivalLogged = false;
      fullBagNpcNamesLogged = false;
      fullBagNpcSearchEmptyLogged = false;
      fullBagNpcInteractionSent = false;
      return false;
    }
    if (fullBagTravelStarted) return false;
    if (!fullBagTravelPending) {
      if (!huntState.enabled && !huntState.lureEnabled) return false;
      if (Number.isInteger(myself.x) && Number.isInteger(myself.y) && Number.isInteger(myself.floor)) {
        savedHuntPosition = firstHuntWaypoint() ?? { x: myself.x, y: myself.y, floor: myself.floor };
        huntState.returnPosition = { ...savedHuntPosition };
        resumeHuntAfterReturn = true;
        resumeLureAfterReturn = !!huntState.lureEnabled;
        huntState.autoSellInProgress = !!huntState.autoSell;
        window.__fantasyAutoSellInProgress = huntState.autoSellInProgress;
        mod.log("info", `${reason}: posição de retorno salva em (${savedHuntPosition.x}, ${savedHuntPosition.y}), andar ${savedHuntPosition.floor}.`);
      } else {
        savedHuntPosition = null;
        huntState.returnPosition = null;
        resumeHuntAfterReturn = false;
        resumeLureAfterReturn = false;
        mod.log("warn", "Não foi possível salvar a posição de retorno da caça.");
      }
      trainingCityTrip = training;
      if (trainingCityTrip) huntState.autoSellInProgress = window.__fantasyAutoSellInProgress = true;
      arrowsDepletionReturn = returnForArrows;
      mod.stopHunt("Caça pausada durante a viagem para a cidade.", true);
      fullBagTravelPending = true;
    }
    huntState.status = `${reason}; indo para a cidade`;
    huntState.lootStatus = returnForArrows
      ? "Sem flechas; viajando para a cidade"
      : returnForBag ? `Mochila cheia (${mod.inventory.used}/${mod.inventory.capacity}); viajando para a loja`
        : "Poções abaixo de 10; viajando para a loja";
    if (gameSocket?.readyState !== WebSocket.OPEN) return true;
    try {
      if (fullBagTravelStage === 0) {
        gameSocket.send(JSON.stringify({ t: "travel", id: 1, go: false, f: shopDestination.floor, x: shopDestination.x, y: shopDestination.y }));
        fullBagTravelStage = 1;
        fullBagSecondPacketAt = Date.now() + 2000;
        huntState.status = `${reason}; aguardando 2 s para continuar a viagem`;
        return true;
      }
      if (fullBagTravelStage === 1 && Date.now() >= fullBagSecondPacketAt) {
        gameSocket.send(JSON.stringify({ t: "travel", id: 2, go: true, f: shopDestination.floor, x: shopDestination.x, y: shopDestination.y }));
        fullBagTravelStage = 2;
        fullBagTravelPending = false;
        fullBagTravelStarted = true;
        mod.log("info", `${reason}: caça parada; viagem para a cidade iniciada.`);
      }
    } catch (error) {
      huntState.status = `${reason}; falha ao iniciar viagem: ${error.message}`;
      mod.log("error", huntState.status);
    }
    return true;
  }
  function handleReturnTravel() {
    if (!returnTravelPending || !savedHuntPosition) return false;
    if (arrowsDepletionReturn && (myself.arrows == null
      || !Number.isFinite(Number(myself.arrows)) || Number(myself.arrows) <= 0)) {
      huntState.status = "Refill concluído; aguardando flechas antes de voltar à caça";
      return true;
    }
    if (gameSocket?.readyState !== WebSocket.OPEN) {
      huntState.status = "Venda concluída; aguardando conexão para voltar à caça";
      return true;
    }
    try {
      if (returnTravelStage === 0) {
        const { x, y, floor } = savedHuntPosition;
        gameSocket.send(JSON.stringify({ t: "travel", id: 1, go: false, f: floor, x, y }));
        returnTravelStage = 1;
        returnSecondPacketAt = Date.now() + 2000;
        huntState.status = `Venda concluída; preparando retorno para ${x}, ${y}`;
        return true;
      }
      if (returnTravelStage === 1 && Date.now() >= returnSecondPacketAt) {
        const { x, y, floor } = savedHuntPosition;
        gameSocket.send(JSON.stringify({ t: "travel", id: 2, go: true, f: floor, x, y }));
        returnTravelStage = 0;
        returnTravelPending = false;
        returnTravelStarted = true;
        fullBagTravelStarted = false;
        fullBagTravelStage = 0;
        huntState.status = `Voltando para a posição salva: ${x}, ${y}, andar ${floor}`;
        mod.log("info", `Venda concluída; retorno iniciado para (${x}, ${y}), andar ${floor}.`);
      }
    } catch (error) {
      huntState.status = `Falha ao voltar para a posição salva: ${error.message}`;
      mod.log("error", huntState.status);
    }
    return true;
  }
  function firstHuntWaypoint() {
    let firstWaypoint = mod.waypoints[0];
    if (huntState.lureEnabled) {
      firstWaypoint = mod.waypoints.find(point => {
        const route = mod.waypoints.filter(candidate => candidate.floor === point.floor);
        return new Set(route.map(candidate => `${candidate.x},${candidate.y}`)).size >= 2;
      }) ?? firstWaypoint;
    }
    return firstWaypoint ? { ...firstWaypoint } : null;
  }
  function queueInitialHuntTravel() {
    const firstWaypoint = firstHuntWaypoint();
    if (!firstWaypoint) {
      initialHuntTravel = null;
      huntTravelArrival = null;
      return false;
    }
    initialHuntTravel = { point: firstWaypoint, stage: 0, secondAt: 0 };
    huntTravelArrival = null;
    waypointMovePending = null;
    setHuntWaypointIndex(0);
    nextWaypointMoveAt = 0;
    huntState.status = `Preparando viagem para o waypoint inicial (${firstWaypoint.x}, ${firstWaypoint.y})`;
    mod.log("info", `Caça iniciada; preparando viagem para o primeiro waypoint (${firstWaypoint.x}, ${firstWaypoint.y}), andar ${firstWaypoint.floor}.`);
    return true;
  }
  function processInitialHuntTravel() {
    if (!initialHuntTravel && !huntTravelArrival) return false;
    if (!huntState.enabled && !huntState.lureEnabled) {
      initialHuntTravel = null;
      huntTravelArrival = null;
      return false;
    }
    if (gameSocket?.readyState !== WebSocket.OPEN) {
      huntState.status = "Aguardando conexão para ir ao waypoint inicial";
      return true;
    }
    const now = Date.now();
    try {
      if (initialHuntTravel?.stage === 0) {
        const { x, y, floor } = initialHuntTravel.point;
        gameSocket.send(JSON.stringify({ t: "travel", id: 1, go: false, f: floor, x, y }));
        initialHuntTravel.stage = 1;
        initialHuntTravel.secondAt = now + 2000;
        huntState.status = `Preparando viagem para o waypoint inicial (${x}, ${y})`;
        return true;
      }
      if (initialHuntTravel?.stage === 1) {
        if (now < initialHuntTravel.secondAt) return true;
        const { x, y, floor } = initialHuntTravel.point;
        gameSocket.send(JSON.stringify({ t: "travel", id: 2, go: true, f: floor, x, y }));
        initialHuntTravel = null;
        huntTravelArrival = { point: { x, y, floor }, deadline: now + 120000 };
        huntState.status = `Indo para o waypoint inicial (${x}, ${y})`;
        mod.log("info", `Viagem iniciada para o waypoint inicial (${x}, ${y}), andar ${floor}.`);
        return true;
      }
      if (huntTravelArrival) {
        const { point, deadline } = huntTravelArrival;
        const distance = Math.max(Math.abs(point.x - myself.x), Math.abs(point.y - myself.y));
        if (myself.floor === point.floor && distance <= 1) {
          huntTravelArrival = null;
          setHuntWaypointIndex(mod.waypoints.findIndex(candidate => candidate.x === point.x
            && candidate.y === point.y && candidate.floor === point.floor));
          if (huntWaypointIndex < 0) setHuntWaypointIndex(0);
          huntState.status = `Chegou ao waypoint inicial (${point.x}, ${point.y}); caça iniciada`;
          mod.log("info", huntState.status);
          return false;
        }
        if (now >= deadline) {
          huntTravelArrival = null;
          huntState.status = "Tempo de viagem ao waypoint inicial esgotado; caça retomada";
          mod.log("warn", huntState.status);
          return false;
        }
        huntState.status = `Indo para o waypoint inicial (${point.x}, ${point.y})`;
        return true;
      }
    } catch (error) {
      initialHuntTravel = null;
      huntTravelArrival = null;
      huntState.status = `Falha ao viajar para o waypoint inicial: ${error?.message ?? error}`;
      mod.log("error", huntState.status);
      return false;
    }
    return false;
  }
  function moveTowardAttackRange(target, requestedRange = huntState.attackRange) {
    const range = Math.max(1, Number(requestedRange) || 1);
    const occupied = new Set();
    for (const [id, entity] of entities) {
      if (String(id) === String(myself.id) || String(id) === String(target.id)
        || entity.x == null || entity.y == null || entity.k === 3 || entity.tr) continue;
      if (entity.f == null || entity.f === myself.floor) occupied.add(`${entity.x},${entity.y}`);
    }
    const walls = new Set(currentWalls.map(([x, y]) => `${x},${y}`));
    const goalIsValid = goal => goal && String(goal.targetId) === String(target.id)
      && Math.max(Math.abs(goal.x - target.x), Math.abs(goal.y - target.y)) > 0
      && Math.max(Math.abs(goal.x - target.x), Math.abs(goal.y - target.y)) <= range
      && hasAttackLine(goal.x, goal.y, target)
      && Math.abs(goal.x - myself.x) <= 20 && Math.abs(goal.y - myself.y) <= 20
      && gameWorld?.isWalkable(myself.floor, goal.x, goal.y)
      && !walls.has(`${goal.x},${goal.y}`) && !occupied.has(`${goal.x},${goal.y}`);
    if (goalIsValid(pursuitGoal)) {
      const result = mod.move(pursuitGoal.x, pursuitGoal.y);
      if (result.ok) return result;
    }
    pursuitGoal = null;
    const candidates = [];
    for (let y = target.y - range; y <= target.y + range; y++) {
      for (let x = target.x - range; x <= target.x + range; x++) {
        const distanceToTarget = Math.max(Math.abs(x - target.x), Math.abs(y - target.y));
        if (distanceToTarget < 1 || distanceToTarget > range
          || Math.abs(x - myself.x) > 20 || Math.abs(y - myself.y) > 20
          || !hasAttackLine(x, y, target)) continue;
        const key = `${x},${y}`;
        if (!gameWorld?.isWalkable(myself.floor, x, y) || walls.has(key) || occupied.has(key)) continue;
        candidates.push({ x, y, distance: Math.max(Math.abs(x - myself.x), Math.abs(y - myself.y)) });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    let lastError = "Não encontrei uma rota válida para um tile dentro do alcance.";
    for (const candidate of candidates) {
      const result = mod.move(candidate.x, candidate.y);
      if (result.ok) {
        pursuitGoal = { x: candidate.x, y: candidate.y, targetId: target.id };
        return result;
      }
      lastError = result.error ?? lastError;
    }
    return { ok: false, error: lastError };
  }
  function moveAlongWaypointInTargetRange(destination, target) {
    const range = Math.max(1, Number(huntState.attackRange) || 1);
    const blocked = new Set(currentWalls.map(([x, y]) => `${x},${y}`));
    for (const [id, entity] of entities) {
      if (String(id) === String(myself.id) || String(id) === String(target.id)
        || entity.x == null || entity.y == null || entity.k === 3 || entity.tr
        || (entity.f != null && entity.f !== myself.floor)) continue;
      blocked.add(`${entity.x},${entity.y}`);
    }
    const moving = [];
    const currentDistance = Math.max(Math.abs(myself.x - destination.x), Math.abs(myself.y - destination.y));
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = myself.x + dx, y = myself.y + dy, key = `${x},${y}`;
      if (blocked.has(key) || !gameWorld?.isWalkable(myself.floor, x, y)
        || Math.max(Math.abs(x - target.x), Math.abs(y - target.y)) > range
        || !hasAttackLine(x, y, target)) continue;
      moving.push({ x, y, distance: Math.max(Math.abs(x - destination.x), Math.abs(y - destination.y)) });
    }
    const progressing = moving.filter(step => step.distance < currentDistance);
    const options = progressing.length ? progressing : moving;
    const step = options[Math.floor(Math.random() * options.length)];
    return step
      ? mod.move(step.x, step.y)
      : { ok: false, error: "Sem tile livre dentro do alcance do alvo." };
  }
  function followWaypointRoute(label = "Waypoint", keepTargetInRange = null) {
    const lureRoute = label.startsWith("Lure");
    if (!mod.waypoints.length) {
      huntState.status = `${label}: cadastre pelo menos dois waypoints`;
      return true;
    }
    let sameFloor = mod.waypoints.map((point, index) => ({ point, index }))
      .filter(({ point }) => point.floor === myself.floor);
    if (!sameFloor.length) {
      huntState.status = `${label}: waypoints cadastrados em outro andar`;
      return true;
    }
    if (lureRoute && new Set(sameFloor.map(({ point }) => `${point.x},${point.y}`)).size < 2) {
      huntState.status = `${label}: cadastre dois waypoints distintos neste andar`;
      return true;
    }
    if (waypointLoopFloor !== myself.floor) {
      resetWaypointDirection();
      waypointLoopFloor = myself.floor;
    }
    if (Date.now() < waypointReversePauseUntil) {
      huntState.status = `${label}: aguardando ${((waypointReversePauseUntil - Date.now()) / 1000).toFixed(1)} s após inversão`;
      return true;
    }
    let order = sameFloor.findIndex(entry => entry.index === huntWaypointIndex);
    if (order < 0) order = 0;
    let current = sameFloor[order];
    huntState.currentWaypoint = {
      active: true,
      index: current.index + 1,
      total: mod.waypoints.length,
      x: current.point.x,
      y: current.point.y,
      floor: current.point.floor,
      label
    };
    const distance = Math.max(Math.abs(current.point.x - myself.x), Math.abs(current.point.y - myself.y));
    // Vary lure arrival between 1 and 2 tiles per waypoint, keeping the
    // selected distance stable while moving toward that point.
    const arrivalKey = `${current.point.floor}:${current.point.x},${current.point.y}`;
    if (lureRoute && arrivalKey !== lureArrivalWaypoint) {
      lureArrivalWaypoint = arrivalKey;
      lureArrivalTolerance = lureArrivalTolerance >= 2 ? 1 : lureArrivalTolerance + 1;
    }
    // Keep normal waypoint arrival close to the point; a 10-tile tolerance
    // made the route advance while still far away.
    const arrivalTolerance = lureRoute ? lureArrivalTolerance : 2;
    if (waypointMovePending) {
      if (waypointMovePending.floor !== myself.floor || waypointMovePending.waypointIndex !== current.index) {
        waypointMovePending = null;
      } else if (myself.x === waypointMovePending.x && myself.y === waypointMovePending.y
        || distance <= arrivalTolerance) {
        waypointMovePending = null;
        waypointNoProgressFailures = 0;
      } else if (Date.now() < waypointMovePending.deadlineAt) {
        huntState.status = `${label}: aguardando chegada ao tile (${waypointMovePending.x}, ${waypointMovePending.y})`;
        return true;
      } else {
        mod.log("warn", `${label}: o movimento para (${waypointMovePending.x}, ${waypointMovePending.y}) não chegou a tempo.`);
        waypointMovePending = null;
        waypointNoProgressFailures++;
        if (waypointNoProgressFailures >= 8) {
          mod.log("warn", `${label}: waypoint ${current.index + 1} sem progresso; pulando para o próximo ponto.`);
          setHuntWaypointIndex(sameFloor[(order + waypointDirection + sameFloor.length) % sameFloor.length].index);
          waypointNoProgressFailures = 0;
          waypointMoveFailures = 0;
          nextWaypointMoveAt = 0;
          return true;
        }
        nextWaypointMoveAt = 0;
      }
    }
    if (distance <= arrivalTolerance) {
      if (sameFloor.length > 1 && huntState.waypointReverseEnabled) {
        if (order === sameFloor.length - 1 && waypointFirstReached) waypointLastReached = true;
        if (order === 0) {
          if (waypointFirstReached && waypointLastReached) {
            waypointCompletedLoops++;
            if (waypointCompletedLoops >= huntState.waypointReverseLoops) {
              waypointDirection *= -1;
              waypointReversePauseUntil = Date.now() + huntState.waypointReverseDelay * 1000;
              waypointCompletedLoops = 0;
              mod.log("info", `${label}: sentido dos waypoints invertido.`);
            }
          }
          waypointFirstReached = true;
          waypointLastReached = false;
        }
      }
      order = (order + waypointDirection + sameFloor.length) % sameFloor.length;
      setHuntWaypointIndex(sameFloor[order].index);
      nextWaypointMoveAt = 0;
      waypointMovePending = null;
      waypointMoveFailures = 0;
      waypointNoProgressFailures = 0;
      if (Date.now() < waypointReversePauseUntil) {
        huntState.status = `${label}: aguardando ${((waypointReversePauseUntil - Date.now()) / 1000).toFixed(1)} s após inversão`;
        return true;
      }
      if (sameFloor.length === 1) {
        huntState.status = `${label}: waypoint ${current.index + 1}/${mod.waypoints.length} alcançado`;
        return true;
      }
      // Send the next leg in this same update, without a pause or recursive
      // arrival checks (nearby waypoints must not cause an infinite loop).
      current = sameFloor[order];
      huntState.currentWaypoint = {
        active: true, index: current.index + 1, total: mod.waypoints.length,
        x: current.point.x, y: current.point.y, floor: current.point.floor, label
      };
    }
    if (Date.now() >= nextWaypointMoveAt) {
      const maxAdvance = lureRoute ? huntState.lureStepTiles : 20;
      const destination = {
        x: myself.x + Math.max(-maxAdvance, Math.min(maxAdvance, current.point.x - myself.x)),
        y: myself.y + Math.max(-maxAdvance, Math.min(maxAdvance, current.point.y - myself.y))
      };
      let outcome = keepTargetInRange
        ? moveAlongWaypointInTargetRange(destination, keepTargetInRange)
        : mod.move(destination.x, destination.y, { requireExact: true });
      let detour = false;
      if (!outcome.ok && !keepTargetInRange) {
        const candidates = [];
        for (let radius = 1; radius <= 4; radius++) {
          for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
            candidates.push({ x: destination.x + dx, y: destination.y + dy });
          }
        }
        candidates.sort((a, b) => Math.max(Math.abs(a.x - current.point.x), Math.abs(a.y - current.point.y))
          - Math.max(Math.abs(b.x - current.point.x), Math.abs(b.y - current.point.y)));
        for (const candidate of candidates) {
          outcome = mod.move(candidate.x, candidate.y, { requireExact: true });
          if (outcome.ok) { detour = true; break; }
        }
      }
      huntState.status = outcome.ok
        ? `${label}: ${detour ? "desviando de destino bloqueado; " : ""}indo para waypoint ${current.index + 1}/${mod.waypoints.length}`
        : outcome.error;
      nextWaypointMoveAt = Date.now() + (outcome.ok ? 0 : 1200);
      waypointMoveFailures = outcome.ok ? 0 : waypointMoveFailures + 1;
      if (outcome.ok && outcome.target) {
        waypointMovePending = {
          x: outcome.target.x,
          y: outcome.target.y,
          floor: myself.floor,
          waypointIndex: current.index,
          deadlineAt: Date.now() + Math.min(20000, 3000 + (outcome.steps ?? 1) * 800)
        };
      }
      if (waypointMoveFailures >= 8) {
        mod.log("warn", `${label}: waypoint ${current.index + 1} sem rota válida; pulando para o próximo ponto.`);
        setHuntWaypointIndex(sameFloor[(order + waypointDirection + sameFloor.length) % sameFloor.length].index);
        waypointMovePending = null;
        waypointMoveFailures = 0;
        waypointNoProgressFailures = 0;
      }
    }
    return true;
  }
  function activeTravelDestination() {
    if (refillTrip?.stage === 2) return refillTrip.target;
    if (fullBagTravelStage === 2 && fullBagTravelStarted && !fullBagArrivalLogged) {
      return shopDestination;
    }
    if (returnTravelStarted && savedHuntPosition) return savedHuntPosition;
    if (huntTravelArrival?.point) return huntTravelArrival.point;
    return null;
  }
  let watchedTravel = null;
  function resendTravelAfterFloorChange() {
    const destination = activeTravelDestination();
    if (!destination || !Number.isInteger(myself.floor)
      || gameSocket?.readyState !== WebSocket.OPEN) {
      watchedTravel = null;
      return;
    }
    const key = `${destination.floor}:${destination.x}:${destination.y}`;
    if (!watchedTravel || watchedTravel.key !== key) {
      watchedTravel = { key, floor: myself.floor };
      return;
    }
    if (watchedTravel.floor === myself.floor) return;
    watchedTravel.floor = myself.floor;
    gameSocket.send(JSON.stringify({
      t: "travel", id: 2, go: true,
      f: destination.floor, x: destination.x, y: destination.y
    }));
    huntState.status = `Andar mudou; retomando travel para (${destination.x}, ${destination.y}), andar ${destination.floor}`;
    mod.log("info", `O andar mudou para ${myself.floor}; travel reenviado ao ponto (${destination.x}, ${destination.y}), andar ${destination.floor}.`);
  }
  function processTravelCombat() {
    const destination = activeTravelDestination();
    if (!destination || gameSocket?.readyState !== WebSocket.OPEN
      || !Number.isInteger(myself.x) || !Number.isInteger(myself.y)) {
      pendingIdleTravelConfirm = null;
      travelCombat = null;
      travelPosition = null;
      return false;
    }
    const now = Date.now();
    const position = `${myself.floor}:${myself.x}:${myself.y}`;
    if (position !== travelPosition) {
      travelPosition = position;
      travelPositionChangedAt = now;
    }
    const destinationKey = `${destination.floor}:${destination.x}:${destination.y}`;
    if (pendingIdleTravelConfirm) {
      if (pendingIdleTravelConfirm.key !== destinationKey) {
        pendingIdleTravelConfirm = null;
      } else if (now < pendingIdleTravelConfirm.sendAt) {
        return true;
      } else {
        gameSocket.send(JSON.stringify({ t: "travel", id: 2, go: true,
          f: destination.floor, x: destination.x, y: destination.y }));
        pendingIdleTravelConfirm = null;
        travelPositionChangedAt = now;
        huntState.status = `Travel retomado para (${destination.x}, ${destination.y}), andar ${destination.floor}`;
        mod.log("info", `Travel retomado após pausa; enviado true para (${destination.x}, ${destination.y}), andar ${destination.floor}.`);
        return true;
      }
    }
    if (travelCombat) {
      const target = entities.get(travelCombat.id);
      if (target?.k === 1 && target.hp !== 0 && (target.f == null || target.f === myself.floor)) {
        ensureHuntTarget({ id: target.id });
        const distance = Math.max(Math.abs(target.x - myself.x), Math.abs(target.y - myself.y));
        const attackRange = Math.max(1, Number(huntState.attackRange) || 1);
        if ((distance > attackRange || !hasAttackLine(myself.x, myself.y, target))
          && now >= nextTravelCombatMoveAt) {
          const outcome = moveTowardAttackRange(target);
          nextTravelCombatMoveAt = now + (outcome.ok ? 900 : 1200);
          huntState.status = outcome.ok
            ? `Aproximando para eliminar ${target.n ?? "criatura"} e retomar o travel`
            : `Travel bloqueado por ${target.n ?? "criatura"}: ${outcome.error}`;
        } else {
          huntState.status = `Eliminando ${target.n ?? "criatura"} para retomar o travel`;
        }
        return true;
      }
      travelCombat = null;
      huntTargetId = null;
      huntTargetSent = null;
      pursuitGoal = null;
      gameSocket.send(JSON.stringify({ t: "untarget" }));
      gameSocket.send(JSON.stringify({ t: "travel", id: 2, go: true, f: destination.floor, x: destination.x, y: destination.y }));
      travelPositionChangedAt = now;
      huntState.status = "Área livre; retomando a viagem";
      mod.log("info", `Criatura derrotada; retomando viagem para (${destination.x}, ${destination.y}), andar ${destination.floor}.`);
      return true;
    }
    if (now - travelPositionChangedAt < 1600) return false;
    const range = Math.max(1, Number(huntState.attackRange) || 1);
    const scanRadius = Math.max(10, range);
    const creature = [...entities.values()]
      .filter(entity => entity.k === 1 && Number.isInteger(entity.x) && Number.isInteger(entity.y)
        && (entity.f == null || entity.f === myself.floor)
        && !(Number.isFinite(entity.hp) && entity.hp <= 0)
        && !isAttackedByAnotherPlayer(entity)
        && Math.max(Math.abs(entity.x - myself.x), Math.abs(entity.y - myself.y)) <= scanRadius)
      .sort((a, b) => Math.max(Math.abs(a.x - myself.x), Math.abs(a.y - myself.y))
        - Math.max(Math.abs(b.x - myself.x), Math.abs(b.y - myself.y)))[0];
    if (!creature) {
      gameSocket.send(JSON.stringify({ t: "travel", id: 1, go: false,
        f: destination.floor, x: destination.x, y: destination.y }));
      pendingIdleTravelConfirm = { key: destinationKey, sendAt: now + 2000 };
      travelPositionChangedAt = now;
      huntState.status = `Reiniciando travel para (${destination.x}, ${destination.y}), andar ${destination.floor}`;
      mod.log("info", `Personagem parado por 1,6 s; enviado false e agendado true para o destino (${destination.x}, ${destination.y}), andar ${destination.floor}.`);
      return true;
    }
    gameSocket.send(JSON.stringify({ t: "travel", cancel: true }));
    const result = mod.targetCreature(creature.id);
    if (!result.ok) return false;
    travelCombat = { id: creature.id };
    huntTargetId = creature.id;
    huntTargetSent = creature.id;
    nextTravelCombatMoveAt = 0;
    huntState.status = `Eliminando ${creature.n ?? "criatura"} para desbloquear o travel`;
    mod.log("info", `Travel bloqueado; combatendo criatura próxima (${creature.n ?? creature.ty ?? creature.id}) antes de retomar a viagem.`);
    return true;
  }
  function syncHudStatusPanel() {
    const hud = document.querySelector(".hud");
    const playerCard = hud?.querySelector(".cartao");
    if (!hud || !playerCard) return;
    let panel = hud.querySelector("[data-fantasy-mod-status]");
    if (panel?.parentElement?.classList.contains("info")) {
      panel.remove();
      panel = null;
    }
    if (!panel) {
      panel = document.createElement("section");
      panel.dataset.fantasyModStatus = "true";
      Object.assign(panel.style, {
        position: "fixed", zIndex: "2147483646", boxSizing: "border-box",
        display: "grid", gap: "4px", padding: "6px 8px", color: "#efe4cc",
        background: "rgba(42, 35, 28, 0.82)", border: "2px solid #0d0a07",
        boxShadow: "inset 2px 2px 0 #574735, inset -2px -2px 0 #17120d",
        fontFamily: '"Pixelify Num", "Pixelify Sans", monospace',
        fontSize: "12px", lineHeight: "1.2", textShadow: "1px 1px #000",
        pointerEvents: "none"
      });
      const title = document.createElement("strong");
      title.textContent = "STATUS";
      title.style.color = "#f2c14e";
      title.style.fontSize = "11px";
      const position = document.createElement("span");
      const waypoint = document.createElement("span");
      const gold = document.createElement("span");
      const loops = document.createElement("span");
      const idleCountdown = document.createElement("span");
      panel.append(title, position, waypoint, gold, loops, idleCountdown);
      hud.append(panel);
    }
    const playerRect = playerCard.getBoundingClientRect();
    const timers = hud.querySelector(".temporizadores");
    const timersBottom = timers?.getClientRects().length ? timers.getBoundingClientRect().bottom : playerRect.bottom;
    const left = `${playerRect.left}px`;
    const top = `${Math.max(playerRect.bottom, timersBottom) + 5}px`;
    const width = `${playerRect.width}px`;
    if (panel.style.left !== left) panel.style.left = left;
    if (panel.style.top !== top) panel.style.top = top;
    if (panel.style.width !== width) panel.style.width = width;
    while (panel.children.length < 6) panel.append(document.createElement("span"));
    const [, positionLine, waypointLine, goldLine, loopsLine, idleLine] = panel.children;
    const positionText = Number.isInteger(myself.x) && Number.isInteger(myself.y)
      ? `Posição: (${myself.x}, ${myself.y}) · andar ${myself.floor ?? "?"}`
      : "Posição: aguardando dados";
    const waypoint = huntState.currentWaypoint;
    const waypointText = waypoint?.active
      ? `Indo para waypoint ${waypoint.index}/${waypoint.total}: (${waypoint.x}, ${waypoint.y}) · andar ${waypoint.floor}`
      : "Waypoint: parado";
    if (positionLine.textContent !== positionText) positionLine.textContent = positionText;
    if (waypointLine.textContent !== waypointText) waypointLine.textContent = waypointText;
    const goldText = myself.gold != null && Number.isFinite(Number(myself.gold))
      ? `Ouro: ${Number(myself.gold).toLocaleString("pt-BR")}` : "Ouro: aguardando dados";
    if (goldLine.textContent !== goldText) goldLine.textContent = goldText;
    loopsLine.hidden = !huntState.waypointReverseEnabled;
    const loopsText = `Voltas: ${waypointCompletedLoops}/${huntState.waypointReverseLoops}`;
    if (loopsLine.textContent !== loopsText) loopsLine.textContent = loopsText;
    const idleSeconds = huntState.trainingIdleRemainingSeconds;
    idleLine.hidden = !huntState.enabled || !huntState.training || !Number.isFinite(idleSeconds);
    if (!idleLine.hidden) {
      const idleText = `Aproximação: ${Math.floor(idleSeconds / 60)}:${String(idleSeconds % 60).padStart(2, "0")}`;
      if (idleLine.textContent !== idleText) idleLine.textContent = idleText;
    }
  }
  setInterval(syncHudStatusPanel, 250);

  function beginDeathRecovery() {
    if (deathRecovery?.origin === "refill" && myself.dead) deathRecovery = null;
    if (deathRecovery || !(huntState.enabled || huntState.lureEnabled || resumeHuntAfterReturn)) return;
    const destination = savedHuntPosition ?? (huntState.training && Number.isInteger(myself.x) && Number.isInteger(myself.y) && Number.isInteger(myself.floor)
      ? { x: myself.x, y: myself.y, floor: myself.floor } : null) ?? firstHuntWaypoint() ?? (
      Number.isInteger(myself.x) && Number.isInteger(myself.y) && Number.isInteger(myself.floor)
        ? { x: myself.x, y: myself.y, floor: myself.floor } : null);
    if (!destination) {
      mod.stopHunt("Morte detectada, mas não há posição conhecida para retornar à caça.");
      huntState.status = "Morte detectada; posição de retorno indisponível";
      return;
    }
    const lure = huntState.lureEnabled || resumeLureAfterReturn;
    mod.stopHunt("Morte detectada; iniciando recuperação.", true);
    savedHuntPosition = { ...destination };
    huntState.returnPosition = { ...destination };
    resumeHuntAfterReturn = true;
    resumeLureAfterReturn = !!lure;
    fullBagTravelPending = fullBagTravelStarted = returnTravelPending = returnTravelStarted = false;
    fullBagTravelStage = returnTravelStage = 0;
    refillTrip = null;
    refillPurchaseQueue = [];
    refillReturnTo = null;
    activeSellShop = null;
    if (shopFinishTimer) clearTimeout(shopFinishTimer);
    shopFinishTimer = 0;
    shopVisitFinishing = false;
    arrowsDepletionReturn = false;
    trainingCityTrip = false;
    huntState.autoSellInProgress = window.__fantasyAutoSellInProgress = false;
    deathRecovery = { stage: "respawn", nextAt: Date.now() + 3500, socket: gameSocket };
    huntState.status = "Morte detectada; aguardando renascimento";
  }

  function switchServerEnabled() {
    try { return localStorage.getItem("fantasy-mod-auto-switch-server") !== "false"; } catch { return true; }
  }

  function finishServerSwitch(recovery, message) {
    deathRecovery = null;
    if (recovery.origin !== "refill" || recovery.returnTo) {
      returnTravelPending = true;
      returnTravelStage = 0;
    }
    huntState.status = message;
    mod.log("info", message);
  }

  async function chooseDeathRecoveryChannel(recovery) {
    try {
      const response = await fetch("/api/canais", { cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (deathRecovery !== recovery || recovery.stage !== "fetching") return;
      const channels = Array.isArray(data.canais) ? data.canais : [];
      const pathId = Number(new URL(recovery.socket.url).pathname.match(/\/ws\/(\d+)\/?$/)?.[1]);
      let storedId = 0;
      try { storedId = Number(localStorage.getItem("fantasy.canal")); } catch {}
      const currentId = pathId || storedId || Number(data.atual);
      const allowed = channels.filter(channel => ["na", "sa"].includes(channel.region)
        && Number.isFinite(Number(channel.id))).sort((a, b) => Number(a.id) - Number(b.id));
      if (!currentId) throw new Error("canal atual desconhecido");
      const currentIndex = allowed.findIndex(channel => Number(channel.id) === currentId);
      const next = currentIndex < 0 ? allowed[0] : allowed[(currentIndex + 1) % allowed.length];
      if (!next || Number(next.id) === currentId) throw new Error("nenhum outro canal disponível nas Américas");
      if (gameSocket !== recovery.socket || gameSocket?.readyState !== WebSocket.OPEN) throw new Error("conexão do jogo indisponível");
      recovery.channelId = next.id;
      recovery.stage = "channelReply";
      recovery.nextAt = Date.now() + 15000;
      gameSocket.send(JSON.stringify({ t: "canal", id: next.id }));
      huntState.status = `Trocando para ${next.name ?? `canal ${next.id}`}`;
      mod.log("info", huntState.status);
    } catch (error) {
      if (deathRecovery !== recovery) return;
      recovery.stage = "chooseChannel";
      recovery.nextAt = Date.now() + 10000;
      huntState.status = `Aguardando troca de servidor: ${error.message}`;
      mod.log("warn", huntState.status);
    }
  }

  function processDeathRecovery() {
    const recovery = deathRecovery;
    if (!recovery) return false;
    const now = Date.now();
    if (recovery.stage === "respawn" && !myself.dead) {
      recovery.stage = "chooseChannel";
      recovery.nextAt = now;
    }
    if (!switchServerEnabled() && (recovery.stage === "chooseChannel" || recovery.stage === "fetching")) {
      finishServerSwitch(recovery, recovery.origin === "refill" ? "Refill concluído; troca de servidor desativada" : "Renascido; preparando retorno à caça");
      return true;
    }
    if (recovery.stage === "respawn" && now >= recovery.nextAt && gameSocket?.readyState === WebSocket.OPEN) {
      try {
        gameSocket.send(JSON.stringify({ t: "respawn" }));
        recovery.nextAt = now + 5000;
        huntState.status = "Aguardando confirmação do renascimento";
      } catch (error) { recovery.nextAt = now + 5000; mod.log("warn", `Falha ao renascer: ${error.message}`); }
    }
    if (recovery.stage === "chooseChannel" && now >= recovery.nextAt) {
      if (!recovery.socket || recovery.socket.readyState !== WebSocket.OPEN) {
        if (gameSocket?.readyState !== WebSocket.OPEN) return true;
        recovery.socket = gameSocket;
      }
      recovery.stage = "fetching";
      chooseDeathRecoveryChannel(recovery);
    }
    if (recovery.stage === "channelReply" && now >= recovery.nextAt) {
      recovery.stage = "chooseChannel";
      recovery.nextAt = now + 5000;
      huntState.status = "Troca de servidor sem resposta; tentando novamente";
    }
    return true;
  }

  function handleDeathRecoveryPacket(socket, packet) {
    const recovery = deathRecovery;
    if (!recovery) return;
    if (socket === recovery.socket && packet.t === "canal" && recovery.stage === "channelReply") {
      if (packet.ok && String(packet.id) === String(recovery.channelId)) {
        recovery.stage = "reconnect";
        huntState.status = "Servidor alterado; aguardando reconexão";
      } else {
        recovery.stage = "chooseChannel";
        recovery.nextAt = Date.now() + 10000;
        huntState.status = `Troca de servidor recusada: ${packet.reason ?? packet.key ?? "tente novamente"}`;
        mod.log("warn", huntState.status);
      }
    }
    if (recovery.stage === "reconnect" && socket !== recovery.socket && socket === gameSocket
        && packet.t === "snap" && !myself.dead && (packet.you || packet.yd)) {
      finishServerSwitch(recovery, recovery.origin === "refill" && !recovery.returnTo
        ? "Refill concluído; servidor alterado" : "Reconectado; preparando retorno à caça");
    }
  }

  let nextLootCatalogUpdateAt = 0;
  setInterval(() => {
    huntState.trainingIdleRemainingSeconds = null;
    if (confirmation.state.active) {
      huntState.status = confirmation.state.status;
      return;
    }
    logHuntProgress();
    if (Date.now() >= nextLootCatalogUpdateAt) {
      nextLootCatalogUpdateAt = Date.now() + 2000;
      mod.updateLootCatalog();
    }
    if (myself.dead) beginDeathRecovery();
    if (processDeathRecovery() || myself.dead) return;
    resendTravelAfterFloorChange();
    if (processTravelCombat()) return;
    if (processShopAutoSell()) return;
    if (processRefillTrip()) return;
    if (processRefillPurchases()) return;
    if (handleReturnTravel()) return;
    if (handleFullInventory()) return;
    if (processInitialHuntTravel()) return;
    if (!huntState.enabled && !huntState.lureEnabled && !focusState.enabled) {
      huntState.lootStatus = huntState.autoLoot ? "Ativo quando a caça iniciar" : "Desativado";
      return;
    }
    if (!Number.isInteger(myself.x) || !Number.isInteger(myself.y) || !Number.isInteger(myself.floor)) {
      if (focusState.enabled) focusState.status = "Focar aguardando posição do personagem";
      else huntState.status = "Aguardando posição do personagem";
      huntState.lootStatus = huntState.autoLoot ? "Aguardando posição do personagem" : "Desativado";
      return;
    }
    if (focusState.enabled) {
      processFocusTarget();
      return;
    }
    if (processTrainingIdleMovement()) return;
    const wanted = huntState.names.map(normalizeName);
    const wantedTypes = (huntState.names.length
      ? (huntState.types ?? [])
      : Object.keys(mod.targets ?? {}).filter(type => mod.targets[type])).map(String);
    if (!huntState.names.length && wantedTypes.length) {
      for (const entry of monsterCatalog) {
        if (!wantedTypes.includes(String(entry.type))) continue;
        const rawName = monsterData.get(entry.type)?.name;
        const sourceNames = [entry.name, ...(typeof rawName === "string"
          ? [rawName]
          : Object.values(rawName ?? {}).filter(value => typeof value === "string"))];
        for (const name of sourceNames) {
          wanted.push(normalizeName(name));
          for (const translation of Object.values(translatedMonsterNames[name] ?? {})) {
            wanted.push(normalizeName(translation));
          }
        }
      }
    }
    const matchesTarget = creature => {
      if (huntState.attackAny) return true;
      const sourceNames = [creature.name, ...creature.aliases];
      const candidates = [
        ...sourceNames,
        ...sourceNames.flatMap(name => Object.values(translatedMonsterNames[name] ?? {})),
        creature.type
      ].map(normalizeName);
      return wantedTypes.includes(String(creature.type)) || wanted.some(query => candidates.some(name => name.includes(query)));
    };
    const logHuntSkip = (creature, reason) => {
      const key = `${creature.id}:${reason}`;
      const now = Date.now();
      if (now - (huntSkipLogAt.get(key) ?? 0) < 10000) return;
      huntSkipLogAt.set(key, now);
      if (huntSkipLogAt.size > 200) {
        for (const [entry, at] of huntSkipLogAt) if (now - at > 60000) huntSkipLogAt.delete(entry);
      }
      mod.log("warn", `${creature.name} ignorada: ${reason} (tipo ${creature.type ?? "?"}).`);
    };
    const canHunt = creature => {
      if (isAttackedByAnotherPlayer(creature)) {
        logHuntSkip(creature, "há registro recente de ataque de outro jogador");
        return false;
      }
      if (isIgnoredAtBlockedPosition(creature)) {
        logHuntSkip(creature, "posição marcada como sem rota válida");
        return false;
      }
      return matchesTarget(creature);
    };
    if (huntState.lureEnabled) {
      const visible = creaturesWithinPathRadius(huntState.radius);
      const canAttackFromHere = creature => creature.distance <= huntState.attackRange
        && hasAttackLine(myself.x, myself.y, creature);
      const inAttackRange = visible.filter(creature =>
        canHunt(creature)
          && canAttackFromHere(creature));
      lurePulledIds.clear();
      for (const creature of inAttackRange) lurePulledIds.add(String(creature.id));
      const pulledCount = lurePulledIds.size;
      const lureCount = Math.max(1, Number(huntState.lureCount) || 5);
      huntState.lureProgress = { current: pulledCount, target: lureCount };
      let lureTarget = huntTargetId == null
        ? null
        : visible.find(creature => String(creature.id) === String(huntTargetId)
          && canAttackFromHere(creature)
          && canHunt(creature));
      if (!lureTarget && huntTargetId != null) {
        huntTargetId = null;
        huntTargetSent = null;
        nextHuntMoveAt = 0;
      }
      // Lure movement follows the waypoint route; pursuing a mob here makes
      // the player bounce between the mob and the route when line of sight changes.
      const nextLureTarget = visible
        .find(creature => canHunt(creature) && canAttackFromHere(creature));
      if (!lureTarget) {
        lureTarget = nextLureTarget;
      }
      if (lureTarget) {
        if (String(huntTargetId) !== String(lureTarget.id)) {
          huntTargetId = lureTarget.id;
          huntTargetSent = null;
          nextHuntMoveAt = 0;
        }
        ensureHuntTarget(lureTarget);
      }
      if (processAutoLoot(lureTarget)) return;
      const lureProgress = pulledCount >= lureCount
        ? `Lure ${pulledCount}/${lureCount}: puxando e atacando`
        : `Lure ${pulledCount}/${lureCount}`;
      const lureCanAttack = lureTarget && canAttackFromHere(lureTarget);
      followWaypointRoute(lureProgress, lureCanAttack ? lureTarget : null);
      if (lureCanAttack) {
        huntState.status = `${huntState.status.replace(/(?: · atacando .*)+$/, "")} · atacando ${lureTarget.name}`;
        if (huntState.useSpecial && (pulledCount >= lureCount || isEliteCreature(lureTarget))) {
          const outcome = mod.useHuntSpecial();
          if (!outcome.ok && !/cooldown/i.test(outcome.error ?? "")) huntState.status += ` · ${outcome.error}`;
        }
      }
      return;
    }
    const visibleCreatures = mod.creaturesNearby(100);
    if (huntState.training && (huntState.trainingEliteEnabled || huntState.trainingExhaustedEnabled)) {
      for (const [id, until] of trainingEliteAttackers) if (until <= Date.now()) trainingEliteAttackers.delete(id);
      if (trainingElite && !visibleCreatures.some(creature => String(creature.id) === String(trainingElite.id))) {
        const remainingAttackers = new Map(trainingEliteAttackers);
        remainingAttackers.delete(String(trainingElite.id));
        finishTrainingElite();
        for (const [id, until] of remainingAttackers) trainingEliteAttackers.set(id, until);
        huntTargetId = null;
        huntTargetSent = null;
      }
      if (!trainingElite) {
        const elite = huntState.trainingEliteEnabled && visibleCreatures.find(creature => trainingEliteAttackers.has(String(creature.id)) && isEliteCreature(creature));
        const exhausted = huntState.trainingExhaustedEnabled && visibleCreatures.find(creature => String(creature.id) === String(exhaustedTargetId));
        const combatTarget = elite || exhausted;
        const previousClass = playerStats.cls ?? playerStats.cl ?? myself.cls;
        if (combatTarget && Number.isInteger(previousClass)) {
          trainingElite = { id: combatTarget.id, previousClass, sentAt: 0, kind: elite ? "elite" : "exhausted" };
          exhaustedTargetId = null;
          huntTargetId = combatTarget.id;
          huntTargetSent = null;
          nextHuntMoveAt = 0;
          pursuitGoal = null;
        }
      }
      if (trainingElite && Date.now() - trainingElite.sentAt >= 1200) {
        const desired = classIds[trainingElite.kind === "exhausted" ? huntState.trainingExhaustedClass : huntState.trainingEliteClass];
        if ((playerStats.cls ?? playerStats.cl ?? myself.cls) !== desired && sendTrainingClass(desired)) trainingElite.sentAt = Date.now();
      }
    } else if (trainingElite) finishTrainingElite();
    const activeClass = trainingElite ? (trainingElite.kind === "exhausted" ? huntState.trainingExhaustedClass : huntState.trainingEliteClass) : huntState.trainingClass;
    const attackRange = huntState.training ? (activeClass === "melee" ? 1 : 4) : huntState.attackRange;
    let target = huntTargetId == null
      ? null
      : mod.creaturesNearby(1000).find(creature => String(creature.id) === String(huntTargetId)
        && (trainingElite && String(creature.id) === String(trainingElite.id) || canHunt(creature)));
    if (!target && huntTargetId != null) {
      if (huntState.training) {
        const delay = huntState.trainingTargetDelayMin + Math.random() * (huntState.trainingTargetDelayMax - huntState.trainingTargetDelayMin);
        nextTrainingTargetAt = Date.now() + delay * 1000;
        if (gameSocket?.readyState === WebSocket.OPEN) gameSocket.send(JSON.stringify({ t: "untarget" }));
      }
      huntTargetId = null;
      huntTargetSent = null;
      nextHuntMoveAt = 0;
    }
    // Keep the current target unless a valid creature is strictly closer.
    const nextTarget = creaturesWithinPathRadius(huntState.radius).find(canHunt);
    if (!target) {
      target = nextTarget;
    }
    const trainingCreatureNearby = huntState.training && !!target;
    if (trainingCreatureNearby && waypointMovePending) {
      // Cancel the route already sent to the game, not just future waypoint steps.
      const predicted = window.gameDebug?.state?.().pred;
      const position = predicted && Number.isInteger(predicted.x) && Number.isInteger(predicted.y) ? predicted : myself;
      if (typeof window.gameDebug?.send === "function") window.gameDebug.send({ t: "walk", x: position.x, y: position.y });
      else if (gameSocket?.readyState === WebSocket.OPEN) gameSocket.send(JSON.stringify({ t: "walk", x: position.x, y: position.y }));
      waypointMovePending = null;
      nextWaypointMoveAt = 0;
    }
    if (trainingCreatureNearby && huntTargetId == null && Date.now() < nextTrainingTargetAt) {
      huntState.status = `Treino: aguardando ${((nextTrainingTargetAt - Date.now()) / 1000).toFixed(1)} s para o próximo alvo`;
      return;
    }
    if (!target) huntLootId = null;
    if (!trainingCreatureNearby && processAutoLoot(target)) return;
    if (!target) {
      huntTargetId = null;
      huntTargetSent = null;
      if (huntState.training) {
        if (huntState.trainingWaypoints && !trainingCreatureNearby) {
          followWaypointRoute("Treino · waypoints");
          return;
        }
        huntState.status = `Treino: procurando alvos em até ${huntState.radius} tiles`;
        return;
      }
      if (huntState.waypointsEnabled) {
        followWaypointRoute("Waypoints");
        return;
      }
      huntState.status = huntState.names.length
        ? `Procurando: ${huntState.names.join(", ")}`
        : huntState.attackAny ? "Procurando qualquer criatura"
          : `Procurando ${wantedTypes.length} alvo(s) ativado(s)`;
      return;
    }
    if (String(huntTargetId) !== String(target.id)) {
      huntTargetId = target.id;
      huntTargetSent = null;
      nextHuntMoveAt = 0;
      pursuitGoal = null;
    }
    ensureHuntTarget(target);
    if (target.distance <= attackRange && hasAttackLine(myself.x, myself.y, target)) {
      huntState.status = `${trainingElite?.kind === "exhausted" ? "Exausto: atacando" : trainingElite ? "Elite: atacando" : "Atacando"} ${target.name}`;
      if (trainingElite?.kind === "elite" && Number(playerStats.cls ?? playerStats.cl) === classIds[huntState.trainingEliteClass]) {
        const outcome = mod.useHuntSpecial();
        if (!outcome.ok && !/cooldown/i.test(outcome.error ?? "")) huntState.status += ` · ${outcome.error}`;
      }
      return;
    }
    if (Date.now() < nextHuntMoveAt) {
      huntState.status = `Perseguindo ${target.name} · ${target.distance}/${attackRange} tiles`;
      return;
    }
    const outcome = moveTowardAttackRange(target, attackRange);
    if (!outcome.ok) ignoreMobAtCurrentPosition(target, outcome.error);
    huntState.status = outcome.ok
      ? `Perseguindo ${target.name} · ${target.distance}/${attackRange} tiles`
      : outcome.error;
    nextHuntMoveAt = Date.now() + (outcome.ok ? 900 : 700);
  }, 300);

  function updateMyself(message) {
    if (!message || typeof message !== "object") return;

    if (message.t === "auth" && message.ok !== false) {
      if (message.id != null) playerId = message.id;
      if (typeof message.name === "string") myself.nick = message.name;
    }

    if (message.t !== "snap") return;
    creaturePathDistanceCache.clear();
    currentWalls = Array.isArray(message.walls) ? message.walls : [];
    if (message.full) playerStats = {};
    if (message.you && typeof message.you === "object") playerStats = { ...playerStats, ...message.you };
    else if (message.yd && typeof message.yd === "object") playerStats = { ...playerStats, ...message.yd };

    if (message.full) entities.clear();
    for (const id of message.gone ?? []) entities.delete(id);
    for (const entity of message.ents ?? []) {
      if (entity?.id == null) continue;
      if (!entity.p) entities.set(entity.id, { ...entity });
      else {
        const merged = { ...(entities.get(entity.id) ?? {}) };
        for (const key of ["x", "y", "d", "a", "hp", "fx", "fy", "sd", "at", "st"]) delete merged[key];
        for (const [key, value] of Object.entries(entity)) if (key !== "p") merged[key] = value;
        entities.set(entity.id, merged);
      }
    }
    // Snapshot attack events are [from, to, fx, amount, class] or expanded
    // objects. Only mark monster targets when the attacker is another player.
    const now = Date.now();
    for (const [id, until] of otherPlayerAttackUntil) {
      if (until <= now) otherPlayerAttackUntil.delete(id);
    }
    for (const event of message.ev ?? []) {
      const from = Array.isArray(event) ? event[0] : event?.from;
      const to = Array.isArray(event) ? event[1] : event?.to;
      if (huntState.enabled && huntState.training && huntState.trainingEliteEnabled && from != null && to != null
        && String(to) === String(entityIdForAttack(message))) {
        const attacker = [...entities].find(([id]) => String(id) === String(from))?.[1];
        if (attacker?.k === 1 && isEliteCreature({ id: from, type: attacker.ty })) trainingEliteAttackers.set(String(from), now + 10000);
      }
      if (from == null || to == null || String(from) === String(entityIdForAttack(message))) continue;
      const attacker = [...entities].find(([id]) => String(id) === String(from))?.[1];
      const victim = [...entities].find(([id]) => String(id) === String(to))?.[1];
      if (attacker?.k === 0 && victim?.k === 1) otherPlayerAttackUntil.set(String(to), now + 5000);
    }
    for (const [id, blocked] of blockedMobPositions) {
      const entity = [...entities].find(([entityId]) => String(entityId) === id)?.[1];
      if (!entity || entity.x !== blocked.x || entity.y !== blocked.y) blockedMobPositions.delete(id);
    }
    const entityId = playerStats.id ?? playerId;
    playerEntity = [...entities].find(([id]) => String(id) === String(entityId))?.[1] ?? {};

    const hp = playerStats.hp ?? myself.hp ?? null;
    const mp = playerStats.mp ?? myself.mp ?? null;
    const position = playerStats.pos ?? playerEntity.pos;
    const posX = Array.isArray(position) ? position[0] : position?.x;
    const posY = Array.isArray(position) ? position[1] : position?.y;
    const posFloor = Array.isArray(position) ? position[2] : position?.f ?? position?.floor;
    const x = playerEntity.x ?? playerStats.x ?? posX ?? null;
    const y = playerEntity.y ?? playerStats.y ?? posY ?? null;
    const floor = playerStats.f ?? playerEntity.f ?? posFloor ?? null;
    Object.assign(myself, {
      id: entityId,
      nick: myself.nick ?? playerStats.name ?? null,
      x,
      y,
      floor,
      f: floor,
      coordinates: { x, y, floor },
      hp,
      maxHp: playerStats.maxHp ?? myself.maxHp ?? null,
      mp,
      maxMp: playerStats.maxMp ?? myself.maxMp ?? null,
      potions: playerStats.potions ?? myself.potions ?? {},
      bestPotion: playerStats.bestPotion ?? myself.bestPotion ?? {},
      arrows: playerStats.arrows ?? myself.arrows ?? null,
      gold: playerStats.gold ?? myself.gold ?? null,
      arrowItemId: 3,
      potionCounts: { hp: potionStatus("hp"), mp: potionStatus("mp") },
      vida: hp,
      health: hp,
      mana: mp,
      level: playerStats.level ?? myself.level ?? null,
      cls: playerStats.cls ?? playerStats.cl ?? myself.cls ?? null,
      specialReady: playerStats.specialReady ?? myself.specialReady ?? null,
      autoSpecial: playerStats.autoSpecial ?? myself.autoSpecial ?? false,
      xp: playerStats.xp ?? myself.xp ?? null,
      dead: playerStats.dead ?? myself.dead ?? false,
      target: Object.hasOwn(playerStats, "target") ? playerStats.target : myself.target ?? null,
      updatedAt: Date.now()
    });
    recordWaypointPosition();
    const playerDied = (message.ev ?? []).some(event => !Array.isArray(event)
      && event?.type === "playerdeath" && entityId != null && String(event.id) === String(entityId));
    if (playerDied) {
      myself.dead = true;
      playerStats.dead = true;
    }
    if (myself.dead) beginDeathRecovery();
    if (returnTravelStarted && savedHuntPosition
      && myself.floor === savedHuntPosition.floor
      && myself.x === savedHuntPosition.x && myself.y === savedHuntPosition.y) {
      returnTravelStarted = false;
      huntTargetId = null;
      huntTargetSent = null;
      pursuitGoal = null;
      nextHuntMoveAt = 0;
      if (resumeHuntAfterReturn) {
        huntState.enabled = true;
        huntState.lureEnabled = resumeLureAfterReturn;
        if (resumeLureAfterReturn) {
          try { localStorage.setItem("fantasy-mod-lure-enabled", "true"); } catch {}
        }
        huntState.status = resumeLureAfterReturn
          ? "Retornou à posição salva; Lure retomado"
          : "Retornou à posição salva; caça retomada";
      } else {
        huntState.status = `Retornou para a posição salva: ${myself.x}, ${myself.y}, andar ${myself.floor}`;
      }
      resumeHuntAfterReturn = false;
      resumeLureAfterReturn = false;
      arrowsDepletionReturn = false;
      trainingCityTrip = false;
      suppressShopReopenUntilReturn = false;
      suppressShopDisplay = false;
      refillReturnTo = null;
      huntState.autoSellInProgress = false;
      window.__fantasyAutoSellInProgress = false;
      shopVisitFinishing = false;
      restoreShopScreen();
      mod.log("info", huntState.status);
    }
    if (fullBagTravelStage === 2 && !fullBagArrivalLogged
      && myself.floor === shopDestination.floor && myself.x === shopDestination.x && myself.y === shopDestination.y) {
      fullBagArrivalLogged = true;
      huntState.status = "Cheguei na loja.";
      huntState.lootStatus = "Cheguei na loja.";
      mod.log("info", `Cheguei na loja: posição (${shopDestination.x}, ${shopDestination.y}), andar ${shopDestination.floor}.`);
    }
    if (fullBagTravelStage === 2 && fullBagArrivalLogged && myself.floor === 0
      && myself.x === shopDestination.x && myself.y === shopDestination.y) {
      const nearbyNpcs = [...entities.values()]
        .filter(entity => entity.k === 2 && Number.isInteger(entity.x) && Number.isInteger(entity.y)
          && (entity.f == null || entity.f === 0))
        .map(entity => {
          const rawName = entity.n;
          const name = typeof rawName === "string"
            ? rawName
            : rawName?.pt ?? rawName?.en ?? rawName?.es ?? `NPC ${entity.id}`;
          return {
            id: entity.id,
            name,
            distance: Math.max(Math.abs(entity.x - myself.x), Math.abs(entity.y - myself.y))
          };
        })
        .filter(npc => npc.distance <= 2)
        .sort((a, b) => a.distance - b.distance);
      if (nearbyNpcs.length && !fullBagNpcNamesLogged) {
        fullBagNpcNamesLogged = true;
        mod.log("info", `NPCs em até 2 tiles: ${nearbyNpcs.map(npc => `${npc.name} (${npc.distance})`).join(", ")}`);
      } else if (!nearbyNpcs.length && !fullBagNpcSearchEmptyLogged) {
        fullBagNpcSearchEmptyLogged = true;
        mod.log("info", "Nenhum NPC encontrado em até 2 tiles da loja; continuarei procurando.");
      }
      const gearMerchant = nearbyNpcs.find(npc => normalizeName(npc.name).trim() === "gear merchant");
      if ((huntState.autoSell || trainingCityTrip) && gearMerchant && !fullBagNpcInteractionSent && gameSocket?.readyState === WebSocket.OPEN) {
        gearMerchantNpcId = gearMerchant.id;
        huntState.autoSellInProgress = true;
        window.__fantasyAutoSellInProgress = true;
        gameSocket.send(JSON.stringify({ t: "talk", id: gearMerchant.id }));
        fullBagNpcInteractionSent = true;
        mod.log("info", `Interagindo com Gear Merchant (${gearMerchant.distance} tile${gearMerchant.distance === 1 ? "" : "s"}).`);
      }
    }
  }

  function entityIdForAttack(message) {
    return message?.you?.id ?? playerStats.id ?? playerId;
  }

  // Decoder for the FORMAT=1 protocol in fantasybrowser.io/shared/bin.mjs.
  const keys = ["t","tick","full","you","ents","gone","ev","walls","levers","id","p","k","x","y","d","a","hp","fx","fy","sd","at","st","n","c","o","cl","gs","gm","cr","cu","ti","lv","sk","hs","ty","rk","bs","sp","tr","it","mine","type","from","to","amount","source","victim","cls","who","text","key","params","f","maxHp","mp","maxMp","level","xp","skills","melee","distance","magic","defense","gold","potions","target","dead","arrows","weapons","bestPotion","team","invited","pvp","pvpArea","specialReady","autoSpecial","offline","stamina","colors","outfit","owned","supporter","name","follow","creator","track","trackRecent","online","on","free","paid","curse","xpBoost","skillBoost","noLogout","cursedGold","xpTotal","xpNext","speed","speedBase","bonus","chase","skillProg","second","secondReady","haste","leader","members","pos","list","lostXp","lostGold","system","skill","value","crit","item","items","kind","dy","scale","life","yd"];
  const values = ["snap","attack","damage","death","heal","special","playerdeath","floor","loot","levelup","skillup","pvpkill","cast","chat"];

  function decodeLegacyGamePacket(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const text = new TextDecoder();
    let offset = 0;
    const varint = () => {
      let value = 0, factor = 1, byte;
      do {
        if (offset >= bytes.length || factor > Number.MAX_SAFE_INTEGER) throw new Error("varint inválido");
        byte = bytes[offset++];
        value += (byte & 127) * factor;
        factor *= 128;
      } while (byte & 128);
      return value;
    };
    const string = () => {
      const length = varint();
      if (offset + length > bytes.length) throw new Error("string incompleta");
      const result = text.decode(bytes.subarray(offset, offset + length));
      offset += length;
      return result;
    };
    const value = () => {
      if (offset >= bytes.length) throw new Error("pacote incompleto");
      switch (bytes[offset++]) {
        case 0: return null;
        case 1: return false;
        case 2: return true;
        case 3: return varint();
        case 4: return -varint();
        case 5: {
          const encoded = varint();
          const scale = bytes[offset++];
          const divisors = [1, 10, 100, 1000, 10000, 100000, 1000000];
          if (scale >= divisors.length) throw new Error("escala inválida");
          return (encoded % 2 ? -(encoded + 1) / 2 : encoded / 2) / divisors[scale];
        }
        case 6: {
          if (offset + 8 > bytes.length) throw new Error("número incompleto");
          const result = view.getFloat64(offset, true);
          offset += 8;
          return result;
        }
        case 7: return string();
        case 8: {
          const id = varint();
          return values[id] ?? `?${id}`;
        }
        case 9: {
          const length = varint(), result = [];
          for (let i = 0; i < length; i++) result.push(value());
          return result;
        }
        case 10: {
          const length = varint(), result = {};
          for (let i = 0; i < length; i++) {
            const key = varint();
            result[key === 0 ? string() : keys[key - 1] ?? `?${key}`] = value();
          }
          return result;
        }
        case 11: {
          const length = varint(), result = [];
          for (let i = 0; i < length; i++) result.push(varint());
          return result;
        }
        case 12: return JSON.parse(string());
        default: throw new Error("tipo binário desconhecido");
      }
    };
    if (bytes[offset++] !== 1) throw new Error("formato binário desconhecido");
    return value();
  }

  // The v2 client receives its packet codec as a WASM module in {t:"x",b}.
  // Mirror v2/src/core.mjs so the extension uses the game’s decoder and packet signer.
  async function openGameCoreCodec(encodedModule) {
    const moduleBytes = typeof encodedModule === "string"
      ? Uint8Array.from(atob(encodedModule), char => char.charCodeAt(0))
      : encodedModule;
    const { instance } = await WebAssembly.instantiate(moduleBytes, {});
    const exports = instance.exports;
    // The game calls v() before its first signed packet to initialize this
    // connection's protocol state. Mirror that step in the extension's codec.
    exports.d();
    const strings = new Map();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const hash = json => {
      const input = encoder.encode(json);
      const ptr = exports.a(input.length);
      new Uint8Array(exports.memory.buffer, ptr, input.length).set(input);
      return exports.h(input.length) >>> 0;
    };
    return {
      decode(input) {
      const ptr = exports.a(input.length);
      new Uint8Array(exports.memory.buffer, ptr, input.length).set(input);
      const count = exports.b(input.length);
      if (count < 0) throw new Error(`core ${count}`);
      const memory = exports.memory.buffer;
      const output = new Float64Array(memory, exports.c(), count);
      let index = 0;
      const readString = () => {
        const kind = output[index++];
        if (kind === 9) return `?${output[index++]}`;
        const stringPtr = output[index++], length = output[index++];
        if (kind !== 8) return decoder.decode(new Uint8Array(memory, stringPtr, length));
        let value = strings.get(stringPtr);
        if (value === undefined) {
          value = decoder.decode(new Uint8Array(memory, stringPtr, length));
          strings.set(stringPtr, value);
        }
        return value;
      };
      const readValue = () => {
        switch (output[index]) {
          case 0: index++; return null;
          case 1: index++; return false;
          case 2: index++; return true;
          case 3: index += 2; return output[index - 1];
          case 4: case 8: case 9: return readString();
          case 5: {
            const length = output[index + 1], result = new Array(length);
            index += 2;
            for (let i = 0; i < length; i++) result[i] = readValue();
            return result;
          }
          case 6: {
            const length = output[index + 1], result = {};
            index += 2;
            for (let i = 0; i < length; i++) result[readString()] = readValue();
            return result;
          }
          case 7: {
            const ptr = output[index + 1], length = output[index + 2];
            index += 3;
            return JSON.parse(decoder.decode(new Uint8Array(memory, ptr, length)));
          }
          case 10: {
            const length = output[index + 1], result = new Array(length);
            index += 2;
            for (let i = 0; i < length; i++) result[i] = output[index++];
            return result;
          }
          default: throw new Error("core");
        }
      };
      return readValue();
      },
      encode(json) {
        const checksum = hash(json);
        return `${json.slice(0, -1)},"z":[${exports.k()},${exports.e()},${checksum}]}`;
      },
      observe(signedJson) {
        const signatureStart = signedJson.lastIndexOf(',"z":');
        if (signatureStart < 0 || !signedJson.endsWith("}")) return false;
        hash(`${signedJson.slice(0, signatureStart)}}`);
        return true;
      }
    };
  }

  function publish(name, value) {
    window.dispatchEvent(new CustomEvent(`__fantasy_ws_${name}`, {
      detail: JSON.stringify(value)
    }));
  }

  function socketState() {
    return sockets.map(({ id, socket }) => ({
      id,
      url: socket.url,
      readyState: socket.readyState,
      protocol: socket.protocol
    }));
  }

  function preview(data) {
    if (typeof data === "string") return { type: "text", text: data.slice(0, 500) };
    let bytes;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    else if (data instanceof Blob) return { type: "Blob", text: `[Blob ${data.size} bytes]` };
    else return { type: typeof data, text: String(data).slice(0, 500) };
    const head = bytes.subarray(0, 96);
    return {
      type: "binary",
      bytes: bytes.length,
      hex: [...head].map(byte => byte.toString(16).padStart(2, "0")).join(" ") + (bytes.length > head.length ? " …" : "")
    };
  }

  function finishRecord(packet, socket) {
    if (packet.direction === "RECEBIDO" && packet.decoded) {
      confirmation.receive(socket, packet.decoded);
      if (packet.decoded.t === "kick") {
        confirmation.reset(socket);
        intentionalCloses.add(socket);
        reconnectPending = false;
      }
      updateMyself(packet.decoded);
      if (huntState.enabled && huntState.training && huntState.trainingExhaustedEnabled && !trainingElite
          && huntTargetId != null && packet.decoded.t === "snap") {
        const events = packet.decoded.ev ?? [];
        const selfId = entityIdForAttack(packet.decoded);
        const hasNotice = events.some(event => event?.type === "notice" && String(event.id) === String(selfId)
          && /este monstro está exausto|this monster is exhausted|este monstruo está agotado/i.test(event.key ?? event.text ?? ""));
        const hitTarget = events.some(event => {
          const from = Array.isArray(event) ? event[0] : event?.from;
          const to = Array.isArray(event) ? event[1] : event?.to;
          return from != null && to != null && String(from) === String(selfId) && String(to) === String(huntTargetId);
        });
        if (hasNotice && hitTarget) exhaustedTargetId = huntTargetId;
      }
      updateInventory(packet.decoded);
      updateShop(packet.decoded);
      handleDeathRecoveryPacket(socket, packet.decoded);
      if (reconnectPending && socket === gameSocket && packet.decoded.t === "snap" && packet.decoded.you) {
        reconnectPending = false;
        mod.log("info", "Reconexão automática concluída.");
        const destination = activeTravelDestination();
        if (destination && !myself.dead) {
          try {
            socket.send(JSON.stringify({ t: "travel", id: 2, go: true, f: destination.floor, x: destination.x, y: destination.y }));
            mod.log("info", "Viagem retomada após a reconexão.");
          } catch (error) { mod.log("warn", `Não foi possível retomar a viagem: ${error.message}`); }
        }
      }
    }
    if (packet.decodeError) mod.log("warn", `Pacote WebSocket recebido não foi decodificado: ${packet.decodeError}`);
    packets.push(packet);
    if (packets.length > 1000) packets.splice(0, packets.length - 1000);
    publish("packet", packet);
  }

  function record(socket, direction, data) {
    let codec = socketDecoders.get(socket);
    if (!codec) {
      codec = { decoder: null, promise: null };
      socketDecoders.set(socket, codec);
    }
    const packet = {
      at: new Date().toISOString(),
      url: socket.url,
      direction,
      ...preview(data)
    };
    // Assets use the same /ws URL, but their binary chunks are a file download,
    // not snapshots. The game's assets.mjs identifies this stream with t:"k".
    if (assetSockets.has(socket) && data instanceof ArrayBuffer) {
      packet.channel = "assets";
      finishRecord(packet, socket);
      return;
    }
    if (direction === "RECEBIDO" && data instanceof ArrayBuffer) {
      try {
        const bytes = new Uint8Array(data);
        if (codec.decoder) packet.decoded = codec.decoder.decode(bytes);
        else if (codec.promise) {
          codec.promise.then(gameCodec => {
            codec.decoder = gameCodec;
            try { packet.decoded = gameCodec.decode(bytes); }
            catch (error) { packet.decodeError = error.message; }
            finishRecord(packet, socket);
          }, error => {
            packet.decodeError = `decoder WebAssembly indisponível: ${error?.message ?? error}`;
            finishRecord(packet, socket);
          });
          return;
        } else packet.decoded = decodeLegacyGamePacket(bytes);
      } catch (error) { packet.decodeError = error.message; }
    } else if (direction === "RECEBIDO" && typeof data === "string") {
      try { packet.decoded = JSON.parse(data); }
      catch {}
    }
    if (direction === "RECEBIDO" && packet.decoded?.t === "k") assetSockets.add(socket);
    if (assetSockets.has(socket)) packet.channel = "assets";
    if (direction === "RECEBIDO" && packet.decoded?.t === "x" && typeof packet.decoded.b === "string") {
      codec.decoder = null;
      codec.promise = openGameCoreCodec(packet.decoded.b).then(gameCodec => {
        codec.decoder = gameCodec;
        mod.gamePacketEncoding = "Pronto";
        return gameCodec;
      });
      codec.promise.catch(error => {
        mod.gamePacketEncoding = `Falha: ${error?.message ?? error}`;
        mod.log("error", `Não foi possível iniciar o codec WebAssembly v2: ${error?.message ?? error}`);
      });
    }
    finishRecord(packet, socket);
  }

  function updateInventory(packet) {
    if (packet?.t !== "inv" || !Array.isArray(packet.bag)) return;
    const capacity = Number(packet.bagSize);
    if (!Number.isInteger(capacity) || capacity < 1) {
      mod.inventory = { known: false, full: null, used: null, capacity: null, bag: [] };
      return;
    }
    const used = packet.bag.slice(0, capacity).filter(item => item != null && item !== false).length;
    mod.inventory = { known: true, full: used >= capacity, used, capacity, bag: packet.bag.slice(0, capacity) };
  }

  function updateShop(packet) {
    if (packet?.t === "shop" && refillNpcId != null && String(packet.npc) === String(refillNpcId)) {
      refillReturnTo = refillTrip?.returnTo ? { ...refillTrip.returnTo } : refillReturnTo;
      const offers = Array.isArray(packet.items) ? packet.items : [];
      mod.refill.shopItems = offers.map((item, index) => {
        const rawName = item?.name;
        const name = typeof rawName === "string" ? rawName
          : rawName?.pt ?? rawName?.en ?? rawName?.es ?? `Item ${item?.id ?? index + 1}`;
        return { id: item?.id == null ? null : String(item.id), name, price: Number(item?.price ?? item?.value) || 0,
          pack: Math.max(1, Number(item?.pack) || 1), index };
      }).filter(item => item.id != null);
      refillNpcId = null;
      refillTrip = null;
      shopVisitFinishing = false;
      suppressShopDisplay = false;
      suppressShopReopenUntilReturn = false;
      huntState.autoSellInProgress = false;
      window.__fantasyAutoSellInProgress = false;
      mod.refill.status = "Supplies Merchant aberto";
      huntState.status = "Supplies Merchant aberto; refill aguardando ação";
      mod.log("info", "Janela do Supplies Merchant aberta.");
      const configuredItems = mod.refill.items ?? [];
      refillPurchaseQueue = configuredItems.flatMap(configured => {
        const matchingOffers = mod.refill.shopItems.filter(item => item.id === String(configured.id));
        if (!matchingOffers.length) {
          mod.log("warn", `${configured.name ?? `Item ${configured.id}`} (ID ${configured.id}) não está no catálogo do Supplies Merchant.`);
          return [];
        }
        const current = ownedRefillStock(configured.id);
        if (current == null) {
          mod.log("warn", `Não consegui ler o estoque atual de ${configured.name} (ID ${configured.id}); compra ignorada para evitar comprar a mais sem saber a quantidade.`);
          return [];
        }
        const deficit = Number(configured.quantity) - current;
        if (deficit <= 0) {
          mod.log("info", `${configured.name} (ID ${configured.id}): estoque ${current}/${configured.quantity}; não precisa comprar.`);
          return [];
        }
        const packagePlan = planRefillPackages(matchingOffers, deficit);
        if (!packagePlan.length) {
          mod.log("warn", `Não encontrei um pacote comprável para ${configured.name} (ID ${configured.id}).`);
          return [];
        }
        return packagePlan.map(({ offer, count }) => ({
          npc: packet.npc, index: offer.index, id: offer.id, name: offer.name,
          order: 1, orderCount: count, units: offer.pack, cost: offer.price,
          current, target: configured.quantity
        }));
      });
      if (refillPurchaseQueue.length) {
        nextRefillBuyAt = Date.now() + 2000;
        const totalPackages = refillPurchaseQueue.reduce((total, entry) => total + entry.orderCount, 0);
        mod.refill.status = `Refill: ${totalPackages} pacote(s) na fila`;
        mod.log("info", `Iniciando refill automático: ${totalPackages} pacote(s), calculados pelos preços e quantidades do catálogo.`);
      } else if (configuredItems.length) {
        mod.refill.status = "Estoque dos itens configurados já atingido";
        mod.log("info", "Nenhuma compra necessária; os estoques configurados já foram atingidos ou não estão disponíveis nesta loja.");
        setTimeout(finishRefillPurchases, 1000);
      } else {
        mod.refill.status = "Supplies Merchant aberto; configure os itens do refill";
        mod.log("info", "Nenhum item de refill configurado. Selecione itens no menu Refill para a próxima visita.");
        setTimeout(finishRefillPurchases, 0);
      }
      return;
    }
    if (packet?.t === "shop" && packet.buys === true && (huntState.autoSell || trainingCityTrip)
      && gearMerchantNpcId != null && String(packet.npc) === String(gearMerchantNpcId)) {
      // Intercept the screen before the game's onmessage handler calls show().
      suppressShopDisplay = true;
      protectShopScreen();
    }
    if (packet?.t === "shop" && shopVisitFinishing) return;
    if (packet?.t === "shop" && suppressShopReopenUntilReturn) {
      // The game's message handler can reopen this canvas screen after this
      // observer sees the packet, so close it on the next task too.
      setTimeout(closeGameShopPanel, 0);
      return;
    }
    if (packet?.t !== "shop" || !packet.buys || gearMerchantNpcId == null
      || String(packet.npc) !== String(gearMerchantNpcId)) return;
    if (activeSellShop && String(activeSellShop.npc) === String(packet.npc)) {
      activeSellShop = packet;
      return;
    }
    activeSellShop = packet;
    shopSellWaiting = false;
    shopSellDoneLogged = false;
    shopSoldCount = 0;
    nextShopSellAt = Date.now();
    mod.log("info", "Dados da loja recebidos; enviando vendas direto ao servidor sem abrir a tela.");
  }

  mod.gamePacketEncoding = "Aguardando módulo WebAssembly do jogo";

  const monitor = {
    packets,
    sockets: [],
    clear() { packets.length = 0; },
    latest(count = 20) { return packets.slice(-Math.max(0, count)); }
  };

  window.WebSocket = new Proxy(NativeWebSocket, {
    construct(Target, args, NewTarget) {
      const socket = Reflect.construct(Target, args, NewTarget);
      const entry = { id: nextSocketId++, socket };
      sockets.push(entry);
      monitor.sockets = sockets.map(item => item.socket);

      socket.addEventListener("message", event => record(socket, "RECEBIDO", event.data));
      const nativeSend = socket.send;
      socket.send = function (data) {
        if (typeof data === "string") {
          try {
            const outgoing = JSON.parse(data);
            if (outgoing?.t === "k") assetSockets.add(this);
            else if (outgoing?.t) gameSocket = this;
            if (outgoing?.t === "va") confirmation.answered(this);
            if (outgoing?.t === "logout") {
              confirmation.reset(this);
              intentionalCloses.add(this);
              reconnectPending = false;
            }
          } catch {}
        }
        let outgoingData = data;
        if (typeof data === "string" && this === gameSocket && !assetSockets.has(this)) {
          let outgoing;
          try { outgoing = JSON.parse(data); } catch {}
          if (outgoing && typeof outgoing === "object" && !Array.isArray(outgoing)) {
            const codec = socketDecoders.get(this);
            const hasSignature = outgoing.z != null;
            if (!codec?.decoder?.encode && hasSignature && codec?.promise) {
              // Preserve any native client packet that races codec startup, then
              // advance our signer with it once the same per-socket module opens.
              codec.promise.then(gameCodec => gameCodec.observe(data)).catch(() => {});
            } else if (!codec?.decoder?.encode && !hasSignature) {
              mod.gamePacketEncoding = "Codificador do jogo indisponível; mensagem cancelada";
              throw new Error("O codificador do jogo ainda não está pronto; mensagem JSON cancelada para evitar envio sem z.");
            } else if (codec?.decoder?.encode) {
              // The game's private encoder cannot see packets sent by the mod.
              // Re-sign all gameplay JSON through this per-connection codec so
              // its counter stays correct across both game and mod messages.
              delete outgoing.z;
              outgoingData = codec.decoder.encode(JSON.stringify(outgoing));
            }
          }
        }
        record(socket, "ENVIADO", outgoingData);
        return nativeSend.call(this, outgoingData);
      };

      const update = () => publish("sockets", socketState());
      const isGameSocket = (() => { try { return /^\/ws(?:\/\d+)?\/?$/.test(new URL(socket.url).pathname); } catch { return false; } })();
      socket.addEventListener("open", () => {
        update();
        if (isGameSocket) mod.log("info", "WebSocket do jogo conectado.");
      });
      socket.addEventListener("close", event => {
        confirmation.reset(socket);
        update();
        if (isGameSocket && !assetSockets.has(socket)) mod.log("warn", `WebSocket do jogo fechado (código ${event.code}${event.reason ? `: ${event.reason}` : ""}).`);
        if (socket === gameSocket && !assetSockets.has(socket) && !intentionalCloses.has(socket)
            && deathRecovery?.stage !== "reconnect") {
          try { reconnectPending = localStorage.getItem("fantasy-mod-auto-reconnect") === "true"; } catch { reconnectPending = false; }
          if (reconnectPending) {
            reconnectNextAt = Date.now() + 2000;
            mod.log("info", "Conexão perdida; aguardando a tela de reconexão.");
          }
        }
      });
      socket.addEventListener("error", () => {
        update();
        if (isGameSocket) mod.log("error", "Erro no WebSocket do jogo.");
      });
      update();
      return socket;
    }
  });

  // Capture the game's own Reconnect/Retry action when it draws the button.
  // Invoking that action keeps session handling and the game UI in sync.
  Promise.all([import("/src/gui.mjs"), import("/src/i18n.mjs")]).then(([gui, i18n]) => {
    const prototype = gui.GUI?.prototype;
    if (!prototype || typeof prototype.text !== "function" || typeof prototype.button !== "function") throw new Error("interface de reconexão indisponível");
    const originalText = prototype.text;
    const originalButton = prototype.button;
    const labels = new WeakMap();
    prototype.text = function (label, ...args) {
      labels.set(this, label);
      return originalText.call(this, label, ...args);
    };
    prototype.button = function (rect, action, ...args) {
      const label = labels.get(this);
      labels.delete(this);
      const result = originalButton.call(this, rect, action, ...args);
      let enabled = false;
      try { enabled = localStorage.getItem("fantasy-mod-auto-reconnect") === "true"; } catch {}
      if (!enabled) reconnectPending = false;
      if (enabled && reconnectPending && Date.now() >= reconnectNextAt
          && (label === i18n.t("Reconnect") || label === i18n.t("Retry"))
          && rect?.x === 2.5 && (rect.y === 2 || rect.y === 0.5) && rect.w === 5 && rect.h === 1) {
        reconnectNextAt = Date.now() + 8000;
        setTimeout(() => {
          if (!reconnectPending) return;
          try {
            if (localStorage.getItem("fantasy-mod-auto-reconnect") !== "true") return;
            mod.log("info", "Tentando reconectar automaticamente.");
            action();
          } catch (error) { mod.log("warn", `Falha ao reconectar: ${error?.message ?? error}`); }
        }, 0);
      }
      return result;
    };
  }).catch(error => mod.log("warn", `Reconexão automática indisponível: ${error?.message ?? error}`));

  const NativeWorker = window.Worker;
  window.Worker = new Proxy(NativeWorker, {
    construct(Target, args, NewTarget) {
      const worker = Reflect.construct(Target, args, NewTarget);
      worker.addEventListener("message", event => {
        const result = event.data?.out;
        if (event.data?.op !== "done" || !result?.map || !result?.meta) return;
        try {
          gameWorld = new window.__FantasyPathfinder(result.map, result.meta, result.collision, result.mask);
          monsterAssets = result;
          monsterData = new Map((result.monsters ?? []).map(monster => [monster.type, monster]));
          rebuildMonsterCatalog();
          mod.mapReady = true;
          mod.pathStatus = "Mapa e colisões carregados";
        } catch (error) {
          gameWorld = null;
          mod.mapReady = false;
          mod.pathStatus = `Falha ao ler o mapa: ${error.message}`;
        }
      });
      return worker;
    }
  });

  Object.defineProperty(window, "__gameMonitor", {
    value: monitor,
    configurable: false,
    enumerable: false
  });
  publish("sockets", socketState());
})();
