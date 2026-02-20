/* Torgplan – canvas editor (move / rotate / scale, search highlight, low fill)
   - Ny pall / firer-torg / endegavel
   - Etter plassering: automatisk tilbake til Velg/Flytt
   - Flytt: dra objekt (hele firer-torg flyttes samlet)
   - Rotér/skaler: dra håndtak (eller R, +, -)
   - Lav fyllingsgrad: per pall / per del -> rød
   - Søk: treff lyses grønt og kamera sentrerer til første treff (kun artikkelnummer)
   - Lagring: localStorage + server (/api/state) (Supabase Postgres via Flask)
*/

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  markDirty();
}
window.addEventListener("resize", resizeCanvas);

/** Background map */
const mapImg = new Image();
mapImg.src = "/static/map.jpg";
let mapReady = false;
mapImg.onload = () => {
  mapReady = true;
  // Fast kartstørrelse (1:1). Canvas blir like stor som kartbildet,
  // og canvasWrap får scrollbars.
  canvas.style.width = mapImg.naturalWidth + "px";
  canvas.style.height = mapImg.naturalHeight + "px";
  resizeCanvas();
  markDirty();
};

const hint = document.getElementById("hint");
function setHint(text) {
  if (!text) { hint.classList.remove("hint--show"); return; }
  hint.textContent = text;
  hint.classList.add("hint--show");
  clearTimeout(setHint._t);
  setHint._t = setTimeout(() => hint.classList.remove("hint--show"), 2500);
}

const statusText = document.getElementById("statusText");
function setStatus(s) { statusText.textContent = s; }

/** Modes */
const btns = {
  select: document.getElementById("btnSelect"),
  pallet: document.getElementById("btnPallet"),
  firer: document.getElementById("btnFirer"),
  endegavel: document.getElementById("btnEndegavel"),
};
const btnDelete = document.getElementById("btnDelete");

let mode = "select";
function setMode(m) {
  mode = m;
  for (const k of Object.keys(btns)) {
    btns[k].classList.toggle("btn--active", k === mode);
  }
  if (mode === "pallet") setHint("Klikk i kartet for å plassere én pall. Etter plassering går den automatisk tilbake til Velg/Flytt.");
  if (mode === "firer") setHint("Klikk i kartet for å plassere et firer-torg (4 paller). Flytting/rotasjon/skala gjelder hele torget.");
  if (mode === "endegavel") setHint("Klikk i kartet for å plassere en endegavel (overprodukt + pall).");
}
for (const k of Object.keys(btns)) btns[k].addEventListener("click", () => setMode(k));

/** Storage */
const LS_KEY = "torgplan_state_v3";
let saveTimer = null;

async function serverLoad() {
  try {
    const r = await fetch("/api/state");
    const j = await r.json();
    return j.state || null;
  } catch { return null; }
}
async function serverSave(state) {
  try {
    await fetch("/api/state", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ state }) });
    return true;
  } catch { return false; }
}
function localLoad() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch { return null; }
}
function localSave(state) {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}
function debounceAutoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveAll({ quiet:true }), 450);
}

document.getElementById("btnSave").addEventListener("click", () => saveAll({ quiet:false }));
document.getElementById("btnLoad").addEventListener("click", () => loadAll({ preferServer:true }));

async function saveAll({ quiet }) {
  const state = exportState();
  localSave(state);
  const ok = await serverSave(state);
  setStatus(ok ? "Lagret" : "Lagret lokalt");
  if (!quiet) setHint(ok ? "Lagret til server + lokalt." : "Lagret lokalt (server lagring feilet).");
}
async function loadAll({ preferServer }) {
  let state = null;
  if (preferServer) state = await serverLoad();
  if (!state) state = localLoad();
  if (state) importState(state);
  setStatus(state ? "Hentet" : "Ingen data");
  setHint(state ? "Data hentet." : "Fant ingen tidligere lagring.");
}

