const DOC_PATH = "vag/config";
const SCHABLON_FIELDS = [
  ["perm","Permanentbostad, ton per år"],
  ["fritNormal","Fritidshus normal, ton per år"],
  ["fritLag","Fritidshus låg, ton per år"],
  ["fritIntensiv","Fritidshus intensiv, ton per år"],
  ["skog","Skog, ton per ha och år"],
  ["akerFast","Jordbruk fast belopp, ton"],
  ["akerPerHa","Jordbruk, ton per ha åker"],
  ["akerSmallPerHa","Liten åkerareal, ton per ha"],
  ["akerGrans","Gräns liten åkerareal, ha"],
  ["minKm","Minsta väglängd, km"]
];
const DEFAULT = {
  segments:[], props:[],
  schablon:{perm:2500,fritNormal:900,fritLag:450,fritIntensiv:1800,skog:30,akerFast:1000,akerPerHa:35,akerSmallPerHa:100,akerGrans:20,minKm:0.3,utdebitering:""}
};
let state = structuredClone(DEFAULT);
let selected = null;
let db = null, ref = null, saveTimer = null, dirty = false, saving = false, pendingRemote = null;

const $ = s => document.querySelector(s);
const num = v => { const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : 0; };
const fmt = (n, d=0) => n.toLocaleString("sv-SE",{minimumFractionDigits:d,maximumFractionDigits:d});
const uid = () => Math.random().toString(36).slice(2,9);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

let stTimer=null;
function setStatus(t, warn){ const el=$("#status"); el.textContent=t; el.classList.toggle("warn",!!warn); clearTimeout(stTimer); if(!warn) stTimer=setTimeout(()=>{ if(el.textContent===t) el.textContent=""; },3000); }

/* ---------- calculation ---------- */
/* Average distance to the exit for traffic spread evenly along the given segments.
   Each segment's "mot" names the next segment toward Stav; without it, half the length is used. */
function jamnKm(ids){
  ids=ids||[]; const seg=id=>state.segments.find(x=>x.id===id);
  if (!ids.every(id=>{ const g=seg(id); return g && "mot" in g; })) return segKm(ids)/2;
  const down=id=>{ let s=0, g=seg(seg(id).mot), n=0; while(g && n++<50){ s+=num(g.m); g=seg(g.mot); } return s; };
  let w=0, t=0; ids.forEach(id=>{ const L=num(seg(id).m); w+=L; t+=L*(L/2+down(id)); });
  return w? t/w/1000 : 0;
}
function segKm(ids){
  return (ids||[]).reduce((s,id)=>{ const g=state.segments.find(x=>x.id===id); return s+(g?num(g.m):0); },0)/1000;
}
function calc(){
  const S = state.schablon;
  const fritVal = {lag:num(S.fritLag), normal:num(S.fritNormal), intensiv:num(S.fritIntensiv)};
  const rows = state.props.map(p=>{
    let d = segKm(p.route); if (d>0) d = Math.max(d, num(S.minKm));
    const aker = num(p.akerHa);
    const jord = aker>0 ? (aker>=num(S.akerGrans) ? num(S.akerFast)+num(S.akerPerHa)*aker : num(S.akerSmallPerHa)*aker) : 0;
    const bostad = num(p.perm)*num(S.perm) + num(p.frit)*(fritVal[p.fritNiva||"normal"]||0);
    let dSkog = (p.skogRoute&&p.skogRoute.length) ? segKm(p.skogRoute) : d;
    if (p.skogJamn) dSkog = jamnKm(p.skogRoute&&p.skogRoute.length ? p.skogRoute : p.route);
    const skogTon = num(p.skogHa)*num(S.skog);
    const ton = bostad + jord + skogTon;
    const tkm = (bostad+jord)*d + skogTon*dSkog;
    const fixed = (p.fast!==undefined && p.fast!==null && String(p.fast).trim()!=="") ? num(p.fast) : null;
    return {p, d, dSkog, ton, tkm, fixed, bostad, jord, skogTon};
  });
  const fixedSum = rows.reduce((s,r)=>s+(r.fixed??0),0);
  const S0 = rows.filter(r=>r.fixed===null).reduce((s,r)=>s+r.tkm,0);
  rows.forEach(r=>{ r.share = r.fixed!==null ? r.fixed : (S0>0 ? r.tkm/S0*(100-fixedSum) : 0); r.kr = r.share/100*num(S.utdebitering); });
  // Avrunda till en decimal så att summan blir exakt 100 (största rest)
  const tenths = rows.map(r=>r.share*10), fl = tenths.map(Math.floor);
  let left = Math.round(tenths.reduce((x,y)=>x+y,0)) - fl.reduce((x,y)=>x+y,0);
  tenths.map((t,i)=>[t-fl[i],i]).sort((a,b)=>b[0]-a[0]).forEach(([,i])=>{ if(left>0){ fl[i]++; left--; } });
  rows.forEach((r,i)=>{ r.disp = fl[i]/10; });
  return {rows, fixedSum, total:S0};
}
function typeChips(p){
  const t=[];
  if (num(p.akerHa)>0 || num(p.skogHa)>0) t.push(num(p.akerHa)>0&&num(p.skogHa)>0?"Jord och skog":num(p.skogHa)>0?"Skog":"Jordbruk");
  if (num(p.perm)>0) t.push(num(p.perm)>1?num(p.perm)+" permanent":"Permanent");
  if (num(p.frit)>0) t.push((num(p.frit)>1?num(p.frit)+" ":"")+"Fritid"+(p.fritNiva&&p.fritNiva!=="normal"?" ("+p.fritNiva+")":""));
  if (p.fast!==undefined&&p.fast!==null&&String(p.fast).trim()!=="") t.push("Fast andel");
  return t.map(x=>`<span class="chip">${esc(x)}</span>`).join("") || `<span class="chip">Ej angiven</span>`;
}

