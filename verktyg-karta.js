/* Karta i andelstalsverktyget.
   Man ritar vägen som linjer, sätter ut utfarter till allmän väg och fastigheternas anslutningspunkter.
   Av det byggs ett vägnät. Verktyget räknar fram delsträckor (mellan korsningar, ändar och punkter),
   deras längder och vilka delsträckor varje fastighet kör på till närmaste utfart.
   Data sparas i state.karta = {vagar:[{id,pts:[[lat,lng],…]}], punkter:[{id,typ,prop,galler,ll:[lat,lng]}]}. */
(function(){
"use strict";
if (!window.L) return;
const KS=()=>{ if(!state.karta||typeof state.karta!=="object") state.karta={}; const k=state.karta; if(!Array.isArray(k.vagar)) k.vagar=[]; if(!Array.isArray(k.punkter)) k.punkter=[]; return k; };
const R=6371008.8, rad=x=>x*Math.PI/180;
const r6=x=>Math.round(x*1e6)/1e6;
function hav(a,b){ const dLat=rad(b[0]-a[0]), dLng=rad(b[1]-a[1]); const s=Math.sin(dLat/2)**2+Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(dLng/2)**2; return 2*R*Math.asin(Math.min(1,Math.sqrt(s))); }
/* Närmaste punkt på sträckan a–b, i meter i ett lokalt plan. */
function proj(p,a,b){
  const c=Math.cos(rad(p[0])), X=q=>[(q[1]-p[1])*c*111320,(q[0]-p[0])*110574];
  const A=X(a), B=X(b), dx=B[0]-A[0], dy=B[1]-A[1], L2=dx*dx+dy*dy;
  let t=L2 ? -(A[0]*dx+A[1]*dy)/L2 : 0; t=Math.max(0,Math.min(1,t));
  return {t, d:Math.hypot(A[0]+t*dx, A[1]+t*dy), pt:[a[0]+t*(b[0]-a[0]), a[1]+t*(b[1]-a[1])]};
}

/* ---------- SWEREF 99 TM <-> WGS 84 (Lantmäteriets formler för Gauss–Krüger) ---------- */
const GK=(()=>{ const a=6378137, f=1/298.257222101, k0=0.9996, l0=rad(15), FE=500000;
  const e2=f*(2-f), n=f/(2-f), ar=a/(1+n)*(1+n*n/4+n**4/64);
  const A=e2, B=(5*e2**2-e2**3)/6, C=(104*e2**3-45*e2**4)/120, D=1237*e2**4/1260;
  const b1=n/2-2*n*n/3+5*n**3/16+41*n**4/180, b2=13*n*n/48-3*n**3/5+557*n**4/1440, b3=61*n**3/240-103*n**4/140, b4=49561*n**4/161280;
  const d1=n/2-2*n*n/3+37*n**3/96-n**4/360, d2=n*n/48+n**3/15-437*n**4/1440, d3=17*n**3/480-37*n**4/840, d4=4397*n**4/161280;
  const As=e2+e2**2+e2**3+e2**4, Bs=-(7*e2**2+17*e2**3+30*e2**4)/6, Cs=(224*e2**3+889*e2**4)/120, Ds=-4279*e2**4/1260;
  return {
    till([lat,lng]){ const p=rad(lat), s=Math.sin(p)**2;
      const ps=p-Math.sin(p)*Math.cos(p)*(A+B*s+C*s*s+D*s**3), dl=rad(lng)-l0;
      const xi=Math.atan(Math.tan(ps)/Math.cos(dl)), et=Math.atanh(Math.cos(ps)*Math.sin(dl));
      const N=k0*ar*(xi+b1*Math.sin(2*xi)*Math.cosh(2*et)+b2*Math.sin(4*xi)*Math.cosh(4*et)+b3*Math.sin(6*xi)*Math.cosh(6*et)+b4*Math.sin(8*xi)*Math.cosh(8*et));
      const E=k0*ar*(et+b1*Math.cos(2*xi)*Math.sinh(2*et)+b2*Math.cos(4*xi)*Math.sinh(4*et)+b3*Math.cos(6*xi)*Math.sinh(6*et)+b4*Math.cos(8*xi)*Math.sinh(8*et))+FE;
      return [N,E]; },
    fran([N,E]){ const xi=N/(k0*ar), et=(E-FE)/(k0*ar);
      const xp=xi-d1*Math.sin(2*xi)*Math.cosh(2*et)-d2*Math.sin(4*xi)*Math.cosh(4*et)-d3*Math.sin(6*xi)*Math.cosh(6*et)-d4*Math.sin(8*xi)*Math.cosh(8*et);
      const ep=et-d1*Math.cos(2*xi)*Math.sinh(2*et)-d2*Math.cos(4*xi)*Math.sinh(4*et)-d3*Math.cos(6*xi)*Math.sinh(6*et)-d4*Math.cos(8*xi)*Math.sinh(8*et);
      const ps=Math.asin(Math.sin(xp)/Math.cosh(ep)), dl=Math.atan(Math.sinh(ep)/Math.cos(xp)), s=Math.sin(ps)**2;
      const p=ps+Math.sin(ps)*Math.cos(ps)*(As+Bs*s+Cs*s*s+Ds*s**3);
      return [p*180/Math.PI, (l0+dl)*180/Math.PI]; } };
})();
window.SWEREF=GK;
const swText=ll=>{ const [N,E]=GK.till(ll); return `N ${fmt(Math.round(N))}, E ${fmt(Math.round(E))}`; };
/* Tolkar "59,12345 16,54321", "59.12345, 16.54321" eller SWEREF 99 TM "6555123 598765" (N först). */
function lasKoordinat(t){
  const s=String(t||"").replace(/[NnEeÖö:=]/g," ").trim();
  let m=s.match(/^(-?\d+(?:[.,]\d+)?)\s*[;,\s]\s*(-?\d+(?:[.,]\d+)?)$/); if(!m) return null;
  let a=parseFloat(m[1].replace(",",".")), b=parseFloat(m[2].replace(",","."));
  if (a>1e6 && b>1e5 && b<1e6) return GK.fran([a,b]);
  if (b>1e6 && a>1e5 && a<1e6) return GK.fran([b,a]);
  if (Math.abs(a)<=90 && Math.abs(b)<=180) return [a,b];
  return null;
}

/* ---------- vägnät ---------- */
const pnamn=id=>{ const p=state.props.find(x=>x.id===id); return p ? (p.namn||"Namnlös") : "Okänd fastighet"; };
function gallerText(pt){
  if (pt.typ==="utfart") return "Utfart till "+utfartOf();
  const p=state.props.find(x=>x.id===pt.prop); const g=pt.galler||"route";
  if (g==="route") return pnamn(pt.prop)+(p&&typOf(p)==="jord"?": gården (bostad och företagsutfart)":": anslutning");
  if (g==="skog") return pnamn(pt.prop)+": skogen";
  if (g.startsWith("sk:")){ const s=p&&skiften(p).find(x=>x.id===g.slice(3)); return pnamn(pt.prop)+": "+(s?(s.namn||"skifte"):"skifte"); }
  return pnamn(pt.prop);
}
function natverk(){
  const k=KS(), N=[]; let E=[];
  const nod=ll=>{ for(const n of N) if(hav(n.ll,ll)<2) return n; const n={id:N.length,ll,tags:[]}; N.push(n); return n; };
  k.vagar.forEach(v=>{ const p=v.pts||[]; for(let i=0;i+1<p.length;i++){ const a=nod(p[i]), b=nod(p[i+1]); if(a!==b) E.push({a,b,len:hav(a.ll,b.ll)}); } });
  const pnod=new Map(), avst=new Map();
  k.punkter.forEach(pt=>{
    let best=null; E.forEach(e=>{ const r=proj(pt.ll,e.a.ll,e.b.ll); if(!best||r.d<best.r.d) best={e,r}; });
    if (!best) return;
    const {e,r}=best, da=r.t*e.len, db=(1-r.t)*e.len; let n;
    if (da<1) n=e.a; else if (db<1) n=e.b;
    else { n={id:N.length,ll:r.pt,tags:[]}; N.push(n); E=E.filter(x=>x!==e); E.push({a:e.a,b:n,len:hav(e.a.ll,n.ll)},{a:n,b:e.b,len:hav(n.ll,e.b.ll)}); }
    n.tags.push(pt); pnod.set(pt.id,n); avst.set(pt.id,r.d);
  });
  N.forEach(n=>n.e=[]); E.forEach(e=>{ e.a.e.push(e); e.b.e.push(e); });
  return {N,E,pnod,avst};
}
function dijkstra(G,starts){
  const dist=new Map(), prev=new Map(), Q=new Set(G.N);
  G.N.forEach(n=>dist.set(n,Infinity)); starts.forEach(s=>dist.set(s,0));
  while(Q.size){ let u=null; for(const n of Q) if(u===null||dist.get(n)<dist.get(u)) u=n;
    if (dist.get(u)===Infinity) break; Q.delete(u);
    u.e.forEach(e=>{ const v=e.a===u?e.b:e.a, nd=dist.get(u)+e.len; if(nd<dist.get(v)-1e-9){ dist.set(v,nd); prev.set(v,e); } }); }
  return {dist,prev};
}
function vagTill(D,n){ const es=[]; let x=n, g=0; while(D.prev.has(x)&&g++<100000){ const e=D.prev.get(x); es.push(e); x=e.a===x?e.b:e.a; } return es; }
function kedjor(G){
  const viktig=n=>n.e.length!==2||n.tags.length>0, sett=new Set(), K=[];
  const walk=(start,e0)=>{ const es=[e0]; sett.add(e0); let prevE=e0, cur=e0.a===start?e0.b:e0.a; const nodes=[start,cur];
    while(!viktig(cur)&&cur!==start){ const nx=cur.e.find(e=>e!==prevE); if(!nx||sett.has(nx)) break; es.push(nx); sett.add(nx); prevE=nx; cur=nx.a===cur?nx.b:nx.a; nodes.push(cur); }
    return {es,from:start,to:cur,nodes,len:es.reduce((s,e)=>s+e.len,0)}; };
  G.N.filter(viktig).forEach(n=>n.e.forEach(e=>{ if(!sett.has(e)) K.push(walk(n,e)); }));
  G.E.forEach(e=>{ if(!sett.has(e)) K.push(walk(e.a,e)); });
  return K;
}
const BOKST="ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const kedjeId=i=>i<26 ? BOKST[i] : BOKST[i%26]+(Math.floor(i/26)+1);
/* Förslag på delsträckor och vägval utifrån kartan. Ändrar inget förrän det tillämpas. */
function forslag(){
  const k=KS();
  if (!k.vagar.length) return {fel:"Rita vägen först."};
  const G=natverk(), utf=k.punkter.filter(p=>p.typ==="utfart").map(p=>G.pnod.get(p.id)).filter(Boolean);
  if (!utf.length) return {fel:"Sätt ut minst en utfart till allmän väg."};
  const D=dijkstra(G,utf), slut=n=>n.e.length===1&&!n.tags.length;
  /* Korta stumpar efter sista punkten (under 10 m) är ritfel och tas inte med. */
  const K=kedjor(G).filter(c=>!(c.len<10&&(slut(c.from)||slut(c.to))));
  const dn=n=>D.dist.get(n);
  K.forEach(c=>{ c.d=Math.min(dn(c.from),dn(c.to)); });
  K.sort((a,b)=>(a.d-b.d)||(b.len-a.len));
  const avEdge=new Map(); K.forEach((c,i)=>{ c.id=kedjeId(i); c.es.forEach(e=>avEdge.set(e,c)); });
  const lbl=n=>{ const t=n.tags; if(t.some(x=>x.typ==="utfart")) return "utfarten"; if(t.length) return [...new Set(t.map(x=>pnamn(x.prop)))].join(", "); if(n.e.length>=3) return "korsning"; if(n.e.length===1) return "vägände"; return "punkt"; };
  const segs=K.map(c=>{
    const near=dn(c.from)<=dn(c.to)?c.from:c.to, far=near===c.from?c.to:c.from, e=D.prev.get(near);
    return {id:c.id, namn:`${lbl(far)} – ${lbl(near)}`, m:Math.round(c.len), mot:e?avEdge.get(e).id:"", geo:c.nodes.map(n=>[r6(n.ll[0]),r6(n.ll[1])]), nas:isFinite(c.d)};
  });
  const tillIds=es=>{ const s=new Set(es.map(e=>avEdge.get(e).id)); return segs.map(g=>g.id).filter(id=>s.has(id)); };
  const routes=new Map(), varn=[];
  k.punkter.forEach(pt=>{ if(pt.typ==="utfart") return; const p=state.props.find(x=>x.id===pt.prop); if(!p){ return; }
    const n=G.pnod.get(pt.id); if(!n) return;
    const g=pt.galler||"route", r=routes.get(p.id)||{}; routes.set(p.id,r);
    if (g==="route"||g==="skog"){ if(!isFinite(dn(n))) varn.push(`${gallerText(pt)}: punkten har ingen väg till någon utfart.`); r[g]=tillIds(vagTill(D,n)); }
    else if (g.startsWith("sk:")){ r[g]=n; } });
  routes.forEach((r,pid)=>{ Object.keys(r).filter(g=>g.startsWith("sk:")).forEach(g=>{
    const gard=k.punkter.find(x=>x.prop===pid&&(x.galler||"route")==="route"), gn=gard&&G.pnod.get(gard.id);
    if (!gn){ varn.push(`${pnamn(pid)}: sätt ut gårdens anslutning för att kunna räkna transporterna till skiftena.`); r[g]=null; return; }
    const D2=dijkstra(G,[gn]); r[g]=isFinite(D2.dist.get(r[g]))?tillIds(vagTill(D2,r[g])):null; }); });
  if (segs.some(s=>!s.nas)) varn.push("Någon del av vägen hänger inte ihop med en utfart. Kontrollera att linjerna möts i korsningarna.");
  G.avst.forEach((d,id)=>{ if(d>40){ const pt=k.punkter.find(x=>x.id===id); varn.push(`${gallerText(pt)} ligger ${fmt(Math.round(d))} m från närmaste väg.`); } });
  state.props.forEach(p=>{ if(typOf(p)!=="annan"&&!(routes.get(p.id)||{}).route&&!p.direkt) varn.push(`${p.namn||"Namnlös"} har ingen anslutningspunkt och får ingen väglängd.`); });
  return {segs, routes, varn};
}
function tillampa(f){
  state.segments=f.segs.map(({id,namn,m,mot,geo})=>({id,namn,m,mot,geo}));
  state.props.forEach(p=>{ const r=f.routes.get(p.id)||{};
    p.route=r.route||[]; p.skogRoute=r.skog||[];
    skiften(p).forEach(s=>{ const v=r["sk:"+s.id]; s.route=v||[]; });
    delete p.inreRoute; });
  scheduleSave(); renderAll();
}

/* ---------- karta ---------- */
let map=null, lager=null, lagerHl=null, mode="visa", ritar=null, valtVisa="", sistaForslag=null;
const FARG=["#1f5c41","#b45309","#2563eb","#9333ea","#be123c","#0f766e","#4d7c0f","#c2410c","#4338ca","#a16207"];
const ikon=(cls,txt)=>L.divIcon({className:"kpunkt "+cls, html:`<span>${esc(txt)}</span>`, iconSize:null});
function initKarta(){
  if (map) { map.invalidateSize(); return; }
  const el=document.getElementById("karta"); if(!el||el.offsetParent===null) return;
  map=L.map(el,{zoomControl:true, doubleClickZoom:true});
  const osm=L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap-bidragsgivare</a>'});
  const topo=L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",{maxZoom:17,subdomains:"abc",attribution:'Karta: © <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA), data © OpenStreetMap-bidragsgivare'});
  osm.addTo(map); L.control.layers({"Vägkarta":osm,"Terrängkarta":topo},null,{position:"topright"}).addTo(map);
  L.control.scale({imperial:false}).addTo(map);
  lager=L.layerGroup().addTo(map); lagerHl=L.layerGroup().addTo(map);
  map.on("click",klick); map.on("dblclick",e=>{ if(mode==="vag"&&ritar){ const last=ritar.pts[ritar.pts.length-1]; if(map.latLngToContainerPoint(e.latlng).distanceTo(map.latLngToContainerPoint(last))<15) avslutaLinje(); } });
  passa(); rita();
}
function passa(){ const k=KS(), b=L.latLngBounds([]);
  k.vagar.forEach(v=>(v.pts||[]).forEach(p=>b.extend(p))); k.punkter.forEach(p=>b.extend(p.ll)); state.segments.forEach(g=>(g.geo||[]).forEach(p=>b.extend(p)));
  if (b.isValid()) map.fitBounds(b.pad(0.15),{maxZoom:17}); else map.setView([62.5,16],5); }
function snap(latlng){
  const k=KS(), P=map.latLngToContainerPoint(latlng); let best=null;
  k.vagar.forEach(v=>(v.pts||[]).forEach(p=>{ const d=P.distanceTo(map.latLngToContainerPoint(p)); if(d<14&&(!best||d<best.d)) best={d,ll:p,typ:"hörn"}; }));
  if (ritar) ritar.pts.forEach(p=>{ const d=P.distanceTo(map.latLngToContainerPoint(p)); if(d<14&&(!best||d<best.d)) best={d,ll:p,typ:"hörn"}; });
  if (best) return best;
  k.vagar.forEach(v=>{ const p=v.pts||[]; for(let i=0;i+1<p.length;i++){ const r=proj([latlng.lat,latlng.lng],p[i],p[i+1]); const d=P.distanceTo(map.latLngToContainerPoint(r.pt)); if(d<14&&(!best||d<best.d)) best={d,ll:r.pt,typ:"linje",v,i}; } });
  return best;
}
function klick(e){
  if (readOnly) return;
  const ll=[r6(e.latlng.lat),r6(e.latlng.lng)];
  if (mode==="vag"){
    const s=snap(e.latlng); let p=ll;
    if (s){ p=[r6(s.ll[0]),r6(s.ll[1])]; if(s.typ==="linje"){ s.v.pts.splice(s.i+1,0,p); } }
    if (!ritar){ ritar={id:uid(),pts:[p]}; } else { const last=ritar.pts[ritar.pts.length-1]; if(hav(last,p)<0.5) return; ritar.pts.push(p); }
    rita(); return;
  }
  if (mode==="punkt"){
    const val=$("#kartPunktVal").value; if(!val){ hjalp("Välj först vad punkten gäller."); return; }
    satPunkt(val, ll); return;
  }
}
function satPunkt(val,ll){
  const k=KS(); let pt;
  if (val==="utfart") pt={id:uid(),typ:"utfart",ll};
  else { const [prop,galler]=val.split("|"); k.punkter=k.punkter.filter(x=>!(x.prop===prop&&(x.galler||"route")===galler)); pt={id:uid(),typ:"anslutning",prop,galler,ll}; }
  /* Lägg punkten på närmaste väg om den ligger nära. */
  let best=null; k.vagar.forEach(v=>{ const p=v.pts||[]; for(let i=0;i+1<p.length;i++){ const r=proj(ll,p[i],p[i+1]); if(!best||r.d<best.d) best=r; } });
  if (best&&best.d<60) pt.ll=[r6(best.pt[0]),r6(best.pt[1])];
  k.punkter.push(pt); scheduleSave(); rita(); renderLista();
  const sel=$("#kartPunktVal"); if(sel&&val!=="utfart"){ const i=sel.selectedIndex; if(i+1<sel.options.length) sel.selectedIndex=i+1; }
}
function avslutaLinje(){
  if (ritar && ritar.pts.length>=2){ KS().vagar.push(ritar); scheduleSave(); }
  ritar=null; rita(); renderLista();
}
function hjalp(t){ const h=$("#kartHjalp"); if(h) h.textContent=t; }
const HJALP={
  visa:"Tryck på en punkt eller delsträcka för att se uppgifter. Välj en fastighet nedanför kartan för att se vilken väg den kör.",
  vag:"Tryck längs vägen för att rita den. Börja eller sluta på en befintlig linje så hänger vägnätet ihop i korsningarna. Dubbeltryck eller tryck Klar när linjen är färdig. Rita varje gren som en egen linje.",
  punkt:"Välj vad punkten gäller och tryck där fastigheten ansluter till vägen. Punkten läggs på närmaste väg. Nästa val i listan väljs automatiskt.",
  flytta:"Dra i punkter och i vägens hörn för att flytta dem.",
  radera:"Tryck på en punkt, ett hörn eller en väglinje för att ta bort den."
};
function satMode(m){
  if (mode==="vag"&&m!=="vag") avslutaLinje();
  mode=m; document.querySelectorAll("[data-km]").forEach(b=>b.classList.toggle("on",b.dataset.km===m));
  const pv=document.getElementById("kartPunktRad"); if(pv) pv.hidden=m!=="punkt";
  const kl=document.getElementById("kartKlar"); if(kl) kl.hidden=m!=="vag";
  if (map){ (m==="vag"||m==="punkt")?map.doubleClickZoom.disable():map.doubleClickZoom.enable(); map.getContainer().classList.toggle("ritlage",m==="vag"||m==="punkt"); }
  hjalp(HJALP[m]||""); rita();
}
function rita(){
  if (!map) return; lager.clearLayers(); lagerHl.clearLayers();
  const k=KS(), harGeo=state.segments.some(g=>g.geo&&g.geo.length>1);
  /* Delsträckor från senaste beräkningen, annars de ritade linjerna. */
  if (harGeo && mode!=="vag" && mode!=="flytta" && mode!=="radera"){
    state.segments.forEach((g,i)=>{ if(!g.geo||g.geo.length<2) return;
      const l=L.polyline(g.geo,{color:FARG[i%FARG.length],weight:6,opacity:.85}).addTo(lager);
      l.bindTooltip(esc(g.id),{permanent:true,direction:"center",className:"kseg"});
      l.bindPopup(`<b>${esc(g.id)}</b> ${esc(g.namn||"")}<br>${fmt(num(g.m))} m`); });
  } else {
    k.vagar.forEach(v=>{ const l=L.polyline(v.pts,{color:"#475569",weight:5,opacity:.8}).addTo(lager);
      if (mode==="radera") l.on("click",ev=>{ L.DomEvent.stop(ev); if(confirm("Ta bort den här väglinjen?")){ k.vagar=k.vagar.filter(x=>x!==v); scheduleSave(); rita(); renderLista(); } }); });
  }
  if (ritar){ L.polyline(ritar.pts,{color:"#dc2626",weight:4,dashArray:"6 6"}).addTo(lager); ritar.pts.forEach(p=>L.circleMarker(p,{radius:4,color:"#dc2626"}).addTo(lager)); }
  if (mode==="flytta"||mode==="radera"){
    const sett=new Set();
    k.vagar.forEach(v=>(v.pts||[]).forEach((p,i)=>{ const key=p.join(","); if(sett.has(key)) return; sett.add(key);
      const m=L.marker(p,{icon:L.divIcon({className:"khorn",iconSize:[14,14]}),draggable:mode==="flytta"}).addTo(lager);
      m.on("dragend",()=>{ const q=m.getLatLng(), np=[r6(q.lat),r6(q.lng)]; k.vagar.forEach(w=>{ w.pts=w.pts.map(x=>x.join(",")===key?np:x); }); scheduleSave(); rita(); renderLista(); });
      if (mode==="radera") m.on("click",()=>{ k.vagar.forEach(w=>{ w.pts=w.pts.filter(x=>x.join(",")!==key); }); k.vagar=k.vagar.filter(w=>w.pts.length>=2); scheduleSave(); rita(); renderLista(); }); }));
  }
  k.punkter.forEach(pt=>{
    const ut=pt.typ==="utfart", g=pt.galler||"route";
    const cls=ut?"utfart":g==="skog"?"skog":g.startsWith("sk:")?"skifte":"ansl";
    const txt=ut?"Utfart":pnamn(pt.prop)+(g==="skog"?" skog":g.startsWith("sk:")?" skifte":"");
    const m=L.marker(pt.ll,{icon:ikon(cls,txt),draggable:mode==="flytta"&&!readOnly,zIndexOffset:ut?1000:500}).addTo(lager);
    m.bindPopup(()=>`<b>${esc(gallerText(pt))}</b><br>${esc(swText(pt.ll))} (SWEREF 99 TM)<br>${fmt(pt.ll[0],5)}, ${fmt(pt.ll[1],5)} (WGS 84)${avstText(pt)}`);
    m.on("dragend",()=>{ const q=m.getLatLng(); pt.ll=[r6(q.lat),r6(q.lng)]; scheduleSave(); renderLista(); });
    if (mode==="radera") m.on("click",()=>{ KS().punkter=KS().punkter.filter(x=>x!==pt); scheduleSave(); rita(); renderLista(); });
  });
  visaVag();
}
let natCache=null;
function avstand(){ if(natCache) return natCache; const G=natverk(), utf=KS().punkter.filter(p=>p.typ==="utfart").map(p=>G.pnod.get(p.id)).filter(Boolean); natCache={G,D:utf.length?dijkstra(G,utf):null}; setTimeout(()=>natCache=null,0); return natCache; }
function avstText(pt){ const {G,D}=avstand(), n=G.pnod.get(pt.id); if(!n||!D||pt.typ==="utfart") return ""; const d=D.dist.get(n); return isFinite(d)?`<br>${fmt(d/1000,3)} km längs vägen till utfarten`:"<br>Ingen väg till någon utfart"; }
function visaVag(){
  if (!map) return; lagerHl.clearLayers(); if(!valtVisa) return;
  const p=state.props.find(x=>x.id===valtVisa); if(!p) return;
  const ids=new Set([...(p.route||[]),...(p.skogRoute||[])]);
  state.segments.forEach(g=>{ if(ids.has(g.id)&&g.geo) L.polyline(g.geo,{color:"#facc15",weight:12,opacity:.6}).addTo(lagerHl); });
  skiften(p).forEach(s=>(s.route||[]).forEach(id=>{ const g=state.segments.find(x=>x.id===id); if(g&&g.geo) L.polyline(g.geo,{color:"#22c55e",weight:12,opacity:.45}).addTo(lagerHl); }));
}
function punktVal(){
  const o=[`<option value="">Välj vad punkten gäller …</option>`,`<option value="utfart">Utfart till ${esc(utfartOf())}</option>`];
  [...state.props].sort((a,b)=>String(a.namn).localeCompare(String(b.namn),"sv")).forEach(p=>{ const t=typOf(p); if(t==="annan") return;
    o.push(`<option value="${p.id}|route">${esc(p.namn||"Namnlös")}${t==="jord"?": gården":""}</option>`);
    if (["kombi","jord","skog"].includes(t)&&t!=="skog") o.push(`<option value="${p.id}|skog">${esc(p.namn||"Namnlös")}: skogen (om den nås en annan väg)</option>`);
    if (t==="jord") skiften(p).filter(s=>s.plats&&s.plats!=="bc").forEach(s=>o.push(`<option value="${p.id}|sk:${s.id}">${esc(p.namn||"Namnlös")}: ${esc(s.namn||"skifte")}</option>`)); });
  return o.join("");
}
function renderLista(){
  const el=document.getElementById("kartLista"); if(!el) return;
  const k=KS(), {G,D}=avstand();
  const sel=document.getElementById("kartPunktVal"); if(sel){ const v=sel.value; sel.innerHTML=punktVal(); sel.value=v; }
  const vs=document.getElementById("kartVisa"); if(vs){ vs.innerHTML=`<option value="">Ingen</option>`+[...state.props].sort((a,b)=>String(a.namn).localeCompare(String(b.namn),"sv")).map(p=>`<option value="${p.id}">${esc(p.namn||"Namnlös")}</option>`).join(""); vs.value=valtVisa; }
  const totM=k.vagar.reduce((s,v)=>s+(v.pts||[]).reduce((t,p,i,a)=>i?t+hav(a[i-1],p):t,0),0);
  const rader=k.punkter.map(pt=>{ const n=G.pnod.get(pt.id), d=n&&D?D.dist.get(n):NaN;
    return `<li><div><b>${esc(gallerText(pt))}</b><small>${esc(swText(pt.ll))}${pt.typ!=="utfart"?(isFinite(d)?` · ${fmt(d/1000,3)} km till utfarten`:" · ingen väg till utfart"):""}</small></div>
      <span class="row"><button type="button" class="ghost small" data-kvisa="${pt.id}">Visa</button>${readOnly?"":`<button type="button" class="ghost small admin" data-kdel="${pt.id}">Ta bort</button>`}</span></li>`; });
  const saknar=state.props.filter(p=>typOf(p)!=="annan"&&!k.punkter.some(x=>x.prop===p.id&&(x.galler||"route")==="route"));
  el.innerHTML=`<p class="hint">Ritad väg ${fmt(Math.round(totM))} m i ${k.vagar.length} ${k.vagar.length===1?"linje":"linjer"}. ${k.punkter.filter(p=>p.typ==="utfart").length} utfart, ${k.punkter.filter(p=>p.typ!=="utfart").length} anslutningspunkter.</p>
    ${saknar.length&&!readOnly?`<p class="notice">Saknar anslutningspunkt: ${esc(saknar.map(p=>p.namn||"Namnlös").join(", "))}.</p>`:""}
    ${rader.length?`<ul class="kpunkter">${rader.join("")}</ul>`:""}`;
}
function renderForslag(f){
  const el=document.getElementById("kartForslag"); if(!el) return;
  if (!f){ el.innerHTML=""; return; }
  if (f.fel){ el.innerHTML=`<p class="notice">${esc(f.fel)}</p>`; return; }
  const km=ids=>(ids||[]).reduce((s,id)=>{ const g=f.segs.find(x=>x.id===id); return s+(g?g.m:0); },0)/1000;
  const rows=state.props.filter(p=>typOf(p)!=="annan").map(p=>{ const r=f.routes.get(p.id)||{};
    return `<tr><td>${esc(p.namn||"Namnlös")}</td><td class="num">${fmt(segKm(p.route),3)} km</td><td class="num"><b>${fmt(km(r.route),3)} km</b></td><td>${esc((r.route||[]).join(", "))}</td></tr>`; }).join("");
  el.innerHTML=`<div class="panel kforslag"><h3>Förslag från kartan</h3>
    <p class="hint">${f.segs.length} delsträckor, sammanlagt ${fmt(f.segs.reduce((s,g)=>s+g.m,0))} m. A ligger närmast utfarten. Längderna är mätta längs de ritade linjerna.</p>
    ${f.varn.map(v=>`<p class="notice">${esc(v)}</p>`).join("")}
    <div class="scroll"><table class="tbl"><thead><tr><th>Fastighet</th><th class="num">Väglängd nu</th><th class="num">Enligt kartan</th><th>Delsträckor</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="scroll"><table class="tbl"><thead><tr><th>Delsträcka</th><th>Mellan</th><th class="num">Meter</th></tr></thead><tbody>${f.segs.map(g=>`<tr><td>${esc(g.id)}</td><td>${esc(g.namn)}</td><td class="num">${fmt(g.m)}</td></tr>`).join("")}</tbody></table></div>
    <p class="hint">När du använder förslaget ersätts delsträckorna och fastigheternas vägval. Skogens och skiftenas vägar räknas också fram om de har egna punkter.</p>
    <div class="row"><button type="button" id="kartTillampa">Använd förslaget</button><button type="button" class="ghost" id="kartAvbryt">Avbryt</button></div></div>`;
}
async function exportera(){
  const k=KS(), fs=[];
  k.vagar.forEach(v=>fs.push({type:"Feature",geometry:{type:"LineString",coordinates:v.pts.map(p=>[p[1],p[0]])},properties:{typ:"väg"}}));
  k.punkter.forEach(pt=>fs.push({type:"Feature",geometry:{type:"Point",coordinates:[pt.ll[1],pt.ll[0]]},properties:{typ:pt.typ,fastighet:pt.prop?pnamn(pt.prop):"",galler:pt.galler||"",beskrivning:gallerText(pt)}}));
  state.segments.forEach(g=>{ if(g.geo) fs.push({type:"Feature",geometry:{type:"LineString",coordinates:g.geo.map(p=>[p[1],p[0]])},properties:{typ:"delsträcka",id:g.id,namn:g.namn,meter:num(g.m)}}); });
  const blob=new Blob([JSON.stringify({type:"FeatureCollection",features:fs},null,1)],{type:"application/geo+json"});
  const dl=await claude.use("downloads"); if(dl) await dl.save({filename:"vagnat.geojson",data:blob});
}
function importera(text){
  let gj; try{ gj=JSON.parse(text); }catch(e){ setStatus("Filen är inte GeoJSON.",true); return; }
  const fs=gj.type==="FeatureCollection"?gj.features:(gj.type==="Feature"?[gj]:[]); const k=KS(); let nv=0, np=0, ej=0;
  const flip=c=>{ let [x,y]=c; if (x>1e5) { const ll=GK.fran([y,x]); return [r6(ll[0]),r6(ll[1])]; } return [r6(y),r6(x)]; };
  fs.forEach(f=>{ const g=f&&f.geometry, pr=(f&&f.properties)||{}; if(!g) return;
    const linjer=g.type==="LineString"?[g.coordinates]:g.type==="MultiLineString"?g.coordinates:[];
    if (linjer.length && pr.typ!=="delsträcka"){ linjer.forEach(c=>{ if(c.length>=2){ k.vagar.push({id:uid(),pts:c.map(flip)}); nv++; } }); return; }
    if (g.type==="Point"){ const ll=flip(g.coordinates);
      if (String(pr.typ||"").toLowerCase()==="utfart"){ k.punkter.push({id:uid(),typ:"utfart",ll}); np++; return; }
      const namn=String(pr.fastighet||pr.namn||pr.name||"").trim(), p=state.props.find(x=>String(x.namn).trim().toLowerCase()===namn.toLowerCase());
      if (p){ const galler=pr.galler||"route"; k.punkter=k.punkter.filter(x=>!(x.prop===p.id&&(x.galler||"route")===galler)); k.punkter.push({id:uid(),typ:"anslutning",prop:p.id,galler,ll}); np++; } else ej++; } });
  scheduleSave(); rita(); passa(); renderLista();
  setStatus(`Inläst: ${nv} väglinjer och ${np} punkter${ej?`, ${ej} punkter utan känd fastighet hoppades över`:""}.`, !!ej);
}

/* ---------- händelser ---------- */
document.addEventListener("click",e=>{
  const b=e.target.closest("button"); if(!b) return;
  if (b.dataset.km){ satMode(mode===b.dataset.km?"visa":b.dataset.km); return; }
  if (b.id==="kartKlarBtn"){ avslutaLinje(); return; }
  if (b.id==="kartAngra"){ if(ritar){ ritar.pts.pop(); if(!ritar.pts.length) ritar=null; rita(); } return; }
  if (b.dataset.kvisa){ const pt=KS().punkter.find(x=>x.id===b.dataset.kvisa); if(pt&&map){ map.setView(pt.ll,Math.max(map.getZoom(),16)); document.getElementById("karta").scrollIntoView({behavior:"smooth",block:"center"}); } return; }
  if (b.dataset.kdel){ KS().punkter=KS().punkter.filter(x=>x.id!==b.dataset.kdel); scheduleSave(); rita(); renderLista(); return; }
  if (b.id==="kartBerakna"){ sistaForslag=forslag(); renderForslag(sistaForslag); document.getElementById("kartForslag").scrollIntoView({behavior:"smooth",block:"start"}); return; }
  if (b.id==="kartTillampa"&&sistaForslag&&!sistaForslag.fel){ tillampa(sistaForslag); sistaForslag=null; renderForslag(null); setStatus("Delsträckor och vägval är uppdaterade från kartan."); return; }
  if (b.id==="kartAvbryt"){ sistaForslag=null; renderForslag(null); return; }
  if (b.id==="kartExport"){ exportera(); return; }
  if (b.id==="kartMinPos"){ if(!navigator.geolocation){ setStatus("Enheten kan inte visa position.",true); return; }
    navigator.geolocation.getCurrentPosition(p=>{ const ll=[r6(p.coords.latitude),r6(p.coords.longitude)]; map.setView(ll,17);
      if (mode==="punkt"&&$("#kartPunktVal").value) satPunkt($("#kartPunktVal").value,ll); },()=>setStatus("Kunde inte hämta position.",true),{enableHighAccuracy:true,timeout:15000}); return; }
  if (b.id==="kartKoordBtn"){ const ll=lasKoordinat($("#kartKoord").value); if(!ll){ setStatus("Kunde inte läsa koordinaten. Skriv till exempel 6555123 598765 eller 59,1234 16,5678.",true); return; }
    map.setView(ll,17); const v=$("#kartPunktVal").value; if(v&&!readOnly){ satPunkt(v,[r6(ll[0]),r6(ll[1])]); } return; }
});
document.addEventListener("change",e=>{
  if (e.target.id==="kartVisa"){ valtVisa=e.target.value; visaVag(); if(valtVisa){ const p=state.props.find(x=>x.id===valtVisa), pts=KS().punkter.filter(x=>x.prop===valtVisa); if(pts.length&&map) map.setView(pts[0].ll,Math.max(map.getZoom(),15)); } }
  if (e.target.id==="kartImport"&&e.target.files[0]){ const fr=new FileReader(); fr.onload=()=>importera(fr.result); fr.readAsText(e.target.files[0]); e.target.value=""; }
});
/* Kartan startas när fliken öppnas och ritas om när uppgifterna ändras. */
const panel=document.getElementById("tab-karta");
if (panel) new MutationObserver(()=>{ if(!panel.hidden) setTimeout(()=>{ initKarta(); renderLista(); },30); }).observe(panel,{attributes:true,attributeFilter:["hidden"]});
const orig=window.renderAll;
window.renderAll=function(){ orig(); if(map){ rita(); } renderLista(); };
window.kartaTest={natverk,forslag,tillampa,dijkstra,lasKoordinat,GK,satPunkt,avslutaLinje,get map(){return map;}};
setTimeout(()=>{ if(panel&&!panel.hidden){ initKarta(); } renderLista(); satMode("visa"); },50);
})();