/** View transform (pan/zoom) */
let view = { x: 0, y: 0, zoom: 1 };
function screenToWorld(px, py) { return { x: (px - view.x) / view.zoom, y: (py - view.y) / view.zoom }; }
function centerOn(wx, wy) {
  const rect = canvas.getBoundingClientRect();
  view.x = rect.width/2 - wx * view.zoom;
  view.y = rect.height/2 - wy * view.zoom;
  markDirty();
  debounceAutoSave();
}

/** Data */
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(2, 6); }
let counters = { pallet: 0 };
function nextPalletName() { counters.pallet += 1; return counters.pallet === 1 ? "Pall" : `Pall ${counters.pallet}`; }

const PALLET_W = 70, PALLET_H = 45;
const HANDLE_R = 8;

function makePallet(x, y, overrides = {}) {
  return { id: uid(), kind:"pallet", x, y, rot:0, scale:1, name: nextPalletName(), article:"", low:false, ...overrides };
}
function makeFirer(x, y) {
  const gapX = 85, gapY = 60;
  const children = [
    { id: uid(), rx: -gapX/2, ry: -gapY/2, name: nextPalletName(), article:"", low:false },
    { id: uid(), rx:  gapX/2, ry: -gapY/2, name: nextPalletName(), article:"", low:false },
    { id: uid(), rx: -gapX/2, ry:  gapY/2, name: nextPalletName(), article:"", low:false },
    { id: uid(), rx:  gapX/2, ry:  gapY/2, name: nextPalletName(), article:"", low:false },
  ];
  return { id: uid(), kind:"firer", x, y, rot:0, scale:1, name:"Firer-torg", children };
}
function makeEndegavel(x, y) {
  return { id: uid(), kind:"endegavel", x, y, rot:0, scale:1, name:"Endegavel",
    top:{ id: uid(), name:"Overprodukt", article:"", low:false },
    bottom:{ id: uid(), name: nextPalletName(), article:"", low:false },
  };
}

let items = [];
let selected = null; // { itemId, subId? }
let search = { q:"", matches: new Set() };

function findItemById(id){ return items.find(it => it.id === id) || null; }
function setSelected(sel){
  selected = sel;
  btnDelete.disabled = !selected;
  renderPanel();
  markDirty();
}
btnDelete.addEventListener("click", () => {
  if (!selected) return;
  items = items.filter(x => x.id !== selected.itemId);
  setSelected(null);
  debounceAutoSave();
});

/** Drawing */
function getFill({ low, match }) {
  if (match) return "#1f9d55";
  if (low) return "#d21f3c";
  return "#3b82f6";
}
function drawPalletRect(w,h,fill){
  ctx.fillStyle = fill;
  ctx.strokeStyle = "rgba(255,255,255,.25)";
  ctx.lineWidth = 2;
  const r = 10;
  ctx.beginPath();
  ctx.roundRect(-w/2, -h/2, w, h, r);
  ctx.fill();
  ctx.stroke();
}
function drawText(text){
  ctx.fillStyle = "rgba(255,255,255,.92)";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const clipped = (text || "").toString().slice(0, 18);
  ctx.fillText(clipped, 0, 0);
}

function displayLabel(obj){
  // Prefer name, fallback to article
  return (obj && (obj.name || obj.article)) ? (obj.name || obj.article) : "";
}
function applyTransform(it){
  ctx.translate(it.x, it.y);
  ctx.rotate(it.rot);
  ctx.scale(it.scale, it.scale);
}
function invPoint(it, wx, wy){
  const dx = wx - it.x, dy = wy - it.y;
  const c = Math.cos(-it.rot), s = Math.sin(-it.rot);
  return { x: (dx*c - dy*s)/it.scale, y:(dx*s + dy*c)/it.scale };
}
function localToWorld(it, lx, ly){
  const c = Math.cos(it.rot), s = Math.sin(it.rot);
  return { x: it.x + (lx*c - ly*s)*it.scale, y: it.y + (lx*s + ly*c)*it.scale };
}
function hitTestPalletLocal(lx,ly){ return Math.abs(lx) <= PALLET_W/2 && Math.abs(ly) <= PALLET_H/2; }

