const CONFIG={
 API_URL:'https://script.google.com/macros/s/AKfycbxHXONazqk86pSNbH3_I72ai0EZZYAhaLev8swGxFOI1HWxdWedsJSXON7pQ9VWfd1S/exec',
 STORAGE_KEY:'ms-season-session',
 TIMEOUT:25000
};

function api(action,payload={}){
 return new Promise((resolve,reject)=>{
  const callback='__ms_jsonp_'+Date.now()+'_'+Math.random().toString(36).slice(2);
  const script=document.createElement('script');
  const timer=setTimeout(()=>finish(new Error('Savienojuma noildze. Pārbaudi Google Apps Script deployment un interneta savienojumu.')),CONFIG.TIMEOUT);
  function finish(error,data){
   clearTimeout(timer);
   delete window[callback];
   script.remove();
   error?reject(error):resolve(data);
  }
  window[callback]=response=>{
   if(!response||response.ok!==true)return finish(new Error(response?.error||'Google Apps Script neatgrieza derīgu atbildi.'));
   finish(null,response.data);
  };
  script.onerror=()=>finish(new Error('Neizdevās ielādēt Google Apps Script API. Pārliecinies, ka deployment piekļuve ir “Anyone” un publicēta jaunākā versija.'));
  const query=new URLSearchParams({
   action:String(action),
   payload:JSON.stringify(payload||{}),
   callback,
   t:String(Date.now())
  });
  script.src=CONFIG.API_URL+'?'+query.toString();
  script.async=true;
  document.head.appendChild(script);
 });
}

function session(){try{return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY)||'null')}catch{return null}}
function setSession(value){localStorage.setItem(CONFIG.STORAGE_KEY,JSON.stringify(value))}
function clearSession(){localStorage.removeItem(CONFIG.STORAGE_KEY)}
window.MS={api,session,setSession,clearSession,CONFIG};