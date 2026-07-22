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
function doGet(){return json_({ok:true,data:bootstrap_()})}
function doPost(e){try{const req=JSON.parse(e.postData.contents||'{}');const data=route_(req.action,req.payload||{});audit_(req.action,req.payload||{});return json_({ok:true,data})}catch(err){return json_({ok:false,error:String(err.message||err)})}}
function route_(action,p){switch(action){case'bootstrap':return bootstrap_();case'joinPlayer':return joinPlayer_(p);case'updatePlayer':return upsert_('players',p);case'saveSeason':return upsert_('seasons',p);case'saveActivity':return upsert_('activities',p);case'register':return register_(p);case'saveResult':return saveResult_(p);case'deleteActivity':return deleteActivity_(p.id);default:throw new Error('Nezināma darbība: '+action)}}
function bootstrap_(){return{seasons:read_('seasons'),players:read_('players'),activities:read_('activities'),registrations:read_('registrations'),results:read_('results')}}
function joinPlayer_(p){const rows=read_('players');let player=rows.find(x=>x.seasonId===p.seasonId&&String(x.name).toLowerCase()===String(p.name).trim().toLowerCase());if(!player)player=upsert_('players',{id:Utilities.getUuid(),seasonId:p.seasonId,name:String(p.name).trim(),image:'',createdAt:new Date().toISOString()});return player}
function register_(p){const rows=read_('registrations');const old=rows.find(x=>x.activityId===p.activityId&&x.playerId===p.playerId);return upsert_('registrations',{...old,...p,id:old?.id||Utilities.getUuid()})}
function saveResult_(p){const rows=read_('results');const old=rows.find(x=>x.activityId===p.activityId&&x.playerId===p.playerId);return upsert_('results',{...old,...p,id:old?.id||Utilities.getUuid(),points:Number(p.points)})}
function deleteActivity_(id){removeWhere_('activities',r=>r.id===id);removeWhere_('registrations',r=>r.activityId===id);removeWhere_('results',r=>r.activityId===id);return true}
function ss_(){return SpreadsheetApp.openById(SHEET_ID)}
function sh_(key){const ss=ss_(),name=TABLES[key];let sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);const h=HEADERS[key];if(sh.getLastRow()===0)sh.getRange(1,1,1,h.length).setValues([h]).setFontWeight('bold').setBackground('#111827').setFontColor('#ffffff');return sh}
function read_(key){const sh=sh_(key),h=HEADERS[key],last=sh.getLastRow();if(last<2)return[];return sh.getRange(2,1,last-1,h.length).getValues().filter(r=>r.some(v=>v!=='' )).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]])))}
function upsert_(key,obj){const lock=LockService.getScriptLock();lock.waitLock(10000);try{const sh=sh_(key),h=HEADERS[key],rows=read_(key),now=new Date().toISOString();const found=rows.findIndex(r=>String(r.id)===String(obj.id));const current=found>=0?rows[found]:{};const value={...current,...obj,createdAt:current.createdAt||obj.createdAt||now,updatedAt:now};const row=h.map(k=>value[k]??'');if(found>=0)sh.getRange(found+2,1,1,h.length).setValues([row]);else sh.appendRow(row);return value}finally{lock.releaseLock()}}
function removeWhere_(key,pred){const sh=sh_(key),rows=read_(key),h=HEADERS[key],keep=rows.filter(r=>!pred(r));if(sh.getLastRow()>1)sh.getRange(2,1,sh.getLastRow()-1,h.length).clearContent();if(keep.length)sh.getRange(2,1,keep.length,h.length).setValues(keep.map(o=>h.map(k=>o[k]??'')))}
function audit_(action,payload){try{upsert_('audit',{id:Utilities.getUuid(),action,payload:JSON.stringify(payload),createdAt:new Date().toISOString()})}catch(e){}}
function json_(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)}
function setup(){Object.keys(TABLES).forEach(sh_);return 'Ready'}