function drawHandles(){
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.strokeStyle = "rgba(0,0,0,.35)";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(PALLET_W/2 + 16, PALLET_H/2 + 16, HANDLE_R, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -PALLET_H/2 - 28, HANDLE_R, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.restore();
}
function hitHandleLocal(lx,ly){
  const sx = PALLET_W/2 + 16, sy = PALLET_H/2 + 16;
  const rx = 0, ry = -PALLET_H/2 - 28;
  if (Math.hypot(lx - sx, ly - sy) <= HANDLE_R + 3) return "scale";
  if (Math.hypot(lx - rx, ly - ry) <= HANDLE_R + 3) return "rotate";
  return null;
}

function hitTestWorld(wx,wy){
  for (let i=items.length-1; i>=0; i--) {
    const it = items[i];
    if (it.kind === "pallet") {
      const p = invPoint(it, wx, wy);
      if (hitTestPalletLocal(p.x,p.y)) return { itemId: it.id };
    } else if (it.kind === "firer") {
      const p = invPoint(it, wx, wy);
      for (const ch of it.children) {
        if (hitTestPalletLocal(p.x - ch.rx, p.y - ch.ry)) return { itemId: it.id, subId: ch.id };
      }
    } else if (it.kind === "endegavel") {
      const p = invPoint(it, wx, wy);
      if (hitTestPalletLocal(p.x, p.y + 70)) return { itemId: it.id, subId: it.top.id };
      if (hitTestPalletLocal(p.x, p.y)) return { itemId: it.id, subId: it.bottom.id };
    }
  }
  return null;
}

/** Create */
function placeAtWorld(wx,wy){
  if (mode === "pallet") {
    const it = makePallet(wx,wy);
    items.push(it);
    setMode("select");
    setSelected({ itemId: it.id });
    debounceAutoSave(); markDirty();
    return true;
  }
  if (mode === "firer") {
    const it = makeFirer(wx,wy);
    items.push(it);
    setMode("select");
    setSelected({ itemId: it.id });
    debounceAutoSave(); markDirty();
    return true;
  }
  if (mode === "endegavel") {
    const it = makeEndegavel(wx,wy);
    items.push(it);
    setMode("select");
    setSelected({ itemId: it.id });
    debounceAutoSave(); markDirty();
    return true;
  }
  return false;
}

/** Pointer interactions */
let pointer = {
  down:false, id:null, start:{x:0,y:0}, worldStart:{x:0,y:0},
  panning:false, dragging:false, handle:null, startRot:0, startScale:1, startVec:null
};
function isSpacePan(e){ return e.button===1 || e.buttons===4 || e.shiftKey; }

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointer.down = true; pointer.id = e.pointerId;

  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  pointer.start = { x:sx, y:sy };
  pointer.worldStart = screenToWorld(sx,sy);

  if (isSpacePan(e)) { pointer.panning = true; return; }

  if (mode !== "select") return;

  if (selected) {
    const it = findItemById(selected.itemId);
    if (it) {
      const w = screenToWorld(sx,sy);
      const lp = invPoint(it, w.x, w.y);
      const h = hitHandleLocal(lp.x, lp.y);
      if (h) {
        pointer.handle = h;
        pointer.startRot = it.rot;
        pointer.startScale = it.scale;
        pointer.startVec = { x: lp.x, y: lp.y };
        pointer.dragging = true;
        return;
      }
    }
  }

  const w = screenToWorld(sx,sy);
  const hit = hitTestWorld(w.x,w.y);
  setSelected(hit);
  pointer.dragging = !!hit;
});

