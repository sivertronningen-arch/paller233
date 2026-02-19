const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');

// HiDPI: keep a logical coordinate system (layout.canvas.width/height)
let dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
let logicalSize = { w: canvas.width, h: canvas.height };

const hint = document.getElementById('hint');
const panelTitle = document.getElementById('panelTitle');
const panelBody = document.getElementById('panelBody');
const btnDelete = document.getElementById('btnDelete');

const btnSave = document.getElementById('btnSave');
const btnReset = document.getElementById('btnReset');

const modeButtons = [
  document.getElementById('modeSelect'),
  document.getElementById('modePallet'),
  document.getElementById('modeGroup'),
  document.getElementById('modeEndegavel'),
];

let layout = null;
let mode = 'select';
let selectedId = null;
let dragging = false;
let dragStart = {x:0,y:0};
let dragOriginalPositions = null; // map id -> {x,y}

let drawRequested = false;
let autoSaveTimer = null;
const AUTO_SAVE_MS = 1200;

function uuid(){
  // good enough locally
  return 'id_' + Math.random().toString(16).slice(2) + '_' + Date.now().toString(16);
}

function grid(){
  return (layout?.canvas?.grid ?? 20);
}

function snap(v){
  const g = grid();
  return Math.round(v / g) * g;
}

function getItemById(id){
  return (layout?.items ?? []).find(it => it.id === id) || null;
}

function getPalletGroupItems(groupId){
  return (layout.items || []).filter(it => it.type === 'pallet' && it.groupId === groupId);
}

function setMode(next){
  mode = next;
  for (const b of modeButtons){
    const isActive = b.dataset.mode === mode;
    b.classList.toggle('primary', isActive);
  }
  updateHint();
}

function updateHint(){
  const common = 'Klikk for å velge. Dra for å flytte.';
  if (mode === 'select') hint.textContent = common + ' (Flytt / Velg)';
  if (mode === 'add_pallet') hint.textContent = 'Klikk på kartet for å plassere en pall. Deretter kan du dra den.';
  if (mode === 'add_group') hint.textContent = 'Klikk på kartet for å plassere et firer-torg (4 paller). Dra én pall for å flytte hele torg-et.';
  if (mode === 'add_endegavel') hint.textContent = 'Klikk på kartet for å plassere en endegavel (over + pall).';
}

function draw(){
  drawRequested = false;
  if (!layout) return;

  // clear
  ctx.clearRect(0,0,logicalSize.w,logicalSize.h);

  // grid
  const g = grid();
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 1;
  for (let x = 0; x <= logicalSize.w; x += g){
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, logicalSize.h);
    ctx.stroke();
  }
  for (let y = 0; y <= logicalSize.h; y += g){
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(logicalSize.w, y + 0.5);
    ctx.stroke();
  }
  ctx.restore();

  // items
  for (const it of layout.items){
    if (it.type === 'pallet') drawPallet(it);
    if (it.type === 'endegavel') drawEndegavel(it);
  }

  // selection overlay
  const sel = getItemById(selectedId);
  if (sel){
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(92,200,255,0.95)';
    ctx.strokeRect(sel.x - 2, sel.y - 2, sel.w + 4, sel.h + 4);
    ctx.restore();
  }
}

function requestDraw(){
  if (drawRequested) return;
  drawRequested = true;
  window.requestAnimationFrame(draw);
}

function scheduleAutoSave(){
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    saveLayout();
  }, AUTO_SAVE_MS);
}

function drawPallet(p){
  ctx.save();
  const needs = !!p.needsRefill;

  // body
  ctx.fillStyle = needs ? 'rgba(255,92,108,0.35)' : 'rgba(255,255,255,0.08)';
  ctx.strokeStyle = needs ? 'rgba(255,92,108,0.85)' : 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  roundRect(p.x, p.y, p.w, p.h, 10, true, true);

  // title
  ctx.fillStyle = 'rgba(231,238,251,0.95)';
  ctx.font = '13px ui-sans-serif, system-ui';
  const label = (p.name && p.name.trim()) ? p.name.trim() : 'Pall';
  wrapText(label, p.x + 8, p.y + 18, p.w - 16, 14, 2);

  // badge
  if (needs){
    ctx.fillStyle = 'rgba(255,92,108,0.95)';
    ctx.font = '11px ui-sans-serif, system-ui';
    ctx.fillText('Trenger påfyll', p.x + 8, p.y + p.h - 10);
  }

  ctx.restore();
}

