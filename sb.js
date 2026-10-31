/* Supabase adapter: provides window.claude.use(...) with the same API the page was built on,
   plus login with email link and access management for admin. */
(function(){
const SB_URL="https://xhoexctuopvragyqwofs.supabase.co";
const SB_KEY="sb_publishable_BqABNxP7VA8mG-_-K6voQw_JsTR2yQv";
const sb=window.supabase.createClient(SB_URL,SB_KEY,{auth:{persistSession:true,detectSessionInUrl:true,flowType:"implicit"}});
window.SB=sb;
window.BLOB_BASE=SB_URL+"/storage/v1/object/public/filer/";

let session=null, roll=null, readyRes; const ready=new Promise(r=>readyRes=r);
const cache=new Map(); const docSubs=new Map(); const colSubs=new Map();
const snap=(path)=>({exists:cache.has(path),id:path.split("/").pop(),metadata:{fromCache:false,hasPendingWrites:false},data:()=>cache.has(path)?JSON.parse(JSON.stringify(cache.get(path))):undefined});
function colSnap(c){ const n=c.split("/").length+1; const docs=[...cache.keys()].filter(k=>k.startsWith(c+"/")&&k.split("/").length===n).map(snap); return {docs,size:docs.length,forEach:f=>docs.forEach(f)}; }
function notify(path){
  (docSubs.get(path)||[]).forEach(cb=>{ try{cb(snap(path));}catch(e){} });
  colSubs.forEach((cbs,c)=>{ if(path.startsWith(c+"/")) cbs.forEach(cb=>{ try{cb(colSnap(c));}catch(e){} }); });
}
async function loadAll(){
  const {data,error}=await sb.from("docs").select("path,data");
  if(error) throw error;
  const seen=new Set();
  data.forEach(r=>{ seen.add(r.path); const old=JSON.stringify(cache.get(r.path)); cache.set(r.path,r.data); if(old!==JSON.stringify(r.data)) notify(r.path); });
  [...cache.keys()].forEach(k=>{ if(!seen.has(k)){ cache.delete(k); notify(k); } });
}
function realtime(){
  sb.channel("docs").on("postgres_changes",{event:"*",schema:"public",table:"docs"},p=>{
    if(p.eventType==="DELETE"){ const k=p.old&&p.old.path; if(k){ cache.delete(k); notify(k); } }
    else { cache.set(p.new.path,p.new.data); notify(p.new.path); }
  }).subscribe();
  setInterval(()=>{ if(document.visibilityState==="visible") loadAll().catch(()=>{}); },30000);
  document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") loadAll().catch(()=>{}); });
}
const db={
  doc(path){ return {
    onSnapshot(cb,err){ if(!docSubs.has(path)) docSubs.set(path,[]); docSubs.get(path).push(cb); cb(snap(path)); return ()=>{ const a=docSubs.get(path); a.splice(a.indexOf(cb),1); }; },
    async get(){ return snap(path); },
    async set(data){ const clean=JSON.parse(JSON.stringify(data)); const {error}=await sb.from("docs").upsert({path,data:clean,uppdaterad:new Date().toISOString()}); if(error) throw error; cache.set(path,clean); notify(path); },
    async delete(){ const {error}=await sb.from("docs").delete().eq("path",path); if(error) throw error; cache.delete(path); notify(path); }
  }; },
  collection(c){ return { doc:(id)=>db.doc(c+"/"+id),
    onSnapshot(cb,err){ if(!colSubs.has(c)) colSubs.set(c,[]); colSubs.get(c).push(cb); cb(colSnap(c)); return ()=>{}; } }; }
};
const user={
  isOwner:async()=>roll==="admin",
  canEdit:async()=>roll==="admin"||roll==="styrelse",
  can:async()=>!!roll,
  id:async()=>session&&session.user.id,
  me:async()=>({id:session&&session.user.id,name:session&&session.user.email}),
  profiles:async(ids)=>{ const o={}; if(!ids||!ids.length) return o; const {data}=await sb.rpc("namn_for",{ids}); (data||[]).forEach(r=>o[r.id]={name:r.namn}); return o; }
};
const assets={
  upload:async(blob)=>{ const ext=(blob.type==="application/pdf")?"pdf":(blob.type||"").includes("png")?"png":(blob.type||"").includes("webp")?"webp":"jpg";
    const id=crypto.randomUUID()+"."+ext; const {error}=await sb.storage.from("filer").upload(id,blob,{contentType:blob.type||undefined,upsert:false});
    if(error) throw error; return {id,url:window.BLOB_BASE+id,sizeBytes:blob.size,contentType:blob.type}; },
  delete:async(id)=>{ await sb.storage.from("filer").remove([id]); },
  list:async()=>({assets:[],usage:{}})
};
const downloads={ save:async({filename,data})=>{ const u=URL.createObjectURL(data); const a=document.createElement("a"); a.href=u; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u),5000); } };
window.claude={ use:async(name)=>{ await ready; if(!roll) return null;
  return ({db,user,assets:(roll==="admin"||roll==="styrelse")?assets:null,downloads})[name]||null; } };

