const API="/api";

function toast(msg){
  const t=document.getElementById("toast"); if(!t)return;
  t.textContent=msg; t.classList.add("show");
  clearTimeout(window.toastTimer); window.toastTimer=setTimeout(()=>t.classList.remove("show"),2600);
}
function escapeHTML(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function getVoterId(){
  let id=localStorage.getItem("sortitVoterId");
  if(!id){
    id=(globalThis.crypto&&crypto.randomUUID)?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("sortitVoterId",id);
  }
  return id;
}
async function api(url,options={}){
  const headers={...(options.headers||{})};
  if(options.body && !(options.body instanceof FormData))headers["Content-Type"]="application/json";
  headers["X-Voter-Id"]=getVoterId();
  const r=await fetch(API+url,{...options,headers,credentials:"same-origin"});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||"Request failed");
  return data;
}
async function getMe(){return (await api("/auth/me")).user}

function setupNav(){
  document.querySelectorAll(".nav-link").forEach(a=>a.addEventListener("click",()=>document.getElementById("mainNav")?.classList.remove("open")));
  document.getElementById("mobileMenu")?.addEventListener("click",()=>{
    const nav=document.getElementById("mainNav");nav.classList.toggle("open");
    if(nav.classList.contains("open")){nav.style.display="flex";nav.style.flexDirection="column";nav.style.position="absolute";nav.style.top="72px";nav.style.left="0";nav.style.right="0";nav.style.background="#fff";nav.style.padding="15px 6%"}
    else nav.removeAttribute("style");
  });
  document.getElementById("searchBtn")?.addEventListener("click",()=>document.getElementById("searchPanel")?.classList.toggle("hidden"));
  document.getElementById("clearSearch")?.addEventListener("click",()=>{const i=document.getElementById("searchInput");if(i)i.value="";renderIssues();document.getElementById("searchPanel")?.classList.add("hidden")});
  document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>document.getElementById(b.dataset.close)?.classList.add("hidden")));
  document.getElementById("loginBtn")?.addEventListener("click",async()=>{
    const user=await getMe().catch(()=>null);
    if(user){toast(`Signed in as ${user.name}`);return}
    document.getElementById("loginModal")?.classList.remove("hidden");
  });
  setupAuth();
  updateNavUser();
}
function setupAuth(){
  const submit=document.getElementById("authSubmit"); if(!submit)return;
  let registerMode=false;
  const name=document.getElementById("authName"), email=document.getElementById("authEmail"), password=document.getElementById("authPassword");
  const title=document.getElementById("authTitle"), hint=document.getElementById("authHint"), sw=document.getElementById("authSwitch");
  function mode(){
    name.style.display=registerMode?"block":"none";
    submit.textContent=registerMode?"Create account":"Log in";
    sw.textContent=registerMode?"I already have an account":"Create a new account";
    title.textContent=registerMode?"Create your Sort It account":"Welcome to Sort It";
    hint.textContent=registerMode?"Use your own account so your profile and votes follow you.":"Log in to keep your profile and votes across devices.";
  }
  sw?.addEventListener("click",()=>{registerMode=!registerMode;mode()});
  submit.addEventListener("click",async()=>{
    const payload=registerMode?{name:name.value,email:email.value,password:password.value}:{email:email.value,password:password.value};
    try{
      const data=await api(registerMode?"/auth/register":"/auth/login",{method:"POST",body:JSON.stringify(payload)});
      document.getElementById("loginModal")?.classList.add("hidden");
      toast(`Welcome, ${data.user.name}!`);
      updateNavUser();
    }catch(e){toast(e.message)}
  });
  mode();
}
async function updateNavUser(){
  const b=document.getElementById("loginBtn");if(!b)return;
  const user=await getMe().catch(()=>null);
  if(user){b.textContent=user.name;b.title="Logged in";b.classList.add("user-name")}
  else {b.textContent="Login";b.classList.remove("user-name")}
}

