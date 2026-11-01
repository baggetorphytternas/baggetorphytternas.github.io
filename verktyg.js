const DOC_PATH = "vag/config";
/* Schabloner enligt Lantmäteriets PM 2025 "Tonkilometermetoden" (LM2025/006319) med bilaga 1. */
const PM = {
  perm:2500, komp:1300, frit:{intensiv:1800, normal:900, lag:450}, lgh:1500, smahusbr:2000, obebyggd:100,
  hastEgen:200, hastInack:1100, anstalld:780, mjolk:{enkel:6600, tor:13200},
  teknisk:{manad:500, varannan:600, vecka:800, tva:1100}, natur:500, bat:400, batTatort:500,
  jarnvag:{signal:800, ovrig:600}, skogRestr:2,
  skog:{1:15, 2:18, 3:24, 4:30, 5:36, 6:42},
  /* Tabell 7 interna jordbrukstransporter [ton/ha åker, ton/ha bete], tabell 8 företagsutfart liten areal (ton/ha åker),
     tabell 9 företagsutfart [fast belopp, ton/ha åker], gräns för liten areal (ha åker). */
  omr:{
    Gss:{namn:"Gss – Götalands södra slättbygder", t7:[195,60], t8:125, t9:[1500,80], grans:30},
    Gmb:{namn:"Gmb – Götalands mellanbygder", t7:[145,45], t8:100, t9:[1000,55], grans:20},
    Gns:{namn:"Gns – Götalands norra slättbygder", t7:[145,45], t8:100, t9:[1000,55], grans:20},
    Gsk:{namn:"Gsk – Götalands skogsbygder", t7:[145,45], t8:100, t9:[1000,35], grans:20},
    Ss:{namn:"Ss – Svealands slättbygder", t7:[145,45], t8:100, t9:[1000,35], grans:20},
    Ssk:{namn:"Ssk – Svealands skogsbygder", t7:[110,30], t8:75, t9:[1000,20], grans:20},
    Nn:{namn:"Nn – Nedre Norrland", t7:[110,30], t8:75, t9:[1000,20], grans:20},
    "Nö":{namn:"Nö – Övre Norrland", t7:[110,30], t8:75, t9:[1000,20], grans:20}
  }
};
const TILLV={1:"1 – Jämtland och inre Norrbotten/Västerbotten",2:"2 – Västernorrland och kustnära Norrland",3:"3 – Dalarna och västra Gävleborg",4:"4 – Värmland, Örebro, Västmanland, Södermanland, Stockholm, Uppsala",5:"5 – Västra Götaland, Jönköping, Kronoberg, Kalmar, Östergötland, Gotland",6:"6 – Halland, Skåne, Blekinge"};
const DEFAULT = {
  segments:[], props:[],
  schablon:{prodOmr:"Ss", tillvOmr:"4", minKm:0.3, utdebitering:""}
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
/* Fastighetens trafikposter: [{namn, ton, vag:"route"|"skog"|"inre"}]. Varje post räknas mot sin väglängd. */
function poster(p){
  const S=state.schablon, t=typOf(p), O=PM.omr[S.prodOmr]||PM.omr.Ss, n=k=>num(p[k]), ut=[];
  const add=(namn,ton,vag="route")=>{ if(ton>0) ut.push({namn,ton,vag}); };
  const bostad=()=>{ add(`Permanentbostad ${n("perm")>1?n("perm")+" × ":""}${fmt(PM.perm)} ton`, n("perm")*PM.perm);
    add(`Uthyrd komplementbostad ${n("komp")>1?n("komp")+" × ":""}${fmt(PM.komp)} ton`, n("komp")*PM.komp);
    const niva=p.fritNiva||"normal"; add(`Fritidsbostad (${{lag:"låg",normal:"normal",intensiv:"intensiv"}[niva]} användning) ${n("frit")>1?n("frit")+" × ":""}${fmt(PM.frit[niva]||0)} ton`, n("frit")*(PM.frit[niva]||0)); };
  const skog=()=>{ const ha=n("skogHa"); if(ha>=1) add(`Skog ${fmt(ha,ha%1?1:0)} ha × ${PM.skog[S.tillvOmr]||30} ton`, ha*(PM.skog[S.tillvOmr]||30),"skog");
    add(`Skog med restriktioner ${fmt(n("skogRestrHa"),1)} ha × ${PM.skogRestr} ton`, n("skogRestrHa")*PM.skogRestr,"skog"); };
  const hastar=()=>{ add(`Egna hästar ${n("hastEgna")} × ${PM.hastEgen} ton`, n("hastEgna")*PM.hastEgen); add(`Inackorderade hästar ${n("hastInack")} × ${fmt(PM.hastInack)} ton`, n("hastInack")*PM.hastInack); };
  const interna=()=>{ if(!p.interna) return; add(`Interna transporter åker ${fmt(n("akerHa"),1)} ha × ${O.t7[0]} ton`, n("akerHa")*O.t7[0],"inre"); add(`Interna transporter bete ${fmt(n("beteHa"),1)} ha × ${O.t7[1]} ton`, n("beteHa")*O.t7[1],"inre"); };
  switch(t){
    case "perm": case "frit": bostad(); break;
    case "flerfam": add(`${n("lgh")} lägenheter × ${fmt(PM.lgh)} ton`, n("lgh")*PM.lgh); break;
    case "smahusbr": add(`${n("smahus")} småhus i förening × ${fmt(PM.smahusbr)} ton`, n("smahus")*PM.smahusbr); break;
    case "kombi": bostad();
      add(`Åker ${fmt(n("akerHa"),1)} ha × ${O.t8} ton`, n("akerHa")*O.t8);
      add(`Bete ${fmt(n("beteHa"),1)} ha × ${O.t7[1]} ton`, n("beteHa")*O.t7[1]);
      skog(); hastar(); add(`Övrig verksamhet (egen beräkning)`, n("ovrigTon")); break;
    case "jord": { bostad(); const a=n("akerHa");
      if(a>0){ if(a>=O.grans) add(`Företagsutfart ${fmt(O.t9[0])} ton + ${fmt(a,1)} ha × ${O.t9[1]} ton`, O.t9[0]+a*O.t9[1]); else add(`Företagsutfart ${fmt(a,1)} ha åker × ${O.t8} ton`, a*O.t8); }
      interna(); if(p.mjolk&&PM.mjolk[p.mjolk]) add(`Mjölktransporter (${p.mjolk==="tor"?"tur och retur":"enkelresa"})`, PM.mjolk[p.mjolk]);
      add(`Anställda ${n("anstallda")} × ${PM.anstalld} ton`, n("anstallda")*PM.anstalld); hastar(); skog(); break; }
    case "skog": skog(); break;
    case "obebyggd": add(`Obebyggd fastighet`, PM.obebyggd); break;
    case "teknisk": add(`Teknisk anläggning`, PM.teknisk[p.tekFrek||"manad"]); break;
    case "smabat": add(`${n("batplatser")} båtplatser × ${p.batTatort?PM.batTatort:PM.bat} ton`, n("batplatser")*(p.batTatort?PM.batTatort:PM.bat)); break;
    case "natur": add(`Naturreservat, skyddad natur`, PM.natur); break;
    case "jarnvag": add(`Järnvägsfastighet, ${p.jarnvagTyp==="signal"?"signalanläggning":"övrig anläggning"}`, PM.jarnvag[p.jarnvagTyp==="signal"?"signal":"ovrig"]); break;
    case "egen": add(`Eget beräknat tontal`, n("egenTon")); break;
  }
  return ut;
}
function calc(){
  const S = state.schablon, minKm=num(S.minKm);
  const rows = state.props.map(p=>{
    const fixed = typOf(p)==="annan" && String(p.fast??"").trim()!=="" ? num(p.fast) : null;
    let d = segKm(p.route); const direkt = !!p.direkt && d===0;
    if (direkt) d = minKm; else if (d>0) d = Math.max(d, minKm);
    let dSkog = (p.skogRoute&&p.skogRoute.length) ? Math.max(segKm(p.skogRoute),minKm) : d;
    if (p.skogJamn) dSkog = jamnKm(p.skogRoute&&p.skogRoute.length ? p.skogRoute : p.route);
    const dInre = (p.inreRoute&&p.inreRoute.length) ? Math.max(segKm(p.inreRoute),minKm) : d;
    const ps = fixed!==null ? [] : poster(p);
    const km = v=>v==="skog"?dSkog:v==="inre"?dInre:d;
    const faktor = direkt ? num(p.direktFaktor||0.5) : 1;
    ps.forEach(x=>{ x.km=km(x.vag); x.tkm=x.ton*x.km*faktor; });
    const ton = ps.reduce((s,x)=>s+x.ton,0), tkm = ps.reduce((s,x)=>s+x.tkm,0);
    return {p, d, dSkog, dInre, ton, tkm, fixed, poster:ps, direkt, faktor};
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
  const t=typOf(p), lab=(TYPER.find(x=>x[0]===t)||[,"Ej angiven"])[1], c=[lab];
  if (t==="jord"||t==="kombi"){ const ha=num(p.akerHa)+num(p.beteHa)+num(p.skogHa); if(ha) c.push(fmt(ha)+" ha"); if(num(p.perm)) c.push(num(p.perm)>1?num(p.perm)+" bostäder":"med bostad"); }
  if (p.direkt) c.push("Direktutfart");
  return c.map(x=>`<span class="chip">${esc(x)}</span>`).join("");
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
  rows.forEach(r=>{ const el=document.getElementById("calc-"+r.p.id); if(el) el.textContent = calcText(r); const nv=document.getElementById("vkn-"+r.p.id); if(nv) nv.innerHTML=varningar(r.p); });
}
function varningar(p){
  const t=typOf(p), ha=num(p.akerHa)+num(p.beteHa)+num(p.skogHa)+num(p.skogRestrHa), v=[];
  if (t==="kombi"&&ha>=10) v.push(`Fastigheten har ${fmt(ha)} ha mark. Från 10 ha räknas den som jordbruks- eller skogsbruksfastighet.`);
  if (t==="jord"&&ha>0&&ha<10&&(num(p.perm)||num(p.frit))) v.push("Under 10 ha med bostad räknas fastigheten normalt som kombinerad bostadsfastighet.");
  if (t==="kombi"&&num(p.hastEgna)+num(p.hastInack)>10) v.push("Fler än 10 hästar räknas som jordbruksfastighet.");
  return v.map(x=>`<p class="notice">${esc(x)}</p>`).join("");
}
function calcText(r){
  if (r.fixed!==null) return `Fast andel ${fmt(r.fixed,1)} %. Övriga fält påverkar inte resultatet.`;
  if (!r.poster.length) return "Ingen trafik angiven ännu.";
  const rad=r.poster.map(x=>`${x.namn} = ${fmt(x.ton)} ton × ${fmt(x.km,2)} km`).join("\n");
  return rad + (r.direkt?`\nDirektutfart: minsta väglängd och reduktionsfaktor ${fmt(r.faktor,1)}.`:"") + `\nSumma ${fmt(r.ton)} ton per år, ${fmt(r.tkm)} tonkm, andel ${fmt(r.disp,1)} %.`;
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
const TYPER=[
  ["perm","Permanentbostad (villa, radhus, kedjehus)","Bostad"],["frit","Fritidsbostad","Bostad"],
  ["flerfam","Flerfamiljshus","Bostad"],["smahusbr","Småhus i bostadsrätt eller kooperativ hyresrätt","Bostad"],
  ["kombi","Kombinerad bostadsfastighet (bostad med mark under 10 ha)","Jord och skog"],
  ["jord","Jordbruksfastighet (10 ha eller mer)","Jord och skog"],["skog","Skogsbruksfastighet utan bostad","Jord och skog"],
  ["obebyggd","Obebyggd fastighet","Övrigt"],["teknisk","Teknisk anläggning (mast, kraftverk, pumpstation …)","Övrigt"],
  ["smabat","Småbåtshamn","Övrigt"],["natur","Naturreservat, skyddad natur","Övrigt"],["jarnvag","Järnvägsfastighet","Övrigt"],
  ["egen","Eget beräknat tontal (skola, golfbana, camping …)","Övrigt"],["annan","Fast andel i procent","Övrigt"]];
const TYPKODER=TYPER.map(x=>x[0]);
function typOf(p){
  if (TYPKODER.includes(p.typ)) return p.typ;
  if (String(p.fast??"").trim()!=="") return "annan";
  if (p.typ&&String(p.typ).startsWith("jord")) return (num(p.akerHa)>0||num(p.perm)||num(p.frit)) ? "jord" : "skog";
  if (num(p.akerHa)>0||num(p.skogHa)>0) return (num(p.akerHa)===0&&!num(p.perm)&&!num(p.frit)) ? "skog" : "jord";
  return num(p.frit)>0&&!num(p.perm) ? "frit" : "perm";
}
function setTyp(p,t){
  p.typ=t;
  const bostad = t==="perm"||t==="kombi"||t==="jord";
  if (t==="perm"||t==="kombi"){ if(!num(p.perm)) p.perm=1; p.frit=0; }
  else if (t==="frit"){ if(!num(p.frit)) p.frit=1; p.perm=0; p.komp=0; }
  else if (t!=="jord"){ p.perm=0; p.frit=0; p.komp=0; }
  if (!["kombi","jord"].includes(t)){ p.akerHa=0; p.beteHa=0; p.hastEgna=0; p.hastInack=0; p.interna=false; p.inreRoute=[]; }
  if (!["kombi","jord","skog"].includes(t)){ p.skogHa=0; p.skogRestrHa=0; p.skogRoute=[]; p.skogJamn=false; }
  if (t!=="jord"){ p.mjolk=""; p.anstallda=0; }
  if (t!=="annan") p.fast="";
  if (t==="flerfam"&&!num(p.lgh)) p.lgh=2;
  if (t==="smahusbr"&&!num(p.smahus)) p.smahus=1;
  if (t==="smabat"&&!num(p.batplatser)) p.batplatser=10;
  if (t==="teknisk"&&!p.tekFrek) p.tekFrek="manad";
  if (t==="jarnvag"&&!p.jarnvagTyp) p.jarnvagTyp="ovrig";
  void bostad;
}
let editProp=null;
document.addEventListener("click", e=>{
  const u=e.target.closest("[data-unlock]"); if(u){ editProp=u.dataset.unlock; renderCards(); const f=document.getElementById("namn-"+editProp); if(f) f.focus(); return; }
  if (e.target.closest("[data-lock]")){ editProp=null; renderCards(); renderSummary(); }
});
const fld=(p,f,label,mode="decimal",extra="")=>`<label for="${f}-${p.id}">${label}<input id="${f}-${p.id}" inputmode="${mode}" data-p="${p.id}" data-f="${f}" value="${esc(String(p[f]??"").replace(".",","))}"${extra}></label>`;
const sel=(p,f,label,opts,def)=>`<label for="${f}-${p.id}">${label}<select id="${f}-${p.id}" data-p="${p.id}" data-f="${f}">${opts.map(([v,l])=>`<option value="${v}" ${(p[f]||def)===v?"selected":""}>${esc(l)}</option>`).join("")}</select></label>`;
const chk=(p,f,label)=>`<label class="check" for="${f}-${p.id}"><input type="checkbox" id="${f}-${p.id}" data-p="${p.id}" data-f="${f}" ${p[f]?"checked":""}>${label}</label>`;
function typHjalp(t){
  return ({
    perm:"2 500 ton per hushåll. Radhus och kedjehus räknas som villa. En komplementbostad ingår normalt, men en varaktigt uthyrd räknas med 1 300 ton.",
    frit:"Intensiv 1 800 ton (används veckoslut året runt), normal 900 ton (sommar och veckoslut april–september), låg 450 ton (4–5 veckor per år). Normalt samma nivå för hela området.",
    flerfam:"1 500 ton per lägenhet oavsett upplåtelseform.",
    smahusbr:"2 000 ton per hus. Används bara om något, till exempel närhet till kollektivtrafik, motiverar lägre trafik än en vanlig villa.",
    kombi:"Bostad med mark under 10 ha. Bostaden räknas som permanentbostad och därutöver marken och verksamheten: åker, bete, skog, hästar och annan verksamhet som gårdsförsäljning eller bed & breakfast.",
    jord:"Bostäderna på gården räknas för sig. Företagsutfarten räknas på åkerarealen: under gränsen per hektar, över gränsen ett fast belopp plus per hektar. Interna transporter räknas bara om åker eller bete nås via föreningens väg.",
    skog:"Skog under 1 ha räknas inte. Mark där inget skogsbruk får bedrivas räknas med 2 ton per ha.",
    obebyggd:"100 ton per fastighet. Har bygglov vunnit laga kraft räknas den som bebyggd.",
    teknisk:"Schablon efter hur ofta anläggningen besöks. Den inkluderar planerat underhåll.",
    smabat:"400 ton per båtplats, 500 ton nära större tätort.",
    natur:"500 ton för naturreservat som skyddar natur. Reservat för friluftsliv och nationalparker beräknas i det enskilda fallet.",
    jarnvag:"Signalanläggning 800 ton, övriga anläggningar 600 ton.",
    egen:"För fastigheter som Lantmäteriet säger ska beräknas i det enskilda fallet, till exempel skola, golfbana, camping eller större hästgård. Ange det beräknade tontalet per år.",
    annan:"En fast andel i procent som läggs först. Övriga fastigheter delar på resten."
  })[t]||"";
}
function renderCards(){
  renderPick();
  const S=state.schablon, O=PM.omr[S.prodOmr]||PM.omr.Ss;
  $("#cards").innerHTML = state.props.filter(p=>p.id===selected).map(p=>{
    const t=typOf(p), ed=editProp===p.id;
    const harSkog=["kombi","jord","skog"].includes(t), harMark=t==="kombi"||t==="jord";
    const ha=num(p.akerHa)+num(p.beteHa)+num(p.skogHa)+num(p.skogRestrHa);
    const grupper=[...new Set(TYPER.map(x=>x[2]))];
    let f="";
    if (t==="perm"||t==="kombi") f+=`<fieldset class="fs"><legend>Bostad</legend><div class="grid2">${fld(p,"perm","Antal hushåll (permanentbostäder)","numeric")}${fld(p,"komp","Varaktigt uthyrda komplementbostäder","numeric")}</div></fieldset>`;
    if (t==="frit") f+=`<fieldset class="fs"><legend>Fritidsbostad</legend><div class="grid2">${fld(p,"frit","Antal fritidsbostäder","numeric")}${sel(p,"fritNiva","Användning",[["intensiv","Intensiv – veckoslut året runt (1 800 ton)"],["normal","Normal – sommar och veckoslut apr–sep (900 ton)"],["lag","Låg – 4–5 veckor per år (450 ton)"]],"normal")}</div></fieldset>`;
    if (t==="jord") f+=`<fieldset class="fs"><legend>Bostäder på gården</legend><div class="grid2">${fld(p,"perm","Permanentbostäder","numeric")}${fld(p,"komp","Uthyrda komplementbostäder","numeric")}${fld(p,"frit","Fritidsbostäder","numeric")}${(num(p.frit)?sel(p,"fritNiva","Fritidsbostadens användning",[["intensiv","Intensiv (1 800 ton)"],["normal","Normal (900 ton)"],["lag","Låg (450 ton)"]],"normal"):"")}</div></fieldset>`;
    if (t==="flerfam") f+=`<fieldset class="fs"><legend>Flerfamiljshus</legend>${fld(p,"lgh","Antal lägenheter","numeric")}</fieldset>`;
    if (t==="smahusbr") f+=`<fieldset class="fs"><legend>Småhus i förening</legend>${fld(p,"smahus","Antal hus","numeric")}</fieldset>`;
    if (harMark) f+=`<fieldset class="fs"><legend>Mark och verksamhet</legend><div class="grid2">${fld(p,"akerHa","Åker, ha")}${fld(p,"beteHa","Bete, ha")}${fld(p,"hastEgna","Egna hästar (200 ton)","numeric")}${fld(p,"hastInack","Inackorderade hästar (1 100 ton)","numeric")}
      ${t==="jord"?sel(p,"mjolk","Mjölktransporter",[["","Inga"],["enkel","Enkelresa (6 600 ton)"],["tor","Tur och retur (13 200 ton)"]],"")+fld(p,"anstallda","Heltidsanställda (780 ton)","decimal"):fld(p,"ovrigTon","Övrig verksamhet, ton per år (gårdsförsäljning, B&B …)")}</div>
      ${t==="jord"?chk(p,"interna","Åker eller bete nås via föreningens väg (interna jordbrukstransporter)"):""}
      ${t==="jord"?`<p class="hint">Åker under ${O.grans} ha: ${O.t8} ton per ha. Från ${O.grans} ha: ${fmt(O.t9[0])} ton + ${O.t9[1]} ton per ha. Interna: ${O.t7[0]} ton per ha åker och ${O.t7[1]} ton per ha bete. (${esc(O.namn)})</p>`:`<p class="hint">Åker ${O.t8} ton per ha, bete ${O.t7[1]} ton per ha. (${esc(O.namn)})</p>`}
      <div id="vkn-${p.id}"></div></fieldset>`;
    if (harSkog) f+=`<fieldset class="fs"><legend>Skog</legend><div class="grid2">${fld(p,"skogHa",`Produktiv skogsmark, ha (${PM.skog[S.tillvOmr]||30} ton per ha)`)}${fld(p,"skogRestrHa","Skog där skogsbruk inte får bedrivas, ha (2 ton per ha)")}</div><p class="hint">Under 1 ha skog räknas inte. Impediment räknas inte.</p></fieldset>`;
    if (t==="teknisk") f+=`<fieldset class="fs"><legend>Teknisk anläggning</legend>${sel(p,"tekFrek","Hur ofta besöks den",[["manad","En gång per månad (500 ton)"],["varannan","Varannan vecka (600 ton)"],["vecka","En gång per vecka (800 ton)"],["tva","Två gånger per vecka (1 100 ton)"]],"manad")}</fieldset>`;
    if (t==="smabat") f+=`<fieldset class="fs"><legend>Småbåtshamn</legend>${fld(p,"batplatser","Antal båtplatser","numeric")}${chk(p,"batTatort","Nära större tätort (500 ton per båtplats)")}</fieldset>`;
    if (t==="jarnvag") f+=`<fieldset class="fs"><legend>Järnvägsfastighet</legend>${sel(p,"jarnvagTyp","Anläggning",[["signal","Signalanläggning (800 ton)"],["ovrig","Övriga anläggningar (600 ton)"]],"ovrig")}</fieldset>`;
    if (t==="egen") f+=`<fieldset class="fs"><legend>Eget tontal</legend>${fld(p,"egenTon","Trafik, ton per år")}</fieldset>`;
    if (t==="annan") f+=`<fieldset class="fs"><legend>Fast andel</legend>${fld(p,"fast","Andel i procent")}</fieldset>`;
    const vag = t==="annan" ? "" : `<fieldset class="fs"><legend>Vägen</legend>
      <label>${harMark?"Bostad och företagsutfart kör":"Kör"} på delsträckor ut till Stav</label><div class="segs">${segBoxes(p,"route")}</div>
      ${harSkog?`<label>Skogen kör på delsträckor (tomt = samma som ovan)</label><div class="segs">${segBoxes(p,"skogRoute")}</div>
      ${chk(p,"skogJamn","Skogen ligger jämnt utmed sträckan")}`:""}
      ${t==="jord"&&p.interna?`<label>Interna transporter kör på delsträckor (tomt = samma som ovan)</label><div class="segs">${segBoxes(p,"inreRoute")}</div>`:""}
      ${chk(p,"direkt","Direktutfart till allmän väg (minsta väglängd och reduktionsfaktor)")}
      ${p.direkt?sel(p,"direktFaktor","Reduktionsfaktor",[["0.5","0,5 – gemensamma nyttigheter i normal omfattning"],["0.3","0,3 – gemensamma nyttigheter i mindre omfattning"]],"0.5"):""}
    </fieldset>`;
    return `<div class="panel card${ed?" editing":""}" data-card="${p.id}">
    <div class="card-head">
      ${ed?`<input id="namn-${p.id}" aria-label="Fastighetens namn" data-p="${p.id}" data-f="namn" value="${esc(p.namn)}">`:`<h3 class="pname">${esc(p.namn)}</h3>`}
      ${ed?`<button type="button" data-lock="1">Klar</button>`:`<button type="button" class="ghost" data-unlock="${p.id}">Redigera</button>`}
    </div>
    ${ed?"":`<p class="hint">Tryck på Redigera för att ändra uppgifterna.</p>`}
    <fieldset class="lockwrap" ${ed?"":"disabled"}>
    <label for="typ-${p.id}">Typ av fastighet<select id="typ-${p.id}" data-typ="${p.id}">${grupper.map(g=>`<optgroup label="${g}">${TYPER.filter(x=>x[2]===g).map(([v,l])=>`<option value="${v}" ${v===t?"selected":""}>${esc(l)}</option>`).join("")}</optgroup>`).join("")}</select></label>
    <p class="hint">${esc(typHjalp(t))}</p>
    ${f}${vag}
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
  const S=state.schablon, O=PM.omr[S.prodOmr]||PM.omr.Ss, sk=PM.skog[S.tillvOmr]||30;
  const rad=(a,b)=>`<tr><td>${esc(a)}</td><td class="num">${esc(b)}</td></tr>`;
  $("#schablon").innerHTML = `
    <label for="s-prodOmr">Produktionsområde för jordbruk<select id="s-prodOmr" data-s="prodOmr">${Object.entries(PM.omr).map(([k,v])=>`<option value="${k}" ${S.prodOmr===k?"selected":""}>${esc(v.namn)}</option>`).join("")}</select></label>
    <label for="s-tillvOmr">Tillväxtområde för skog<select id="s-tillvOmr" data-s="tillvOmr">${Object.entries(TILLV).map(([k,v])=>`<option value="${k}" ${String(S.tillvOmr)===k?"selected":""}>${esc(v)} (${PM.skog[k]} ton/ha)</option>`).join("")}</select></label>
    <label for="s-minKm">Minsta väglängd, km<input id="s-minKm" inputmode="decimal" data-s="minKm" value="${esc(String(S.minKm).replace(".",","))}"></label>
    <div class="schref"><table class="tbl"><thead><tr><th>Schablon enligt Lantmäteriets PM 2025</th><th class="num">Ton per år</th></tr></thead><tbody>
      ${rad("Permanentbostad, per hushåll",fmt(PM.perm))}${rad("Uthyrd komplementbostad",fmt(PM.komp))}
      ${rad("Fritidsbostad intensiv / normal / låg",`${fmt(PM.frit.intensiv)} / ${PM.frit.normal} / ${PM.frit.lag}`)}
      ${rad("Flerfamiljshus, per lägenhet",fmt(PM.lgh))}${rad("Småhus i bostadsrätt eller kooperativ hyresrätt",fmt(PM.smahusbr))}
      ${rad("Obebyggd fastighet",PM.obebyggd)}${rad(`Skog, per ha (tillväxtområde ${S.tillvOmr})`,sk)}${rad("Skog med restriktioner, per ha",PM.skogRestr)}
      ${rad(`Företagsutfart under ${O.grans} ha åker, per ha`,O.t8)}${rad(`Företagsutfart från ${O.grans} ha åker`,`${fmt(O.t9[0])} + ${O.t9[1]}/ha`)}
      ${rad("Interna transporter, per ha åker / bete",`${O.t7[0]} / ${O.t7[1]}`)}
      ${rad("Mjölk enkelresa / tur och retur",`${fmt(PM.mjolk.enkel)} / ${fmt(PM.mjolk.tor)}`)}${rad("Heltidsanställd",PM.anstalld)}
      ${rad("Häst, egen / inackorderad",`${PM.hastEgen} / ${fmt(PM.hastInack)}`)}
      ${rad("Teknisk anläggning, besök 1/mån, 1/14 dagar, 1/vecka, 2/vecka","500 / 600 / 800 / 1 100")}
      ${rad("Småbåtshamn per båtplats (nära tätort)","400 (500)")}${rad("Naturreservat, skyddad natur",PM.natur)}${rad("Järnväg signal / övrig","800 / 600")}
    </tbody></table>
    <p class="hint">Källa: Lantmäteriet, PM 2025 om tonkilometermetoden (LM2025/006319) med bilaga 1. Direktutfart: minsta väglängd och reduktionsfaktor 0,5 eller 0,3 (avsnitt 3.1.4).</p></div>`;
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
    if (t.dataset.sf==="id"){ state.props.forEach(p=>["route","skogRoute","inreRoute"].forEach(k=>{ if(p[k]) p[k]=p[k].map(x=>x===old?t.value:x); })); }
  } else if (t.dataset.s){
    state.schablon[t.dataset.s]=t.value;
  } else return;
  renderSummary(); scheduleSave();
});
/* Fält som ändrar formuläret ritar om kortet efteråt, och fokus behålls i det fält man gått vidare till. */
document.addEventListener("change", e=>{ const f=e.target.dataset.f; if(["interna","direkt","frit"].includes(f)){ setTimeout(()=>{ const a=document.activeElement, id=a&&a.id, pos=a&&a.selectionStart; renderCards(); renderSummary(); const n=id&&document.getElementById(id); if(n){ n.focus(); try{ if(pos!=null) n.setSelectionRange(pos,pos); }catch(x){} } },0); } if(e.target.dataset.s==="prodOmr"||e.target.dataset.s==="tillvOmr"){ renderSchablon(); renderCards(); renderSummary(); } });
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
    state.props.forEach(p=>["route","skogRoute","inreRoute"].forEach(k=>{ if(p[k]) p[k]=p[k].filter(x=>x!==g.id); }));
    renderAll(); scheduleSave();
  } else if (t.id==="addProp"){
    const p={id:uid(),namn:"Ny fastighet",typ:"perm",perm:1,frit:0,fritNiva:"normal",akerHa:0,beteHa:0,skogHa:0,route:[],skogRoute:[],inreRoute:[],skogJamn:false,fast:"",note:""};
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
  const t=typOf(p), lab=(TYPER.find(x=>x[0]===t)||[,"Ej angiven"])[1].replace(/ \(.*\)$/,"");
  const ha=num(p.akerHa)+num(p.beteHa)+num(p.skogHa)+num(p.skogRestrHa);
  let s=lab;
  if ((t==="jord"||t==="kombi")&&num(p.perm)) s+=num(p.perm)>1?` med ${num(p.perm)} bostäder`:" med bostad";
  if (t==="jord"&&!num(p.perm)&&num(p.frit)) s+=" med fritidsbostad";
  if (t==="frit") s+=` (${{lag:"låg",normal:"normal",intensiv:"intensiv"}[p.fritNiva||"normal"]} användning)`;
  if (ha>0) s+=`, ${fmt(ha)} ha`;
  if (p.direkt) s+=", direktutfart";
  return s;
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
    { const anv=new Map(); rows.forEach(r=>r.poster.forEach(x=>{ const k=x.namn.replace(/^(.*?)( \d| ×| \(|$).*/,"$1").trim(); if(!anv.has(k)) anv.set(k,x); }));
      const O=PM.omr[S.prodOmr]||PM.omr.Ss, b=[];
      const finns=t=>rows.some(r=>typOf(r.p)===t);
      if (rows.some(r=>num(r.p.perm))) b.push(["Permanentbostad",fmt(PM.perm)+" ton per hushåll"]);
      if (rows.some(r=>num(r.p.frit))) b.push(["Fritidsbostad","1 800 / 900 / 450 ton (intensiv, normal, låg användning)"]);
      if (rows.some(r=>num(r.p.skogHa)>=1)) b.push(["Skogsbruk",(PM.skog[S.tillvOmr]||30)+" ton per hektar produktiv skog"]);
      if (rows.some(r=>num(r.p.akerHa)>0&&typOf(r.p)==="jord")) b.push(["Jordbruk, företagsutfart",O.t8+" ton per hektar åker under "+O.grans+" ha, annars "+fmt(O.t9[0])+" ton plus "+O.t9[1]+" ton per hektar"]);
      ["flerfam","smahusbr","obebyggd","teknisk","smabat","natur","jarnvag","kombi"].forEach(t=>{ if(finns(t)) b.push([(TYPER.find(x=>x[0]===t)||[,""])[1].replace(/ \(.*\)$/,""),typHjalp(t)]); });
      table(["Fastighetstyp","Trafik per år enligt Lantmäteriets schablon (PM 2025)"],b,{columnStyles:{0:{cellWidth:48}}}); }
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
