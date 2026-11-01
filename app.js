/* ---------- Portal: start page, members, board, meetings, fault reports, feedback ----------
   site/main          one doc: intro, nyheter, moten, styrelse, medlemmar (styrelsen skriver)
   felanmalan/<uid>   one doc per medlem: {items:[...]} (alla läser, var och en skriver sin egen)
   synpunkter/<uid>   one doc per medlem: {items:[...]} (medlemmen och styrelsen läser) */
(function(){
const q=s=>document.querySelector(s);
const E=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const nid=()=>Math.random().toString(36).slice(2,9);
const today=()=>new Date().toISOString().slice(0,10);
const dfmt=d=>{ if(!d) return ""; const t=new Date(d+"T12:00:00"); return isNaN(t)?E(d):t.toLocaleDateString("sv-SE",{day:"numeric",month:"long",year:"numeric"}); };
let board=false, canWrite=false, me=null, U=null, DB=null, siteRef=null;
let site={intro:"",nyheter:[],moten:[],styrelse:[],medlemmar:[]};
let fel={}, syn={}, siteSaving=false, siteDirty=false, editIntro=false;
const editing=new Set();

/* sidhuvudets höjd, så att underflikarna kan stanna precis under det */
(()=>{ const tb=document.querySelector(".topbar"); if(!tb) return; const set=()=>{ const r=document.documentElement.style, m=document.querySelector("main"); r.setProperty("--tb-h",tb.offsetHeight+"px"); if(m) r.setProperty("--mpt",(parseFloat(getComputedStyle(m).paddingTop)||0)+"px"); }; addEventListener("resize",set); set(); if(window.ResizeObserver) new ResizeObserver(set).observe(tb); else addEventListener("resize",set); })();
/* navigation */
function go(page){
  if (page==="verktyg"){ location.href="verktyg.html"; return; }
  if (page==="admin" && !document.body.classList.contains("is-admin")) page="start";
  document.querySelectorAll(".navtab").forEach(b=>b.setAttribute("aria-selected",String(b.dataset.page===page)));
  document.querySelectorAll(".page").forEach(p=>p.hidden=p.id!=="page-"+page);
  const ab=document.querySelector('.navtab[aria-selected="true"]'); if(ab&&ab.scrollIntoView) ab.scrollIntoView({block:"nearest",inline:"nearest"});
  const ag=document.getElementById("adminBtn"); if(ag) ag.classList.toggle("on",page==="admin");
  try{ history.replaceState(null,"","#"+page); }catch(e){}
}
document.addEventListener("click",e=>{
  const t=e.target.closest("button,a"); if(!t) return;
  if (t.classList.contains("navtab")){ go(t.dataset.page); window.scrollTo({top:0}); return; }
  if (t.dataset.ctype){ const r=document.querySelector(`input[name=ctype][value="${t.dataset.ctype}"]`); if(r&&!r.checked){ r.checked=true; r.dispatchEvent(new Event("change",{bubbles:true})); } }
  if (t.dataset.goto){ go(t.dataset.goto); if(t.dataset.stab){ const sb=document.querySelector(`.subnav [data-st="${t.dataset.stab}"]`); if(sb) sb.click(); } window.scrollTo({top:0}); if(t.dataset.ctype){ const f=document.getElementById("caseTitle"); if(f&&matchMedia("(pointer:fine)").matches) f.focus({preventScroll:true}); } return; }
});
const start=(location.hash||"").slice(1); if (document.getElementById("page-"+start)) go(start);

/* names of people who wrote reports */
async function names(ids){ if(!U||!ids.length) return {}; try{ const ps=await U.profiles(ids); const o={}; ids.forEach(i=>o[i]=(ps[i]&&ps[i].name)||"En medlem"); return o; }catch(e){ return {}; } }

/* ---------- save site doc ---------- */
let siteTimer=null, siteGen=0, siteJson="";
/* ---------- medlemsregistret: egen tabell, en rad per kontaktperson ----------
   site.medlemmar hålls i minnet; vid sparande skickas bara de rader som ändrats (upsert) eller tagits bort. */
const MEM_COLS=["id","fastighet","beteckning","namn","telefon","epost","adress"];
let memSnap=new Map(), memSyncing=false, memTimer=null;
const memRow=m=>{ const o={}; MEM_COLS.forEach(k=>o[k]=String(m[k]??"")); o.epost=o.epost.trim().toLowerCase(); return o; };
async function loadMem(){
  if(!window.SB||memSyncing) return;
  const {data,error}=await window.SB.from("medlemmar").select(MEM_COLS.join(",")); if(error||!data) return;
  memSnap=new Map(data.map(r=>[r.id,JSON.stringify(memRow(r))]));
  const lokala=(site.medlemmar||[]).filter(m=>editing.has(m.id)), lk=new Map(lokala.map(m=>[m.id,m]));
  site.medlemmar=data.map(r=>lk.get(r.id)||r).concat(lokala.filter(m=>!data.some(r=>r.id===m.id)));
  if(!busy()){ renderLists(); if(q("#st-reg")&&!q("#st-reg").hidden) renderReg(); }
}
async function memSync(){
  if(!board||!window.SB) return; memSyncing=true;
  try{
    const cur=new Map((site.medlemmar||[]).map(m=>[m.id,memRow(m)]));
    const upp=[...cur.values()].filter(r=>memSnap.get(r.id)!==JSON.stringify(r));
    const bort=[...memSnap.keys()].filter(id=>!cur.has(id));
    if(upp.length){ const {error}=await window.SB.from("medlemmar").upsert(upp); if(error) throw error; upp.forEach(r=>memSnap.set(r.id,JSON.stringify(r))); }
    if(bort.length){ const {error}=await window.SB.from("medlemmar").delete().in("id",bort); if(error) throw error; bort.forEach(id=>memSnap.delete(id)); }
  } finally { memSyncing=false; }
}
window.getMedlemmar=()=>site.medlemmar||[];
function saveSite(){
  if(!board||!siteRef) return; siteDirty=true; clearTimeout(siteTimer);
  const gen=++siteGen;
  siteTimer=setTimeout(async()=>{ siteSaving=true; setMsg("Sparar…");
    try{ const {medlemmar,...rest}=site; const js=JSON.stringify(rest);
      if(js!==siteJson){ await siteRef.set(JSON.parse(js)); siteJson=js; }
      await memSync(); if(gen===siteGen) siteDirty=false; setMsg("Sparat"); }
    catch(e){ setMsg("Kunde inte spara. Försök igen."); } siteSaving=false; },600);
}

/* ---------- renderers ---------- */
function renderIntro(){
  q("#introView").innerHTML = site.intro ? site.intro.split(/\n\s*\n/).map(p=>`<p>${E(p)}</p>`).join("") : `<p class="empty">Ingen information ännu.</p>`;
  q("#introView").hidden=editIntro; q("#introEdit").hidden=!editIntro;
}
function sorted(arr,desc){ return [...(arr||[])].sort((a,b)=>desc? String(b.datum).localeCompare(String(a.datum)) : String(a.datum).localeCompare(String(b.datum))); }
function itemCard(kind,it,fields,view){
  if (board && editing.has(it.id)){
    return `<div class="item" data-kind="${kind}" data-id="${it.id}">${fields.map(([k,l,t])=>`<label>${l}${t==="area"?`<textarea rows="4" data-f="${k}">${E(it[k])}</textarea>`:`<input ${t==="date"?'type="date"':t==="tel"?'type="tel" inputmode="tel"':t==="email"?'type="email" inputmode="email"':''} data-f="${k}" value="${E(it[k])}">`}</label>`).join("")}
      ${ATT_KINDS.includes(kind)?attEdit(it):""}
      ${kind==="moten"?`<button type="button" class="ghost tonews" data-act="tonews">${(site.nyheter||[]).some(n=>n.mote===it.id)?"Uppdatera under Aktuellt":"Lägg upp i Aktuellt"}</button>`:""}
      <div class="row"><button type="button" data-act="done">Spara och stäng</button><button type="button" class="danger" data-act="del">Ta bort</button></div></div>`;
  }
  return `<div class="item${kind==="nyheter"?" news":""}" data-kind="${kind}" data-id="${it.id}">${view(it)}${ATT_KINDS.includes(kind)?attView(it):""}${kind==="nyheter"?kommBlock(it.id):""}${board?`<div class="row">${kind==="nyheter"?`${it.notis?`<span class="meta notismeta">Notis skickad ${E(kortDatum(it.notis))}</span>`:""}<button type="button" class="ghost small" data-act="notis">${it.notis?"Skicka notis igen":"Skicka notis"}</button>`:""}<button type="button" class="ghost small" data-act="edit">Ändra</button></div>`:""}</div>`;
}
const ATT_KINDS=["nyheter","moten"];
/* Bilagor och startbild ligger i en låst lagringsplats ("filer"). Appen hämtar tillfälliga,
   signerade adresser (giltiga ett dygn) och sparar dem lokalt så att bilderna kan cachas. */
const SIGN=(()=>{ try{ return JSON.parse(localStorage.getItem("vag_sign")||"{}"); }catch(e){ return {}; } })();
let signQ=new Set(), signT=null;
function blobUrl(id){ if(!id) return ""; const c=SIGN[id]; if(c&&c.exp>Date.now()) return c.url; signQ.add(id); if(!signT) signT=setTimeout(signFlush,0); return ""; }
const dlUrl=(u,n)=>u?u+(u.includes("?")?"&":"?")+"download="+encodeURIComponent(n):"";
async function signFlush(){
  signT=null; const ids=[...signQ]; signQ.clear(); if(!ids.length||!window.SB) return;
  try{
    const {data,error}=await window.SB.storage.from("filer").createSignedUrls(ids,86400); if(error) throw error;
    const t=Date.now(); (data||[]).forEach((d,i)=>{ const id=d.path||ids[i]; SIGN[id]= d.signedUrl ? {url:d.signedUrl,exp:t+20*3600e3} : {url:"",exp:t+60e3}; });
    for(const k in SIGN) if(SIGN[k].exp<t) delete SIGN[k];
    try{ localStorage.setItem("vag_sign",JSON.stringify(SIGN)); }catch(e){}
  }catch(e){ return; }
  applySigned(); renderHero();
}
function applySigned(){
  document.querySelectorAll("[data-sign]").forEach(el=>{ const u=blobUrl(el.dataset.sign); if(!u) return; const a=el.dataset.sattr;
    if(a==="src") el.src=u; else if(a==="href") el.href=u; else if(a==="dl") el.href=dlUrl(u,el.dataset.sname||"fil"); else if(a==="pdf") el.dataset.pdfopen=u; });
}
function attView(it){
  const imgs=(it.bilder||[]), docs=(it.filer||[]);
  return (imgs.length?`<div class="gallery">${imgs.map(b=>{ const u=blobUrl(b.id); return `<a data-sign="${E(b.id)}" data-sattr="href" ${u?`href="${E(u)}"`:""} target="_blank" rel="noopener"><img data-sign="${E(b.id)}" data-sattr="src" ${u?`src="${E(u)}"`:""} alt="${E(b.namn||"Bild")}" loading="lazy"></a>`; }).join("")}</div>`:"")
   + (docs.length?`<div class="docs">${docs.map(f=>{ const u=blobUrl(f.id), n=f.namn||"Dokument";
       return `<div class="docrow"><span class="docname">${ico("file")}<span>${E(n)}</span></span><span class="docbtns"><button type="button" class="small" data-sign="${E(f.id)}" data-sattr="pdf" data-pdfopen="${E(u)}" data-pdfname="${E(n)}">Öppna</button><a class="btnlink" data-sign="${E(f.id)}" data-sattr="dl" data-sname="${E(n)}" ${u?`href="${E(dlUrl(u,n))}"`:""} download="${E(n)}">Ladda ner</a></span></div>`; }).join("")}</div>`:"");
}
function attEdit(it){
  const imgs=(it.bilder||[]), docs=(it.filer||[]);
  return `<div class="attedit">
    ${imgs.length||docs.length?`<div class="attlist">${imgs.map(b=>`<div class="att"><img data-sign="${E(b.id)}" data-sattr="src" ${blobUrl(b.id)?`src="${E(blobUrl(b.id))}"`:""} alt=""><button type="button" class="danger" data-attdel="bilder:${E(b.id)}" aria-label="Ta bort bild">✕</button></div>`).join("")}${docs.map(f=>`<div class="att doc"><span>📄 ${E(f.namn)}</span><button type="button" class="danger" data-attdel="filer:${E(f.id)}" aria-label="Ta bort fil">✕</button></div>`).join("")}</div>`:""}
    <div class="row">
      <label class="filebtn">📷 Lägg till bild<input type="file" accept="image/*" multiple data-upload="bilder"></label>
      <label class="filebtn">📄 Bifoga PDF<input type="file" accept="application/pdf" multiple data-upload="filer"></label>
    </div><span class="status upmsg"></span></div>`;
}
async function shrink(file){
  if (!/^image\/(jpeg|png|webp|heic|heif)/.test(file.type)) return file;
  try{
    const bmp=await createImageBitmap(file); const max=1600; const k=Math.min(1,max/Math.max(bmp.width,bmp.height));
    if (k===1 && file.size<1.5e6) return file;
    const c=document.createElement("canvas"); c.width=Math.round(bmp.width*k); c.height=Math.round(bmp.height*k);
    c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);
    return await new Promise(r=>c.toBlob(b=>r(b||file),"image/jpeg",0.85));
  }catch(e){ return file; }
}
let ASSETS=null;
document.addEventListener("change",async e=>{
  const inp=e.target; if(!inp.dataset||!inp.dataset.upload||!board) return;
  const card=inp.closest(".item[data-kind]"); const it=(site[card.dataset.kind]||[]).find(x=>x.id===card.dataset.id); if(!it) return;
  const msg=card.querySelector(".upmsg"); const field=inp.dataset.upload;
  if (!ASSETS) ASSETS=await claude.use("assets");
  if (!ASSETS){ msg.textContent="Uppladdning går inte just nu. Ladda om sidan och försök igen."; return; }
  const files=[...inp.files]; inp.value="";
  for (const f of files){
    msg.textContent="Laddar upp "+f.name+"…";
    try{
      const body = field==="bilder" ? await shrink(f) : f;
      const r=await ASSETS.upload(body);
      it[field]=[...(it[field]||[]),{id:r.id,namn:f.name}];
    }catch(err){ msg.textContent="Kunde inte ladda upp "+f.name+". Max 20 MB."; return; }
  }
  saveSite(); renderLists();
});
document.addEventListener("click",async e=>{
  const b=e.target.closest("[data-attdel]"); if(!b||!board) return;
  if(!confirmDel()) return;
  const [field,id]=b.dataset.attdel.split(":"); const card=b.closest(".item[data-kind]");
  const it=(site[card.dataset.kind]||[]).find(x=>x.id===card.dataset.id); if(!it) return;
  it[field]=(it[field]||[]).filter(x=>x.id!==id); saveSite(); renderLists();
  try{ if(!ASSETS) ASSETS=await claude.use("assets"); if(ASSETS) await ASSETS.delete(id); }catch(err){}
});
const NEWS_F=[["datum","Datum","date"],["rubrik","Rubrik"],["text","Text","area"]];
const MEET_F=[["datum","Datum","date"],["rubrik","Rubrik, t.ex. Årsstämma 2027"],["plats","Plats och tid"],["text","Kallelse eller sammanfattning","area"],["lank","Länk till protokoll eller kallelse"]];
const BOARD_F=[["namn","Namn"],["roll","Roll, t.ex. ordförande"],["fastighet","Fastighet"],["telefon","Telefon"],["epost","Mejl"]];
const MEM_F=[["fastighet","Fastighetens namn"],["beteckning","Fastighetsbeteckning"],["namn","Namn"],["telefon","Telefon","tel"],["epost","Mejl","email"],["adress","Adress"]];
const ico=n=>`<svg class="ico" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const contact=it=>`${it.telefon?`<a class="cbtn" href="tel:${E(it.telefon.replace(/\s/g,""))}">${ico("phone")}${E(it.telefon)}</a>`:""}${it.epost?`<a class="cbtn" href="mailto:${E(it.epost)}">${ico("mail")}${E(it.epost)}</a>`:""}`;
const initials=n=>{ const w=String(n||"").trim().split(/\s+/).filter(Boolean); return E(((w[0]||"?")[0]+(w.length>1?w[w.length-1][0]:"")).toUpperCase()); };
const person=(top,name,sub,it,av)=>`<div class="person">${av||`<span class="avatar" aria-hidden="true">${initials(name)}</span>`}<div><span class="meta">${top}</span><h3>${E(name||"Namn saknas")}</h3>${sub?`<span class="addr">${E(sub)}</span>`:""}</div></div>${(it.telefon||it.epost)?`<div class="contacts">${contact(it)}</div>`:""}`;
const memView=it=>person(E(it.fastighet||"Fastighet saknas"),it.namn||"Namn ej ifyllt",it.adress,it);
/* compact card per fastighet; tap to open all contact persons in a dialog */
let memGroups=new Map();
/* Fastighetens namn (t.ex. Stavberga) och beteckning (t.ex. Stav 1:5). Beteckningen visas bara om den skiljer sig från namnet. */
const betOf=ps=>{ const b=String((ps.find(m=>m.beteckning)||{}).beteckning||"").trim(), f=String(ps[0].fastighet||"").trim(); return b&&b!==f?b:""; };
function memCard(k,ps){
  const adr=(ps.find(m=>m.adress)||{}).adress, named=ps.filter(m=>m.namn), bet=betOf(ps);
  const av=named.slice(0,3).map(m=>`<span class="avatar">${initials(m.namn)}</span>`).join("")+(named.length>3?`<span class="avatar more">+${named.length-3}</span>`:"");
  return `<button type="button" class="mcard" data-mopen="${E(k)}">
    <span class="mc-top"><strong>${E(ps[0].fastighet||"Fastighet saknas")}${bet?` <span class="mc-bet">${E(bet)}</span>`:""}</strong><small>${named.length?E(named.map(m=>m.namn).join(", ")):"Ingen kontakt ifylld"}</small></span>
    <svg class="ico bc-pil" aria-hidden="true" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>`;
}
function memDlg(){ let d=q("#memDlg"); if(!d){ d=document.createElement("dialog"); d.id="memDlg"; d.className="bdlg mdlg"; q("#page-medlemmar").appendChild(d);
  d.addEventListener("click",e=>{ if(e.target===d||e.target.closest("[data-mclose]")) d.close(); }); } return d; }
function showMemGroup(k){ const d=memDlg(); d.dataset.k=k; refreshMemDlg(true); if(!d.open) d.showModal(); }
function refreshMemDlg(force){ const d=q("#memDlg"); if(!d||(!d.open&&!force)) return; const ps=memGroups.get(d.dataset.k);
  if(!ps){ d.close(); return; }
  d.innerHTML=`<div class="mdlg-in"><button type="button" class="mdlg-x" data-mclose aria-label="Stäng">✕</button>${memGroup(ps)}</div>`; }
document.addEventListener("click",e=>{ const c=e.target.closest("[data-mopen]"); if(c) showMemGroup(c.dataset.mopen); });
/* one group with all its contact persons */
function memGroup(ps){
  const f=ps[0].fastighet, adr=(ps.find(m=>m.adress)||{}).adress, bet=betOf(ps);
  const rows=ps.map(it=>{
    if (board && editing.has(it.id)) return itemCard("medlemmar",it,MEM_F,memView).replace('<div class="item"','<div class="item sub edit"');
    return `<div class="item sub" data-kind="medlemmar" data-id="${it.id}"><div class="person"><span class="avatar" aria-hidden="true">${initials(it.namn)}</span><div><h3>${E(it.namn||"Namn ej ifyllt")}</h3>${it.adress&&it.adress!==adr?`<span class="addr">${E(it.adress)}</span>`:""}</div>${board?`<button type="button" class="ghost small" data-act="edit">Ändra</button>`:""}</div>${(it.telefon||it.epost)?`<div class="contacts">${contact(it)}</div>`:""}</div>`;
  }).join("");
  return `<div class="item mgroup"><div class="mhead"><div><h3>${E(f||"Fastighet saknas")}</h3>${bet?`<span class="meta mbet">Fastighetsbeteckning: ${E(bet)}</span>`:""}${adr?`<span class="meta">${E(adr)}</span>`:""}</div></div>${rows}
    ${board&&f?`<button type="button" class="ghost small addcontact" data-addcontact="${E(f)}">+ Lägg till kontaktperson</button>`:""}</div>`;
}
const newsView=it=>`<span class="meta">${dfmt(it.datum)}</span><h3>${E(it.rubrik||"Utan rubrik")}</h3>${it.text?`<p>${E(it.text)}</p>`:""}`;
const MON=["jan","feb","mar","apr","maj","jun","jul","aug","sep","okt","nov","dec"];
const dateblk=d=>{ const t=new Date((d||"")+"T12:00:00"); if(!d||isNaN(t)) return `<span class="dateblk"><span>Datum</span><b>?</b><small>&nbsp;</small></span>`; return `<span class="dateblk${d<today()?" past":""}"><span>${MON[t.getMonth()]}</span><b>${t.getDate()}</b><small>${t.getFullYear()}</small></span>`; };
const meetView=it=>`<div class="mrow">${dateblk(it.datum)}<div class="mbody">${it.plats?`<span class="meta">${E(it.plats)}</span>`:""}<h3>${E(it.rubrik||"Möte")}</h3>${it.text?`<p>${E(it.text)}</p>`:""}${/^https?:\/\//.test(it.lank||"")?`<a class="open" href="${E(it.lank)}" target="_blank" rel="noopener">${ico("file")}Öppna dokument</a>`:""}${(site.dokument||[]).filter(d=>d.mote&&d.mote===it.id).map(d=>`<a class="open" href="#dokument" data-dokid="${E(d.id)}">${ico("file")}Läs protokollet</a>`).join("")}</div></div>`;
/* Symboler för styrelsens roller */
const ROLLIKON={
  ordf:{f:"#9a6b00",b:"#fbefd2",t:"Ordförande",svg:'<path d="M13.6 2.8l7.6 7.6-3.1 3.1-7.6-7.6z" fill="currentColor" fill-opacity=".25"/><path d="M13.6 2.8l7.6 7.6-3.1 3.1-7.6-7.6z"/><path d="M12.4 4l7.6 7.6M14.3 9.7L4.5 19.5"/><path d="M3 21.2h8.5"/>'},
  vice:{f:"#5b6675",b:"#eceff3",t:"Vice ordförande",svg:'<path d="M13.6 2.8l7.6 7.6-3.1 3.1-7.6-7.6z" fill="currentColor" fill-opacity=".2"/><path d="M13.6 2.8l7.6 7.6-3.1 3.1-7.6-7.6z"/><path d="M14.3 9.7L4.5 19.5"/><path d="M3 21.2h8.5"/>'},
  kass:{f:"#a67c00",b:"#fff3c4",t:"Kassör",svg:'<path d="M9.2 2.8h5.6l-1.6 3.4h-2.4z" fill="currentColor" fill-opacity=".3"/><path d="M9.2 2.8h5.6l-1.6 3.4h-2.4z"/><path d="M10.6 6.2C6.3 8.6 4.3 12 4.3 15.4c0 3.6 3 5.8 7.7 5.8s7.7-2.2 7.7-5.8c0-3.4-2-6.8-6.3-9.2z" fill="currentColor" fill-opacity=".25"/><path d="M10.6 6.2C6.3 8.6 4.3 12 4.3 15.4c0 3.6 3 5.8 7.7 5.8s7.7-2.2 7.7-5.8c0-3.4-2-6.8-6.3-9.2z"/><text x="12" y="17.6" text-anchor="middle" font-size="6.4" font-weight="800" font-family="system-ui,sans-serif" fill="currentColor" stroke="none">kr</text>'},
  sekr:{f:"#2856a3",b:"#e3edfb",t:"Sekreterare",svg:'<path d="M20.5 3.5c-6.5.3-11 4.3-12.8 11.2l1.6 1.6C16.2 14.5 20.2 10 20.5 3.5z" fill="currentColor" fill-opacity=".25"/><path d="M20.5 3.5c-6.5.3-11 4.3-12.8 11.2l1.6 1.6C16.2 14.5 20.2 10 20.5 3.5z"/><path d="M16.5 7.5l-8 8M8.5 15.5L5 20.5"/><path d="M12 20.5h8"/>'},
  leda:{f:"#1f5c41",b:"#e6f0ea",t:"Ledamot",svg:'<rect x="4" y="11" width="16" height="9.5" rx="1.6" fill="currentColor" fill-opacity=".2"/><rect x="4" y="11" width="16" height="9.5" rx="1.6"/><path d="M8 11V4h8v7"/><path d="M9.5 7.6l1.8 1.8 3.4-3.4"/><path d="M8.5 15h7"/>'},
  supp:{f:"#6b4fa0",b:"#efe9f8",t:"Suppleant",svg:'<path d="M7 3.5h10v8H7z" fill="currentColor" fill-opacity=".2"/><path d="M7 3.5h10v8H7z"/><path d="M5 11.5h14v3H5z" fill="currentColor" fill-opacity=".35"/><path d="M5 11.5h14v3H5z"/><path d="M6.5 14.5v6M17.5 14.5v6"/>'},
  revi:{f:"#b3412e",b:"#fde8e4",t:"Revisor",svg:'<path d="M5 3h9l4 4v6" /><path d="M14 3v4h4"/><path d="M5 3v17h6"/><circle cx="15.5" cy="16.5" r="3.6" fill="currentColor" fill-opacity=".2"/><circle cx="15.5" cy="16.5" r="3.6"/><path d="M18.2 19.2l2.8 2.8"/>'},
  vag:{f:"#c25a00",b:"#fde9d6",t:"Vägansvarig",svg:'<path d="M10 3.5h4l5 15H5z" fill="currentColor" fill-opacity=".25"/><path d="M10 3.5h4l5 15H5z"/><path d="M8.6 9h6.8M7.3 13.5h9.4"/><path d="M3 20.5h18"/>'}
};
function rollIkon(roll){ const r=String(roll||"").toLowerCase();
  const k= r.includes("vice")?"vice": r.includes("ordf")?"ordf": r.includes("kass")||r.includes("ekonom")?"kass": r.includes("sekr")?"sekr": r.includes("revis")?"revi": r.includes("suppl")||r.includes("ersätt")?"supp": (r.includes("väg")||r.includes("underhåll")||r.includes("snö"))?"vag": (r.includes("ledam")||!r)?"leda":null;
  if(!k) return null; const i=ROLLIKON[k];
  return `<span class="avatar rollikon" style="--rf:${i.f};--rb:${i.b}" title="${i.t}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${i.svg}</svg></span>`; }
/* litet kort: ikon, roll och namn. Tryck för kontaktuppgifter. */
const boardCard=(kind,it)=>`<button type="button" class="bcard" data-bopen="${kind}" data-bid="${E(it.id)}">${rollIkon(it.roll)||`<span class="avatar" aria-hidden="true">${initials(it.namn)}</span>`}<span class="bc-txt"><span class="meta">${E(it.roll||(kind==="styrelse"?"Ledamot":"Funktionär"))}</span><strong>${E(it.namn||"Namn saknas")}</strong></span><svg class="ico bc-pil" aria-hidden="true" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>`;
document.addEventListener("click",e=>{
  const c=e.target.closest("[data-bopen]"); if(!c) return;
  const kind=c.dataset.bopen, it=(site[kind]||[]).find(x=>x.id===c.dataset.bid); if(!it) return;
  const d=document.createElement("dialog"); d.className="bdlg bdlg-person";
  d.innerHTML=`<form method="dialog"><div class="item bperson">${boardView(it)}</div>${!(it.telefon||it.epost)?`<p class="hint">Inga kontaktuppgifter inlagda.</p>`:""}
    <div class="bdlg-btns">${board?`<button type="button" class="ghost" id="bpEdit">Ändra</button>`:""}<button value="close">Stäng</button></div></form>`;
  document.body.appendChild(d); d.addEventListener("close",()=>d.remove());
  const ed=d.querySelector("#bpEdit"); if(ed) ed.onclick=()=>{ d.close(); editing.add(it.id); renderLists(); const el=document.querySelector(`.item[data-id="${it.id}"]`); if(el) el.scrollIntoView({block:"center"}); };
  d.showModal();
  if(kind==="styrelse"&&document.body.classList.contains("is-admin")) adminRad(d,it);
});
/* Admin kan ge en styrelseledamot adminbehörighet direkt från ledamotens kort */
async function adminRad(d,it){
  const ep=String(it.epost||"").trim().toLowerCase(), form=d.querySelector("form"), btns=d.querySelector(".bdlg-btns");
  const box=document.createElement("div"); box.className="adminrad"; btns.before(box);
  if(!ep){ box.innerHTML=`<strong>Adminbehörighet</strong><small>Lägg in en mejladress för ledamoten (Ändra) för att kunna ge adminbehörighet.</small>`; return; }
  const {data:rad,error}=await window.SB.from("roller").select("email,roll,superadmin").eq("email",ep).maybeSingle();
  let cur=rad;
  if(error){ box.innerHTML=`<strong>Adminbehörighet</strong><small>Kunde inte läsa behörigheten.</small>`; return; }
  const jag=String(minEpost||(await minEpostH())||"").toLowerCase()===ep;
  const visa=()=>{ const r=(cur&&cur.roll)||"";
    box.innerHTML=`<div><strong>Adminbehörighet</strong><small>${cur&&cur.superadmin?"Superadmin: full tillgång till allt. Kan inte ändras av andra.":r==="admin"?"Har admin: full tillgång till allt, även inloggningar och behörigheter.":r?"Har behörigheten "+(r==="styrelse"?"Styrelse":"Medlem")+".":"Kan inte logga in än. Mejladressen saknas i inloggningslistan."}</small></div>
      ${cur&&cur.superadmin?`<span class="badge typ">Superadmin</span>`:window.VAG_SUPER?`<button type="button" class="${r==="admin"?"ghost":""} small" id="bpAdm">${r==="admin"?"Ta bort admin":"Gör till admin"}</button>`:`<small>Bara superadmin kan ändra adminbehörighet.</small>`}`;
    if(!box.querySelector("#bpAdm")) return;
    box.querySelector("#bpAdm").onclick=async ev=>{ const b=ev.currentTarget, ny=r==="admin"?"styrelse":"admin";
      if(!b.classList.contains("armed")){ b.classList.add("armed"); b.textContent=ny==="admin"?"Tryck igen för att bekräfta":"Tryck igen för att ta bort"; return; }
      if(ny!=="admin"){ const {count}=await window.SB.from("roller").select("email",{count:"exact",head:true}).eq("roll","admin"); if((count||0)<=1){ setMsg("Det måste finnas minst en admin."); visa(); return; } }
      b.disabled=true;
      const {error:e2}=await window.SB.from("roller").upsert({email:ep,roll:ny,namn:it.namn||""});
      if(e2){ setMsg("Kunde inte spara behörigheten."); visa(); return; }
      cur={email:ep,roll:ny}; setMsg(ny==="admin"?`${it.namn||ep} är nu admin.`:`${it.namn||ep} har nu behörigheten Styrelse.`);
      if(jag&&ny!=="admin"){ setTimeout(()=>location.reload(),1200); }
      visa(); };
  };
  visa();
}
const boardView=it=>person(E(it.roll||"Ledamot"),it.namn||"Namn saknas",it.fastighet,it,rollIkon(it.roll));
function renderLists(){
  const news=sorted(site.nyheter,true);
  q("#news").innerHTML = news.length? news.slice(0,board?99:6).map(it=>itemCard("nyheter",it,NEWS_F,newsView)).join("") : `<p class="empty">Inga aktuella händelser just nu.</p>`;
  const meets=sorted(site.moten,true);
  q("#meetList").innerHTML = meets.length? meets.map(it=>itemCard("moten",it,MEET_F,meetView)).join("") : `<p class="empty">Inga möten inlagda ännu.</p>`;
  const up=sorted(site.moten).filter(m=>m.datum&&m.datum>=today());
  q("#nextMeet").innerHTML = up.length? up.slice(0,2).map(it=>`<div class="item">${meetView(it)}</div>`).join("") : `<p class="empty">Inget möte planerat just nu.</p>`;
  const bc=(kind,it)=>board&&editing.has(it.id)?itemCard(kind,it,BOARD_F,boardView):boardCard(kind,it);
  q("#boardList").innerHTML = (site.styrelse||[]).length? site.styrelse.map(it=>bc("styrelse",it)).join("") : `<p class="empty">Styrelsen är inte inlagd ännu.</p>`;
  const funk=site.funktionarer||[];
  q("#funkList").innerHTML = funk.length? funk.map(it=>bc("funktionarer",it)).join("") : `<p class="empty">Inga funktionärer inlagda ännu.</p>`;
  q("#funkBox").hidden = !funk.length && !board;
  /* Sökrutan visas först när det finns fler än 20 fastigheter. */
  const antalF=new Set((site.medlemmar||[]).map(m=>String(m.fastighet||"").trim().toLowerCase()).filter(Boolean)).size;
  const sokL=q("#memSearchL"); if(sokL){ sokL.hidden=antalF<=20; if(sokL.hidden) q("#memSearch").value=""; }
  const qv=(q("#memSearch").value||"").toLowerCase();
  const groups=new Map();
  (site.medlemmar||[]).forEach(m=>{ const k=String(m.fastighet||"").trim().toLowerCase(); if(!groups.has(k)) groups.set(k,[]); groups.get(k).push(m); });
  const gl=[...groups.entries()].sort((a,b)=>a[0]===""?1:b[0]===""?-1:a[0].localeCompare(b[0],"sv",{numeric:true}))
    .filter(([k,ps])=>!qv||ps.some(m=>(m.fastighet+" "+(m.beteckning||"")+" "+m.namn+" "+(m.adress||"")).toLowerCase().includes(qv)||editing.has(m.id)));
  memGroups=groups;
  q("#memberList").innerHTML = gl.length? gl.map(([k,ps])=>memCard(k,ps)).join("") : `<p class="empty">${qv?"Ingen träff.":"Inga medlemmar inlagda ännu."}</p>`;
  refreshMemDlg();
}
/* Startbildens position: site.startbild.pos = {x,y} i procent (fokuspunkt). */
let heroDrag=false, heroSaveT=null;
const heroPos=()=>{ const p=(site.startbild&&site.startbild.pos)||{}; const c=v=>Math.max(0,Math.min(100,Math.round(Number.isFinite(+v)?+v:50))); return {x:c(p.x??50),y:c(p.y??50)}; };
function heroVisa(x,y,u){
  const d=q("#heroDot"); if(d){ d.style.left=x+"%"; d.style.top=y+"%"; }
  ["#hpM","#hpD"].forEach(s=>{ const el=q(s); if(el){ if(u) el.style.backgroundImage=`url("${u}")`; el.style.backgroundPosition=`${x}% ${y}%`; } });
  const w=q("#welcome"); if(w) w.style.setProperty("--hero-pos",`${x}% ${y}%`);
}
function heroSatt(x,y,spara){
  x=Math.max(0,Math.min(100,Math.round(x))); y=Math.max(0,Math.min(100,Math.round(y)));
  q("#heroX").value=x; q("#heroY").value=y; heroVisa(x,y);
  if(spara&&site.startbild){ site.startbild.pos={x,y}; clearTimeout(heroSaveT); heroSaveT=setTimeout(()=>saveSite(),300); }
}
document.addEventListener("input",e=>{ if(e.target.id==="heroX"||e.target.id==="heroY") heroSatt(+q("#heroX").value,+q("#heroY").value,true); });
(()=>{ const f=()=>q("#heroFull");
  const punkt=ev=>{ const r=q("#heroImg").getBoundingClientRect(); return [(ev.clientX-r.left)/r.width*100,(ev.clientY-r.top)/r.height*100]; };
  document.addEventListener("pointerdown",ev=>{ const el=f(); if(!el||!el.contains(ev.target)) return; heroDrag=true; el.setPointerCapture&&el.setPointerCapture(ev.pointerId); const [x,y]=punkt(ev); heroSatt(x,y,false); ev.preventDefault(); });
  document.addEventListener("pointermove",ev=>{ if(!heroDrag) return; const [x,y]=punkt(ev); heroSatt(x,y,false); });
  document.addEventListener("pointerup",ev=>{ if(!heroDrag) return; heroDrag=false; const [x,y]=punkt(ev); heroSatt(x,y,true); setMsg("Startbildens position är sparad."); });
})();
function renderHero(){
  const w=q("#welcome"); if(!w) return; const id=site.startbild&&site.startbild.id&&blobUrl(site.startbild.id)?site.startbild.id:"";
  const pos=heroPos();
  w.classList.toggle("has-img",!!id); w.style.setProperty("--hero-img", id?`url("${blobUrl(id)}")`:"none"); w.style.setProperty("--hero-pos",`${pos.x}% ${pos.y}%`);
  const hp=q("#heroPos"); if(hp){ hp.hidden=!id; if(id){ const u=blobUrl(id), im=q("#heroImg"); if(im.getAttribute("src")!==u) im.src=u; if(!heroDrag){ q("#heroX").value=pos.x; q("#heroY").value=pos.y; } heroVisa(pos.x,pos.y,u); } }
  const del=q("#heroDel"); if(del) del.hidden=!id;
  const pv=q("#heroPrev"); if(pv){ pv.classList.toggle("has-img",!!id); pv.style.backgroundImage=id?`url("${blobUrl(id)}")`:""; pv.querySelector("span").hidden=!!id; }
}
document.addEventListener("change",async e=>{
  if(e.target.id!=="heroFile"||!board) return;
  const f=e.target.files[0]; e.target.value=""; if(!f) return;
  const lbl=q("#heroLbl"); lbl.textContent="Laddar upp…";
  try{
    if(!ASSETS) ASSETS=await claude.use("assets"); if(!ASSETS) throw new Error("assets");
    const r=await ASSETS.upload(await shrink(f));
    const old=site.startbild&&site.startbild.id; site.startbild={id:r.id}; saveSite(); renderHero();
    if(old) ASSETS.delete(old).catch(()=>{});
    setMsg("Startbilden är bytt.");
  }catch(err){ setMsg("Kunde inte ladda upp bilden. Max 20 MB."); }
  lbl.textContent="Byt startbild";
});
document.addEventListener("click",async e=>{
  const b=e.target.closest("#heroDel"); if(!b||!board) return;
  if(!b.classList.contains("armed")){ b.classList.add("armed"); b.textContent="Tryck igen för att ta bort"; setTimeout(()=>{ b.classList.remove("armed"); b.textContent="Ta bort bild"; },4000); return; }
  b.classList.remove("armed"); b.textContent="Ta bort bild";
  const old=site.startbild&&site.startbild.id; site.startbild=null; saveSite(); renderHero();
  try{ if(!ASSETS) ASSETS=await claude.use("assets"); if(old&&ASSETS) await ASSETS.delete(old); }catch(err){}
});
function renderSite(){ renderHero(); renderDok(); if(q("#st-reg")&&!q("#st-reg").hidden) renderReg(); renderIntro(); renderLists(); renderMailSet(); if(!q("#st-utskick").hidden){ renderRcpt(); renderULog(); renderFrom(); } }

/* add a board member: pick a person from the member register and give them a board role */
const STYR_ROLLER=["Ordförande","Vice ordförande","Kassör","Sekreterare","Ledamot","Suppleant"];
const FUNK_ROLLER=["Vägansvarig","Revisor","Revisorssuppleant","Valberedning"];
async function pickBoardMember(target){
  target=target||"styrelse"; const funk=target==="funktionarer";
  const lc=x=>String(x||"").trim().toLowerCase();
  const people=[]; const seen=new Set();
  (site.medlemmar||[]).forEach(m=>{ if(!m.namn&&!m.epost) return; const k=lc(m.epost)||("n:"+lc(m.namn)+lc(m.fastighet)); if(seen.has(k)) return; seen.add(k); people.push({namn:m.namn||m.epost,epost:m.epost||"",telefon:m.telefon||"",fastighet:m.fastighet||""}); });
  /* bara personer ur medlemsregistret, inte inloggningskonton */
  people.sort((a,b)=>a.namn.localeCompare(b.namn,"sv"));
  const isAdmin=document.body.classList.contains("is-admin")&&!funk;
  const ROLLER=funk?FUNK_ROLLER:STYR_ROLLER, def=funk?"Vägansvarig":"Ledamot";
  const dlg=document.createElement("dialog"); dlg.className="bdlg";
  dlg.innerHTML=`<form method="dialog"><h2>${funk?"Lägg till funktionär":"Lägg till i styrelsen"}</h2>${funk?'<p class="hint">Funktionärer sitter inte i styrelsen och får ingen styrelsebehörighet i appen.</p>':""}
    <label>Person<select id="pPers"><option value="">Välj person…</option>${people.map((p,i)=>`<option value="${i}">${E(p.namn)}${p.fastighet?" – "+E(p.fastighet):p.epost&&p.epost!==p.namn?" – "+E(p.epost):""}</option>`).join("")}<option value="ny">Någon som inte finns i medlemsregistret…</option></select></label>
    <label>${funk?"Uppdrag":"Roll i styrelsen"}<select id="pRoll">${ROLLER.map(r=>`<option ${r===def?"selected":""}>${r}</option>`).join("")}<option value="">${funk?"Annat uppdrag…":"Annan roll…"}</option></select></label>
    <label id="pAnnanL" hidden>${funk?"Annat uppdrag":"Annan roll"}<input id="pAnnan" placeholder="${funk?"t.ex. Snöröjningsansvarig":"t.ex. Ledamot och sammankallande"}"></label>
    ${isAdmin?`<label class="check" id="pAccL"><input type="checkbox" id="pAcc" checked>Ge personen behörigheten Styrelse i appen</label>`:""}
    <p class="hint" id="pInfo"></p>
    <div class="bdlg-btns"><button value="ok" id="pOk" disabled>Lägg till</button><button value="skip" class="ghost">Avbryt</button></div></form>`;
  document.body.appendChild(dlg);
  const g=id=>dlg.querySelector(id);
  const upd=()=>{ const v=g("#pPers").value, p=people[v]; g("#pOk").disabled=!v;
    const cur=p&&(site[target]||[]).find(x=>(p.epost&&lc(x.epost)===lc(p.epost))||lc(x.namn)===lc(p.namn));
    g("#pInfo").textContent = v==="ny" ? "Du får fylla i namn och kontaktuppgifter själv på nästa steg." : cur ? `${p.namn} finns redan ${funk?"bland funktionärerna":"i styrelsen"} som ${cur.roll||def.toLowerCase()}. ${funk?"Uppdraget":"Rollen"} uppdateras.` : (p&&!p.epost&&isAdmin) ? "Personen saknar mejladress i registret och kan därför inte få behörighet att logga in." : "";
    if(g("#pAccL")) g("#pAccL").hidden = v==="ny" || !(p&&p.epost); };
  g("#pPers").onchange=upd; g("#pRoll").onchange=()=>{ g("#pAnnanL").hidden=g("#pRoll").value!==""; }; upd();
  dlg.addEventListener("close",async()=>{
    const v=g("#pPers").value, p=people[v], roll=g("#pRoll").value||g("#pAnnan").value.trim()||def, acc=g("#pAcc")&&g("#pAcc").checked;
    const ok=dlg.returnValue==="ok"; dlg.remove(); if(!ok||!v) return;
    if(v==="ny"){ const it={id:nid(),namn:"",roll,fastighet:"",telefon:"",epost:""}; site[target]=[...(site[target]||[]),it]; editing.add(it.id); renderLists(); saveSite(); return; }
    const list=site[target]||[]; const i=list.findIndex(x=>(p.epost&&lc(x.epost)===lc(p.epost))||lc(x.namn)===lc(p.namn));
    const it={namn:p.namn,roll,fastighet:p.fastighet,telefon:p.telefon,epost:p.epost};
    if(i>=0) list[i]={...list[i],...Object.fromEntries(Object.entries(it).filter(([k,x])=>x||k==="roll"))}; else list.push({id:nid(),...it});
    site[target]=list; renderLists(); saveSite();
    let msg= funk ? `${p.namn} är tillagd som ${roll.toLowerCase()}.` : `${p.namn} är tillagd i styrelsen som ${roll}.`;
    if(isAdmin&&acc&&p.epost){ try{
      const email=lc(p.epost); const {data}=await window.SB.from("roller").select("roll").eq("email",email);
      const now=data&&data[0]&&data[0].roll;
      if(now==="admin") msg+=" Personen är redan admin och behåller det.";
      else if(now!=="styrelse"){ const {error}=await window.SB.from("roller").upsert({email,roll:"styrelse",namn:p.namn}); msg+= error?" Behörigheten kunde inte sparas.":" Personen har nu behörigheten Styrelse."; }
    }catch(e){ msg+=" Behörigheten kunde inte sparas."; } }
    setTimeout(()=>setMsg(msg),700);
  });
  dlg.showModal();
}

/* address list as PDF */
document.addEventListener("click",async e=>{
  const b=e.target.closest("#memPdf"); if(!b||!board) return;
  try{
    if(!window.jspdf) throw new Error("lib");
    const T=t=>String(t??"").replace(/\u00a0/g," ").replace(/\u2212/g,"-");
    const {jsPDF}=window.jspdf; const doc=new jsPDF({unit:"mm",format:"a4",orientation:"landscape"});
    const W=297, M=14, green=[31,92,65], ink=[23,34,28], muted=[95,107,100];
    const datum=new Date().toLocaleDateString("sv-SE",{year:"numeric",month:"long",day:"numeric"});
    doc.setFillColor(...green); doc.rect(0,0,W,30,"F");
    doc.setTextColor(255); doc.setFont("helvetica","normal"); doc.setFontSize(10); doc.text(T("Baggetorp Hytternäs vägsamfällighet · väg 13986"),M,11);
    doc.setFont("helvetica","bold"); doc.setFontSize(20); doc.text(T("Adresslista"),M,22);
    doc.setFont("helvetica","normal"); doc.setFontSize(10); doc.text(T("Utskriven "+datum),W-M,22,{align:"right"});
    const groups=new Map(); (site.medlemmar||[]).forEach(m=>{ const k=String(m.fastighet||"").trim(); if(!groups.has(k)) groups.set(k,[]); groups.get(k).push(m); });
    const keys=[...groups.keys()].sort((a,b)=>a===""?1:b===""?-1:a.localeCompare(b,"sv",{numeric:true}));
    const body=[], grp=[]; keys.forEach((k,gi)=>groups.get(k).forEach((m,i)=>{ const bt=String((groups.get(k).find(x=>x.beteckning)||{}).beteckning||"").trim(); body.push([i===0?((k||"Fastighet saknas")+(bt&&bt!==k?"\n"+bt:"")):"",m.namn||"",m.adress||"",m.telefon||"",m.epost||""].map(T)); grp.push(gi); }));
    doc.autoTable({head:[["Fastighet","Namn","Adress","Telefon","E-post"]],body,startY:38,margin:{left:M,right:M,bottom:16},theme:"grid",
      styles:{font:"helvetica",fontSize:9.5,cellPadding:2,textColor:ink,lineColor:[214,220,212],lineWidth:0.2,overflow:"linebreak"},
      headStyles:{fillColor:green,textColor:255,fontStyle:"bold"},
      didParseCell:d=>{ if(d.section==="body") d.cell.styles.fillColor = grp[d.row.index]%2 ? [244,245,241] : [255,255,255]; },
      columnStyles:{0:{fontStyle:"bold",cellWidth:46},1:{cellWidth:52},2:{cellWidth:62},3:{cellWidth:36}}});
    const n=(site.medlemmar||[]).length, f=keys.filter(k=>k).length;
    let y=doc.lastAutoTable.finalY+6; doc.setFontSize(9); doc.setTextColor(...muted);
    doc.text(T(`${f} fastigheter, ${n} kontaktpersoner. Uppgifterna är till för vägföreningens arbete. Dela inte listan vidare.`),M,Math.min(y,195));
    const pages=doc.internal.getNumberOfPages();
    for(let i=1;i<=pages;i++){ doc.setPage(i); doc.setFontSize(8); doc.setTextColor(...muted); doc.text(T("Baggetorp Hytternäs vägsamfällighet · Adresslista "+datum+" · sida "+i+" av "+pages),M,203); }
    const dl=await claude.use("downloads"); if(!dl) throw new Error("dl");
    await dl.save({filename:"Adresslista-Baggetorp-Hytternas-"+new Date().toISOString().slice(0,10)+".pdf",data:doc.output("blob")});
    setMsg("Adresslistan är skapad.");
  }catch(err){ setMsg("Kunde inte skapa PDF:en."); }
});

/* PDF viewer inside the app (pdf.js), works regardless of the browser's PDF settings */
let pdfjsLib=null;
async function openPdf(url,name,dlUrl){
  let d=q("#pdfDlg");
  if(!d){ d=document.createElement("dialog"); d.id="pdfDlg"; d.className="pdfdlg"; document.body.appendChild(d);
    d.addEventListener("click",e=>{ if(e.target.closest("[data-pdfclose]")) d.close(); }); d.addEventListener("close",()=>{ d.querySelector(".pdfpages").innerHTML=""; }); }
  d.innerHTML=`<div class="pdfhead"><strong>${E(name)}</strong><span class="pdfacts"><a class="btnlink" href="${E(dlUrl||url+"?download="+encodeURIComponent(name))}" download="${E(name)}">Ladda ner</a><button type="button" class="iconbtn" data-pdfclose aria-label="Stäng">✕</button></span></div><div class="pdfpages"><p class="pdfmsg">Öppnar…</p></div>`;
  d.showModal();
  const box=d.querySelector(".pdfpages");
  try{
    if(!pdfjsLib){ pdfjsLib=await import(new URL("pdfjs/pdf.min.mjs",location.href).href); pdfjsLib.GlobalWorkerOptions.workerSrc=new URL("pdfjs/pdf.worker.min.mjs",location.href).href; }
    const pdf=await pdfjsLib.getDocument({url,isEvalSupported:false}).promise; box.innerHTML="";
    const w=Math.min(box.clientWidth-16, 1000), ratio=window.devicePixelRatio||1;
    for(let i=1;i<=pdf.numPages;i++){
      if(!d.open) return;
      const page=await pdf.getPage(i), v1=page.getViewport({scale:1}), vp=page.getViewport({scale:w/v1.width*ratio});
      const c=document.createElement("canvas"); c.width=vp.width; c.height=vp.height; c.style.width=(vp.width/ratio)+"px"; c.style.height=(vp.height/ratio)+"px";
      box.appendChild(c); await page.render({canvasContext:c.getContext("2d"),viewport:vp}).promise;
    }
  }catch(err){ box.innerHTML=`<p class="pdfmsg">Det gick inte att visa filen här. Använd Ladda ner i stället.</p>`; }
}
document.addEventListener("click",e=>{ const b=e.target.closest("[data-pdfopen]"); if(!b) return; if(!b.dataset.pdfopen){ setMsg("Filen hämtas, försök igen om en sekund."); blobUrl(b.dataset.sign); return; } openPdf(b.dataset.pdfopen,b.dataset.pdfname||"Dokument",dlUrl(b.dataset.pdfopen,b.dataset.pdfname||"fil")); });

/* ---------- dokument: medlemmarnas (site.dokument, låst lagring "dokument", alla medlemmar läser)
   och styrelsens (styrelse/protokoll, låst lagring "styrelse", bara styrelse och admin) ---------- */
const DK={protokoll:"Protokoll",stadgar:"Stadgar och beslut",ekonomi:"Ekonomi"};
const DK_HINT={protokoll:"Protokoll från årsstämmor och extra stämmor.",stadgar:"Stadgar, anläggningsbeslut, andelslängd och andra viktiga beslut.",ekonomi:"Årsredovisning, budget, revisionsberättelse och debiteringslängd."};
const SK={protokoll:"Styrelseprotokoll",avtal:"Avtal och offerter",ovrigt:"Övrigt"};
const DOK_ACCEPT=".pdf,.doc,.docx,.xls,.xlsx,.odt,.ods,.txt,.jpg,.jpeg,.png";
let sprot=[], sprotRef=null, dkKat="protokoll";
const isPdf=f=>f&&(/\.pdf$/i.test(f.namn||"")||f.typ==="application/pdf");
document.addEventListener("click",e=>{ const t=e.target.closest("[data-dk]"); if(!t) return; dkKat=t.dataset.dk;
  document.querySelectorAll("[data-dk]").forEach(x=>x.classList.toggle("on",x===t)); try{ t.scrollIntoView({block:"nearest",inline:"nearest"}); }catch(x){}
  q("#dk-docs").hidden=dkKat==="lankar"; q("#dk-lankar").hidden=dkKat!=="lankar"; renderDok(); });
function dokRows(list,kind){
  if(!list.length) return `<p class="empty">Inga dokument uppladdade ännu.</p>`;
  return sorted(list,true).map(p=>`<div class="item prot" data-pid="${E(p.id)}" data-pkind="${kind}">
    <span class="meta">${dfmt(p.datum)}</span><h3>${E(p.rubrik||"Dokument")}</h3>
    <div class="docrow"><span class="docname">${ico("file")}<span>${E(p.fil.namn)}</span></span><span class="docbtns">
      <button type="button" class="small" data-protopen>Öppna</button><button type="button" class="ghost small" data-protdl>Ladda ner</button></span></div>
    ${board?`<div class="row"><button type="button" class="ghost small" data-dokedit>Ändra</button><button type="button" class="danger" data-protdel>Ta bort</button></div>`:""}</div>`).join("");
}
function renderDok(){
  const a=q("#dkList");
  if(a&&dkKat!=="lankar"){ q("#dkTitle").textContent=DK[dkKat]; q("#dkHint").textContent=DK_HINT[dkKat]; a.innerHTML=dokRows((site.dokument||[]).filter(d=>(d.kat||"protokoll")===dkKat),"medlem"); }
  const b=q("#sprotList");
  if(b&&board){ const html=Object.keys(SK).map(k=>{ const l=sprot.filter(x=>(SK[x.kat]?x.kat:"protokoll")===k); return l.length?`<h3 class="dkgrp">${SK[k]}</h3>${dokRows(l,"styrelse")}`:""; }).join(""); b.innerHTML=html||`<p class="empty">Inga dokument uppladdade ännu.</p>`; }
  renderLankar();
}
async function protUrl(kind,p,dl){
  const {data,error}=await window.SB.storage.from(kind==="medlem"?"dokument":"styrelse").createSignedUrl(p.fil.path,600,dl?{download:p.fil.namn}:undefined);
  if(error) throw error; return data.signedUrl;
}
async function oppnaDok(kind,p){
  if(isPdf(p.fil)){ openPdf(await protUrl(kind,p,false),p.fil.namn,await protUrl(kind,p,true)); return; }
  const a=document.createElement("a"); a.href=await protUrl(kind,p,true); a.download=p.fil.namn; document.body.appendChild(a); a.click(); a.remove();
}
document.addEventListener("click",async e=>{
  const l=e.target.closest("[data-dokid]"); if(!l) return; e.preventDefault();
  const p=(site.dokument||[]).find(x=>x.id===l.dataset.dokid); if(!p) return;
  try{ await oppnaDok("medlem",p); }catch(err){ setMsg("Kunde inte öppna filen."); }
});
document.addEventListener("click",async e=>{
  const b=e.target.closest("[data-protopen],[data-protdl],[data-protdel],[data-dokedit]"); if(!b) return;
  const card=b.closest("[data-pid]"), kind=card.dataset.pkind, list=kind==="medlem"?(site.dokument||[]):sprot, p=list.find(x=>x.id===card.dataset.pid); if(!p) return;
  try{
    if(b.dataset.protopen!==undefined){ await oppnaDok(kind,p); return; }
    if(b.dataset.protdl!==undefined){ const a=document.createElement("a"); a.href=await protUrl(kind,p,true); a.download=p.fil.namn; document.body.appendChild(a); a.click(); a.remove(); return; }
  }catch(err){ setMsg("Kunde inte öppna filen."); return; }
  if(!board) return;
  if(b.dataset.dokedit!==undefined){ dokDialog(kind,p); return; }
  if(!b.classList.contains("armed")){ b.classList.add("armed"); b.textContent="Tryck igen för att ta bort"; setTimeout(()=>{ b.classList.remove("armed"); b.textContent="Ta bort"; },4000); return; }
  try{
    if(kind==="medlem"){ site.dokument=(site.dokument||[]).filter(x=>x.id!==p.id); saveSite(); if(p.fil.path) await window.SB.storage.from("dokument").remove([p.fil.path]); }
    else { sprot=sprot.filter(x=>x.id!==p.id); await sprotRef.set({items:sprot}); await window.SB.storage.from("styrelse").remove([p.fil.path]); }
  }catch(err){ setMsg("Kunde inte ta bort."); }
  renderDok(); renderLists(); setMsg("Dokumentet är borttaget.");
});
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-dokadd],#dkAdd"); if(!b||!board) return;
  dokDialog(b.dataset.dokadd||"medlem",null);
});
function dokDialog(kind,old){
  const K=kind==="styrelse"?SK:DK, kat0=old?(K[old.kat]?old.kat:"protokoll"):(kind==="medlem"?dkKat:"protokoll");
  const moten=sorted(site.moten,true).filter(m=>m.rubrik);
  const dlg=document.createElement("dialog"); dlg.className="bdlg";
  dlg.innerHTML=`<form method="dialog"><h2>${old?"Ändra dokument":kind==="styrelse"?"Ladda upp till styrelsen":"Ladda upp dokument"}</h2>
    <p class="hint">${kind==="styrelse"?"Bara styrelsen och admin kommer att kunna se dokumentet.":"Alla medlemmar kommer att kunna läsa dokumentet under Dokument."}</p>
    <label>Kategori<select id="prKat">${Object.entries(K).map(([k,v])=>`<option value="${k}"${k===kat0?" selected":""}>${v}</option>`).join("")}</select></label>
    ${kind==="medlem"&&moten.length?`<label id="prMoteL">Hör till möte<select id="prMote"><option value="">Inget särskilt möte</option>${moten.map(m=>`<option value="${E(m.id)}"${old&&old.mote===m.id?" selected":""}>${E(m.rubrik)}${m.datum?" ("+E(m.datum)+")":""}</option>`).join("")}</select></label>`:""}
    <label>Rubrik<input id="prRubrik" required value="${old?E(old.rubrik||""):""}" placeholder="t.ex. Protokoll årsstämma 2026"></label>
    <label>Datum<input id="prDatum" type="date" value="${old?E(old.datum||""):today()}" required></label>
    ${old?"":`<label class="filebtn" id="prFilL">${ico("file")}<span id="prFilN">Välj fil (PDF, Word, Excel eller bild)</span><input type="file" accept="${DOK_ACCEPT}" id="prFil"></label>`}
    <p class="status" id="prMsg"></p>
    <div class="bdlg-btns"><button value="ok" id="prOk">${old?"Spara":"Ladda upp"}</button><button value="cancel" class="ghost" formnovalidate>Avbryt</button></div></form>`;
  document.body.appendChild(dlg);
  const g=id=>dlg.querySelector(id);
  const moteVis=()=>{ if(g("#prMoteL")) g("#prMoteL").hidden=g("#prKat").value!=="protokoll"; }; moteVis(); g("#prKat").onchange=moteVis;
  if(g("#prMote")) g("#prMote").onchange=()=>{ const m=moten.find(x=>x.id===g("#prMote").value); if(m){ g("#prRubrik").value="Protokoll "+m.rubrik.charAt(0).toLowerCase()+m.rubrik.slice(1); if(m.datum) g("#prDatum").value=m.datum; } };
  if(g("#prFil")) g("#prFil").onchange=()=>{ const f=g("#prFil").files[0]; g("#prFilN").textContent=f?f.name:"Välj fil"; };
  g("#prOk").onclick=async ev=>{
    ev.preventDefault(); const rubrik=g("#prRubrik").value.trim(), datum=g("#prDatum").value, kat=g("#prKat").value, msg=g("#prMsg");
    const mote=(kat==="protokoll"&&g("#prMote"))?g("#prMote").value:"";
    if(!rubrik){ msg.textContent="Skriv en rubrik."; return; }
    if(old){
      Object.assign(old,{rubrik,datum,kat}); if(kind==="medlem") old.mote=mote;
      try{ if(kind==="medlem") saveSite(); else await sprotRef.set({items:sprot}); }catch(err){ msg.textContent="Kunde inte spara."; return; }
      dlg.close(); renderDok(); renderLists(); setMsg("Dokumentet är ändrat."); return;
    }
    const f=g("#prFil").files[0]; if(!f){ msg.textContent="Välj en fil."; return; }
    if(f.size>20*1024*1024){ msg.textContent="Filen är för stor. Max 20 MB."; return; }
    const ext=((f.name.match(/\.([a-z0-9]{1,5})$/i)||[])[1]||"").toLowerCase();
    if(!DOK_ACCEPT.split(",").includes("."+ext)){ msg.textContent="Filtypen stöds inte. Använd PDF, Word, Excel, text eller bild."; return; }
    g("#prOk").disabled=true; msg.textContent="Laddar upp…";
    try{
      const path=crypto.randomUUID()+"."+ext, bucket=kind==="medlem"?"dokument":"styrelse";
      const {error}=await window.SB.storage.from(bucket).upload(path,f,{contentType:f.type||"application/octet-stream",upsert:false}); if(error) throw error;
      const item={id:nid(),kat,datum,rubrik,fil:{path,namn:f.name,typ:f.type||""}};
      if(kind==="medlem"){ if(mote) item.mote=mote; site.dokument=[...(site.dokument||[]),item]; saveSite(); }
      else { sprot=[...sprot,item]; await sprotRef.set({items:sprot}); }
      dlg.close(); renderDok(); renderLists(); setMsg("Dokumentet är uppladdat.");
    }catch(err){ g("#prOk").disabled=false; msg.textContent="Det gick inte att ladda upp. Försök igen."; }
  };
  dlg.addEventListener("close",()=>dlg.remove()); dlg.showModal();
}

