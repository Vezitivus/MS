const SHEET_ID='1-nheGOekslHRIf1KCeLDR5v-NN9oFtsCtfO082zQkHo';
const TABLES={seasons:'Seasons',players:'Players',activities:'Activities',registrations:'Registrations',results:'Results',audit:'Audit'};
const HEADERS={
 seasons:['id','name','code','bestCount','active','createdAt','updatedAt'],
 players:['id','seasonId','name','image','createdAt','updatedAt','imagePublicId','isAdmin','authToken'],
 activities:['id','seasonId','name','startAt','registrationOpenAt','registrationCloseAt','description','createdAt','updatedAt'],
 registrations:['id','seasonId','activityId','playerId','status','createdAt','updatedAt'],
 results:['id','seasonId','activityId','playerId','points','createdAt','updatedAt'],
 audit:['id','action','payload','createdAt']
};

function doGet(e){
 let response;
 try{
  setup();
  const action=String(e&&e.parameter&&e.parameter.action||'bootstrap');
  let payload={};
  if(e&&e.parameter&&e.parameter.payload){try{payload=JSON.parse(e.parameter.payload)}catch(_){throw new Error('Nederīgs payload JSON.')}}
  const data=route_(action,payload);
  if(action!=='bootstrap')audit_(action,safeAuditPayload_(payload));
  response={ok:true,data:data,service:'MS Season API'};
 }catch(error){response={ok:false,error:errorMessage_(error)}}
 const callback=e&&e.parameter&&e.parameter.callback;
 return callback?javascript_(callback,response):json_(response);
}

function doPost(e){
 try{
  setup();
  const req=JSON.parse(e&&e.postData&&e.postData.contents||'{}');
  if(!req.action)throw new Error('Nav norādīta API darbība.');
  const payload=req.payload||{};
  const data=route_(String(req.action),payload);
  if(req.action!=='bootstrap')audit_(String(req.action),safeAuditPayload_(payload));
  return json_({ok:true,data:data});
 }catch(error){return json_({ok:false,error:errorMessage_(error)})}
}

function route_(action,p){
 switch(action){
  case'bootstrap':return bootstrap_();
  case'joinPlayer':return joinPlayer_(p);
  case'updatePlayer':return updatePlayer_(p);
  case'register':return registerSelf_(p);
  case'saveSeason':requireAdmin_(p);return saveSeason_(p);
  case'saveActivity':requireAdmin_(p);return saveActivity_(p);
  case'adminRegister':requireAdmin_(p);return register_(p);
  case'saveResult':requireAdmin_(p);return saveResult_(p);
  case'deleteActivity':requireAdmin_(p);return deleteActivity_(p.id);
  default:throw new Error('Nezināma darbība: '+action);
 }
}

function bootstrap_(){
 return{
  seasons:read_('seasons'),
  players:read_('players').map(publicPlayer_),
  activities:read_('activities'),
  registrations:read_('registrations'),
  results:read_('results'),
  serverTime:new Date().toISOString()
 };
}

function joinPlayer_(p){
 requireFields_(p,['seasonId','name']);
 const name=String(p.name).trim();
 if(name.length<2)throw new Error('Vārdam jābūt vismaz 2 rakstzīmes garam.');
 if(!read_('seasons').some(x=>String(x.id)===String(p.seasonId)))throw new Error('Sezona nav atrasta.');
 let player=read_('players').find(x=>String(x.seasonId)===String(p.seasonId)&&normalize_(x.name)===normalize_(name));
 if(!player){
  player=upsert_('players',{id:Utilities.getUuid(),seasonId:p.seasonId,name:name,image:'',imagePublicId:'',isAdmin:false,authToken:Utilities.getUuid()});
 }else if(!player.authToken){
  player=upsert_('players',Object.assign({},player,{authToken:Utilities.getUuid()}));
 }
 return privatePlayer_(player);
}

function updatePlayer_(p){
 requireFields_(p,['id','authToken']);
 const player=requirePlayerAuth_(p.id,p.authToken);
 const allowed={id:player.id,seasonId:player.seasonId,name:player.name,image:player.image,imagePublicId:player.imagePublicId,isAdmin:player.isAdmin,authToken:player.authToken};
 if(p.image!==undefined)allowed.image=String(p.image||'');
 if(p.imagePublicId!==undefined)allowed.imagePublicId=String(p.imagePublicId||'');
 return publicPlayer_(upsert_('players',allowed));
}