/* ---------- login screen ---------- */
function gate(html){ let g=document.getElementById("gate"); if(!g){ g=document.createElement("div"); g.id="gate"; document.body.appendChild(g); } g.innerHTML=html; document.body.classList.add("gated"); }
function ungate(){ const g=document.getElementById("gate"); if(g) g.remove(); document.body.classList.remove("gated"); }
function loginForm(msg){
  gate(`<div class="gatebox"><p class="eyebrow">Väg 13986 · Mellösa, Flens kommun</p><h1>Baggetorp Hytternäs vägsamfällighet</h1>
   <p>Skriv din mejladress så skickar vi en inloggningslänk. Inget lösenord behövs. Är du ny får du be om tillgång efter inloggningen.</p>
   <label for="gEmail">Din mejladress<input id="gEmail" type="email" inputmode="email" autocomplete="email" placeholder="namn@exempel.se"></label>
   <button type="button" id="gSend">Skicka inloggningslänk</button><p class="gmsg" id="gMsg">${msg||""}</p></div>`);
  let busy=false, timer=null;
  const lock=(sek)=>{ const b=document.getElementById("gSend"); clearInterval(timer); let n=sek;
    const tick=()=>{ if(n<=0){ clearInterval(timer); b.disabled=false; b.textContent="Skicka ny länk"; return; } b.disabled=true; b.textContent=`Skicka ny länk om ${n} s`; n--; };
    tick(); timer=setInterval(tick,1000); };
  const send=async()=>{ if(busy) return; const email=document.getElementById("gEmail").value.trim().toLowerCase(); const m=document.getElementById("gMsg");
    if(!/^\S+@\S+\.\S+$/.test(email)){ m.textContent="Skriv en giltig mejladress."; return; }
    busy=true; document.getElementById("gSend").disabled=true; m.textContent="Skickar…";
    const {error}=await sb.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+location.pathname}});
    busy=false;
    if(!error){ m.innerHTML=`<strong>Länken är skickad till ${email.replace(/</g,"&lt;")}.</strong> Öppna mejlet från <strong>bhvf@vagappen.se</strong> och tryck på länken. Titta i skräpposten om det inte syns inom ett par minuter.`; lock(60); return; }
    const sek=Number((String(error.message||"").match(/after (\d+) seconds/)||[])[1]);
    if(error.status===429 && sek>=0 && String(error.message).includes("seconds")){ m.innerHTML=`<strong>Länken är redan skickad.</strong> Titta i inkorgen och i skräpposten efter ett mejl från bhvf@vagappen.se.`; lock(Math.max(sek,5)); return; }
    if(error.status===429){ m.textContent="Många försöker logga in just nu. Vänta några minuter och försök igen."; document.getElementById("gSend").disabled=false; return; }
    m.textContent="Det gick inte att skicka länken. Kontrollera adressen och försök igen om en stund."; document.getElementById("gSend").disabled=false; };
  document.getElementById("gSend").onclick=send;
  document.getElementById("gEmail").onkeydown=e=>{ if(e.key==="Enter") send(); };
}
async function start(s){
  if (document.readyState==="loading") await new Promise(r=>document.addEventListener("DOMContentLoaded",r,{once:true}));
  session=s;
  if(!s){ loginForm(); return; }
  const {data}=await sb.rpc("min_roll"); roll=data||null;
  if(!roll){ requestAccess(s); return; }
  try{ await loadAll(); }catch(e){}
  realtime(); ungate(); readyRes();
  const out=document.getElementById("logout"); if(out){ out.hidden=false; out.onclick=()=>sb.auth.signOut().then(()=>location.reload()); }
  const who=document.getElementById("who"); if(who) who.textContent=s.user.email;
  if(roll==="admin") accessMgr();
  if(roll==="admin"||roll==="styrelse") requestsMgr();
}
let started=false;
sb.auth.onAuthStateChange((ev,s)=>{ if(!started && (ev==="INITIAL_SESSION"||ev==="SIGNED_IN")){ started=true; start(s); if(location.hash.includes("access_token")) history.replaceState(null,"",location.pathname); } });

