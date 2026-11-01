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
  if (g==="route") return pnamn(pt.prop);
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
    p.route=r.route||[]; p.skogRoute=p.skogEgen?(r.skog||[]):[];
    skiften(p).forEach(s=>{ const v=r["sk:"+s.id]; s.route=v||[]; });
    delete p.inreRoute; });
  scheduleSave();
}

/* ---------- karta ---------- */
let map=null, lager=null, lagerHl=null, mode="visa", ritar=null, steg="", aktivt="";
const FARG=["#1f5c41","#b45309","#2563eb","#9333ea","#be123c","#0f766e","#4d7c0f","#c2410c","#4338ca","#a16207"];
const ikon=(cls,txt)=>L.divIcon({className:"kpunkt "+cls, html:`<span>${esc(txt)}</span>`, iconSize:null});
const kartlage=()=>!state.manuell;
function initKarta(){
  const el=document.getElementById("karta");
  if (map){ setTimeout(()=>map.invalidateSize(),30); return; }
  if (!el||el.offsetParent===null) return;
  map=L.map(el,{zoomControl:true});
  const osm=L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap-bidragsgivare</a>'});
  const topo=L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",{maxZoom:17,subdomains:"abc",attribution:'Karta: © <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA), data © OpenStreetMap-bidragsgivare'});
  osm.addTo(map); L.control.layers({"Vägkarta":osm,"Terrängkarta":topo},null,{position:"topright"}).addTo(map);
  L.control.scale({imperial:false}).addTo(map);
  lager=L.layerGroup().addTo(map); lagerHl=L.layerGroup().addTo(map);
  map.on("click",klick); map.on("moveend",()=>{ if(mode==="vag") forhamta(); });
  map.on("dblclick",e=>{ if(mode==="vag"&&ritar){ const last=ritar.pts[ritar.pts.length-1]; if(map.latLngToContainerPoint(e.latlng).distanceTo(map.latLngToContainerPoint(last))<15) avslutaLinje(); } });
  passa(); rita();
}
function passa(){ if(!map) return; const k=KS(), b=L.latLngBounds([]);
  k.vagar.forEach(v=>(v.pts||[]).forEach(p=>b.extend(p))); k.punkter.forEach(p=>b.extend(p.ll)); state.segments.forEach(g=>(g.geo||[]).forEach(p=>b.extend(p)));
  if (b.isValid()) map.fitBounds(b.pad(0.15),{maxZoom:17}); else map.setView([62.5,16],5); }