function saveSeason_(p){
 requireFields_(p,['id','name','code']);
 const season=Object.assign({},p,{name:String(p.name).trim(),code:String(p.code).trim().toUpperCase(),bestCount:Math.max(1,Number(p.bestCount)||12),active:toBoolean_(p.active)});
 delete season.actorPlayerId;delete season.authToken;
 if(season.active)read_('seasons').forEach(x=>{if(String(x.id)!==String(season.id)&&toBoolean_(x.active))upsert_('seasons',Object.assign({},x,{active:false}))});
 return upsert_('seasons',season);
}

function saveActivity_(p){
 requireFields_(p,['id','seasonId','name','startAt']);
 const start=new Date(p.startAt);if(isNaN(start.getTime()))throw new Error('Nederīgs aktivitātes datums.');
 const open=p.registrationOpenAt?new Date(p.registrationOpenAt):new Date(start.getTime()-30*24*60*60*1000);
 const close=p.registrationCloseAt?new Date(p.registrationCloseAt):start;
 if(isNaN(open.getTime())||isNaN(close.getTime()))throw new Error('Nederīgs pieteikšanās datums.');
 const value=Object.assign({},p,{name:String(p.name).trim(),startAt:start.toISOString(),registrationOpenAt:open.toISOString(),registrationCloseAt:close.toISOString(),description:String(p.description||'').trim()});
 delete value.actorPlayerId;delete value.authToken;
 return upsert_('activities',value);
}

function registerSelf_(p){
 requireFields_(p,['seasonId','activityId','playerId','authToken']);
 const player=requirePlayerAuth_(p.playerId,p.authToken);
 if(String(player.seasonId)!==String(p.seasonId))throw new Error('Sezonas neatbilstība.');
 const activity=read_('activities').find(x=>String(x.id)===String(p.activityId)&&String(x.seasonId)===String(p.seasonId));
 if(!activity)throw new Error('Aktivitāte nav atrasta.');
 const now=new Date(),open=new Date(activity.registrationOpenAt),close=new Date(activity.registrationCloseAt);
 if(now<open||now>close)throw new Error('Pieteikšanās šai aktivitātei nav atvērta.');
 return register_(p);
}

function register_(p){
 requireFields_(p,['seasonId','activityId','playerId']);
 if(!read_('activities').some(x=>String(x.id)===String(p.activityId)))throw new Error('Aktivitāte nav atrasta.');
 if(!read_('players').some(x=>String(x.id)===String(p.playerId)))throw new Error('Spēlētājs nav atrasts.');
 const old=read_('registrations').find(x=>String(x.activityId)===String(p.activityId)&&String(x.playerId)===String(p.playerId));
 return upsert_('registrations',{id:old?old.id:Utilities.getUuid(),seasonId:p.seasonId,activityId:p.activityId,playerId:p.playerId,status:p.status||'registered'});
}

function saveResult_(p){
 requireFields_(p,['seasonId','activityId','playerId','points']);
 const points=Number(p.points);if(!isFinite(points)||points<0)throw new Error('Punktiem jābūt pozitīvam skaitlim.');
 const old=read_('results').find(x=>String(x.activityId)===String(p.activityId)&&String(x.playerId)===String(p.playerId));
 return upsert_('results',{id:old?old.id:Utilities.getUuid(),seasonId:p.seasonId,activityId:p.activityId,playerId:p.playerId,points:points});
}

function deleteActivity_(id){
 if(!id)throw new Error('Nav norādīta aktivitāte.');
 removeWhere_('activities',x=>String(x.id)===String(id));
 removeWhere_('registrations',x=>String(x.activityId)===String(id));
 removeWhere_('results',x=>String(x.activityId)===String(id));
 return true;
}

function requirePlayerAuth_(playerId,authToken){
 const player=read_('players').find(x=>String(x.id)===String(playerId));
 if(!player||!authToken||String(player.authToken)!==String(authToken))throw new Error('Nederīga spēlētāja autorizācija. Ieej profilā atkārtoti.');
 return player;
}