function drawEndegavel(e){
  ctx.save();

  const needsOver = !!(e.over && e.over.needsRefill);
  const needsPall = !!(e.pallet && e.pallet.needsRefill);

  // outer
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  roundRect(e.x, e.y, e.w, e.h, 12, true, true);

  // split
  const mid = e.y + Math.floor(e.h/2);
  ctx.beginPath();
  ctx.moveTo(e.x, mid);
  ctx.lineTo(e.x + e.w, mid);
  ctx.stroke();

  // top (over)
  if (needsOver){
    ctx.fillStyle = 'rgba(255,92,108,0.30)';
    ctx.fillRect(e.x+1, e.y+1, e.w-2, Math.floor(e.h/2)-2);
  }
  // bottom (pall)
  if (needsPall){
    ctx.fillStyle = 'rgba(255,92,108,0.30)';
    ctx.fillRect(e.x+1, mid+1, e.w-2, e.h - (mid-e.y) - 2);
  }

  // text
  ctx.fillStyle = 'rgba(231,238,251,0.95)';
  ctx.font = '12px ui-sans-serif, system-ui';
  ctx.fillText('Endegavel', e.x + 8, e.y + 16);

  ctx.fillStyle = 'rgba(155,176,204,0.95)';
  ctx.font = '11px ui-sans-serif, system-ui';

  const overName = (e.over?.name || '').trim() || 'Overprodukt';
  const palName = (e.pallet?.name || '').trim() || 'Pall';

  wrapText('Over: ' + overName, e.x + 8, e.y + 34, e.w - 16, 13, 2);
  wrapText('Pall: ' + palName, e.x + 8, mid + 18, e.w - 16, 13, 2);

  ctx.restore();
}