canvas.addEventListener("pointermove", (e) => {
  if (!pointer.down) return;
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  const dx = sx - pointer.start.x;
  const dy = sy - pointer.start.y;

  if (pointer.panning) {
    view.x += dx; view.y += dy;
    pointer.start = { x:sx, y:sy };
    markDirty(); debounceAutoSave();
    return;
  }

  if (mode !== "select" || !selected) return;
  const it = findItemById(selected.itemId);
  if (!it) return;

  const w = screenToWorld(sx,sy);

  if (pointer.handle === "rotate") {
    const lp = invPoint(it, w.x, w.y);
    const a0 = Math.atan2(pointer.startVec.y, pointer.startVec.x);
    const a1 = Math.atan2(lp.y, lp.x);
    it.rot = pointer.startRot + (a1 - a0);
    markDirty(); debounceAutoSave(); renderPanel();
    return;
  }
  if (pointer.handle === "scale") {
    const lp = invPoint(it, w.x, w.y);
    const d0 = Math.hypot(pointer.startVec.x, pointer.startVec.y);
    const d1 = Math.hypot(lp.x, lp.y);
    const factor = d0 > 0.001 ? (d1 / d0) : 1;
    it.scale = clamp(pointer.startScale * factor, 0.35, 3.0);
    markDirty(); debounceAutoSave(); renderPanel();
    return;
  }

  if (pointer.dragging) {
    const prev = pointer.worldStart;
    it.x += (w.x - prev.x);
    it.y += (w.y - prev.y);
    pointer.worldStart = { ...w };
    markDirty(); debounceAutoSave();
  }
});

canvas.addEventListener("pointerup", (e) => {
  if (!pointer.down) return;
  pointer.down = false;

  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const w = screenToWorld(sx,sy);

  if (pointer.panning) { pointer.panning = false; return; }

  if (mode !== "select") {
    placeAtWorld(w.x,w.y);
    return;
  }

  pointer.handle = null;
  pointer.dragging = false;
});

/** Zoom */
canvas.addEventListener("wheel", (e) => {
  // Scroll = bla i kartet. Zoom kun med Ctrl + scroll.
  if (!e.ctrlKey) return;
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const before = screenToWorld(sx,sy);
  const z = e.deltaY < 0 ? 1.08 : 0.92;
  view.zoom = clamp(view.zoom * z, 0.35, 3.0);
  const after = screenToWorld(sx,sy);
  view.x += (after.x - before.x) * view.zoom;
  view.y += (after.y - before.y) * view.zoom;
  markDirty(); debounceAutoSave();
}, { passive:false });

/** Keyboard */
window.addEventListener("keydown", (e) => {
  // Ikke slett objekter med tastatur. Bruk kun "Slett"-knappen.
  // Dette hindrer at Backspace i tekstfeltene (navn/artikkelnummer) sletter hele pallen.
  if (e.key === "Delete" || e.key === "Backspace") return;

  if (!selected) return;
  const it = findItemById(selected.itemId);
  if (!it) return;

  if (e.key === "r" || e.key === "R") { it.rot += Math.PI/12; markDirty(); debounceAutoSave(); renderPanel(); }
  if (e.key === "+" || e.key === "=") { it.scale = clamp(it.scale*1.08, 0.35, 3.0); markDirty(); debounceAutoSave(); renderPanel(); }
  if (e.key === "-" || e.key === "_") { it.scale = clamp(it.scale*0.92, 0.35, 3.0); markDirty(); debounceAutoSave(); renderPanel(); }
});

/** Search */
const searchInput = document.getElementById("searchInput");
const btnClearSearch = document.getElementById("btnClearSearch");
searchInput.addEventListener("input", () => {
  search.q = (searchInput.value || "").trim().toLowerCase();
  updateSearchMatches();
  markDirty();
  debounceAutoSave();
});
btnClearSearch.addEventListener("click", () => {
  searchInput.value = "";
  search.q = "";
  updateSearchMatches();
  markDirty();
  debounceAutoSave();
});

function updateSearchMatches(){
  search.matches.clear();
  if (!search.q) return;
  const q = search.q;
  let firstHit = null;

  for (const it of items) {
    if (it.kind === "pallet") {
      if ((it.article || "").toLowerCase().includes(q)) {
        search.matches.add(it.id);
        if (!firstHit) firstHit = { wx: it.x, wy: it.y };
      }
    } else if (it.kind === "firer") {
      for (const ch of it.children) {
        if ((ch.article || "").toLowerCase().includes(q)) {
          search.matches.add(ch.id);
          const wp = localToWorld(it, ch.rx, ch.ry);
          if (!firstHit) firstHit = { wx: wp.x, wy: wp.y };
        }
      }
    } else if (it.kind === "endegavel") {
      if ((it.top.article || "").toLowerCase().includes(q)) {
        search.matches.add(it.top.id);
        const wp = localToWorld(it, 0, -70);
        if (!firstHit) firstHit = { wx: wp.x, wy: wp.y };
      }
      if ((it.bottom.article || "").toLowerCase().includes(q)) {
        search.matches.add(it.bottom.id);
        const wp = localToWorld(it, 0, 0);
        if (!firstHit) firstHit = { wx: wp.x, wy: wp.y };
      }
    }
  }

  if (firstHit) {
    setHint("Treff markeres grønt (artikkelnummer).");
    centerOn(firstHit.wx, firstHit.wy);
  }
}

