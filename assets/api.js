const CONFIG={
 API_URL:'https://script.google.com/macros/s/AKfycbxHXONazqk86pSNbH3_I72ai0EZZYAhaLev8swGxFOI1HWxdWedsJSXON7pQ9VWfd1S/exec',
 STORAGE_KEY:'ms-season-session'
};

async function api(action,payload={}){
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),20000);
 try{
  const response=await fetch(CONFIG.API_URL,{
   method:'POST',
   headers:{'Content-Type':'text/plain;charset=utf-8'},
   body:JSON.stringify({action,payload}),
   signal:controller.signal,
   redirect:'follow'
  });
  if(!response.ok)throw new Error(`Servera kļūda (${response.status})`);
  const text=await response.text();
  let json;
  try{json=JSON.parse(text)}catch{throw new Error('Google Apps Script neatgrieza derīgu JSON atbildi')}
  if(!json.ok)throw new Error(json.error||'Nezināma API kļūda');
  return json.data;
 }catch(error){
  if(error.name==='AbortError')throw new Error('Savienojuma noildze. Pārbaudi internetu un mēģini vēlreiz.');
  throw error;
 }finally{clearTimeout(timeout)}
}

function session(){try{return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY)||'null')}catch{return null}}
function setSession(v){localStorage.setItem(CONFIG.STORAGE_KEY,JSON.stringify(v))}
function clearSession(){localStorage.removeItem(CONFIG.STORAGE_KEY)}
window.MS={api,session,setSession,clearSession,CONFIG};