/* ---------- request access (logged in, but not yet approved) ---------- */
const H=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function requestAccess(s){
  const email=H(s.user.email);
  const out=()=>{ const b=document.getElementById("gOut"); if(b) b.onclick=()=>sb.auth.signOut().then(()=>location.reload()); };
  const {data:status}=await sb.rpc("min_ansokan");
  if(status==="vantar"){
    gate(`<div class="gatebox"><p class="eyebrow">Väntar på godkännande</p><h1>Tack, din förfrågan är skickad</h1>
     <p>Styrelsen har fått din förfrågan om tillgång för <strong>${email}</strong>. När den är godkänd kommer du in direkt här, utan ny inloggningslänk. Ladda om sidan senare.</p>
     <button type="button" id="gReload">Kontrollera igen</button><button type="button" id="gOut" class="ghost">Logga ut</button></div>`);
    document.getElementById("gReload").onclick=()=>location.reload(); out(); return;
  }
  if(status==="avslagen"){
    gate(`<div class="gatebox"><h1>Ingen behörighet</h1><p>Din förfrågan om tillgång för <strong>${email}</strong> har inte godkänts. Kontakta styrelsen om du tror att det är fel.</p><button type="button" id="gOut" class="ghost">Logga ut</button></div>`); out(); return;
  }
  gate(`<div class="gatebox"><p class="eyebrow">Inloggad som ${email}</p><h1>Be om tillgång</h1>
   <p>Din mejladress finns inte bland vägföreningens medlemmar ännu. Skicka en förfrågan, så godkänner styrelsen dig.</p>
   <label for="rNamn">Ditt namn<input id="rNamn" autocomplete="name" maxlength="120"></label>
   <label for="rFast">Fastighet eller adress längs vägen<input id="rFast" placeholder="t.ex. Hytternäs 1:5" maxlength="120"></label>
   <label for="rMedd">Meddelande till styrelsen (valfritt)<textarea id="rMedd" rows="3" maxlength="1000"></textarea></label>
   <button type="button" id="rSend">Skicka förfrågan</button><button type="button" id="gOut" class="ghost">Logga ut</button><p class="gmsg" id="rMsg"></p></div>`);
  out();
  document.getElementById("rSend").onclick=async()=>{
    const namn=document.getElementById("rNamn").value.trim(), fast=document.getElementById("rFast").value.trim(), m=document.getElementById("rMsg");
    if(!namn||!fast){ m.textContent="Fyll i namn och fastighet."; return; }
    m.textContent="Skickar…";
    const {error}=await sb.rpc("begar_tillgang",{p_namn:namn,p_fastighet:fast,p_meddelande:document.getElementById("rMedd").value.trim()});
    if(error){ m.textContent="Det gick inte att skicka. Försök igen om en stund."; return; }
    requestAccess(s);
  };
}

