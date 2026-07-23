const CLOUDINARY={cloudName:'dmkpb05ww',uploadPreset:'Vezitivus',folder:'Vezitivus'};

(async()=>{
 const s=MS.session();
 if(!s?.playerId||!s?.seasonId||!s?.authToken)return resetSession();
 let db=await MS.api('bootstrap');
 let p=db.players.find(x=>String(x.id)===String(s.playerId));
 const season=db.seasons.find(x=>String(x.id)===String(s.seasonId));
 if(!p||!season){return resetSession()}

 const isAdmin=p.isAdmin===true||String(p.isAdmin).toLowerCase()==='true';
 if(isAdmin)adminLink.classList.remove('hidden');
 const refreshedSession={...s,isAdmin};
 MS.setSession(refreshedSession);

 const board=UI.leaderboard(db,season.id),me=board.find(x=>String(x.id)===String(p.id)),next=UI.nextActivity(db,season.id);
 seasonName.textContent=season.name;
 playerName.textContent=p.name;
 setAvatar(p);
 rankPill.textContent=`#${me?.rank||'—'} kopvērtējumā · Best ${season.bestCount}`;
 total.textContent=me?.total||0;
 events.textContent=me?.events||0;
 avg.textContent=me?.events?me.avg.toFixed(1).replace('.',','):'0';

 if(next){
  nextTitle.textContent=next.name;
  nextDate.textContent=UI.fmtDate(next.startAt);
  nextDescription.textContent=next.description||'';
  const reg=db.registrations.find(r=>String(r.activityId)===String(next.id)&&String(r.playerId)===String(p.id)&&r.status!=='removed');
  if(reg){showNotice(registerState,'Tu esi pieteicies šai aktivitātei.')}
  else if(UI.registrationOpen(next)){
   registerBtn.classList.remove('hidden');
   registerBtn.onclick=async()=>{
    registerBtn.disabled=true;
    registerBtn.textContent='Piesaka…';
    try{
     await MS.api('register',{activityId:next.id,playerId:p.id,seasonId:season.id,status:'registered',authToken:s.authToken});
     location.reload();
    }catch(error){registerBtn.disabled=false;registerBtn.textContent='Pieteikties';alert(error.message)}
   };
  }else showNotice(registerState,'Pieteikšanās vēl nav atvērta vai jau ir slēgta.');
 }

 const rows=db.results.filter(r=>String(r.playerId)===String(p.id)).map(r=>({...r,a:db.activities.find(a=>String(a.id)===String(r.activityId))})).sort((a,b)=>new Date(b.a?.startAt)-new Date(a.a?.startAt));
 history.innerHTML=rows.length?rows.map(r=>`<div class="row"><div class="row-main"><div class="row-title">${UI.esc(r.a?.name||'Aktivitāte')}</div><div class="row-sub">${UI.fmtDate(r.a?.startAt)}</div></div><div class="points">${Number(r.points)||0}</div></div>`).join(''):'<div class="card empty">Rezultātu vēl nav.</div>';

 saveImage.textContent=p.image?'Nomainīt attēlu':'Izvēlēties attēlu';
 saveImage.onclick=()=>imageInput.click();
 imageInput.onchange=async()=>{
  const file=imageInput.files?.[0];
  imageInput.value='';
  if(!file)return;
  if(!file.type?.startsWith('image/'))return showNotice(imageState,'Izvēlies attēla failu.',true);
  if(file.size>15*1024*1024)return showNotice(imageState,'Attēls ir par lielu. Maksimālais izmērs ir 15 MB.',true);
  saveImage.disabled=true;
  saveImage.textContent='Augšupielādē…';
  showNotice(imageState,'Notiek attēla sagatavošana un augšupielāde…');
  try{
   const optimized=await compressImage(file);
   const form=new FormData();
   form.append('file',optimized);
   form.append('upload_preset',CLOUDINARY.uploadPreset);
   form.append('folder',CLOUDINARY.folder);
   const response=await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/image/upload`,{method:'POST',body:form});
   const result=await response.json();
   if(!response.ok||!result.secure_url||!result.public_id)throw new Error(result?.error?.message||'Cloudinary augšupielāde neizdevās.');
   p=await MS.api('updatePlayer',{id:p.id,authToken:s.authToken,image:result.secure_url,imagePublicId:result.public_id});
   setAvatar(p);
   saveImage.textContent='Nomainīt attēlu';
   showNotice(imageState,'Attēls saglabāts.');
  }catch(error){showNotice(imageState,error.message||'Neizdevās saglabāt attēlu.',true)}
  finally{saveImage.disabled=false;if(saveImage.textContent==='Augšupielādē…')saveImage.textContent=p.image?'Nomainīt attēlu':'Izvēlēties attēlu'}
 };

 logoutBtn.onclick=switchLink.onclick=()=>MS.clearSession();
})().catch(e=>{document.body.innerHTML=`<main class="shell"><div class="card"><h2>Kļūda</h2><p>${UI.esc(e.message)}</p></div></main>`});

function resetSession(){MS.clearSession();location.replace('index.html')}
function setAvatar(player){avatar.src=player.image||`https://ui-avatars.com/api/?name=${encodeURIComponent(player.name)}&background=e5e7eb&color=111827&size=256`;}
function showNotice(el,message,isError=false){el.textContent=message;el.classList.remove('hidden');el.style.color=isError?'#b42318':'';}
async function compressImage(file){
 if(file.size<=900*1024)return file;
 try{
  const bitmap=await createImageBitmap(file),maxSide=1400,scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));
  if(scale>=1)return file;
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.88));
  return blob?new File([blob],'profile.jpg',{type:'image/jpeg'}):file;
 }catch{return file}
}