const CLOUDINARY={cloudName:'dmkpb05ww',uploadPreset:'Vezitivus',folder:'Vezitivus'};
let db=MS.cache()||{},player=null,activeSeason=null;

function busy(on,text='Meklējam sēriju…',subtext='Lūdzu, uzgaidi.'){
  if(typeof syncText!=='undefined')syncText.textContent=text;
  if(typeof syncSubtext!=='undefined')syncSubtext.textContent=subtext;
  if(typeof syncOverlay!=='undefined')syncOverlay.classList.toggle('show',on);
}

(async()=>{
  const s=MS.session();
  if(!s?.playerId||!s?.authToken)return location.replace('index.html');
  renderCached(s);
  syncState.innerHTML='<span class="sync-dot"></span>Atjaunojam datus…';
  try{
    db=await MS.sync({playerId:s.playerId,authToken:s.authToken});
    renderFromData(s);
    syncState.innerHTML='<span class="sync-dot"></span>Sinhronizēts';
  }catch(e){
    if(!player)return showFatal(e);
    syncState.textContent='Bezsaistes režīms';
  }
  bindActions();
})().catch(showFatal);

function renderCached(s){
  const cached=MS.cache()||{};
  db=cached;
  player=(cached.players||[]).find(x=>String(x.id)===String(s.playerId));
  if(player){
    playerName.textContent=player.name;
    setAvatar(player);
    renderSeries();
  }
}

function renderFromData(s){
  player=(db.players||[]).find(x=>String(x.id)===String(s.playerId));
  if(!player){
    MS.clearSession();
    return location.replace('index.html');
  }
  playerName.textContent=player.name;
  setAvatar(player);
  renderSeries();
}

function renderSeries(){
  const memberships=UI.membershipsFor(db,player.id);
  const seasons=memberships
    .map(m=>(db.seasons||[]).find(s=>String(s.id)===String(m.seasonId)))
    .filter(Boolean);
  const session=MS.session();
  const chosen=seasons.find(s=>String(s.id)===String(session?.seasonId))||seasons[0]||null;
  seasonSelect.innerHTML=seasons.length
    ?'<option value="">Izvēlies sēriju</option>'+seasons.map(s=>`<option value="${s.id}" ${chosen&&String(s.id)===String(chosen.id)?'selected':''}>${UI.esc(s.name)}</option>`).join('')
    :'<option value="">Vēl neesi pievienojies sērijai</option>';
  seasonSelect.disabled=!seasons.length;
  seasonSelect.onchange=()=>selectSeason(seasonSelect.value);
  selectSeason(chosen?.id||'');
}

function selectSeason(id){
  activeSeason=(db.seasons||[]).find(s=>String(s.id)===String(id))||null;
  const s=MS.session();
  MS.setSession({...s,seasonId:activeSeason?.id||''});
  activeSeasonTitle.textContent=activeSeason?.name||'Profils darbojas arī bez sērijas';
  seriesContent.classList.toggle('hidden',!activeSeason);
  leaderboardLink.classList.toggle('hidden',!activeSeason);
  if(activeSeason)renderSeasonData();
}

