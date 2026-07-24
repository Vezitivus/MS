(() => {
  'use strict';
  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  function fmtDate(value) { if (!value) return '—'; const date = new Date(value); if (Number.isNaN(date.getTime())) return '—'; return new Intl.DateTimeFormat('lv-LV',{dateStyle:'medium',timeStyle:String(value).includes('T')?'short':undefined}).format(date); }
  function esc(value='') { return String(value).replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character])); }
  function isTrue(value) { return value===true||value===1||value==='1'||String(value).toLowerCase()==='true'; }
  function membershipsFor(db, playerId) { return (db.memberships||[]).filter(item=>String(item.playerId)===String(playerId)&&String(item.status||'active')!=='removed'); }
  function membership(db, playerId, seasonId) { return membershipsFor(db,playerId).find(item=>String(item.seasonId)===String(seasonId))||null; }
  function leaderboard(db, seasonId) {
    const season=(db.seasons||[]).find(item=>String(item.id)===String(seasonId));
    const bestCount=Math.max(1,Number(season?.bestCount)||12);
    const memberIds=new Set((db.memberships||[]).filter(item=>String(item.seasonId)===String(seasonId)&&String(item.status||'active')!=='removed').map(item=>String(item.playerId)));
    const rows=(db.players||[]).filter(player=>memberIds.has(String(player.id))).map(player=>{
      const scores=(db.results||[]).filter(result=>String(result.seasonId)===String(seasonId)&&String(result.playerId)===String(player.id)).map(result=>Number(result.points)||0).sort((a,b)=>b-a);
      const countedScores=scores.slice(0,bestCount);
      return {...player,total:countedScores.reduce((sum,score)=>sum+score,0),events:scores.length,countedEvents:countedScores.length,bestScore:scores[0]||0,avg:scores.length?scores.reduce((sum,score)=>sum+score,0)/scores.length:0,countedScores};
    }).sort((a,b)=>b.total-a.total||b.bestScore-a.bestScore||String(a.name).localeCompare(String(b.name),'lv'));
    let previousTotal=null,previousRank=0;
    return rows.map((player,index)=>{const rank=index>0&&player.total===previousTotal?previousRank:index+1;previousTotal=player.total;previousRank=rank;return {...player,rank};});
  }
  function nextActivity(db, seasonId) { const now=new Date(); return (db.activities||[]).filter(item=>String(item.seasonId)===String(seasonId)&&new Date(item.startAt)>now).sort((a,b)=>new Date(a.startAt)-new Date(b.startAt))[0]||null; }
  function registrationOpen(activity) { if(!activity)return false; const now=new Date(),start=new Date(activity.startAt),open=activity.registrationOpenAt?new Date(activity.registrationOpenAt):new Date(start.getTime()-30*86400000),close=activity.registrationCloseAt?new Date(activity.registrationCloseAt):start; return now>=open&&now<=close; }
  function uid(){return crypto.randomUUID?.()||`id-${Date.now()}-${Math.random().toString(36).slice(2)}`;}
  window.UI={$:qs,$$:qsa,fmtDate,esc,isTrue,membershipsFor,membership,leaderboard,nextActivity,registrationOpen,uid};
})();