/* ---------- pending requests (admin and styrelse) ---------- */
async function requestsMgr(){
  const box=document.getElementById("reqMgr"); if(!box) return;
  async function render(msg){
    const {data,error}=await sb.from("ansokningar").select("*").order("skapad");
    if(error){ box.innerHTML=""; return; }
    const v=(data||[]).filter(r=>r.status==="vantar"), nej=(data||[]).filter(r=>r.status==="avslagen");
    if(!v.length&&!nej.length&&!msg){ box.innerHTML=""; return; }
    const d=t=>new Date(t).toLocaleDateString("sv-SE",{day:"numeric",month:"short"});
    box.innerHTML=`<div class="ph"><h2>Vill bli medlemmar${v.length?` <span class="count">${v.length}</span>`:""}</h2></div>
     <p class="hint">De här personerna har loggat in och bett om tillgång. Godkänner du får de rollen Medlem och kommer in direkt.</p>
     ${msg?`<p class="status">${H(msg)}</p>`:""}
     ${v.length?`<div class="req-list">${v.map(r=>`<div class="req"><div class="req-info"><strong>${H(r.namn||r.email)}</strong><small>${H(r.email)}</small>${r.fastighet?`<span>${H(r.fastighet)}</span>`:""}${r.meddelande?`<p>${H(r.meddelande)}</p>`:""}<small>Skickad ${d(r.skapad)}</small></div>
       <div class="req-btns"><button type="button" data-rok="${H(r.email)}">Godkänn</button><button type="button" class="ghost" data-rno="${H(r.email)}">Avslå</button></div></div>`).join("")}</div>`:`<p class="empty">Inga nya förfrågningar.</p>`}
     ${nej.length?`<details class="more"><summary>Avslagna (${nej.length})</summary><div class="req-list">${nej.map(r=>`<div class="req"><div class="req-info"><strong>${H(r.namn||r.email)}</strong><small>${H(r.email)}</small></div><div class="req-btns"><button type="button" class="ghost small" data-rok="${H(r.email)}">Godkänn ändå</button><button type="button" class="danger" data-rdel="${H(r.email)}">Ta bort</button></div></div>`).join("")}</div></details>`:""}`;
    box.querySelectorAll("[data-rok]").forEach(b=>b.onclick=async()=>{ b.disabled=true; const {error}=await sb.rpc("godkann_ansokan",{p_email:b.dataset.rok}); render(error?"Kunde inte godkänna.":b.dataset.rok+" är godkänd och kan nu logga in."); });
    box.querySelectorAll("[data-rno]").forEach(b=>b.onclick=async()=>{ if(b.textContent!=="Säker?"){ b.textContent="Säker?"; return; } const {error}=await sb.rpc("avsla_ansokan",{p_email:b.dataset.rno}); render(error?"Kunde inte avslå.":"Förfrågan avslagen."); });
    box.querySelectorAll("[data-rdel]").forEach(b=>b.onclick=async()=>{ if(b.textContent!=="Säker?"){ b.textContent="Säker?"; return; } const {error}=await sb.rpc("ta_bort_ansokan",{p_email:b.dataset.rdel}); render(error?"Kunde inte ta bort.":"Borttagen. Personen kan skicka en ny förfrågan."); });
  }
  render();
  setInterval(()=>{ if(document.visibilityState==="visible" && !box.contains(document.activeElement)) render(); },60000);
}