function renderSeasonData(){
  registerBtn.classList.add('hidden');
  registerState.classList.add('hidden');
  nextDate.textContent='';
  nextDescription.textContent='';
  const board=UI.leaderboard(db,activeSeason.id);
  const me=board.find(x=>String(x.id)===String(player.id));
  const next=UI.nextActivity(db,activeSeason.id);
  rankPill.textContent=`#${me?.rank||'—'} kopvērtējumā · Best ${activeSeason.bestCount||12}`;
  total.textContent=me?.total||0;
  events.textContent=me?.events||0;
  avg.textContent=me?.events?me.avg.toFixed(1).replace('.',','):'0';
  if(next){
    nextTitle.textContent=next.name;
    nextDate.textContent=UI.fmtDate(next.startAt);
    nextDescription.textContent=next.description||'';
    const reg=(db.registrations||[]).find(r=>String(r.activityId)===String(next.id)&&String(r.playerId)===String(player.id)&&r.status!=='removed');
    if(reg){
      showNotice(registerState,'Tu esi pieteicies šai aktivitātei.');
    }else if(UI.registrationOpen(next)){
      registerBtn.classList.remove('hidden');
      registerBtn.onclick=async()=>{
        registerBtn.disabled=true;
        busy(true,'Saglabājam pieteikumu…','Pārbaudām datus un atjaunojam profilu.');
        try{
          await MS.api('register',{playerId:player.id,authToken:MS.session().authToken,seasonId:activeSeason.id,activityId:next.id,status:'registered'});
          await refresh();
        }catch(e){
          alert(e.message);
        }finally{
          registerBtn.disabled=false;
          busy(false);
        }
      };
    }else{
      showNotice(registerState,'Pieteikšanās nav atvērta.');
    }
  }else{
    nextTitle.textContent='Pašlaik nav ieplānota';
  }
  const rows=(db.results||[])
    .filter(r=>String(r.seasonId)===String(activeSeason.id)&&String(r.playerId)===String(player.id))
    .map(r=>({...r,a:(db.activities||[]).find(a=>String(a.id)===String(r.activityId))}))
    .sort((a,b)=>new Date(b.a?.startAt)-new Date(a.a?.startAt));
  history.innerHTML=rows.length
    ?rows.map(r=>`<div class="row"><div class="row-main"><div class="row-title">${UI.esc(r.a?.name||'Aktivitāte')}</div><div class="row-sub">${UI.fmtDate(r.a?.startAt)}</div></div><div class="points">${Number(r.points)||0}</div></div>`).join('')
    :'<div class="card empty">Rezultātu vēl nav.</div>';
}

function bindActions(){
  avatar.onclick=()=>imageInput.click();
  imageInput.onchange=uploadImage;
  joinSeriesForm.onsubmit=joinSeries;
  logoutBtn.onclick=switchLink.onclick=()=>{
    MS.clearSession();
    MS.clearCache();
  };
}

async function joinSeries(e){
  e.preventDefault();
  const code=seriesCode.value.trim().toUpperCase();
  if(!code)return;
  joinSeriesButton.disabled=true;
  seriesState.classList.add('hidden');
  busy(true,'Meklējam sēriju…','Pārbaudām kodu un ielādējam sērijas datus.');
  try{
    const res=await MS.api('joinSeries',{playerId:player.id,authToken:MS.session().authToken,code});
    busy(true,'Saglabājam sēriju…','Pievienojam sēriju tavam profilam un sinhronizējam datus.');
    seriesCode.value='';
    await refresh(res.season.id);
    showNotice(seriesState,`Pievienots: ${res.season.name}`);
  }catch(err){
    showNotice(seriesState,err.message,true);
  }finally{
    joinSeriesButton.disabled=false;
    busy(false);
  }
}

async function uploadImage(){
  const file=imageInput.files?.[0];
  imageInput.value='';
  if(!file)return;
  busy(true,'Saglabājam attēlu…','Augšupielādējam un sinhronizējam profilu.');
  try{
    const form=new FormData();
    form.append('file',file);
    form.append('upload_preset',CLOUDINARY.uploadPreset);
    form.append('folder',CLOUDINARY.folder);
    const response=await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/image/upload`,{method:'POST',body:form});
    const result=await response.json();
    if(!response.ok||!result.secure_url)throw new Error('Neizdevās saglabāt attēlu.');
    player=await MS.api('updateProfile',{playerId:player.id,authToken:MS.session().authToken,image:result.secure_url,imagePublicId:result.public_id||''});
    setAvatar(player);
    await refresh();
    syncState.innerHTML='<span class="sync-dot"></span>Sinhronizēts';
  }catch(e){
    syncState.textContent=e.message;
  }finally{
    busy(false);
  }
}

async function refresh(preferredSeasonId){
  db=await MS.sync({playerId:player.id,authToken:MS.session().authToken});
  if(preferredSeasonId){
    const s=MS.session();
    MS.setSession({...s,seasonId:preferredSeasonId});
  }
  renderFromData(MS.session());
}

function setAvatar(p){
  avatar.src=p.image||`https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=e5e7eb&color=111827&size=256`;
}

function showNotice(el,msg,error=false){
  el.textContent=msg;
  el.classList.remove('hidden');
  el.style.color=error?'#b42318':'';
}

function showFatal(e){
  busy(false);
  document.body.innerHTML=`<main class="shell"><div class="card"><h2>Kļūda</h2><p>${UI.esc(e.message||e)}</p></div></main>`;
}