async function renderIssues(){
  const grid=document.getElementById("issueGrid");if(!grid)return;
  const filter=document.querySelector(".filter.active")?.dataset.filter||"all";
  const search=document.getElementById("searchInput")?.value||"";
  try{
    const params=new URLSearchParams({category:filter,search});
    const issues=await api(`/issues?${params}`);
    grid.innerHTML=issues.map(x=>`<article class="issue-card"><div class="issue-image"><span>${escapeHTML(x.category)}</span></div><div class="issue-body"><h3>${escapeHTML(x.title)}</h3><div class="meta">⌖ ${escapeHTML(x.location)}</div><p class="issue-desc">${escapeHTML(x.description.slice(0,120))}${x.description.length>120?"…":""}</p><div class="issue-bottom"><button class="vote-btn" data-vote="${x.id}">↑ Support <span>${Number(x.votes).toLocaleString()}</span></button><span>${escapeHTML(x.status)}</span></div></div></article>`).join("");
    document.getElementById("issueEmpty")?.classList.toggle("hidden",issues.length>0);
    grid.querySelectorAll("[data-vote]").forEach(b=>b.addEventListener("click",async()=>{
      try{const result=await api(`/issues/${b.dataset.vote}/vote`,{method:"POST"});b.querySelector("span").textContent=Number(result.votes).toLocaleString();b.disabled=true;b.textContent=`✓ Supported ${Number(result.votes).toLocaleString()}`;toast("Support recorded.")}catch(e){toast(e.message)}
    }));
  }catch(e){grid.innerHTML="";document.getElementById("issueEmpty")?.classList.remove("hidden");toast(e.message)}
}
async function renderPolls(){
  const box=document.getElementById("pollList");if(!box)return;
  try{
    const data=await api("/polls");
    box.innerHTML=data.map(p=>`<div class="poll-card"><div><h3>${escapeHTML(p.question)}</h3><p>${Number(p.total).toLocaleString()} people voted</p><select class="poll-select" data-poll="${p.id}">${p.options.map((o,i)=>`<option value="${i}">${escapeHTML(o.text)}</option>`).join("")}</select><button class="btn btn-primary poll-vote" data-submit-poll="${p.id}">Vote / Change Vote</button></div><div>${p.options.map(o=>{const pct=p.total?Math.round(o.votes/p.total*100):0;return `<div class="poll-option"><div class="poll-line"><span>${escapeHTML(o.text)}</span><strong>${pct}%</strong></div><div class="bar"><i style="width:${pct}%"></i></div></div>`}).join("")}</div></div>`).join("");
    box.querySelectorAll("[data-submit-poll]").forEach(b=>b.addEventListener("click",async()=>{
      const id=b.dataset.submitPoll,select=box.querySelector(`select[data-poll="${id}"]`);
      try{const result=await api(`/polls/${id}/vote`,{method:"POST",body:JSON.stringify({optionIndex:Number(select.value)})});await renderPolls();toast(result.changed?"Your vote was changed.":"Your vote was recorded.");}
      catch(e){toast(e.message)}
    }));
  }catch(e){toast(e.message)}
}
async function loadStats(){
  try{
    const s=await api("/stats");
    document.getElementById("statReported").textContent=s.issuesReported.toLocaleString();
    document.getElementById("statVoters").textContent=s.activeVoters.toLocaleString();
    document.getElementById("statResolved").textContent=s.issuesResolved.toLocaleString();
    document.getElementById("statCities").textContent=s.citiesCovered.toLocaleString();
  }catch(e){console.warn(e)}
}
function setupHome(){
  if(!document.getElementById("issueGrid"))return;
  document.querySelectorAll(".filter").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll(".filter").forEach(x=>x.classList.remove("active"));b.classList.add("active");renderIssues()}));
  let timer;document.getElementById("searchInput")?.addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(renderIssues,250)});
  renderIssues();renderPolls();loadStats();
}
function setupReport(){
  const form=document.getElementById("issueForm");if(!form)return;
  const desc=form.querySelector('[name="description"]');
  desc.addEventListener("input",()=>document.getElementById("charCount").textContent=desc.value.length);
  document.getElementById("locationBtn")?.addEventListener("click",()=>{
    if(!navigator.geolocation){toast("Your browser does not provide location. Enter the location manually.");return}
    toast("Requesting your exact device location...");
    navigator.geolocation.getCurrentPosition(
      p=>{document.getElementById("location").value=`GPS: ${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`;toast("Exact location added.")},
      ()=>toast("Location permission was denied or unavailable. No demo location was inserted."),
      {enableHighAccuracy:true,timeout:15000,maximumAge:0}
    );
  });
  document.getElementById("evidence")?.addEventListener("change",e=>{const files=[...e.target.files];document.getElementById("fileNote").textContent=files.length?`${files.length} file(s) selected`:"Add photos or videos that help explain the issue.";if(files.length>5){e.target.value="";document.getElementById("fileNote").textContent="Please select no more than 5 files.";toast("Maximum 5 files.")}});
  form.addEventListener("submit",async e=>{
    e.preventDefault();
    if(!form.checkValidity()){form.reportValidity();toast("Please complete the required fields.");return}
    try{await api("/issues",{method:"POST",body:new FormData(form)});document.getElementById("successModal").classList.remove("hidden");form.reset();document.getElementById("charCount").textContent="0";}
    catch(err){toast(err.message)}
  });
}
async function setupSettings(){
  const box=document.getElementById("profileBox");if(!box)return;
  const user=await getMe().catch(()=>null);
  if(!user){box.innerHTML='<p>You are not logged in. Return to the home page and create an account.</p>';return}
  box.innerHTML=`<h2>${escapeHTML(user.name)}</h2><p class="muted">${escapeHTML(user.email)}</p>`;
  document.getElementById("notifyIssues").checked=localStorage.getItem("sortitNotify")==="1";
  document.getElementById("rememberSettings").checked=localStorage.getItem("sortitRemember")==="1";
  document.getElementById("saveSettings")?.addEventListener("click",()=>{localStorage.setItem("sortitNotify",document.getElementById("notifyIssues").checked?"1":"0");localStorage.setItem("sortitRemember",document.getElementById("rememberSettings").checked?"1":"0");toast("Settings saved.")});
  document.getElementById("logoutBtn")?.addEventListener("click",async()=>{await api("/auth/logout",{method:"POST"});location.href="index.html"});
  document.getElementById("clearLocation")?.addEventListener("click",()=>{localStorage.removeItem("sortitLocation");toast("Saved location cleared.")});
}
setupNav();setupHome();setupReport();setupSettings();