function snap(latlng){
  const k=KS(), P=map.latLngToContainerPoint(latlng); let best=null;
  const hörn=p=>{ const d=P.distanceTo(map.latLngToContainerPoint(p)); if(d<14&&(!best||d<best.d)) best={d,ll:p,typ:"hörn"}; };
  k.vagar.forEach(v=>(v.pts||[]).forEach(hörn)); if (ritar) ritar.pts.forEach(hörn);
  if (best) return best;
  k.vagar.forEach(v=>{ const p=v.pts||[]; for(let i=0;i+1<p.length;i++){ const r=proj([latlng.lat,latlng.lng],p[i],p[i+1]); const d=P.distanceTo(map.latLngToContainerPoint(r.pt)); if(d<14&&(!best||d<best.d)) best={d,ll:r.pt,typ:"linje",v,i}; } });
  return best;
}
/* ---------- Följ vägen: vägens form hämtas från OpenStreetMap (Overpass) och linjen dras längs den. ---------- */
let osmCache=null, foljVag=true, soker=false;
const OVERPASS=["https://overpass-api.de/api/interpreter","https://overpass.private.coffee/api/interpreter","https://maps.mail.ru/osm/tools/overpass/api/interpreter","https://overpass.kumi.systems/api/interpreter"];
let osmPagar=null;
/* Hämtar vägarna inom en ruta. Varje server får 8 sekunder och allt högst 20; svarar ingen dras linjen rakt. */
async function hamtaRuta(bb){
  const q=`[out:json][timeout:20];way["highway"](${bb.join(",")});out geom;`;
  const slut=Date.now()+20000;
  for (const url of OVERPASS){
    const kvar=slut-Date.now(); if(kvar<2000) break;
    const ac=new AbortController(), t=setTimeout(()=>ac.abort(),Math.min(8000,kvar));
    try{ const r=await fetch(url+"?data="+encodeURIComponent(q),{signal:ac.signal}); clearTimeout(t);
      if(!r.ok) continue; const j=await r.json();
      const ways=(j.elements||[]).filter(x=>x.type==="way"&&Array.isArray(x.geometry)&&Array.isArray(x.nodes)&&x.nodes.length===x.geometry.length).map(x=>({nodes:x.nodes,geom:x.geometry.map(g=>[g.lat,g.lon])}));
      if (!ways.length) continue;
      return {bbox:bb,ways}; }catch(err){ clearTimeout(t); }
  }
  return null;
}
/* Hämtar vägarna för det som syns på kartan i förväg, så att det går fort när man trycker. */
function forhamta(){
  if (!map||!foljVag||map.getZoom()<11) return;
  const b=map.getBounds().pad(0.3), bb=[b.getSouth(),b.getWest(),b.getNorth(),b.getEast()].map(x=>Math.round(x*1e5)/1e5);
  if (osmCache){ const c=osmCache.bbox; if(bb[0]>=c[0]&&bb[1]>=c[1]&&bb[2]<=c[2]&&bb[3]<=c[3]) return; }
  if (osmPagar) return;
  osmPagar=hamtaRuta(bb).then(r=>{ if(r) osmCache=r; osmPagar=null; return r; });
}
async function hamtaOsm(a,b){
  const S=Math.min(a[0],b[0]), N=Math.max(a[0],b[0]), W=Math.min(a[1],b[1]), E=Math.max(a[1],b[1]);
  const inne=()=>{ const c=osmCache&&osmCache.bbox; return c&&S>=c[0]&&W>=c[1]&&N<=c[2]&&E<=c[3]; };
  if (inne()) return osmCache;
  if (osmPagar){ const r=await osmPagar; if(inne()) return osmCache; if(!r) return null; }
  const pl=Math.max(0.01,(N-S)*0.6), pg=Math.max(0.02,(E-W)*0.6), bb=[S-pl,W-pg,N+pl,E+pg].map(x=>Math.round(x*1e5)/1e5);
  const r=await hamtaRuta(bb); if(r) osmCache=r; return r;
}
/* Kortaste väg längs OpenStreetMaps vägar mellan två punkter. Returnerar koordinaterna eller null. */
function osmVag(osm,a,b){
  const adj=new Map(), pos=new Map();
  const add=(u,v,l)=>{ if(!adj.has(u)) adj.set(u,[]); adj.get(u).push([v,l]); };
  osm.ways.forEach(w=>{ for(let i=0;i<w.nodes.length;i++){ pos.set(w.nodes[i],w.geom[i]); if(i){ const l=hav(w.geom[i-1],w.geom[i]); add(w.nodes[i-1],w.nodes[i],l); add(w.nodes[i],w.nodes[i-1],l); } } });
  const fast=(p,id)=>{ let best=null;
    osm.ways.forEach(w=>{ for(let i=0;i+1<w.geom.length;i++){ const r=proj(p,w.geom[i],w.geom[i+1]); if(!best||r.d<best.d) best={...r,u:w.nodes[i],v:w.nodes[i+1],a:w.geom[i],b:w.geom[i+1]}; } });
    if (!best||best.d>60) return null;
    pos.set(id,best.pt); const la=hav(best.a,best.pt), lb=hav(best.pt,best.b); add(id,best.u,la); add(best.u,id,la); add(id,best.v,lb); add(best.v,id,lb); return best; };
  const A=fast(a,"A"), B=fast(b,"B"); if(!A||!B) return null;
  if ((A.u===B.u&&A.v===B.v)||(A.u===B.v&&A.v===B.u)){ const l=hav(A.pt,B.pt); add("A","B",l); add("B","A",l); }
  /* Dijkstra med en enkel binär hög. */
  const dist=new Map([["A",0]]), prev=new Map(), H=[["A",0]];
  const push=x=>{ H.push(x); let i=H.length-1; while(i){ const p=(i-1)>>1; if(H[p][1]<=H[i][1]) break; [H[p],H[i]]=[H[i],H[p]]; i=p; } };
  const pop=()=>{ const t=H[0], l=H.pop(); if(H.length){ H[0]=l; let i=0; for(;;){ const a=2*i+1, b=a+1; let m=i; if(a<H.length&&H[a][1]<H[m][1]) m=a; if(b<H.length&&H[b][1]<H[m][1]) m=b; if(m===i) break; [H[m],H[i]]=[H[i],H[m]]; i=m; } } return t; };
  while(H.length){ const [u,d]=pop(); if(d>(dist.get(u)??Infinity)) continue; if(u==="B") break;
    (adj.get(u)||[]).forEach(([v,l])=>{ const nd=d+l; if(nd<(dist.get(v)??Infinity)){ dist.set(v,nd); prev.set(v,u); push([v,nd]); } }); }
  if (!dist.has("B")) return null;
  const ut=[]; let x="B", g=0; while(x!==undefined&&g++<100000){ ut.push(pos.get(x)); x=prev.get(x); }
  ut.reverse();
  /* En omväg som är mer än fyra gånger fågelvägen tyder på att vägarna inte hänger ihop. */
  if (dist.get("B")>4*hav(a,b)+200) return null;
  return ut;
}
async function klickVag(e){
  if (soker) return;
  const ll=[r6(e.latlng.lat),r6(e.latlng.lng)];
  const s=snap(e.latlng); let p=ll;
  if (s){ p=[r6(s.ll[0]),r6(s.ll[1])]; if(s.typ==="linje") s.v.pts.splice(s.i+1,0,p); }
  if (!ritar){ ritar={id:uid(),pts:[p],ben:[1]}; rita(); visaHjalp(foljVag?"Tryck där vägen slutar eller där en annan väg tar av. Linjen följer vägen på kartan.":HJALP.vag); return; }
  const last=ritar.pts[ritar.pts.length-1]; if(hav(last,p)<0.5) return;
  let mellan=[];
  if (foljVag){
    soker=true; visaHjalp("Söker vägen på kartan …");
    const osm=await hamtaOsm(last,p), v=osm&&osmVag(osm,last,p);
    soker=false;
    if (v&&v.length>2){ mellan=v.slice(1,-1).map(q=>[r6(q[0]),r6(q[1])]); visaHjalp("Klart. Tryck vidare om vägen fortsätter, eller Klar med linjen."); }
    else visaHjalp(osm?"Hittade ingen väg på kartan mellan punkterna, så linjen dras rakt. Tryck tätare där vägen svänger.":"Kunde inte hämta vägarna från OpenStreetMap, så linjen dras rakt. Tryck tätare där vägen svänger.");
  }
  if (!ritar) return;
  mellan.forEach(q=>ritar.pts.push(q)); ritar.pts.push(p); ritar.ben=(ritar.ben||[]).concat(mellan.length+1);
  rita();
}
function klick(e){
  const ll=[r6(e.latlng.lat),r6(e.latlng.lng)];
  if (mode==="vag"){ klickVag(e); return; }
  if (mode==="utfart"){ satPunkt("utfart",ll); return; }
  if (mode==="ansl"){
    if (!KS().vagar.length){ visaHjalp("Rita vägen i steg 3 först."); return; }
    if (!aktivt){ visaHjalp("Välj först en fastighet i listan under kartan."); return; }
    satPunkt(aktivt,ll); return;
  }
}
function satPunkt(val,ll){
  const k=KS(); let pt;
  if (val==="utfart") pt={id:uid(),typ:"utfart",ll};
  else { const [prop,galler]=val.split("|"); k.punkter=k.punkter.filter(x=>!(x.prop===prop&&(x.galler||"route")===galler)); pt={id:uid(),typ:"anslutning",prop,galler,ll}; }
  let best=null; k.vagar.forEach(v=>{ const p=v.pts||[]; for(let i=0;i+1<p.length;i++){ const r=proj(ll,p[i],p[i+1]); if(!best||r.d<best.d) best=r; } });
  if (best&&best.d<80) pt.ll=[r6(best.pt[0]),r6(best.pt[1])];
  k.punkter.push(pt);
  if (val!=="utfart"){ const m=mal(), i=m.findIndex(x=>x.val===val), next=m.slice(i+1).concat(m.slice(0,i)).find(x=>!x.satt); aktivt=next?next.val:""; }
  andrat();
}
function avslutaLinje(){
  if (ritar && ritar.pts.length>=2){ delete ritar.ben; KS().vagar.push(ritar); }
  ritar=null; andrat();
}
/* Efter varje ändring på kartan räknas delsträckor och vägval om, om de inte anges för hand. */
let senaste=null;
/* Finns ingen väg eller utfart kvar tas delsträckor som räknats fram från kartan bort, så att inget gammalt visas. */
function rensaKartsegment(){
  if (!state.segments.some(g=>Array.isArray(g.geo))) return false;
  state.segments=state.segments.filter(g=>!Array.isArray(g.geo));
  const ids=new Set(state.segments.map(g=>g.id));
  mapRoutes(r=>r.filter(x=>ids.has(x)));
  return true;
}
function andrat(){
  natCache=null;
  if (kartlage()){ const f=forslag(); senaste=f; if(!f.fel) tillampa(f); else rensaKartsegment(); }
  scheduleSave(); renderAll();
}
function visaHjalp(t){ const h=document.getElementById("kartHjalp"), a=document.getElementById("anslAktiv"); const el=steg==="ansl"?a:h; if(el){ el.hidden=!t; el.textContent=t||""; } }
const HJALP={
  vag:"Tryck där vägen börjar. Börjar en gren på en väg du redan ritat, tryck på den.",
  utfart:"Tryck där vägen ansluter till allmän väg.",
  flytta:"Dra i punkter och i vägens hörn (vita ringar) för att flytta dem.",
  radera:"Tryck på en punkt, ett hörn eller en väglinje för att ta bort den."
};
function satMode(m){
  if (mode==="vag"&&m!=="vag") avslutaLinje();
  mode=m; document.querySelectorAll("[data-km]").forEach(b=>b.classList.toggle("on",b.dataset.km===m));
  const kl=document.getElementById("kartKlar"); if(kl) kl.hidden=m!=="vag";
  if (map){ ["vag","utfart","ansl"].includes(m)?map.doubleClickZoom.disable():map.doubleClickZoom.enable(); map.getContainer().classList.toggle("ritlage",["vag","utfart","ansl"].includes(m)); }
  if (steg==="vag") visaHjalp(HJALP[m]||"");
  if (m==="vag") forhamta();
  rita();
}
function rita(){
  if (!map) return; lager.clearLayers(); lagerHl.clearLayers();
  const k=KS(), redigerar=["vag","flytta","radera"].includes(mode), harGeo=!state.manuell&&state.segments.some(g=>g.geo&&g.geo.length>1);
  if (harGeo && !redigerar){
    state.segments.forEach((g,i)=>{ if(!g.geo||g.geo.length<2) return;
      const pek=mode==="visa";
      const l=L.polyline(g.geo,{color:FARG[i%FARG.length],weight:6,opacity:.85,interactive:pek}).addTo(lager);
      l.bindTooltip(esc(g.id),{permanent:true,direction:"center",className:"kseg"});
      if (pek) l.bindPopup(`<b>Delsträcka ${esc(g.id)}</b><br>${esc(g.namn||"")}<br>${fmt(num(g.m))} m`,{autoPan:false}); });
  } else {
    k.vagar.forEach(v=>{ const l=L.polyline(v.pts,{color:"#475569",weight:6,opacity:.8,interactive:mode==="radera"}).addTo(lager);
      if (mode==="radera") l.on("click",ev=>{ L.DomEvent.stop(ev); if(confirm("Ta bort den här väglinjen?")){ k.vagar=k.vagar.filter(x=>x!==v); andrat(); } }); });
  }
  if (ritar){ L.polyline(ritar.pts,{color:"#dc2626",weight:4,dashArray:"6 6"}).addTo(lager); ritar.pts.forEach(p=>L.circleMarker(p,{radius:4,color:"#dc2626"}).addTo(lager)); }
  if (mode==="flytta"||mode==="radera"){
    const sett=new Set();
    k.vagar.forEach(v=>(v.pts||[]).forEach(p=>{ const key=p.join(","); if(sett.has(key)) return; sett.add(key);
      const m=L.marker(p,{icon:L.divIcon({className:"khorn",iconSize:[14,14]}),draggable:mode==="flytta"}).addTo(lager);
      m.on("dragend",()=>{ const q=m.getLatLng(), np=[r6(q.lat),r6(q.lng)]; k.vagar.forEach(w=>{ w.pts=w.pts.map(x=>x.join(",")===key?np:x); }); andrat(); });
      if (mode==="radera") m.on("click",()=>{ k.vagar.forEach(w=>{ w.pts=w.pts.filter(x=>x.join(",")!==key); }); k.vagar=k.vagar.filter(w=>w.pts.length>=2); andrat(); }); }));
  }
  const vis=steg==="vag" ? k.punkter.filter(p=>p.typ==="utfart") : k.punkter;
  vis.forEach(pt=>{
    const ut=pt.typ==="utfart", g=pt.galler||"route", val=ut?"":pt.prop+"|"+g;
    const cls=(ut?"utfart":g==="skog"?"skog":g.startsWith("sk:")?"skifte":"ansl")+(val&&val===aktivt?" aktiv":"");
    const txt=ut?"Utfart":gallerText(pt);
    const m=L.marker(pt.ll,{icon:ikon(cls,txt),draggable:mode==="flytta"||(steg==="ansl"&&!ut),zIndexOffset:ut?1000:500}).addTo(lager);
    if (mode==="visa") m.bindPopup(()=>`<b>${esc(gallerText(pt))}</b><br>${esc(swText(pt.ll))} (SWEREF 99 TM)${avstText(pt)}`,{autoPan:false});
    m.on("dragend",()=>{ const q=m.getLatLng(); pt.ll=[r6(q.lat),r6(q.lng)]; andrat(); });
    if (mode==="radera") m.on("click",()=>{ KS().punkter=KS().punkter.filter(x=>x!==pt); andrat(); });
  });
  /* Vald fastighets väg markeras. */
  const p=aktivt&&state.props.find(x=>x.id===aktivt.split("|")[0]);
  if (p && steg==="ansl"){ const ids=new Set([...(p.route||[])]); state.segments.forEach(g=>{ if(ids.has(g.id)&&g.geo) L.polyline(g.geo,{color:"#facc15",weight:12,opacity:.55}).addTo(lagerHl); }); }
}
let natCache=null;
function avstand(){ if(natCache) return natCache; const G=natverk(), utf=KS().punkter.filter(p=>p.typ==="utfart").map(p=>G.pnod.get(p.id)).filter(Boolean); natCache={G,D:utf.length?dijkstra(G,utf):null}; setTimeout(()=>natCache=null,0); return natCache; }
function avstText(pt){ if(pt.typ==="utfart") return ""; const {G,D}=avstand(), n=G.pnod.get(pt.id); if(!n||!D) return ""; const d=D.dist.get(n); return isFinite(d)?`<br>${fmt(d/1000,3)} km längs vägen till ${esc(utfartOf())}`:"<br>Ingen väg till utfarten"; }
/* Vad som ska sättas ut: en punkt per fastighet, plus skog och skiften som nås från ett annat ställe. */
function mal(){
  const k=KS(), ut=[];
  [...state.props].sort((a,b)=>String(a.namn).localeCompare(String(b.namn),"sv")).forEach(p=>{ const t=typOf(p); if(t==="annan") return;
    const has=g=>k.punkter.find(x=>x.prop===p.id&&(x.galler||"route")===g);
    ut.push({val:p.id+"|route", p, namn:p.namn||"Namnlös", del:"", pt:has("route")});
    if (["kombi","jord","skog"].includes(t)&&p.skogEgen) ut.push({val:p.id+"|skog", p, namn:p.namn||"Namnlös", del:"skogen", pt:has("skog")});
    if (t==="jord") skiften(p).filter(s=>s.plats&&s.plats!=="bc").forEach(s=>ut.push({val:`${p.id}|sk:${s.id}`, p, namn:p.namn||"Namnlös", del:s.namn||"skifte", pt:has("sk:"+s.id)}));
  });
  ut.forEach(m=>m.satt=!!m.pt); return ut;
}
window.kartaStatus=p=>{ const pt=KS().punkter.find(x=>x.prop===p.id&&(x.galler||"route")==="route"); if(!pt) return {satt:false};
  const {G,D}=avstand(), n=G.pnod.get(pt.id), d=n&&D?D.dist.get(n):NaN; return {satt:true, km:isFinite(d)?d/1000:0}; };