/* ---------- länkar (site.lankar; förifyllda tills styrelsen ändrar) ---------- */
const STD_LANKAR=[
  {id:"l1",namn:"Trafikverket: enskilda vägar",url:"https://www.trafikverket.se",beskr:"Statsbidrag till enskilda vägar, ansökan och regler. Sök på ”enskilda vägar” på sidan."},
  {id:"l2",namn:"Trafikverket: fel på statlig väg",url:"tel:0771921921",beskr:"Ring 0771-921 921 om fel på en statlig väg, till exempel vid utfarten."},
  {id:"l3",namn:"Lantmäteriet",url:"https://www.lantmateriet.se",beskr:"Gemensamhetsanläggningar, andelstal och samfällighetsföreningsregistret."},
  {id:"l7",namn:"Lantmäteriets normalstadgar",url:"https://lm.se/globalassets/blanketter/normalstadgar-for-samfallighetsforeningar.pdf",beskr:"Mall för stadgar som många samfällighetsföreningar har antagit (PDF). Föreningens egna stadgar finns under Stadgar och beslut."},
  {id:"l8",namn:"Guide vid stadgeändring",url:"https://lm.se/globalassets/fastigheter/samfalligheter/guide-vid-stadgeandring.pdf",beskr:"Lantmäteriets vägledning när föreningen vill ändra sina stadgar (PDF)."},
  {id:"l4",namn:"Min karta",url:"https://minkarta.lantmateriet.se",beskr:"Lantmäteriets karta med fastighetsgränser."},
  {id:"l5",namn:"Riksförbundet Enskilda Vägar",url:"https://www.revriks.se",beskr:"Råd och stöd för vägföreningar och samfälligheter."},
  {id:"l6",namn:"Flens kommun",url:"https://www.flen.se",beskr:"Kommunalt bidrag till enskilda vägar och kontakt med kommunen."}];
