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
      .refill-item-controls > div { min-width:0; }
      .refill-item-controls label { min-width:0; color:var(--ui-2); font-size:10px; }
      .refill-item-controls select,.refill-item-controls input { width:100%; min-width:0; margin-top:3px; padding:7px; border:1px solid var(--luz); border-radius:0; background:var(--slot); color:var(--ui); }
      .refill-item-controls select { min-height:34px; }
      .refill-item-picker { min-width:0; border:1px solid var(--luz); background:var(--slot); }
      .refill-item-picker summary { display:flex; align-items:center; gap:7px; min-height:34px; padding:4px 7px; color:var(--ui); font-size:11px; cursor:pointer; list-style:none; }
      .refill-item-picker summary::-webkit-details-marker { display:none; }
      .refill-item-picker summary::after { margin-left:auto; color:var(--ui-2); content:"▾"; }
      .refill-item-picker[open] summary { border-bottom:1px solid var(--luz); }
      .refill-picker-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .refill-picker-menu { display:grid; max-height:180px; overflow:auto; }
      .refill-picker-option { display:flex; align-items:center; gap:7px; width:100%; min-width:0; padding:5px 7px; border:0; border-bottom:1px solid #57473566; background:var(--slot); color:var(--ui); text-align:left; font-size:11px; cursor:pointer; }
      .refill-picker-option:hover,.refill-picker-option:focus-visible { background:#46381a; outline:none; }
      .refill-picker-option[data-selected="true"] { color:var(--ouro-claro); }
      .refill-picker-option span:last-child { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .refill-picker-icon { display:grid; flex:0 0 28px; width:28px; height:28px; place-items:center; border:1px solid var(--luz); background:var(--poco); color:var(--ouro); font-size:15px; }
      .refill-picker-icon img { width:100%; height:100%; object-fit:contain; image-rendering:pixelated; }
      .refill-picker-empty { padding:8px; color:var(--ui-2); font-size:11px; }
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
      .city-route-card { display:grid; gap:10px; margin:0 0 18px; padding:12px; border:1px solid var(--luz); background:linear-gradient(145deg,#33291d,var(--slot) 75%); box-shadow:inset 0 1px #ffffff16,0 5px 14px #0005; }
      .city-route-card[data-mode="tp"] { border-color:var(--ouro-escuro); }
      .city-route-head { display:flex; align-items:center; gap:10px; }
      .city-route-icon { display:grid; flex:0 0 34px; width:34px; height:34px; place-items:center; border:1px solid var(--ouro-escuro); background:#46381a; color:var(--ouro-claro); }
      .city-route-icon svg { width:21px; height:21px; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
      .city-route-title { display:grid; gap:1px; color:var(--ui); font-size:13px; line-height:1.2; }
      .city-route-title small { color:var(--ui-2); font-size:10px; font-weight:500; }
      .city-tp-count { display:grid; flex:0 0 auto; min-width:55px; margin-left:auto; padding:4px 7px; border:1px solid var(--ouro-escuro); background:#46381a; color:var(--ouro-claro); text-align:center; line-height:1; }
      .city-tp-count strong { font-size:20px; font-variant-numeric:tabular-nums; }
      .city-tp-count small { margin-top:2px; color:var(--ui-2); font-size:8px; font-weight:700; letter-spacing:.04em; }
      .city-tp-count[data-empty="true"] { border-color:var(--luz); background:var(--poco); color:var(--ui-2); }
      .city-route-path { display:flex; align-items:center; gap:8px; color:var(--ouro); font-size:10px; font-weight:700; letter-spacing:.08em; }
      .city-route-path i { flex:1; height:1px; background:linear-gradient(90deg,var(--ouro),var(--luz)); }
      .city-route-fields { display:grid; gap:8px; }
      .city-route-fields label { display:grid; gap:4px; color:var(--ui-2); font-size:11px; }
      .city-route-fields select { width:100%; min-width:0; min-height:35px; padding:7px 9px; border:1px solid var(--luz); background:var(--poco); color:var(--ui); }
      .city-route-fields select:focus-visible { outline:2px solid var(--ouro); outline-offset:2px; }
      .city-route-fields select:disabled { opacity:.5; }
      .city-route-note { margin:0; padding:7px 8px; border-left:2px solid var(--ouro-escuro); background:#46381a66; color:var(--ui-2); font-size:10px; line-height:1.35; }
      .city-route-card[data-mode="walk"] .city-route-note { display:none; }
      .city-route-status { margin:0; color:var(--ui-2); font-size:10px; line-height:1.35; }
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
      .protected-sell-card { display:grid; gap:10px; margin-top:10px; padding:11px; border:1px solid var(--luz); background:linear-gradient(145deg,#352a1e,var(--slot)); }
      .protected-sell-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
      .protected-sell-head strong { color:var(--ouro-claro); font-size:13px; }
      .protected-sell-count { padding:3px 7px; border:1px solid var(--ouro-escuro); background:#46381a; color:var(--ouro-claro); font-size:10px; white-space:nowrap; }
      .protected-sell-card .hint { margin:0; line-height:1.4; }
      .protected-sell-list,.protected-inventory-list { display:grid; gap:5px; max-height:160px; overflow:auto; }
      .protected-item-row,.protected-inventory-row { display:grid; grid-template-columns:32px minmax(0,1fr) auto; align-items:center; gap:8px; min-height:40px; padding:5px 7px; border:1px solid var(--luz); background:var(--poco); }
      .protected-item-row { border-left:3px solid var(--verde); }
      .protected-item-icon { display:grid; place-items:center; width:32px; height:32px; border:1px solid var(--luz); background:var(--slot); color:var(--ouro); font-size:15px; }
      .protected-item-icon img { width:100%; height:100%; object-fit:contain; image-rendering:pixelated; }
      .protected-item-info { display:grid; min-width:0; line-height:1.2; }
      .protected-item-name { overflow:hidden; color:var(--ui); font-size:11px; font-weight:650; text-overflow:ellipsis; white-space:nowrap; }
      .protected-item-meta { color:var(--ui-2); font-size:9px; }
      .protected-item-action { padding:5px 7px; border:1px solid var(--luz); background:#3d3328; color:var(--ui); font-size:10px; cursor:pointer; }
      .protected-item-action:hover { border-color:var(--ouro); color:var(--ouro-claro); }
      .protected-item-action.remove:hover { border-color:var(--vermelho); color:var(--vermelho); }
      .protected-inventory { padding-top:9px; border-top:1px solid var(--luz); }
      .protected-inventory-title { display:block; margin-bottom:6px; color:var(--ui); font-size:11px; font-weight:700; }
      .protected-inventory-list { max-height:145px; }
      .waypoint-actions { display:grid; grid-template-columns:1fr 1fr; gap:7px; margin-top:8px; }
      .waypoint-actions button,.waypoint-remove { padding:7px 8px; border:1px solid var(--luz); border-radius:0; background:#3d3328; color:var(--ui); cursor:pointer; }
      .waypoint-reverse-card { margin-top:8px; padding:10px; border:1px solid var(--luz); background:var(--painel); }
      .waypoint-reverse-head { display:flex; align-items:center; gap:8px; color:var(--ui); font-size:12px; font-weight:650; }
      .waypoint-reverse-icon { display:grid; place-items:center; width:26px; height:26px; flex:none; border:1px solid var(--luz); background:var(--slot); color:var(--ouro); font-size:17px; }
      .waypoint-reverse-card .pref { margin:9px 0 0; background:var(--slot); }
      .waypoint-reverse-settings { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:9px; color:var(--ui-2); font-size:11px; }
      .waypoint-reverse-settings input { width:76px; flex:none; margin:0; }
      .waypoint-reverse-card .hint { margin-top:8px; line-height:1.4; }
      .waypoint-list { display:grid; gap:6px; max-height:210px; overflow:auto; margin-top:10px; }
      .waypoint-row { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:center; padding:7px 8px; border:1px solid var(--luz); border-radius:0; background:var(--slot); }
      .waypoint-map-dialog { position:fixed; inset:0; z-index:2; display:grid; place-items:center; padding:12px; background:#070503d9; pointer-events:auto; }
      .waypoint-map-dialog[hidden] { display:none; }
      .waypoint-map-shell { display:flex; flex-direction:column; width:min(1000px,96vw); height:min(760px,94vh); min-height:300px; padding:12px; border:1px solid var(--luz); background:var(--painel); box-shadow:0 20px 65px #000c; }
      .waypoint-map-head,.waypoint-map-tools { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; }
      .waypoint-map-head { margin-bottom:9px; }
      .waypoint-map-head strong { color:var(--ouro-claro); font-size:16px; }
      .waypoint-map-tools { justify-content:flex-start; margin-bottom:8px; }
      .waypoint-map-tools label { display:flex; align-items:center; gap:5px; color:var(--ui-2); font-size:11px; }
      .waypoint-map-tools select,.waypoint-map-tools button,.waypoint-map-head button { min-height:30px; padding:4px 9px; border:1px solid var(--luz); background:var(--slot); color:var(--ui); cursor:pointer; }
      .waypoint-map-tools button:hover,.waypoint-map-head button:hover { border-color:var(--ouro); }
      .waypoint-map-canvas { display:block; flex:1; min-height:0; width:100%; border:1px solid var(--luz); background:var(--slot); cursor:crosshair; touch-action:none; }
      .waypoint-map-canvas[data-dragging="true"] { cursor:grabbing; }
      .waypoint-map-status { min-height:18px; margin:8px 0 0; color:var(--ui-2); font-size:11px; }
      .waypoint-name { color:var(--ui); font-weight:600; }
      .waypoint-floor { color:var(--ui-2); font-size:11px; }
      .lure-count { max-width:150px; margin-top:9px; }
      .lure-settings { display:grid; grid-template-columns:minmax(0,150px); gap:7px; margin-top:9px; }
      .attack-range { max-width:170px; margin-top:9px; }
      .training-delay { margin-top:10px; padding:9px; border:1px solid var(--luz); background:var(--painel); }
      .training-delay-title { color:var(--ui); font-size:12px; font-weight:650; }
      .training-delay-fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin-top:6px; }
      .training-delay-fields label { min-width:0; color:var(--ui-2); font-size:11px; }
      .training-delay .hint { margin-top:7px; }
      .training-mobs { display:grid; gap:7px; padding:9px; border:1px solid var(--luz); background:var(--slot); }
      .training-mobs > strong { color:var(--ouro-claro); font-size:12px; }
      .training-mob-head,.training-mob-row { display:grid; grid-template-columns:32px minmax(0,1fr) 54px 62px; align-items:center; gap:7px; }
      .training-mob-head { color:var(--ui-2); font-size:9px; text-align:center; }
      .training-mob-head span:nth-child(2) { text-align:left; }
      .training-mob-list { display:grid; gap:4px; max-height:200px; overflow:auto; }
      .training-mob-row { min-height:38px; padding:4px; border:1px solid var(--luz); background:var(--poco); }
      .training-mob-row img,.training-mob-icon { width:30px; height:30px; object-fit:contain; image-rendering:pixelated; }
      .training-mob-icon { display:grid; place-items:center; color:var(--ouro); }
      .training-mob-name { overflow:hidden; color:var(--ui); font-size:11px; text-overflow:ellipsis; white-space:nowrap; }
      .training-mob-name small { display:block; color:var(--ui-2); font-size:9px; }
      .training-mob-row label { display:grid; place-items:center; cursor:pointer; }
      .training-mob-row input { width:16px; height:16px; accent-color:var(--ouro); }
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
      /* Only the Configuração page uses this shared card layout. */
      .page[data-section="automation"] .prefs { display:grid; gap:10px; margin:0; padding:0; border:0; }
      .page[data-section="automation"] .config-block { min-width:0; margin:0; padding:11px; border:1px solid var(--luz); background:linear-gradient(145deg,#282118,#17120e); box-shadow:inset 0 1px #ffffff10,0 4px 12px #0004; }
      .page[data-section="automation"] .city-route-card.config-block { gap:9px; }
      .page[data-section="automation"] .config-heading,.page[data-section="automation"] .city-route-head { display:flex; align-items:center; gap:9px; min-height:34px; margin-bottom:2px; }
      .page[data-section="automation"] .config-heading-icon,.page[data-section="automation"] .city-route-icon { display:grid; flex:0 0 30px; width:30px; height:30px; place-items:center; border:1px solid var(--ouro-escuro); background:#46381a; color:var(--ouro-claro); font-size:16px; }
      .page[data-section="automation"] .city-route-icon svg { width:19px; height:19px; }
      .page[data-section="automation"] .config-heading-copy,.page[data-section="automation"] .city-route-title { display:grid; min-width:0; gap:1px; line-height:1.2; }
      .page[data-section="automation"] .config-heading-copy strong,.page[data-section="automation"] .city-route-title strong { color:var(--ui); font-size:12px; font-weight:700; }
      .page[data-section="automation"] .config-heading-copy small,.page[data-section="automation"] .city-route-title small { color:var(--ui-2); font-size:10px; font-weight:500; }
      .page[data-section="automation"] .config-potions .automation { grid-template-columns:minmax(0,1fr) 72px; gap:8px; min-height:44px; margin-top:5px; padding:7px 8px; border:1px solid var(--luz); background:var(--slot); }
      .page[data-section="automation"] .config-potions .automation-title { display:flex; flex-direction:row-reverse; justify-content:space-between; min-width:0; gap:8px; font-size:11px; }
      .page[data-section="automation"] .config-potions .automation > label:last-child { color:var(--ui-2); text-align:center; }
      .page[data-section="automation"] .config-potions .threshold { margin:0 0 2px; text-align:center; }
      .page[data-section="automation"] .config-options .pref { flex-direction:row-reverse; min-height:40px; margin:5px 0 0; padding:8px 9px; background:var(--slot); font-size:11px; line-height:1.3; cursor:pointer; }
      .page[data-section="automation"] .config-options .pref:hover { border-color:var(--ouro-escuro); }
      .page[data-section="automation"] .config-options > .hint { margin:2px 2px 5px; line-height:1.4; }
      .page[data-section="automation"] .config-sales .loot-picker,.page[data-section="automation"] .config-sales .protected-sell-card { margin:5px 0 0; padding:9px; border:1px solid var(--luz); background:var(--slot); box-shadow:inset 0 1px #ffffff0a; }
      .page[data-section="automation"] .config-sales .loot-picker-head,.page[data-section="automation"] .config-sales .protected-sell-head { flex-wrap:wrap; gap:6px; color:var(--ui); font-size:12px; }
      .page[data-section="automation"] .config-sales .loot-item-list { max-height:150px; }
      .page[data-section="automation"] .config-sales .loot-item { min-height:31px; padding:4px 6px; border:1px solid transparent; }
      .page[data-section="automation"] .config-sales .loot-item:hover { border-color:var(--luz); background:var(--painel); }
      .page[data-section="automation"] .config-sales > .hint { margin:1px 2px 0; }
      .page[data-section="automation"] .config-sales .protected-item-row,.page[data-section="automation"] .config-sales .protected-inventory-row { background:#1d1812; }
      .page[data-section="automation"] .config-sales .protected-inventory-title { color:var(--ui); }
      .page[data-section="automation"] .config-block :is(select,input[type="number"]):focus-visible { outline:2px solid var(--ouro); outline-offset:1px; }
      .page .menu-block { display:grid; gap:9px; min-width:0; margin:0 0 10px; padding:11px; border:1px solid var(--luz); background:linear-gradient(145deg,#282118,#17120e); box-shadow:inset 0 1px #ffffff10,0 4px 12px #0004; }
      .page .menu-heading { display:flex; align-items:center; gap:9px; min-height:34px; margin:0 0 2px; }
      .page .menu-heading-icon { display:grid; flex:0 0 30px; width:30px; height:30px; place-items:center; border:1px solid var(--ouro-escuro); background:#46381a; color:var(--ouro-claro); font-size:16px; }
      .page .menu-heading-copy { display:grid; min-width:0; gap:1px; line-height:1.2; }
      .page .menu-heading-copy strong { color:var(--ui); font-size:12px; font-weight:700; }
      .page .menu-heading-copy small { color:var(--ui-2); font-size:10px; font-weight:500; }
      .page .menu-block > .hint,.page .menu-block > .result { margin:0 2px; line-height:1.4; }
      .page .menu-block > .pref,.page .menu-block > .setting-toggle { min-height:40px; margin:0; padding:8px 9px; background:var(--slot); font-size:11px; }
      .page .menu-block > .pref { flex-direction:row-reverse; cursor:pointer; }
      .page .menu-block > .pref:hover,.page .menu-block > .setting-toggle:hover { border-color:var(--ouro-escuro); }
      .page .menu-block > .attack-range { display:grid; gap:3px; min-width:0; }
      .page .menu-block > .attack-range[hidden],.training-weapon-options[hidden] { display:none; }
      .training-weapon-options { display:grid; gap:7px; margin-top:9px; }
      .training-weapon-options .attack-range { display:grid; gap:3px; max-width:260px; margin:0; }
      .training-weapon-options .attack-range select { width:100%; min-width:0; }
      .page .menu-block > .attack-range :is(select,input) { width:100%; min-width:0; }
      .page .menu-block > .hunt-toggle { margin:0; min-height:36px; }
      .page .menu-block > .creature-list,.page .menu-block > .target-list,.page .menu-block > .waypoint-list,.page .menu-block > .console-list { margin:0; max-height:220px; }
      .page .menu-block > .target-search,.page .menu-block > .target-tools,.page .menu-block > .waypoint-actions { margin:0; }
      .page .menu-block > .destination-settings { display:grid; gap:8px; }
      .page .menu-block .destination-form { margin:0; padding:9px; border-color:var(--luz); }
      .page .menu-block .refill-action-row,.page .menu-block .refill-items,.page .menu-block .training-delay,.page .menu-block .waypoint-reverse-card { margin:0; }
      .page .menu-block .training-delay,.page .menu-block .waypoint-reverse-card,.page .menu-block .lure-status-card { border-color:var(--luz); background:var(--slot); }
      .page .menu-block .refill-item-list { max-height:140px; }
      .page .menu-block .resource-summary { margin:0; }
      .page .menu-block .console-toolbar { flex-wrap:wrap; gap:6px; margin:0; }
      .page .menu-block :is(select,input[type="number"],input[type="search"]):focus-visible { outline:2px solid var(--ouro); outline-offset:1px; }
    </style>
    <div class="backdrop" hidden>
    <section class="panel" role="dialog" aria-modal="true" aria-label="Preferências do Sentinela">
      <header><span>Menu do Sentinela <span class="menu-version">v1.0.38</span></span><button class="close" aria-label="Fechar">×</button></header>
      <div class="workspace">
        <nav class="side-menu" aria-label="Opções do Sentinela">
          <button class="side-link" data-page="creatures">Criaturas</button>
          <button class="side-link" data-page="targets">Alvos</button>
          <button class="side-link" data-page="hunt">Sistema de caça</button>
          <button class="side-link" data-page="training">Treino</button>
          <button class="side-link" data-page="focus">Focar</button>
          <button class="side-link" data-page="refill">Loja / Refill</button>
          <button class="side-link" data-page="waypoints">Waypoints</button>
          <button class="side-link" data-page="clone">Clone</button>
          <button class="side-link" data-page="automation">Configuração</button>
          <button class="side-link" data-page="console">Console</button>
        </nav>
        <div class="page-content">
          <section class="page" data-section="creatures" hidden>
            <h2>Criaturas próximas</h2>
            <div class="creature-search menu-block">
              <div class="menu-heading"><span class="menu-heading-icon" aria-hidden="true">◈</span><span class="menu-heading-copy"><strong>Buscar criaturas</strong><small>Encontre alvos próximos pela distância</small></span></div>
              <div class="search-row">
                <label>Raio da busca<input class="creature-radius" type="number" min="1" max="100" step="1" value="10"></label>
                <button class="search">Buscar</button>
              </div>
              <div class="creature-list" aria-live="polite"></div>
            </div>
          </section>
          <section class="page" data-section="hunt" hidden>
            <h2>Sistema de caça</h2>
            <div class="hunt menu-block">
              <div class="menu-heading"><span class="menu-heading-icon" aria-hidden="true">⚔</span><span class="menu-heading-copy"><strong>Caça automática</strong><small>Combate, coleta e retorno à cidade</small></span></div>
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
          <section class="page" data-section="training" hidden>
            <h2>Treino</h2>
            <section class="menu-block" aria-label="Configurações de treino">
            <div class="menu-heading"><span class="menu-heading-icon" aria-hidden="true">✦</span><span class="menu-heading-copy"><strong>Treino automático</strong><small>Alvos, intervalo e viagem à cidade</small></span></div>
            <button class="hunt-toggle training-toggle" type="button">Iniciar treino</button>
            <p class="hint">Procura alvos dentro do raio configurado, aproxima-se até o alcance de ataque e coleta loot próximo.</p>
            <label class="attack-range">Raio de busca (tiles)<input class="training-radius" type="number" min="1" max="100" step="1" value="4"></label>
            <div class="training-mobs">
              <strong>Escolher mobs próximos</strong>
              <p class="hint">Mobs de treino são atacados até morrer. Mobs de combate só são caçados quando não houver alvo de treino.</p>
              <div class="training-mob-head"><span></span><span>Mob</span><span>Treinar</span><span>Combater</span></div>
              <div class="training-mob-list" aria-live="polite"></div>
            </div>
            <label class="attack-range">Tempo parado para aproximar do waypoint (minutos)<input class="training-idle-minutes" type="number" min="0" max="1440" step="1" value="0"></label>
            <div class="hint">Use 0 para desativar. Requer um waypoint no andar atual.</div>
            <div class="training-delay">
              <div class="training-delay-title">Intervalo entre alvos</div>
              <div class="training-delay-fields">
                <label>Mínimo (s)<input class="training-target-delay-min" type="number" min="0" max="60" step="0.1" value="0"></label>
                <label>Máximo (s)<input class="training-target-delay-max" type="number" min="0" max="60" step="0.1" value="0"></label>
              </div>
              <p class="hint">Um tempo é sorteado entre os dois valores.</p>
            </div>
            <label class="attack-range">Classe do treino<select class="training-class"><option value="mage">Mage — 4 tiles</option><option value="melee">Melee — 1 tile</option><option value="distance">Distance — 4 tiles</option></select></label>
            <label class="attack-range">Como combater mobs, exaustos e elite<select class="training-combat-mode"><option value="class">Trocar de classe</option><option value="weapon">Trocar de arma</option></select></label>
            <label class="attack-range training-combat-class-row">Classe para matar<select class="training-combat-class"><option value="melee">Melee</option><option value="distance">Distance</option><option value="mage">Mage</option></select></label>
            <div class="training-weapon-options" hidden>
              <label class="attack-range">Arma padrão do treino<select class="training-weapon"><option value="">Escolha uma arma</option></select></label>
              <label class="attack-range">Arma para matar<select class="training-combat-weapon"><option value="">Escolha uma arma</option></select></label>
              <p class="hint">Escolha armas equipadas ou na mochila. A troca usa a classe do treino e restaura a arma padrão após o combate.</p>
            </div>
            <label class="pref"><input class="training-elite-enabled" type="checkbox"> Matar elite quando atacar</label>
            <p class="hint">Prioriza o elite e usa a habilidade especial. Para Mage, ative o especial automático no jogo.</p>
            <label class="pref"><input class="training-exhausted-enabled" type="checkbox"> Matar monstros exaustos</label>
            <p class="hint">Usa a mesma classe ou arma de combate e volta ao padrão após o combate, sem habilidade especial.</p>
            <label class="pref"><input class="training-waypoints" type="checkbox"> Percorrer waypoints quando não houver alvos próximos</label>
            <label class="pref"><input class="training-city-bag" type="checkbox"> Ir à cidade com mochila cheia</label>
            <label class="pref"><input class="training-city-arrows" type="checkbox"> Ir à cidade sem flechas</label>
            <label class="pref"><input class="training-city-potions" type="checkbox"> Ir à cidade com menos de 10 poções de HP ou MP</label>
            <p class="hint">Na cidade, vende os itens selecionados e faz o refill configurado em Loja / Refill.</p>
            <label class="pref"><input class="auto-loot-gold" type="checkbox"> Coletar ouro automaticamente</label>
            <p class="hint training-status" role="status"></p>
            </section>
          </section>
          <section class="page" data-section="focus" hidden>
            <h2>Focar</h2>
            <div class="hunt menu-block">
              <div class="menu-heading"><span class="menu-heading-icon" aria-hidden="true">◎</span><span class="menu-heading-copy"><strong>Foco no alvo</strong><small>Controle do alvo selecionado no jogo</small></span></div>
              <p class="hint">Segue até o alcance de ataque de 4 tiles, separado do sistema de caça.</p>
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
            <section class="menu-block" aria-label="Destinos da loja e do refill">
              <div class="menu-heading"><span class="menu-heading-icon" aria-hidden="true">⌖</span><span class="menu-heading-copy"><strong>Destinos</strong><small>Coordenadas da loja e do refill</small></span></div>
              <div class="destination-settings"></div>
            </section>
            <section class="menu-block" aria-label="Recursos e execução do refill">
              <div class="menu-heading"><span class="menu-heading-icon" aria-hidden="true">✚</span><span class="menu-heading-copy"><strong>Recursos</strong><small>Estoque atual e execução do refill</small></span></div>
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
            </section>
            <section class="menu-block" aria-label="Itens do refill">
              <div class="menu-heading"><span class="menu-heading-icon" aria-hidden="true">▣</span><span class="menu-heading-copy"><strong>Estoque desejado</strong><small>Escolha o item e a quantidade</small></span></div>
            <div class="refill-items">
              <div class="refill-item-controls">
                <div><select class="refill-item-select" aria-hidden="true" tabindex="-1" style="display:none"><option value="">Selecione um item</option></select><details class="refill-item-picker"><summary><span class="refill-picker-current-icon refill-picker-icon" aria-hidden="true">◇</span><span class="refill-picker-name">Selecione um item</span></summary><div class="refill-picker-menu" aria-label="Itens da loja"></div></details></div>
                <label>Estoque desejado<input class="refill-item-quantity" type="number" min="1" max="1000000" step="1" value="100"></label>
                <button class="refill-item-add" type="button"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>Adicionar</button>
              </div>
              <div class="refill-item-list" aria-live="polite"></div>
            </div>
            </section>
          </section>
          <section class="page" data-section="targets" hidden>
            <h2>Alvos</h2>
            <section class="menu-block" aria-label="Lista de alvos">
              <div class="menu-heading"><span class="menu-heading-icon" aria-hidden="true">◎</span><span class="menu-heading-copy"><strong>Alvos disponíveis</strong><small>Filtre e selecione as criaturas</small></span></div>
            <input class="target-search" type="search" placeholder="Filtrar criaturas…" aria-label="Filtrar criaturas">
            <div class="target-tools"><button class="targets-all">Ativar todos</button><button class="targets-none">Desativar todos</button></div>
            <div class="target-list" aria-live="polite"></div>
            </section>
          </section>
          <section class="page" data-section="waypoints" hidden>
            <h2>Waypoints</h2>
            <section class="menu-block" aria-label="Configuração da rota">
              <div class="menu-heading"><span class="menu-heading-icon" aria-hidden="true">⇄</span><span class="menu-heading-copy"><strong>Rota</strong><small>Patrulha, sentido e pausas</small></span></div>
            <label class="pref"><input class="waypoint-patrol-toggle" type="checkbox"> Percorrer quando não houver alvos</label>
            <div class="waypoint-reverse-card">
              <div class="waypoint-reverse-head"><span class="waypoint-reverse-icon" aria-hidden="true">⇄</span><span>Sentido da rota</span></div>
              <label class="pref"><input class="waypoint-reverse-toggle" type="checkbox"> Inverter a ordem dos waypoints</label>
              <label class="waypoint-reverse-settings"><span>Inverter a cada número de voltas</span><input class="waypoint-reverse-loops" type="number" min="1" max="1000" step="1" value="1"></label>
              <label class="waypoint-reverse-settings"><span>Pausa após inverter (segundos)</span><input class="waypoint-reverse-delay" type="number" min="0" max="300" step="0.1" value="0"></label>
              <p class="hint">Uma volta termina ao retornar ao primeiro ponto depois de alcançar o último.</p>
            </div>
            </section>
            <section class="menu-block" aria-label="Gerenciar waypoints">
              <div class="menu-heading"><span class="menu-heading-icon" aria-hidden="true">⌖</span><span class="menu-heading-copy"><strong>Pontos da rota</strong><small>Grave, importe ou adicione posições</small></span></div>
            <div class="waypoint-actions" style="grid-template-columns:1fr">
              <button class="waypoint-current">Adicionar posição atual</button>
              <button class="waypoint-record" type="button">Iniciar gravação ao andar</button>
              <button class="waypoint-map-open" type="button">Criar waypoints pelo mapa</button>
            </div>
            <div class="waypoint-actions waypoint-file-actions">
              <button class="waypoint-export" type="button">Exportar waypoints</button>
              <button class="waypoint-import" type="button">Importar JSON</button>
            </div>
            <input class="waypoint-file" type="file" accept="application/json,.json" hidden>
            <p class="result waypoint-result" role="status"></p>
            <div class="waypoint-list" aria-live="polite"></div>
            </section>
          </section>
          <section class="page" data-section="clone" hidden>
            <h2>Clone</h2>
            <section class="menu-block" aria-label="Importar e exportar configuração">
              <div class="menu-heading"><span class="menu-heading-icon" aria-hidden="true">▤</span><span class="menu-heading-copy"><strong>Backup da configuração</strong><small>Copie as preferências para outro cliente</small></span></div>
            <p class="hint">Exporte ou importe as configurações salvas do mod, incluindo waypoints, alvos, caça, loot, refill e automações.</p>
            <div class="waypoint-actions">
              <button class="config-export" type="button">Exportar configuração</button>
              <button class="config-import" type="button">Importar configuração</button>
            </div>
            <input class="config-file" type="file" accept="application/json,.json" hidden>
            <p class="result config-result" role="status"></p>
            </section>
          </section>
          <section class="page" data-section="automation" hidden>
            <h2>Configuração</h2>
            <div class="prefs">
              <section class="city-route-card config-block" aria-label="Viagem à cidade">
                <div class="city-route-head">
                  <span class="city-route-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 19h5l3-4h8M4 19V6h8l3 4h5M4 6l3-3m-3 3 3 3M20 15l-3-3m3 3-3 3"/></svg></span>
                  <span class="city-route-title"><strong>Volta para a cidade</strong><small>Escolha como sair da área de farm</small></span>
                  <span class="city-tp-count" data-empty="true" aria-live="polite"><strong>0</strong><small>TP ESCOLHIDO</small></span>
                </div>
                <div class="city-route-path" aria-hidden="true"><span>FARM</span><i></i><span>CIDADE</span></div>
                <div class="city-route-fields">
                  <label>Modo de viagem<select class="city-travel-mode">
                    <option value="walk">Andando</option>
                    <option value="tp">Usar TP</option>
                  </select></label>
                  <label>Pergaminho de Cidade<select class="city-tp-item"></select></label>
                </div>
                <p class="city-route-note">Antes do TP, o bot elimina mobs em até 10 tiles e espera 12 s com a área livre. O pergaminho leva 15 s para ativar.</p>
                <p class="city-route-status" role="status"></p>
              </section>
              <section class="config-block config-potions" aria-label="Poções">
                <div class="config-heading"><span class="config-heading-icon" aria-hidden="true">✚</span><span class="config-heading-copy"><strong>Poções</strong><small>Uso automático durante a caça</small></span></div>
                <div class="automation">
                  <label class="automation-title"><input class="auto-heal" type="checkbox"> Auto heal (HP)</label>
                  <label><input class="hp-threshold threshold" type="number" min="5" max="95" step="5" aria-label="Usar poção de vida abaixo de porcentagem">%</label>
                </div>
                <div class="automation">
                  <label class="automation-title"><input class="auto-mana" type="checkbox"> Auto mana (MP)</label>
                  <label><input class="mp-threshold threshold" type="number" min="5" max="95" step="5" aria-label="Usar poção de mana abaixo de porcentagem">%</label>
                </div>
              </section>
              <section class="config-block config-options" aria-label="Preferências gerais">
                <div class="config-heading"><span class="config-heading-icon" aria-hidden="true">⚙</span><span class="config-heading-copy"><strong>Preferências gerais</strong><small>Conexão e respostas automáticas</small></span></div>
                <label class="pref"><input class="auto-switch-server" type="checkbox"> Trocar de servidor após morrer ou finalizar o refill</label>
                <p class="hint">Usa servidores das Américas do Norte e do Sul antes de retornar à caça.</p>
                <label class="pref"><input class="auto-reconnect" type="checkbox"> Reconectar automaticamente</label>
                <label class="pref"><input class="auto-confirmation" type="checkbox"> Responder confirmação de monstro</label>
                <p class="hint">Compara os sprites das opções. Se a imagem for ambígua ou pedir texto, responda manualmente.</p>
                <label class="pref"><input class="auto-refresh" type="checkbox"> Atualizar estado automaticamente</label>
              </section>
              <section class="config-block config-sales" aria-label="Configuração de itens">
                <div class="config-heading"><span class="config-heading-icon" aria-hidden="true">▣</span><span class="config-heading-copy"><strong>Itens</strong><small>Venda automática e proteção da mochila</small></span></div>
                <div class="loot-picker">
                  <div class="loot-picker-head"><span>Itens para venda automática</span><span class="loot-picker-actions"><button class="loot-select-all" type="button">Todos</button><button class="loot-select-none" type="button">Limpar</button></span></div>
                  <div class="loot-item-list" aria-live="polite"></div>
                </div>
                <p class="hint loot-assets-status" role="status"></p>
                <section class="protected-sell-card" aria-label="Itens que não serão vendidos">
                  <div class="protected-sell-head"><strong>Itens que não serão vendidos</strong><span class="protected-sell-count">0 protegidos</span></div>
                  <p class="hint">Itens protegidos permanecem na mochila durante a venda automática.</p>
                  <div class="protected-sell-list" aria-live="polite"></div>
                  <div class="protected-inventory"><span class="protected-inventory-title">Adicionar da mochila</span><div class="protected-inventory-list" aria-live="polite"></div></div>
                </section>
              </section>
            </div>
          </section>
          <section class="page" data-section="console" hidden>
            <h2>Console</h2>
            <section class="menu-block" aria-label="Histórico do console">
              <div class="menu-heading"><span class="menu-heading-icon" aria-hidden="true">⌘</span><span class="menu-heading-copy"><strong>Histórico</strong><small>Eventos e mensagens do bot</small></span></div>
            <div class="console-toolbar"><span>Histórico de bot e WebSocket (até 1.000 registros cada)</span><span class="console-actions"><button class="console-export" type="button">Exportar logs</button><button class="console-clear" type="button">Limpar</button></span></div>
            <div class="console-list" aria-live="polite"></div>
            </section>
          </section>
        </div>
      </div>
    </section>
    <div class="waypoint-map-dialog" hidden role="dialog" aria-modal="true" aria-label="Criar waypoints pelo mapa">
      <div class="waypoint-map-shell">
        <div class="waypoint-map-head"><strong>Waypoints pelo mapa</strong><button class="waypoint-map-close" type="button" aria-label="Fechar mapa">Fechar</button></div>
        <div class="waypoint-map-tools">
          <label>Andar <select class="waypoint-map-floor" aria-label="Andar do mapa"></select></label>
          <button class="waypoint-map-center" type="button">Minha posição</button>
          <button class="waypoint-map-zoom-out" type="button" aria-label="Diminuir zoom">−</button>
          <button class="waypoint-map-zoom-in" type="button" aria-label="Aumentar zoom">+</button>
          <button class="waypoint-map-undo" type="button">Desfazer último</button>
        </div>
        <canvas class="waypoint-map-canvas" aria-label="Mapa do jogo; clique para adicionar waypoint e arraste para navegar"></canvas>
        <p class="waypoint-map-status" role="status">Clique em um local caminhável para adicionar. Arraste para navegar e use a roda para ampliar.</p>
      </div>
    </div>
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
  const waypointMapDialog = root.querySelector(".waypoint-map-dialog");
  const waypointMapCanvas = root.querySelector(".waypoint-map-canvas");
  const waypointMapFloor = root.querySelector(".waypoint-map-floor");
  const waypointMapStatus = root.querySelector(".waypoint-map-status");
  const waypointFile = root.querySelector(".waypoint-file");
  const configFile = root.querySelector(".config-file");
  const configResult = root.querySelector(".config-result");
  const waypointPatrolToggle = root.querySelector(".waypoint-patrol-toggle");
  const waypointReverseToggle = root.querySelector(".waypoint-reverse-toggle");
  const waypointReverseLoops = root.querySelector(".waypoint-reverse-loops");
  const waypointReverseDelay = root.querySelector(".waypoint-reverse-delay");
  const waypointLureToggle = root.querySelector(".waypoint-lure-toggle");
  const lureCountInput = root.querySelector(".lure-count-input");
  const lureStepInput = root.querySelector(".lure-step-input");
  const attackRangeSelect = root.querySelector(".attack-range-select");
  const lureSpecialToggle = root.querySelector(".lure-special-toggle");
  const waypointResult = root.querySelector(".waypoint-result");
  const waypointRecord = root.querySelector(".waypoint-record");
  const huntAttackAny = root.querySelector(".hunt-attack-any");
  const huntAutoSell = root.querySelector(".hunt-auto-sell");
  const refillAfterSale = root.querySelector(".refill-after-sale");
  const cityRouteCard = root.querySelector(".city-route-card");
  const cityTravelMode = root.querySelector(".city-travel-mode");
  const cityTpItem = root.querySelector(".city-tp-item");
  const cityTpCount = root.querySelector(".city-tp-count");
  const cityRouteStatus = root.querySelector(".city-route-status");
  const refillTest = root.querySelector(".refill-test");
  const refillStatus = root.querySelector(".refill-status");
  const refillItemSelect = root.querySelector(".refill-item-select");
  const refillItemPicker = root.querySelector(".refill-item-picker");
  const refillPickerMenu = root.querySelector(".refill-picker-menu");
  const refillPickerName = root.querySelector(".refill-picker-name");
  const refillPickerCurrentIcon = root.querySelector(".refill-picker-current-icon");
  const refillItemQuantity = root.querySelector(".refill-item-quantity");
  const refillItemAdd = root.querySelector(".refill-item-add");
  const refillItemList = root.querySelector(".refill-item-list");
  const lootItemList = root.querySelector(".loot-item-list");
  const protectedSellList = root.querySelector(".protected-sell-list");
  const protectedSellCount = root.querySelector(".protected-sell-count");
  const protectedInventoryList = root.querySelector(".protected-inventory-list");
  const huntToggle = root.querySelector(".hunt-toggle");
  const trainingToggle = root.querySelector(".training-toggle");
  const autoLootGoldToggles = root.querySelectorAll(".auto-loot-gold");
  const trainingStatus = root.querySelector(".training-status");
  const trainingClass = root.querySelector(".training-class");
  const trainingCombatClass = root.querySelector(".training-combat-class");
  const trainingCombatMode = root.querySelector(".training-combat-mode");
  const trainingCombatClassRow = root.querySelector(".training-combat-class-row");
  const trainingWeaponOptions = root.querySelector(".training-weapon-options");
  const trainingWeapon = root.querySelector(".training-weapon");
  const trainingCombatWeapon = root.querySelector(".training-combat-weapon");
  const trainingMobList = root.querySelector(".training-mob-list");
  const trainingEliteEnabled = root.querySelector(".training-elite-enabled");
  const trainingExhaustedEnabled = root.querySelector(".training-exhausted-enabled");
  const trainingRadius = root.querySelector(".training-radius");
  const trainingIdleMinutes = root.querySelector(".training-idle-minutes");
  const trainingTargetDelayMin = root.querySelector(".training-target-delay-min");
  const trainingTargetDelayMax = root.querySelector(".training-target-delay-max");
  const trainingWaypoints = root.querySelector(".training-waypoints");
  const trainingCityOptions = { bag: root.querySelector(".training-city-bag"), arrows: root.querySelector(".training-city-arrows"), potions: root.querySelector(".training-city-potions") };
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
  const autoConfirmation = root.querySelector(".auto-confirmation");
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
  autoConfirmation.checked = readPreference("auto-confirmation", "true") === "true";
  hpThreshold.value = readPreference("heal-threshold", "50");
  mpThreshold.value = readPreference("mana-threshold", "30");
  huntAutoSell.checked = !!window.mod?.hunt?.autoSell;
  refillAfterSale.checked = !!window.mod?.hunt?.refillAfterSale;
  cityTravelMode.value = window.mod?.hunt?.cityTravelMode === "tp" ? "tp" : "walk";
  function renderCityTravel() {
    const mode = window.mod?.hunt?.cityTravelMode === "tp" ? "tp" : "walk";
    const selected = String(window.mod?.hunt?.cityTpItemId ?? "auto");
    const scrolls = window.mod?.townScrollOptions?.() ?? [];
    const signature = JSON.stringify({ selected, scrolls });
    if (cityTpItem.dataset.signature !== signature) {
      cityTpItem.replaceChildren();
      const automatic = document.createElement("option");
      automatic.value = "auto";
      automatic.textContent = "Automático — primeiro disponível";
      cityTpItem.append(automatic);
      for (const scroll of scrolls) {
        const option = document.createElement("option");
        option.value = scroll.id;
        option.textContent = `${scroll.name} · ${scroll.count} na mochila`;
        cityTpItem.append(option);
      }
      if (selected !== "auto" && !scrolls.some(scroll => scroll.id === selected)) {
        const unavailable = document.createElement("option");
        unavailable.value = selected;
        unavailable.textContent = `TP ID ${selected} — fora da mochila`;
        cityTpItem.append(unavailable);
      }
      cityTpItem.value = selected;
      cityTpItem.dataset.signature = signature;
    }
    if (root.activeElement !== cityTravelMode) cityTravelMode.value = mode;
    cityRouteCard.dataset.mode = mode;
    cityTpItem.disabled = mode !== "tp";
    const chosen = selected === "auto" ? scrolls[0] : scrolls.find(scroll => scroll.id === selected);
    const count = Math.max(0, Math.floor(Number(chosen?.count) || 0));
    const countText = cityTpCount.querySelector("strong");
    if (countText.textContent !== String(count)) countText.textContent = String(count);
    cityTpCount.dataset.empty = String(count === 0);
    cityTpCount.title = chosen ? `${count} unidade(s) de ${chosen.name} na mochila` : "Nenhum TP escolhido disponível na mochila";
    cityRouteStatus.textContent = mode === "walk"
      ? "O bot irá andando até a loja configurada."
      : chosen ? `Usará ${chosen.name}. Se o TP falhar, seguirá andando até a loja.`
        : !window.mod?.inventory?.known ? "Aguardando dados da mochila para encontrar os pergaminhos."
          : selected === "auto" ? "Nenhum Pergaminho de Cidade na mochila; o bot irá andando."
            : "O pergaminho escolhido não está na mochila; o bot irá andando.";
  }
  renderCityTravel();
  focusSkillToggle.checked = !!window.mod?.focus?.useSkill;
  focusFollowToggle.checked = window.mod?.focus?.followTarget !== false;
  focusStatus.textContent = window.mod?.focus?.status ?? "Focar desligado";
  const setRefillStatus = value => {
    const detail = String(value ?? "Pronto");
    const state = /erro|falha|não encontrado|indisponível/i.test(detail) ? "error"
      : /estoque.*atingido|concluíd|enviadas/i.test(detail) ? "complete"
      : /preparando|indo para|voltando|procurando|abrindo|comprando|finalizando|na fila|viagem iniciada|travel iniciado|aguardando conexão/i.test(detail) ? "loading" : "ready";
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
    if (name === "training") renderTrainingMobs();
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
    const catalog = new Map((window.mod?.lootCatalog ?? []).map(item => [String(item.id), item]));
    const icons = offers.map(offer => catalog.get(String(offer.id))?.sprite ?? null);
    const signature = JSON.stringify({ offers, icons, configured, stocks: configured.map(item => currentRefillStock(item.id)) });
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
    const uniqueOffers = offers.filter((offer, index) => offers.findIndex(candidate => String(candidate.id) === String(offer.id)) === index);
    const makeIcon = id => {
      const icon = document.createElement("span");
      icon.className = "refill-picker-icon";
      const sprite = catalog.get(String(id))?.sprite;
      if (sprite) {
        const image = document.createElement("img");
        image.src = sprite;
        image.alt = "";
        icon.append(image);
      } else icon.textContent = "◇";
      return icon;
    };
    const updatePickerSelection = () => {
      const selectedOffer = uniqueOffers.find(offer => String(offer.id) === refillItemSelect.value);
      refillPickerName.textContent = selectedOffer ? `${selectedOffer.name} · ID ${selectedOffer.id}`
        : offers.length ? "Selecione um item" : "Itens indisponíveis";
      refillPickerCurrentIcon.replaceChildren(...makeIcon(selectedOffer?.id).childNodes);
      for (const button of refillPickerMenu.querySelectorAll(".refill-picker-option")) {
        button.dataset.selected = String(button.dataset.id === refillItemSelect.value);
      }
    };
    refillPickerMenu.replaceChildren();
    if (!uniqueOffers.length) {
      const empty = document.createElement("span");
      empty.className = "refill-picker-empty";
      empty.textContent = "Aguardando itens da loja.";
      refillPickerMenu.append(empty);
    }
    for (const offer of uniqueOffers) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "refill-picker-option";
      button.dataset.id = String(offer.id);
      const name = document.createElement("span");
      name.textContent = `${offer.name} · ID ${offer.id}`;
      button.append(makeIcon(offer.id), name);
      button.addEventListener("click", () => {
        refillItemSelect.value = String(offer.id);
        updatePickerSelection();
        refillItemPicker.open = false;
      });
      refillPickerMenu.append(button);
    }
    updatePickerSelection();
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
  const close = () => { waypointMapDialog.hidden = true; backdrop.hidden = true; };
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
  autoConfirmation.addEventListener("change", () => savePreference("auto-confirmation", autoConfirmation.checked));
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
  cityTravelMode.addEventListener("change", () => {
    const outcome = window.mod?.setCityTravelMode?.(cityTravelMode.value);
    if (!outcome?.ok) cityTravelMode.value = window.mod?.hunt?.cityTravelMode === "tp" ? "tp" : "walk";
    renderCityTravel();
  });
  cityTpItem.addEventListener("change", () => {
    window.mod?.setCityTpItemId?.(cityTpItem.value);
    renderCityTravel();
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
  const saveWaypointReverse = () => {
    const outcome = window.mod?.setWaypointReverse?.(waypointReverseToggle.checked, waypointReverseLoops.value);
    if (!outcome?.ok) {
      waypointReverseToggle.checked = !!window.mod?.hunt?.waypointReverseEnabled;
      waypointReverseLoops.value = String(window.mod?.hunt?.waypointReverseLoops ?? 1);
      waypointResult.textContent = outcome?.error ?? "Não foi possível configurar a inversão.";
    }
  };
  waypointReverseToggle.addEventListener("change", saveWaypointReverse);
  waypointReverseLoops.addEventListener("change", saveWaypointReverse);
  waypointReverseDelay.addEventListener("change", () => {
    const outcome = window.mod?.setWaypointReverseDelay?.(waypointReverseDelay.value);
    if (!outcome?.ok) {
      waypointReverseDelay.value = String(window.mod?.hunt?.waypointReverseDelay ?? 0);
      waypointResult.textContent = outcome?.error ?? "Não foi possível salvar a pausa.";
    }
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
    const outcome = !waypointLureToggle.checked && window.mod?.hunt?.lureEnabled
      ? window.mod?.stopHunt?.() : window.mod?.setLureEnabled?.(waypointLureToggle.checked);
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

  let trainingWeaponChoicesSignature = "";
  function renderTrainingWeaponChoices(hunt) {
    const inventory = window.mod?.inventory;
    const equipped = inventory?.equip?.[{ melee: "sword", distance: "bow", mage: "wand" }[hunt?.trainingClass ?? "melee"]];
    const ids = new Set([equipped, ...(inventory?.bag ?? []).map(entry => Array.isArray(entry) ? entry[0] : entry), hunt?.trainingWeaponId, hunt?.trainingCombatWeaponId]
      .filter(id => id != null && id !== false && id !== "").map(String));
    const catalog = new Map((window.mod?.lootCatalog ?? []).map(item => [String(item.id), item.name]));
    const signature = JSON.stringify([[...ids], [...ids].map(id => catalog.get(id))]);
    if (signature !== trainingWeaponChoicesSignature) {
      trainingWeaponChoicesSignature = signature;
      for (const select of [trainingWeapon, trainingCombatWeapon]) {
        select.replaceChildren(new Option("Escolha uma arma", ""), ...[...ids].map(id => new Option(`${catalog.get(id) ?? `Item ${id}`} (ID ${id})`, id)));
      }
    }
    if (root.activeElement !== trainingWeapon) trainingWeapon.value = hunt?.trainingWeaponId ?? "";
    if (root.activeElement !== trainingCombatWeapon) trainingCombatWeapon.value = hunt?.trainingCombatWeaponId ?? "";
  }

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
    waypointReverseToggle.checked = !!hunt?.waypointReverseEnabled;
    if (root.activeElement !== waypointReverseLoops) waypointReverseLoops.value = String(hunt?.waypointReverseLoops ?? 1);
    if (root.activeElement !== waypointReverseDelay) waypointReverseDelay.value = String(hunt?.waypointReverseDelay ?? 0);
    const recording = window.mod?.waypointRecording;
    waypointRecord.textContent = recording?.enabled ? "Parar gravação" : "Iniciar gravação ao andar";
    waypointRecord.dataset.active = String(!!recording?.enabled);
    if (recording?.enabled || recording?.status?.startsWith("Gravação interrompida")) waypointResult.textContent = recording.status;
    huntAttackAny.checked = !!hunt?.attackAny;
    const trainingActive = active && !!hunt?.training;
    huntToggle.textContent = active && !trainingActive ? "Parar caça" : lureActive ? "Parar lure" : "Iniciar caça";
    huntToggle.dataset.active = String((active && !trainingActive) || lureActive);
    for (const toggle of autoLootGoldToggles) toggle.checked = hunt?.autoLootGold !== false;
    if (root.activeElement !== trainingRadius) trainingRadius.value = String(hunt?.trainingRadius ?? 4);
    if (root.activeElement !== trainingIdleMinutes) trainingIdleMinutes.value = String(hunt?.trainingIdleMinutes ?? 0);
    if (root.activeElement !== trainingTargetDelayMin) trainingTargetDelayMin.value = String(hunt?.trainingTargetDelayMin ?? 0);
    if (root.activeElement !== trainingTargetDelayMax) trainingTargetDelayMax.value = String(hunt?.trainingTargetDelayMax ?? 0);
    trainingClass.value = hunt?.trainingClass ?? "melee";
    trainingCombatClass.value = hunt?.trainingCombatClass ?? "melee";
    trainingCombatMode.value = hunt?.trainingCombatMode ?? "class";
    renderTrainingWeaponChoices(hunt);
    trainingCombatClassRow.hidden = trainingCombatMode.value !== "class";
    trainingWeaponOptions.hidden = trainingCombatMode.value !== "weapon";
    trainingEliteEnabled.checked = !!hunt?.trainingEliteEnabled;
    trainingExhaustedEnabled.checked = !!hunt?.trainingExhaustedEnabled;
    trainingWaypoints.checked = !!hunt?.trainingWaypoints;
    trainingCityOptions.bag.checked = hunt?.trainingCityBag !== false;
    trainingCityOptions.arrows.checked = hunt?.trainingCityArrows !== false;
    trainingCityOptions.potions.checked = !!hunt?.trainingCityPotions;
    trainingToggle.textContent = trainingActive ? "Parar treino" : "Iniciar treino";
    trainingToggle.dataset.active = String(trainingActive);
    const idleSeconds = hunt?.trainingIdleRemainingSeconds;
    const idleCountdown = trainingActive && Number.isFinite(idleSeconds)
      ? ` · Aproximação em ${Math.floor(idleSeconds / 60)}:${String(idleSeconds % 60).padStart(2, "0")}`
      : "";
    trainingStatus.textContent = trainingActive ? `${hunt?.status ?? "Treino ativo"}${idleCountdown}` : "Treino desligado";
    if (!backdrop.hidden && root.querySelector('[data-section="training"]')?.hidden === false) renderTrainingMobs();
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
    showProtectedSellItems();
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

  function showProtectedSellItems() {
    const catalog = window.mod?.lootCatalog ?? [];
    const selected = new Set((window.mod?.hunt?.sellProtectedItemIds ?? []).map(String));
    const inventory = window.mod?.inventory;
    const bagCounts = new Map();
    if (inventory?.known) for (const entry of inventory.bag ?? []) {
      const rawId = Array.isArray(entry) ? entry[0] : entry;
      if (rawId == null || rawId === false) continue;
      const id = String(rawId);
      const count = Array.isArray(entry) ? Math.max(1, Number(entry[1]) || 1) : 1;
      bagCounts.set(id, (bagCounts.get(id) ?? 0) + count);
    }
    const signature = JSON.stringify([catalog, [...selected].sort(), inventory?.known, [...bagCounts]]);
    if (protectedSellList.dataset.signature === signature) return;
    protectedSellList.dataset.signature = signature;
    protectedSellList.replaceChildren();
    protectedInventoryList.replaceChildren();
    protectedSellCount.textContent = `${selected.size} ${selected.size === 1 ? "protegido" : "protegidos"}`;
    const byId = new Map(catalog.map(item => [String(item.id), item]));
    const itemName = id => byId.get(id)?.name ?? `Item ${id}`;
    const makeRow = (id, protectedItem) => {
      const row = document.createElement("div");
      row.className = protectedItem ? "protected-item-row" : "protected-inventory-row";
      const icon = document.createElement("span");
      icon.className = "protected-item-icon";
      if (byId.get(id)?.sprite) {
        const image = document.createElement("img");
        image.src = byId.get(id).sprite;
        image.alt = "";
        icon.append(image);
      } else icon.textContent = "◇";
      const info = document.createElement("span");
      info.className = "protected-item-info";
      const name = document.createElement("span");
      name.className = "protected-item-name";
      name.textContent = itemName(id);
      const meta = document.createElement("span");
      meta.className = "protected-item-meta";
      meta.textContent = `ID ${id}${bagCounts.has(id) ? ` · ${bagCounts.get(id)} na mochila` : ""}`;
      info.append(name, meta);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `protected-item-action${protectedItem ? " remove" : ""}`;
      button.textContent = protectedItem ? "Remover" : "Proteger";
      button.setAttribute("aria-label", `${protectedItem ? "Remover proteção de" : "Proteger"} ${itemName(id)}`);
      button.addEventListener("click", () => {
        window.mod?.setSellProtectedItemEnabled?.(id, !protectedItem);
        showProtectedSellItems();
      });
      row.append(icon, info, button);
      return row;
    };
    if (!selected.size) {
      const empty = document.createElement("p");
      empty.className = "loot-item-empty";
      empty.textContent = "Nenhum item protegido. Adicione um item da mochila abaixo.";
      protectedSellList.append(empty);
    } else {
      for (const id of [...selected].sort((a, b) => itemName(a).localeCompare(itemName(b)))) {
        protectedSellList.append(makeRow(id, true));
      }
    }
    const available = [...bagCounts.keys()].filter(id => !selected.has(id))
      .sort((a, b) => itemName(a).localeCompare(itemName(b)));
    if (available.length) for (const id of available) protectedInventoryList.append(makeRow(id, false));
    else {
      const empty = document.createElement("p");
      empty.className = "loot-item-empty";
      empty.textContent = !inventory?.known ? "Aguardando dados da mochila."
        : bagCounts.size ? "Todos os itens da mochila já estão protegidos." : "A mochila está vazia.";
      protectedInventoryList.append(empty);
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

  const mapView = { floor: 0, x: 0, y: 0, tileSize: 14, drag: null };
  const mapPoint = (x, y, width, height) => ({
    x: (x + 0.5 - mapView.x) * mapView.tileSize + width / 2,
    y: (y + 0.5 - mapView.y) * mapView.tileSize + height / 2
  });
  const mapTileAt = (x, y, width, height) => ({
    x: Math.floor(mapView.x + (x - width / 2) / mapView.tileSize),
    y: Math.floor(mapView.y + (y - height / 2) / mapView.tileSize)
  });
  function drawWaypointMap() {
    if (waypointMapDialog.hidden) return;
    const api = window.mod?.waypointMap;
    const info = api?.info?.();
    if (!info) {
      waypointMapStatus.textContent = "Aguardando o mapa do jogo carregar.";
      return;
    }
    const rect = waypointMapCanvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (waypointMapCanvas.width !== Math.round(width * ratio) || waypointMapCanvas.height !== Math.round(height * ratio)) {
      waypointMapCanvas.width = Math.round(width * ratio);
      waypointMapCanvas.height = Math.round(height * ratio);
    }
    const context = waypointMapCanvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    try {
      if (!api.draw(context, mapView.floor, mapView.x, mapView.y, mapView.tileSize, width, height)) return;
    } catch (error) {
      waypointMapStatus.textContent = `Não foi possível desenhar o mapa: ${error?.message ?? error}`;
      return;
    }
    const points = (window.mod?.waypoints ?? [])
      .map((point, index) => ({ ...point, index }))
      .filter(point => point.floor === mapView.floor);
    context.lineWidth = 2;
    context.strokeStyle = "#f2c14e";
    context.beginPath();
    points.forEach((point, index) => {
      const at = mapPoint(point.x, point.y, width, height);
      if (index === 0 || point.index !== points[index - 1].index + 1) context.moveTo(at.x, at.y);
      else context.lineTo(at.x, at.y);
    });
    if (points.length > 1) context.stroke();
    for (const point of points) {
      const at = mapPoint(point.x, point.y, width, height);
      if (at.x < -15 || at.y < -15 || at.x > width + 15 || at.y > height + 15) continue;
      const number = point.index + 1;
      context.fillStyle = "#f2c14e";
      context.fillRect(at.x - 10, at.y - 10, 20, 20);
      context.strokeStyle = "#0d0a07";
      context.strokeRect(at.x - 10, at.y - 10, 20, 20);
      context.fillStyle = "#0d0a07";
      context.font = "bold 11px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(number), at.x, at.y);
    }
    const me = window.mod?.myself;
    if (me?.floor === mapView.floor && Number.isInteger(me.x) && Number.isInteger(me.y)) {
      const at = mapPoint(me.x, me.y, width, height);
      context.fillStyle = "#2ee6ff";
      context.strokeStyle = "#0d0a07";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(at.x, at.y, 5, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
  }
  function centerWaypointMapOnPlayer() {
    const me = window.mod?.myself;
    if (!Number.isInteger(me?.x) || !Number.isInteger(me?.y) || !Number.isInteger(me?.floor)) {
      waypointMapStatus.textContent = "Aguardando a posição do personagem.";
      return;
    }
    mapView.floor = me.floor;
    mapView.x = me.x + 0.5;
    mapView.y = me.y + 0.5;
    waypointMapFloor.value = String(mapView.floor);
    drawWaypointMap();
  }
  function zoomWaypointMap(factor, x, y) {
    const rect = waypointMapCanvas.getBoundingClientRect();
    const worldX = mapView.x + (x - rect.width / 2) / mapView.tileSize;
    const worldY = mapView.y + (y - rect.height / 2) / mapView.tileSize;
    const next = Math.max(6, Math.min(32, mapView.tileSize * factor));
    if (next === mapView.tileSize) return;
    mapView.tileSize = next;
    mapView.x = worldX - (x - rect.width / 2) / next;
    mapView.y = worldY - (y - rect.height / 2) / next;
    drawWaypointMap();
  }
  root.querySelector(".waypoint-map-open").addEventListener("click", () => {
    const info = window.mod?.waypointMap?.info?.();
    if (!info) {
      waypointResult.textContent = "Aguardando o mapa do jogo carregar para abrir o editor.";
      return;
    }
    waypointMapFloor.replaceChildren();
    for (let floor = 0; floor < info.floors; floor++) {
      const option = document.createElement("option");
      option.value = String(floor);
      option.textContent = `Andar ${floor}`;
      waypointMapFloor.append(option);
    }
    waypointMapDialog.hidden = false;
    const me = window.mod?.myself;
    const last = window.mod?.waypoints?.at(-1);
    mapView.floor = Number.isInteger(me?.floor) ? me.floor : last?.floor ?? 0;
    mapView.x = Number.isInteger(me?.x) ? me.x + 0.5 : last?.x + 0.5 || info.width / 2;
    mapView.y = Number.isInteger(me?.y) ? me.y + 0.5 : last?.y + 0.5 || info.height / 2;
    mapView.tileSize = 14;
    waypointMapFloor.value = String(mapView.floor);
    waypointMapStatus.textContent = "Clique em um local caminhável para adicionar. Arraste para navegar e use a roda para ampliar.";
    requestAnimationFrame(drawWaypointMap);
    root.querySelector(".waypoint-map-close").focus();
  });
  root.querySelector(".waypoint-map-close").addEventListener("click", () => { waypointMapDialog.hidden = true; root.querySelector(".waypoint-map-open").focus(); });
  waypointMapDialog.addEventListener("click", event => { if (event.target === waypointMapDialog) waypointMapDialog.hidden = true; });
  root.addEventListener("keydown", event => {
    if (event.key === "Escape" && !waypointMapDialog.hidden) {
      event.preventDefault();
      event.stopPropagation();
      waypointMapDialog.hidden = true;
      root.querySelector(".waypoint-map-open").focus();
    }
  });
  waypointMapFloor.addEventListener("change", () => { mapView.floor = Number(waypointMapFloor.value); drawWaypointMap(); });
  root.querySelector(".waypoint-map-center").addEventListener("click", centerWaypointMapOnPlayer);
  root.querySelector(".waypoint-map-zoom-out").addEventListener("click", () => zoomWaypointMap(1 / 1.4, waypointMapCanvas.clientWidth / 2, waypointMapCanvas.clientHeight / 2));
  root.querySelector(".waypoint-map-zoom-in").addEventListener("click", () => zoomWaypointMap(1.4, waypointMapCanvas.clientWidth / 2, waypointMapCanvas.clientHeight / 2));
  root.querySelector(".waypoint-map-undo").addEventListener("click", () => {
    const last = window.mod?.waypoints?.at(-1);
    if (!last) { waypointMapStatus.textContent = "A rota ainda não tem waypoints."; return; }
    const outcome = window.mod?.removeWaypoint?.(window.mod.waypoints.length - 1);
    waypointMapStatus.textContent = outcome?.ok
      ? `Último waypoint removido: X ${last.x}, Y ${last.y} · andar ${last.floor}.`
      : outcome?.error ?? "Não foi possível remover o waypoint.";
    waypointResult.textContent = waypointMapStatus.textContent;
    waypointList.dataset.signature = "";
    showWaypoints();
    drawWaypointMap();
  });
  waypointMapCanvas.addEventListener("wheel", event => {
    event.preventDefault();
    const rect = waypointMapCanvas.getBoundingClientRect();
    zoomWaypointMap(event.deltaY < 0 ? 1.2 : 1 / 1.2, event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });
  waypointMapCanvas.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    waypointMapCanvas.setPointerCapture(event.pointerId);
    mapView.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, centerX: mapView.x, centerY: mapView.y, moved: false };
  });
  waypointMapCanvas.addEventListener("pointermove", event => {
    const drag = mapView.drag;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
    if (!drag.moved) return;
    mapView.x = drag.centerX - dx / mapView.tileSize;
    mapView.y = drag.centerY - dy / mapView.tileSize;
    waypointMapCanvas.dataset.dragging = "true";
    drawWaypointMap();
  });
  waypointMapCanvas.addEventListener("pointerup", event => {
    const drag = mapView.drag;
    if (!drag || drag.id !== event.pointerId) return;
    mapView.drag = null;
    waypointMapCanvas.dataset.dragging = "false";
    if (drag.moved) return;
    const rect = waypointMapCanvas.getBoundingClientRect();
    const tile = mapTileAt(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
    if (!window.mod?.waypointMap?.isWalkable(mapView.floor, tile.x, tile.y)) {
      waypointMapStatus.textContent = `X ${tile.x}, Y ${tile.y} não é um local caminhável.`;
      return;
    }
    const previous = window.mod?.waypoints?.at(-1);
    if (previous?.x === tile.x && previous?.y === tile.y && previous?.floor === mapView.floor) {
      waypointMapStatus.textContent = "Esse já é o último waypoint da rota.";
      return;
    }
    const outcome = window.mod?.addWaypoint?.(tile.x, tile.y, mapView.floor);
    waypointMapStatus.textContent = outcome?.ok
      ? `Waypoint ${outcome.count} adicionado: X ${tile.x}, Y ${tile.y} · andar ${mapView.floor}.`
      : outcome?.error ?? "Não foi possível adicionar o waypoint.";
    waypointResult.textContent = waypointMapStatus.textContent;
    waypointList.dataset.signature = "";
    showWaypoints();
    drawWaypointMap();
  });
  waypointMapCanvas.addEventListener("pointercancel", () => { mapView.drag = null; waypointMapCanvas.dataset.dragging = "false"; });

  function renderTrainingMobs() {
    const hunt = window.mod?.hunt;
    const trainingTypes = new Set((hunt?.trainingMobTypes ?? []).map(String));
    const combatTypes = new Set((hunt?.trainingCombatMobTypes ?? []).map(String));
    const catalog = new Map((window.mod?.monsterCatalog ?? []).map(mob => [String(mob.type), mob]));
    const nearby = new Map();
    for (const mob of window.mod?.creaturesNearby?.(30) ?? []) {
      if (mob.type == null) continue;
      const type = String(mob.type);
      const current = nearby.get(type);
      if (current) {
        current.count++;
        current.distance = Math.min(current.distance, mob.distance);
      } else nearby.set(type, { type, name: mob.name, distance: mob.distance, count: 1 });
    }
    const types = [...new Set([...nearby.keys(), ...trainingTypes, ...combatTypes])];
    types.sort((a, b) => (nearby.get(a)?.distance ?? Infinity) - (nearby.get(b)?.distance ?? Infinity)
      || (catalog.get(a)?.name ?? a).localeCompare(catalog.get(b)?.name ?? b));
    const signature = JSON.stringify([types.map(type => [type, nearby.get(type)?.count, nearby.get(type)?.distance]), [...trainingTypes], [...combatTypes]]);
    if (trainingMobList.dataset.signature === signature) return;
    trainingMobList.dataset.signature = signature;
    trainingMobList.replaceChildren();
    if (!types.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "Nenhum mob visto a até 30 tiles. A lista aparecerá quando houver criaturas por perto.";
      trainingMobList.append(empty);
      return;
    }
    for (const type of types) {
      const row = document.createElement("div");
      row.className = "training-mob-row";
      const mob = nearby.get(type);
      const entry = catalog.get(type);
      const icon = entry?.sprite ? document.createElement("img") : document.createElement("span");
      if (entry?.sprite) { icon.src = entry.sprite; icon.alt = ""; }
      else { icon.className = "training-mob-icon"; icon.textContent = "◇"; }
      const name = document.createElement("span");
      name.className = "training-mob-name";
      name.textContent = entry?.name ?? mob?.name ?? `Criatura ${type}`;
      const detail = document.createElement("small");
      detail.textContent = mob ? `${mob.count} perto · ${mob.distance} tile(s) · tipo ${type}` : `Fora da visão · tipo ${type}`;
      name.append(detail);
      row.append(icon, name);
      for (const [kind, selected] of [["training", trainingTypes], ["combat", combatTypes]]) {
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selected.has(type);
        checkbox.setAttribute("aria-label", `${kind === "training" ? "Treinar" : "Trocar classe para combater"} ${entry?.name ?? mob?.name ?? type}`);
        checkbox.addEventListener("change", () => {
          const next = new Set((kind === "training" ? hunt.trainingMobTypes : hunt.trainingCombatMobTypes).map(String));
          if (checkbox.checked) next.add(type);
          else next.delete(type);
          const outcome = window.mod?.setTrainingMobTypes?.(kind, [...next]);
          if (!outcome?.ok) trainingStatus.textContent = outcome?.error ?? "Não foi possível salvar os mobs do treino.";
          trainingMobList.dataset.signature = "";
          renderTrainingMobs();
        });
        label.append(checkbox);
        row.append(label);
      }
      trainingMobList.append(row);
    }
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
  waypointRecord.addEventListener("click", () => {
    const outcome = window.mod?.setWaypointRecording?.(!window.mod?.waypointRecording?.enabled);
    waypointResult.textContent = outcome?.ok ? window.mod.waypointRecording.status : (outcome?.error ?? "Gravação indisponível.");
    syncHuntUI();
    showWaypoints();
  });
  root.querySelector(".waypoint-current").addEventListener("click", () => {
    const me = window.mod?.myself;
    if (!Number.isInteger(me?.x) || !Number.isInteger(me?.y)) {
      waypointResult.textContent = "Aguardando a posição do personagem.";
      return;
    }
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
    if (window.mod?.hunt?.training && (window.mod.hunt.enabled || window.mod.hunt.resumeAfterReturn)) {
      huntStatus.textContent = "Pare o treino antes de iniciar a caça.";
      return;
    }
    if (window.mod?.hunt?.enabled || window.mod?.hunt?.lureEnabled || window.mod?.hunt?.resumeAfterReturn) window.mod.stopHunt();
    else {
      const types = Object.keys(window.mod?.targets ?? {}).filter(type => window.mod.targets[type]);
      const outcome = window.mod?.startHuntTargets?.(types, 11, true);
      if (!outcome?.ok) huntStatus.textContent = outcome?.error ?? "API de caça indisponível.";
    }
    syncHuntUI();
  });
  for (const toggle of autoLootGoldToggles) toggle.addEventListener("change", () => {
    window.mod?.setAutoLootGold?.(toggle.checked);
    syncHuntUI();
  });
  const saveTrainingOptions = () => window.mod?.setTrainingOptions?.(trainingClass.value, trainingWaypoints.checked);
  const saveTrainingTargetDelay = () => {
    const outcome = window.mod?.setTrainingTargetDelay?.(trainingTargetDelayMin.value, trainingTargetDelayMax.value);
    if (!outcome?.ok) {
      trainingTargetDelayMin.value = String(window.mod?.hunt?.trainingTargetDelayMin ?? 0);
      trainingTargetDelayMax.value = String(window.mod?.hunt?.trainingTargetDelayMax ?? 0);
      trainingStatus.textContent = outcome?.error ?? "Não foi possível salvar o intervalo.";
    }
  };
  trainingTargetDelayMin.addEventListener("change", saveTrainingTargetDelay);
  trainingTargetDelayMax.addEventListener("change", saveTrainingTargetDelay);
  trainingRadius.addEventListener("change", () => {
    const outcome = window.mod?.setTrainingRadius?.(trainingRadius.value);
    if (!outcome?.ok) {
      trainingRadius.value = String(window.mod?.hunt?.trainingRadius ?? 4);
      trainingStatus.textContent = outcome?.error ?? "Não foi possível salvar o raio.";
    }
  });
  trainingIdleMinutes.addEventListener("change", () => {
    const outcome = window.mod?.setTrainingIdleMinutes?.(trainingIdleMinutes.value);
    if (!outcome?.ok) {
      trainingIdleMinutes.value = String(window.mod?.hunt?.trainingIdleMinutes ?? 0);
      trainingStatus.textContent = outcome?.error ?? "Não foi possível salvar o tempo.";
    }
  });
  trainingClass.addEventListener("change", saveTrainingOptions);
  trainingCombatClass.addEventListener("change", () => {
    const outcome = window.mod?.setTrainingCombatClass?.(trainingCombatClass.value);
    if (!outcome?.ok) {
      trainingCombatClass.value = window.mod?.hunt?.trainingCombatClass ?? "melee";
      trainingStatus.textContent = outcome?.error ?? "Não foi possível salvar a classe de combate.";
    }
  });
  trainingCombatMode.addEventListener("change", () => {
    const outcome = window.mod?.setTrainingCombatMode?.(trainingCombatMode.value);
    if (!outcome?.ok) trainingStatus.textContent = outcome?.error ?? "Não foi possível salvar o modo de combate.";
    trainingCombatClassRow.hidden = trainingCombatMode.value !== "class";
    trainingWeaponOptions.hidden = trainingCombatMode.value !== "weapon";
  });
  trainingWeapon.addEventListener("change", () => window.mod?.setTrainingWeapon?.("training", trainingWeapon.value));
  trainingCombatWeapon.addEventListener("change", () => window.mod?.setTrainingWeapon?.("combat", trainingCombatWeapon.value));
  const saveTrainingEliteOptions = () => {
    window.mod?.setTrainingEliteOptions?.(trainingEliteEnabled.checked);
  };
  trainingEliteEnabled.addEventListener("change", saveTrainingEliteOptions);
  const saveTrainingExhaustedOptions = () => {
    window.mod?.setTrainingExhaustedOptions?.(trainingExhaustedEnabled.checked);
  };
  trainingExhaustedEnabled.addEventListener("change", saveTrainingExhaustedOptions);
  trainingWaypoints.addEventListener("change", saveTrainingOptions);
  for (const [option, toggle] of Object.entries(trainingCityOptions)) toggle.addEventListener("change", () => window.mod?.setTrainingCityOption?.(option, toggle.checked));
  trainingToggle.addEventListener("click", () => {
    const hunt = window.mod?.hunt;
    if (hunt?.training && (hunt.enabled || hunt.resumeAfterReturn)) window.mod.stopHunt();
    else if (hunt?.enabled || hunt?.lureEnabled || hunt?.resumeAfterReturn) {
      trainingStatus.textContent = "Pare a caça antes de iniciar o treino.";
      return;
    } else {
      const types = [...(hunt?.trainingMobTypes ?? []), ...(hunt?.trainingCombatMobTypes ?? [])];
      const outcome = window.mod?.startHuntTargets?.(types, hunt?.trainingRadius ?? 4, false, true);
      if (!outcome?.ok) { trainingStatus.textContent = outcome?.error ?? "API de treino indisponível."; return; }
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
    if (!waypointMapDialog.hidden) drawWaypointMap();
    if (!backdrop.hidden && autoRefresh.checked) refresh();
    else if (!backdrop.hidden && window.mod?.refill?.status) setRefillStatus(window.mod.refill.status);
    if (!backdrop.hidden) renderCityTravel();
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