function renderLista(){
  const el=document.getElementById("anslLista");
  if (el){
    const m=mal(), {G,D}=avstand(), klara=m.filter(x=>x.satt).length;
    if (!aktivt || !m.some(x=>x.val===aktivt)) aktivt=(m.find(x=>!x.satt)||{}).val||"";
    el.innerHTML = !KS().vagar.length ? `<p class="notice">Rita vägen och sätt ut utfarten i steg 3 först.</p>`
      : !m.length ? `<p class="empty">Inga fastigheter ännu. Lägg in dem i steg 2.</p>`
      : `<p class="hint">${klara} av ${m.length} utsatta.</p><div class="anslrader">${m.map(x=>{ const n=x.pt&&G.pnod.get(x.pt.id), d=n&&D?D.dist.get(n):NaN;
        return `<div class="anslrad${x.val===aktivt?" on":""}${x.satt?" klar":""}"><button type="button" class="anslval" data-mal="${esc(x.val)}"><strong>${esc(x.namn)}${x.del?` – ${esc(x.del)}`:""}</strong><small>${x.satt?(isFinite(d)?`Utsatt · ${fmt(d/1000,3)} km till ${esc(utfartOf())}`:"Utsatt · hittar ingen väg till utfarten"):(x.val===aktivt?"Tryck på kartan nu":"Inte utsatt")}</small></button>
          ${x.satt?`<button type="button" class="ghost small" data-maldel="${esc(x.val)}">Ta bort</button>`:""}</div>`; }).join("")}</div>`;
    const a=document.getElementById("anslAktiv");
    if (a && steg==="ansl"){ const x=m.find(y=>y.val===aktivt); a.hidden=!x; a.textContent=x?`Tryck på kartan där ${x.namn}${x.del?` (${x.del})`:""} ansluter till vägen.`:""; if(!x&&m.length&&klara===m.length){ a.hidden=false; a.textContent="Alla är utsatta. Gå vidare till Resultat."; } }
  }
  const si=document.getElementById("segInfo"), k=KS();
  if (si){
    const tot=state.segments.reduce((s,g)=>s+num(g.m),0), f=senaste||(kartlage()&&k.vagar.length?forslag():null);
    si.innerHTML = state.manuell ? "Du anger delsträckorna och fastigheternas vägval för hand. Längderna mäter du själv, till exempel på en karta."
      : !k.vagar.length ? "Rita vägen på kartan ovanför så räknas delsträckorna fram här."
      : f&&f.fel ? esc(f.fel)
      : `Framräknat från kartan: ${state.segments.length} delsträckor, sammanlagt ${fmt(tot)} m. A ligger närmast ${esc(utfartOf())}.`+((f&&f.varn||[]).filter(v=>/hänger inte ihop|ingen väg till/.test(v)).map(v=>`<br><b>${esc(v)}</b>`).join(""));
  }
  const mc=document.getElementById("manuell"); if(mc) mc.checked=!!state.manuell;
  const st=document.getElementById("segtable");
  if (st){ const las=kartlage()&&k.vagar.length>0; st.querySelectorAll("input").forEach(i=>i.disabled=las); st.querySelectorAll("[data-segdel]").forEach(b=>b.hidden=las); const ad=document.getElementById("addSeg"); if(ad) ad.hidden=las; }
}
async function exportera(){
  const k=KS(), fs=[];
  k.vagar.forEach(v=>fs.push({type:"Feature",geometry:{type:"LineString",coordinates:v.pts.map(p=>[p[1],p[0]])},properties:{typ:"väg"}}));
  k.punkter.forEach(pt=>fs.push({type:"Feature",geometry:{type:"Point",coordinates:[pt.ll[1],pt.ll[0]]},properties:{typ:pt.typ,fastighet:pt.prop?pnamn(pt.prop):"",galler:pt.galler||"",beskrivning:gallerText(pt)}}));
  state.segments.forEach(g=>{ if(g.geo) fs.push({type:"Feature",geometry:{type:"LineString",coordinates:g.geo.map(p=>[p[1],p[0]])},properties:{typ:"delsträcka",id:g.id,namn:g.namn,meter:num(g.m)}}); });
  sparaFil("vagnat.geojson",new Blob([JSON.stringify({type:"FeatureCollection",features:fs},null,1)],{type:"application/geo+json"}));
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
  andrat(); passa();
  setStatus(`Inläst: ${nv} väglinjer och ${np} punkter${ej?`, ${ej} punkter utan känd fastighet hoppades över`:""}.`, !!ej);
}