/* ---------- rendering ---------- */
function renderPublic(){
  const el=document.getElementById("pubShares"); if(!el) return;
  const {rows}=calc(); const sorted=[...rows].sort((a,b)=>b.share-a.share);
  const kr=num(state.schablon.utdebitering)>0;
  el.innerHTML = sorted.length ? sorted.map(r=>`<div class="share-row"><span class="sname">${esc(r.p.namn)}</span><span class="sval">${fmt(r.disp,1)} %${kr?`<small>${fmt(Math.round(r.kr))} kr per år</small>`:""}</span></div>`).join("")
    + `<div class="share-row total"><span class="sname">Totalt</span><span class="sval">${fmt(rows.reduce((s,r)=>s+r.disp,0),1)} %</span></div>` : `<p class="empty">Inga andelstal ännu.</p>`;
}
function renderSummary(){
  renderPublic();
  const {rows,total} = calc();
  const showKr = num(state.schablon.utdebitering)>0;
  const sorted = [...rows].sort((a,b)=>b.share-a.share);
  $("#summary tbody").innerHTML = sorted.map(r=>`<tr data-row="${r.p.id}" class="${r.p.id===selected?"sel":""}">
    <td>${esc(r.p.namn||"Namnlös")}</td><td>${typeChips(r.p)}</td>
    <td class="num">${r.fixed!==null?"":fmt(r.d,2)+" km"}</td>
    <td class="num">${r.fixed!==null?"":fmt(r.tkm)}</td>
    <td class="num">${r.p.andel2012?esc(String(r.p.andel2012).replace(".",","))+" %":"ny"}</td>
    <td class="num share">${fmt(r.disp,1)} %</td>
    ${showKr?`<td class="num">${fmt(Math.round(r.kr))}</td>`:""}</tr>`).join("");
  const sumShare = rows.reduce((s,r)=>s+r.disp,0), sumKr = rows.reduce((s,r)=>s+r.kr,0);
  $("#summary tfoot").innerHTML = `<tr><td>Totalt</td><td></td><td></td><td class="num">${fmt(total)}</td><td></td><td class="num">${fmt(sumShare,1)} %</td>${showKr?`<td class="num">${fmt(Math.round(sumKr))}</td>`:""}</tr>`;
  document.querySelector("#summary th.kr").style.display = showKr?"":"none";
  rows.forEach(r=>{ const el=document.getElementById("calc-"+r.p.id); if(el) el.textContent = calcText(r); });
}
function calcText(r){
  if (r.fixed!==null) return `Fast andel ${fmt(r.fixed,1)} %. Övriga fält påverkar inte resultatet.`;
  const parts=[];
  if (r.bostad) parts.push(`bostäder ${fmt(r.bostad)} ton`);
  if (r.jord) parts.push(`jordbruk ${fmt(r.jord)} ton`);
  if (r.skogTon) parts.push(`skog ${fmt(r.skogTon)} ton på ${fmt(r.dSkog,2)} km`);
  return (parts.length?parts.join(", ")+". ":"") + `Väg ${fmt(r.d,2)} km, ${fmt(r.tkm)} tonkm, andel ${fmt(r.disp,1)} %.`;
}
function segBoxes(p, key){
  return state.segments.map(g=>{
    const on=(p[key]||[]).includes(g.id); const id=`${key}-${p.id}-${g.id}`;
    return `<label class="seg ${on?"on":""}" for="${id}" title="${esc(g.namn)}"><input type="checkbox" id="${id}" data-p="${p.id}" data-key="${key}" data-seg="${esc(g.id)}" ${on?"checked":""}>${esc(g.id)}</label>`;
  }).join("") || `<span class="hint">Lägg till delsträckor längre ner.</span>`;
}
function renderPick(){
  if (!state.props.find(p=>p.id===selected)) selected = state.props[0]?.id ?? null;
  const sorted=[...state.props].sort((a,b)=>String(a.namn).localeCompare(String(b.namn),"sv"));
  $("#pick").innerHTML = sorted.map(p=>`<option value="${p.id}" ${p.id===selected?"selected":""}>${esc(p.namn||"Namnlös")}</option>`).join("") || `<option value="">Inga fastigheter</option>`;
}
const TYPER=[["perm","Permanentbostad"],["frit","Fritidshus"],["jord","Jord och skogsbruk utan bostad"],["jordperm","Jord och skogsbruk med permanentbostad"],["jordfrit","Jord och skogsbruk med fritidshus"],["annan","Annat, fast andel"]];
function typOf(p){
  if (p.typ) return p.typ;
  const j=num(p.akerHa)>0||num(p.skogHa)>0;
  if (String(p.fast??"").trim()!=="") return "annan";
  return j ? (num(p.perm)>0?"jordperm":num(p.frit)>0?"jordfrit":"jord") : (num(p.frit)>0&&!num(p.perm)?"frit":"perm");
}
function setTyp(p,t){
  p.typ=t;
  const jord=t.startsWith("jord"), perm=t==="perm"||t==="jordperm", frit=t==="frit"||t==="jordfrit";
  if (perm){ if(!num(p.perm)) p.perm=1; } else p.perm=0;
  if (frit){ if(!num(p.frit)) p.frit=1; } else p.frit=0;
  if (!jord){ p.akerHa=0; p.skogHa=0; p.skogRoute=[]; p.skogJamn=false; }
  if (t!=="annan") p.fast="";
}
let editProp=null;
document.addEventListener("click", e=>{
  const u=e.target.closest("[data-unlock]"); if(u){ editProp=u.dataset.unlock; renderCards(); const f=document.getElementById("namn-"+editProp); if(f) f.focus(); return; }
  if (e.target.closest("[data-lock]")){ editProp=null; renderCards(); renderSummary(); }
});
function renderCards(){
  renderPick();
  $("#cards").innerHTML = state.props.filter(p=>p.id===selected).map(p=>{
    const t=typOf(p), jord=t.startsWith("jord"), perm=t==="perm"||t==="jordperm", frit=t==="frit"||t==="jordfrit";
    const ed=editProp===p.id;
    return `<div class="panel card${ed?" editing":""}" data-card="${p.id}">
    <div class="card-head">
      ${ed?`<input id="namn-${p.id}" aria-label="Fastighetens namn" data-p="${p.id}" data-f="namn" value="${esc(p.namn)}">`:`<h3 class="pname">${esc(p.namn)}</h3>`}
      ${ed?`<button type="button" data-lock="1">Klar</button>`:`<button type="button" class="ghost" data-unlock="${p.id}">Redigera</button>`}
    </div>
    ${ed?"":`<p class="hint">Tryck på Redigera för att ändra uppgifterna.</p>`}
    <fieldset class="lockwrap" ${ed?"":"disabled"}>
    <label for="typ-${p.id}">Typ av fastighet<select id="typ-${p.id}" data-typ="${p.id}">${TYPER.map(([v,l])=>`<option value="${v}" ${v===t?"selected":""}>${l}</option>`).join("")}</select></label>
    ${perm?`<fieldset class="fs"><legend>Bostad</legend>
      <label for="perm-${p.id}">Antal permanentbostäder<input id="perm-${p.id}" inputmode="numeric" data-p="${p.id}" data-f="perm" value="${esc(p.perm??1)}"></label></fieldset>`:""}
    ${frit?`<fieldset class="fs"><legend>Fritidshus</legend><div class="grid2">
      <label for="frit-${p.id}">Antal fritidshus<input id="frit-${p.id}" inputmode="numeric" data-p="${p.id}" data-f="frit" value="${esc(p.frit??1)}"></label>
      <label for="fritNiva-${p.id}">Hur mycket används det<select id="fritNiva-${p.id}" data-p="${p.id}" data-f="fritNiva">
        ${["lag","normal","intensiv"].map(v=>`<option value="${v}" ${(p.fritNiva||"normal")===v?"selected":""}>${v==="lag"?"Lite":v==="normal"?"Normalt":"Mycket"}</option>`).join("")}</select></label></div></fieldset>`:""}
    ${jord?`<fieldset class="fs"><legend>Mark</legend><div class="grid2">
      <label for="akerHa-${p.id}">Åker och bete, ha<input id="akerHa-${p.id}" inputmode="decimal" data-p="${p.id}" data-f="akerHa" value="${esc(p.akerHa??0)}"></label>
      <label for="skogHa-${p.id}">Produktiv skog, ha<input id="skogHa-${p.id}" inputmode="decimal" data-p="${p.id}" data-f="skogHa" value="${esc(p.skogHa??0)}"></label></div></fieldset>`:""}
    ${t==="annan"?`<fieldset class="fs"><legend>Fast andel</legend>
      <label for="fast-${p.id}">Andel i procent<input id="fast-${p.id}" inputmode="decimal" data-p="${p.id}" data-f="fast" value="${esc(p.fast??"")}"></label></fieldset>`:""}
    <fieldset class="fs"><legend>Vägen</legend>
      <label>${jord?(perm||frit?"Bostad och jordbruk kör på delsträckor":"Jordbruket kör på delsträckor"):"Kör på delsträckor"} ut till Stav</label><div class="segs">${segBoxes(p,"route")}</div>
      ${jord?`<label>Skogen kör på delsträckor (tomt = samma som ovan)</label><div class="segs">${segBoxes(p,"skogRoute")}</div>
      <label class="check" for="jamn-${p.id}"><input type="checkbox" id="jamn-${p.id}" data-p="${p.id}" data-f="skogJamn" ${p.skogJamn?"checked":""}>Skogen ligger jämnt utmed sträckan</label>`:""}
    </fieldset>
    <details class="more"><summary>Fler uppgifter</summary>
      <label for="a2012-${p.id}">Andel i förslaget 2012, %<input id="a2012-${p.id}" inputmode="decimal" data-p="${p.id}" data-f="andel2012" value="${esc(String(p.andel2012??"").replace(".",","))}"></label>
      <label for="note-${p.id}">Anteckning (syns bara här)<textarea id="note-${p.id}" rows="2" data-p="${p.id}" data-f="note">${esc(p.note)}</textarea></label>
    </details>
    ${ed?`<div class="row"><button type="button" class="danger" data-del="${p.id}">Ta bort fastigheten</button></div>`:""}
    </fieldset>
    <div class="calc" id="calc-${p.id}"></div>
  </div>`; }).join("");
}
document.addEventListener("change", e=>{
  const id=e.target.dataset&&e.target.dataset.typ; if(!id) return;
  const p=state.props.find(x=>x.id===id); if(!p) return;
  setTyp(p,e.target.value); renderCards(); renderSummary(); scheduleSave();
});
function renderSegments(){
  $("#segtable tbody").innerHTML = state.segments.map((g,i)=>`<tr>
    <td><input id="segid-${i}" aria-label="Beteckning" data-seg-i="${i}" data-sf="id" value="${esc(g.id)}" style="width:70px"></td>
    <td><input id="segnamn-${i}" aria-label="Sträcka" data-seg-i="${i}" data-sf="namn" value="${esc(g.namn)}"></td>
    <td class="num"><input id="segm-${i}" aria-label="Meter" inputmode="decimal" data-seg-i="${i}" data-sf="m" value="${esc(g.m)}" style="width:90px;text-align:right"></td>
    <td><button type="button" class="danger" data-segdel="${i}">Ta bort</button></td></tr>`).join("");
}
function renderSchablon(){
  $("#schablon").innerHTML = SCHABLON_FIELDS.map(([k,l])=>`<label for="s-${k}">${l}<input id="s-${k}" inputmode="decimal" data-s="${k}" value="${esc(state.schablon[k])}"></label>`).join("");
}
function renderAll(){ renderCards(); renderSegments(); renderSchablon(); const u=document.getElementById("utdeb"); if(u && document.activeElement!==u) u.value = state.schablon.utdebitering ?? ""; renderSummary(); }

