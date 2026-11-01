const DOC_PATH = "vag/config";
/* Schabloner enligt Lantmäteriets PM 2025 "Tonkilometermetoden" (LM2025/006319) med bilaga 1. */
const PM = {
  perm:2500, komp:1300, frit:{intensiv:1800, normal:900, lag:450}, lgh:1500, smahusbr:2000, obebyggd:100,
  hastEgen:200, hastInack:1100, anstalld:780, mjolk:{enkel:6600, tor:13200}, mjolkBil:{utan:22, slap:50},
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
const OMR_TEXT={
  Gss:"Slättbygderna i södra och västra Skåne. Högst skördar i landet.",
  Gmb:"Mellanbygderna i Götaland, mellan slättbygderna och skogsbygderna, bland annat delar av Skåne, Blekinge, Kalmar, Östergötland och Västergötland.",
  Gns:"Slättbygderna i Östergötland och Västergötland. Stora och högproduktiva gårdar kan få det högre fasta beloppet som i Gss.",
  Gsk:"Skogsbygderna i Götaland, till exempel Smålands höglandet och delar av Halland och Västergötland.",
  Ss:"Slättbygderna runt Mälaren och Hjälmaren, i delar av Uppsala, Stockholms, Västmanlands, Södermanlands och Örebro län.",
  Ssk:"Skogsbygderna i Svealand, till exempel Värmland, Dalarna och skogsdelarna av Mälardalslänen.",
  Nn:"Nedre Norrland, ungefär Gävleborgs, Västernorrlands och Jämtlands län.",
  "Nö":"Övre Norrland, ungefär Västerbottens och Norrbottens län."
};
const TILLV={1:"1 – Jämtland och inre Norrbotten/Västerbotten",2:"2 – Västernorrland och kustnära Norrland",3:"3 – Dalarna och västra Gävleborg",4:"4 – Värmland, Örebro, Västmanland, Södermanland, Stockholm, Uppsala",5:"5 – Västra Götaland, Jönköping, Kronoberg, Kalmar, Östergötland, Gotland",6:"6 – Halland, Skåne, Blekinge"};
const DEFAULT = {
  segments:[], props:[],
  schablon:{prodOmr:"Ss", tillvOmr:"4", fritNiva:"normal", minKm:0.3, minAndel:"", utdebitering:""}
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
   Each segment's "mot" names the next segment toward the exit; without it, half the length is used. */
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
const ceilE = x => Math.ceil(x-1e-9);
const dec = x => (Math.round(x*100)%100) ? (Math.round(x*100)%10 ? 2 : 1) : 0;
const fx = x => fmt(num(x), dec(num(x)));
const omrOf = () => PM.omr[state.schablon.prodOmr]||PM.omr.Ss;
const skogTal = () => PM.skog[state.schablon.tillvOmr]||30;
const fjallTal = () => Number(state.schablon.tillvOmr)===3 ? 4 : 3;
const harFjall = () => Number(state.schablon.tillvOmr)<=3;
const utfartOf = () => String(state.schablon.utfart||"").trim() || "allmän väg";
const foreningOf = () => String(state.schablon.forening||"").trim();
const fritNivaOf = p => p.fritNiva || state.schablon.fritNiva || "normal";
const NIV = {lag:"låg",normal:"normal",intensiv:"intensiv"};
const skiften = p => Array.isArray(p.skiften) ? p.skiften : [];
const rader = p => Array.isArray(p.rader) ? p.rader : [];
const akerTot = p => typOf(p)==="jord" ? skiften(p).reduce((s,x)=>s+num(x.aker),0) : num(p.akerHa);
const beteTot = p => typOf(p)==="jord" ? skiften(p).reduce((s,x)=>s+num(x.bete),0) : num(p.beteHa);
const markHa = p => num(p.arealHa) || (akerTot(p)+beteTot(p)+num(p.skogHa)+num(p.skogFjallHa)+num(p.skogRestrHa));
const radTon = r => num(r.antal)*num(r.dagar)*num(r.vikt)*num(r.farder===undefined||r.farder===""?1:r.farder)*(r.tor===false?1:2);
function godsTon(p){
  if (p.gods==="p25") return 0.25*rader(p).filter(r=>r.gods!==false).reduce((s,r)=>s+radTon(r),0);
  if (p.gods==="t200") return 200;
  return 0;
}
/* Hästar enligt PM 3.5.7.1: jämkning mellan antal hästar och boxar (medelvärde, avrundat uppåt),
   egna hästar i samma proportion som i dag (avrundat uppåt), resten inackorderade. */
function hastTal(p){
  const e=num(p.hastEgna), i=num(p.hastInack), h=e+i, b=num(p.boxar), m=p.hastJamk||"faktiska";
  if (h>0 && b>0 && b!==h && (m==="jamka"||m==="boxar")){
    const tot = m==="jamka" ? ceilE((h+b)/2) : b;
    const eg = Math.min(tot, ceilE(e/h*tot));
    return {egna:eg, inack:tot-eg, text: m==="jamka" ? `jämkat mellan ${h} hästar och ${b} boxar till ${tot}` : `räknat på ${b} boxar`};
  }
  return {egna:e, inack:i, text:""};
}
/* Fastighetens trafikposter: [{namn, ton, vag, ref}]. vag = "route" (bostad och företagsutfart),
   "skog" (skogens väg) eller "s:<skifte>" (interna transporter till ett skifte). ref = avsnitt i PM 2025. */
function poster(p){
  const S=state.schablon, t=typOf(p), O=omrOf(), n=k=>num(p[k]), ut=[];
  const add=(namn,ton,vag="route",ref="")=>{ if(ton>0) ut.push({namn,ton,vag,ref}); };
  const ggr=(k,v)=>`${n(k)>1?n(k)+" × ":""}${fmt(v)} ton`;
  const bostad=()=>{
    add(`Permanentbostad ${ggr("perm",PM.perm)}`, n("perm")*PM.perm,"route","3.2.1");
    add(`Varaktigt uthyrd komplementbostad ${ggr("komp",PM.komp)}`, n("komp")*PM.komp,"route","3.2.2.2");
    const nv=fritNivaOf(p); add(`Fritidsbostad, ${NIV[nv]} användning ${ggr("frit",PM.frit[nv]||0)}`, n("frit")*(PM.frit[nv]||0),"route","3.3.1");
  };
  const skog=()=>{
    const prod=n("skogHa"), fj=harFjall()?n("skogFjallHa"):0, r=n("skogRestrHa");
    if (prod+fj>=1){
      add(`Produktiv skogsmark ${fx(prod)} ha × ${skogTal()} ton`, prod*skogTal(),"skog","3.8.1 tabell 10");
      add(`Fjällnära skog ${fx(fj)} ha × ${fjallTal()} ton`, fj*fjallTal(),"skog","3.8.2");
    }
    if (r>0){
      if (t==="skog" && prod+fj===0 && p.skogJakt){ const g=Math.max(1,ceilE(r/100)); add(`Jaktresor, ${fx(r)} ha där skogsbruk inte får bedrivas: 60 ton × ${g}`, 60*g,"skog","3.8.2.3"); }
      else add(`Skogsmark där skogsbruk inte får bedrivas ${fx(r)} ha × ${PM.skogRestr} ton`, r*PM.skogRestr,"skog","3.8.2.2");
    }
  };
  const hastar=()=>{ const h=hastTal(p), x=h.text?` (${h.text})`:"";
    add(`Egna hästar ${h.egna} × ${PM.hastEgen} ton${x}`, h.egna*PM.hastEgen,"route","3.5.5 tabell 5");
    add(`Inackorderade hästar ${h.inack} × ${fmt(PM.hastInack)} ton${x}`, h.inack*PM.hastInack,"route","3.5.5 tabell 5"); };
  const egnaRader=()=>{
    rader(p).forEach(r=>add(`${r.namn||"Post"}: ${fx(r.antal)} × ${fx(r.dagar)} dagar × ${fx(r.vikt)} ton × ${(v=>fx(v)+(num(v)===1?" färd":" färder"))(r.farder===undefined||r.farder===""?1:r.farder)}${r.tor===false?"":" × 2 tur och retur"}`, radTon(r),"route","6.4"));
    add(p.gods==="t200"?"Godstillägg, schablon 200 ton":"Godstillägg 25 % av posterna ovan", godsTon(p),"route",p.gods==="t200"?"6.4":"6.3.3");
    add("Annat beräknat tontal", n(t==="egen"?"egenTon":"ovrigTon"),"route","3.1.2");
  };
  const mjolk=()=>{ const m=p.mjolk;
    if (m==="enkel"||m==="tor") add(`Mjölktransporter, schablon ${m==="tor"?"tur och retur":"enkelresa"}`, PM.mjolk[m],"route","3.7.1.4");
    else if (m==="indiv"){ const h=p.mjolkHamt===undefined||p.mjolkHamt===""?183:num(p.mjolkHamt), v=p.mjolkSlap?PM.mjolkBil.slap:PM.mjolkBil.utan, r=p.mjolkTor?2:1, a=p.mjolkAndel===undefined||p.mjolkAndel===""?100:num(p.mjolkAndel);
      add(`Mjölktransporter ${fmt(h)} hämtningar × ${v} ton${r===2?" × 2 tur och retur":""}${a!==100?` × ${fx(a)} %`:""}`, h*v*r*a/100,"route","3.7.1.4"); } };
  switch(t){
    case "perm": case "frit": bostad(); break;
    case "flerfam": add(`${n("lgh")} lägenheter × ${fmt(PM.lgh)} ton`, n("lgh")*PM.lgh,"route","3.4.1"); break;
    case "smahusbr": add(`${n("smahus")} småhus i förening × ${fmt(PM.smahusbr)} ton`, n("smahus")*PM.smahusbr,"route","3.4.2"); break;
    case "kombi": { bostad();
      if (markHa(p)>2 || p.markNaring){
        add(`Åker ${fx(n("akerHa"))} ha × ${O.t7[0]} ton`, n("akerHa")*O.t7[0],"route","3.5.5 och tabell 7");
        add(`Bete ${fx(n("beteHa"))} ha × ${O.t7[1]} ton`, n("beteHa")*O.t7[1],"route","3.5.5 och tabell 7");
        if (p.skogSalu) skog();
      }
      hastar(); egnaRader(); break; }
    case "jord": { bostad(); const sk=skiften(p);
      const fu=sk.filter(s=>s.fu!==false).reduce((s,x)=>s+num(x.aker),0);
      if (fu>0){
        const fast=(state.schablon.prodOmr==="Gns"&&p.gnsHog)?PM.omr.Gss.t9[0]:O.t9[0];
        if (fu>=O.grans) add(`Företagsutfart ${fmt(fast)} ton + ${fx(fu)} ha åker × ${O.t9[1]} ton`, fast+fu*O.t9[1],"route","3.7.1.3 tabell 9");
        else add(`Företagsutfart ${fx(fu)} ha åker × ${O.t8} ton`, fu*O.t8,"route","3.7.1.3 tabell 8");
      }
      sk.forEach(s=>{ if (s.plats==="bc") return;
        const a=num(s.aker), b=num(s.bete), d=[a?`${fx(a)} ha åker × ${O.t7[0]} ton`:"", b?`${fx(b)} ha bete × ${O.t7[1]} ton`:""].filter(Boolean).join(" + ");
        add(`Interna transporter, ${s.namn||"skifte"}: ${d}`, a*O.t7[0]+b*O.t7[1], "s:"+s.id, "3.7.1.2 tabell 7"); });
      mjolk();
      add(`Heltidsanställda ${fx(n("anstallda"))} × ${PM.anstalld} ton`, n("anstallda")*PM.anstalld,"route","3.7.1.7");
      hastar(); skog(); egnaRader(); break; }
    case "skog": skog(); break;
    case "obebyggd": add(`Obebyggd fastighet`, PM.obebyggd,"route","3.6.1"); break;
    case "teknisk": { const s=PM.teknisk[p.tekFrek||"manad"], k=Math.max(1,Math.round(n("antalAnl"))||1);
      if (p.kluster && k>1){ const g=ceilE(k/5); add(`${k} anläggningar i kluster: ${fmt(s)} ton × ${g} påbörjade femgrupper + ${fmt(s)} ton × 0,75 × ${k-g}`, s*g+s*0.75*(k-g),"route","3.10.2.2"); }
      else add(`Teknisk anläggning ${k>1?k+" × ":""}${fmt(s)} ton`, s*k,"route","3.10.1 tabell 14");
      break; }
    case "smabat": { const v=p.batTatort?PM.batTatort:PM.bat; add(`${n("batplatser")} båtplatser × ${v} ton`, n("batplatser")*v,"route","3.9.7"); break; }
    case "natur": add(`Naturreservat, skyddad natur`, PM.natur,"route","3.10.4 tabell 15"); break;
    case "jarnvag": add(`Järnvägsfastighet, ${p.jarnvagTyp==="signal"?"signalanläggning":"övriga anläggningar"}`, PM.jarnvag[p.jarnvagTyp==="signal"?"signal":"ovrig"],"route","3.9.1 tabell 11"); break;
    case "egen": egnaRader(); break;
  }
  return ut;
}
function calc(){
  const S=state.schablon, minKm=num(S.minKm), minA=num(S.minAndel);
  const rows = state.props.map(p=>{
    const t=typOf(p), fixed = t==="annan" && String(p.fast??"").trim()!=="" ? num(p.fast) : null;
    const dR=segKm(p.route), egenSkog=p.skogRoute&&p.skogRoute.length;
    const dS = p.skogJamn ? jamnKm(egenSkog ? p.skogRoute : p.route) : (egenSkog ? segKm(p.skogRoute) : dR);
    const faktor=num(p.direktFaktor||0.5);
    const ps = fixed!==null ? [] : poster(p);
    let direkt=false, min=false;
    ps.forEach(x=>{
      const sk = x.vag.startsWith("s:");
      const raw = x.vag==="skog" ? dS : sk ? segKm((skiften(p).find(s=>"s:"+s.id===x.vag)||{}).route) : dR;
      x.f=1; x.km=raw;
      if (raw>0 && raw<minKm){ x.km=minKm; min=true; }
      if (raw===0 && !sk && p.direkt){ x.km=minKm; x.f=faktor; direkt=true; }
      x.tkm=x.ton*x.km*x.f;
    });
    const ton=ps.reduce((s,x)=>s+x.ton,0), tkm=ps.reduce((s,x)=>s+x.tkm,0);
    const d = dR>0 ? Math.max(dR,minKm) : (p.direkt ? minKm : 0);
    return {p, d, dS, ton, tkm, fixed, poster:ps, direkt, faktor, min};
  });
  const fixedSum = rows.reduce((s,r)=>s+(r.fixed??0),0);
  /* Lägsta andelstal (PM 3.1.5): fastigheter under gränsen får gränsen, övriga delar på resten. */
  const low=new Set();
  for (let i=0;i<=rows.length;i++){
    const rest=100-fixedSum-low.size*minA;
    const S0=rows.filter(r=>r.fixed===null&&!low.has(r)).reduce((s,r)=>s+r.tkm,0);
    rows.forEach(r=>{ r.low=low.has(r); r.share = r.fixed!==null ? r.fixed : r.low ? minA : (S0>0 ? r.tkm/S0*rest : 0); });
    if (!(minA>0)) break;
    const ny=rows.filter(r=>r.fixed===null&&!low.has(r)&&r.share<minA);
    if (!ny.length) break; ny.forEach(r=>low.add(r));
  }
  rows.forEach(r=>{ r.kr = r.share/100*num(S.utdebitering); });
  // Avrunda till en decimal så att summan blir exakt 100 (största rest)
  const tenths = rows.map(r=>r.share*10), fl = tenths.map(x=>Math.floor(x+1e-9));
  let left = Math.round(tenths.reduce((x,y)=>x+y,0)) - fl.reduce((x,y)=>x+y,0);
  tenths.map((t,i)=>[t-fl[i],i]).sort((a,b)=>b[0]-a[0]).forEach(([,i])=>{ if(left>0){ fl[i]++; left--; } });
  rows.forEach((r,i)=>{ r.disp = fl[i]/10; });
  return {rows, fixedSum, total:rows.filter(r=>r.fixed===null).reduce((s,r)=>s+r.tkm,0)};
}
function typeChips(p){
  const t=typOf(p), lab=(TYPER.find(x=>x[0]===t)||[,"Ej angiven"])[1], c=[lab];
  if (t==="jord"||t==="kombi"){ const ha=markHa(p); if(ha) c.push(fmt(ha)+" ha"); if(num(p.perm)) c.push(num(p.perm)>1?num(p.perm)+" bostäder":"med bostad"); }
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
    <td>${esc(r.p.namn||"Namnlös")}${varningar(r.p,r).length?` <span class="warnmark" title="Kontrollera uppgifterna">!</span>`:""}</td><td>${typeChips(r.p)}</td>
    <td class="num">${r.fixed!==null?"":fmt(r.d,2)+" km"}</td>
    <td class="num">${r.fixed!==null?"":fmt(r.tkm)}</td>
    <td class="num">${String(r.p.andelNu??"").trim()!==""?fmt(num(r.p.andelNu),1)+" %":"–"}</td>
    <td class="num share">${fmt(r.disp,1)} %</td>
    ${showKr?`<td class="num">${fmt(Math.round(r.kr))}</td>`:""}</tr>`).join("");
  const sumShare = rows.reduce((s,r)=>s+r.disp,0), sumKr = rows.reduce((s,r)=>s+r.kr,0);
  $("#summary tfoot").innerHTML = `<tr><td>Totalt</td><td></td><td></td><td class="num">${fmt(total)}</td><td></td><td class="num">${fmt(sumShare,1)} %</td>${showKr?`<td class="num">${fmt(Math.round(sumKr))}</td>`:""}</tr>`;
  document.querySelector("#summary th.kr").style.display = showKr?"":"none";
  rows.forEach(r=>{ const el=document.getElementById("calc-"+r.p.id); if(el) el.textContent = calcText(r); const nv=document.getElementById("vkn-"+r.p.id); if(nv) nv.innerHTML=varningar(r.p,r).map(x=>`<p class="notice">${esc(x)}</p>`).join(""); });
  const g=document.getElementById("vkn-global"); if(g) g.innerHTML=globalVarningar().map(x=>`<p class="notice">${esc(x)}</p>`).join("");
}
/* Kontroller mot PM 2025. Returnerar en lista med texter. */
function varningar(p,r){
  const t=typOf(p), ha=markHa(p), v=[];
  if (t==="annan") return v;
  if (r && r.poster.length && r.tkm===0) v.push("Ingen delsträcka vald: fastigheten får andelen 0. Välj delsträckor eller markera direktutfart.");
  if (t==="kombi"&&ha>=10) v.push(`Fastigheten har ${fmt(ha)} ha mark. Från 10 ha räknas den som jordbruks- eller skogsbruksfastighet (PM tabell 6).`);
  if (t==="kombi"&&ha>0&&ha<=2&&!p.markNaring&&(num(p.akerHa)||num(p.beteHa)||num(p.skogHa))) v.push("Kombinerad bostadsfastighet med 1–2 ha räknas som en permanentbostad, 2 500 ton (PM tabell 1). Marken räknas inte.");
  if (t==="kombi"&&num(p.skogHa)>0&&!p.skogSalu) v.push("Skogen räknas inte: ved för husbehov ingår i bostadens schablon (PM 3.5.4).");
  if ((t==="kombi")&&num(p.hastEgna)+num(p.hastInack)>10) v.push("Fler än 10 hästar räknas som jordbruksfastighet (PM 3.5.7).");
  if (t==="jord"&&ha>0&&ha<10&&(num(p.perm)||num(p.frit))) v.push("Under 10 ha med bostad räknas fastigheten normalt som kombinerad bostadsfastighet (PM tabell 6).");
  if (t==="jord") skiften(p).forEach(s=>{ if(s.plats!=="bc"&&(num(s.aker)||num(s.bete))&&!(s.route||[]).length) v.push(`${s.namn||"Skiftet"}: inga delsträckor valda, så de interna transporterna räknas inte. Välj de delsträckor som transporterna till skiftet kör på.`); });
  if ((t==="jord"||t==="kombi")&&num(p.boxar)>0&&num(p.boxar)!==num(p.hastEgna)+num(p.hastInack)&&(p.hastJamk||"faktiska")==="faktiska"&&num(p.hastEgna)+num(p.hastInack)>0) v.push("Antalet boxar skiljer sig från antalet hästar. PM 3.5.7.1 föreslår att man jämkar mellan dem.");
  if (["kombi","jord","skog"].includes(t)){ const s=num(p.skogHa)+(harFjall()?num(p.skogFjallHa):0); if(s>0&&s<1) v.push("Skog under 1 ha räknas inte (PM 3.8.2)."); }
  if (t==="skog"&&num(p.skogRestrHa)>0&&num(p.skogHa)+num(p.skogFjallHa)===0&&!p.skogJakt) v.push("Får jakt bedrivas på marken? Då räknas jaktresor, 60 ton per påbörjade 100 ha, i stället för 2 ton per ha (PM 3.8.2.3).");
  if (t==="egen"&&!rader(p).length&&!num(p.egenTon)) v.push("Lägg till poster eller välj en beräkningsmall.");
  return v;
}
function globalVarningar(){
  const v=[], niv=new Set(state.props.filter(p=>num(p.frit)>0).map(fritNivaOf));
  if (niv.size>1) v.push("Fritidsbostäderna har olika användningsnivå. Normalt ska samma nivå gälla hela området (PM 3.3.2).");
  return v;
}
function calcText(r){
  if (r.fixed!==null) return `Fast andel ${fmt(r.fixed,1)} %. Övriga fält påverkar inte resultatet.`;
  if (!r.poster.length) return "Ingen trafik angiven ännu.";
  const S=state.schablon;
  const rad=r.poster.map(x=>`${x.namn} = ${fmt(x.ton)} ton × ${fmt(x.km,3)} km${x.f!==1?` × ${fmt(x.f,1)}`:""} = ${fmt(x.tkm)} tonkm${x.ref?` (PM ${x.ref})`:""}`).join("\n");
  const not=[];
  if (r.min) not.push(`Minsta väglängd ${fmt(num(S.minKm),3)} km används där vägen är kortare (PM 3.1.3).`);
  if (r.direkt) not.push(`Direktutfart: minsta väglängd och reduktionsfaktor ${fmt(r.faktor,1)} (PM 3.1.4).`);
  if (r.low) not.push(`Lägsta andelstal ${fmt(num(S.minAndel),1)} % används (PM 3.1.5).`);
  return rad + (not.length?"\n"+not.join("\n"):"") + `\nSumma ${fmt(r.ton)} ton per år, ${fmt(r.tkm)} tonkm, andel ${fmt(r.disp,1)} %.`;
}
const getR=(p,k)=> k.startsWith("sk:") ? ((skiften(p).find(s=>s.id===k.slice(3))||{}).route||[]) : (p[k]||[]);
const setR=(p,k,v)=>{ if(k.startsWith("sk:")){ const s=skiften(p).find(s=>s.id===k.slice(3)); if(s) s.route=v; } else p[k]=v; };
function mapRoutes(fn){ state.props.forEach(p=>{ ["route","skogRoute","inreRoute"].forEach(k=>{ if(p[k]) p[k]=fn(p[k]); }); skiften(p).forEach(s=>{ if(s.route) s.route=fn(s.route); }); }); }
function segBoxes(p, key){
  const val=getR(p,key);
  return state.segments.map(g=>{
    const on=val.includes(g.id); const id=`${key.replace(":","_")}-${p.id}-${g.id}`;
    return `<label class="seg ${on?"on":""}" for="${id}" title="${esc(g.namn)}"><input type="checkbox" id="${id}" data-p="${p.id}" data-key="${key}" data-seg="${esc(g.id)}" ${on?"checked":""}>${esc(g.id)}</label>`;
  }).join("") || `<span class="hint">Lägg till delsträckor längre ner.</span>`;
}
function renderPick(){
  if (!state.props.find(p=>p.id===selected)) selected = state.props[0]?.id ?? null;
  const sorted=[...state.props].sort((a,b)=>String(a.namn).localeCompare(String(b.namn),"sv"));
  $("#pick").innerHTML = sorted.map(p=>`<option value="${p.id}" ${p.id===selected?"selected":""}>${esc(p.namn||"Namnlös")}</option>`).join("") || `<option value="">Inga fastigheter</option>`;
}
const TYPER=[
  ["perm","Permanentbostad (villa, radhus, kedjehus)","Bostad"],["frit","Fritidsbostad (även fasta ställplatser och villavagnar)","Bostad"],
  ["flerfam","Flerfamiljshus","Bostad"],["smahusbr","Småhus i bostadsrätt eller kooperativ hyresrätt","Bostad"],
  ["kombi","Kombinerad bostadsfastighet, t.ex. hästgård (bostad med mark under 10 ha)","Jord och skog"],
  ["jord","Jordbruksfastighet (10 ha eller mer)","Jord och skog"],["skog","Skogsbruksfastighet utan bostad","Jord och skog"],
  ["obebyggd","Obebyggd fastighet","Övrigt"],["teknisk","Teknisk anläggning (mast, vindkraft, pumpstation …)","Övrigt"],
  ["smabat","Småbåtshamn","Övrigt"],["natur","Naturreservat, skyddad natur","Övrigt"],["jarnvag","Järnvägsfastighet","Övrigt"],
  ["egen","Beräknas i det enskilda fallet (skola, golfbana, camping, reservat för friluftsliv …)","Övrigt"],["annan","Fast andel i procent","Övrigt"]];
const TYPKODER=TYPER.map(x=>x[0]);
function typOf(p){
  if (TYPKODER.includes(p.typ)) return p.typ;
  if (String(p.fast??"").trim()!=="") return "annan";
  if (p.typ&&String(p.typ).startsWith("jord")) return (num(p.akerHa)>0||num(p.perm)||num(p.frit)) ? "jord" : "skog";
  if (num(p.akerHa)>0||num(p.skogHa)>0) return (num(p.akerHa)===0&&!num(p.perm)&&!num(p.frit)) ? "skog" : "jord";
  return num(p.frit)>0&&!num(p.perm) ? "frit" : "perm";
}
const nyttSkifte=(namn,aker,bete,plats,route)=>({id:uid(),namn,aker:aker||0,bete:bete||0,plats:plats||"bc",fu:true,route:route||[]});
/* Äldre sparade uppgifter: jordbrukets åker och bete flyttas till ett skifte. */
function normalisera(st){
  const S=st.schablon||{};
  (st.props||[]).forEach(p=>{
    const t=typOf(p);
    if (t==="jord" && !Array.isArray(p.skiften)){
      p.skiften = (num(p.akerHa)||num(p.beteHa)) ? [nyttSkifte("Åker och bete",p.akerHa,p.beteHa,p.interna?"inom":"bc",p.interna?[...((p.inreRoute&&p.inreRoute.length)?p.inreRoute:(p.route||[]))]:[])] : [];
      p.akerHa=0; p.beteHa=0; delete p.interna; delete p.inreRoute;
    }
    if (p.fritNiva && p.fritNiva===(S.fritNiva||"normal")) p.fritNiva="";
    delete p.andel2012;
  });
  return st;
}
function setTyp(p,t){
  const fore=typOf(p);
  if (fore==="jord" && t!=="jord"){ p.akerHa=akerTot(p); p.beteHa=beteTot(p); p.skiften=[]; }
  p.typ=t;
  if (t==="perm"||t==="kombi"){ if(!num(p.perm)) p.perm=1; p.frit=0; }
  else if (t==="frit"){ if(!num(p.frit)) p.frit=1; p.perm=0; p.komp=0; }
  else if (t!=="jord"){ p.perm=0; p.frit=0; p.komp=0; }
  if (t==="jord"){ if(!skiften(p).length) p.skiften=(num(p.akerHa)||num(p.beteHa))?[nyttSkifte("Åker och bete",p.akerHa,p.beteHa)]:[]; p.akerHa=0; p.beteHa=0; }
  if (!["kombi","jord"].includes(t)){ p.akerHa=0; p.beteHa=0; p.arealHa=""; p.hastEgna=0; p.hastInack=0; p.boxar=0; p.hastJamk=""; p.ovrigTon=0; }
  if (!["kombi","jord","skog"].includes(t)){ p.skogHa=0; p.skogFjallHa=0; p.skogRestrHa=0; p.skogRoute=[]; p.skogJamn=false; p.skogJakt=false; }
  if (!["kombi","jord","egen"].includes(t)){ p.rader=[]; p.gods=""; }
  if (t!=="jord"){ p.mjolk=""; p.anstallda=0; p.gnsHog=false; }
  if (t!=="annan") p.fast="";
  if (t==="flerfam"&&!num(p.lgh)) p.lgh=2;
  if (t==="smahusbr"&&!num(p.smahus)) p.smahus=1;
  if (t==="smabat"&&!num(p.batplatser)) p.batplatser=10;
  if (t==="teknisk"){ if(!p.tekFrek) p.tekFrek="manad"; if(!num(p.antalAnl)) p.antalAnl=1; }
  if (t==="jarnvag"&&!p.jarnvagTyp) p.jarnvagTyp="ovrig";
}
/* Beräkningsmallar ur PM 2025: [förekomst, fordonsvikt, färder per dag, dagar per år, ingår i godstillägg]. */
const MALLAR={
  skola:{namn:"Skola och förskola (tabell 22)",gods:"p25",rader:[["Barnskjutsar med bil",1.5,2,184],["Anställda med bil",1.5,1,184],["Skolbuss",12,2,184],["Skoltaxi",1.5,2,184],["Mattransporter",3.5,1,184],["Service och hantverkare",2,1,4],["Transporter med bil, helger",1.5,1,90,false],["Transporter med bil, kvällar",1.5,1,184,false]]},
  golf:{namn:"Golfbana (tabell 13)",gods:"p25",rader:[["Medlemmar och gäster",1.5,1,220],["Restaurang, gäster som inte golfar",1.5,1,""],["Transporter till restaurangen",3.5,1,""],["Service och hantverkare",2.9,1,""],["Personal",1.5,1,""],["Konferens",1.5,1,""],["Event",1.5,1,""]]},
  camping:{namn:"Campingplats (3.10.7)",gods:"p25",rader:[["Ställplatser som hyrs per natt",1.5,1,""],["Tältplatser",1.5,1,""],["Uthyrningsstugor",1.5,1,""],["Restaurang, kiosk, minilivs",1.5,1,""],["Varutransporter",3.5,1,""],["Personal",1.5,1,""],["Service och hantverkare",2.9,1,""]]},
  hotell:{namn:"Hotell och konferens (tabell 30)",gods:"p25",rader:[["Konferens",1.5,1,""],["Event",1.5,1,""],["Restaurang",1.5,1,""],["Hotellgäster",1.5,1,""],["Service och hantverkare",2.9,1,""],["Personal",1.5,1,260]]},
  friluft:{namn:"Naturreservat för friluftsliv (tabell 23)",gods:"t200",rader:[["Anställda med bil",1.5,1,""],["Besökare med bil",1.5,1,""],["Besökande med buss",19.5,1,""],["Slamsugning","",1,""],["Skötsel","",1,""],["Sophämtning","",1,""]]},
  idrott:{namn:"Idrottsplats (tabell 24)",gods:"t200",rader:[["Anställda med bil",1.5,1,""],["Besökare med bil",1.5,1,""],["Besökande med buss",19.5,1,""],["Bilbingo",1.5,1,""],["Auktion",1.5,1,""],["Skötsel","",1,""],["Sophämtning","",1,""]]},
  samling:{namn:"Samlingslokal (tabell 25)",gods:"t200",rader:[["Bingo",1.5,1,""],["Körövning",1.5,1,""],["Biobesök",1.5,1,""],["Dans",1.5,1,""],["Scouter",1.5,1,""],["Fest",1.5,1,""],["Föreningsverksamhet",1.5,1,""],["Varutransport","",1,""],["Sophämtning","",1,""]]},
  kyrka:{namn:"Kyrka (tabell 26)",gods:"t200",rader:[["Anställda med bil",1.5,1,""],["Besökare med bil",1.5,1,""],["Gudstjänst",1.5,1,""],["Dop",1.5,1,""],["Vigsel",1.5,1,""],["Begravning",1.5,1,""],["Vård av gravplats",1.5,1,""]]},
  aldre:{namn:"Äldreboende (tabell 27)",gods:"t200",rader:[["Anställda med bil",1.5,1,""],["Besökare med bil",1.5,1,""],["Hemtjänsttransporter",1.5,1,""],["Varutransporter, tunga fordon","",1,""],["Varutransporter, lätta fordon",3.5,1,""],["Taxibesök",1.5,1,""],["Post",2.9,1,""],["Sophämtning","",1,""]]},
  butik:{namn:"Närbutik (tabell 28)",gods:"t200",rader:[["Anställda med bil",1.5,1,""],["Kunder med bil",1.5,1,""],["Varutransporter","",1,""],["Mejeritransporter","",1,""],["Brödtransporter",3.5,1,""],["Postverksamhet",2.9,1,""]]},
  rening:{namn:"Reningsverk (tabell 29)",gods:"t200",rader:[["Anställda med bil",1.5,1,""],["Slamtömning","",1,""],["Kemikalietransport","",1,""],["Containertömning","",1,""],["Varutransporter","",1,""]]},
  kombi:{namn:"Verksamhet på kombinerad bostadsfastighet (tabell 4)",gods:"",rader:[["Djurhållning: veterinär, foder, gödsel","",1,""],["Gårdsförsäljning, besök",1.5,1,""],["Självplock, besök",1.5,1,""],["Bed & breakfast, gäster",1.5,1,""],["Leveranser, slamsugning, avfall","",1,""]]},
  hastbesok:{namn:"Besök till inackorderade hästar på ridanläggning (6.3.2)",gods:"",rader:[["Besökare till inackorderade hästar",1.5,1,299]]},
  djur:{namn:"Djurproduktion som inte beror på arealen (3.7.1.5)",gods:"",rader:[["Djurtransporter","",1,""],["Fodertransporter","",1,""],["Gödsel","",1,""],["Veterinär och service",2.9,1,""]]}
};
const MALL_FOR={kombi:["kombi","hastbesok"],jord:["hastbesok","djur","kombi"],egen:["skola","golf","camping","hotell","friluft","idrott","samling","kyrka","aldre","butik","rening"]};
let editProp=null;
document.addEventListener("click", e=>{
  const u=e.target.closest("[data-unlock]"); if(u){ editProp=u.dataset.unlock; renderCards(); const f=document.getElementById("namn-"+editProp); if(f) f.focus(); return; }
  if (e.target.closest("[data-lock]")){ editProp=null; renderCards(); renderSummary(); }
});
const fld=(p,f,label,mode="decimal",extra="")=>`<label for="${f}-${p.id}">${label}<input id="${f}-${p.id}" inputmode="${mode}" data-p="${p.id}" data-f="${f}" value="${esc(String(p[f]??"").replace(".",","))}"${extra}></label>`;
const sel=(p,f,label,opts,def)=>`<label for="${f}-${p.id}">${label}<select id="${f}-${p.id}" data-p="${p.id}" data-f="${f}">${opts.map(([v,l])=>`<option value="${v}" ${String(p[f]??def)===v?"selected":""}>${esc(l)}</option>`).join("")}</select></label>`;
const chk=(p,f,label)=>`<label class="check" for="${f}-${p.id}"><input type="checkbox" id="${f}-${p.id}" data-p="${p.id}" data-f="${f}" ${p[f]?"checked":""}>${label}</label>`;
function typHjalp(t){
  return ({
    perm:"2 500 ton per hushåll (PM 3.2). Radhus och kedjehus räknas som villa. En komplementbostad ingår normalt, men en varaktigt uthyrd räknas med 1 300 ton.",
    frit:"Intensiv 1 800 ton (används veckoslut året runt), normal 900 ton (sommar och veckoslut april–september), låg 450 ton (4–5 veckor per år). Nivån ställs normalt in för hela området under Schablonvärden (PM 3.3). Fasta ställplatser och villavagnar räknas som fritidsbostad (PM 3.10.7).",
    flerfam:"1 500 ton per lägenhet oavsett upplåtelseform (PM 3.4.1).",
    smahusbr:"2 000 ton per hus. Används bara om något, till exempel närhet till kollektivtrafik, motiverar lägre trafik än en vanlig villa (PM 3.4.2).",
    kombi:"Bostad med mark under 10 ha (PM 3.5). Bostaden räknas som permanentbostad. Med 1–2 ha räknas bara bostaden. Med mer mark räknas åker och bete med tabell 7, hästar och annan verksamhet som gårdsförsäljning eller bed & breakfast. Ved och odling för husbehov ingår i bostaden.",
    jord:"Bostäderna räknas för sig. Företagsutfarten räknas på åkern: under gränsen per hektar (tabell 8), över gränsen ett fast belopp plus per hektar (tabell 9). Interna transporter räknas per skifte på den sträcka av vägen som används mellan brukningscentrum och skiftet (tabell 7). Skog, hästar, mjölk och anställda läggs till.",
    skog:"Ton per hektar produktiv skogsmark efter tillväxtområde (tabell 10). Under 1 ha räknas inte. Impediment räknas inte. Mark där skogsbruk inte får bedrivas räknas med 2 ton per ha, eller med jaktresor om hela fastigheten är belagd och jakt får bedrivas (PM 3.8.2).",
    obebyggd:"100 ton per fastighet (PM 3.6). Har bygglov vunnit laga kraft räknas den som bebyggd.",
    teknisk:"Schablon efter hur ofta anläggningen besöks, inklusive planerat underhåll (tabell 14). Anläggningar som sköts samlat, till exempel vindkraftverk, kan räknas som kluster (PM 3.10.2.2). Anläggningar som bara försörjer området och sällan besöks ska inte ha något andelstal (PM 3.10.2.3).",
    smabat:"400 ton per båtplats, 500 ton nära större tätort (PM 3.9.7).",
    natur:"500 ton för naturreservat som skyddar natur (tabell 15). Reservat för friluftsliv och nationalparker beräknas i det enskilda fallet. Skog och jakt som får bedrivas läggs på fastigheten.",
    jarnvag:"Signalanläggning 800 ton, övriga anläggningar 600 ton (tabell 11).",
    egen:"Räknas som Lantmäteriets beräkningsmallar (PM 6.3–6.5): antal × dagar per år × fordonsvikt × färder per dag × 2 för tur och retur, plus godstillägg. Välj en mall och fyll i antal och dagar. Gör alltid en skälighetsbedömning mot områdets övriga andelstal (PM 3.1.2).",
    annan:"En fast andel i procent som läggs först. Övriga fastigheter delar på resten."
  })[t]||"";
}
const VIKTER=[["1.5","Personbil 1,5 ton"],["2.9","Arbetsbil, pick-up 2,9 ton"],["3.5","Lätt lastbil 3,5 ton"],["19.5","Buss, två axlar 19,5 ton"],["18","Lastbil, två axlar 18 ton"],["25","Lastbil, tre axlar 25 ton"],["31","Lastbil, fyra axlar 31 ton"],["38","Lastbilssläp 38 ton"]];
function raderBlock(p,t){
  const rs=rader(p), id=p.id;
  const f=(r,k,l,mode="decimal")=>`<label for="r${k}-${r.id}">${l}<input id="r${k}-${r.id}" inputmode="${mode}" list="${k==="vikt"?"vikter":""}" data-rad="${id}|${r.id}" data-rf="${k}" value="${esc(String(r[k]??"").replace(".",","))}"></label>`;
  const mall=(MALL_FOR[t]||[]);
  return `<fieldset class="fs"><legend>${t==="egen"?"Beräkning":"Övriga poster"}</legend>
    <p class="hint">${t==="egen"?"Varje rad: antal × dagar per år × fordonsvikt × färder per dag × 2 för tur och retur.":"Annan stadigvarande trafik som inte ingår ovan. Varje rad: antal × dagar per år × fordonsvikt × färder per dag × 2 för tur och retur."} Fordonsvikter enligt PM tabell 21.</p>
    ${rs.map(r=>`<div class="radpost"><div class="radnamn">${f(r,"namn","Förekomst","text")}<button type="button" class="ghost small" data-delrad="${id}|${r.id}" aria-label="Ta bort raden">Ta bort</button></div>
      <div class="radtal">${f(r,"antal","Antal")}${f(r,"dagar","Dagar per år")}${f(r,"vikt","Fordonsvikt, ton")}${f(r,"farder","Färder per dag")}</div>
      <div class="row"><label class="check" for="rtor-${r.id}"><input type="checkbox" id="rtor-${r.id}" data-rad="${id}|${r.id}" data-rf="tor" ${r.tor===false?"":"checked"}>Tur och retur (× 2)</label>
      ${p.gods==="p25"?`<label class="check" for="rgods-${r.id}"><input type="checkbox" id="rgods-${r.id}" data-rad="${id}|${r.id}" data-rf="gods" ${r.gods===false?"":"checked"}>Ingår i godstillägget</label>`:""}
      <span class="radsum">${fmt(radTon(r))} ton</span></div></div>`).join("")}
    <div class="row" style="align-items:flex-end"><button type="button" class="ghost small" data-addrad="${id}">Lägg till rad</button>
      ${mall.length?`<label for="mall-${id}" style="flex:1;min-width:200px">Hämta rader från mall<select id="mall-${id}" data-mall="${id}"><option value="">Välj mall …</option>${mall.map(k=>`<option value="${k}">${esc(MALLAR[k].namn)}</option>`).join("")}</select></label>`:""}</div>
    <div class="grid2">${sel(p,"gods","Godstillägg (varor, post, slam, avfall …)",[["","Inget"],["p25","25 % av posterna (PM 6.3.3)"],["t200","Schablon 200 ton (PM 6.4)"]],"")}${fld(p,t==="egen"?"egenTon":"ovrigTon","Annat beräknat tontal, ton per år")}</div>
  </fieldset>`;
}
function hastBlock(p){
  const h=num(p.hastEgna)+num(p.hastInack), b=num(p.boxar), j=hastTal(p);
  return `<fieldset class="fs"><legend>Hästar</legend><div class="grid2">${fld(p,"hastEgna","Egna hästar (200 ton)","numeric")}${fld(p,"hastInack","Inackorderade hästar (1 100 ton)","numeric")}${fld(p,"boxar","Antal boxar eller stallplatser","numeric")}
    ${b>0&&h>0&&b!==h?sel(p,"hastJamk","Räkna på",[["faktiska",`Hästarna i dag (${h})`],["jamka",`Jämkat mellan hästar och boxar (${ceilE((h+b)/2)})`],["boxar",`Antalet boxar (${b})`]],"faktiska"):""}</div>
    ${j.text?`<p class="hint">${esc(j.text[0].toUpperCase()+j.text.slice(1))}: ${j.egna} egna och ${j.inack} inackorderade (PM 3.5.7.1).</p>`:`<p class="hint">Stallets storlek avgör stadigvarande hur många hästar som kan finnas. Skiljer sig boxarna från hästarna kan man jämka (PM 3.5.7.1).</p>`}</fieldset>`;
}
function skiftenBlock(p){
  const O=omrOf(), sk=skiften(p), id=p.id;
  const f=(s,k,l,mode="decimal")=>`<label for="sk${k}-${s.id}">${l}<input id="sk${k}-${s.id}" inputmode="${mode}" data-sk="${id}|${s.id}" data-skf="${k}" value="${esc(String(s[k]??"").replace(".",","))}"></label>`;
  return `<fieldset class="fs"><legend>Åker och bete, per skifte</legend>
    <p class="hint">Ett skifte är ett sammanhängande markområde. Lägg in åker och bete för varje skifte, även mark utanför området som brukas härifrån (ägd eller arrenderad, PM 3.7.1.8–9). Mark som arrenderas ut till någon annan räknas ändå här (PM 3.7.2.1).</p>
    ${sk.map(s=>`<div class="skifte">
      <div class="radnamn">${f(s,"namn","Skifte","text")}<button type="button" class="ghost small" data-delsk="${id}|${s.id}">Ta bort</button></div>
      <div class="grid2">${f(s,"aker","Åker, ha")}${f(s,"bete","Bete, ha")}</div>
      <label for="skplats-${s.id}">Var ligger skiftet<select id="skplats-${s.id}" data-sk="${id}|${s.id}" data-skf="plats">${[["bc","Vid brukningscentrum (inga interna transporter)"],["inom","Annat ställe inom området"],["utanfor","Utanför området, nås via vägen"]].map(([v,l])=>`<option value="${v}" ${(s.plats||"bc")===v?"selected":""}>${l}</option>`).join("")}</select></label>
      <label class="check" for="skfu-${s.id}"><input type="checkbox" id="skfu-${s.id}" data-sk="${id}|${s.id}" data-skf="fu" ${s.fu===false?"":"checked"}>Skörden körs till brukningscentrum (åkern ingår i företagsutfarten)</label>
      ${s.plats&&s.plats!=="bc"?`<label>Interna transporter mellan brukningscentrum och skiftet kör på delsträckor</label><div class="segs">${segBoxes(p,"sk:"+s.id)}</div>`:""}
    </div>`).join("")}
    <div class="row"><button type="button" class="ghost small" data-addsk="${id}">Lägg till skifte</button></div>
    <p class="hint">Företagsutfart: under ${O.grans} ha åker ${O.t8} ton per ha, annars ${fmt(O.t9[0])} ton + ${O.t9[1]} ton per ha. Interna transporter: ${O.t7[0]} ton per ha åker och ${O.t7[1]} ton per ha bete. (${esc(O.namn)})</p>
    ${state.schablon.prodOmr==="Gns"?chk(p,"gnsHog","Högproduktivt och stort jordbruk: fast belopp 1 500 ton som i Gss (PM 3.7.1.3)"):""}
  </fieldset>`;
}
function renderCards(){
  renderPick();
  const S=state.schablon, O=omrOf();
  $("#cards").innerHTML = state.props.filter(p=>p.id===selected).map(p=>{
    const t=typOf(p), ed=editProp===p.id;
    const harSkog=["kombi","jord","skog"].includes(t);
    const grupper=[...new Set(TYPER.map(x=>x[2]))];
    const nivOpt=[["",`Samma som området (${NIV[S.fritNiva||"normal"]})`],["intensiv","Intensiv – veckoslut året runt (1 800 ton)"],["normal","Normal – sommar och veckoslut apr–sep (900 ton)"],["lag","Låg – 4–5 veckor per år (450 ton)"]];
    let f="";
    if (t==="perm"||t==="kombi") f+=`<fieldset class="fs"><legend>Bostad</legend><div class="grid2">${fld(p,"perm","Antal hushåll (permanentbostäder)","numeric")}${fld(p,"komp","Varaktigt uthyrda komplementbostäder","numeric")}</div></fieldset>`;
    if (t==="frit") f+=`<fieldset class="fs"><legend>Fritidsbostad</legend><div class="grid2">${fld(p,"frit","Antal fritidsbostäder","numeric")}${sel(p,"fritNiva","Användning",nivOpt,"")}</div></fieldset>`;
    if (t==="jord") f+=`<fieldset class="fs"><legend>Bostäder på gården</legend><div class="grid2">${fld(p,"perm","Permanentbostäder","numeric")}${fld(p,"komp","Uthyrda komplementbostäder","numeric")}${fld(p,"frit","Fritidsbostäder","numeric")}${(num(p.frit)?sel(p,"fritNiva","Fritidsbostadens användning",nivOpt,""):"")}</div></fieldset>`;
    if (t==="flerfam") f+=`<fieldset class="fs"><legend>Flerfamiljshus</legend>${fld(p,"lgh","Antal lägenheter","numeric")}</fieldset>`;
    if (t==="smahusbr") f+=`<fieldset class="fs"><legend>Småhus i förening</legend>${fld(p,"smahus","Antal hus","numeric")}</fieldset>`;
    if (t==="kombi"){ const ha=markHa(p);
      f+=`<fieldset class="fs"><legend>Mark</legend><div class="grid2">${fld(p,"arealHa","Fastighetens areal, ha (tomt = summan av marken)")}${fld(p,"akerHa",`Åker, ha (${O.t7[0]} ton per ha)`)}${fld(p,"beteHa",`Bete, ha (${O.t7[1]} ton per ha)`)}</div>
      ${ha>0&&ha<=2?chk(p,"markNaring","Marken brukas som näring och ska räknas trots 1–2 ha (PM tabell 6)"):""}
      <p class="hint">Åker och bete räknas med tabell 7 för ${esc(O.namn)} (PM 3.5.5).</p></fieldset>`;
      f+=hastBlock(p); }
    if (t==="jord"){ f+=skiftenBlock(p);
      f+=`<fieldset class="fs"><legend>Verksamhet</legend><div class="grid2">${sel(p,"mjolk","Mjölktransporter (PM 3.7.1.4)",[["","Inga"],["indiv","Individuell beräkning (huvudmetod)"],["enkel","Schablon enkelresa 6 600 ton"],["tor","Schablon tur och retur 13 200 ton"]],"")}${fld(p,"anstallda","Heltidsanställda, 780 ton var (PM 3.7.1.7)","decimal")}</div>
      ${p.mjolk==="indiv"?`<div class="grid2">${fld(p,"mjolkHamt","Hämtningar per år (varannan dag = 183)","numeric",' placeholder="183"')}${fld(p,"mjolkAndel","Gårdens del av turen, % (rundkörning)","decimal",' placeholder="100"')}</div>${chk(p,"mjolkSlap","Mjölkbilen kör med släp (50 ton, annars 22 ton)")}${chk(p,"mjolkTor","Bilen kör tur och retur på vägen")}`:""}
      <p class="hint">Uppfödning för kött och ägg och odling i växthus beror inte på arealen och läggs till som egna poster (PM 3.7.1.5).</p></fieldset>`;
      f+=hastBlock(p); }
    if (harSkog){ const prod=num(p.skogHa)+num(p.skogFjallHa);
      f+=`<fieldset class="fs"><legend>Skog</legend>${t==="kombi"?chk(p,"skogSalu","Skogen avverkas för försäljning (ved för husbehov ingår i bostaden)"):""}
      <div class="grid2">${fld(p,"skogHa",`Produktiv skogsmark, ha (${skogTal()} ton per ha)`)}${harFjall()?fld(p,"skogFjallHa",`Fjällnära skog, ha (${fjallTal()} ton per ha)`):""}${fld(p,"skogRestrHa","Skog där skogsbruk inte får bedrivas, ha (2 ton per ha)")}</div>
      ${t==="skog"&&prod===0&&num(p.skogRestrHa)>0?chk(p,"skogJakt","Hela fastigheten är belagd men jakt får bedrivas (jaktresor 60 ton per påbörjade 100 ha)"):""}
      <p class="hint">Under 1 ha skog räknas inte. Impediment och mycket lågproduktiv skog (sump- och kärrskog) räknas inte. Jaktresor ingår i schablonen per hektar.</p></fieldset>`; }
    if (t==="teknisk") f+=`<fieldset class="fs"><legend>Teknisk anläggning</legend><div class="grid2">${sel(p,"tekFrek","Hur ofta besöks den",[["manad","En gång per månad (500 ton)"],["varannan","Varannan vecka (600 ton)"],["vecka","En gång per vecka (800 ton)"],["tva","Två gånger per vecka (1 100 ton)"]],"manad")}${fld(p,"antalAnl","Antal anläggningar","numeric")}</div>
      ${num(p.antalAnl)>1?chk(p,"kluster","Anläggningarna sköts samlat som ett kluster, till exempel en vindkraftspark (PM 3.10.2.2)"):""}
      <p class="hint">Större underhåll och förnyelse som kan förutses ska räknas in, fördelat per år. Fyll då i den beräkningen som en egen fastighet av typen Beräknas i det enskilda fallet (PM 3.10.2.1).</p></fieldset>`;
    if (t==="smabat") f+=`<fieldset class="fs"><legend>Småbåtshamn</legend>${fld(p,"batplatser","Antal båtplatser","numeric")}${chk(p,"batTatort","Nära större tätort (500 ton per båtplats)")}</fieldset>`;
    if (t==="jarnvag") f+=`<fieldset class="fs"><legend>Järnvägsfastighet</legend>${sel(p,"jarnvagTyp","Anläggning",[["signal","Signalanläggning (800 ton)"],["ovrig","Övriga anläggningar (600 ton)"]],"ovrig")}</fieldset>`;
    if (t==="kombi"||t==="jord"||t==="egen") f+=raderBlock(p,t);
    if (t==="annan") f+=`<fieldset class="fs"><legend>Fast andel</legend>${fld(p,"fast","Andel i procent")}</fieldset>`;
    const vag = t==="annan" ? "" : `<fieldset class="fs"><legend>Vägen</legend>
      <label>${t==="jord"?"Bostad och företagsutfart kör":"Kör"} på delsträckor ut till ${esc(utfartOf())}</label><div class="segs">${segBoxes(p,"route")}</div>
      ${harSkog?`<label>Skogen kör på delsträckor (tomt = samma som ovan)</label><div class="segs">${segBoxes(p,"skogRoute")}</div>
      ${chk(p,"skogJamn","Skogen ligger jämnt utmed sträckan (medelavstånd)")}`:""}
      ${chk(p,"direkt","Direktutfart till allmän väg (minsta väglängd och reduktionsfaktor, PM 3.1.4)")}
      ${p.direkt?sel(p,"direktFaktor","Reduktionsfaktor",[["0.5","0,5 – gemensamma nyttigheter i normal omfattning"],["0.3","0,3 – gemensamma nyttigheter i mindre omfattning"]],"0.5"):""}
    </fieldset>`;
    return `<div class="panel card${ed?" editing":""}" data-card="${p.id}">
    <div class="card-head">
      ${ed?`<input id="namn-${p.id}" aria-label="Fastighetens namn" data-p="${p.id}" data-f="namn" value="${esc(p.namn)}">`:`<h3 class="pname">${esc(p.namn)}</h3>`}
      ${ed?`<button type="button" data-lock="1">Klar</button>`:`<button type="button" class="ghost" data-unlock="${p.id}">Redigera</button>`}
    </div>
    ${ed?"":`<p class="hint">Tryck på Redigera för att ändra uppgifterna.</p>`}
    <div id="vkn-${p.id}"></div>
    <fieldset class="lockwrap" ${ed?"":"disabled"}>
    <label for="typ-${p.id}">Typ av fastighet<select id="typ-${p.id}" data-typ="${p.id}">${grupper.map(g=>`<optgroup label="${g}">${TYPER.filter(x=>x[2]===g).map(([v,l])=>`<option value="${v}" ${v===t?"selected":""}>${esc(l)}</option>`).join("")}</optgroup>`).join("")}</select></label>
    <p class="hint">${esc(typHjalp(t))}</p>
    ${f}${vag}
    <details class="more"><summary>Fler uppgifter</summary>
      <label for="andelNu-${p.id}">Nuvarande andel, % (om fastigheten redan har ett andelstal)<input id="andelNu-${p.id}" inputmode="decimal" data-p="${p.id}" data-f="andelNu" value="${esc(String(p.andelNu??"").replace(".",","))}"></label>
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
document.addEventListener("change", e=>{
  const id=e.target.dataset&&e.target.dataset.mall; if(!id||!e.target.value) return;
  const p=state.props.find(x=>x.id===id), m=MALLAR[e.target.value]; if(!p||!m) return;
  p.rader=[...rader(p), ...m.rader.map(([namn,vikt,farder,dagar,gods])=>({id:uid(),namn,antal:"",dagar:dagar??"",vikt:vikt??"",farder:farder??1,tor:true,gods:gods!==false}))];
  if (m.gods && !p.gods) p.gods=m.gods;
  renderCards(); renderSummary(); scheduleSave();
});
function renderSegments(){
  $("#segtable tbody").innerHTML = state.segments.map((g,i)=>`<tr>
    <td><input id="segid-${i}" aria-label="Beteckning" data-seg-i="${i}" data-sf="id" value="${esc(g.id)}" style="width:70px"></td>
    <td><input id="segnamn-${i}" aria-label="Sträcka" data-seg-i="${i}" data-sf="namn" value="${esc(g.namn)}"></td>
    <td class="num"><input id="segm-${i}" aria-label="Meter" inputmode="decimal" data-seg-i="${i}" data-sf="m" value="${esc(g.m)}" style="width:90px;text-align:right"></td>
    <td><button type="button" class="danger" data-segdel="${i}">Ta bort</button></td></tr>`).join("");
}
function renderSchablon(){
  const S=state.schablon, O=omrOf(), sk=skogTal();
  const rad=(a,b,c)=>`<tr><td>${esc(a)}</td><td class="num">${esc(b)}</td><td>${esc(c||"")}</td></tr>`;
  $("#schablon").innerHTML = `
    <div class="grid2">
    <label for="s-forening">Gemensamhetsanläggningens namn (visas i PDF:en)<input id="s-forening" data-s="forening" value="${esc(S.forening??"")}" placeholder="t.ex. Exempelvägens samfällighetsförening"></label>
    <label for="s-utfart">Vägen ansluter till (allmän väg eller plats)<input id="s-utfart" data-s="utfart" value="${esc(S.utfart??"")}" placeholder="allmän väg"></label>
    </div>
    <label for="s-prodOmr">Produktionsområde för jordbruk<select id="s-prodOmr" data-s="prodOmr">${Object.entries(PM.omr).map(([k,v])=>`<option value="${k}" ${S.prodOmr===k?"selected":""}>${esc(v.namn)}</option>`).join("")}</select></label>
    <div class="hint prodinfo">
      <p>Jordbruksverket delar in Sverige i åtta produktionsområden efter hur mycket jordbruksmarken ger. Området avgör hur mycket trafik åker och bete ger: interna transporter (tabell 7) och företagsutfart (tabell 8 och 9) i Lantmäteriets PM, avsnitt 3.7 och 6.1. Det påverkar bara jordbruksfastigheter och kombinerade bostadsfastigheter med mark.</p>
      <p><b>Valt område, ${esc(O.namn)}:</b> ${esc(OMR_TEXT[S.prodOmr]||"")} Interna transporter ${O.t7[0]} ton per ha åker och ${O.t7[1]} ton per ha bete. Företagsutfart ${O.t8} ton per ha under ${O.grans} ha åker, annars ${fmt(O.t9[0])} ton + ${O.t9[1]} ton per ha.</p>
      <p>Gränserna följer inte kommun- eller länsgränser. Kontrollera var vägen ligger på <a href="https://statistik.sjv.se/PXWeb/Resources/PX/Kartor/Produktionsomraden.html" target="_blank" rel="noopener">Jordbruksverkets karta över produktionsområden</a>. Ligger området nära en gräns, välj det område där det mesta av åkern finns.</p>
    </div>
    <label for="s-tillvOmr">Tillväxtområde för skog (tabell 10)<select id="s-tillvOmr" data-s="tillvOmr">${Object.entries(TILLV).map(([k,v])=>`<option value="${k}" ${String(S.tillvOmr)===k?"selected":""}>${esc(v)} (${PM.skog[k]} ton/ha)</option>`).join("")}</select></label>
    <label for="s-fritNiva">Fritidsbostädernas användning i området (PM 3.3.2)<select id="s-fritNiva" data-s="fritNiva">${[["intensiv","Intensiv (1 800 ton)"],["normal","Normal (900 ton)"],["lag","Låg (450 ton)"]].map(([v,l])=>`<option value="${v}" ${(S.fritNiva||"normal")===v?"selected":""}>${l}</option>`).join("")}</select></label>
    <div class="grid2">
    <label for="s-minKm">Minsta väglängd, km (PM 3.1.3)<input id="s-minKm" inputmode="decimal" data-s="minKm" value="${esc(String(S.minKm??"").replace(".",","))}"></label>
    <label for="s-minAndel">Lägsta andelstal, % (tomt = inget, PM 3.1.5)<input id="s-minAndel" inputmode="decimal" data-s="minAndel" value="${esc(String(S.minAndel??"").replace(".",","))}"></label>
    </div>
    <div id="vkn-global"></div>
    <div class="schref"><table class="tbl"><thead><tr><th>Schablon enligt Lantmäteriets PM 2025</th><th class="num">Ton per år</th><th>Avsnitt</th></tr></thead><tbody>
      ${rad("Permanentbostad, per hushåll",fmt(PM.perm),"3.2.1")}${rad("Varaktigt uthyrd komplementbostad",fmt(PM.komp),"3.2.2.2")}
      ${rad("Fritidsbostad intensiv / normal / låg",`${fmt(PM.frit.intensiv)} / ${PM.frit.normal} / ${PM.frit.lag}`,"3.3.1")}
      ${rad("Flerfamiljshus, per lägenhet",fmt(PM.lgh),"3.4.1")}${rad("Småhus i bostadsrätt eller kooperativ hyresrätt",fmt(PM.smahusbr),"3.4.2")}
      ${rad("Kombinerad bostadsfastighet 1–2 ha",fmt(PM.perm),"tabell 1")}
      ${rad("Häst, egen / inackorderad",`${PM.hastEgen} / ${fmt(PM.hastInack)}`,"tabell 5")}
      ${rad("Obebyggd fastighet",PM.obebyggd,"3.6.1")}
      ${rad("Interna transporter, per ha åker / bete",`${O.t7[0]} / ${O.t7[1]}`,"tabell 7")}
      ${rad(`Företagsutfart under ${O.grans} ha åker, per ha`,O.t8,"tabell 8")}${rad(`Företagsutfart från ${O.grans} ha åker`,`${fmt(O.t9[0])} + ${O.t9[1]}/ha`,"tabell 9")}
      ${rad("Mjölk, schablon enkelresa / tur och retur",`${fmt(PM.mjolk.enkel)} / ${fmt(PM.mjolk.tor)}`,"3.7.1.4")}${rad("Mjölkbil utan / med släp, per hämtning",`${PM.mjolkBil.utan} / ${PM.mjolkBil.slap}`,"3.7.1.4")}
      ${rad("Heltidsanställd",PM.anstalld,"3.7.1.7")}
      ${rad(`Skog, per ha (tillväxtområde ${S.tillvOmr})`,sk,"tabell 10")}${harFjall()?rad("Fjällnära skog, per ha",fjallTal(),"3.8.2"):""}
      ${rad("Skog där skogsbruk inte får bedrivas, per ha",PM.skogRestr,"3.8.2.2")}${rad("Jaktresor på sådan mark, per påbörjade 100 ha",60,"3.8.2.3")}
      ${rad("Järnväg signal / övrig","800 / 600","tabell 11")}${rad("Småbåtshamn per båtplats (nära tätort)","400 (500)","3.9.7")}
      ${rad("Teknisk anläggning, besök 1/mån, 1/14 dagar, 1/vecka, 2/vecka","500 / 600 / 800 / 1 100","tabell 14")}
      ${rad("Kluster: schablon × påbörjade femgrupper + schablon × 0,75 × övriga","","3.10.2.2")}
      ${rad("Naturreservat, skyddad natur",PM.natur,"tabell 15")}
      ${rad("Godstillägg i beräkningsmallar","25 % eller 200","6.3.3, 6.4")}
    </tbody></table>
    <table class="tbl"><thead><tr><th>Fordonsvikter vid egen beräkning</th><th class="num">Ton</th><th>Avsnitt</th></tr></thead><tbody>${VIKTER.map(([v,l])=>rad(l.replace(/ [\d,]+ ton$/,""),v.replace(".",","),"tabell 21")).join("")}</tbody></table>
    <p class="hint">Källa: Lantmäteriet, PM 2025 om tonkilometermetoden (LM2025/006319) med bilaga 1. Direktutfart: minsta väglängd och reduktionsfaktor 0,5 eller 0,3 (avsnitt 3.1.4). Schablonerna inkluderar genomsnittlig vinterväghållning (3.1.6).</p></div>`;
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
    const arr=new Set(getR(p,t.dataset.key)); t.checked?arr.add(t.dataset.seg):arr.delete(t.dataset.seg);
    setR(p,t.dataset.key,state.segments.map(g=>g.id).filter(id=>arr.has(id)));
    t.closest(".seg").classList.toggle("on",t.checked);
  } else if (t.dataset.sk){
    const [pid,sid]=t.dataset.sk.split("|"), p=state.props.find(x=>x.id===pid), s=p&&skiften(p).find(x=>x.id===sid); if(!s) return;
    s[t.dataset.skf] = t.type==="checkbox" ? t.checked : t.value;
  } else if (t.dataset.rad){
    const [pid,rid]=t.dataset.rad.split("|"), p=state.props.find(x=>x.id===pid), r=p&&rader(p).find(x=>x.id===rid); if(!r) return;
    r[t.dataset.rf] = t.type==="checkbox" ? t.checked : t.value;
    const sum=t.closest(".radpost")&&t.closest(".radpost").querySelector(".radsum"); if(sum) sum.textContent=fmt(radTon(r))+" ton";
  } else if (t.dataset.segI!==undefined){
    const g=state.segments[+t.dataset.segI]; const old=g.id; g[t.dataset.sf]=t.value;
    if (t.dataset.sf==="id") mapRoutes(r=>r.map(x=>x===old?t.value:x));
  } else if (t.dataset.s){
    state.schablon[t.dataset.s]=t.value;
  } else return;
  renderSummary(); scheduleSave();
});
/* Fält som ändrar formuläret ritar om kortet efteråt, och fokus behålls i det fält man gått vidare till. */
const OMRITA=["direkt","frit","mjolk","boxar","hastEgna","hastInack","skogHa","skogFjallHa","skogRestrHa","arealHa","akerHa","beteHa","gods","antalAnl"];
document.addEventListener("change", e=>{ const f=e.target.dataset.f; if(OMRITA.includes(f)||e.target.dataset.skf==="plats"){ setTimeout(()=>{ const a=document.activeElement, id=a&&a.id, pos=a&&a.selectionStart; renderCards(); renderSummary(); const n=id&&document.getElementById(id); if(n){ n.focus(); try{ if(pos!=null) n.setSelectionRange(pos,pos); }catch(x){} } },0); } if(["prodOmr","tillvOmr","fritNiva","utfart"].includes(e.target.dataset.s)){ renderSchablon(); renderCards(); renderSummary(); } });
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
    mapRoutes(r=>r.filter(x=>x!==g.id));
    renderAll(); scheduleSave();
  } else if (t.id==="addProp"){
    const p={id:uid(),namn:"Ny fastighet",typ:"perm",perm:1,frit:0,fritNiva:"",akerHa:0,beteHa:0,skogHa:0,route:[],skogRoute:[],skogJamn:false,fast:"",note:""};
    state.props.push(p); selected=p.id; editProp=p.id; renderCards(); renderSummary(); scheduleSave();
    const el=document.getElementById("namn-"+p.id); if(el){ el.focus(); el.select(); }
  } else if (t.dataset.addsk){
    const p=state.props.find(x=>x.id===t.dataset.addsk); if(!p) return;
    p.skiften=[...skiften(p), nyttSkifte("Skifte "+(skiften(p).length+1),0,0,skiften(p).length?"inom":"bc")]; renderCards(); renderSummary(); scheduleSave();
  } else if (t.dataset.delsk){
    const [pid,sid]=t.dataset.delsk.split("|"), p=state.props.find(x=>x.id===pid); if(!p) return;
    p.skiften=skiften(p).filter(x=>x.id!==sid); renderCards(); renderSummary(); scheduleSave();
  } else if (t.dataset.addrad){
    const p=state.props.find(x=>x.id===t.dataset.addrad); if(!p) return;
    p.rader=[...rader(p), {id:uid(),namn:"",antal:"",dagar:"",vikt:"1.5",farder:1,tor:true,gods:true}]; renderCards(); renderSummary(); scheduleSave();
    const el=document.getElementById("rnamn-"+p.rader[p.rader.length-1].id); if(el) el.focus();
  } else if (t.dataset.delrad){
    const [pid,rid]=t.dataset.delrad.split("|"), p=state.props.find(x=>x.id===pid); if(!p) return;
    p.rader=rader(p).filter(x=>x.id!==rid); renderCards(); renderSummary(); scheduleSave();
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
  const ids=new Set([...(p.route||[]),...((num(p.skogHa)>0&&p.skogRoute)||[]),...skiften(p).flatMap(s=>s.plats!=="bc"?(s.route||[]):[])]);
  return state.segments.map(g=>g.id).filter(id=>ids.has(id)).join(", ");
}
function typeText(p){
  const t=typOf(p), lab=(TYPER.find(x=>x[0]===t)||[,"Ej angiven"])[1].replace(/ \(.*\)$/,"");
  const ha=markHa(p);
  let s=lab;
  if ((t==="jord"||t==="kombi")&&num(p.perm)) s+=num(p.perm)>1?` med ${num(p.perm)} bostäder`:" med bostad";
  if (t==="jord"&&!num(p.perm)&&num(p.frit)) s+=" med fritidsbostad";
  if (t==="frit") s+=` (${NIV[fritNivaOf(p)]} användning)`;
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
    doc.setTextColor(255); doc.setFont("helvetica","normal"); doc.setFontSize(10); doc.text(pdfText(foreningOf()||"Gemensamhetsanläggning för väg"),M,13);
    doc.setFont("helvetica","bold"); doc.setFontSize(22); doc.text(pdfText("Förslag till nya andelstal"),M,25);
    doc.setFont("helvetica","normal"); doc.setFontSize(10); doc.text(pdfText("Utkast för diskussion, "+today),M,32);
    y=48;
    head("Sammanfattning");
    para("Förslaget är räknat med Lantmäteriets tonkilometermetod och schablonvärden enligt PM 2025 (LM2025/006319), på samma sätt som vid en förrättning."+(state.props.some(p=>String(p.andelNu??"").trim()!=="")?" Nuvarande andelar visas som jämförelse.":""));
    para("Stämmer inte uppgifterna om din fastighet? Hör av dig till styrelsen.");
    head("Hur andelstalen räknas");
    para("Andelen bygger på hur mycket trafik fastigheten ger och hur långt den kör på vägen ut till "+utfartOf()+". Trafiken gånger väglängden ger fastighetens belastning, och andelen är dess del av summan för alla fastigheter. Kortaste räknade väglängd är "+fmt(num(S.minKm)*1000)+" meter.");
    { const anv=new Map(); rows.forEach(r=>r.poster.forEach(x=>{ const k=x.namn.replace(/^(.*?)( \d| ×| \(|$).*/,"$1").trim(); if(!anv.has(k)) anv.set(k,x); }));
      const O=PM.omr[S.prodOmr]||PM.omr.Ss, b=[];
      const finns=t=>rows.some(r=>typOf(r.p)===t);
      if (rows.some(r=>num(r.p.perm))) b.push(["Permanentbostad",fmt(PM.perm)+" ton per hushåll"]);
      if (rows.some(r=>num(r.p.frit))) b.push(["Fritidsbostad","1 800 / 900 / 450 ton (intensiv, normal, låg användning)"]);
      if (rows.some(r=>r.poster.some(x=>x.vag==="skog"))) b.push(["Skogsbruk",skogTal()+" ton per hektar produktiv skog"]);
      if (rows.some(r=>r.poster.some(x=>x.namn.startsWith("Företagsutfart")))) b.push(["Jordbruk, företagsutfart",O.t8+" ton per hektar åker under "+O.grans+" ha, annars "+fmt(O.t9[0])+" ton plus "+O.t9[1]+" ton per hektar"]);
      if (rows.some(r=>r.poster.some(x=>x.vag.startsWith("s:")))) b.push(["Jordbruk, interna transporter",O.t7[0]+" ton per hektar åker och "+O.t7[1]+" ton per hektar bete, på sträckan mellan gården och skiftet"]);
      if (rows.some(r=>r.poster.some(x=>x.namn.includes("hästar")))) b.push(["Hästar","200 ton per egen häst, 1 100 ton per inackorderad häst"]);
      ["flerfam","smahusbr","obebyggd","teknisk","smabat","natur","jarnvag","kombi"].forEach(t=>{ if(finns(t)) b.push([(TYPER.find(x=>x[0]===t)||[,""])[1].replace(/ \(.*\)$/,""),typHjalp(t)]); });
      table(["Fastighetstyp","Trafik per år enligt Lantmäteriets schablon (PM 2025)"],b,{columnStyles:{0:{cellWidth:48}}}); }
    para("En gård med bostad räknas med både bostaden och sin mark."+(num(S.minAndel)>0?" Lägsta andel är "+fmt(num(S.minAndel),1)+" %.":""),9.5,muted);
    // map
    doc.addPage(); y=M;
    head("Vägen och delsträckorna");
    { const geo=state.segments.filter(g=>Array.isArray(g.geo)&&g.geo.length>1);
      if (geo.length && window.SWEREF){
        const P=ll=>window.SWEREF.till(ll), all=geo.flatMap(g=>g.geo.map(P));
        const minN=Math.min(...all.map(p=>p[0])), maxN=Math.max(...all.map(p=>p[0])), minE=Math.min(...all.map(p=>p[1])), maxE=Math.max(...all.map(p=>p[1]));
        const H=130, sc=Math.min(CW/Math.max(1,maxE-minE), H/Math.max(1,maxN-minN)), ox=M+(CW-(maxE-minE)*sc)/2, y0=y;
        const X=p=>ox+(p[1]-minE)*sc, Y=p=>y0+(maxN-p[0])*sc;
        const F=[[31,92,65],[180,83,9],[37,99,235],[147,51,234],[190,18,60],[15,118,110],[77,124,15],[194,65,12]];
        geo.forEach((g,i)=>{ const q=g.geo.map(P); doc.setDrawColor(...F[i%F.length]); doc.setLineWidth(1.4);
          for(let j=1;j<q.length;j++) doc.line(X(q[j-1]),Y(q[j-1]),X(q[j]),Y(q[j]));
          const m=q[Math.floor(q.length/2)], n=q[Math.max(0,Math.floor(q.length/2)-1)], mx=(X(m)+X(n))/2, my=(Y(m)+Y(n))/2;
          doc.setFillColor(255,255,255); doc.setDrawColor(...ink); doc.setLineWidth(0.2); doc.roundedRect(mx-3,my-2.6,6,4.4,1,1,"FD");
          doc.setFont("helvetica","bold"); doc.setFontSize(7.5); doc.setTextColor(...ink); doc.text(pdfText(g.id),mx,my+0.8,{align:"center"}); });
        ((state.karta&&state.karta.punkter)||[]).forEach(pt=>{ const q=P(pt.ll), u=pt.typ==="utfart"; doc.setFillColor(...(u?[124,58,237]:[31,92,65])); doc.circle(X(q),Y(q),1.3,"F");
          const p=state.props.find(x=>x.id===pt.prop); doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(...muted);
          doc.text(pdfText(u?"Utfart":pdfName(p?p.namn:"")),X(q)+2,Y(q)-1.5); });
        y=y0+(maxN-minN)*sc+8; doc.setFontSize(8); doc.setTextColor(...muted); doc.text(pdfText("Norr är uppåt. Skiss ur vägnätet i verktyget."),M,y); y+=5;
      } }
    const segTot=state.segments.reduce((s,g)=>s+num(g.m),0);
    table(["Delsträcka","Sträcka","Längd"],state.segments.map(g=>[g.id,g.namn,"cirka "+fmt(num(g.m))+" m"]).concat([["","Totalt","cirka "+fmt(segTot)+" m"]]),{columnStyles:{0:{cellWidth:24},2:{cellWidth:32,halign:"right"}}});
    para(state.segments.some(g=>g.geo)?"Längderna är mätta längs vägen på kartan i verktyget.":"Längderna är uppmätta på karta.",9,muted);
    // properties
    doc.addPage(); y=M;
    head("Fastigheterna och föreslagna andelar");
    const h1=["Fastighet","Typ","Kör på delsträcka","Väglängd","Nuvarande andel","Ny andel"].concat(showKr?["Kr per år"]:[]);
    const b1=sorted.map(r=>{
      const vl = r.fixed!==null ? "" : fmt(r.d,1)+" km";
      return [pdfName(r.p.namn),typeText(r.p),routeText(r.p),vl,String(r.p.andelNu??"").trim()!==""?fmt(num(r.p.andelNu),1)+" %":"–",fmt(r.disp,1)+" %"].concat(showKr?[fmt(Math.round(r.kr))]:[]);
    });
    b1.push(["Totalt","","","","100 %",fmt(rows.reduce((s,r)=>s+r.disp,0),1)+" %"].concat(showKr?[fmt(Math.round(rows.reduce((s,r)=>s+r.kr,0)))]:[]));
    table(h1,b1,{styles:{font:"helvetica",fontSize:8.5,cellPadding:1.6,textColor:ink,lineColor:[214,220,212],lineWidth:0.2},columnStyles:{0:{cellWidth:30,fontStyle:"bold"},3:{halign:"right",cellWidth:24},4:{halign:"right",cellWidth:17},5:{halign:"right",fontStyle:"bold",cellWidth:17},6:{halign:"right"}},didParseCell:d=>{ if(d.section==="body"&&d.row.index===b1.length-1){ d.cell.styles.fontStyle="bold"; } }});
    if (showKr) para("Kronorna visar hur "+fmt(num(S.utdebitering))+" kr per år fördelas enligt de nya andelarna.",9,muted);
    head("Underlag");
    ["Beräkningen följer Lantmäteriets tonkilometermetod och dess schablonvärden.",
     "Nya andelstal kan bestämmas vid en lantmäteriförrättning eller, där det är tillåtet, genom en överenskommelse mellan delägarna."].forEach(t=>para("•  "+t,9.5,ink,1.2));
    const pages=doc.getNumberOfPages();
    for(let i=1;i<=pages;i++){ doc.setPage(i); doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...muted); doc.text(pdfText((foreningOf()?foreningOf()+" · ":"")+"Förslag till nya andelstal · sida "+i+" av "+pages),M,292); }
    const blob=doc.output("blob");
    const dl=await claude.use("downloads");
    if (!dl) throw {code:"unavailable"};
    await dl.save({filename:"Förslag nya andelstal"+(foreningOf()?" "+foreningOf():"")+".pdf",data:blob});
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
  state = normalisera(Object.assign(structuredClone(DEFAULT), data, {schablon:Object.assign({},DEFAULT.schablon,data.schablon||{})}));
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