/** Panel */
const panelBody = document.getElementById("panelBody");
function el(tag, attrs={}, children=[]){
  const n = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k === "value") n.value = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children) n.appendChild(c);
  return n;
}
function field(label, inputEl){
  return el("div", { class:"field" }, [ el("div", { class:"label", html: label }), inputEl ]);
}
function checkbox(labelText, checked, onChange){
  const input = el("input", { type:"checkbox" });
  input.checked = !!checked;
  input.addEventListener("change", () => onChange(input.checked));
  return el("label", { class:"check" }, [ input, el("span", { html: labelText }) ]);
}
function labelKind(k){
  if (k==="pallet") return "Pall";
  if (k==="firer") return "Firer-torg";
  if (k==="endegavel") return "Endegavel";
  return k;
}
function renderPanel(){
  panelBody.innerHTML = "";
  if (!selected) {
    panelBody.appendChild(el("div", { class:"muted", html:"Klikk på en pall / firer-torg / endegavel for å redigere." }));
    return;
  }
  const it = findItemById(selected.itemId);
  if (!it) return;

  panelBody.appendChild(el("div", { class:"smallNote", html: `Type: <b>${labelKind(it.kind)}</b> | Rot: ${(it.rot*180/Math.PI).toFixed(0)}° | Skala: ${it.scale.toFixed(2)}` }));

  // Quick controls for rotate/scale (in addition to handles + keyboard)
  panelBody.appendChild(el("div", { class:"row" }, [
    el("button", { class:"btn", onclick: () => { it.rot -= Math.PI/12; markDirty(); debounceAutoSave(); renderPanel(); } }, [document.createTextNode("⟲ Roter")]),
    el("button", { class:"btn", onclick: () => { it.rot += Math.PI/12; markDirty(); debounceAutoSave(); renderPanel(); } }, [document.createTextNode("Roter ⟳")]),
    el("button", { class:"btn", onclick: () => { it.scale = clamp(it.scale*0.92, 0.35, 3.0); markDirty(); debounceAutoSave(); renderPanel(); } }, [document.createTextNode("Mindre -")]),
    el("button", { class:"btn", onclick: () => { it.scale = clamp(it.scale*1.08, 0.35, 3.0); markDirty(); debounceAutoSave(); renderPanel(); } }, [document.createTextNode("Større +")]),
    el("button", { class:"btn", onclick: () => { it.rot = 0; it.scale = 1; markDirty(); debounceAutoSave(); renderPanel(); } }, [document.createTextNode("Nullstill")]),
  ]));

  panelBody.appendChild(el("div", { class:"hr" }));

  if (it.kind === "firer") {
    // Name for whole group
    const nameInp = el("input", { class:"input", value: it.name || "" });
    nameInp.addEventListener("input", () => { it.name = nameInp.value; updateSearchMatches(); markDirty(); debounceAutoSave(); });
    panelBody.appendChild(field("Navn på firer-torg (helhet)", nameInp));
    panelBody.appendChild(el("div", { class:"muted", html:"Firer-torg: 4 paller som henger sammen." }));
    for (let i=0;i<it.children.length;i++) {
      const ch = it.children[i];
      panelBody.appendChild(el("div", { class:"hr" }));
      panelBody.appendChild(el("div", { class:"label", html:`Pall ${i+1}` }));
      const inpName = el("input", { class:"input", value: ch.name || "" });
      inpName.addEventListener("input", () => { ch.name = inpName.value; markDirty(); debounceAutoSave(); });
      panelBody.appendChild(field("Navn", inpName));

      const inpArt = el("input", { class:"input", value: ch.article || "" });
      inpArt.addEventListener("input", () => { ch.article = inpArt.value; updateSearchMatches(); markDirty(); debounceAutoSave(); });
      panelBody.appendChild(field("Artikkelnummer (søk)", inpArt));
      panelBody.appendChild(checkbox("Lav fyllingsgrad (blir rød)", ch.low, (v) => { ch.low = v; markDirty(); debounceAutoSave(); }));
    }
    return;
  }

  if (it.kind === "endegavel") {
    const nameInp = el("input", { class:"input", value: it.name || "" });
    nameInp.addEventListener("input", () => { it.name = nameInp.value; updateSearchMatches(); markDirty(); debounceAutoSave(); });
    panelBody.appendChild(field("Navn på endegavel (helhet)", nameInp));

    panelBody.appendChild(el("div", { class:"muted", html:"Endegavel: overprodukt (øverst) + pall (nederst)." }));
    panelBody.appendChild(el("div", { class:"hr" }));

    const inpTopName = el("input", { class:"input", value: it.top.name || "" });
    inpTopName.addEventListener("input", () => { it.top.name = inpTopName.value; markDirty(); debounceAutoSave(); });
    panelBody.appendChild(field("Overprodukt (navn)", inpTopName));

    const inpTopArt = el("input", { class:"input", value: it.top.article || "" });
    inpTopArt.addEventListener("input", () => { it.top.article = inpTopArt.value; updateSearchMatches(); markDirty(); debounceAutoSave(); });
    panelBody.appendChild(field("Overprodukt artikkelnummer (søk)", inpTopArt));
    panelBody.appendChild(checkbox("Lav fyllingsgrad (overprodukt)", it.top.low, (v) => { it.top.low = v; markDirty(); debounceAutoSave(); }));

    panelBody.appendChild(el("div", { class:"hr" }));
    const inpBotName = el("input", { class:"input", value: it.bottom.name || "" });
    inpBotName.addEventListener("input", () => { it.bottom.name = inpBotName.value; markDirty(); debounceAutoSave(); });
    panelBody.appendChild(field("Pall (navn)", inpBotName));

    const inpBotArt = el("input", { class:"input", value: it.bottom.article || "" });
    inpBotArt.addEventListener("input", () => { it.bottom.article = inpBotArt.value; updateSearchMatches(); markDirty(); debounceAutoSave(); });
    panelBody.appendChild(field("Pall artikkelnummer (søk)", inpBotArt));
    panelBody.appendChild(checkbox("Lav fyllingsgrad (pall)", it.bottom.low, (v) => { it.bottom.low = v; markDirty(); debounceAutoSave(); }));
    return;
  }

  // pallet
  if (it.kind === "pallet") {
    const inpName = el("input", { class:"input", value: it.name || "" });
    inpName.addEventListener("input", () => { it.name = inpName.value; markDirty(); debounceAutoSave(); });
    panelBody.appendChild(field("Navn", inpName));

    const inpArt = el("input", { class:"input", value: it.article || "" });
    inpArt.addEventListener("input", () => { it.article = inpArt.value; updateSearchMatches(); markDirty(); debounceAutoSave(); });
    panelBody.appendChild(field("Artikkelnummer (søk)", inpArt));
    panelBody.appendChild(checkbox("Lav fyllingsgrad (blir rød)", it.low, (v) => { it.low = v; markDirty(); debounceAutoSave(); }));
    return;
  }
}
let dirty = true;
function markDirty(){ dirty = true; }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