function roundRect(x, y, w, h, r, fill, stroke){
  const radius = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

function wrapText(text, x, y, maxWidth, lineHeight, maxLines){
  const words = String(text).split(/\s+/).filter(Boolean);
  let line = '';
  let lines = [];
  for (const w of words){
    const test = line ? (line + ' ' + w) : w;
    if (ctx.measureText(test).width > maxWidth && line){
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines){
    lines = lines.slice(0, maxLines);
    lines[maxLines-1] = lines[maxLines-1].replace(/\s+$/, '') + '…';
  }
  for (let i=0;i<lines.length;i++){
    ctx.fillText(lines[i], x, y + i*lineHeight);
  }
}

function hitTest(mx, my){
  // topmost first
  for (let i = layout.items.length - 1; i >= 0; i--){
    const it = layout.items[i];
    if (mx >= it.x && mx <= it.x + it.w && my >= it.y && my <= it.y + it.h){
      return it;
    }
  }
  return null;
}

function selectItem(id){
  selectedId = id;
  renderPanel();
  requestDraw();
}

function renderPanel(){
  const it = getItemById(selectedId);
  btnDelete.disabled = !it;

  if (!it){
    panelTitle.textContent = 'Ingen valgt';
    panelBody.innerHTML = '<p class="muted">Klikk på en pall / endegavel for å redigere.</p>';
    return;
  }

  if (it.type === 'pallet'){
    const title = it.groupId ? 'Pall (firer-torg)' : 'Pall';
    panelTitle.textContent = title;

    panelBody.innerHTML = `
      <div class="field">
        <label>Navn</label>
        <input type="text" id="fieldName" placeholder="Pall" value="${escapeHtml(it.name || '')}">
      </div>
      <div class="checkbox">
        <input type="checkbox" id="fieldRefill" ${it.needsRefill ? 'checked' : ''}>
        <div>
          <div><strong>Lav fyllingsgrad</strong></div>
          <div class="muted small">Hvis avkrysset lyser pallen rødt på kartet.</div>
        </div>
      </div>
      ${it.groupId ? `<div class="muted small">Merk: Flytting/sletting gjelder hele firer-torg.</div>` : ''}
    `;

    const fieldName = document.getElementById('fieldName');
    const fieldRefill = document.getElementById('fieldRefill');

    fieldName.addEventListener('input', () => {
      it.name = fieldName.value;
      requestDraw();
      scheduleAutoSave();
    });

    fieldRefill.addEventListener('change', () => {
      it.needsRefill = fieldRefill.checked;
      requestDraw();
      scheduleAutoSave();
    });

    return;
  }

  if (it.type === 'endegavel'){
    panelTitle.textContent = 'Endegavel';
    const overName = it.over?.name || '';
    const palName = it.pallet?.name || '';

    panelBody.innerHTML = `
      <div class="field">
        <label>Overprodukt (navn)</label>
        <input type="text" id="fieldOverName" placeholder="Overprodukt" value="${escapeHtml(overName)}">
      </div>
      <div class="checkbox">
        <input type="checkbox" id="fieldOverRefill" ${it.over?.needsRefill ? 'checked' : ''}>
        <div>
          <div><strong>Lav fyllingsgrad (overprodukt)</strong></div>
          <div class="muted small">Markerer øvre del rødt.</div>
        </div>
      </div>

      <div class="field">
        <label>Pall (navn)</label>
        <input type="text" id="fieldPalName" placeholder="Pall" value="${escapeHtml(palName)}">
      </div>
      <div class="checkbox">
        <input type="checkbox" id="fieldPalRefill" ${it.pallet?.needsRefill ? 'checked' : ''}>
        <div>
          <div><strong>Lav fyllingsgrad (pall)</strong></div>
          <div class="muted small">Markerer nedre del rødt.</div>
        </div>
      </div>
    `;

    const fieldOverName = document.getElementById('fieldOverName');
    const fieldOverRefill = document.getElementById('fieldOverRefill');
    const fieldPalName = document.getElementById('fieldPalName');
    const fieldPalRefill = document.getElementById('fieldPalRefill');

    fieldOverName.addEventListener('input', () => {
      it.over = it.over || {};
      it.over.name = fieldOverName.value;
      requestDraw();
      scheduleAutoSave();
    });
    fieldOverRefill.addEventListener('change', () => {
      it.over = it.over || {};
      it.over.needsRefill = fieldOverRefill.checked;
      requestDraw();
      scheduleAutoSave();
    });

    fieldPalName.addEventListener('input', () => {
      it.pallet = it.pallet || {};
      it.pallet.name = fieldPalName.value;
      requestDraw();
      scheduleAutoSave();
    });
    fieldPalRefill.addEventListener('change', () => {
      it.pallet = it.pallet || {};
      it.pallet.needsRefill = fieldPalRefill.checked;
      requestDraw();
      scheduleAutoSave();
    });

    return;
  }
}

function escapeHtml(str){
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function nextPalletDefaultName(){
  layout.counters.pallet = (layout.counters.pallet || 0) + 1;
  const n = layout.counters.pallet;
  return n === 1 ? 'Pall' : `Pall ${n}`;
}

function nextGroupId(){
  layout.counters.group = (layout.counters.group || 0) + 1;
  return 'grp_' + layout.counters.group;
}

function nextEndegavelDefaultTitle(){
  layout.counters.endegavel = (layout.counters.endegavel || 0) + 1;
  const n = layout.counters.endegavel;
  return n === 1 ? 'Endegavel' : `Endegavel ${n}`;
}

function addPalletAt(x, y, groupId=null){
  const w = 90, h = 60;
  const p = {
    id: uuid(),
    type: 'pallet',
    x: snap(x - w/2),
    y: snap(y - h/2),
    w, h,
    name: nextPalletDefaultName(),
    needsRefill: false,
  };
  if (groupId) p.groupId = groupId;
  layout.items.push(p);
  selectItem(p.id);
  scheduleAutoSave();
}

function addGroupAt(x, y){
  const groupId = nextGroupId();
  const w = 90, h = 60;
  const gap = 10;
  const startX = snap(x - (2*w + gap)/2);
  const startY = snap(y - (2*h + gap)/2);

  const positions = [
    {dx:0, dy:0},
    {dx:w+gap, dy:0},
    {dx:0, dy:h+gap},
    {dx:w+gap, dy:h+gap},
  ];

  let firstId = null;
  for (const pos of positions){
    const p = {
      id: uuid(),
      type: 'pallet',
      x: startX + pos.dx,
      y: startY + pos.dy,
      w, h,
      name: nextPalletDefaultName(),
      needsRefill: false,
      groupId,
    };
    if (!firstId) firstId = p.id;
    layout.items.push(p);
  }
  selectItem(firstId);
  scheduleAutoSave();
}

function addEndegavelAt(x, y){
  const w = 110, h = 110;
  const e = {
    id: uuid(),
    type: 'endegavel',
    x: snap(x - w/2),
    y: snap(y - h/2),
    w, h,
    title: nextEndegavelDefaultTitle(),
    over: { name: '', needsRefill: false },
    pallet: { name: '', needsRefill: false },
  };
  layout.items.push(e);
  selectItem(e.id);
  scheduleAutoSave();
}

function beginDrag(mx, my){
  const it = getItemById(selectedId);
  if (!it) return;

  dragging = true;
  dragStart = {x: mx, y: my};
  dragOriginalPositions = new Map();

  if (it.type === 'pallet' && it.groupId){
    for (const p of getPalletGroupItems(it.groupId)){
      dragOriginalPositions.set(p.id, {x: p.x, y: p.y});
    }
  } else {
    dragOriginalPositions.set(it.id, {x: it.x, y: it.y});
  }
}

function doDrag(mx, my){
  if (!dragging || !dragOriginalPositions) return;
  const dx = snap(mx - dragStart.x);
  const dy = snap(my - dragStart.y);

  for (const [id, pos] of dragOriginalPositions.entries()){
    const it = getItemById(id);
    if (!it) continue;
    it.x = pos.x + dx;
    it.y = pos.y + dy;
  }
  requestDraw();
}

function endDrag(){
  dragging = false;
  dragOriginalPositions = null;
  scheduleAutoSave();
}

function pointerToCanvas(ev){
  const rect = canvas.getBoundingClientRect();
  const mx = (ev.clientX - rect.left) * (logicalSize.w / rect.width);
  const my = (ev.clientY - rect.top) * (logicalSize.h / rect.height);
  return {mx, my};
}

canvas.addEventListener('pointerdown', (ev) => {
  ev.preventDefault();
  canvas.setPointerCapture?.(ev.pointerId);
  const {mx, my} = pointerToCanvas(ev);

  if (mode === 'add_pallet'){
    addPalletAt(mx, my);
    requestDraw();
    return;
  }
  if (mode === 'add_group'){
    addGroupAt(mx, my);
    requestDraw();
    return;
  }
  if (mode === 'add_endegavel'){
    addEndegavelAt(mx, my);
    requestDraw();
    return;
  }

  const hit = hitTest(mx, my);
  if (hit){
    selectItem(hit.id);
    beginDrag(mx, my);
  } else {
    selectItem(null);
  }
});

canvas.addEventListener('pointermove', (ev) => {
  if (!dragging) return;
  const {mx, my} = pointerToCanvas(ev);
  doDrag(mx, my);
});

window.addEventListener('pointerup', () => {
  if (dragging) endDrag();
});

btnDelete.addEventListener('click', () => {
  const it = getItemById(selectedId);
  if (!it) return;

  if (it.type === 'pallet' && it.groupId){
    const groupId = it.groupId;
    layout.items = layout.items.filter(x => !(x.type === 'pallet' && x.groupId === groupId));
    selectItem(null);
    requestDraw();
    scheduleAutoSave();
    return;
  }

  layout.items = layout.items.filter(x => x.id !== it.id);
  selectItem(null);
  requestDraw();
  scheduleAutoSave();
});

btnSave.addEventListener('click', async () => {
  await saveLayout();
});

btnReset.addEventListener('click', async () => {
  if (!confirm('Nullstille hele kartet?')) return;
  await fetch('/api/reset', {method:'POST'});
  await load();
});

for (const b of modeButtons){
  b.addEventListener('click', () => setMode(b.dataset.mode));
}

async function load(){
  const res = await fetch('/api/layout');
  layout = await res.json();

  // Ensure expected fields
  layout.canvas = layout.canvas || {width:1200,height:700,grid:20};
  layout.items = layout.items || [];
  layout.counters = layout.counters || {pallet:0,endegavel:0,group:0};

  // apply canvas size (logical + HiDPI)
  const lw = layout.canvas.width || 1200;
  const lh = layout.canvas.height || 700;
  logicalSize = { w: lw, h: lh };

  dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  canvas.width = Math.floor(lw * dpr);
  canvas.height = Math.floor(lh * dpr);
  // Reset transform then scale so our drawing uses logical units
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  setMode('select');
  selectItem(null);
  updateHint();
  requestDraw();
}

async function saveLayout(){
  try{
    const res = await fetch('/api/layout', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(layout),
    });
    if (!res.ok) throw new Error('Save failed');
    hint.textContent = 'Lagret ✔';
    setTimeout(updateHint, 900);
  }catch(e){
    console.error(e);
    hint.textContent = 'Kunne ikke lagre.';
    setTimeout(updateHint, 1400);
  }
}

load();