let openTab="edit";
function renderTabs(){
  document.querySelectorAll(".tab").forEach(b=>{ const on=b.dataset.tab===openTab; b.setAttribute("aria-selected",on?"true":"false"); b.setAttribute("aria-expanded",on?"true":"false"); });
  document.querySelectorAll(".tabpanel").forEach(p=>{ p.hidden = p.id!=="tab-"+openTab; });
}
/* ---------- events ---------- */
document.addEventListener("input", e=>{
  const t=e.target;
  if (t.dataset.f && t.dataset.p){
    const p=state.props.find(x=>x.id===t.dataset.p); if(!p) return;
    p[t.dataset.f] = t.type==="checkbox" ? t.checked : t.value;
  } else if (t.dataset.key){
    const p=state.props.find(x=>x.id===t.dataset.p); if(!p) return;
    const arr=new Set(p[t.dataset.key]||[]); t.checked?arr.add(t.dataset.seg):arr.delete(t.dataset.seg);
    p[t.dataset.key]=state.segments.map(g=>g.id).filter(id=>arr.has(id));
    t.closest(".seg").classList.toggle("on",t.checked);
  } else if (t.dataset.segI!==undefined){
    const g=state.segments[+t.dataset.segI]; const old=g.id; g[t.dataset.sf]=t.value;
    if (t.dataset.sf==="id"){ state.props.forEach(p=>["route","skogRoute"].forEach(k=>{ if(p[k]) p[k]=p[k].map(x=>x===old?t.value:x); })); }
  } else if (t.dataset.s){
    state.schablon[t.dataset.s]=t.value;
  } else return;
  renderSummary(); scheduleSave();
});
document.addEventListener("change", e=>{ if (e.target.dataset.sf==="id"||e.target.dataset.sf==="namn") renderCards(), renderSummary(); if (e.target.dataset.f==="namn") renderPick(); });
document.addEventListener("change", e=>{ if(e.target.id==="pick"){ selected=e.target.value; editProp=null; renderCards(); renderSummary(); } });
document.addEventListener("click", e=>{
  const tr=e.target.closest("#summary tbody tr[data-row]");
  if (tr){ selected=tr.dataset.row; openTab="edit"; renderTabs(); renderCards(); renderSummary(); document.getElementById("pick").scrollIntoView({behavior:"smooth",block:"start"}); return; }
  const t=e.target.closest("button"); if(!t) return;
  if (t.id==="pdf"){ makePdf(); return; }
  if (t.dataset.tab){ openTab = openTab===t.dataset.tab ? null : t.dataset.tab; renderTabs(); return; }
  if (t.dataset.del){
    if (t.dataset.confirm!=="1"){ t.dataset.confirm="1"; t.textContent="Tryck igen för att ta bort"; setTimeout(()=>{ if(t.isConnected){t.dataset.confirm="";t.textContent="Ta bort fastigheten";}},3000); return; }
    state.props=state.props.filter(p=>p.id!==t.dataset.del); selected=null; editProp=null; renderCards(); renderSummary(); scheduleSave();
  } else if (t.dataset.segdel!==undefined){
    if (t.dataset.confirm!=="1"){ t.dataset.confirm="1"; t.textContent="Bekräfta"; setTimeout(()=>{ if(t.isConnected){t.dataset.confirm="";t.textContent="Ta bort";}},3000); return; }
    const g=state.segments.splice(+t.dataset.segdel,1)[0];
    state.props.forEach(p=>["route","skogRoute"].forEach(k=>{ if(p[k]) p[k]=p[k].filter(x=>x!==g.id); }));
    renderAll(); scheduleSave();
  } else if (t.id==="addProp"){
    const p={id:uid(),namn:"Ny fastighet",typ:"perm",perm:1,frit:0,fritNiva:"normal",akerHa:0,skogHa:0,route:[],skogRoute:[],skogJamn:false,fast:"",note:""};
    state.props.push(p); selected=p.id; editProp=p.id; renderCards(); renderSummary(); scheduleSave();
    const el=document.getElementById("namn-"+p.id); if(el){ el.focus(); el.select(); }
  } else if (t.id==="addSeg"){
    state.segments.push({id:String.fromCharCode(65+state.segments.length),namn:"Ny delsträcka",m:0}); renderAll(); scheduleSave();
  } else if (t.id==="copy"){
    const {rows}=calc();
    const kr=num(state.schablon.utdebitering)>0;
    const txt=["Fastighet\tAndel"+(kr?"\tKr per år":""),...[...rows].sort((a,b)=>b.share-a.share).map(r=>`${r.p.namn}\t${fmt(r.disp,1)} %`+(kr?`\t${fmt(Math.round(r.kr))}`:""))].join("\n");
    navigator.clipboard.writeText(txt).then(()=>$("#copied").textContent="Kopierat.",()=>$("#copied").textContent="Kunde inte kopiera, markera tabellen och kopiera själv.");
  }
});