function draw(){
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0,0,rect.width,rect.height);

  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.zoom, view.zoom);

  if (mapReady) {
    ctx.drawImage(mapImg, 0, 0);
  } else {
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = "rgba(255,255,255,.25)";
    ctx.lineWidth = 1;
    for (let x=0; x<2000; x+=100) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,1200); ctx.stroke(); }
    for (let y=0; y<1200; y+=100) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(2000,y); ctx.stroke(); }
    ctx.restore();
  }

  for (const it of items) {
    ctx.save();
    applyTransform(it);

    if (it.kind === "pallet") {
      const match = search.matches.has(it.id);
      drawPalletRect(PALLET_W, PALLET_H, getFill({ low: it.low, match }));
      drawText(displayLabel(it));
      if (selected && selected.itemId === it.id) drawHandles();
    } else if (it.kind === "firer") {
      if (it.name) {
        ctx.save();
        ctx.fillStyle = "rgba(255,255,255,.85)";
        ctx.font = "13px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(String(it.name).slice(0, 22), 0, -PALLET_H/2 - 38);
        ctx.restore();
      }
      for (const ch of it.children) {
        ctx.save();
        ctx.translate(ch.rx, ch.ry);
        const match = search.matches.has(it.id) || search.matches.has(ch.id);
        drawPalletRect(PALLET_W, PALLET_H, getFill({ low: ch.low, match }));
        drawText(displayLabel(ch));
        ctx.restore();
      }
      if (selected && selected.itemId === it.id) drawHandles();
    } else if (it.kind === "endegavel") {
      if (it.name) {
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,.85)";
      ctx.font = "13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(String(it.name).slice(0, 22), 0, -PALLET_H/2 - 38);
      ctx.restore();
    }

    ctx.save();
      ctx.translate(0, -70);
      drawPalletRect(PALLET_W, PALLET_H, getFill({ low: it.top.low, match: search.matches.has(it.id) || search.matches.has(it.top.id) }));
      drawText(displayLabel(it.top));
      ctx.restore();

      ctx.save();
      ctx.translate(0, 0);
      drawPalletRect(PALLET_W, PALLET_H, getFill({ low: it.bottom.low, match: search.matches.has(it.id) || search.matches.has(it.bottom.id) }));
      drawText(displayLabel(it.bottom));
      ctx.restore();

      if (selected && selected.itemId === it.id) drawHandles();
    }

    ctx.restore();
  }

  ctx.restore();
}