const lankar=()=>Array.isArray(site.lankar)?site.lankar:STD_LANKAR;
const okUrl=u=>/^(https?:\/\/[^\s]+|tel:[+\d\s-]+|mailto:[^\s]+)$/i.test(String(u||"").trim());
const visUrl=u=>{ if(/^tel:/i.test(u)) return u.slice(4); if(/^mailto:/i.test(u)) return u.slice(7); try{ return new URL(u).host.replace(/^www\./,""); }catch(e){ return u; } };
function renderLankar(){
  const el=q("#lnkList"); if(!el) return; const l=lankar();
  el.innerHTML=l.length? l.map(x=>`<div class="item lnk" data-lid="${E(x.id)}">
    <a class="lnkmain" href="${okUrl(x.url)?E(x.url):"#"}" ${/^https?:/i.test(x.url)?'target="_blank" rel="noopener"':""}><span class="lnkico">${ico(/^tel:/i.test(x.url)?"phone":"link")}</span>
      <span class="lnktxt"><strong>${E(x.namn)}</strong>${x.beskr?`<small>${E(x.beskr)}</small>`:""}<span class="lnkurl">${E(visUrl(x.url))}</span></span></a>
    ${board?`<div class="row"><button type="button" class="ghost small" data-lnkedit>Ändra</button><button type="button" class="danger" data-lnkdel>Ta bort</button></div>`:""}</div>`).join("")
  : `<p class="empty">Inga länkar ännu.</p>`;
}
function lnkDialog(old){
  const dlg=document.createElement("dialog"); dlg.className="bdlg";
  dlg.innerHTML=`<form method="dialog"><h2>${old?"Ändra länk":"Ny länk"}</h2>
    <label>Namn<input id="lnN" required value="${old?E(old.namn):""}" placeholder="t.ex. Trafikverket"></label>
    <label>Adress<input id="lnU" required value="${old?E(old.url):""}" placeholder="https://… eller tel:…"></label>
    <label>Beskrivning<input id="lnB" value="${old?E(old.beskr||""):""}" placeholder="Kort om vad man hittar där"></label>
    <p class="status" id="lnMsg"></p>
    <div class="bdlg-btns"><button value="ok" id="lnOk">Spara</button><button value="cancel" class="ghost" formnovalidate>Avbryt</button></div></form>`;
  document.body.appendChild(dlg); const g=id=>dlg.querySelector(id);
  g("#lnOk").onclick=ev=>{ ev.preventDefault();
    let u=g("#lnU").value.trim(); const n=g("#lnN").value.trim(), bsk=g("#lnB").value.trim();
    if(u&&!/^[a-z]+:/i.test(u)) u="https://"+u;
    if(!n){ g("#lnMsg").textContent="Skriv ett namn."; return; }
    if(!okUrl(u)){ g("#lnMsg").textContent="Adressen måste börja med https://, tel: eller mailto:"; return; }
    const l=lankar().map(x=>({...x}));
    if(old){ const i=l.findIndex(x=>x.id===old.id); if(i>=0) l[i]={...l[i],namn:n,url:u,beskr:bsk}; } else l.push({id:nid(),namn:n,url:u,beskr:bsk});
    site.lankar=l; saveSite(); renderLankar(); dlg.close(); setMsg("Länken är sparad."); };
  dlg.addEventListener("close",()=>dlg.remove()); dlg.showModal();
}
document.addEventListener("click",e=>{
  if(e.target.closest("#lnkAdd")){ if(board) lnkDialog(null); return; }
  const b=e.target.closest("[data-lnkedit],[data-lnkdel]"); if(!b||!board) return;
  const x=lankar().find(y=>y.id===b.closest("[data-lid]").dataset.lid); if(!x) return;
  if(b.dataset.lnkedit!==undefined){ lnkDialog(x); return; }
  if(!b.classList.contains("armed")){ b.classList.add("armed"); b.textContent="Tryck igen för att ta bort"; setTimeout(()=>{ b.classList.remove("armed"); b.textContent="Ta bort"; },4000); return; }
  site.lankar=lankar().filter(y=>y.id!==x.id); saveSite(); renderLankar(); setMsg("Länken är borttagen.");
});