/* ---------- read only ---------- */
let readOnly=true;
function applyReadOnly(){
  document.getElementById("readonly").hidden=!readOnly;
  document.body.classList.toggle("is-admin",!readOnly);
  ["tabbtn-edit","tabbtn-segs","tabbtn-schab"].forEach(id=>{ const b=document.getElementById(id); if(b) b.hidden=readOnly; });
  if (readOnly && openTab!=="karta"){ openTab="karta"; renderTabs(); }
}

/* ---------- PDF ---------- */
const NBSP=/ | /g;
const pdfText=t=>String(t??"").replace(NBSP," ").replace(/−/g,"–");
function pdfName(n){ return String(n||"").replace(/\s*\((?!tidigare)[^)]*\)/g,"").trim(); }
function routeText(p){
  const ids=new Set([...(p.route||[]),...((num(p.skogHa)>0&&p.skogRoute)||[])]);
  return state.segments.map(g=>g.id).filter(id=>ids.has(id)).join(", ");
}
function typeText(p){
  const ha=num(p.akerHa)+num(p.skogHa);
  const t=[];
  if (num(p.akerHa)>0||num(p.skogHa)>0) t.push("Jord och skogsbruk");
  if (num(p.perm)>0) t.push((t.length?"med ":"")+(num(p.perm)>1?num(p.perm)+" permanentbostäder":"permanentbostad"));
  if (num(p.frit)>0) t.push((t.length?"med ":"")+(num(p.frit)>1?num(p.frit)+" fritidshus":"fritidsbostad"));
  let s=t.join(" ").replace(/^./,c=>c.toUpperCase());
  if ((num(p.akerHa)>0||num(p.skogHa)>0) && !num(p.perm) && !num(p.frit)) s+=" utan bostad";
  if (ha>0) s+=`, ${fmt(ha)} ha`;
  return s||"Ej angiven";
}
async function imgData(src){
  const r=await fetch(src); const b=await r.blob();
  return await new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsDataURL(b); });
}
async function makePdf(){
  const btn=$("#pdf"); const old=btn.innerHTML; btn.disabled=true; btn.innerHTML="<strong>Skapar PDF…</strong>";
  try{
    if (!window.jspdf) throw new Error("lib");
    const {jsPDF}=window.jspdf; const doc=new jsPDF({unit:"mm",format:"a4"});
    const W=210, M=18, CW=W-2*M; let y=M;
    const green=[47,107,79], ink=[31,42,36], muted=[93,106,98];
    const today=new Date().toLocaleDateString("sv-SE",{year:"numeric",month:"long",day:"numeric"});
    const {rows}=calc(); const sorted=[...rows].sort((a,b)=>b.share-a.share);
    const S=state.schablon; const showKr=num(S.utdebitering)>0;
    const para=(t,size=10.5,color=ink,gap=2)=>{ doc.setFont("helvetica","normal"); doc.setFontSize(size); doc.setTextColor(...color); const lines=doc.splitTextToSize(pdfText(t),CW); if(y+lines.length*size*0.42>285){doc.addPage(); y=M;} doc.text(lines,M,y); y+=lines.length*size*0.42+gap; };
    const head=t=>{ if(y>255){doc.addPage(); y=M;} y+=3; doc.setFont("helvetica","bold"); doc.setFontSize(13.5); doc.setTextColor(...green); doc.text(pdfText(t),M,y); y+=7; };
    const table=(h,b,opts={})=>{ doc.autoTable(Object.assign({head:[h.map(pdfText)],body:b.map(r=>r.map(pdfText)),startY:y,margin:{left:M,right:M},theme:"grid",styles:{font:"helvetica",fontSize:9,cellPadding:1.8,textColor:ink,lineColor:[214,220,212],lineWidth:0.2},headStyles:{fillColor:green,textColor:255,fontStyle:"bold"},alternateRowStyles:{fillColor:[244,245,241]}},opts)); y=doc.lastAutoTable.finalY+5; };
    // band
    doc.setFillColor(...green); doc.rect(0,0,W,38,"F");
    doc.setTextColor(255); doc.setFont("helvetica","normal"); doc.setFontSize(10); doc.text(pdfText("Baggetorp Hytternäs vägsamfällighet · väg 13986"),M,13);
    doc.setFont("helvetica","bold"); doc.setFontSize(22); doc.text(pdfText("Förslag till nya andelstal"),M,25);
    doc.setFont("helvetica","normal"); doc.setFontSize(10); doc.text(pdfText("Utkast för diskussion, "+today),M,32);
    y=48;
    head("Sammanfattning");
    para("Förslaget är räknat på samma sätt som Lantmäteriet gör vid en förrättning. Gällande andelstal kommer från förrättningen 1958. Ett förslag togs fram 2012 men antogs aldrig, och sedan dess har flera fastigheter tillkommit.");
    para("Stämmer inte uppgifterna om din fastighet? Hör av dig till styrelsen.");
    head("Hur andelstalen räknas");
    para("Andelen bygger på hur mycket trafik fastigheten ger och hur långt den kör på vägen ut till Stav. Trafiken gånger väglängden ger fastighetens belastning, och andelen är dess del av summan för alla fastigheter. Kortaste räknade väglängd är "+fmt(num(S.minKm)*1000)+" meter.");
    table(["Fastighetstyp","Trafik per år enligt Lantmäteriets schablon"],[
      ["Permanentbostad",fmt(num(S.perm))+" ton"],
      ["Fritidsbostad",fmt(num(S.fritNormal))+" ton"],
      ["Skogsbruk",fmt(num(S.skog))+" ton per hektar skog"],
      ["Jordbruk",fmt(num(S.akerFast))+" ton plus "+fmt(num(S.akerPerHa))+" ton per hektar åker, eller "+fmt(num(S.akerSmallPerHa))+" ton per hektar vid mindre än "+fmt(num(S.akerGrans))+" ha åker"]]);
    para("En gård med bostad räknas med både bostaden och sin mark.",9.5,muted);
    // map
    doc.addPage(); y=M;
    head("Vägen och delsträckorna");
    try{ const img=await imgData("vagkarta.png"); const h=CW*1200/1474; doc.addImage(img,"PNG",M,y,CW,h); y+=h+5; }catch(e){ para("Kartan kunde inte läggas in.",9.5,muted); }
    const segTot=state.segments.reduce((s,g)=>s+num(g.m),0);
    table(["Delsträcka","Sträcka","Längd"],state.segments.map(g=>[g.id,g.namn,"cirka "+fmt(num(g.m))+" m"]).concat([["","Totalt","cirka "+fmt(segTot)+" m"]]),{columnStyles:{0:{cellWidth:24},2:{cellWidth:32,halign:"right"}}});
    para("Längderna är uppmätta på fastighetskartan.",9,muted);
    // properties
    doc.addPage(); y=M;
    head("Fastigheterna och föreslagna andelar");
    const h1=["Fastighet","Typ","Kör på delsträcka","Väglängd","Förslag 2012","Ny andel"].concat(showKr?["Kr per år"]:[]);
    const b1=sorted.map(r=>{
      const vl = r.fixed!==null ? "" : fmt(r.d,1)+" km";
      return [pdfName(r.p.namn),typeText(r.p),routeText(r.p),vl,r.p.andel2012?r.p.andel2012.replace(".",",")+" %":"ny",fmt(r.disp,1)+" %"].concat(showKr?[fmt(Math.round(r.kr))]:[]);
    });
    b1.push(["Totalt","","","","100 %",fmt(rows.reduce((s,r)=>s+r.disp,0),1)+" %"].concat(showKr?[fmt(Math.round(rows.reduce((s,r)=>s+r.kr,0)))]:[]));
    table(h1,b1,{styles:{font:"helvetica",fontSize:8.5,cellPadding:1.6,textColor:ink,lineColor:[214,220,212],lineWidth:0.2},columnStyles:{0:{cellWidth:30,fontStyle:"bold"},3:{halign:"right",cellWidth:24},4:{halign:"right",cellWidth:17},5:{halign:"right",fontStyle:"bold",cellWidth:17},6:{halign:"right"}},didParseCell:d=>{ if(d.section==="body"&&d.row.index===b1.length-1){ d.cell.styles.fontStyle="bold"; } }});
    if (showKr) para("Kronorna visar hur "+fmt(num(S.utdebitering))+" kr per år fördelas enligt de nya andelarna.",9,muted);
    head("Underlag");
    ["Beräkningen följer Lantmäteriets tonkilometermetod och dess schablonvärden.",
     "Gällande förrättning är från 1958 (akt 04-MEL-1291.1). Nya andelstal kan antas genom en överenskommelse mellan medlemmarna."].forEach(t=>para("•  "+t,9.5,ink,1.2));
    const pages=doc.getNumberOfPages();
    for(let i=1;i<=pages;i++){ doc.setPage(i); doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...muted); doc.text(pdfText("Baggetorp Hytternäs vägsamfällighet · Förslag till nya andelstal · sida "+i+" av "+pages),M,292); }
    const blob=doc.output("blob");
    const dl=await claude.use("downloads");
    if (!dl) throw {code:"unavailable"};
    await dl.save({filename:"Förslag nya andelstal Baggetorp Hytternäs.pdf",data:blob});
    setStatus("PDF skapad");
  }catch(e){
    if (e && e.code==="declined") setStatus("PDF sparades inte");
    else if (e && e.message==="lib") setStatus("PDF verktyget kunde inte laddas. Ladda om sidan.",true);
    else setStatus("Kunde inte skapa PDF. Ladda om sidan och försök igen.",true);
  }finally{ btn.disabled=false; btn.innerHTML=old; }
}
/* ---------- storage ---------- */
function scheduleSave(){
  if (readOnly) return;
  dirty=true; if(!ref){ setStatus("Sparas inte: lagringen är inte tillgänglig i den här vyn.",true); return; }
  setStatus("Osparade ändringar…"); clearTimeout(saveTimer); saveTimer=setTimeout(save,900);
}
async function save(){
  if (saving){ scheduleSave(); return; }
  saving=true; dirty=false;
  try{ await ref.set(JSON.parse(JSON.stringify(state))); setStatus("Sparat"); }
  catch(err){
    if (err && err.code==="unavailable"){ setTimeout(save, 1500+Math.random()*1000); }
    else setStatus(err && err.code==="invalid_argument" ? "Du har inte behörighet att ändra, bara att läsa." : "Kunde inte spara. Försök igen om en stund.", true);
  } finally { saving=false; }
  if (pendingRemote && !dirty){ applyRemote(pendingRemote); pendingRemote=null; }
}
function applyRemote(data){
  data = JSON.parse(JSON.stringify(data||{}));
  const editing = document.activeElement && document.activeElement.closest && document.activeElement.closest("main") && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (dirty || saving || editing){ pendingRemote=data; return; }
  state = Object.assign(structuredClone(DEFAULT), data, {schablon:Object.assign({},DEFAULT.schablon,data.schablon||{})});
  renderAll();
}
document.addEventListener("focusout", ()=>{ setTimeout(()=>{ if(pendingRemote && !dirty && !saving){ const d=pendingRemote; pendingRemote=null; applyRemote(d);} },50); });

