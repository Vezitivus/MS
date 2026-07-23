const SHEET_ID='1-nheGOekslHRIf1KCeLDR5v-NN9oFtsCtfO082zQkHo';
const TABLES={seasons:'Seasons',players:'Players',activities:'Activities',registrations:'Registrations',results:'Results',audit:'Audit'};
const HEADERS={
 seasons:['id','name','code','bestCount','active','createdAt','updatedAt'],
 players:['id','seasonId','name','image','createdAt','updatedAt'],
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
  if(action!=='bootstrap')audit_(action,payload);
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
  if(req.action!=='bootstrap')audit_(String(req.action),payload);
  return json_({ok:true,data:data});
 }catch(error){return json_({ok:false,error:errorMessage_(error)})}
}

function route_(action,p){
 switch(action){
  case'bootstrap':return bootstrap_();
  case'joinPlayer':return joinPlayer_(p);
  case'updatePlayer':return updatePlayer_(p);
  case'saveSeason':return saveSeason_(p);
  case'saveActivity':return saveActivity_(p);
  case'register':return register_(p);
  case'saveResult':return saveResult_(p);
  case'deleteActivity':return deleteActivity_(p.id);
  default:throw new Error('Nezināma darbība: '+action);
 }
}

function bootstrap_(){return{seasons:read_('seasons'),players:read_('players'),activities:read_('activities'),registrations:read_('registrations'),results:read_('results'),serverTime:new Date().toISOString()}}

function joinPlayer_(p){
 requireFields_(p,['seasonId','name']);
 const name=String(p.name).trim();
 if(name.length<2)throw new Error('Vārdam jābūt vismaz 2 rakstzīmes garam.');
 if(!read_('seasons').some(x=>String(x.id)===String(p.seasonId)))throw new Error('Sezona nav atrasta.');
 let player=read_('players').find(x=>String(x.seasonId)===String(p.seasonId)&&normalize_(x.name)===normalize_(name));
 if(!player)player=upsert_('players',{id:Utilities.getUuid(),seasonId:p.seasonId,name:name,image:''});
 return player;
}

function updatePlayer_(p){
 requireFields_(p,['id']);
 const old=read_('players').find(x=>String(x.id)===String(p.id));
 if(!old)throw new Error('Spēlētājs nav atrasts.');
 return upsert_('players',Object.assign({},old,p));
}

function saveSeason_(p){
 requireFields_(p,['id','name','code']);
 const season=Object.assign({},p,{name:String(p.name).trim(),code:String(p.code).trim().toUpperCase(),bestCount:Math.max(1,Number(p.bestCount)||12),active:toBoolean_(p.active)});
 if(season.active)read_('seasons').forEach(x=>{if(String(x.id)!==String(season.id)&&toBoolean_(x.active))upsert_('seasons',Object.assign({},x,{active:false}))});
 return upsert_('seasons',season);
}

function saveActivity_(p){
 requireFields_(p,['id','seasonId','name','startAt']);
 const start=new Date(p.startAt);if(isNaN(start.getTime()))throw new Error('Nederīgs aktivitātes datums.');
 const open=p.registrationOpenAt?new Date(p.registrationOpenAt):new Date(start.getTime()-30*24*60*60*1000);
 const close=p.registrationCloseAt?new Date(p.registrationCloseAt):start;
 if(isNaN(open.getTime())||isNaN(close.getTime()))throw new Error('Nederīgs pieteikšanās datums.');
 return upsert_('activities',Object.assign({},p,{name:String(p.name).trim(),startAt:start.toISOString(),registrationOpenAt:open.toISOString(),registrationCloseAt:close.toISOString(),description:String(p.description||'').trim()}));
}

function register_(p){
 requireFields_(p,['seasonId','activityId','playerId']);
 if(!read_('activities').some(x=>String(x.id)===String(p.activityId)))throw new Error('Aktivitāte nav atrasta.');
 if(!read_('players').some(x=>String(x.id)===String(p.playerId)))throw new Error('Spēlētājs nav atrasts.');
 const old=read_('registrations').find(x=>String(x.activityId)===String(p.activityId)&&String(x.playerId)===String(p.playerId));
 return upsert_('registrations',Object.assign({},old||{},p,{id:old?old.id:Utilities.getUuid(),status:p.status||'registered'}));
}

function saveResult_(p){
 requireFields_(p,['seasonId','activityId','playerId','points']);
 const points=Number(p.points);if(!isFinite(points)||points<0)throw new Error('Punktiem jābūt pozitīvam skaitlim.');
 const old=read_('results').find(x=>String(x.activityId)===String(p.activityId)&&String(x.playerId)===String(p.playerId));
 return upsert_('results',Object.assign({},old||{},p,{id:old?old.id:Utilities.getUuid(),points:points}));
}

function deleteActivity_(id){
 if(!id)throw new Error('Nav norādīta aktivitāte.');
 removeWhere_('activities',x=>String(x.id)===String(id));
 removeWhere_('registrations',x=>String(x.activityId)===String(id));
 removeWhere_('results',x=>String(x.activityId)===String(id));
 return true;
}

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
function toBoolean_(v){return v===true||v==='true'||v===1||v==='1'}
function serializeCell_(v){return v instanceof Date?v.toISOString():v}
function errorMessage_(e){return String(e&&e.message?e.message:e||'Nezināma kļūda')}
function json_(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)}
function javascript_(callback,obj){if(!/^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(callback))throw new Error('Nederīgs callback.');return ContentService.createTextOutput(callback+'('+JSON.stringify(obj)+');').setMimeType(ContentService.MimeType.JAVASCRIPT)}