/* ---------- åtgärdslista (styrelse/atgarder, bara styrelse och admin) ---------- */
let atg=[], atgRef=null;
const kortDatum=d=>{ const t=new Date(d+"T12:00:00"); return isNaN(t)?"":t.toLocaleDateString("sv-SE",{day:"numeric",month:"short"})+(t.getFullYear()!==new Date().getFullYear()?" "+t.getFullYear():""); };
const dagarKvar=d=>Math.round((new Date(d+"T12:00:00")-new Date(today()+"T12:00:00"))/864e5);
function atgStatus(a){ if(a.klar) return "klar"; if(!a.datum) return "ingen"; const n=dagarKvar(a.datum); return n<0?"sen":n<=7?"snart":"ok"; }
function atgSave(){ if(atgRef) atgRef.set({items:atg}).catch(()=>setMsg("Kunde inte spara åtgärdslistan.")); renderAtg(); }
function renderAtg(){
  const ö=atg.filter(a=>!a.klar).sort((a,b)=>String(a.datum||"9999").localeCompare(String(b.datum||"9999")));
  const k=atg.filter(a=>a.klar).sort((a,b)=>String(b.klarDatum||"").localeCompare(String(a.klarDatum||"")));
  const sen=ö.filter(a=>atgStatus(a)==="sen").length, c=q("#atgCount"); if(c){ c.textContent=sen; c.hidden=!sen; }
  const row=a=>{ const st=atgStatus(a), n=a.datum?dagarKvar(a.datum):null;
    const dag = a.klar ? `<span class="badge klar">Klar ${E(kortDatum(a.klarDatum||today()))}</span>`
      : !a.datum ? `<span class="badge typ">Inget datum</span>`
      : st==="sen" ? `<span class="badge sen">Försenad · ${E(kortDatum(a.datum))}</span>`
      : `<span class="badge ${st==="snart"?"ny":"typ"}">${n===0?"Idag":n===1?"Imorgon":"Senast "+E(kortDatum(a.datum))}</span>`;
    return `<div class="item atg ${st}" data-aid="${E(a.id)}"><div class="atg-row">
      <label class="atg-check" title="${a.klar?"Markera som ej klar":"Markera som klar"}"><input type="checkbox" data-atgdone ${a.klar?"checked":""}><span></span></label>
      <div class="atg-body"><h3>${E(a.uppgift)}</h3><div class="meta">${whoChips(a)}${dag}</div>${a.notering?`<p class="atg-note">${E(a.notering)}</p>`:""}</div></div>
      <div class="row"><button type="button" class="ghost small" data-atgedit>Ändra</button><button type="button" class="danger" data-atgdel>Ta bort</button></div></div>`; };
  const l=q("#atgList"); if(!l) return;
  l.innerHTML = ö.length ? ö.map(row).join("") : `<p class="empty">${atg.length?"Alla åtgärder är klara. Bra jobbat!":"Inga åtgärder ännu. Tryck på Ny åtgärd för att lägga till."}</p>`;
  q("#atgDoneBox").hidden=!k.length; q("#atgDoneSum").textContent=`Klara (${k.length})`; q("#atgDoneList").innerHTML=k.map(row).join("");
}
/* En åtgärd kan ha flera ansvariga: personer och/eller grupper. Äldre åtgärder har ett enda ansvarig-fält. */
const GRUPPER={styrelse:"Hela styrelsen",funktionarer:"Alla funktionärer"};
function ansvLista(a){
  if(Array.isArray(a.ansvariga)) return a.ansvariga;
  return a.ansvarig?[{namn:a.ansvarig,epost:a.ansvarigEpost||"",grupp:a.ansvarigGrupp||""}]:[];
}
const whoChips=a=>{ const l=ansvLista(a); return l.length? l.map(x=>`<span class="atg-who${x.grupp?" grp":""}">${ico(x.grupp?"users":"user")}${E(x.namn||GRUPPER[x.grupp]||"")}</span>`).join("") : `<span class="atg-who none">Ingen ansvarig</span>`; };
function atgDialog(a){
  const ny=!a; a=a||{};
  const pers=[...(site.styrelse||[]),...(site.funktionarer||[])].filter(x=>x.namn);
  const uniq=[...new Map(pers.map(x=>[x.namn,x])).values()].sort((x,y)=>x.namn.localeCompare(y.namn,"sv"));
  const vald=ansvLista(a), key=x=>x.grupp?"g:"+x.grupp:"p:"+String(x.namn||"").toLowerCase();
  const valdK=new Set(vald.map(key));
  const alla=[...Object.entries(GRUPPER).map(([k,v])=>({namn:v,epost:"",grupp:k})), ...uniq.map(x=>({namn:x.namn,epost:String(x.epost||"").trim().toLowerCase(),grupp:""}))];
  vald.forEach(x=>{ if(!alla.some(y=>key(y)===key(x))) alla.push({namn:x.namn,epost:x.epost||"",grupp:x.grupp||""}); });
  const box=x=>`<label class="ansv-opt${x.grupp?" grp":""}"><input type="checkbox" data-ansv='${E(JSON.stringify(x))}' ${valdK.has(key(x))?"checked":""}><span>${ico(x.grupp?"users":"user")}${E(x.namn)}</span></label>`;
  const d=document.createElement("dialog"); d.className="bdlg";
  d.innerHTML=`<form method="dialog"><h2>${ny?"Ny åtgärd":"Ändra åtgärd"}</h2>
    <label>Uppgift<input id="aU" required maxlength="200" placeholder="t.ex. Beställa grus till sträcka F" value="${E(a.uppgift||"")}"></label>
    <fieldset class="ansv"><legend>Ansvariga <small>(välj en eller flera)</small></legend>
      <div class="ansv-list" id="aList">${alla.map(box).join("")}</div>
      <button type="button" class="ghost small" id="aAnnan">+ Någon annan</button>
      <div class="ansv-ny" id="aNy" hidden>
        <label>Namn<input id="aAn"></label>
        <label>Mejl (valfritt, så att personen ser åtgärden i appen)<input id="aAe" type="email"></label>
        <button type="button" class="small" id="aAnOk">Lägg till</button>
      </div>
    </fieldset>
    <label>Klart senast<input id="aD" type="date" value="${E(a.datum||"")}"></label>
    <label>Anteckning (valfritt)<textarea id="aN" rows="3" maxlength="1000">${E(a.notering||"")}</textarea></label>
    <p class="status" id="aMsg"></p>
    <div class="bdlg-btns"><button type="button" id="aOk">${ny?"Lägg till":"Spara"}</button><button value="x" class="ghost" formnovalidate>Avbryt</button></div></form>`;
  document.body.appendChild(d); d.addEventListener("close",()=>d.remove());
  const g=id=>d.querySelector(id);
  g("#aAnnan").onclick=()=>{ g("#aNy").hidden=!g("#aNy").hidden; if(!g("#aNy").hidden) g("#aAn").focus(); };
  g("#aAnOk").onclick=()=>{ const n=g("#aAn").value.trim(); if(!n){ g("#aAn").focus(); return; }
    const x={namn:n,epost:g("#aAe").value.trim().toLowerCase(),grupp:""};
    g("#aList").insertAdjacentHTML("beforeend",box(x)); g("#aList").lastElementChild.querySelector("input").checked=true;
    g("#aAn").value=""; g("#aAe").value=""; g("#aNy").hidden=true; };
  g("#aOk").onclick=()=>{ const u=g("#aU").value.trim(); if(!u){ g("#aMsg").textContent="Skriv vad som ska göras."; return; }
    const ansvariga=[...d.querySelectorAll("[data-ansv]:checked")].map(c=>JSON.parse(c.dataset.ansv));
    const data={uppgift:u,ansvariga,ansvarig:ansvariga.map(x=>x.namn).join(", "),ansvarigEpost:"",ansvarigGrupp:"",datum:g("#aD").value,notering:g("#aN").value.trim()};
    if(!board){ g("#aOk").disabled=true; window.SB.rpc("lagg_till_atgard_m",{p_uppgift:u,p_ansvariga:ansvariga,p_datum:data.datum,p_notering:data.notering}).then(({error})=>{ if(error){ g("#aOk").disabled=false; g("#aMsg").textContent="Det gick inte att spara."; return; } d.close(); setMsg("Åtgärden är tillagd."); loadMina(); }); return; }
    if(ny) atg=[...atg,{id:nid(),skapad:today(),klar:false,...data}]; else Object.assign(atg.find(x=>x.id===a.id)||{},data);
    atgSave(); d.close(); setMsg(ny?"Åtgärden är tillagd.":"Åtgärden är sparad."); };
  d.showModal(); g("#aU").focus();
}
document.addEventListener("click",e=>{
  if(e.target.closest("#addAtg")&&board){ atgDialog(null); return; }
  const b=e.target.closest("[data-atgedit],[data-atgdel]"); if(!b||!board) return;
  const a=atg.find(x=>x.id===b.closest("[data-aid]").dataset.aid); if(!a) return;
  if(b.dataset.atgedit!==undefined){ atgDialog(a); return; }
  if(!b.classList.contains("armed")){ b.classList.add("armed"); b.textContent="Tryck igen för att ta bort"; setTimeout(()=>{ b.classList.remove("armed"); b.textContent="Ta bort"; },4000); return; }
  atg=atg.filter(x=>x.id!==a.id); atgSave(); setMsg("Åtgärden är borttagen.");
});
document.addEventListener("change",e=>{
  if(e.target.dataset.atgdone===undefined||!board) return;
  const a=atg.find(x=>x.id===e.target.closest("[data-aid]").dataset.aid); if(!a) return;
  a.klar=e.target.checked; a.klarDatum=a.klar?today():""; atgSave(); setMsg(a.klar?"Markerad som klar.":"Flyttad tillbaka till listan.");
});