function requireAdmin_(p){
 requireFields_(p,['actorPlayerId','authToken']);
 const player=requirePlayerAuth_(p.actorPlayerId,p.authToken);
 if(!toBoolean_(player.isAdmin))throw new Error('Admin piekļuve liegta.');
 if(p.seasonId&&String(p.seasonId)!==String(player.seasonId))throw new Error('Administrators nevar pārvaldīt citu sezonu.');
 return player;
}

function publicPlayer_(p){return{id:p.id,seasonId:p.seasonId,name:p.name,image:p.image||'',imagePublicId:p.imagePublicId||'',isAdmin:toBoolean_(p.isAdmin),createdAt:p.createdAt,updatedAt:p.updatedAt}}
function privatePlayer_(p){return Object.assign(publicPlayer_(p),{authToken:p.authToken})}
function safeAuditPayload_(p){const copy=Object.assign({},p);delete copy.authToken;return copy}

function setup(){Object.keys(TABLES).forEach(sheet_);return'Ready'}
function spreadsheet_(){return SpreadsheetApp.openById(SHEET_ID)}
function sheet_(key){
 const ss=spreadsheet_(),name=TABLES[key],headers=HEADERS[key];if(!name||!headers)throw new Error('Nezināma tabula: '+key);
 let sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);
 const current=sh.getLastRow()?sh.getRange(1,1,1,headers.length).getValues()[0]:[];
 if(!sh.getLastRow()||current.join('|')!==headers.join('|'))sh.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold').setBackground('#111827').setFontColor('#ffffff');
 sh.setFrozenRows(1);return sh;
}
function read_(key){
 const sh=sheet_(key),headers=HEADERS[key],last=sh.getLastRow();if(last<2)return[];
 return sh.getRange(2,1,last-1,headers.length).getValues().filter(r=>r.some(v=>v!=='')).map(r=>Object.fromEntries(headers.map((h,i)=>[h,serializeCell_(r[i])])));
}
function upsert_(key,obj){
 const lock=LockService.getScriptLock();lock.waitLock(20000);
 try{
  const sh=sheet_(key),headers=HEADERS[key],rows=read_(key),now=new Date().toISOString(),index=rows.findIndex(x=>String(x.id)===String(obj.id)),old=index>=0?rows[index]:{};
  const value=Object.assign({},old,obj,{createdAt:old.createdAt||obj.createdAt||now,updatedAt:now}),row=headers.map(h=>value[h]??'');
  index>=0?sh.getRange(index+2,1,1,headers.length).setValues([row]):sh.appendRow(row);return value;
 }finally{lock.releaseLock()}
}
function removeWhere_(key,predicate){
 const lock=LockService.getScriptLock();lock.waitLock(20000);
 try{
  const sh=sheet_(key),headers=HEADERS[key],keep=read_(key).filter(x=>!predicate(x));
  if(sh.getLastRow()>1)sh.getRange(2,1,sh.getLastRow()-1,headers.length).clearContent();
  if(keep.length)sh.getRange(2,1,keep.length,headers.length).setValues(keep.map(x=>headers.map(h=>x[h]??'')));
 }finally{lock.releaseLock()}
}
function audit_(action,payload){try{upsert_('audit',{id:Utilities.getUuid(),action:action,payload:JSON.stringify(payload),createdAt:new Date().toISOString()})}catch(error){console.error(error)}}
function requireFields_(obj,fields){fields.forEach(f=>{if(obj[f]===undefined||obj[f]===null||obj[f]==='')throw new Error('Trūkst lauka: '+f)})}
function normalize_(v){return String(v||'').trim().toLocaleLowerCase('lv-LV')}
function toBoolean_(v){return v===true||String(v).toLowerCase()==='true'||v===1||v==='1'}
function serializeCell_(v){return v instanceof Date?v.toISOString():v}
function errorMessage_(e){return String(e&&e.message?e.message:e||'Nezināma kļūda')}
function json_(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)}
function javascript_(callback,obj){if(!/^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(callback))throw new Error('Nederīgs callback.');return ContentService.createTextOutput(callback+'('+JSON.stringify(obj)+');').setMimeType(ContentService.MimeType.JAVASCRIPT)}