/* Import av medlemsregistret (bara styrelsen). Laddas först när någon öppnar importen.
   Läser Excel (.xlsx), LibreOffice (.ods), CSV/text (semikolon, komma eller tab), JSON, vCard (.vcf) och inklistrad text.
   Kolumnerna gissas utifrån rubrikerna och kan ändras. Befintliga kontakter matchas på mejl, annars på fastighet + namn.
   Inget sparas förrän man trycker Importera, och importen kan ångras direkt efteråt. */
(function(){
"use strict";
const E=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm=s=>String(s??"").replace(/[ \s]+/g," ").trim();
const nyckel=s=>norm(s).toLowerCase();

/* ---------- filläsare: alla ger {blad:[{namn, rader:[[cell,…],…]}]} ---------- */
function avkoda(buf){
  const b=new Uint8Array(buf);
  if (b[0]===0xFF&&b[1]===0xFE) return new TextDecoder("utf-16le").decode(b);
  if (b[0]===0xFE&&b[1]===0xFF) return new TextDecoder("utf-16be").decode(b);
  try{ return new TextDecoder("utf-8",{fatal:true}).decode(b).replace(/^﻿/,""); }
  catch(e){ return new TextDecoder("windows-1252").decode(b); }   /* CSV sparad från svensk Excel */
}
function lasText(t){
  t=String(t||"").replace(/^﻿/,"");
  const prov=t.split(/\r?\n/).slice(0,20).join("\n"), ant=c=>{ let n=0,q=false; for(const ch of prov){ if(ch==='"') q=!q; else if(!q&&ch===c) n++; } return n; };
  const sep=[["\t",ant("\t")],[";",ant(";")],[",",ant(",")]].sort((a,b)=>b[1]-a[1])[0];
  const d=sep[1]>0?sep[0]:"\t", rader=[]; let rad=[], cell="", q=false;
  for(let i=0;i<t.length;i++){ const c=t[i];
    if(q){ if(c==='"'){ if(t[i+1]==='"'){ cell+='"'; i++; } else q=false; } else cell+=c; continue; }
    if(c==='"'&&cell==="") q=true;
    else if(c===d){ rad.push(cell); cell=""; }
    else if(c==="\n"||c==="\r"){ if(c==="\r"&&t[i+1]==="\n") i++; rad.push(cell); rader.push(rad); rad=[]; cell=""; }
    else cell+=c; }
  if(cell!==""||rad.length){ rad.push(cell); rader.push(rad); }
  return {blad:[{namn:"",rader}]};
}
/* Zip (xlsx och ods är zip-filer). Webbläsarens DecompressionStream packar upp, inga bibliotek behövs. */
async function zip(buf){
  const v=new DataView(buf), b=new Uint8Array(buf); let e=-1;
  for(let i=b.length-22;i>=Math.max(0,b.length-70000);i--) if(v.getUint32(i,true)===0x06054b50){ e=i; break; }
  if(e<0) throw new Error("zip");
  const antal=v.getUint16(e+10,true); let p=v.getUint32(e+16,true); const filer=new Map(), td=new TextDecoder();
  for(let k=0;k<antal;k++){
    if(v.getUint32(p,true)!==0x02014b50) break;
    const metod=v.getUint16(p+10,true), storlek=v.getUint32(p+20,true), nl=v.getUint16(p+28,true), xl=v.getUint16(p+30,true), cl=v.getUint16(p+32,true), lh=v.getUint32(p+42,true);
    filer.set(td.decode(b.subarray(p+46,p+46+nl)),{metod,storlek,lh}); p+=46+nl+xl+cl; }
  return async namn=>{ const f=filer.get(namn); if(!f) return null;
    const start=f.lh+30+v.getUint16(f.lh+26,true)+v.getUint16(f.lh+28,true), data=b.subarray(start,start+f.storlek);
    if(f.metod===0) return td.decode(data);
    const s=new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return await new Response(s).text(); };
}
const xml=t=>new DOMParser().parseFromString(t,"application/xml");
const kolNr=r=>{ let n=0; for(const c of String(r).replace(/\d+/g,"")) n=n*26+(c.charCodeAt(0)-64); return n-1; };
async function lasXlsx(buf){
  const hamta=await zip(buf), ss=[], blad=[];
  const sst=await hamta("xl/sharedStrings.xml");
  if(sst) [...xml(sst).getElementsByTagName("si")].forEach(si=>ss.push([...si.getElementsByTagName("t")].map(t=>t.textContent).join("")));
  const wb=xml(await hamta("xl/workbook.xml")||"<w/>"), rels=xml(await hamta("xl/_rels/workbook.xml.rels")||"<r/>");
  const mal=new Map([...rels.getElementsByTagName("Relationship")].map(r=>[r.getAttribute("Id"),r.getAttribute("Target")]));
  const sheets=[...wb.getElementsByTagName("sheet")];
  for(const sh of sheets){
    const rid=sh.getAttribute("r:id")||sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships","id");
    let t=mal.get(rid)||""; t=t.startsWith("/")?t.slice(1):"xl/"+t.replace(/^\.\//,"");
    const doc=await hamta(t); if(!doc) continue;
    const rader=[];
    [...xml(doc).getElementsByTagName("row")].forEach(r=>{ const ri=(+r.getAttribute("r")||rader.length+1)-1, rad=[];
      [...r.getElementsByTagName("c")].forEach((c,j)=>{ const typ=c.getAttribute("t"), ref=c.getAttribute("r"), ci=ref?kolNr(ref):j;
        const vEl=c.getElementsByTagName("v")[0]; let val="";
        if(typ==="s") val=ss[+(vEl&&vEl.textContent)]??"";
        else if(typ==="inlineStr") val=[...c.getElementsByTagName("t")].map(x=>x.textContent).join("");
        else val=vEl?vEl.textContent:"";
        rad[ci]=val; });
      rader[ri]=[...rad].map(x=>x??""); });
    blad.push({namn:sh.getAttribute("name")||"",rader:[...rader].map(x=>x||[])});
  }
  return {blad};
}
async function lasOds(buf){
  const hamta=await zip(buf), d=xml(await hamta("content.xml")||"<x/>"), T="urn:oasis:names:tc:opendocument:xmlns:table:1.0", TX="urn:oasis:names:tc:opendocument:xmlns:text:1.0";
  const blad=[...d.getElementsByTagNameNS(T,"table")].map(tb=>{ const rader=[];
    [...tb.getElementsByTagNameNS(T,"table-row")].forEach(r=>{ const rad=[];
      [...r.children].filter(c=>c.localName==="table-cell"||c.localName==="covered-table-cell").forEach(c=>{
        const txt=[...c.getElementsByTagNameNS(TX,"p")].map(p=>p.textContent).join("\n"), n=Math.min(+(c.getAttributeNS(T,"number-columns-repeated")||1),txt?50:1);
        for(let i=0;i<n;i++) rad.push(txt); });
      while(rad.length&&rad[rad.length-1]==="") rad.pop();
      const n=Math.min(+(r.getAttributeNS(T,"number-rows-repeated")||1),rad.length?1000:1); for(let i=0;i<n;i++) rader.push(rad.slice()); });
    while(rader.length&&!rader[rader.length-1].length) rader.pop();
    return {namn:tb.getAttributeNS(T,"name")||"",rader}; });
  return {blad};
}
function lasJson(t){
  const d=JSON.parse(String(t).replace(/^﻿/,""));
  const hitta=x=>{ if(Array.isArray(x)&&x.some(y=>y&&typeof y==="object"&&!Array.isArray(y))) return x;
    if(Array.isArray(x)&&x.every(Array.isArray)) return x;
    if(x&&typeof x==="object"){ for(const k of ["medlemmar","members","fastigheter","kontakter","rows","data"]) if(x[k]){ const r=hitta(x[k]); if(r) return r; }
      for(const v of Object.values(x)){ const r=hitta(v); if(r) return r; } } return null; };
  const lista=hitta(d); if(!lista) throw new Error("json");
  if(lista.every(Array.isArray)) return {blad:[{namn:"",rader:lista.map(r=>r.map(c=>c==null?"":String(c)))}]};
  const obj=lista.filter(y=>y&&typeof y==="object"), keys=[...new Set(obj.flatMap(Object.keys))].filter(k=>obj.some(o=>o[k]!=null&&typeof o[k]!=="object"));
  return {blad:[{namn:"",rader:[keys,...obj.map(o=>keys.map(k=>o[k]==null||typeof o[k]==="object"?"":String(o[k])))]}]};
}
function lasVcf(t){
  const kort=String(t).replace(/\r?\n[ \t]/g,"").split(/BEGIN:VCARD/i).slice(1), rubr=["Namn","Telefon","Mejl","Adress","Postnummer","Ort","Organisation","Anteckning"];
  const av=s=>s.replace(/\\n/gi," ").replace(/\\([,;\\])/g,"$1").trim();
  const rader=kort.map(k=>{ const r={}; k.split(/\r?\n/).forEach(l=>{ const i=l.indexOf(":"); if(i<0) return; const nyck=l.slice(0,i).split(";")[0].split(".").pop().toUpperCase(), val=l.slice(i+1);
      if(nyck==="FN") r.Namn=av(val);
      else if(nyck==="N"&&!r.Namn){ const [ef,fo]=val.split(";"); r.Namn=av([fo,ef].filter(Boolean).join(" ")); }
      else if(nyck==="TEL"&&!r.Telefon) r.Telefon=av(val).replace(/^tel:/i,"");
      else if(nyck==="EMAIL"&&!r.Mejl) r.Mejl=av(val);
      else if(nyck==="ADR"&&!r.Adress){ const a=val.split(";"); r.Adress=av(a[2]||""); r.Ort=av(a[3]||""); r.Postnummer=av(a[5]||""); }
      else if(nyck==="ORG") r.Organisation=av(val.split(";")[0]);
      else if(nyck==="NOTE") r.Anteckning=av(val); });
    return rubr.map(h=>r[h]||""); });
  return {blad:[{namn:"",rader:[rubr,...rader]}]};
}
async function lasFil(f){
  const n=f.name.toLowerCase(), buf=await f.arrayBuffer(), b=new Uint8Array(buf.slice(0,8));
  const arZip=b[0]===0x50&&b[1]===0x4b;
  if(/\.xls$/.test(n)&&!arZip) throw new Error("xls");
  if(arZip&&/\.(ods|ots)$/.test(n)) return lasOds(buf);
  if(arZip){ try{ return await lasXlsx(buf); }catch(e){ return lasOds(buf); } }
  const t=avkoda(buf);
  if(/\.vcf$/.test(n)||/^\s*BEGIN:VCARD/i.test(t)) return lasVcf(t);
  if(/\.json$/.test(n)||/^\s*[\[{]/.test(t)) return lasJson(t);
  if(/\.(numbers|pages|docx?|pdf)$/.test(n)) throw new Error("format");
  return lasText(t);
}

/* ---------- kolumner ---------- */
const FALT=[
  ["fastighet","Fastighet",/^(fastighet(snamn)?|gård|gard|ställe|stalle|hus|tomt|objekt)$|fastighet(?!s?bet)/],
  ["beteckning","Fastighetsbeteckning",/beteckning|fastighetsbet|registerbet|^bet\.?$/],
  ["namn","Namn",/^(namn|fullständigt namn|kontakt(person)?|ägare|agare|medlem|innehavare|name|full name)$|kontaktperson|ägarens namn/],
  ["fornamn","Förnamn",/förnamn|fornamn|first ?name|given/],
  ["efternamn","Efternamn",/efternamn|last ?name|surname|family/],
  ["telefon","Telefon",/tel|mobil|phone|nummer$/],
  ["epost","Mejl",/e-?post|mejl|mail/],
  ["adress","Adress",/adress|address|gata|utdelning/],
  ["postnr","Postnummer",/post ?n(umme)?r|postnummer|zip|postal/],
  ["ort","Ort",/^(post)?ort$|stad|city|^ort\b/],
];
function gissa(rubr,data){
  const m={}, tagen=new Set(), h=rubr.map(x=>nyckel(x));
  /* mejl före adress, så att "E-postadress" inte blir adress; postort före ort */
  for(const k of ["epost","beteckning","postnr","fornamn","efternamn","telefon","fastighet","namn","ort","adress"]){
    const re=FALT.find(f=>f[0]===k)[2], i=h.findIndex((x,j)=>!tagen.has(j)&&x&&re.test(x));
    if(i>=0){ m[k]=i; tagen.add(i); } }
  /* utan rubriker: gissa på innehållet */
  const kol=j=>data.map(r=>norm(r[j])).filter(Boolean), andel=(j,re)=>{ const v=kol(j); return v.length?v.filter(x=>re.test(x)).length/v.length:0; };
  const n=Math.max(0,...data.map(r=>r.length));
  for(let j=0;j<n;j++){ if(tagen.has(j)) continue;
    if(m.epost==null&&andel(j,/@/)>.6){ m.epost=j; tagen.add(j); }
    else if(m.beteckning==null&&andel(j,/\d+:\d+/)>.6){ m.beteckning=j; tagen.add(j); }
    else if(m.telefon==null&&andel(j,/^[+\d][\d\s\-()]{6,}$/)>.6){ m.telefon=j; tagen.add(j); }
    else if(m.postnr==null&&andel(j,/^\d{3} ?\d{2}$/)>.6){ m.postnr=j; tagen.add(j); } }
  /* textkolumner som är kvar: personnamn (två ord med stor bokstav) blir namn, den första andra blir fastighet */
  const text=j=>!tagen.has(j)&&andel(j,/^[^\d@]*[A-Za-zÅÄÖåäöÉé]/)>.6;
  if(m.namn==null&&m.fornamn==null){ for(let j=0;j<n;j++) if(text(j)&&andel(j,/^[A-ZÅÄÖÉ][a-zåäöéü\-]+( [A-ZÅÄÖÉ][a-zåäöéü\-]+)+$/)>.6){ m.namn=j; tagen.add(j); break; } }
  if(m.fastighet==null&&m.beteckning==null){ for(let j=0;j<n;j++) if(text(j)){ m.fastighet=j; tagen.add(j); break; } }
  return m;
}
const harRubriker=rader=>{ const r=(rader[0]||[]).map(nyckel).filter(Boolean); return r.length>0&&r.some(x=>FALT.some(f=>f[2].test(x)))&&!r.some(x=>/@/.test(x)); };
const tel=v=>{ let t=norm(v); if(/^\d{8,10}$/.test(t)&&/^[1-9]/.test(t)&&t.length<=9) t="0"+t; if(/^46\d{8,9}$/.test(t)) t="+"+t; return t; };
function tillRad(r,m){
  const g=k=>m[k]!=null&&m[k]!==""?norm(r[m[k]]):"";
  let namn=g("namn"); const fe=[g("fornamn"),g("efternamn")].filter(Boolean).join(" "); if(!namn) namn=fe;
  const pnr=g("postnr").replace(/^(\d{3}) ?(\d{2})$/,"$1 $2"), postort=[pnr,g("ort")].filter(Boolean).join(" ");
  let adress=g("adress"); if(postort&&!adress.toLowerCase().includes(postort.toLowerCase())) adress=[adress,postort].filter(Boolean).join(", ");
  const bet=g("beteckning"), fast=g("fastighet")||bet;
  return {fastighet:fast,beteckning:bet,namn,telefon:tel(g("telefon")),epost:g("epost").toLowerCase().replace(/^mailto:/,""),adress};
}

/* ---------- jämförelse med registret ---------- */
const FALT_UT=["fastighet","beteckning","namn","telefon","epost","adress"];
function plan(nya,befintliga,bara){
  const rader=befintliga.map(x=>({...x})), ut={ny:[],andrad:[],lika:0,hoppad:0,dubblett:0}, sett=new Set();
  const byMejl=new Map(), byFN=new Map();
  rader.forEach(x=>{ if(norm(x.epost)) byMejl.set(nyckel(x.epost),x); if(norm(x.namn)) byFN.set(nyckel(x.fastighet)+"|"+nyckel(x.namn),x); });
  nya.forEach(n=>{
    if(!n.fastighet&&!n.namn){ ut.hoppad++; return; }
    const k=(n.epost||"")+"|"+nyckel(n.fastighet)+"|"+nyckel(n.namn); if(sett.has(k)){ ut.dubblett++; return; } sett.add(k);
    let x=(n.epost&&byMejl.get(n.epost))||(n.namn&&byFN.get(nyckel(n.fastighet)+"|"+nyckel(n.namn)));
    if(!x&&n.fastighet) x=rader.find(y=>nyckel(y.fastighet)===nyckel(n.fastighet)&&!norm(y.namn)&&!norm(y.epost));   /* tom rad för fastigheten fylls i */
    if(x){ let andrat=false;
      FALT_UT.forEach(f=>{ if(!n[f]) return; if(bara&&norm(x[f])) return; if(norm(x[f])!==n[f]){ x[f]=n[f]; andrat=true; } });
      if(andrat&&!ut.andrad.includes(x)) ut.andrad.push(x); else if(!andrat) ut.lika++;
      if(n.epost) byMejl.set(n.epost,x); return; }
    const ny={id:null,...n}; ut.ny.push(ny); rader.push(ny);
    if(n.epost) byMejl.set(n.epost,ny); if(n.namn) byFN.set(nyckel(n.fastighet)+"|"+nyckel(n.namn),ny);
  });
  return {rader,...ut};
}

/* ---------- dialogen ---------- */
window.oppnaMedlemsimport=function(api){
  let fil=null, bladNr=0, rubriker=true, karta={}, bara=false, data=null, fore=null;
  const d=document.createElement("dialog"); d.className="bdlg impdlg"; document.body.appendChild(d);
  d.addEventListener("close",()=>d.remove());
  const g=s=>d.querySelector(s);
  const steg1=(fel)=>{
    d.innerHTML=`<form method="dialog"><h2>Importera medlemsregister</h2>
      <p class="hint">Välj en fil med en rad per kontaktperson. Fungerar med Excel (.xlsx), LibreOffice (.ods), CSV- eller textfiler, JSON och kontakter från telefonen (.vcf). Du kan också klistra in rader direkt från ett kalkylark.</p>
      <label class="impfil"><input type="file" id="impFil" accept=".xlsx,.xlsm,.ods,.csv,.txt,.tsv,.tab,.json,.vcf,text/csv,text/plain,application/json,text/vcard">Välj fil</label>
      <details class="more"><summary>Klistra in i stället</summary><textarea id="impText" rows="6" placeholder="Fastighet;Namn;Telefon;Mejl&#10;Ekbacken;Anna Andersson;070-123 45 67;anna@example.se"></textarea><button type="button" class="small" id="impTextOk">Läs in</button></details>
      <p class="hint">Saknar du en fil? <button type="button" class="linkbtn" id="impMall">Ladda ner en mall</button> och fyll i den i Excel.</p>
      <p class="status" id="impMsg">${fel?E(fel):""}</p>
      <div class="bdlg-btns"><button value="x" class="ghost">Avbryt</button></div></form>`;
    g("#impFil").onchange=async e=>{ const f=e.target.files[0]; if(!f) return; g("#impMsg").textContent="Läser filen…";
      try{ fil=await lasFil(f); fil.namn=f.name; borja(); }
      catch(err){ steg1({xls:"Det äldre Excel-formatet (.xls) kan inte läsas. Öppna filen i Excel och spara som .xlsx eller CSV.",format:"Den filtypen kan inte läsas. Exportera till Excel (.xlsx) eller CSV först.",json:"JSON-filen innehåller ingen lista att läsa."}[err&&err.message]||"Filen kunde inte läsas. Prova att spara den som .xlsx eller CSV."); } };
    g("#impTextOk").onclick=()=>{ const t=g("#impText").value; if(!t.trim()){ g("#impText").focus(); return; } fil=lasText(t); fil.namn="Inklistrad text"; borja(); };
    g("#impMall").onclick=()=>{ const csv="﻿Fastighet;Fastighetsbeteckning;Namn;Telefon;Mejl;Adress;Postnummer;Ort\r\nEkbacken;Byn 1:5;Anna Andersson;070-123 45 67;anna@example.se;Ekbacksvägen 5;123 45;Byn\r\n";
      const u=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"})), a=document.createElement("a"); a.href=u; a.download="medlemsregister-mall.csv"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u),60000); };
  };
  const borja=()=>{
    fil.blad=fil.blad.map(b=>({...b,rader:b.rader.filter(r=>r.some(c=>norm(c)))})).filter(b=>b.rader.length);
    if(!fil.blad.length){ steg1("Filen är tom."); return; }
    bladNr=Math.max(0,fil.blad.findIndex(b=>b.rader.length>1)); valjBlad(); steg2();
  };
  const valjBlad=()=>{ const r=fil.blad[bladNr].rader; rubriker=harRubriker(r); karta=gissa(rubriker?r[0]:[],rubriker?r.slice(1):r); };
  const kolumner=()=>{ const r=fil.blad[bladNr].rader, n=Math.max(...r.map(x=>x.length)); return [...Array(n)].map((_,j)=>rubriker&&norm(r[0][j])?norm(r[0][j]):`Kolumn ${j+1}${(r[rubriker?1:0]||[])[j]?": "+norm(r[rubriker?1:0][j]).slice(0,20):""}`); };
  const steg2=()=>{
    const kol=kolumner(), rad=fil.blad[bladNr].rader.slice(rubriker?1:0);
    const nya=rad.map(r=>tillRad(r,karta)); data=plan(nya,api.get(),bara);
    const sel=(k,lab)=>`<label>${lab}<select data-impk="${k}"><option value="">Används inte</option>${kol.map((c,j)=>`<option value="${j}" ${karta[k]===j?"selected":""}>${E(c)}</option>`).join("")}</select></label>`;
    const forh=nya.filter(n=>n.fastighet||n.namn).slice(0,5);
    const saknas=[!(karta.fastighet!=null||karta.beteckning!=null)&&"fastighet",!(karta.namn!=null||karta.fornamn!=null||karta.efternamn!=null)&&"namn"].filter(Boolean);
    d.innerHTML=`<form method="dialog"><h2>Importera medlemsregister</h2>
      <p class="meta">${E(fil.namn)} · ${rad.length} rader</p>
      ${fil.blad.length>1?`<label>Blad<select id="impBlad">${fil.blad.map((b,i)=>`<option value="${i}" ${i===bladNr?"selected":""}>${E(b.namn||"Blad "+(i+1))}</option>`).join("")}</select></label>`:""}
      <label class="check"><input type="checkbox" id="impRubr" ${rubriker?"checked":""}>Första raden är rubriker</label>
      <fieldset class="impkarta"><legend>Vilken kolumn är vad?</legend>
        ${sel("fastighet","Fastighet")}${sel("beteckning","Fastighetsbeteckning")}${sel("namn","Namn")}${sel("fornamn","Förnamn")}${sel("efternamn","Efternamn")}${sel("telefon","Telefon")}${sel("epost","Mejl")}${sel("adress","Adress")}${sel("postnr","Postnummer")}${sel("ort","Ort")}
      </fieldset>
      ${saknas.length?`<p class="notice">Välj vilken kolumn som innehåller ${saknas.join(" och ")}.</p>`:""}
      <div class="impforh"><table><thead><tr><th>Fastighet</th><th>Namn</th><th>Telefon</th><th>Mejl</th><th>Adress</th></tr></thead><tbody>${forh.map(n=>`<tr><td>${E(n.fastighet)}${n.beteckning&&n.beteckning!==n.fastighet?`<small>${E(n.beteckning)}</small>`:""}</td><td>${E(n.namn)}</td><td>${E(n.telefon)}</td><td>${E(n.epost)}</td><td>${E(n.adress)}</td></tr>`).join("")||`<tr><td colspan="5">Inga rader att visa.</td></tr>`}</tbody></table></div>
      <label class="check"><input type="checkbox" id="impBara" ${bara?"checked":""}>Ändra inte uppgifter som redan finns, fyll bara i det som saknas</label>
      <p class="impsum"><b>${data.ny.length}</b> nya · <b>${data.andrad.length}</b> uppdateras · ${data.lika} redan rätt${data.hoppad?` · ${data.hoppad} tomma hoppas över`:""}${data.dubblett?` · ${data.dubblett} dubbletter`:""}</p>
      <p class="hint">Kontakter med samma mejl, eller samma fastighet och namn, uppdateras i stället för att läggas till igen.</p>
      <p class="status" id="impMsg"></p>
      <div class="bdlg-btns"><button type="button" id="impOk" ${(!data.ny.length&&!data.andrad.length)||saknas.length?"disabled":""}>Importera</button><button type="button" class="ghost" id="impTill">Välj annan fil</button><button value="x" class="ghost">Avbryt</button></div></form>`;
    d.querySelectorAll("[data-impk]").forEach(s=>s.onchange=()=>{ const v=s.value; Object.keys(karta).forEach(k=>{ if(karta[k]===+v&&v!=="") delete karta[k]; }); if(v==="") delete karta[s.dataset.impk]; else karta[s.dataset.impk]=+v; steg2(); });
    if(g("#impBlad")) g("#impBlad").onchange=e=>{ bladNr=+e.target.value; valjBlad(); steg2(); };
    g("#impRubr").onchange=e=>{ rubriker=e.target.checked; const r=fil.blad[bladNr].rader; karta=gissa(rubriker?r[0]:[],rubriker?r.slice(1):r); steg2(); };
    g("#impBara").onchange=e=>{ bara=e.target.checked; steg2(); };
    g("#impTill").onclick=()=>steg1();
    g("#impOk").onclick=()=>{
      fore=JSON.parse(JSON.stringify(api.get()));
      const ut=data.rader.map(x=>x.id?x:{...x,id:api.nid()});
      api.set(ut);
      d.innerHTML=`<form method="dialog"><h2>Importen är klar</h2>
        <p><b>${data.ny.length}</b> nya kontakter och <b>${data.andrad.length}</b> uppdaterade. Registret sparas nu.</p>
        <p class="hint">Blev det fel kan du ångra hela importen direkt.</p>
        <div class="bdlg-btns"><button value="x">Stäng</button><button type="button" class="ghost" id="impAngra">Ångra importen</button></div></form>`;
      g("#impAngra").onclick=()=>{ api.set(fore); d.close(); api.msg("Importen är ångrad."); };
    };
  };
  steg1(); d.showModal();
};
window.medlemsimportTest={lasText,lasJson,lasVcf,lasXlsx,lasOds,gissa,tillRad,plan,harRubriker};
})();