/* ---------- Mina uppgifter (startsidan): åtgärder där jag är ansvarig eller som jag lagt till ---------- */
let mina=[], arVag=false;
async function loadMina(){
  if(!window.SB) return;
  try{ const [m,v]=await Promise.all([window.SB.rpc("mina_atgarder"),window.SB.rpc("ar_vagansvarig")]); mina=(m.data||[]); arVag=v.data===true; }catch(e){ return; }
  renderMina();
}
const minaOppna=()=>mina.filter(a=>!a.klar).sort((a,b)=>String(a.datum||"9999").localeCompare(String(b.datum||"9999")));
function minaRader(){
  const öppna=minaOppna();
  return öppna.length?öppna.map(a=>{ const st=atgStatus(a), n=a.datum?dagarKvar(a.datum):null;
      const dag=!a.datum?"":st==="sen"?`<span class="badge sen">Försenad · ${E(kortDatum(a.datum))}</span>`:`<span class="badge ${st==="snart"?"ny":"typ"}">${n===0?"Idag":n===1?"Imorgon":"Senast "+E(kortDatum(a.datum))}</span>`;
      return `<div class="minarow ${st}" data-mid="${E(a.id)}"><label class="atg-check" title="Markera som klar"><input type="checkbox" data-minadone><span></span></label><div class="atg-body"><strong>${E(a.uppgift)}</strong><div class="meta">${whoChips(a)}${dag}</div>${a.notering?`<p class="atg-note">${E(a.notering)}</p>`:""}</div></div>`; }).join("")
    :`<p class="hint">Inga öppna åtgärder just nu.</p>`;
}
/* Räknare på Mitt konto-knappen; listan visas under Mitt konto → Mina åtgärder */
function renderMina(){
  const n=minaOppna().length, bd=q("#kontoBadge"); if(bd){ bd.hidden=!n; bd.textContent=n; }
  const kb=q("#kontoBtn"); if(kb) kb.setAttribute("aria-label",n?`Mitt konto, ${n} öppna åtgärder`:"Mitt konto");
  const l=q("#minaDlgList"); if(l) l.innerHTML=minaRader();
  const t=q("#kMinaTxt"); if(t) t.textContent=n?`${n} öppna åtgärder där du är ansvarig.`:"Inga öppna åtgärder just nu.";
}
function minaDialog(){
  const kanLagga=arVag&&!board;
  const d=document.createElement("dialog"); d.className="bdlg minadlg";
  d.innerHTML=`<form method="dialog"><div class="ph"><h2>Mina åtgärder</h2>${kanLagga?`<button type="button" class="ghost small" id="addMinaAtg">+ Ny åtgärd</button>`:""}</div>
    <p class="hint">Åtgärder där du, eller en grupp du tillhör, är ansvarig. Bocka i när den är klar.</p>
    <div id="minaDlgList">${minaRader()}</div><div class="bdlg-btns"><button value="close">Stäng</button></div></form>`;
  document.body.appendChild(d); d.addEventListener("close",()=>d.remove()); d.showModal();
}
/* Egna kontaktuppgifter i medlemsregistret */
let minEpost="";
async function minEpostH(){ if(minEpost) return minEpost; try{ const {data}=await window.SB.auth.getUser(); minEpost=String((data&&data.user&&data.user.email)||"").toLowerCase(); }catch(e){} return minEpost; }
const minaKontakter=()=>(site.medlemmar||[]).filter(m=>minEpost&&String(m.epost||"").trim().toLowerCase()===minEpost);
async function kontaktDialog(){
  await minEpostH(); const mk=minaKontakter(), m=mk[0], fast=[...new Set((site.medlemmar||[]).map(x=>x.fastighet).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"sv"));
  const d=document.createElement("dialog"); d.className="bdlg";
  d.innerHTML=`<form method="dialog"><h2>Mina uppgifter</h2>
    <p class="hint">${m?`Det här står om dig i medlemsregistret${m.fastighet?` för <strong>${E(m.fastighet)}</strong>`:""}. Grannar och styrelsen ser uppgifterna.`:"Du finns inte i medlemsregistret än. Välj din fastighet och fyll i dina uppgifter."}</p>
    ${m?"":`<label>Fastighet<select id="kuF" required><option value="">Välj fastighet</option>${fast.map(f=>{ const bt=((site.medlemmar||[]).find(x=>x.fastighet===f&&x.beteckning)||{}).beteckning; return `<option value="${E(f)}">${E(f)}${bt&&bt!==f?" ("+E(bt)+")":""}</option>`; }).join("")}</select></label>
      <label id="kuVemL" hidden>Vem är du?<select id="kuVem"></select></label>`}
    <label>Namn<input id="kuN" required autocomplete="name" value="${m?E(m.namn||""):""}"></label>
    <label>Telefon<input id="kuT" type="tel" inputmode="tel" autocomplete="tel" value="${m?E(m.telefon||""):""}"></label>
    <label>Adress<input id="kuA" autocomplete="street-address" value="${m?E(m.adress||""):""}"></label>
    <label>Mejl<input value="${E(minEpost)}" disabled></label>
    <p class="hint">Mejladressen är den du loggar in med. Vill du byta den, kontakta styrelsen.${m?"":" Finns inte din fastighet i listan? Kontakta styrelsen."}</p>
    <p class="status" id="kuMsg"></p>
    <div class="bdlg-btns"><button value="ok" id="kuOk">Spara</button><button value="cancel" class="ghost" formnovalidate>Avbryt</button></div></form>`;
  document.body.appendChild(d); d.addEventListener("close",()=>d.remove());
  const g=x=>d.querySelector(x);
  /* Står personen redan i registret utan mejl? Välj sig själv så kopplas raden till inloggningen. */
  if(g("#kuF")) g("#kuF").onchange=()=>{
    const f=g("#kuF").value, utan=(site.medlemmar||[]).filter(x=>x.fastighet===f&&x.namn&&!String(x.epost||"").trim());
    g("#kuVemL").hidden=!utan.length;
    g("#kuVem").innerHTML=utan.map(x=>`<option value="${E(x.id)}">${E(x.namn)}</option>`).join("")+`<option value="">Jag står inte med, lägg till mig</option>`;
    const sync=()=>{ const r=utan.find(x=>x.id===g("#kuVem").value); g("#kuN").value=r?r.namn:""; g("#kuN").readOnly=!!r; if(r){ if(!g("#kuT").value) g("#kuT").value=r.telefon||""; if(!g("#kuA").value) g("#kuA").value=r.adress||""; } };
    g("#kuVem").onchange=sync; if(utan.length) sync(); else { g("#kuN").readOnly=false; }
  };
  g("#kuOk").onclick=async ev=>{ ev.preventDefault();
    const namn=g("#kuN").value.trim(), tel=g("#kuT").value.trim(), adr=g("#kuA").value.trim(), msg=g("#kuMsg");
    if(!namn){ msg.textContent="Skriv ditt namn."; return; }
    if(!m&&!g("#kuF").value){ msg.textContent="Välj din fastighet."; return; }
    g("#kuOk").disabled=true; msg.textContent="Sparar…";
    const r= m ? await window.SB.rpc("uppdatera_min_kontakt",{p_id:m.id,p_namn:namn,p_telefon:tel,p_adress:adr})
               : await window.SB.rpc("lagg_till_min_kontakt",{p_fastighet:g("#kuF").value,p_namn:namn,p_telefon:tel,p_adress:adr});
    if(r.error){ g("#kuOk").disabled=false; msg.textContent="Det gick inte att spara. Försök igen."; return; }
    await loadMem();
    renderLists(); d.close(); setMsg("Dina uppgifter är sparade.");
    const kt=q("#kKontTxt"); if(kt) kt.textContent=[namn,tel].filter(Boolean).join(" · ");
  };
  d.showModal();
}
document.addEventListener("click",e=>{ if(e.target.closest("#memMine")) kontaktDialog(); });
/* Styrelsen → Register: översikt över medlemsregistret */
function renderReg(){
  const el=q("#regStat"); if(!el) return; const m=site.medlemmar||[];
  const f=new Set(m.map(x=>String(x.fastighet||"").trim().toLowerCase()).filter(Boolean)).size;
  const k=m.filter(x=>x.namn), utanMejl=k.filter(x=>!String(x.epost||"").includes("@")).length;
  const utanKontakt=[...new Set(m.map(x=>x.fastighet))].filter(fa=>fa&&!m.some(x=>x.fastighet===fa&&x.namn)).length;
  const utanBet=[...new Set(m.map(x=>x.fastighet))].filter(fa=>fa&&!m.some(x=>x.fastighet===fa&&x.beteckning)).length;
  const box=(n,t,warn)=>`<div class="rs${warn&&n?" warn":""}"><b>${n}</b><span>${t}</span></div>`;
  el.innerHTML=box(f,"fastigheter")+box(k.length,"kontaktpersoner")+box(utanKontakt,"utan kontakt",1)+box(utanMejl,"saknar mejl",1)+box(utanBet,"saknar beteckning",1);
}
/* ---------- Kommentarer på inlägg i Aktuellt (tabellen kommentarer) ----------
   Alla medlemmar läser och skriver; man tar bort sina egna, styrelsen kan ta bort alla. Namnet sätts av databasen. */