/* ---------- access management (admin) ---------- */
const ROLL={admin:"Admin",styrelse:"Styrelse",medlem:"Medlem"};
const STYR_ROLLER=["Ordförande","Vice ordförande","Kassör","Sekreterare","Ledamot","Suppleant"];
/* Ask which board role a person has and add/update them in the board list on the Styrelsen page. Resolves to a message or null if skipped. */
function boardDialog(email,namn){
  return new Promise(resolve=>{
    const site=JSON.parse(JSON.stringify(cache.get("site/main")||{}));
    const lc=x=>String(x||"").trim().toLowerCase();
    const mem=(site.medlemmar||[]).find(m=>lc(m.epost)===email)||{};
    const cur=(site.styrelse||[]).find(m=>lc(m.epost)===email);
    const nm=(cur&&cur.namn)||namn||mem.namn||"";
    const dlg=document.createElement("dialog"); dlg.className="bdlg";
    dlg.innerHTML=`<form method="dialog"><h2>Lägg till i styrelsen</h2>
      <p class="hint">${H(email)} får behörigheten Styrelse. Vilken roll har personen i styrelsen? Personen visas sedan under fliken Styrelsen.</p>
      <label>Namn<input id="bNamn" value="${H(nm)}" required></label>
      <label>Roll i styrelsen<select id="bRoll">${STYR_ROLLER.map(r=>`<option ${(cur&&cur.roll?cur.roll===r:r==="Ledamot")?"selected":""}>${r}</option>`).join("")}<option value="">Annan roll…</option></select></label>
      <label id="bAnnanL" hidden>Annan roll<input id="bAnnan" placeholder="t.ex. Vägansvarig"></label>
      <div class="grid2"><label>Telefon<input id="bTel" type="tel" value="${H((cur&&cur.telefon)||mem.telefon||"")}"></label>
      <label>Fastighet<input id="bFast" value="${H((cur&&cur.fastighet)||mem.fastighet||"")}"></label></div>
      <div class="bdlg-btns"><button value="ok" id="bOk">Lägg till i styrelsen</button><button value="skip" class="ghost" formnovalidate>Hoppa över</button></div></form>`;
    document.body.appendChild(dlg);
    if(cur&&cur.roll&&!STYR_ROLLER.includes(cur.roll)){ dlg.querySelector("#bRoll").value=""; dlg.querySelector("#bAnnanL").hidden=false; dlg.querySelector("#bAnnan").value=cur.roll; }
    dlg.querySelector("#bRoll").onchange=e=>{ dlg.querySelector("#bAnnanL").hidden=e.target.value!==""; };
    dlg.addEventListener("close",async()=>{
      const g=id=>dlg.querySelector(id).value.trim();
      const ok=dlg.returnValue==="ok", roll=g("#bRoll")||g("#bAnnan")||"Ledamot";
      const it={namn:g("#bNamn"),roll,telefon:g("#bTel"),fastighet:g("#bFast"),epost:email};
      dlg.remove();
      if(!ok) return resolve(null);
      const list=site.styrelse||[]; const i=list.findIndex(m=>lc(m.epost)===email);
      if(i>=0) list[i]={...list[i],...it}; else list.push({id:Math.random().toString(36).slice(2,9),...it});
      site.styrelse=list;
      try{ await db.doc("site/main").set(site); resolve(`${it.namn||email} är tillagd i styrelsen som ${roll}.`); }
      catch(e){ resolve("Behörigheten är sparad, men det gick inte att lägga till personen i styrelselistan."); }
    });
    dlg.showModal();
  });
}
async function accessMgr(){
  const box=document.getElementById("accessMgr"); if(!box) return;
  const E=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  async function render(msg){
    const {data}=await sb.from("roller").select("*").order("roll").order("email");
    const st={}; try{ const r=await sb.rpc("inloggningsstatus"); (r.data||[]).forEach(x=>st[x.email]=x.senast_inloggad); }catch(e){}
    const when=t=>{ if(!t) return `<em class="never">Har inte loggat in ännu</em>`; const d=new Date(t); return `<em class="seen">Senast inloggad ${d.toLocaleDateString("sv-SE",{day:"numeric",month:"short",year:"numeric"})} ${d.toLocaleTimeString("sv-SE",{hour:"2-digit",minute:"2-digit"})}</em>`; };
    const aktiva=(data||[]).filter(r=>st[r.email]).length;
    box.innerHTML=`<h2>Inloggning och behörighet</h2>
     <p class="hint">Bara adresser i listan kan logga in. Medlemmen går till sidans adress, skriver sin mejladress och får en inloggningslänk.</p>
     <div class="acc-add"><input id="aEmail" type="email" inputmode="email" placeholder="mejladress"><input id="aNamn" placeholder="namn (valfritt)">
      <select id="aRoll"><option value="medlem">Medlem</option><option value="styrelse">Styrelse</option><option value="admin">Admin</option></select>
      <button type="button" id="aAdd">Lägg till</button></div>
     <button type="button" class="ghost small" id="aSync">Lägg till alla mejladresser från medlemsregistret som medlemmar</button>
     <p class="status" id="aMsg">${msg||""}</p>
     <p class="acc-sum"><strong>${aktiva} av ${(data||[]).length}</strong> har loggat in minst en gång.</p>
     <div class="acc-list">${(data||[]).map(r=>`<div class="acc-row"><span><strong>${E(r.namn||r.email)}</strong><small>${E(r.email)}</small>${when(st[r.email])}</span>
      <select data-aroll="${E(r.email)}">${Object.entries(ROLL).map(([k,v])=>`<option value="${k}" ${k===r.roll?"selected":""}>${v}</option>`).join("")}</select>
      <button type="button" class="danger" data-adel="${E(r.email)}" aria-label="Ta bort">✕</button></div>`).join("")}</div>`;
    box.querySelector("#aAdd").onclick=async()=>{ const email=box.querySelector("#aEmail").value.trim().toLowerCase(); if(!/^\S+@\S+\.\S+$/.test(email)) return render("Skriv en giltig mejladress.");
      const roll=box.querySelector("#aRoll").value, namn=box.querySelector("#aNamn").value.trim();
      const {error}=await sb.from("roller").upsert({email,roll,namn}); if(error) return render("Kunde inte spara.");
      const extra = roll==="styrelse" ? await boardDialog(email,namn) : null;
      render(email+" kan nu logga in."+(extra?" "+extra:"")); };
    box.querySelector("#aSync").onclick=async()=>{ const site=cache.get("site/main")||{}; const have=new Set((data||[]).map(r=>r.email));
      const rows=(site.medlemmar||[]).filter(m=>(m.epost||"").includes("@")).map(m=>({email:m.epost.trim().toLowerCase(),roll:"medlem",namn:m.namn||""})).filter(r=>!have.has(r.email));
      if(!rows.length) return render("Alla adresser i registret finns redan med.");
      const {error}=await sb.from("roller").insert(rows); render(error?"Kunde inte spara.":rows.length+" medlemmar tillagda."); };
    box.querySelectorAll("[data-aroll]").forEach(s=>s.onchange=async()=>{ if(s.dataset.aroll===session.user.email.toLowerCase() && s.value!=="admin" && !confirm("Du tar bort din egen adminbehörighet. Fortsätta?")) return render();
      const {error}=await sb.from("roller").update({roll:s.value}).eq("email",s.dataset.aroll); if(error) return render("Kunde inte spara.");
      const r=(data||[]).find(x=>x.email===s.dataset.aroll)||{};
      const extra = s.value==="styrelse" ? await boardDialog(s.dataset.aroll,r.namn) : null;
      render(extra||"Sparat."); });
    let armed=null;
    box.querySelectorAll("[data-adel]").forEach(b=>b.onclick=async()=>{ if(armed!==b.dataset.adel){ armed=b.dataset.adel; b.textContent="Säker?"; return; }
      const {error}=await sb.from("roller").delete().eq("email",b.dataset.adel); render(error?"Kunde inte ta bort.":"Borttagen."); });
  }
  render();
}
})();
