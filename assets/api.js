const CONFIG={API_URL:'',STORAGE_KEY:'ms-season-session'};
const DemoDB={
 seasons:[{id:'season-2026',name:'Friends Cup 2026',code:'FC26',bestCount:12,active:true}],
 players:[],activities:[],registrations:[],results:[]
};
function loadDemo(){const raw=localStorage.getItem('ms-demo-db');return raw?JSON.parse(raw):structuredClone(DemoDB)}
function saveDemo(db){localStorage.setItem('ms-demo-db',JSON.stringify(db))}
async function api(action,payload={}){
 if(CONFIG.API_URL){const r=await fetch(CONFIG.API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,payload})});const j=await r.json();if(!j.ok)throw new Error(j.error||'API kļūda');return j.data}
 const db=loadDemo();
 switch(action){
  case'bootstrap':return db;
  case'joinPlayer':{let p=db.players.find(x=>x.seasonId===payload.seasonId&&x.name.toLowerCase()===payload.name.toLowerCase());if(!p){p={id:crypto.randomUUID(),seasonId:payload.seasonId,name:payload.name.trim(),image:'',createdAt:new Date().toISOString()};db.players.push(p);saveDemo(db)}return p}
  case'updatePlayer':{const p=db.players.find(x=>x.id===payload.id);Object.assign(p,payload);saveDemo(db);return p}
  case'saveSeason':upsert(db.seasons,payload);saveDemo(db);return payload;
  case'saveActivity':upsert(db.activities,payload);saveDemo(db);return payload;
  case'register':{const old=db.registrations.find(x=>x.activityId===payload.activityId&&x.playerId===payload.playerId);if(old)old.status=payload.status;else db.registrations.push({...payload,id:crypto.randomUUID(),createdAt:new Date().toISOString()});saveDemo(db);return true}
  case'saveResult':{const old=db.results.find(x=>x.activityId===payload.activityId&&x.playerId===payload.playerId);if(old)old.points=Number(payload.points);else db.results.push({...payload,id:crypto.randomUUID(),points:Number(payload.points)});saveDemo(db);return true}
  case'deleteActivity':db.activities=db.activities.filter(x=>x.id!==payload.id);db.registrations=db.registrations.filter(x=>x.activityId!==payload.id);db.results=db.results.filter(x=>x.activityId!==payload.id);saveDemo(db);return true;
  default:throw new Error('Nezināma darbība')
 }
}
function upsert(arr,item){const i=arr.findIndex(x=>x.id===item.id);if(i>=0)arr[i]=item;else arr.push(item)}
function session(){try{return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY)||'null')}catch{return null}}
function setSession(v){localStorage.setItem(CONFIG.STORAGE_KEY,JSON.stringify(v))}
function clearSession(){localStorage.removeItem(CONFIG.STORAGE_KEY)}
window.MS={api,session,setSession,clearSession,CONFIG};