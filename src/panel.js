(() => {
  if (window.__fantasyModPanel) return;
  if (!window.__fantasyModErrorHooks) {
    window.__fantasyModErrorHooks = true;
    const logs = window.__fantasyModConsole ?? (window.__fantasyModConsole = []);
    const logError = message => {
      logs.push({ id: Date.now() + Math.random(), at: new Date().toISOString(), level: "error", message: String(message).slice(0, 1200) });
      if (logs.length > 1000) logs.splice(0, logs.length - 1000);
      window.dispatchEvent(new CustomEvent("__fantasy_mod_console_update"));
    };
    window.addEventListener("error", event => {
      const source = event.filename ? ` (${event.filename}:${event.lineno ?? 0}:${event.colno ?? 0})` : "";
      logError(`${event.message || "Erro JavaScript"}${source}`);
    });
    window.addEventListener("unhandledrejection", event => {
      const reason = event.reason;
      logError(`Promise rejeitada: ${reason?.stack ?? reason?.message ?? String(reason)}`);
    });
  }
  const install = () => {
  if (window.__fantasyModPanel || !document.documentElement) return;

  const host = document.createElement("div");
  host.id = "fantasy-mod-panel-host";
  host.style.cssText = "all:initial;position:fixed;z-index:2147483647;inset:0;width:100vw;height:100vh;pointer-events:none";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      /* Palette and bevels from v2/src/hud-style.mjs and the game's HUD CSS. */
      :host {
        --ui:#efe4cc; --ui-2:#b8a888; --fraco:#8a7a62;
        --ouro:#f2c14e; --ouro-claro:#ffe9a8; --ouro-escuro:#c28d22;
        --verde:#8ef0a8; --vermelho:#ff9b8a; --azul:#8cc8ff;
        --k:#0d0a07; --painel:#2a231c; --luz:#574735; --escuro:#17120d;
        --poco:#1e1914; --poco-luz:#3a3027; --slot:#15110d;
        --fonte:"Pixelify Num", "Pixelify Sans", monospace;
      }
      :host { all: initial; color-scheme: dark; font: 500 14px/1.4 var(--fonte); }
      * { box-sizing: border-box; }
      button, input, select, textarea { font: inherit; }
      .backdrop { position:fixed; inset:0; display:grid; place-items:center; padding:16px; background:#070503a0; pointer-events:auto; }
      .backdrop[hidden] { display:none; }
      .panel { display:flex; flex-direction:column; width:min(560px,96vw); height:min(430px,88vh); max-height:calc(100vh - 32px); overflow:hidden; padding:14px; border:1px solid var(--luz); border-radius:0; background:var(--painel); color:var(--ui); box-shadow:0 16px 54px #000b; }
      header { display:flex; align-items:center; justify-content:space-between; margin-bottom: 10px; font-weight:700; }
      .resource-summary { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; margin:2px 0 10px; }
      .resource-card { display:flex; align-items:center; gap:6px; min-width:0; padding:6px 7px; border:1px solid var(--luz); border-radius:0; background:var(--painel); }
      .resource-card[data-kind="arrows"] { --resource-accent:var(--ouro); }
      .resource-card[data-kind="hp"] { --resource-accent:var(--vermelho); }
      .resource-card[data-kind="mp"] { --resource-accent:var(--azul); }
      .resource-icon { display:grid; flex:0 0 25px; width:25px; height:25px; place-items:center; border:1px solid color-mix(in srgb,var(--resource-accent) 35%,transparent); border-radius:0; background:color-mix(in srgb,var(--resource-accent) 12%,var(--slot)); color:var(--resource-accent); }
      .resource-icon svg { width:15px; height:15px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
      .resource-copy { display:grid; min-width:0; gap:0; }
      .resource-label { overflow:hidden; color:var(--ui-2); font-size:8px; font-weight:700; letter-spacing:.05em; text-overflow:ellipsis; text-transform:uppercase; white-space:nowrap; }
      .resource-value { color:var(--ui); font-size:16px; font-variant-numeric:tabular-nums; font-weight:700; line-height:1.1; }
      .resource-note { color:var(--fraco); font-size:8px; line-height:1.1; }
      .setting-toggle { position:relative; display:flex; align-items:center; gap:9px; min-height:42px; padding:7px 10px; border:1px solid var(--luz); border-radius:0; background:var(--painel); color:var(--ui); cursor:pointer; transition:border-color .15s,background .15s; }
      .setting-toggle:hover { border-color:var(--luz); background:var(--painel); }
      .setting-toggle-icon { display:grid; flex:0 0 26px; width:26px; height:26px; place-items:center; border:1px solid var(--luz); border-radius:0; background:var(--slot); color:var(--ouro); }
      .setting-toggle-icon svg { width:15px; height:15px; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
      .setting-toggle-label { flex:1; font-size:11px; font-weight:650; }
      .setting-toggle input { position:absolute; width:1px; height:1px; overflow:hidden; opacity:0; }
      .setting-switch { position:relative; flex:0 0 34px; width:34px; height:19px; border:1px solid var(--luz); border-radius:0; background:var(--poco); transition:background .18s,border-color .18s; }
      .setting-switch::after { position:absolute; top:2px; left:2px; width:13px; height:13px; border-radius:0; background:var(--ui-2); content:""; transition:transform .18s,background .18s; }
      .setting-toggle input:checked + .setting-switch { border-color:var(--ouro); background:#46381a; }
      .setting-toggle input:checked + .setting-switch::after { background:var(--ui); transform:translateX(15px); }
      .setting-toggle input:focus-visible + .setting-switch { outline:2px solid var(--ouro); outline-offset:2px; }
      .refill-action-row { display:grid; grid-template-columns:minmax(120px, .8fr) minmax(0,1.2fr); gap:9px; align-items:center; margin:10px 0 4px; padding:9px; border:1px solid var(--luz); border-radius:0; background:var(--painel); }
      .refill-action { display:flex; align-items:center; justify-content:center; gap:8px; min-height:38px; padding:8px 14px; border:1px solid var(--ouro); border-radius:0; background:var(--painel); color:var(--ui); font-weight:700; letter-spacing:.02em; box-shadow:0 4px 12px #00000066; cursor:pointer; transition:filter .15s,transform .15s,box-shadow .15s; }
      .refill-action:hover { filter:brightness(1.12); box-shadow:0 6px 16px #00000066; transform:translateY(-1px); }
      .refill-action:active { transform:translateY(0); }
      .refill-action svg { width:16px; height:16px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
      .refill-status { display:flex; align-items:center; gap:7px; min-width:0; margin:0; padding:0 3px; color:var(--ui-2); font-size:12px; font-weight:700; }
      .refill-status::before { width:8px; height:8px; flex:0 0 8px; border-radius:0; background:var(--fraco); content:""; }
      .refill-status[data-state="loading"] { color:var(--ouro); }
      .refill-status[data-state="loading"]::before { background:var(--ouro); box-shadow:0 0 9px #f2c14e55; animation:refill-pulse 1.2s ease-in-out infinite; }
      .refill-status[data-state="complete"] { color:var(--verde); }
      .refill-status[data-state="complete"]::before { background:var(--verde); box-shadow:0 0 8px #8ef0a855; }
      .refill-status[data-state="error"] { color:var(--vermelho); }
      .refill-status[data-state="error"]::before { background:var(--vermelho); box-shadow:0 0 8px #ff9b8a55; }
      @keyframes refill-pulse { 50% { opacity:.45; } }
      .destination-form { margin-bottom:12px; padding:8px; border:1px solid var(--k); background:var(--slot); }
      .destination-form h3 { margin:0 0 7px; color:var(--ouro); font-size:13px; }
      .destination-fields { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; }
      .destination-form .result { font-size:11px; }
      .json-payload { display:block; width:100%; min-height:130px; margin:5px 0 10px; padding:8px; resize:vertical; font:12px/1.5 ui-monospace,monospace; }
      .refill-items { display:grid; gap:6px; margin-top:10px; }
      .refill-items-title { color:var(--ui); font-size:12px; font-weight:700; }
      .refill-item-controls { display:grid; grid-template-columns:minmax(0,1fr) 92px 100px; gap:7px; align-items:end; }
      .refill-item-controls label { min-width:0; color:var(--ui-2); font-size:10px; }
      .refill-item-controls select,.refill-item-controls input { width:100%; min-width:0; margin-top:3px; padding:7px; border:1px solid var(--luz); border-radius:0; background:var(--slot); color:var(--ui); }
      .refill-item-controls select { min-height:34px; }
      .refill-item-add { display:flex; align-items:center; justify-content:center; gap:6px; min-height:34px; padding:6px 10px; border:1px solid var(--ouro); border-radius:0; background:var(--painel); color:var(--ui); font-size:11px; font-weight:700; box-shadow:0 3px 9px #00000066; cursor:pointer; transition:filter .15s,transform .15s; }
      .refill-item-add:hover { filter:brightness(1.13); transform:translateY(-1px); }
      .refill-item-add:active { transform:translateY(0); }
      .refill-item-add svg { width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; }
      .refill-item-list { display:grid; gap:5px; max-height:100px; overflow:auto; }
      .refill-item-row { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 8px; border:1px solid var(--luz); border-radius:0; background:var(--slot); color:var(--ui); font-size:11px; }
      .refill-item-row button { padding:3px 7px; border:1px solid #c8625a; border-radius:0; background:#8c3a30; color:var(--vermelho); cursor:pointer; }
      .refill-item-row { flex-wrap:wrap; }
      .refill-item-row > span { flex:1 1 140px; min-width:0; overflow-wrap:anywhere; }
      .refill-item-actions { display:flex; gap:5px; flex-wrap:wrap; }
      .refill-item-editor { display:flex; align-items:end; flex-wrap:wrap; gap:7px; width:100%; }
      .refill-item-editor label { flex:1 1 100px; }
      .close { border:0; background:transparent; color:var(--ui-2); cursor:pointer; font-size:19px; }
      .workspace { display:grid; grid-template-columns:150px minmax(0,1fr); gap:16px; flex:1; min-height:0; }
      .side-menu { display:flex; flex-direction:column; gap:5px; padding-right:12px; border-right:1px solid var(--luz); max-height:100%; overflow:auto; }
      .side-link { padding:9px 10px; border:0; border-radius:0; background:transparent; color:var(--ui-2); text-align:left; cursor:pointer; }
      .side-link:hover,.side-link[data-active="true"] { background:#46381a; color:var(--ui); }
      .page-content { min-width:0; overflow:auto; padding:0 8px 8px 0; }
      .panel :is(.page-content,.side-menu,.creature-list,.target-list,.waypoint-list,.loot-item-list,.refill-item-list,.console-list) {
        scrollbar-width:thin;
        scrollbar-color:#9a783b var(--slot);
        scrollbar-gutter:stable;
      }
      /* Let Chrome use the custom pixel-style track and thumb below instead
         of overriding them with the native scrollbar-color rendering. */
      @supports selector(::-webkit-scrollbar) {
        .panel :is(.page-content,.side-menu,.creature-list,.target-list,.waypoint-list,.loot-item-list,.refill-item-list,.console-list) {
          scrollbar-width:auto;
          scrollbar-color:auto;
        }
      }
      .panel ::-webkit-scrollbar { width:10px; height:10px; }
      .panel ::-webkit-scrollbar-track {
        background:var(--slot);
        border:1px solid var(--k);
        box-shadow:inset 1px 1px #0008;
      }
      .panel ::-webkit-scrollbar-thumb {
        min-height:32px;
        border:2px solid var(--slot);
        border-radius:0;
        background:#9a783b;
        background-clip:padding-box;
        box-shadow:inset 1px 1px #c7a45c,inset -1px -1px #604923;
      }
      .panel ::-webkit-scrollbar-thumb:hover { background-color:var(--ouro-escuro); }
      .panel ::-webkit-scrollbar-thumb:active { background-color:var(--ouro); }
      .panel ::-webkit-scrollbar-button { display:none; width:0; height:0; }
      .panel ::-webkit-scrollbar-corner { background:var(--slot); }
      .page[hidden] { display:none; }
      .page > h2 { margin:0 0 12px; font-size:16px; }
      .fields { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      label { display:block; color:var(--ui-2); font-size:11px; }
      input[type=number] { width:100%; margin-top:3px; padding:7px; border:1px solid var(--luz); border-radius:0; background:var(--slot); color:var(--ui); }
      .result { min-height:18px; margin:7px 0 0; color:var(--ui-2); font-size:12px; overflow-wrap:anywhere; }
      .prefs { padding-top:10px; margin-top:10px; border-top:1px solid var(--luz); }
      .pref { display:flex; align-items:center; justify-content:space-between; gap:10px; min-height:36px; margin:5px 0; padding:7px 9px; border:1px solid var(--luz); border-radius:0; background:var(--painel); color:var(--ui); }
      .pref input[type="checkbox"],.automation-title input[type="checkbox"],.target-row input[type="checkbox"],.loot-item input[type="checkbox"] { appearance:none; -webkit-appearance:none; position:relative; display:block; flex:0 0 34px; width:34px; height:19px; margin:0; border:1px solid var(--luz); border-radius:0; background:var(--poco); cursor:pointer; transition:background .18s,border-color .18s; }
      .pref input[type="checkbox"]::after,.automation-title input[type="checkbox"]::after,.target-row input[type="checkbox"]::after,.loot-item input[type="checkbox"]::after { position:absolute; top:2px; left:2px; width:13px; height:13px; border-radius:0; background:var(--ui-2); content:""; transition:transform .18s,background .18s; }
      .pref input[type="checkbox"]:checked,.automation-title input[type="checkbox"]:checked,.target-row input[type="checkbox"]:checked,.loot-item input[type="checkbox"]:checked { border-color:var(--ouro); background:#46381a; }
      .pref input[type="checkbox"]:checked::after,.automation-title input[type="checkbox"]:checked::after,.target-row input[type="checkbox"]:checked::after,.loot-item input[type="checkbox"]:checked::after { background:var(--ui); transform:translateX(15px); }
      .pref input[type="checkbox"]:focus-visible,.automation-title input[type="checkbox"]:focus-visible,.target-row input[type="checkbox"]:focus-visible,.loot-item input[type="checkbox"]:focus-visible { outline:2px solid var(--ouro); outline-offset:2px; }
      .automation { display:grid; grid-template-columns:1fr 76px; gap:8px; align-items:center; padding:9px 0; border-bottom:1px solid var(--luz); }
      .automation:last-of-type { border-bottom:0; }
      .automation-title { display:flex; align-items:center; gap:8px; color:var(--ui); }
      .threshold { width:100%; margin:0; }
      .hint { margin:5px 0 0; color:var(--ui-2); font-size:11px; }
      .creature-search { padding-top:12px; margin-top:12px; border-top:1px solid var(--luz); }
      .search-row { display:grid; grid-template-columns:minmax(0,1fr) 94px; gap:7px; align-items:end; }
      .search { padding:7px; border:0; border-radius:0; background:#3d3328; color:var(--ui); cursor:pointer; }
      .creature-list { display:grid; gap:6px; max-height:190px; overflow:auto; margin-top:9px; }
      .creature { display:grid; grid-template-columns:1fr auto; gap:8px; align-items:center; padding:7px 8px; border:1px solid var(--luz); border-radius:0; background:var(--slot); }
      .creature-name { color:var(--ui); font-weight:600; }
      .creature-info { color:var(--ui-2); font-size:11px; }
      .go-creature { padding:5px 8px; border:0; border-radius:0; background:#3d3328; color:var(--ui); cursor:pointer; }
      .creature-actions { display:flex; gap:5px; }
      .target-creature { padding:5px 8px; border:1px solid var(--luz); border-radius:0; background:#3d3328; color:var(--ui); cursor:pointer; }
      .target-creature.active { border-color:#c8625a; background:#8c3a30; color:var(--vermelho); }
      .empty-creatures { margin:0; color:var(--ui-2); font-size:12px; }
      .target-tools { display:flex; gap:7px; margin:0 0 8px; }
      .target-tools button { padding:6px 8px; border:1px solid var(--luz); border-radius:0; background:#3d3328; color:var(--ui); cursor:pointer; }
      .target-search { width:100%; margin:0 0 8px; padding:7px; border:1px solid var(--luz); border-radius:0; background:var(--slot); color:var(--ui); }
      .target-list { display:grid; gap:5px; max-height:265px; overflow:auto; }
      .target-row { display:grid; grid-template-columns:36px minmax(0,1fr) auto; gap:8px; align-items:center; padding:5px 7px; border:1px solid var(--luz); border-radius:0; background:var(--slot); }
      .target-row img,.target-placeholder { width:36px; height:36px; object-fit:contain; image-rendering:pixelated; }
      .target-placeholder { display:grid; place-items:center; color:var(--fraco); font-size:10px; }
      .target-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--ui); }
      .target-type { color:var(--ui-2); font-size:10px; }
      .hunt { padding-top:12px; margin-top:12px; border-top:1px solid var(--luz); }
      .hunt textarea { display:block; width:100%; resize:vertical; margin-top:5px; padding:8px; border:1px solid var(--luz); border-radius:0; background:var(--slot); color:var(--ui); }
      .hunt-toggle { width:100%; margin-top:8px; padding:8px; border:0; border-radius:0; background:#3d6b4a; color:var(--ui); font-weight:650; cursor:pointer; }
      .hunt-toggle[data-active="true"] { background:#8c3a30; }
      .hunt-status { margin:6px 0 0; min-height:18px; color:var(--ui-2); font-size:12px; }
      .lure-status-card { margin-top:10px; padding:11px; border:1px solid var(--luz); border-radius:0; background:var(--painel); }
      .lure-status-head { display:flex; align-items:center; gap:8px; }
      .lure-status-dot { width:8px; height:8px; flex:none; border-radius:0; background:var(--fraco); box-shadow:0 0 0 3px #8a7a6233; }
      .lure-status-card[data-active="true"] .lure-status-dot { background:var(--verde); box-shadow:0 0 0 3px #8ef0a855; }
      .lure-status-title { color:var(--ui); font-size:12px; font-weight:650; }
      .lure-count-display { margin-left:auto; color:var(--ui); font-variant-numeric:tabular-nums; font-size:12px; }
      .lure-progress-track { height:6px; margin-top:10px; overflow:hidden; border-radius:0; background:var(--poco); }
      .lure-progress-fill { width:0; height:100%; border-radius:0; background:var(--painel); transition:width .2s ease; }
      .lure-status-card[data-active="false"] .lure-progress-fill { background:var(--fraco); }
      .lure-route-status { margin:8px 0 0; color:var(--ui-2); font-size:11px; overflow-wrap:anywhere; }
      .loot-picker { margin-top:8px; padding:9px; border:1px solid var(--luz); border-radius:0; background:var(--slot); }
      .loot-picker-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:7px; color:var(--ui); font-size:11px; font-weight:650; }
      .loot-picker-actions { display:flex; gap:5px; }
      .loot-picker button { padding:4px 6px; border:1px solid var(--luz); border-radius:0; background:#3d3328; color:var(--ui); font-size:10px; cursor:pointer; }
      .loot-item-list { display:grid; gap:3px; max-height:100px; overflow:auto; scrollbar-width:thin; scrollbar-color:var(--luz) transparent; }
      .loot-item { display:flex; align-items:center; gap:7px; min-width:0; padding:3px 4px; border-radius:0; color:var(--ui); font-size:11px; }
      .loot-item:hover { background:var(--painel); }
      .loot-item input { flex:none; }
      .loot-item-icon { width:28px; height:28px; flex:none; border:1px solid var(--luz); border-radius:0; object-fit:cover; image-rendering:pixelated; background:var(--painel); }
      .loot-item-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .loot-item-empty { margin:0; color:var(--ui-2); font-size:11px; }
      .waypoint-actions { display:grid; grid-template-columns:1fr 1fr; gap:7px; margin-top:8px; }
      .waypoint-actions button,.waypoint-remove { padding:7px 8px; border:1px solid var(--luz); border-radius:0; background:#3d3328; color:var(--ui); cursor:pointer; }
      .waypoint-list { display:grid; gap:6px; max-height:210px; overflow:auto; margin-top:10px; }
      .waypoint-row { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:center; padding:7px 8px; border:1px solid var(--luz); border-radius:0; background:var(--slot); }
      .waypoint-name { color:var(--ui); font-weight:600; }
      .waypoint-floor { color:var(--ui-2); font-size:11px; }
      .lure-count { max-width:150px; margin-top:9px; }
      .lure-settings { display:grid; grid-template-columns:minmax(0,150px); gap:7px; margin-top:9px; }
      .attack-range { max-width:170px; margin-top:9px; }
      select { width:100%; margin-top:3px; padding:7px; border:1px solid var(--luz); border-radius:0; background:var(--slot); color:var(--ui); }
      .console-toolbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; color:var(--ui-2); font-size:11px; }
      .console-toolbar button { padding:5px 8px; border:1px solid var(--luz); border-radius:0; background:#3d3328; color:var(--ui); cursor:pointer; }
      .console-actions { display:flex; gap:6px; }
      .console-list { display:grid; gap:5px; max-height:320px; overflow:auto; }
      .console-entry { padding:6px 8px; border-left:2px solid var(--fraco); background:var(--slot); overflow-wrap:anywhere; white-space:pre-wrap; font:11px/1.45 ui-monospace,monospace; color:var(--ui); }
      .console-entry[data-level="error"] { border-color:var(--vermelho); color:var(--vermelho); }
      .console-entry[data-level="warn"] { border-color:var(--ouro); color:var(--ouro-claro); }
      .panel {
        user-select:none;
        -webkit-user-select:none;
        font:500 14px/1.4 var(--fonte);
        border:2px solid var(--k);
        box-shadow:inset 2px 2px var(--luz),inset -2px -2px var(--escuro),4px 4px 0 #0008;
        text-shadow:1px 1px #000;
      }
      header { color:var(--ouro); font-size:18px; padding-bottom:8px; border-bottom:2px solid var(--k); }
      .menu-version { margin-left:6px; color:var(--ui-2); font-size:12px; font-weight:500; }
      .page > h2 { color:var(--ouro); }
      .panel button {
        border:1px solid var(--k); border-radius:0; background:#3d3328; color:var(--ui);
        box-shadow:inset 1px 1px #6a5844,inset -1px -1px var(--escuro);
        text-shadow:1px 1px #000;
      }
      .panel button:hover { background:#4a3e30; filter:none; transform:none; }
      .panel button:active { box-shadow:inset 1px 1px var(--escuro),inset -1px -1px #6a5844; }
      .panel button:disabled { color:var(--fraco); background:#241e18; cursor:default; }
      .panel button:focus-visible,.panel input:focus-visible,.panel select:focus-visible,.panel textarea:focus-visible {
        outline:2px solid var(--ouro); outline-offset:2px;
      }
      .panel .side-link[data-active="true"] {
        color:var(--ouro); background:#46381a; border-color:var(--ouro);
        box-shadow:inset 1px 1px #6b5626,inset -1px -1px var(--escuro);
      }
      .panel .refill-action,.panel .refill-item-add {
        color:#2a1a04; background:var(--ouro); text-shadow:none;
        box-shadow:inset 1px 1px var(--ouro-claro),inset -1px -1px var(--ouro-escuro);
      }
      .panel .refill-action:hover,.panel .refill-item-add:hover { background:var(--ouro-claro); }
      .panel .hunt-toggle { background:#3d6b4a; box-shadow:inset 1px 1px #62a577,inset -1px -1px #1f3d28; }
      .panel .hunt-toggle[data-active="true"],.panel .target-creature.active {
        background:#8c3a30; box-shadow:inset 1px 1px #c8625a,inset -1px -1px #4a1a14;
      }
      .panel .close { width:28px; height:28px; padding:0; line-height:1; }
      .resource-card,.pref,.setting-toggle,.refill-action-row,.lure-status-card,.loot-picker {
        border-color:var(--k); box-shadow:inset 1px 1px var(--luz),inset -1px -1px var(--escuro);
      }
      .creature,.target-row,.waypoint-row,.refill-item-row {
        border-color:var(--k); background:var(--slot); box-shadow:inset 1px 1px #0008;
      }
      .panel input:not([type="checkbox"]),.panel select,.panel textarea {
        user-select:text;
        -webkit-user-select:text;
        border:1px solid var(--k); background:var(--poco); color:var(--ui);
        box-shadow:inset 1px 1px var(--k),inset -1px -1px var(--poco-luz);
      }
      .panel input[type="checkbox"],.setting-switch {
        width:20px; height:20px; flex:0 0 20px; border:1px solid var(--k);
        border-radius:0; background:var(--slot); box-shadow:inset 1px 1px #0008,inset -1px -1px var(--poco-luz);
      }
      .panel .setting-toggle input { position:absolute; width:1px; height:1px; opacity:0; }
      .panel input[type="checkbox"]::after,.setting-switch::after {
        content:""; position:absolute; left:5px; top:2px; width:6px; height:11px;
        border:solid #2a1a04; border-width:0 2px 2px 0; border-radius:0;
        background:transparent; transform:rotate(45deg); opacity:0; transition:none;
      }
      .panel input[type="checkbox"]:checked,.setting-toggle input:checked + .setting-switch {
        border-color:var(--k); background:var(--ouro);
        box-shadow:inset 1px 1px var(--ouro-claro),inset -1px -1px var(--ouro-escuro);
      }
      .panel input[type="checkbox"]:checked::after,.setting-toggle input:checked + .setting-switch::after {
        opacity:1; background:transparent; transform:rotate(45deg);
      }
      .setting-toggle input:focus-visible + .setting-switch { outline-color:var(--ouro); }
      .resource-icon,.setting-toggle-icon { border-color:var(--k); background:var(--slot); }
      .resource-icon svg,.setting-toggle-icon svg,.refill-action svg,.refill-item-add svg {
        stroke-linecap:square; stroke-linejoin:miter;
      }
      .resource-label,.resource-note { font-size:10px; }
      .lure-progress-track { background:#140f0b; border:1px solid var(--k); height:8px; }
      .lure-progress-fill { background:#4cbf68; box-shadow:inset 0 1px #a6f5b4; }
      @media (max-width:560px) {
        .panel { width:96vw; height:78vh; border-radius:0; padding:12px; }
        .workspace { grid-template-columns:100px minmax(0,1fr); gap:9px; }
        .side-menu { padding-right:8px; }
        .side-link { padding:8px 6px; font-size:12px; }
        .search-row { grid-template-columns:minmax(0,1fr) 72px; }
        .search-row .search { grid-column:1 / -1; }
      }
    </style>
    <div class="backdrop" hidden>
    <section class="panel" role="dialog" aria-modal="true" aria-label="Preferências do Sentinela">
      <header><span>Menu do Sentinela <span class="menu-version">v1.0.1</span></span><button class="close" aria-label="Fechar">×</button></header>
      <div class="workspace">
        <nav class="side-menu" aria-label="Opções do Sentinela">
          <button class="side-link" data-page="creatures">Criaturas</button>
          <button class="side-link" data-page="targets">Alvos</button>
          <button class="side-link" data-page="hunt">Sistema de caça</button>
          <button class="side-link" data-page="focus">Focar</button>
          <button class="side-link" data-page="refill">Loja / Refill</button>
          <button class="side-link" data-page="waypoints">Waypoints</button>
          <button class="side-link" data-page="clone">Clone</button>
          <button class="side-link" data-page="automation">Automações</button>
          <button class="side-link" data-page="console">Console</button>
        </nav>
        <div class="page-content">
          <section class="page" data-section="creatures" hidden>
            <h2>Criaturas próximas</h2>
            <div class="creature-search">
              <div class="search-row">
                <label>Raio da busca<input class="creature-radius" type="number" min="1" max="100" step="1" value="10"></label>
                <button class="search">Buscar</button>
              </div>
              <div class="creature-list" aria-live="polite"></div>
            </div>
          </section>
          <section class="page" data-section="hunt" hidden>
            <h2>Sistema de caça</h2>
            <div class="hunt">
              <button class="hunt-toggle">Iniciar caça</button>
              <label class="setting-toggle">
                <span class="setting-toggle-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4M11 8v6M8 11h6"/></svg></span>
                <span class="setting-toggle-label">Atacar qualquer criatura</span>
                <input class="hunt-attack-any" type="checkbox" aria-label="Atacar qualquer criatura">
                <span class="setting-switch" aria-hidden="true"></span>
              </label>
              <label class="setting-toggle">
                <span class="setting-toggle-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7h16l-1 13H5L4 7Z"/><path d="M9 7a3 3 0 0 1 6 0M8 12h8M10 15h4"/></svg></span>
                <span class="setting-toggle-label">Auto sell ao chegar na loja</span>
                <input class="hunt-auto-sell" type="checkbox" aria-label="Auto sell ao chegar na loja">
                <span class="setting-switch" aria-hidden="true"></span>
              </label>
              <label class="setting-toggle">
                <span class="setting-toggle-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7h16l-1 13H5L4 7Z"/><path d="M9 7a3 3 0 0 1 6 0M8 12h8M10 15h4"/></svg></span>
                <span class="setting-toggle-label">Refill após a venda</span>
                <input class="refill-after-sale" type="checkbox" aria-label="Ir ao refill após a venda">
                <span class="setting-switch" aria-hidden="true"></span>
              </label>
              <p class="hint hunt-return-position" role="status"></p>
              <div class="hunt-lure">
                <label class="pref"><input class="waypoint-lure-toggle" type="checkbox"> Lure usando os waypoints</label>
                <label class="lure-count">Criaturas para puxar<input class="lure-count-input" type="number" min="1" max="50" step="1" value="5"></label>
                <div class="lure-settings">
                  <label>Passo do lure (tiles)<input class="lure-step-input" type="number" min="1" max="10" step="1" value="3"></label>
                </div>
              </div>
              <label class="attack-range">Tipo de ataque<select class="attack-range-select"><option value="1">Cavaleiro — corpo a corpo (1 tile)</option><option value="4">Mage/Pala — à distância (até 4 tiles)</option></select></label>
              <label class="pref"><input class="lure-special-toggle" type="checkbox"> Usar habilidade especial ao atacar</label>
              <div class="lure-status-card" data-active="false" role="status" aria-live="polite">
                <div class="lure-status-head"><span class="lure-status-dot"></span><span class="lure-status-title">Lure desligado</span><span class="lure-count-display">0/5</span></div>
                <div class="lure-progress-track"><div class="lure-progress-fill"></div></div>
                <p class="hunt-status lure-route-status">Lure desligado</p>
              </div>
            </div>
          </section>
          <section class="page" data-section="focus" hidden>
            <h2>Focar</h2>
            <p class="hint">Controla o target selecionado no jogo e segue até o alcance de ataque de 4 tiles, separado do sistema de caça.</p>
            <div class="hunt">
              <button class="hunt-toggle focus-toggle" type="button">Iniciar Focar</button>
              <label class="setting-toggle">
                <span class="setting-toggle-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3v3M5.6 5.6l2.1 2.1M3 12h3M18 12h3M16.3 7.7l2.1-2.1M8 13.5l3 7 2-4 4-2-7-3Z"/></svg></span>
                <span class="setting-toggle-label">Usar ataque de habilidade</span>
                <input class="focus-skill-toggle" type="checkbox" aria-label="Usar ataque de habilidade ao focar">
                <span class="setting-switch" aria-hidden="true"></span>
              </label>
              <label class="setting-toggle">
                <span class="setting-toggle-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="10" cy="8" r="3"/><path d="M4 20c.5-4 2.5-6 6-6s5.5 2 6 6M17 8h4m-2-2 2 2-2 2"/></svg></span>
                <span class="setting-toggle-label">Seguir target</span>
                <input class="focus-follow-toggle" type="checkbox" aria-label="Seguir o target selecionado">
                <span class="setting-switch" aria-hidden="true"></span>
              </label>
              <p class="hint focus-status" role="status" aria-live="polite">Focar desligado</p>
            </div>
          </section>
          <section class="page" data-section="refill" hidden>
            <h2>Loja e refill</h2>
            <div class="destination-settings"></div>
            <div class="resource-summary" aria-live="polite">
              <div class="resource-card" data-kind="arrows">
                <span class="resource-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 20 18 6M13 5l6 1-1 6M4 20l1-5 5 5"/><path d="m7 16 2 2"/></svg></span>
                <span class="resource-copy"><span class="resource-label">Flechas</span><strong class="resource-value arrows-count">—</strong><small class="resource-note arrows-id">ID —</small></span>
              </div>
              <div class="resource-card" data-kind="hp">
                <span class="resource-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 3h6M10 3v4l-4 4v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8l-4-4V3"/><path d="M7 13h10M10 16h4"/></svg></span>
                <span class="resource-copy"><span class="resource-label">Poções HP</span><strong class="resource-value hp-potions-count">—</strong><small class="resource-note hp-potion-id">ID —</small></span>
              </div>
              <div class="resource-card" data-kind="mp">
                <span class="resource-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 3h6M10 3v4l-4 4v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8l-4-4V3"/><path d="M12 11v7M9 14h6"/></svg></span>
                <span class="resource-copy"><span class="resource-label">Poções MP</span><strong class="resource-value mp-potions-count">—</strong><small class="resource-note mp-potion-id">ID —</small></span>
              </div>
            </div>
            <div class="refill-action-row">
              <button class="refill-action refill-test" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 5l7 7-7 7"/></svg>Refill</button>
              <p class="hint refill-status" role="status">Pronto</p>
            </div>
            <div class="refill-items">
              <div class="refill-item-controls">
                <select class="refill-item-select" aria-label="Item"><option value="">Selecione um item</option></select>
                <label>Estoque desejado<input class="refill-item-quantity" type="number" min="1" max="1000000" step="1" value="100"></label>
                <button class="refill-item-add" type="button"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>Adicionar</button>
              </div>
              <div class="refill-item-list" aria-live="polite"></div>
            </div>
            <div class="loot-picker">
              <div class="loot-picker-head"><span>Itens para venda automática</span><span class="loot-picker-actions"><button class="loot-select-all" type="button">Todos</button><button class="loot-select-none" type="button">Limpar</button></span></div>
              <div class="loot-item-list" aria-live="polite"></div>
            </div>
            <p class="hint loot-assets-status" role="status"></p>
          </section>
          <section class="page" data-section="targets" hidden>
            <h2>Alvos</h2>
            <input class="target-search" type="search" placeholder="Filtrar criaturas…" aria-label="Filtrar criaturas">
            <div class="target-tools"><button class="targets-all">Ativar todos</button><button class="targets-none">Desativar todos</button></div>
            <div class="target-list" aria-live="polite"></div>
          </section>
          <section class="page" data-section="waypoints" hidden>
            <h2>Waypoints</h2>
            <label class="pref"><input class="waypoint-patrol-toggle" type="checkbox"> Percorrer quando não houver alvos</label>
            <div class="fields waypoint-fields">
              <label>Tile X<input class="waypoint-x" type="number" step="1"></label>
              <label>Tile Y<input class="waypoint-y" type="number" step="1"></label>
            </div>
            <div class="waypoint-actions">
              <button class="waypoint-add">Adicionar coordenadas</button>
              <button class="waypoint-current">Adicionar posição atual</button>
            </div>
            <div class="waypoint-actions waypoint-file-actions">
              <button class="waypoint-export" type="button">Exportar waypoints</button>
              <button class="waypoint-import" type="button">Importar JSON</button>
            </div>
            <input class="waypoint-file" type="file" accept="application/json,.json" hidden>
            <p class="result waypoint-result" role="status"></p>
            <div class="waypoint-list" aria-live="polite"></div>
          </section>
          <section class="page" data-section="clone" hidden>
            <h2>Clone</h2>
            <p class="hint">Exporte ou importe as configurações salvas do mod, incluindo waypoints, alvos, caça, loot, refill e automações.</p>
            <div class="waypoint-actions">
              <button class="config-export" type="button">Exportar configuração</button>
              <button class="config-import" type="button">Importar configuração</button>
            </div>
            <input class="config-file" type="file" accept="application/json,.json" hidden>
            <p class="result config-result" role="status"></p>
          </section>
          <section class="page" data-section="automation" hidden>
            <h2>Automações</h2>
            <div class="prefs">
              <strong>Poções</strong>
              <div class="automation">
                <label class="automation-title"><input class="auto-heal" type="checkbox"> Auto heal (HP)</label>
                <label><input class="hp-threshold threshold" type="number" min="5" max="95" step="5" aria-label="Usar poção de vida abaixo de porcentagem">%</label>
              </div>
              <div class="automation">
                <label class="automation-title"><input class="auto-mana" type="checkbox"> Auto mana (MP)</label>
                <label><input class="mp-threshold threshold" type="number" min="5" max="95" step="5" aria-label="Usar poção de mana abaixo de porcentagem">%</label>
              </div>
              <label class="pref"><input class="auto-switch-server" type="checkbox"> Trocar de servidor após morrer ou finalizar o refill</label>
              <p class="hint">Usa servidores das Américas do Norte e do Sul antes de retornar à caça.</p>
              <label class="pref"><input class="auto-reconnect" type="checkbox"> Reconectar automaticamente</label>
              <label class="pref"><input class="auto-refresh" type="checkbox"> Atualizar estado automaticamente</label>
            </div>
          </section>
          <section class="page" data-section="console" hidden>
            <h2>Console</h2>
            <div class="console-toolbar"><span>Histórico de bot e WebSocket (até 1.000 registros cada)</span><span class="console-actions"><button class="console-export" type="button">Exportar logs</button><button class="console-clear" type="button">Limpar</button></span></div>
            <div class="console-list" aria-live="polite"></div>
          </section>
        </div>
      </div>
    </section>
    </div>
  `;

  const backdrop = root.querySelector(".backdrop");
  for (const [kind, title] of [["shop", "Loja de venda"], ["refill", "Refill de suprimentos"]]) {
    const form = document.createElement("form");
    form.className = "destination-form";
    form.innerHTML = `<h3>${title}</h3>
      <div class="destination-fields">
        <label>Tile X<input name="x" type="number" min="0" max="100000" step="1" required></label>
        <label>Tile Y<input name="y" type="number" min="0" max="100000" step="1" required></label>
        <label>Andar<input name="floor" type="number" min="0" max="20" step="1" required></label>
      </div>
      <div class="waypoint-actions"><button type="submit">Salvar coordenadas</button><button type="button" class="destination-current">Usar posição atual</button></div>
      <p class="result" role="status"></p>`;
    const status = form.querySelector(".result");
    const setFields = point => {
      for (const key of ["x", "y", "floor"]) form.elements.namedItem(key).value = point?.[key] ?? "";
    };
    setFields(kind === "shop" ? window.mod?.shopDestination : window.mod?.refill);
    form.querySelector(".destination-current").addEventListener("click", () => {
      const me = window.mod?.myself;
      if (![me?.x, me?.y, me?.floor].every(Number.isInteger)) {
        status.textContent = "Aguardando a posição do personagem.";
        return;
      }
      setFields(me);
      status.textContent = "Posição preenchida. Clique em Salvar coordenadas.";
    });
    form.addEventListener("submit", event => {
      event.preventDefault();
      const point = Object.fromEntries(["x", "y", "floor"].map(key => [key, Number(form.elements.namedItem(key).value)]));
      const result = kind === "shop" ? window.mod?.configureShop?.(point) : window.mod?.configureRefill?.(point);
      status.textContent = result?.ok
        ? `${title}: (${result.x}, ${result.y}), andar ${result.floor}. Salvo.`
        : result?.error ?? "Configuração indisponível.";
    });
    root.querySelector(".destination-settings").append(form);
  }

  root.querySelector(".panel").addEventListener("copy", event => {
    const target = root.activeElement;
    if (target?.matches("input, textarea") || target?.isContentEditable) return;
    event.preventDefault();
  });
  const creatureList = root.querySelector(".creature-list");
  const creatureRadius = root.querySelector(".creature-radius");
  const targetList = root.querySelector(".target-list");
  const targetSearch = root.querySelector(".target-search");
  const waypointList = root.querySelector(".waypoint-list");
  const waypointFile = root.querySelector(".waypoint-file");
  const configFile = root.querySelector(".config-file");
  const configResult = root.querySelector(".config-result");
  const waypointPatrolToggle = root.querySelector(".waypoint-patrol-toggle");
  const waypointLureToggle = root.querySelector(".waypoint-lure-toggle");
  const lureCountInput = root.querySelector(".lure-count-input");
  const lureStepInput = root.querySelector(".lure-step-input");
  const attackRangeSelect = root.querySelector(".attack-range-select");
  const lureSpecialToggle = root.querySelector(".lure-special-toggle");
  const waypointResult = root.querySelector(".waypoint-result");
  const huntAttackAny = root.querySelector(".hunt-attack-any");
  const huntAutoSell = root.querySelector(".hunt-auto-sell");
  const refillAfterSale = root.querySelector(".refill-after-sale");
  const refillTest = root.querySelector(".refill-test");
  const refillStatus = root.querySelector(".refill-status");
  const refillItemSelect = root.querySelector(".refill-item-select");
  const refillItemQuantity = root.querySelector(".refill-item-quantity");
  const refillItemAdd = root.querySelector(".refill-item-add");
  const refillItemList = root.querySelector(".refill-item-list");
  const lootItemList = root.querySelector(".loot-item-list");
  const huntToggle = root.querySelector(".hunt-toggle");
  const focusToggle = root.querySelector(".focus-toggle");
  const focusSkillToggle = root.querySelector(".focus-skill-toggle");
  const focusFollowToggle = root.querySelector(".focus-follow-toggle");
  const focusStatus = root.querySelector(".focus-status");
  const huntStatus = root.querySelector(".hunt-status");
  const lureStatusCard = root.querySelector(".lure-status-card");
  const lureStatusTitle = root.querySelector(".lure-status-title");
  const lureCountDisplay = root.querySelector(".lure-count-display");
  const lureProgressFill = root.querySelector(".lure-progress-fill");
  const lootAssetsStatus = root.querySelector(".loot-assets-status");
  const autoRefresh = root.querySelector(".auto-refresh");
  const autoHeal = root.querySelector(".auto-heal");
  const autoMana = root.querySelector(".auto-mana");
  const autoSwitchServer = root.querySelector(".auto-switch-server");
  const autoReconnect = root.querySelector(".auto-reconnect");
  const hpThreshold = root.querySelector(".hp-threshold");
  const mpThreshold = root.querySelector(".mp-threshold");
  const sideLinks = [...root.querySelectorAll(".side-link")];
  const pages = [...root.querySelectorAll(".page")];
  const consoleList = root.querySelector(".console-list");
  const consoleClear = root.querySelector(".console-clear");
  const consoleExport = root.querySelector(".console-export");
  const arrowsCount = root.querySelector(".arrows-count");
  const hpPotionsCount = root.querySelector(".hp-potions-count");
  const mpPotionsCount = root.querySelector(".mp-potions-count");
  const arrowsId = root.querySelector(".arrows-id");
  const hpPotionId = root.querySelector(".hp-potion-id");
  const mpPotionId = root.querySelector(".mp-potion-id");
  const preferenceKey = "fantasy-mod-panel-auto-refresh";
  try { autoRefresh.checked = localStorage.getItem(preferenceKey) !== "false"; } catch { autoRefresh.checked = true; }
  const readPreference = (key, fallback) => { try { const value = localStorage.getItem(`fantasy-mod-${key}`); return value == null ? fallback : value; } catch { return fallback; } };
  const savePreference = (key, value) => { try { localStorage.setItem(`fantasy-mod-${key}`, String(value)); } catch {} };
  autoHeal.checked = readPreference("auto-heal", "false") === "true";
  autoMana.checked = readPreference("auto-mana", "false") === "true";
  autoSwitchServer.checked = readPreference("auto-switch-server", "true") === "true";
  autoReconnect.checked = readPreference("auto-reconnect", "false") === "true";
  hpThreshold.value = readPreference("heal-threshold", "50");
  mpThreshold.value = readPreference("mana-threshold", "30");
  huntAutoSell.checked = !!window.mod?.hunt?.autoSell;
  refillAfterSale.checked = !!window.mod?.hunt?.refillAfterSale;
  focusSkillToggle.checked = !!window.mod?.focus?.useSkill;
  focusFollowToggle.checked = window.mod?.focus?.followTarget !== false;
  focusStatus.textContent = window.mod?.focus?.status ?? "Focar desligado";
  const setRefillStatus = value => {
    const detail = String(value ?? "Pronto");
    const state = /erro|falha|não encontrado|indisponível/i.test(detail) ? "error"
      : /estoque.*atingido|concluíd|enviadas/i.test(detail) ? "complete"
      : /preparando|indo para|voltando|procurando|abrindo|comprando|na fila|viagem iniciada|travel iniciado|aguardando conexão/i.test(detail) ? "loading" : "ready";
    refillStatus.dataset.state = state;
    refillStatus.textContent = state === "loading" ? "Carregando" : state === "complete" ? "Completo" : state === "error" ? "Erro" : "Pronto";
    refillStatus.title = detail;
  };
  setRefillStatus(window.mod?.refill?.status ?? "Pronto");
  waypointPatrolToggle.checked = !!window.mod?.hunt?.waypointsEnabled;
  waypointLureToggle.checked = !!window.mod?.hunt?.lureEnabled;
  lureCountInput.value = String(window.mod?.hunt?.lureCount ?? 5);
  lureStepInput.value = String(window.mod?.hunt?.lureStepTiles ?? 3);
  attackRangeSelect.value = String(window.mod?.hunt?.attackRange ?? 1);
  lureSpecialToggle.checked = !!window.mod?.hunt?.useSpecial;
  const setPage = name => {
    if (!pages.some(page => page.dataset.section === name)) name = pages[0]?.dataset.section ?? "creatures";
    for (const page of pages) page.hidden = page.dataset.section !== name;
    for (const link of sideLinks) link.dataset.active = String(link.dataset.page === name);
    try { localStorage.setItem("fantasy-mod-panel-page", name); } catch {}
    if (name === "console") showConsole();
  };
  let initialPage = "creatures";
  try { initialPage = localStorage.getItem("fantasy-mod-panel-page") ?? initialPage; } catch {}
  setPage(initialPage);
  for (const link of sideLinks) link.addEventListener("click", () => setPage(link.dataset.page));
  consoleClear.addEventListener("click", () => {
    window.__fantasyModConsole?.splice(0);
    showConsole();
  });
  consoleExport.addEventListener("click", () => {
    const botLogs = (window.__fantasyModConsole ?? []).slice(-1000);
    const wsLogs = (window.__gameMonitor?.latest?.(1000)
      ?? window.__gameMonitor?.packets?.slice(-1000)
      ?? []).slice(-1000);
    const redactSecrets = (value, key = "") => {
      if (/^(token|pass(word)?|credential|captcha|authorization|cookie|session)$/i.test(key)) return "[REDACTED]";
      if (Array.isArray(value)) return value.map(item => redactSecrets(item));
      if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactSecrets(childValue, childKey)]));
      }
      return value;
    };
    const exportData = {
      exportedAt: new Date().toISOString(),
      counts: { bot: botLogs.length, websocket: wsLogs.length },
      bot: redactSecrets(botLogs),
      websocket: redactSecrets(wsLogs)
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fantasy-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  window.addEventListener("__fantasy_mod_console_update", () => {
    if (!backdrop.hidden && root.querySelector('[data-section="console"]')?.hidden === false) showConsole();
  });

  function showConsole() {
    const entries = window.__fantasyModConsole ?? [];
    const signature = entries.map(entry => entry.id).join(",");
    if (consoleList.dataset.signature === signature) return;
    consoleList.dataset.signature = signature;
    consoleList.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "empty-creatures";
      empty.textContent = "Nenhum erro ou diagnóstico registrado.";
      consoleList.append(empty);
      return;
    }
    for (const entry of entries.slice(-200)) {
      const row = document.createElement("div");
      row.className = "console-entry";
      row.dataset.level = entry.level ?? "info";
      const time = new Date(entry.at).toLocaleTimeString();
      row.textContent = `[${time}] ${String(entry.level ?? "info").toUpperCase()} ${entry.message}`;
      consoleList.append(row);
    }
    consoleList.scrollTop = consoleList.scrollHeight;
  }

  function showResourceCounts() {
    const me = window.mod?.myself;
    const display = value => Number.isFinite(Number(value)) && value != null ? Number(value).toLocaleString() : "—";
    arrowsCount.textContent = display(me?.arrows);
    hpPotionsCount.textContent = display(me?.potionCounts?.hp?.count);
    mpPotionsCount.textContent = display(me?.potionCounts?.mp?.count);
    arrowsId.textContent = `ID ${display(me?.arrowItemId)}`;
    hpPotionId.textContent = `ID ${display(me?.potionCounts?.hp?.id)}`;
    mpPotionId.textContent = `ID ${display(me?.potionCounts?.mp?.id)}`;
  }

  let editingRefillId = null;
  function renderRefillItems() {
    // Stock updates must not replace the input or interrupt typing.
    if (editingRefillId !== null) return;
    const offers = window.mod?.refill?.shopItems ?? [];
    const configured = window.mod?.refill?.items ?? [];
    const signature = JSON.stringify({ offers, configured, stocks: configured.map(item => currentRefillStock(item.id)) });
    if (refillItemList.dataset.signature === signature) return;
    refillItemList.dataset.signature = signature;
    const previous = refillItemSelect.value;
    refillItemSelect.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = offers.length ? "Selecione um item" : "Itens indisponíveis";
    refillItemSelect.append(placeholder);
    for (const offer of offers) {
      if (offers.some(existing => String(existing.id) === String(offer.id)
        && offers.indexOf(existing) < offers.indexOf(offer))) continue;
      const option = document.createElement("option");
      option.value = String(offer.id);
      option.textContent = `${offer.name} · ID ${offer.id}`;
      refillItemSelect.append(option);
    }
    if (offers.some(offer => String(offer.id) === previous)) refillItemSelect.value = previous;
    refillItemList.replaceChildren();
    if (!configured.length) {
      const empty = document.createElement("span");
      empty.className = "empty-creatures";
      empty.textContent = "Nenhum item configurado.";
      refillItemList.append(empty);
      return;
    }
    configured.forEach(item => {
      const row = document.createElement("div");
      row.className = "refill-item-row";
      const details = document.createElement("span");
      details.textContent = `${item.name} · ID ${item.id} · estoque ${currentRefillStock(item.id)} / ${Number(item.quantity).toLocaleString()}`;
      const actions = document.createElement("div");
      actions.className = "refill-item-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "Editar";
      edit.setAttribute("aria-label", `Editar estoque de ${item.name}`);
      edit.addEventListener("click", () => {
        if (editingRefillId !== null) return;
        editingRefillId = String(item.id);
        const editor = document.createElement("form");
        editor.className = "refill-item-editor";
        const label = document.createElement("label");
        label.textContent = "Estoque desejado";
        const quantity = document.createElement("input");
        quantity.type = "number";
        quantity.min = "1";
        quantity.max = "1000000";
        quantity.step = "1";
        quantity.required = true;
        quantity.value = String(item.quantity);
        label.append(quantity);
        const save = document.createElement("button");
        save.type = "submit";
        save.textContent = "Salvar";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = "Cancelar";
        const finishEditing = () => {
          editingRefillId = null;
          refillItemList.dataset.signature = "";
          renderRefillItems();
        };
        cancel.addEventListener("click", finishEditing);
        editor.addEventListener("submit", event => {
          event.preventDefault();
          const items = window.mod?.refill?.items ?? [];
          if (!items.some(entry => String(entry.id) === editingRefillId)) {
            setRefillStatus("Este item não está mais na lista de refill.");
            finishEditing();
            return;
          }
          if (saveRefillItemList(items.map(entry => String(entry.id) === editingRefillId
            ? { ...entry, quantity: Number(quantity.value) } : entry))) finishEditing();
        });
        editor.append(label, save, cancel);
        row.replaceChildren(details, editor);
        quantity.focus();
        quantity.select();
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remover";
      remove.addEventListener("click", () => {
        saveRefillItemList((window.mod?.refill?.items ?? []).filter(entry => String(entry.id) !== String(item.id)));
      });
      actions.append(edit, remove);
      row.append(details, actions);
      refillItemList.append(row);
    });
  }

  function currentRefillStock(itemId) {
    const me = window.mod?.myself;
    if (String(itemId) === "3") return me?.arrows != null && Number.isFinite(Number(me.arrows)) ? Number(me.arrows).toLocaleString() : "—";
    const potionStock = me?.potions?.[String(itemId)];
    if (potionStock != null && Number.isFinite(Number(potionStock))) return Number(potionStock).toLocaleString();
    const inventory = window.mod?.inventory;
    if (!inventory?.known) return "—";
    const count = (inventory.bag ?? []).reduce((total, entry) => {
      const id = Array.isArray(entry) ? entry[0] : entry;
      const quantity = Array.isArray(entry) ? Number(entry[1]) || 1 : 1;
      return String(id) === String(itemId) ? total + quantity : total;
    }, 0);
    return count.toLocaleString();
  }

  function saveRefillItemList(items) {
    const outcome = window.mod?.setRefillItems?.(items);
    if (!outcome?.ok) {
      setRefillStatus(outcome?.error ?? "API de itens do refill indisponível.");
      return false;
    }
    setRefillStatus("Estoque desejado salvo; a compra será calculada na próxima visita.");
    renderRefillItems();
    return true;
  }

  const open = () => { backdrop.hidden = false; refresh(true); };
  const close = () => { backdrop.hidden = true; };
  root.querySelector(".close").addEventListener("click", close);
  backdrop.addEventListener("click", event => { if (event.target === backdrop) close(); });
  const persistAutomation = () => {
    savePreference("auto-heal", autoHeal.checked);
    savePreference("auto-mana", autoMana.checked);
    savePreference("heal-threshold", hpThreshold.value);
    savePreference("mana-threshold", mpThreshold.value);
  };
  autoHeal.addEventListener("change", persistAutomation);
  autoMana.addEventListener("change", persistAutomation);
  autoSwitchServer.addEventListener("change", () => savePreference("auto-switch-server", autoSwitchServer.checked));
  autoReconnect.addEventListener("change", () => savePreference("auto-reconnect", autoReconnect.checked));
  hpThreshold.addEventListener("change", () => { hpThreshold.value = String(Math.max(5, Math.min(95, Number(hpThreshold.value) || 50))); persistAutomation(); });
  mpThreshold.addEventListener("change", () => { mpThreshold.value = String(Math.max(5, Math.min(95, Number(mpThreshold.value) || 30))); persistAutomation(); });
  autoRefresh.addEventListener("change", () => {
    try { localStorage.setItem(preferenceKey, String(autoRefresh.checked)); } catch {}
    refresh(true);
  });
  huntAutoSell.addEventListener("change", () => {
    if (window.mod?.hunt) window.mod.hunt.autoSell = huntAutoSell.checked;
    try { localStorage.setItem("fantasy-mod-auto-sell", String(huntAutoSell.checked)); } catch {}
    if (huntAutoSell.checked) window.mod?.log?.("info", "Auto sell ativado; itens selecionados em Loja / Refill serão vendidos na loja.");
  });
  refillAfterSale.addEventListener("change", () => {
    if (window.mod?.hunt) window.mod.hunt.refillAfterSale = refillAfterSale.checked;
    savePreference("refill-after-sale", refillAfterSale.checked);
  });
  refillTest.addEventListener("click", () => {
    const outcome = window.mod?.testRefill?.();
    setRefillStatus(outcome?.ok
      ? `Travel iniciado para ${outcome.target.x}, ${outcome.target.y}; buscando NPCs.`
      : outcome?.error ?? "Não foi possível iniciar o teste.");
  });
  refillItemAdd.addEventListener("click", () => {
    const id = refillItemSelect.value;
    const offer = (window.mod?.refill?.shopItems ?? []).find(item => String(item.id) === id);
    if (!offer) {
      setRefillStatus("Itens indisponíveis");
      return;
    }
    const quantity = Number(refillItemQuantity.value);
    const items = [...(window.mod?.refill?.items ?? []).filter(item => String(item.id) !== id), {
      id, name: offer.name, quantity
    }];
    saveRefillItemList(items);
  });
  root.querySelector(".loot-select-all").addEventListener("click", () => {
    window.mod?.setLootItemsEnabled?.(true);
    showLootItems();
  });
  root.querySelector(".loot-select-none").addEventListener("click", () => {
    window.mod?.setLootItemsEnabled?.(false);
    showLootItems();
  });
  waypointPatrolToggle.addEventListener("change", () => {
    const outcome = window.mod?.setWaypointPatrol?.(waypointPatrolToggle.checked);
    if (!outcome?.ok) waypointResult.textContent = "API de waypoints indisponível.";
    showWaypoints();
  });
  root.querySelector(".waypoint-export").addEventListener("click", () => {
    const waypoints = window.mod?.waypoints ?? [];
    const blob = new Blob([JSON.stringify({ version: 1, waypoints }, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "fantasy-waypoints.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    waypointResult.textContent = `${waypoints.length} waypoint(s) exportado(s).`;
  });
  root.querySelector(".waypoint-import").addEventListener("click", () => waypointFile.click());
  waypointFile.addEventListener("change", async () => {
    const file = waypointFile.files?.[0];
    waypointFile.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const waypoints = Array.isArray(data) ? data : data?.waypoints;
      if (!Array.isArray(waypoints) || waypoints.length > 1000
        || waypoints.some(point => !Number.isInteger(point?.x)
          || !Number.isInteger(point?.y) || !Number.isInteger(point?.floor))) {
        throw new Error("O arquivo deve conter uma lista de waypoints com X, Y e andar inteiros (máximo de 1000).");
      }
      const clear = window.mod?.clearWaypoints?.();
      if (!clear?.ok) throw new Error("API de waypoints indisponível.");
      for (const point of waypoints) {
        const added = window.mod?.addWaypoint?.(point.x, point.y, point.floor);
        if (!added?.ok) throw new Error(added?.error ?? "Falha ao importar waypoint.");
      }
      waypointList.dataset.signature = "";
      showWaypoints();
      waypointResult.textContent = `${waypoints.length} waypoint(s) importado(s).`;
    } catch (error) {
      waypointResult.textContent = `Falha ao importar: ${error?.message ?? error}`;
    }
  });
  root.querySelector(".config-export").addEventListener("click", () => {
    const config = {};
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith("fantasy-mod-")) config[key] = localStorage.getItem(key);
    }
    const blob = new Blob([JSON.stringify({ format: "fantasy-mod-config", version: 1, config }, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "fantasy-mod-config.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    configResult.textContent = `${Object.keys(config).length} configuração(ões) exportada(s).`;
  });
  root.querySelector(".config-import").addEventListener("click", () => configFile.click());
  configFile.addEventListener("change", async () => {
    const file = configFile.files?.[0];
    configFile.value = "";
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("O arquivo excede o limite de 2 MB.");
      const data = JSON.parse(await file.text());
      const config = data?.format === "fantasy-mod-config" && data?.version === 1 ? data.config : null;
      if (!config || typeof config !== "object" || Array.isArray(config)
        || Object.keys(config).length > 100
        || Object.entries(config).some(([key, value]) => !/^fantasy-mod-[a-z0-9-]+$/.test(key)
          || typeof value !== "string")) {
        throw new Error("Arquivo de configuração inválido.");
      }
      const existingKeys = [];
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key?.startsWith("fantasy-mod-")) existingKeys.push(key);
      }
      existingKeys.forEach(key => localStorage.removeItem(key));
      for (const [key, value] of Object.entries(config)) localStorage.setItem(key, value);
      configResult.textContent = "Configuração importada. Recarregando o jogo para aplicar…";
      setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      configResult.textContent = `Falha ao importar: ${error?.message ?? error}`;
    }
  });
  waypointLureToggle.addEventListener("change", () => {
    const outcome = window.mod?.setLureEnabled?.(waypointLureToggle.checked);
    if (!outcome?.ok) {
      waypointLureToggle.checked = !!window.mod?.hunt?.lureEnabled;
      huntStatus.textContent = outcome?.error ?? "API de lure indisponível.";
    }
    syncHuntUI();
  });
  lureCountInput.addEventListener("change", () => {
    const outcome = window.mod?.setLureCount?.(Number(lureCountInput.value));
    if (outcome?.ok) {
      lureCountInput.value = String(outcome.count);
      huntStatus.textContent = `Lure configurado para reunir ${outcome.count} criatura(s).`;
    } else {
      lureCountInput.value = String(window.mod?.hunt?.lureCount ?? 5);
      huntStatus.textContent = outcome?.error ?? "API de lure indisponível.";
    }
  });
  const saveLureSettings = () => {
    const settings = {
      stepTiles: Number(lureStepInput.value),
    };
    const outcome = window.mod?.setLureSettings?.(settings);
    if (outcome?.ok) {
      lureStepInput.value = String(outcome.stepTiles);
      huntStatus.textContent = "Ritmo do lure atualizado.";
    } else {
      lureStepInput.value = String(window.mod?.hunt?.lureStepTiles ?? 3);
      huntStatus.textContent = outcome?.error ?? "API de configuração do lure indisponível.";
    }
  };
  lureStepInput.addEventListener("change", saveLureSettings);
  attackRangeSelect.addEventListener("change", () => {
    const outcome = window.mod?.setHuntAttackRange?.(Number(attackRangeSelect.value));
    if (!outcome?.ok) {
      attackRangeSelect.value = String(window.mod?.hunt?.attackRange ?? 1);
      huntStatus.textContent = outcome?.error ?? "API de alcance de ataque indisponível.";
    } else huntStatus.textContent = `Alcance de ataque: ${outcome.attackRange} tile(s).`;
  });
  lureSpecialToggle.addEventListener("change", () => {
    const outcome = window.mod?.setLureSpecial?.(lureSpecialToggle.checked);
    if (!outcome?.ok) {
      lureSpecialToggle.checked = !!window.mod?.hunt?.useSpecial;
      huntStatus.textContent = outcome?.error ?? "API de habilidade indisponível.";
    }
  });

  function refresh(force = false) {
    if (!autoRefresh.checked && !force) return;
    showCreatures();
    syncHuntUI();
    if (document.visibilityState !== "hidden" && window.mod?.refill?.status) {
      setRefillStatus(window.mod.refill.status);
    }
  }

  function syncHuntUI() {
    const hunt = window.mod?.hunt;
    const active = !!(hunt?.enabled || hunt?.resumeAfterReturn);
    const lureActive = !!hunt?.lureEnabled;
    waypointLureToggle.checked = lureActive;
    waypointPatrolToggle.checked = !!hunt?.waypointsEnabled;
    huntAttackAny.checked = !!hunt?.attackAny;
    huntToggle.textContent = active ? "Parar caça" : lureActive ? "Parar lure" : "Iniciar caça";
    huntToggle.dataset.active = String(active || lureActive);
    const focus = window.mod?.focus;
    focusToggle.textContent = focus?.enabled ? "Parar Focar" : "Iniciar Focar";
    focusToggle.dataset.active = String(!!focus?.enabled);
    focusSkillToggle.checked = !!focus?.useSkill;
    focusFollowToggle.checked = focus?.followTarget !== false;
    focusStatus.textContent = focus?.status ?? "Focar desligado";
    const progress = hunt?.lureProgress ?? { current: 0, target: hunt?.lureCount ?? 5 };
    const current = Math.max(0, Number(progress.current) || 0);
    const target = Math.max(1, Number(progress.target) || 5);
    lureStatusCard.dataset.active = String(lureActive);
    lureStatusTitle.textContent = !lureActive ? "Lure desligado"
      : current >= target ? "Meta atingida · puxando e atacando"
        : current > 0 ? "Puxando criaturas" : "Procurando criaturas";
    lureCountDisplay.textContent = `${current}/${target}`;
    lureProgressFill.style.width = `${Math.min(100, current / target * 100)}%`;
    huntStatus.textContent = hunt?.status ?? "Sistema de caça indisponível";
    const returnPosition = hunt?.returnPosition;
    root.querySelector(".hunt-return-position").textContent = returnPosition
      ? `Posição de retorno salva: ${returnPosition.x}, ${returnPosition.y} · andar ${returnPosition.floor}`
      : "A posição de retorno será salva quando a caça for à loja.";
    lootAssetsStatus.textContent = window.mod?.lootIconStatus ?? "Aguardando dados dos itens";
    showLootItems();
    if (!backdrop.hidden && root.querySelector('[data-section="targets"]')?.hidden === false) showTargets();
    if (!backdrop.hidden && root.querySelector('[data-section="waypoints"]')?.hidden === false) showWaypoints();
  }

  function showLootItems() {
    const catalog = window.mod?.lootCatalog ?? [];
    const selected = new Set((window.mod?.hunt?.lootItemIds ?? []).map(String));
    const signature = JSON.stringify([catalog, [...selected].sort()]);
    if (lootItemList.dataset.signature === signature) return;
    lootItemList.dataset.signature = signature;
    lootItemList.replaceChildren();
    if (!catalog.length) {
      const empty = document.createElement("p");
      empty.className = "loot-item-empty";
      empty.textContent = "Aguardando catálogo do jogo ou drops visíveis.";
      lootItemList.append(empty);
      return;
    }
    for (const item of catalog) {
      const label = document.createElement("label");
      label.className = "loot-item";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(String(item.id));
      checkbox.addEventListener("change", () => window.mod?.setLootItemEnabled?.(item.id, checkbox.checked));
      if (item.sprite) {
        const icon = document.createElement("img");
        icon.className = "loot-item-icon";
        icon.src = item.sprite;
        icon.alt = "";
        icon.width = 28;
        icon.height = 28;
        label.append(checkbox, icon);
      } else label.append(checkbox);
      const name = document.createElement("span");
      name.className = "loot-item-name";
      name.textContent = item.name;
      label.append(name);
      lootItemList.append(label);
    }
  }

  function showWaypoints() {
    const waypoints = window.mod?.waypoints ?? [];
    const signature = JSON.stringify(waypoints);
    if (waypointList.dataset.signature === signature) return;
    waypointList.dataset.signature = signature;
    waypointList.replaceChildren();
    if (!waypoints.length) {
      const empty = document.createElement("p");
      empty.className = "empty-creatures";
      empty.textContent = "Nenhum waypoint cadastrado.";
      waypointList.append(empty);
      return;
    }
    waypoints.forEach((point, index) => {
      const row = document.createElement("div");
      row.className = "waypoint-row";
      const details = document.createElement("div");
      const name = document.createElement("div");
      name.className = "waypoint-name";
      name.textContent = `${index + 1}. X ${point.x}, Y ${point.y}`;
      const floor = document.createElement("div");
      floor.className = "waypoint-floor";
      floor.textContent = `Andar ${point.floor}`;
      details.append(name, floor);
      const remove = document.createElement("button");
      remove.className = "waypoint-remove";
      remove.textContent = "Remover";
      remove.addEventListener("click", () => {
        window.mod?.removeWaypoint?.(index);
        waypointList.dataset.signature = "";
        showWaypoints();
      });
      row.append(details, remove);
      waypointList.append(row);
    });
  }

  function addWaypoint(x, y) {
    const me = window.mod?.myself;
    const outcome = window.mod?.addWaypoint?.(x, y, me?.floor);
    waypointResult.textContent = outcome?.ok
      ? `Waypoint adicionado: X ${x}, Y ${y} · andar ${me.floor}.`
      : outcome?.error ?? "API de waypoints indisponível.";
    waypointList.dataset.signature = "";
    showWaypoints();
  }

  function showTargets() {
    const catalog = window.mod?.monsterCatalog ?? [];
    const filter = targetSearch.value.trim().toLocaleLowerCase();
    const selected = window.mod?.targets ?? {};
    const signature = `${catalog.length}|${JSON.stringify(selected)}|${filter}`;
    if (targetList.dataset.signature === signature) return;
    targetList.dataset.signature = signature;
    targetList.replaceChildren();
    if (!catalog.length) {
      const empty = document.createElement("p");
      empty.className = "empty-creatures";
      empty.textContent = "Aguardando os dados e sprites das criaturas do jogo…";
      targetList.append(empty);
      return;
    }
    const visible = catalog.filter(creature => `${creature.name} ${creature.type}`.toLocaleLowerCase().includes(filter));
    for (const creature of visible) {
      const row = document.createElement("label");
      row.className = "target-row";
      if (creature.sprite) {
        const image = document.createElement("img");
        image.src = creature.sprite;
        image.alt = "";
        row.append(image);
      } else {
        const placeholder = document.createElement("span");
        placeholder.className = "target-placeholder";
        placeholder.textContent = "IMG";
        row.append(placeholder);
      }
      const details = document.createElement("span");
      const name = document.createElement("span");
      name.className = "target-name";
      name.textContent = creature.name;
      const type = document.createElement("span");
      type.className = "target-type";
      type.textContent = `Tipo ${creature.type}`;
      details.append(name, document.createElement("br"), type);
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = !!selected[String(creature.type)];
      toggle.setAttribute("aria-label", `Ativar ${creature.name} como alvo`);
      toggle.addEventListener("change", () => {
        window.mod?.setTargetEnabled?.(creature.type, toggle.checked);
        targetList.dataset.signature = "";
        showTargets();
      });
      row.append(details, toggle);
      targetList.append(row);
    }
    if (!visible.length) {
      const empty = document.createElement("p");
      empty.className = "empty-creatures";
      empty.textContent = "Nenhuma criatura corresponde ao filtro.";
      targetList.append(empty);
    }
  }

  function showCreatures() {
    const radius = Math.max(1, Math.min(100, Number(creatureRadius.value) || 10));
    creatureRadius.value = String(radius);
    const creatures = window.mod?.creaturesNearby?.(radius) ?? [];
    const selectedTargets = window.mod?.targets ?? {};
    const signature = `${JSON.stringify(creatures)}|${JSON.stringify(selectedTargets)}`;
    if (creatureList.dataset.signature === signature) return;
    creatureList.dataset.signature = signature;
    creatureList.replaceChildren();
    if (!creatures.length) {
      const empty = document.createElement("p");
      empty.className = "empty-creatures";
      empty.textContent = window.mod?.creatureSearchStatus ?? "Nenhuma criatura encontrada nesse raio.";
      creatureList.append(empty);
      return;
    }
    for (const creature of creatures) {
      const row = document.createElement("div");
      row.className = "creature";
      const details = document.createElement("div");
      const name = document.createElement("div");
      name.className = "creature-name";
      name.textContent = creature.name;
      const info = document.createElement("div");
      info.className = "creature-info";
      info.textContent = `X ${creature.x}, Y ${creature.y} · ${creature.distance} tiles${creature.hp == null ? "" : ` · HP ${creature.hp}`}`;
      details.append(name, info);
      const actions = document.createElement("div");
      actions.className = "creature-actions";
      const go = document.createElement("button");
      go.className = "go-creature";
      go.type = "button";
      go.textContent = "Ir";
      go.addEventListener("click", () => {
        const outcome = window.mod?.move?.(creature.x, creature.y);
        result.textContent = outcome?.ok ? `Indo até ${creature.name} (${outcome.steps} passos).` : outcome?.error ?? "Não foi possível iniciar o movimento.";
      });
      const target = document.createElement("button");
      target.type = "button";
      const isTarget = !!selectedTargets[String(creature.type)];
      target.className = `target-creature${isTarget ? " active" : ""}`;
      target.textContent = isTarget ? "Remover" : "Adicionar";
      target.setAttribute("aria-label", `${isTarget ? "Remover" : "Adicionar"} ${creature.name} ${isTarget ? "da" : "à"} lista de alvos`);
      target.addEventListener("click", () => {
        window.mod?.setTargetEnabled?.(creature.type, !isTarget);
        creatureList.dataset.signature = "";
        showCreatures();
      });
      actions.append(go, target);
      row.append(details, actions);
      creatureList.append(row);
    }
  }

  root.querySelector(".search").addEventListener("click", showCreatures);
  targetSearch.addEventListener("input", showTargets);
  root.querySelector(".targets-all").addEventListener("click", () => { window.mod?.setTargetsEnabled?.(true); targetList.dataset.signature = ""; showTargets(); });
  root.querySelector(".targets-none").addEventListener("click", () => { window.mod?.setTargetsEnabled?.(false); targetList.dataset.signature = ""; showTargets(); });
  root.querySelector(".waypoint-add").addEventListener("click", () => {
    const xValue = root.querySelector(".waypoint-x").value.trim();
    const yValue = root.querySelector(".waypoint-y").value.trim();
    addWaypoint(xValue ? Number(xValue) : NaN, yValue ? Number(yValue) : NaN);
  });
  root.querySelector(".waypoint-current").addEventListener("click", () => {
    const me = window.mod?.myself;
    if (!Number.isInteger(me?.x) || !Number.isInteger(me?.y)) {
      waypointResult.textContent = "Aguardando a posição do personagem.";
      return;
    }
    root.querySelector(".waypoint-x").value = String(me.x);
    root.querySelector(".waypoint-y").value = String(me.y);
    addWaypoint(me.x, me.y);
  });
  creatureRadius.addEventListener("change", showCreatures);
  huntAttackAny.addEventListener("change", () => {
    const outcome = window.mod?.setAttackAnyCreature?.(huntAttackAny.checked);
    if (!outcome?.ok) {
      huntAttackAny.checked = !!window.mod?.hunt?.attackAny;
      huntStatus.textContent = outcome?.error ?? "API para atacar qualquer criatura indisponível.";
    }
  });
  huntToggle.addEventListener("click", () => {
    if (window.mod?.hunt?.enabled || window.mod?.hunt?.lureEnabled || window.mod?.hunt?.resumeAfterReturn) window.mod.stopHunt();
    else {
      const types = Object.keys(window.mod?.targets ?? {}).filter(type => window.mod.targets[type]);
      const outcome = window.mod?.startHuntTargets?.(types, 11, true);
      if (!outcome?.ok) huntStatus.textContent = outcome?.error ?? "API de caça indisponível.";
    }
    syncHuntUI();
  });
  focusToggle.addEventListener("click", () => {
    const outcome = window.mod?.setFocusEnabled?.(!window.mod?.focus?.enabled);
    if (!outcome?.ok) focusStatus.textContent = outcome?.error ?? "API de Focar indisponível.";
    syncHuntUI();
  });
  focusSkillToggle.addEventListener("change", () => {
    const outcome = window.mod?.setFocusOption?.("useSkill", focusSkillToggle.checked);
    if (!outcome?.ok) {
      focusSkillToggle.checked = !!window.mod?.focus?.useSkill;
      focusStatus.textContent = outcome?.error ?? "Não foi possível salvar a opção de habilidade.";
    }
  });
  focusFollowToggle.addEventListener("change", () => {
    const outcome = window.mod?.setFocusOption?.("followTarget", focusFollowToggle.checked);
    if (!outcome?.ok) {
      focusFollowToggle.checked = window.mod?.focus?.followTarget !== false;
      focusStatus.textContent = outcome?.error ?? "Não foi possível salvar a opção de seguir target.";
    }
  });

  window.addEventListener("keydown", event => { if (event.key === "Escape" && !backdrop.hidden) close(); });

  document.documentElement.append(host);
  const topButton = document.createElement("a");
  topButton.href = "#";
  topButton.className = "b mod-button";
  topButton.title = "Preferências do Sentinela";
  topButton.setAttribute("aria-label", "Abrir preferências do Sentinela");
  topButton.innerHTML = '<span aria-hidden="true" style="font-size:calc(var(--px) * 10)">⚙</span><small>Robo</small>';
  topButton.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); open(); });
  const placeTopButton = () => {
    if (topButton.isConnected && topButton.parentElement?.matches("nav.topo")) return;
    const nav = document.querySelector(".hud nav.topo");
    if (!nav || topButton.parentElement === nav) return;
    const mapButton = nav.querySelector("a.bbutton_minimap");
    if (mapButton) mapButton.after(topButton);
    else nav.append(topButton);
  };
  const hudObserver = new MutationObserver(placeTopButton);
  hudObserver.observe(document.documentElement, { childList: true, subtree: true });
  placeTopButton();
  window.__fantasyModPanel = { open, close };
  setInterval(() => {
    if (!backdrop.hidden && autoRefresh.checked) refresh();
    if (!backdrop.hidden) showResourceCounts();
    if (!backdrop.hidden) renderRefillItems();
    if (!backdrop.hidden) syncHuntUI();
    if (!backdrop.hidden && root.querySelector('[data-section="console"]')?.hidden === false) showConsole();
    const me = window.mod?.myself;
    if (!me || !Number.isFinite(me.hp) || !Number.isFinite(me.maxHp) || !Number.isFinite(me.mp) || !Number.isFinite(me.maxMp)) return;
    const hpPct = me.maxHp > 0 ? me.hp / me.maxHp * 100 : 100;
    const mpPct = me.maxMp > 0 ? me.mp / me.maxMp * 100 : 100;
    const hpLimit = Math.max(5, Math.min(95, Number(hpThreshold.value) || 50));
    const mpLimit = Math.max(5, Math.min(95, Number(mpThreshold.value) || 30));
    if ((autoHeal.checked && hpPct <= hpLimit) || (autoMana.checked && mpPct <= mpLimit)) {
      const hpNeeded = autoHeal.checked && hpPct <= hpLimit;
      const mpNeeded = autoMana.checked && mpPct <= mpLimit;
      const kind = hpNeeded ? "hp" : "mp";
      window.mod?.potion?.(kind);
    }
  }, 700);
  };
  if (document.documentElement) install();
  else document.addEventListener("DOMContentLoaded", install, { once: true });
})();