function tick(){
  if (dirty) { dirty = false; draw(); }
  requestAnimationFrame(tick);
}

/** Import/export */
function exportState(){
  return { v:4, items, counters, view, search:{ q: search.q || "" }, ts: Date.now() };
}
function importState(state){
  items = Array.isArray(state.items) ? state.items : [];
  // Migration from older versions (v3 and earlier): split "text" into name/article (best-effort)
  for (const it of items) {
    if (it.kind === "pallet") {
      if (it.text && !it.name && !it.article) {
        const t = String(it.text);
        if (/^\s*\d+\s*$/.test(t)) it.article = t.trim(); else it.name = t;
      }
      delete it.text;
      if (it.article == null) it.article = "";
      if (it.name == null) it.name = nextPalletName();
    }
    if (it.kind === "firer") {
      for (const ch of (it.children || [])) {
        if (ch.text && !ch.name && !ch.article) {
          const t = String(ch.text);
          if (/^\s*\d+\s*$/.test(t)) ch.article = t.trim(); else ch.name = t;
        }
        delete ch.text;
        if (ch.article == null) ch.article = "";
        if (ch.name == null) ch.name = nextPalletName();
      }
    }
    if (it.kind === "endegavel") {
      for (const part of [it.top, it.bottom]) {
        if (!part) continue;
        if (part.text && !part.name && !part.article) {
          const t = String(part.text);
          if (/^\s*\d+\s*$/.test(t)) part.article = t.trim(); else part.name = t;
        }
        delete part.text;
        if (part.article == null) part.article = "";
        if (part.name == null) part.name = "";
      }
    }
  }
  counters = state.counters || { pallet:0 };
  view = state.view || { x:0, y:0, zoom:1 };
  search.q = (state.search && state.search.q) ? state.search.q : "";
  searchInput.value = search.q;
  setSelected(null);
  updateSearchMatches();
  markDirty();
}

/** Boot */
async function boot(){
  resizeCanvas();
  setMode("select");
  await loadAll({ preferServer:true });
  setInterval(() => localSave(exportState()), 6000);
  tick();
  setStatus("Klar");
}
boot();