let komm=new Map(), kommOk=false, kommOpen=new Set(), kommTimer=null;
async function loadKomm(){
  if(!window.SB) return;
  const {data,error}=await window.SB.from("kommentarer").select("id,nyhet_id,user_id,namn,text,skapad").order("skapad",{ascending:true});
  if(error){ kommOk=false; return; }
  kommOk=true; komm=new Map(); (data||[]).forEach(k=>{ if(!komm.has(k.nyhet_id)) komm.set(k.nyhet_id,[]); komm.get(k.nyhet_id).push(k); });
  document.querySelectorAll("[data-komm]").forEach(el=>kommRita(el));
}
const kommTid=t=>{ const d=new Date(t), idag=new Date(); const dag=d.toDateString()===idag.toDateString()?"i dag":d.toLocaleDateString("sv-SE",{day:"numeric",month:"short"}); return dag+" "+d.toLocaleTimeString("sv-SE",{hour:"2-digit",minute:"2-digit"}); };
function kommBlock(id){ return `<div class="komm" data-komm="${E(id)}">${kommInner(id)}</div>`; }
function kommInner(id){
  if(!kommOk) return "";
  const l=komm.get(id)||[], open=kommOpen.has(id);
  const knapp=`<button type="button" class="kommbtn" data-kommtoggle aria-expanded="${open}">${ico("chat")}${l.length?`${l.length} ${l.length===1?"kommentar":"kommentarer"}`:"Kommentera"}</button>`;
  if(!open) return knapp;
  return knapp+`<div class="kommlist">${l.map(k=>`<div class="kc" data-kid="${E(k.id)}"><div class="kc-h"><strong>${E(k.namn||"En medlem")}</strong><time>${E(kommTid(k.skapad))}</time>${(k.user_id===me||board)?`<button type="button" class="linkbtn kc-del" data-kommdel>Ta bort</button>`:""}</div><p>${E(k.text)}</p></div>`).join("")||`<p class="hint">Inga kommentarer än. Skriv den första.</p>`}</div>
    <div class="kommform"><textarea rows="2" maxlength="1000" placeholder="Skriv en kommentar…" data-kommtext></textarea><button type="button" class="small" data-kommsend>Skicka</button></div>`;
}
function kommRita(el){
  const id=el.dataset.komm, ta=el.querySelector("[data-kommtext]"), utkast=ta?ta.value:"", fokus=ta&&document.activeElement===ta;
  el.innerHTML=kommInner(id);
  const ny=el.querySelector("[data-kommtext]"); if(ny){ ny.value=utkast; if(fokus) ny.focus(); }
}
document.addEventListener("click",async e=>{
  const el=e.target.closest("[data-komm]"); if(!el) return; const id=el.dataset.komm;
  if(e.target.closest("[data-kommtoggle]")){ kommOpen.has(id)?kommOpen.delete(id):kommOpen.add(id); kommRita(el); if(kommOpen.has(id)){ const t=el.querySelector("[data-kommtext]"); if(t&&!(komm.get(id)||[]).length) t.focus(); } return; }
  const s=e.target.closest("[data-kommsend]");
  if(s){ const t=el.querySelector("[data-kommtext]"), txt=t.value.trim(); if(!txt){ t.focus(); return; }
    s.disabled=true; const {error}=await window.SB.from("kommentarer").insert({nyhet_id:id,text:txt});
    s.disabled=false; if(error){ setMsg("Det gick inte att skicka kommentaren."); return; }
    t.value=""; await loadKomm(); return; }
  const d=e.target.closest("[data-kommdel]");
  if(d){ if(!d.classList.contains("armed")){ d.classList.add("armed"); d.textContent="Tryck igen för att ta bort"; setTimeout(()=>{ if(d.isConnected){ d.classList.remove("armed"); d.textContent="Ta bort"; } },4000); return; }
    const kid=d.closest("[data-kid]").dataset.kid; const {error}=await window.SB.from("kommentarer").delete().eq("id",kid);
    if(error){ setMsg("Det gick inte att ta bort kommentaren."); return; } await loadKomm(); setMsg("Kommentaren är borttagen."); }
});
document.addEventListener("keydown",e=>{ if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)&&e.target.matches("[data-kommtext]")){ const b=e.target.closest("[data-komm]").querySelector("[data-kommsend]"); if(b) b.click(); } });
/* Rader i Mitt konto (dialogen byggs i sb.js) */
window.kontoBind=async d=>{
  const box=d.querySelector(".krows"); if(!box) return; await minEpostH(); const m=minaKontakter()[0];
  const kanMina=minaOppna().length||(arVag&&!board)||mina.length;
  box.insertAdjacentHTML("afterbegin",`<div class="krow"><div class="ktxt"><strong>Mina uppgifter</strong><small id="kKontTxt">${m?E([m.namn,m.telefon].filter(Boolean).join(" · ")||"Uppgifter saknas"):"Du finns inte i medlemsregistret än."}</small></div><div class="kbtns"><button type="button" class="ghost small" id="kKont">${m?"Ändra":"Lägg till"}</button></div></div>
    ${kanMina?`<div class="krow"><div class="ktxt"><strong>Mina åtgärder</strong><small id="kMinaTxt"></small></div><div class="kbtns"><button type="button" class="ghost small" id="kMina">Visa</button></div></div>`:""}`);
  d.querySelector("#kKont").onclick=()=>kontaktDialog();
  if(d.querySelector("#kMina")) d.querySelector("#kMina").onclick=()=>minaDialog();
  renderMina();
};
document.addEventListener("change",async e=>{
  if(e.target.dataset.minadone===undefined) return; const id=e.target.closest("[data-mid]").dataset.mid; e.target.disabled=true;
  const {error}=await window.SB.rpc("markera_min_atgard",{p_id:id,p_klar:true});
  if(error){ setMsg("Det gick inte att markera uppgiften."); e.target.checked=false; e.target.disabled=false; return; }
  setMsg("Bra jobbat! Uppgiften är markerad som klar."); loadMina();
});
document.addEventListener("click",e=>{ if(e.target.closest("#addMinaAtg")) atgDialog(null); });

/* ---------- ruta om notiser på startsidan ---------- */
async function pushBanner(){
  const b=q("#pushBanner"); if(!b||!window.VagPush) return; let nej=""; try{ nej=localStorage.getItem("vag_push_fraga")||""; }catch(e){}
  if(nej==="nej"){ b.hidden=true; return; }
  const st=await window.VagPush.status();
  if(st!=="av"&&st!=="ios"){ b.hidden=true; return; }
  b.innerHTML = st==="ios"
    ? `<span class="pb-ico">${ico("phone")}</span><div class="pb-txt"><strong>Vill du få notiser om nyheter? <button type="button" class="hjalpbtn" data-pushhjalp aria-label="Hjälp med notiser">?</button></strong><small>Lägg appen på hemskärmen: tryck på Dela-knappen i Safari och välj <em>Lägg till på hemskärmen</em>. Öppna sedan appen därifrån och slå på notiser under Mitt konto.</small></div><div class="pb-btns"><button type="button" class="ghost small" data-pushno>OK</button></div>`
    : `<span class="pb-ico">${ico("bell")}</span><div class="pb-txt"><strong>Vill du få en notis när det kommer nyheter? <button type="button" class="hjalpbtn" data-pushhjalp aria-label="Hjälp med notiser">?</button></strong><small>Du kan stänga av det när du vill under Mitt konto.</small></div><div class="pb-btns"><button type="button" class="small" data-pushyes>Slå på notiser</button><button type="button" class="ghost small" data-pushno>Inte nu</button></div>`;
  b.hidden=false;
}
document.addEventListener("click",async e=>{
  if(e.target.closest("[data-pushhjalp]")){ window.VagPush.hjalp(); return; }
  if(e.target.closest("[data-pushno]")){ try{ localStorage.setItem("vag_push_fraga","nej"); }catch(x){} q("#pushBanner").hidden=true; return; }
  const y=e.target.closest("[data-pushyes]"); if(!y) return; y.disabled=true; y.textContent="Slår på…";
  try{ await window.VagPush.enable(); q("#pushBanner").innerHTML=`<span class="pb-ico">${ico("bell")}</span><div class="pb-txt"><strong>Notiser är påslagna.</strong><small>Du får en notis när styrelsen lägger upp en nyhet.</small></div><div class="pb-btns"><button type="button" class="ghost small" data-pushno>OK</button></div>`; }
  catch(err){ q("#pushBanner").querySelector("small").textContent=window.VagPush.fel(err); y.disabled=false; y.textContent="Försök igen"; }
});

/* board edits on lists */
document.addEventListener("click",e=>{
  const b=e.target.closest("button"); if(!b||!board) return;
  if (b.dataset.edit==="intro"){ editIntro=!editIntro; q("#introText").value=site.intro||""; renderIntro(); return; }
  if (b.id==="introSave"){ site.intro=q("#introText").value; editIntro=false; renderIntro(); saveSite(); return; }
  if (b.id==="addBoard"){ pickBoardMember("styrelse"); return; }
  if (b.id==="addFunk"){ pickBoardMember("funktionarer"); return; }
  const add={addNews:["nyheter",{datum:today(),rubrik:"",text:""}],addMeet:["moten",{datum:"",rubrik:"",plats:"",text:"",lank:""}],addBoardBlank:["styrelse",{namn:"",roll:"",fastighet:"",telefon:"",epost:""}]}[b.id];
  if (add){ const it={id:nid(),...add[1]}; site[add[0]]=[...(site[add[0]]||[]),it]; editing.add(it.id); renderLists(); saveSite(); return; }
  if (b.dataset.addcontact!==undefined){ const first=(site.medlemmar||[]).find(m=>m.fastighet===b.dataset.addcontact)||{}; const it={id:nid(),fastighet:b.dataset.addcontact,beteckning:first.beteckning||"",namn:"",telefon:"",epost:"",adress:first.adress||""}; site.medlemmar=[...(site.medlemmar||[]),it]; editing.add(it.id); renderLists(); saveSite(); return; }
  if (b.id==="addMember"){ const it={id:nid(),fastighet:"",beteckning:"",namn:"",telefon:"",epost:"",adress:""}; site.medlemmar=[...(site.medlemmar||[]),it]; editing.add(it.id); go("medlemmar"); window.scrollTo({top:0}); renderLists(); saveSite(); showMemGroup(""); return; }
  const card=b.closest(".item[data-kind]"); if(!card) return;
  const kind=card.dataset.kind, id=card.dataset.id;
  if (b.dataset.act==="edit"){ editing.add(id); renderLists(); }
  else if (b.dataset.act==="done"){
    if(kind==="medlemmar"){ const it=(site.medlemmar||[]).find(x=>x.id===id); if(it){ const k=String(it.fastighet||"").trim().toLowerCase(), bt=String(it.beteckning||"").trim();
      (site.medlemmar||[]).forEach(x=>{ if(x!==it&&String(x.fastighet||"").trim().toLowerCase()===k&&k) x.beteckning=bt; }); saveSite(); } }
    editing.delete(id); renderLists(); }
  else if (b.dataset.act==="notis"){
    if(!b.classList.contains("armed")){ b.classList.add("armed"); b.textContent="Tryck igen för att skicka"; setTimeout(()=>{ if(b.isConnected){ b.classList.remove("armed"); renderLists(); } },5000); return; }
    b.disabled=true; b.textContent="Skickar…";
    window.SB.functions.invoke("notiser",{body:{action:"nyhet",id}}).then(async ({data,error})=>{
      if(error){ const j=error.context&&await error.context.json().catch(()=>null); setMsg((j&&j.fel)||"Det gick inte att skicka notisen."); renderLists(); return; }
      if(data.ingen){ setMsg("Ingen har slagit på notiser än."); renderLists(); return; }
      const it=(site.nyheter||[]).find(x=>x.id===id); if(it){ it.notis=today(); saveSite(); }
      renderLists(); setTimeout(()=>setMsg(`Notisen är skickad till ${data.skickade} ${data.skickade===1?"enhet":"enheter"}.`),900);
    });
  }
  else if (b.dataset.act==="tonews"){
    const m=(site.moten||[]).find(x=>x.id===id); if(!m) return;
    if(!m.rubrik){ setMsg("Skriv en rubrik för mötet först."); return; }
    const rad=[m.datum?dfmt(m.datum).replace(/<[^>]+>/g,""):"", m.plats||""].filter(Boolean).join(" · ");
    const text=[rad, m.text||"", /^https?:\/\//.test(m.lank||"")?m.lank:""].filter(Boolean).join("\n\n");
    const nyhet={rubrik:m.rubrik,text,filer:m.filer||[],bilder:m.bilder||[],mote:m.id};
    const fanns=(site.nyheter||[]).find(n=>n.mote===m.id);
    if(fanns) Object.assign(fanns,nyhet); else site.nyheter=[...(site.nyheter||[]),{id:nid(),datum:today(),...nyhet}];
    saveSite(); renderLists(); setMsg(fanns?"Nyheten under Aktuellt är uppdaterad.":"Mötet ligger nu under Aktuellt.");
  }
  else if (b.dataset.act==="del"){ if(!confirmDel()) return; site[kind]=site[kind].filter(x=>x.id!==id); editing.delete(id); renderLists(); saveSite(); }
});
let delArmed=0; function confirmDel(){ const n=Date.now(); if(n-delArmed<4000){ delArmed=0; return true; } delArmed=n; setMsg("Tryck på ta bort en gång till för att bekräfta."); return false; }
function setMsg(t){ const s=q("#status"); s.textContent=t; setTimeout(()=>{ if(s.textContent===t) s.textContent=""; },4000); }
document.addEventListener("input",e=>{
  if(!board) return; const t=e.target;
  const card=t.closest(".item[data-kind]"); if(!card||!t.dataset.f) return;
  const it=(site[card.dataset.kind]||[]).find(x=>x.id===card.dataset.id); if(it){ it[t.dataset.f]=t.value; saveSite(); }
});


/* ---------- utskick ---------- */
const UTEMPL={
  info:{amne:"Information från Baggetorp Hytternäs vägsamfällighet",text:"Hej!\n\n\n\nMed vänlig hälsning\nStyrelsen, Baggetorp Hytternäs vägsamfällighet"},
  kallelse:{amne:"Kallelse till årsstämma, Baggetorp Hytternäs vägsamfällighet",text:"Hej!\n\nVälkommen till årsstämma i Baggetorp Hytternäs vägsamfällighet.\n\nDatum: \nTid: \nPlats: \n\nFörslag till dagordning\n1. Stämmans öppnande\n2. Val av ordförande och sekreterare för stämman\n3. Val av två justerare\n4. Frågan om stämman är behörigen kallad\n5. Styrelsens förvaltningsberättelse och räkenskaper\n6. Revisorernas berättelse\n7. Ansvarsfrihet för styrelsen\n8. Ersättning till styrelse och revisorer\n9. Styrelsens förslag och inkomna motioner\n10. Utgifts och inkomststat samt debiteringslängd\n11. Val av styrelse och suppleanter\n12. Val av revisorer\n13. Övriga frågor\n14. Meddelande om var protokollet hålls tillgängligt\n15. Stämmans avslutande\n\nMed vänlig hälsning\nStyrelsen"},
  ovrigt:{amne:"",text:""}
};
let uTouched=false;
function uFill(){ const t=UTEMPL[q("#uTyp").value]; if(!uTouched||!q("#uText").value.trim()){ q("#uAmne").value=t.amne; q("#uText").value=t.text; uTouched=false; } }
document.addEventListener("click",e=>{
  const b=e.target.closest("#uClear"); if(!b) return;
  const has=q("#uAmne").value.trim()||q("#uText").value.trim();
  if(has && !b.classList.contains("armed")){ b.classList.add("armed"); b.textContent="Tryck igen för att rensa"; setTimeout(()=>{ b.classList.remove("armed"); b.textContent="Rensa"; },4000); return; }
  b.classList.remove("armed"); b.textContent="Rensa";
  q("#uAmne").value=""; q("#uText").value=""; q("#uNews").checked=false; uTouched=true; q("#uMsg").textContent=""; clearAtt("utskick",true); q("#uAmne").focus();
});
q("#uTyp").addEventListener("change",()=>{ if(uTouched && q("#uText").value.trim() && !confirm("Ersätta texten med mallen?")) return; uTouched=false; uFill(); });
["#uAmne","#uText"].forEach(s=>q(s).addEventListener("input",()=>{uTouched=true;}));
uFill();
let uSel=null;
function renderRcpt(){
  const mem=[...(site.medlemmar||[])].sort((a,b)=>String(a.fastighet).localeCompare(String(b.fastighet),"sv"));
  if (uSel===null) uSel=new Set(mem.filter(m=>m.epost||m.telefon).map(m=>m.id));
  q("#uRcpt").innerHTML = mem.length? mem.map(m=>{ const has=m.epost||m.telefon;
    return `<label class="rc ${has?"":"none"}"><input type="checkbox" data-rc="${m.id}" ${uSel.has(m.id)&&has?"checked":""} ${has?"":"disabled"}><span><strong>${E(m.fastighet)}</strong> ${E(m.namn)}<small>${has?[m.epost,m.telefon].filter(Boolean).map(E).join(" · "):"Saknar mejl och telefon"}</small></span></label>`; }).join("")
    : `<p class="empty">Medlemsregistret är tomt.</p>`;
}
function lsGet(k){ try{ return localStorage.getItem(k)||""; }catch(e){ return ""; } }
function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
/* Föreningens egen mejl: skickas av serverfunktionen skicka-utskick */
let mailCfg=null;
async function loadMailCfg(force){
  if(mailCfg&&!force) return mailCfg;
  try{ const {data,error}=await window.SB.functions.invoke("skicka-utskick",{body:{action:"status"}}); mailCfg = error? {konfigurerad:false,fel:true} : data; }catch(e){ mailCfg={konfigurerad:false,fel:true}; }
  return mailCfg;
}
async function renderMailSet(force){
  const inp=q("#mEpost"); if(!inp||!document.body.classList.contains("is-admin")) return;
  if(document.activeElement!==inp) inp.value=(site.installningar&&site.installningar.epost)||"";
  const c=await loadMailCfg(force), st=q("#mStatus"), svar=(site.installningar&&site.installningar.epost)||"";
  if(c.konfigurerad){ st.className="sender"; st.innerHTML=`Utskick skickas från <strong>${E(c.namn)}</strong> &lt;${E(c.fran)}&gt;.<br>${svar?`Svar från medlemmar går till <strong>${E(svar)}</strong>.`:"Skriv in föreningens adress ovan så att svar från medlemmar kommer fram."}`; }
  else { st.className="sender warn"; st.textContent = c.fel ? "Kunde inte kontrollera mejltjänsten just nu." : "Mejltjänsten är inte kopplad ännu. Det görs en gång av den som driver appen. Föreningens adress kan sparas redan nu."; }
}
document.addEventListener("click",async e=>{
  if(!e.target.closest("#mSave")) return;
  const v=q("#mEpost").value.trim().toLowerCase(), m=q("#mMsg");
  if(v && !/^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]+$/.test(v)){ m.textContent="Skriv en giltig mejladress."; return; }
  site.installningar={...(site.installningar||{}),epost:v}; saveSite(); m.textContent= v?"Sparat.":"Adressen är borttagen.";
  setTimeout(()=>renderMailSet(true),1500);
});
async function renderFrom(){
  const info=q("#uFromInfo");
  if(!mailCfg){ try{ const {data,error}=await window.SB.functions.invoke("skicka-utskick",{body:{action:"status"}}); mailCfg = error? {konfigurerad:false,fel:true} : data; }catch(e){ mailCfg={konfigurerad:false,fel:true}; } }
  const svar=(site.installningar&&site.installningar.epost)||mailCfg.svar_till;
  if(mailCfg.konfigurerad){ info.className="sender"; info.innerHTML=`Skickas i namnet <strong>${E(mailCfg.namn||"föreningen")}</strong>.${svar?` Svar går till <strong>${E(svar)}</strong>.`:" Admin har inte angett någon svarsadress än."}`; }
  else { info.className="sender warn"; info.innerHTML = mailCfg.fel ? "Kunde inte nå föreningens mejl just nu. Försök igen om en stund, eller använd Andra sätt att skicka." : "Föreningens mejl är inte inställd ännu, så det går inte att skicka härifrån. Använd Andra sätt att skicka tills vidare."; }
  updSend();
}
function updSend(){
  const b=q("#uSend"); if(!b) return; const n=mailsPicked().length;
  b.classList.remove("armed"); b.disabled = !(mailCfg&&mailCfg.konfigurerad) || !n;
  b.querySelector("span").textContent = !(mailCfg&&mailCfg.konfigurerad) ? "Föreningens mejl är inte inställd" : n ? `Skicka till ${n} mottagare` : "Välj mottagare med mejladress";
}
function mailsPicked(){ return [...new Set(picked().map(m=>(m.epost||"").trim().toLowerCase()).filter(x=>x.includes("@")))]; }
function picked(){ return (site.medlemmar||[]).filter(m=>uSel&&uSel.has(m.id)); }
document.addEventListener("change",e=>{ const c=e.target.dataset&&e.target.dataset.rc; if(!c) return; e.target.checked?uSel.add(c):uSel.delete(c); updSend(); });
document.addEventListener("click",async e=>{
  const st=e.target.closest("[data-st]"); if(st){ document.querySelectorAll("[data-st]").forEach(x=>x.classList.toggle("on",x===st)); ["led","reg","utskick","inkorg","prot","atg"].forEach(k=>q("#st-"+k).hidden=st.dataset.st!==k); if(st.dataset.st==="reg") renderReg(); try{ st.scrollIntoView({block:"nearest",inline:"nearest"}); }catch(e){} if(st.dataset.st==="prot") renderDok(); if(st.dataset.st==="atg") renderAtg(); if(st.dataset.st==="utskick") { renderRcpt(); renderULog(); renderFrom(); } if(st.dataset.st==="inkorg"){ renderInbox(); loadInbox(); } return; }
  const b=e.target.closest("#uAll,#uSend,#uMail,#uSms,#uCopyAddr,#uCopyText"); if(!b||!board) return;
  const msg=q("#uMsg"); const amne=q("#uAmne").value.trim(), text=q("#uText").value;
  if (b.id==="uAll"){ const mem=(site.medlemmar||[]).filter(m=>m.epost||m.telefon); const all=mem.every(m=>uSel.has(m.id)); uSel=new Set(all?[]:mem.map(m=>m.id)); b.textContent=all?"Markera alla":"Avmarkera alla"; renderRcpt(); updSend(); return; }
  if (b.id==="uSend"){
    const till=mailsPicked();
    if (!text.trim()){ msg.textContent="Skriv ett meddelande först."; return; }
    if (!till.length){ msg.textContent="Ingen vald mottagare har mejladress."; return; }
    if (!b.classList.contains("armed")){ b.classList.add("armed"); b.querySelector("span").textContent=`Tryck igen för att skicka till ${till.length}`; setTimeout(()=>{ if(b.classList.contains("armed")) updSend(); },6000); return; }
    b.classList.remove("armed"); b.disabled=true; b.querySelector("span").textContent="Skickar…"; msg.textContent="";
    let res; try{ const {data,error}=await window.SB.functions.invoke("skicka-utskick",{body:{amne,text,till,bilagor:getAtt("utskick"),lank:location.origin+location.pathname}}); res = error? {fel:(error.context&&await error.context.json().catch(()=>null)||{}).fel||"Det gick inte att skicka."} : data; }catch(err){ res={fel:"Det gick inte att skicka."}; }
    if (res.fel){ msg.textContent=res.fel; updSend(); return; }
    site.utskick=[{id:nid(),datum:today(),typ:q("#uTyp").value,amne,text,fran:res.fran,kanal:"mejl",antal:res.skickade,bilagor:res.bilagor||[]},...(site.utskick||[])].slice(0,100);
    if (q("#uNews").checked && !(site.nyheter||[]).some(x=>x.text===text)) site.nyheter=[...(site.nyheter||[]),{id:nid(),datum:today(),rubrik:amne||"Information",text}];
    saveSite(); renderLists(); renderULog(); updSend(); clearAtt("utskick",false);
    msg.textContent = `Klart! ${res.skickade} mejl skickade.` + (res.misslyckade&&res.misslyckade.length ? ` Det gick inte att skicka till: ${res.misslyckade.join(", ")}.` : "");
    return;
  }
  const mails=[...new Set(picked().map(m=>(m.epost||"").trim()).filter(Boolean))];
  const tels=[...new Set(picked().map(m=>(m.telefon||"").replace(/[^\d+]/g,"")).filter(Boolean))];
  if (b.id==="uCopyAddr"){ try{ await navigator.clipboard.writeText(mails.join(", ")); msg.textContent=mails.length+" adresser kopierade."; }catch(err){ msg.textContent="Kunde inte kopiera."; } return; }
  if (b.id==="uCopyText"){ try{ await navigator.clipboard.writeText((amne?amne+"\n\n":"")+text); msg.textContent="Texten är kopierad."; }catch(err){ msg.textContent="Kunde inte kopiera."; } return; }
  if (!text.trim()){ msg.textContent="Skriv ett meddelande först."; return; }
  let href;
  if (b.id==="uMail"){
    if(!mails.length){ msg.textContent="Ingen vald mottagare har mejladress."; return; }
    href="mailto:?bcc="+mails.map(encodeURIComponent).join(",")+"&subject="+encodeURIComponent(amne)+"&body="+encodeURIComponent(text);
  } else {
    if(!tels.length){ msg.textContent="Ingen vald mottagare har telefonnummer."; return; }
    const sep=/iPhone|iPad|iPod/.test(navigator.userAgent)?"&":"?";
    href="sms:"+tels.join(",")+sep+"body="+encodeURIComponent((amne?amne+"\n\n":"")+text);
  }
  const link=document.createElement("a"); link.href=href; link.target=/^https:/.test(href)?"_blank":"_top"; link.rel="noopener"; document.body.appendChild(link); link.click(); link.remove();
  const n = b.id==="uMail"?mails.length:tels.length;
  site.utskick=[{id:nid(),datum:today(),typ:q("#uTyp").value,amne,text,fran:b.id==="uMail"?"egen mejlapp":"",kanal:b.id==="uMail"?"mejl":"sms",antal:n},...(site.utskick||[])].slice(0,100);
  if (q("#uNews").checked && !(site.nyheter||[]).some(x=>x.text===text)) site.nyheter=[...(site.nyheter||[]),{id:nid(),datum:today(),rubrik:amne||"Information",text}];
  saveSite(); renderLists(); renderULog();
  const app = b.id!=="uMail"?"Smsappen":"Mejlappen";
  msg.innerHTML=`${app} öppnas med ${n} mottagare. Kontrollera avsändaren och tryck skicka där. Öppnades den inte? <a href="${E(href)}" target="${/^https:/.test(href)?"_blank":"_top"}" rel="noopener">Tryck här</a>.`;
});
/* ---------- bilagor i mejl (utskick och svar). Filerna läggs i den låsta lagringsplatsen styrelse/bilagor/ ---------- */
const mailAtt={}; const MAXATT=15*1024*1024;
const fmtSize=n=>n>1048576?(n/1048576).toFixed(1).replace(".",",")+" MB":Math.max(1,Math.round(n/1024))+" kB";
function attInner(key){ const l=mailAtt[key]||[];
  return `<label class="filebtn attpick">${ico("file")}<span>Bifoga filer</span><input type="file" multiple data-mailatt="${E(key)}"></label>
    ${l.length?`<div class="attchips">${l.map((a,i)=>`<span class="attchip">${E(a.namn)} <small>${fmtSize(a.size)}</small><button type="button" class="danger" data-attrm="${E(key)}|${i}" aria-label="Ta bort ${E(a.namn)}">✕</button></span>`).join("")}</div>`:""}
    <span class="status" data-attmsg></span>`; }