/* ---------- händelser ---------- */
document.addEventListener("click",e=>{
  const b=e.target.closest("button"); if(!b) return;
  if (b.dataset.km){ satMode(mode===b.dataset.km?"visa":b.dataset.km); return; }
  if (b.id==="kartKlarBtn"){ avslutaLinje(); return; }
  if (b.id==="kartAngra"){ if(ritar){ const n=(ritar.ben&&ritar.ben.pop())||1; ritar.pts.splice(-n,n); if(!ritar.pts.length) ritar=null; rita(); } return; }
  if (b.dataset.mal){ aktivt=b.dataset.mal; renderLista(); rita(); const x=mal().find(y=>y.val===aktivt); if(x&&x.pt&&map) map.panTo(x.pt.ll); document.getElementById("karta").scrollIntoView({behavior:"smooth",block:"center"}); return; }
  if (b.dataset.maldel){ const [prop,g]=b.dataset.maldel.split("|"); KS().punkter=KS().punkter.filter(x=>!(x.prop===prop&&(x.galler||"route")===g)); aktivt=b.dataset.maldel; andrat(); return; }
  if (b.id==="kartExport"){ exportera(); return; }
  if (b.id==="kartMinPos"){ if(!navigator.geolocation){ setStatus("Enheten kan inte visa position.",true); return; }
    navigator.geolocation.getCurrentPosition(p=>{ const ll=[r6(p.coords.latitude),r6(p.coords.longitude)]; if(map) map.setView(ll,17); if(aktivt) satPunkt(aktivt,ll); },()=>setStatus("Kunde inte hämta position.",true),{enableHighAccuracy:true,timeout:15000}); return; }
  if (b.id==="kartKoordBtn"){ const ll=lasKoordinat($("#kartKoord").value); if(!ll){ setStatus("Kunde inte läsa koordinaten. Skriv till exempel 6555123 598765 eller 59,1234 16,5678.",true); return; } if(map) map.setView(ll,16); return; }
});
document.addEventListener("change",e=>{
  if (e.target.id==="foljVag"){ foljVag=e.target.checked; return; }
  if (e.target.id==="kartImport"&&e.target.files[0]){ const fr=new FileReader(); fr.onload=()=>importera(fr.result); fr.readAsText(e.target.files[0]); e.target.value=""; }
  if (e.target.dataset&&(e.target.dataset.f==="skogEgen"||e.target.dataset.skf==="plats")) andrat();
});
/* Kartan flyttas till det steg som visas. */
window.kartaSteg=function(s){
  steg=s; const plats=document.querySelector(`[data-kartplats="${s}"]`), el=document.getElementById("karta");
  if (!plats||!el){ if(mode==="vag") avslutaLinje(); return; }
  plats.appendChild(el);
  mode = s==="ansl" ? "ansl" : "visa";
  document.querySelectorAll("[data-km]").forEach(b=>b.classList.toggle("on",false));
  const kl=document.getElementById("kartKlar"); if(kl) kl.hidden=true;
  if (kartlage()){ const f=forslag(); if(f.fel&&rensaKartsegment()) scheduleSave(); }
  visaHjalp(""); setTimeout(()=>{ initKarta(); if(map){ map.invalidateSize(); satMode(mode); } renderLista(); },30);
};
const orig=window.renderAll;
window.renderAll=function(){ orig(); if(map) rita(); renderLista(); };
window.kartaTest={natverk,forslag,tillampa,dijkstra,lasKoordinat,GK,satPunkt,avslutaLinje,mal,get map(){return map;}};
if (typeof openTab!=="undefined") window.kartaSteg(openTab);
})();
