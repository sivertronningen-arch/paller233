
let pallets = [];
let selectedId = null;
let drawMode = false;
let dragStart = null;

const overlay = document.getElementById("overlay");
const planImg = document.getElementById("planImg");
const panelTitle = document.getElementById("panelTitle");
const articlesArea = document.getElementById("articlesArea");
const saveBtn = document.getElementById("saveBtn");
const cancelBtn = document.getElementById("cancelBtn");
const deletePalletBtn = document.getElementById("deletePalletBtn");
const resultsBox = document.getElementById("resultsBox");

const drawToggle = document.getElementById("drawToggle");
const drawBox = document.getElementById("drawBox");

const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const clearBtn = document.getElementById("clearBtn");

function clamp01(v){ return Math.max(0, Math.min(1, v)); }

async function apiGet(url){
  const r = await fetch(url);
  const j = await r.json();
  if(!r.ok) throw new Error(j.error || "Feil");
  return j;
}
async function apiSend(url, method, body){
  const r = await fetch(url, {
    method,
    headers: {"Content-Type":"application/json"},
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json();
  if(!r.ok) throw new Error(j.error || "Feil");
  return j;
}

function render(){
  overlay.innerHTML = "";
  // compute overlay size based on image rendered size
  const rect = planImg.getBoundingClientRect();
  overlay.style.width = rect.width + "px";
  overlay.style.height = rect.height + "px";

  for(const p of pallets){
    const el = document.createElement("div");
    el.className = "pallet" + (p.id === selectedId ? " selected" : "");
    el.dataset.id = p.id;

    el.style.left = (p.x * 100) + "%";
    el.style.top = (p.y * 100) + "%";
    el.style.width = (p.w * 100) + "%";
    el.style.height = (p.h * 100) + "%";

    el.textContent = p.name;
    el.addEventListener("click", (e)=>{ e.stopPropagation(); selectPallet(p.id); });
    overlay.appendChild(el);
  }
}

function setHitHighlights(matchIds){
  const els = overlay.querySelectorAll(".pallet");
  els.forEach(el=>{
    const id = parseInt(el.dataset.id, 10);
    if(matchIds.includes(id)) el.classList.add("hit");
    else el.classList.remove("hit");
  });
}

function clearSelectionUI(){
  selectedId = null;
  panelTitle.textContent = "Ingen pall valgt";
  articlesArea.value = "";
  articlesArea.disabled = true;
  saveBtn.disabled = true;
  cancelBtn.disabled = true;
  deletePalletBtn.classList.add("hidden");
  render();
}

function enableEditor(pallet){
  panelTitle.textContent = pallet.name;
  articlesArea.disabled = false;
  articlesArea.value = (pallet.articles || []).join("\n");
  saveBtn.disabled = false;
  cancelBtn.disabled = false;
  deletePalletBtn.classList.remove("hidden");
}

function selectPallet(id){
  selectedId = id;
  const p = pallets.find(x=>x.id===id);
  if(!p) return;
  enableEditor(p);
  render();
}

async function loadPallets(){
  pallets = await apiGet("/api/pallets");
  if(selectedId && !pallets.find(p=>p.id===selectedId)) selectedId = null;
  render();
}

saveBtn.addEventListener("click", async ()=>{
  if(!selectedId) return;
  const lines = articlesArea.value.split("\n").map(s=>s.trim()).filter(Boolean);
  try{
    await apiSend(`/api/pallets/${selectedId}/articles`, "PUT", {articles: lines});
    await loadPallets();
    selectPallet(selectedId);
  }catch(err){
    alert(err.message);
  }
});

cancelBtn.addEventListener("click", ()=>{
  if(!selectedId) return;
  const p = pallets.find(x=>x.id===selectedId);
  if(!p) return;
  articlesArea.value = (p.articles || []).join("\n");
});

deletePalletBtn.addEventListener("click", async ()=>{
  if(!selectedId) return;
  const p = pallets.find(x=>x.id===selectedId);
  if(!p) return;
  if(!confirm(`Slette ${p.name}?`)) return;
  try{
    await apiSend(`/api/pallets/${selectedId}`, "DELETE");
    clearSelectionUI();
    await loadPallets();
  }catch(err){
    alert(err.message);
  }
});

overlay.addEventListener("click", ()=>{
  // click empty map = clear selection
  clearSelectionUI();
});

function getRelativeFromEvent(evt){
  const r = overlay.getBoundingClientRect();
  const x = (evt.clientX - r.left) / r.width;
  const y = (evt.clientY - r.top) / r.height;
  return {x: clamp01(x), y: clamp01(y), width: r.width, height: r.height, left: r.left, top: r.top};
}

drawToggle.addEventListener("click", ()=>{
  drawMode = !drawMode;
  drawToggle.textContent = drawMode ? "✅ Tegn: på (klikk for av)" : "➕ Legg til pall";
  overlay.style.cursor = drawMode ? "crosshair" : "default";
});

overlay.addEventListener("mousedown", (evt)=>{
  if(!drawMode) return;
  dragStart = getRelativeFromEvent(evt);
  drawBox.classList.remove("hidden");
  drawBox.style.left = (dragStart.x*100) + "%";
  drawBox.style.top = (dragStart.y*100) + "%";
  drawBox.style.width = "0%";
  drawBox.style.height = "0%";
});

window.addEventListener("mousemove", (evt)=>{
  if(!drawMode || !dragStart) return;
  const cur = getRelativeFromEvent(evt);
  const x1 = Math.min(dragStart.x, cur.x);
  const y1 = Math.min(dragStart.y, cur.y);
  const x2 = Math.max(dragStart.x, cur.x);
  const y2 = Math.max(dragStart.y, cur.y);
  drawBox.style.left = (x1*100) + "%";
  drawBox.style.top = (y1*100) + "%";
  drawBox.style.width = ((x2-x1)*100) + "%";
  drawBox.style.height = ((y2-y1)*100) + "%";
});

window.addEventListener("mouseup", async (evt)=>{
  if(!drawMode || !dragStart) return;
  const cur = getRelativeFromEvent(evt);
  const x1 = Math.min(dragStart.x, cur.x);
  const y1 = Math.min(dragStart.y, cur.y);
  const x2 = Math.max(dragStart.x, cur.x);
  const y2 = Math.max(dragStart.y, cur.y);
  dragStart = null;
  drawBox.classList.add("hidden");

  const w = x2-x1, h = y2-y1;
  if(w < 0.01 || h < 0.01){
    return; // too small
  }
  try{
    const created = await apiSend("/api/pallets", "POST", {x:x1,y:y1,w:w,h:h});
    await loadPallets();
    selectPallet(created.id);
  }catch(err){
    alert(err.message);
  }
});

searchBtn.addEventListener("click", doSearch);
searchInput.addEventListener("keydown", (e)=>{ if(e.key==="Enter") doSearch(); });

async function doSearch(){
  const q = searchInput.value.trim();
  if(!q){ return; }
  try{
    const res = await apiGet(`/api/search?article=${encodeURIComponent(q)}`);
    const ids = res.matches.map(m=>m.id);
    setHitHighlights(ids);

    if(res.matches.length === 0){
      resultsBox.textContent = `Fant ingen pall for artikkel ${q}.`;
    }else{
      const lines = res.matches.map(m=>`${m.name} (id ${m.id})`);
      resultsBox.textContent = `Artikkel ${q} ligger på:\n` + lines.join("\n");
      // auto focus first match
      selectPallet(res.matches[0].id);
      // scroll to selected pallet
      const el = overlay.querySelector(`.pallet[data-id="${res.matches[0].id}"]`);
      if(el) el.scrollIntoView({behavior:"smooth", block:"center", inline:"center"});
    }
  }catch(err){
    alert(err.message);
  }
}

clearBtn.addEventListener("click", ()=>{
  searchInput.value = "";
  resultsBox.textContent = "—";
  setHitHighlights([]);
});

window.addEventListener("resize", render);

(async function init(){
  await loadPallets();
  resultsBox.textContent = "—";
})();
