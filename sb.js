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
   <p>Logga in med den mejladress som finns i medlemsregistret. Du får en länk i mejlen, och den loggar in dig. Inget lösenord behövs.</p>
   <label for="gEmail">Din mejladress<input id="gEmail" type="email" inputmode="email" autocomplete="email" placeholder="namn@exempel.se"></label>
   <button type="button" id="gSend">Skicka inloggningslänk</button><p class="gmsg" id="gMsg">${msg||""}</p></div>`);
  const send=async()=>{ const email=document.getElementById("gEmail").value.trim().toLowerCase(); const m=document.getElementById("gMsg");
    if(!/^\S+@\S+\.\S+$/.test(email)){ m.textContent="Skriv en giltig mejladress."; return; }
    m.textContent="Skickar…";
    const {error}=await sb.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+location.pathname}});
    m.textContent = error ? "Det gick inte att skicka länken. Försök igen om en stund." : "Klart! Öppna mejlet från vägföreningen och tryck på länken. Titta i skräpposten om det inte kommer inom några minuter."; };
  document.getElementById("gSend").onclick=send;
  document.getElementById("gEmail").onkeydown=e=>{ if(e.key==="Enter") send(); };
}
async function start(s){
  if (document.readyState==="loading") await new Promise(r=>document.addEventListener("DOMContentLoaded",r,{once:true}));
  session=s;
  if(!s){ loginForm(); return; }
  const {data}=await sb.rpc("min_roll"); roll=data||null;
  if(!roll){ gate(`<div class="gatebox"><h1>Ingen behörighet ännu</h1><p>Du är inloggad som <strong>${s.user.email.replace(/</g,"&lt;")}</strong>, men adressen är inte inbjuden till vägföreningens sidor. Kontakta styrelsen så lägger de till dig.</p><button type="button" id="gOut" class="ghost">Logga ut</button></div>`); document.getElementById("gOut").onclick=()=>sb.auth.signOut().then(()=>location.reload()); return; }
  try{ await loadAll(); }catch(e){}
  realtime(); ungate(); readyRes();
  const out=document.getElementById("logout"); if(out){ out.hidden=false; out.onclick=()=>sb.auth.signOut().then(()=>location.reload()); }
  const who=document.getElementById("who"); if(who) who.textContent=s.user.email;
  if(roll==="admin") accessMgr();
}
let started=false;
sb.auth.onAuthStateChange((ev,s)=>{ if(!started && (ev==="INITIAL_SESSION"||ev==="SIGNED_IN")){ started=true; start(s); if(location.hash.includes("access_token")) history.replaceState(null,"",location.pathname); } });

/* ---------- access management (admin) ---------- */
const ROLL={admin:"Admin",styrelse:"Styrelse",medlem:"Medlem"};
async function accessMgr(){
  const box=document.getElementById("accessMgr"); if(!box) return;
  const E=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  async function render(msg){
    const {data}=await sb.from("roller").select("*").order("roll").order("email");
    box.innerHTML=`<h2>Inloggning och behörighet</h2>
     <p class="hint">Bara adresser i listan kan logga in. Medlemmen går till sidans adress, skriver sin mejladress och får en inloggningslänk.</p>
     <div class="acc-add"><input id="aEmail" type="email" inputmode="email" placeholder="mejladress"><input id="aNamn" placeholder="namn (valfritt)">
      <select id="aRoll"><option value="medlem">Medlem</option><option value="styrelse">Styrelse</option><option value="admin">Admin</option></select>
      <button type="button" id="aAdd">Lägg till</button></div>
     <button type="button" class="ghost small" id="aSync">Lägg till alla mejladresser från medlemsregistret som medlemmar</button>
     <p class="status" id="aMsg">${msg||""}</p>
     <div class="acc-list">${(data||[]).map(r=>`<div class="acc-row"><span><strong>${E(r.namn||r.email)}</strong><small>${E(r.email)}</small></span>
      <select data-aroll="${E(r.email)}">${Object.entries(ROLL).map(([k,v])=>`<option value="${k}" ${k===r.roll?"selected":""}>${v}</option>`).join("")}</select>
      <button type="button" class="danger" data-adel="${E(r.email)}" aria-label="Ta bort">✕</button></div>`).join("")}</div>`;
    box.querySelector("#aAdd").onclick=async()=>{ const email=box.querySelector("#aEmail").value.trim().toLowerCase(); if(!/^\S+@\S+\.\S+$/.test(email)) return render("Skriv en giltig mejladress.");
      const {error}=await sb.from("roller").upsert({email,roll:box.querySelector("#aRoll").value,namn:box.querySelector("#aNamn").value.trim()}); render(error?"Kunde inte spara.":email+" kan nu logga in."); };
    box.querySelector("#aSync").onclick=async()=>{ const site=cache.get("site/main")||{}; const have=new Set((data||[]).map(r=>r.email));
      const rows=(site.medlemmar||[]).filter(m=>(m.epost||"").includes("@")).map(m=>({email:m.epost.trim().toLowerCase(),roll:"medlem",namn:m.namn||""})).filter(r=>!have.has(r.email));
      if(!rows.length) return render("Alla adresser i registret finns redan med.");
      const {error}=await sb.from("roller").insert(rows); render(error?"Kunde inte spara.":rows.length+" medlemmar tillagda."); };
    box.querySelectorAll("[data-aroll]").forEach(s=>s.onchange=async()=>{ if(s.dataset.aroll===session.user.email.toLowerCase() && s.value!=="admin" && !confirm("Du tar bort din egen adminbehörighet. Fortsätta?")) return render();
      const {error}=await sb.from("roller").update({roll:s.value}).eq("email",s.dataset.aroll); render(error?"Kunde inte spara.":"Sparat."); });
    let armed=null;
    box.querySelectorAll("[data-adel]").forEach(b=>b.onclick=async()=>{ if(armed!==b.dataset.adel){ armed=b.dataset.adel; b.textContent="Säker?"; return; }
      const {error}=await sb.from("roller").delete().eq("email",b.dataset.adel); render(error?"Kunde inte ta bort.":"Borttagen."); });
  }
  render();
}
})();