renderAll(); renderTabs(); applyReadOnly();
(async ()=>{
  const timer=setTimeout(()=>setStatus("Kan inte nå lagringen ännu. Visar standardvärden.",true),10000);
  try{
    try{ const u=await claude.use("user"); if(u){ const ow=await u.isOwner(); readOnly = ow!==true; applyReadOnly(); } }catch(e){}
    db = await claude.use("db");
    if (!db){ clearTimeout(timer); setStatus("Lagringen är inte tillgänglig här. Ändringar sparas inte.",true); return; }
    ref = db.doc(DOC_PATH);
    ref.onSnapshot(snap=>{
      if (!snap.metadata.fromCache) clearTimeout(timer);
      if (snap.metadata.hasPendingWrites) return;
      if (snap.exists){ applyRemote(snap.data()); if(!dirty) setStatus("Sparat"); }
      else if (!snap.metadata.fromCache){ setStatus("Inga sparade uppgifter ännu. Lägg till fastigheter."); }
    }, err=>{ clearTimeout(timer); setStatus("Kontakten med lagringen bröts. Ladda om sidan för att fortsätta spara.",true); ref=null; });
  }catch(e){ clearTimeout(timer); setStatus("Lagringen är inte tillgänglig här. Ändringar sparas inte.",true); }
})();