function renderAtt(key){ document.querySelectorAll(`.mailatt[data-attkey="${CSS.escape(key)}"]`).forEach(el=>{ const m=el.querySelector("[data-attmsg]"), t=m?m.textContent:""; el.innerHTML=attInner(key); if(t) el.querySelector("[data-attmsg]").textContent=t; }); }
const getAtt=key=>(mailAtt[key]||[]).map(a=>({path:a.path,namn:a.namn}));
function clearAtt(key,removeFiles){ const l=mailAtt[key]||[]; if(removeFiles&&l.length) window.SB.storage.from("styrelse").remove(l.map(a=>a.path)).catch(()=>{}); mailAtt[key]=[]; renderAtt(key); }
document.addEventListener("change",async e=>{
  const inp=e.target; if(!inp.dataset||inp.dataset.mailatt===undefined||!board) return;
  const key=inp.dataset.mailatt, files=[...inp.files]; inp.value="";
  const box=inp.closest(".mailatt"), msg=()=>box.querySelector("[data-attmsg]");
  for(const f of files){
    const l=mailAtt[key]||(mailAtt[key]=[]); const total=l.reduce((s,a)=>s+a.size,0)+f.size;
    if(total>MAXATT){ msg().textContent=`${f.name} får inte plats. Bilagorna får vara högst 15 MB tillsammans.`; continue; }
    if(l.length>=10){ msg().textContent="Högst 10 bilagor per mejl."; break; }
    msg().textContent="Laddar upp "+f.name+"…";
    const safe=(f.name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^\w.-]+/g,"_").replace(/^_+|_+$/g,"")||"bilaga").slice(0,80);
    const path=`bilagor/${crypto.randomUUID()}/${safe}`;
    try{ const {error}=await window.SB.storage.from("styrelse").upload(path,f,{contentType:f.type||"application/octet-stream",upsert:false}); if(error) throw error;
      l.push({path,namn:f.name,size:f.size}); renderAtt(key); msg().textContent=""; }
    catch(err){ msg().textContent="Kunde inte ladda upp "+f.name+"."; }
  }
});
renderAtt("utskick");
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-attrm]"); if(!b) return; const [key,i]=b.dataset.attrm.split("|"); const l=mailAtt[key]||[]; const a=l[+i]; if(!a) return;
  l.splice(+i,1); window.SB.storage.from("styrelse").remove([a.path]).catch(()=>{}); renderAtt(key);
});

/* ---------- inkorg (mejl till föreningens adress) ---------- */
let inMail=[], inArch=false;
async function loadInbox(){
  if(!board||!window.SB) return;
  const {data,error}=await window.SB.from("inkorg").select("id,mottagen,fran,fran_namn,amne,text,html,last,arkiv,svar").order("mottagen",{ascending:false}).limit(300);
  if(error) return; inMail=data||[]; updInCount();
  if(!q("#st-inkorg").hidden && !q("#inList").contains(document.activeElement)) renderInbox();
}
function updInCount(){ const n=inMail.filter(m=>!m.last&&!m.arkiv).length;
  [q("#inCount"),q("#navInCount")].forEach(el=>{ if(!el) return; el.textContent=n; el.hidden=!n; }); }
function mailText(m){ if(m.text) return m.text; if(!m.html) return ""; try{ const doc=new DOMParser().parseFromString(m.html.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi,"").replace(/<br\s*\/?>/gi,"\n").replace(/<\/(p|div|tr|h[1-6]|li)>/gi,"\n"),"text/html"); return (doc.body.textContent||"").replace(/\n{3,}/g,"\n\n").trim(); }catch(e){ return ""; } }
const dtfmt=d=>new Date(d).toLocaleString("sv-SE",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
function renderInbox(){
  const list=inMail.filter(m=>!!m.arkiv===inArch);
  q("#inArchBtn").textContent=inArch?"Visa inkorgen":"Visa arkiv";
  q("#inList").innerHTML = list.length ? list.map(m=>`<details class="item mail${m.last?"":" unread"}" data-mid="${E(m.id)}">
    <summary><span class="meta">${!m.last?'<span class="badge ny">Ny</span>':""}${(m.svar||[]).length?'<span class="badge klar">Besvarad</span>':""} ${E(dtfmt(m.mottagen))} · ${E(m.fran_namn||m.fran)}</span><h3>${E(m.amne||"(utan ämne)")}</h3></summary>
    <p class="meta">Från ${E(m.fran_namn?m.fran_namn+" <"+m.fran+">":m.fran)}</p>
    <div class="mailtext">${E(mailText(m))||'<em>Mejlet saknar text.</em>'}</div>
    ${(m.svar||[]).map(s=>`<div class="reply"><strong>Svar ${E(dtfmt(s.datum))}${s.av?" av "+E(s.av):""}:</strong><br>${E(s.text)}${(s.bilagor||[]).length?`<br><small>Bilagor: ${s.bilagor.map(E).join(", ")}</small>`:""}</div>`).join("")}
    <label>Svara ${E(m.fran)}<textarea rows="4" data-replytext></textarea></label>
    <div class="mailatt" data-attkey="in-${E(m.id)}">${attInner("in-"+m.id)}</div>
    <div class="row acts"><button type="button" data-inreply>Skicka svar</button><button type="button" class="ghost small" data-inarch>${m.arkiv?"Flytta till inkorgen":"Arkivera"}</button><button type="button" class="ghost small" data-inunread>Markera som oläst</button></div>
    <span class="status" data-inmsg></span></details>`).join("") : `<p class="empty">${inArch?"Arkivet är tomt.":"Inga mejl i inkorgen."}</p>`;
}
async function setMail(id,patch){ const m=inMail.find(x=>x.id===id); if(m) Object.assign(m,patch); updInCount(); try{ await window.SB.from("inkorg").update(patch).eq("id",id); }catch(e){} }
document.addEventListener("toggle",async e=>{ const d=e.target; if(!d.matches||!d.matches("details.mail")||!d.open) return; const m=inMail.find(x=>x.id===d.dataset.mid); if(!m) return;
  if(!m.last){ d.classList.remove("unread"); const b=d.querySelector(".badge.ny"); if(b) b.remove(); setMail(m.id,{last:true}); }
  if(!m.text&&!m.html&&!m.hamtar){ m.hamtar=true; const box=d.querySelector(".mailtext"); box.innerHTML="<em>Hämtar mejlets text…</em>";
    let res; try{ const {data,error}=await window.SB.functions.invoke("skicka-utskick",{body:{action:"hamta",inkorg_id:m.id}}); res= error? {fel:(error.context&&await error.context.json().catch(()=>null)||{}).fel||"Kunde inte hämta texten."} : data; }catch(err){ res={fel:"Kunde inte hämta texten."}; }
    m.hamtar=false;
    if(res.fel){ box.innerHTML=`<em>${E(res.fel)}</em>`; return; }
    m.text=res.text||""; m.html=res.html||""; box.textContent=mailText(m)||"Mejlet saknar text."; }
},true);
document.addEventListener("click",async e=>{
  if(e.target.closest("#inArchBtn")){ inArch=!inArch; renderInbox(); return; }
  const b=e.target.closest("[data-inreply],[data-inarch],[data-inunread]"); if(!b||!board) return;
  const d=b.closest("details.mail"), id=d.dataset.mid, msg=d.querySelector("[data-inmsg]"), m=inMail.find(x=>x.id===id); if(!m) return;
  if(b.dataset.inarch!==undefined){ await setMail(id,{arkiv:!m.arkiv}); renderInbox(); return; }
  if(b.dataset.inunread!==undefined){ await setMail(id,{last:false}); renderInbox(); return; }
  const text=d.querySelector("[data-replytext]").value;
  if(!text.trim()){ msg.textContent="Skriv ett svar först."; return; }
  b.disabled=true; msg.textContent="Skickar…";
  let res; try{ const {data,error}=await window.SB.functions.invoke("skicka-utskick",{body:{action:"svara",inkorg_id:id,text,bilagor:getAtt("in-"+id)}}); res= error? {fel:(error.context&&await error.context.json().catch(()=>null)||{}).fel||"Det gick inte att skicka."} : data; }catch(err){ res={fel:"Det gick inte att skicka."}; }
  b.disabled=false;
  if(res.fel){ msg.textContent=res.fel; return; }
  m.svar=[...(m.svar||[]),{datum:new Date().toISOString(),av:"",text,bilagor:getAtt("in-"+id).map(x=>x.namn)}]; m.last=true; clearAtt("in-"+id,false); renderInbox();
  setMsg("Svaret är skickat till "+res.till+".");
});
const UTYP={info:"Information",kallelse:"Kallelse",ovrigt:"Övrigt"};
function renderULog(){
  const l=site.utskick||[];
  q("#uLog").innerHTML = l.length? l.map(u=>`<details class="item"><summary><span class="meta">${dfmt(u.datum)} · ${UTYP[u.typ]||""} · ${u.kanal} till ${u.antal}${u.fran?" från "+E(u.fran):""}</span> <strong>${E(u.amne||"Utan ämne")}</strong></summary><p>${E(u.text)}</p>${(u.bilagor||[]).length?`<p class="meta">Bilagor: ${u.bilagor.map(E).join(", ")}</p>`:""}</details>`).join("") : `<p class="empty">Inga utskick ännu.</p>`;
}
/* ---------- fault reports and feedback ---------- */
const STATUS={ny:"Ny",pagar:"Åtgärdas",klar:"Åtgärdad"};
const arch={all:false}; let cfilter="alla";
function actions(coll,it,done){
  return `<div class="row acts">
    <button type="button" class="${done?"ghost":""} small" data-done="${coll}">${done?"Ångra åtgärdad":"Markera som åtgärdad"}</button>
    <button type="button" class="ghost small" data-arch="${coll}">${it.arkiv?"Återställ från arkiv":"Arkivera"}</button></div>`;
}
document.addEventListener("click",async e=>{
  const f=e.target.closest("[data-cf]"); if(f){ cfilter=f.dataset.cf; document.querySelectorAll("[data-cf]").forEach(x=>x.classList.toggle("on",x===f)); renderCases(); return; }
  const b=e.target.closest("[data-done],[data-arch],[data-showarch]"); if(!b||!board) return;
  if (b.dataset.showarch){ arch.all=!arch.all; b.textContent=arch.all?"Visa aktuella":"Visa arkiv"; renderCases(); return; }
  const card=b.closest("[data-uid]"); const uid=card.dataset.uid, id=card.dataset.fid||card.dataset.sid;
  const coll=b.dataset.done||b.dataset.arch, store=coll==="felanmalan"?fel:syn;
  const it=(store[uid]?.items||[]).find(x=>x.id===id); if(!it) return;
  let patch;
  if (b.dataset.done){ patch = coll==="felanmalan" ? {status:(it.status==="klar"?"ny":"klar")} : {klar:!it.klar}; }
  else patch={arkiv:!it.arkiv};
  b.disabled=true;
  try{ await patchItem(coll,store,uid,id,patch); }catch(err){ setMsg("Kunde inte spara."); }
  renderCases();
});
function felCard(it,nm){
  return `<div class="item" data-uid="${E(it.uid)}" data-fid="${E(it.id)}">
    <span class="meta"><span class="badge typ">Fel på vägen</span> ${dfmt(it.datum)} · ${E(nm[it.uid]||"En medlem")} <span class="badge ${it.status||"ny"}">${STATUS[it.status||"ny"]}</span></span>
    <h3>${E(it.plats||"Plats ej angiven")}</h3><p>${E(it.text)}</p>
    ${it.svar&&!board?`<div class="reply"><strong>Styrelsen:</strong> ${E(it.svar)}</div>`:""}
    ${board?`<div class="grid2"><label>Status<select data-ff="status">${Object.entries(STATUS).map(([k,v])=>`<option value="${k}" ${k===(it.status||"ny")?"selected":""}>${v}</option>`).join("")}</select></label><label>Svar från styrelsen<input data-ff="svar" value="${E(it.svar)}"></label></div>${actions("felanmalan",it,(it.status||"ny")==="klar")}`:""}
    ${(it.uid===me&&!board)?`<div class="row"><button type="button" class="danger" data-feldel="${E(it.id)}">Ta bort min anmälan</button></div>`:""}
  </div>`;
}
function synCard(it,nm){
  return `<div class="item" data-uid="${E(it.uid)}" data-sid="${E(it.id)}">
    <span class="meta"><span class="badge typ">Synpunkt</span> ${dfmt(it.datum)}${board?" · "+E(nm[it.uid]||"En medlem"):""} ${it.klar?'<span class="badge klar">Åtgärdad</span>':'<span class="badge ny">Ny</span>'}</span>
    <h3>${E(it.amne||"Synpunkt")}</h3><p>${E(it.text)}</p>
    ${board?`<label>Svar till medlemmen<textarea rows="2" data-sf="svar">${E(it.svar)}</textarea></label>${actions("synpunkter",it,!!it.klar)}`:(it.svar?`<div class="reply"><strong>Styrelsen svarar:</strong> ${E(it.svar)}</div>`:`<span class="meta">Inget svar ännu. Bara du och styrelsen ser den här synpunkten.</span>`)}
  </div>`;
}
async function renderCases(){
  const all=[];
  Object.entries(fel).forEach(([uid,d])=>(d.items||[]).forEach(it=>all.push({...it,uid,kind:"fel"})));
  Object.entries(syn).forEach(([uid,d])=>(d.items||[]).forEach(it=>all.push({...it,uid,kind:"syn"})));
  let list=all.filter(it=> it.kind==="syn"&&!board ? true : !!it.arkiv===arch.all);
  if (cfilter!=="alla") list=list.filter(it=>it.kind===cfilter);
  list.sort((a,b)=>String(b.datum).localeCompare(String(a.datum)));
  q("#caseHead").textContent = arch.all? "Arkiv" : board? "Alla ärenden" : "Fel och dina synpunkter";
  const nm=await names([...new Set(list.map(x=>x.uid))]);
  q("#caseList").innerHTML = list.length? list.map(it=>it.kind==="fel"?felCard(it,nm):synCard(it,nm)).join("") : `<p class="empty">${arch.all?"Arkivet är tomt.":"Inga ärenden just nu."}</p>`;
}
const renderFel=renderCases, renderSyn=renderCases;
function caseType(){ return (document.querySelector('input[name=ctype]:checked')||{}).value||"fel"; }
function updateForm(){
  const f=caseType()==="fel";
  q("#caseHint").textContent = f? "Till exempel hål, trasig trumma, fallna träd eller dåligt plogat. Alla medlemmar ser felanmälningarna." : "Bara styrelsen läser det du skriver. Du ser själv dina synpunkter och styrelsens svar här nedanför.";
  q("#caseTitleLbl").textContent = f? "Var på vägen" : "Ämne";
  q("#caseTitle").placeholder = f? "t.ex. sträcka F, strax efter Stavbergavägen" : "t.ex. andelstal, snöröjning, mina kontaktuppgifter";
  q("#caseTextLbl").textContent = f? "Vad har hänt" : "Din synpunkt eller fråga";
  q("#caseSend").textContent = f? "Skicka felanmälan" : "Skicka till styrelsen";
}
document.addEventListener("change",e=>{ if(e.target.name==="ctype") updateForm(); });
updateForm();
async function addTo(coll,store,item){
  const ref=DB.doc(coll+"/"+me); const cur=store[me]||{items:[]};
  const next={items:[...(cur.items||[]),item]};
  await ref.set(next); store[me]=next;
}
async function patchItem(coll,store,uid,id,patch){
  const d=store[uid]; if(!d) return; const items=d.items.map(x=>x.id===id?{...x,...patch}:x);
  store[uid]={items}; await DB.doc(coll+"/"+uid).set({items});
}
q("#caseSend").addEventListener("click",async()=>{
  const f=caseType()==="fel", title=q("#caseTitle").value.trim(), text=q("#caseText").value.trim(), msg=q("#caseMsg");
  if(!text){ msg.textContent= f?"Skriv vad som har hänt.":"Skriv din synpunkt."; return; }
  if(!DB||!me||!canWrite){ msg.textContent="Du behöver vara inbjuden som medlem för att kunna skicka."; return; }
  try{
    if (f) await addTo("felanmalan",fel,{id:nid(),datum:today(),plats:title,text,status:"ny",svar:""});
    else await addTo("synpunkter",syn,{id:nid(),datum:today(),amne:title,text,svar:""});
    q("#caseTitle").value=""; q("#caseText").value=""; msg.textContent= f?"Tack! Felanmälan är skickad.":"Tack! Styrelsen har fått din synpunkt."; renderCases();
  }catch(e){ msg.textContent="Kunde inte skicka. Försök igen."; }
});
document.addEventListener("click",async e=>{
  const b=e.target.closest("[data-feldel]"); if(!b) return;
  if(!confirmDel()) return;
  const d=fel[me]; if(!d) return; const items=d.items.filter(x=>x.id!==b.dataset.feldel);
  try{ await DB.doc("felanmalan/"+me).set({items}); fel[me]={items}; renderFel(); }catch(err){ setMsg("Kunde inte ta bort."); }
});
const ptimers={};
document.addEventListener("input",e=>{
  if(!board) return; const t=e.target;
  const f=t.closest("[data-fid]"), s=t.closest("[data-sid]");
  if (f&&t.dataset.ff){ const k=f.dataset.uid+f.dataset.fid; clearTimeout(ptimers[k]); ptimers[k]=setTimeout(()=>patchItem("felanmalan",fel,f.dataset.uid,f.dataset.fid,{[t.dataset.ff]:t.value}).catch(()=>setMsg("Kunde inte spara.")),t.tagName==="SELECT"?0:700); }
  if (s&&t.dataset.sf){ const k=s.dataset.uid+s.dataset.sid; clearTimeout(ptimers[k]); ptimers[k]=setTimeout(()=>patchItem("synpunkter",syn,s.dataset.uid,s.dataset.sid,{[t.dataset.sf]:t.value}).catch(()=>setMsg("Kunde inte spara.")),700); }
});
document.addEventListener("input",e=>{ if(e.target.id==="memSearch") renderLists(); });
document.addEventListener("change",e=>{ if(e.target.dataset&&e.target.dataset.ff==="status") e.target.dispatchEvent(new Event("input",{bubbles:true})); });

function busy(){ const a=document.activeElement; return a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.closest(".page"); }

/* ---------- connect ---------- */
renderSite(); renderCases();
(async()=>{
  try{
    U=await claude.use("user");
    let owner=false;
    if (U){ owner=(await U.isOwner())===true; board=owner||(await U.canEdit())===true; const cw=await U.can("data.write"); canWrite = cw!==false; me=await U.id(); }
    document.body.classList.toggle("is-board",board); document.body.classList.toggle("is-admin",owner===true); { const st=q("#status"); if(st&&st.textContent==="Laddar…") st.textContent=""; }
    if (board){ setTimeout(loadInbox,1500); setInterval(()=>{ if(document.visibilityState==="visible") loadInbox(); },60000); document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") loadInbox(); }); }
    q("#role").textContent = owner? "" : board? "Styrelse" : canWrite&&U? "Medlem" : (U? "Läsare" : "");
    DB=await claude.use("db"); if(!DB) return;
    loadMem(); loadKomm();
    try{ window.SB.channel("kommentarer").on("postgres_changes",{event:"*",schema:"public",table:"kommentarer"},()=>{ clearTimeout(kommTimer); kommTimer=setTimeout(loadKomm,300); }).subscribe(); }catch(e){}
    try{ window.SB.channel("medlemmar").on("postgres_changes",{event:"*",schema:"public",table:"medlemmar"},()=>{ clearTimeout(memTimer); memTimer=setTimeout(loadMem,400); }).subscribe(); }catch(e){}
    document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") loadMem(); });
    if (board && DB){ atgRef=DB.doc("styrelse/atgarder"); atgRef.onSnapshot(sn=>{ if(q("#st-atg").contains(document.activeElement)&&document.activeElement.tagName!=="INPUT") return; atg=(sn.exists&&sn.data().items)||[]; renderAtg(); loadMina(); },()=>{}); }
    loadMina(); setTimeout(pushBanner,2500);
    document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") loadMina(); });
    if (board && DB){ sprotRef=DB.doc("styrelse/protokoll"); sprotRef.onSnapshot(sn=>{ sprot=(sn.exists&&sn.data().items)||[]; renderDok(); },()=>{}); }
    siteRef=DB.doc("site/main");
    siteRef.onSnapshot(snap=>{
      if (snap.metadata&&snap.metadata.hasPendingWrites) return;
      if (snap.exists && !siteDirty && !siteSaving && !busy()){ const d=JSON.parse(JSON.stringify(snap.data()||{})); delete d.medlemmar; const mm=site.medlemmar||[]; site={intro:"",nyheter:[],moten:[],styrelse:[],...d,medlemmar:mm}; siteJson=JSON.stringify((({medlemmar,...r})=>r)(site)); renderSite(); }
    },()=>{});
    DB.collection("felanmalan").onSnapshot(qs=>{ const o={}; qs.forEach(d=>o[d.id]=JSON.parse(JSON.stringify(d.data()))); fel=o; if(!busy()) renderFel(); },()=>{});
    if (board){ DB.collection("synpunkter").onSnapshot(qs=>{ const o={}; qs.forEach(d=>o[d.id]=JSON.parse(JSON.stringify(d.data()))); syn=o; if(!busy()) renderSyn(); },()=>{}); }
    else if (me){ DB.doc("synpunkter/"+me).onSnapshot(snap=>{ syn = snap.exists? {[me]:JSON.parse(JSON.stringify(snap.data()))} : {}; renderSyn(); },()=>{}); }
    if (!canWrite){ ["#caseForm"].forEach(s=>{ const f=q(s); f.querySelectorAll("input,textarea,button").forEach(x=>x.disabled=true); f.insertAdjacentHTML("beforeend",'<p class="hint">Du kan inte skicka just nu. Kontakta styrelsen.</p>'); }); }
  }catch(e){}
})();
/* ---------- Fällbara rutor: [data-fold] på en ruta gör dess första element (rubriken) till en knapp.
   data-fold-default="closed" = ihopfälld från början. Läget sparas per ruta i webbläsaren. ---------- */
const FOLD=(()=>{ try{ return JSON.parse(localStorage.getItem("vag_fold")||"{}"); }catch(e){ return {}; } })();
function foldSatt(p,open){ p.classList.toggle("open",open); const h=p.firstElementChild; if(h){ h.setAttribute("aria-expanded",String(open)); h.setAttribute("role","button"); h.tabIndex=0; } }
function foldInit(){ document.querySelectorAll("[data-fold]").forEach(p=>{ const k=p.dataset.fold, open=(k in FOLD)?FOLD[k]:p.dataset.foldDefault!=="closed"; p.classList.add("fold"); foldSatt(p,open); }); }
function foldVaxla(p){ const open=!p.classList.contains("open"); foldSatt(p,open); FOLD[p.dataset.fold]=open; try{ localStorage.setItem("vag_fold",JSON.stringify(FOLD)); }catch(e){} if(open&&p.id==="backupSet") renderLogg(); }
document.addEventListener("click",e=>{ const h=e.target.closest(".fold > :first-child"); if(!h||e.target.closest("button,a,input,select,textarea,label")) return; foldVaxla(h.parentElement); });
document.addEventListener("keydown",e=>{ if((e.key==="Enter"||e.key===" ")&&e.target.matches(".fold > :first-child")){ e.preventDefault(); foldVaxla(e.target.parentElement); } });
foldInit();
/* sb.js ritar om rutan för inloggningar; behåll rubrikens knapp-egenskaper */
(()=>{ const am=document.getElementById("accessMgr"); if(am&&window.MutationObserver) new MutationObserver(()=>foldSatt(am,am.classList.contains("open"))).observe(am,{childList:true}); })();
/* ---------- Admin: säkerhetskopia och ändringslogg ---------- */
document.addEventListener("click",async e=>{
  const b=e.target.closest("#backupBtn"); if(!b||!document.body.classList.contains("is-admin")) return;
  b.disabled=true; setMsg("Skapar säkerhetskopia…");
  try{
    const [d,m,r]=await Promise.all([window.SB.from("docs").select("path,data,uppdaterad"),window.SB.from("medlemmar").select("*"),window.SB.from("roller").select("*")]);
    if(d.error||m.error) throw new Error("läs");
    const kopia={skapad:new Date().toISOString(),version:(q(".ver")||{}).textContent||"",docs:d.data,medlemmar:m.data,roller:r.data||[]};
    const dl=await claude.use("downloads"); if(!dl) throw new Error("dl");
    await dl.save({filename:"sakerhetskopia-vagforeningen-"+today()+".json",data:new Blob([JSON.stringify(kopia,null,2)],{type:"application/json"})});
    setMsg("Säkerhetskopian är nedladdad.");
  }catch(err){ setMsg("Det gick inte att skapa säkerhetskopian."); }
  b.disabled=false;
});
const LOGG_TAB={docs:"Innehåll",medlemmar:"Medlemsregistret",roller:"Behörigheter"};
const LOGG_DOC={"site/main":"nyheter, möten, styrelse m.m.","vag/config":"andelstal","styrelse/atgarder":"åtgärdslistan","styrelse/protokoll":"styrelsens dokument"};
async function renderLogg(){
  const el=q("#loggList"); if(!el||!document.body.classList.contains("is-admin")||!window.SB) return;
  const {data,error}=await window.SB.from("andringslogg").select("tid,epost,tabell,nyckel,handelse,fore,efter").order("tid",{ascending:false}).limit(30);
  if(error){ el.innerHTML=`<p class="hint">Kunde inte läsa ändringsloggen.</p>`; return; }
  if(!data||!data.length){ el.innerHTML=`<p class="hint">Inga ändringar loggade ännu.</p>`; return; }
  const vad=x=>{ const o=x.efter||x.fore||{};
    if(x.tabell==="medlemmar") return [o.namn,o.fastighet].filter(Boolean).join(", ")||"en kontakt";
    if(x.tabell==="roller") return (o.email||x.nyckel)+(o.roll?" ("+o.roll+")":"");
    if(x.tabell==="docs") return LOGG_DOC[x.nyckel]||(x.nyckel.startsWith("felanmalan/")?"en felanmälan":x.nyckel.startsWith("synpunkter/")?"en synpunkt":x.nyckel);
    return x.nyckel; };
  const verb={insert:"lade till",update:"ändrade",delete:"tog bort"};
  el.innerHTML=data.map(x=>{ const t=new Date(x.tid);
    return `<div class="loggrow"><time>${E(t.toLocaleDateString("sv-SE",{day:"numeric",month:"short"}))} ${E(t.toLocaleTimeString("sv-SE",{hour:"2-digit",minute:"2-digit"}))}</time><span><strong>${E(x.epost||"Systemet")}</strong> ${verb[x.handelse]||x.handelse} ${E(vad(x))} <small>${E(LOGG_TAB[x.tabell]||x.tabell)}</small></span></div>`; }).join("");
}
document.addEventListener("click",e=>{ if(e.target.closest("#adminBtn")||e.target.closest('[data-goto="admin"]')) setTimeout(renderLogg,100); });
if(location.hash==="#admin") setTimeout(renderLogg,2500);
})();

