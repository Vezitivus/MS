(() => {
  'use strict';

  const CLOUDINARY = { cloudName: 'dmkpb05ww', uploadPreset: 'Vezitivus', folder: 'Vezitivus' };
  const el = id => document.getElementById(id);
  const uid = () => UI.uid();
  const nowIso = () => new Date().toISOString();

  let db = normalizeDb(MS.cache());
  let player = null;
  let activeSeason = null;

  function normalizeDb(value = {}) {
    return {
      players: Array.isArray(value.players) ? value.players : [],
      seasons: Array.isArray(value.seasons) ? value.seasons : [],
      memberships: Array.isArray(value.memberships) ? value.memberships : [],
      activities: Array.isArray(value.activities) ? value.activities : [],
      registrations: Array.isArray(value.registrations) ? value.registrations : [],
      results: Array.isArray(value.results) ? value.results : []
    };
  }

  function busy(on, text = 'Ielādējam datus…', subtext = 'Lūdzu, uzgaidi.') {
    el('syncText').textContent = text;
    el('syncSubtext').textContent = subtext;
    el('syncOverlay').classList.toggle('show', on);
  }

  function updateLocal(tableKey, row) {
    const rows = [...(db[tableKey] || [])];
    const index = rows.findIndex(item => String(item.id) === String(row.id));
    if (index >= 0) rows[index] = { ...rows[index], ...row }; else rows.push(row);
    db[tableKey] = rows;
    MS.setCache(db);
  }

  const session = MS.session();
  if (!session?.playerId) { location.replace('index.html'); return; }

  renderCached(session);
  bindActions();

  (async () => {
    el('syncState').innerHTML = '<span class="sync-dot"></span>Atjaunojam datus…';
    try {
      db = normalizeDb(await MS.load());
      renderFromData(MS.session());
      el('syncState').innerHTML = '<span class="sync-dot"></span>Sinhronizēts';
    } catch (error) {
      if (!player) showFatal(error); else el('syncState').textContent = 'Bezsaistes režīms';
    }
  })().catch(showFatal);

  function renderCached(currentSession) {
    player = db.players.find(item => String(item.id) === String(currentSession.playerId));
    if (player) renderPlayer();
  }

  function renderFromData(currentSession) {
    player = db.players.find(item => String(item.id) === String(currentSession.playerId));
    if (!player) { MS.clearSession(); location.replace('index.html'); return; }
    renderPlayer();
  }

  function renderPlayer() {
    el('playerName').textContent = player.name;
    setAvatar(player);
    renderSeries();
  }

  function renderSeries() {
    const memberships = UI.membershipsFor(db, player.id);
    const seasons = memberships.map(m => db.seasons.find(s => String(s.id) === String(m.seasonId))).filter(Boolean);
    const currentSession = MS.session();
    const chosen = seasons.find(s => String(s.id) === String(currentSession?.seasonId)) || seasons[0] || null;
    el('seasonSelect').innerHTML = seasons.length
      ? '<option value="">Izvēlies sēriju</option>' + seasons.map(s => `<option value="${s.id}" ${chosen && String(s.id) === String(chosen.id) ? 'selected' : ''}>${UI.esc(s.name)}</option>`).join('')
      : '<option value="">Vēl neesi pievienojies sērijai</option>';
    el('seasonSelect').disabled = !seasons.length;
    el('seasonSelect').onchange = () => selectSeason(el('seasonSelect').value);
    selectSeason(chosen?.id || '');
  }

  function selectSeason(id) {
    activeSeason = db.seasons.find(s => String(s.id) === String(id)) || null;
    MS.setSession({ ...MS.session(), seasonId: activeSeason?.id || '' });
    el('activeSeasonTitle').textContent = activeSeason?.name || 'Profils darbojas arī bez sērijas';
    el('seriesContent').classList.toggle('hidden', !activeSeason);
    el('leaderboardLink').classList.toggle('hidden', !activeSeason);
    if (activeSeason) renderSeasonData();
  }

  function renderSeasonData() {
    el('registerBtn').classList.add('hidden');
    el('registerState').classList.add('hidden');
    el('nextDate').textContent = '';
    el('nextDescription').textContent = '';
    const board = UI.leaderboard(db, activeSeason.id);
    const me = board.find(item => String(item.id) === String(player.id));
    const next = UI.nextActivity(db, activeSeason.id);
    el('rankPill').textContent = `#${me?.rank || '—'} kopvērtējumā · Best ${activeSeason.bestCount || 12}`;
    el('total').textContent = me?.total || 0;
    el('events').textContent = me?.events || 0;
    el('avg').textContent = me?.events ? me.avg.toFixed(1).replace('.', ',') : '0';

    if (next) {
      el('nextTitle').textContent = next.name;
      el('nextDate').textContent = UI.fmtDate(next.startAt);
      el('nextDescription').textContent = next.description || '';
      const registration = db.registrations.find(item => String(item.activityId) === String(next.id) && String(item.playerId) === String(player.id) && item.status !== 'removed');
      if (registration) showNotice(el('registerState'), 'Tu esi pieteicies šai aktivitātei.');
      else if (UI.registrationOpen(next)) {
        el('registerBtn').classList.remove('hidden');
        el('registerBtn').onclick = async () => {
          busy(true, 'Saglabājam pieteikumu…');
          try {
            const timestamp = nowIso();
            const old = db.registrations.find(item => String(item.activityId) === String(next.id) && String(item.playerId) === String(player.id));
            const row = { id: old?.id || uid(), seasonId: activeSeason.id, activityId: next.id, playerId: player.id, status: 'registered', createdAt: old?.createdAt || timestamp, updatedAt: timestamp };
            const saved = await MS.saveRow('Registrations', row);
            updateLocal('registrations', saved);
            renderSeasonData();
          } catch (error) { alert(error.message); } finally { busy(false); }
        };
      } else showNotice(el('registerState'), 'Pieteikšanās nav atvērta.');
    } else el('nextTitle').textContent = 'Pašlaik nav ieplānota';

    const historyRows = db.results.filter(result => String(result.seasonId) === String(activeSeason.id) && String(result.playerId) === String(player.id)).map(result => ({ ...result, activity: db.activities.find(activity => String(activity.id) === String(result.activityId)) })).sort((a,b)=>new Date(b.activity?.startAt||0)-new Date(a.activity?.startAt||0));
    el('history').innerHTML = historyRows.length ? historyRows.map(result => `<div class="row"><div class="row-main"><div class="row-title">${UI.esc(result.activity?.name || 'Aktivitāte')}</div><div class="row-sub">${UI.fmtDate(result.activity?.startAt)}</div></div><div class="points">${Number(result.points) || 0}</div></div>`).join('') : '<div class="card empty">Rezultātu vēl nav.</div>';
  }

  function bindActions() {
    el('avatar').onclick = () => el('imageInput').click();
    el('imageInput').onchange = uploadImage;
    el('joinSeriesForm').onsubmit = joinSeries;
    el('logoutBtn').onclick = logout;
    el('switchLink').onclick = logout;
  }

  function logout() { MS.clearSession(); MS.clearCache(); }

  async function joinSeries(event) {
    event.preventDefault();
    busy(true, 'Meklējam sēriju…', 'Pārbaudām privāto sērijas kodu.');
    try {
      db = normalizeDb(await MS.load());
      player = db.players.find(item => String(item.id) === String(MS.session()?.playerId));
      if (!player) throw new Error('Profils nav atrasts.');
      const code = el('seriesCode').value.trim().toUpperCase();
      const season = db.seasons.find(item => String(item.code || '').trim().toUpperCase() === code);
      if (!season) throw new Error('Sērija ar šādu kodu nav atrasta.');
      const timestamp = nowIso();
      const old = db.memberships.find(item => String(item.playerId) === String(player.id) && String(item.seasonId) === String(season.id));
      const membership = { id: old?.id || uid(), seasonId: season.id, playerId: player.id, role: 'player', status: 'active', joinedAt: old?.joinedAt || timestamp, createdAt: old?.createdAt || timestamp, updatedAt: timestamp };
      busy(true, 'Saglabājam sēriju…', 'Pievienojam sēriju tavam profilam.');
      const saved = await MS.saveRow('Memberships', membership);
      updateLocal('memberships', saved);
      el('seriesCode').value = '';
      MS.setSession({ ...MS.session(), seasonId: season.id });
      showNotice(el('seriesState'), `Pievienots: ${season.name}`);
      renderPlayer();
    } catch (error) { showNotice(el('seriesState'), error.message, true); } finally { busy(false); }
  }

  async function uploadImage() {
    const file = el('imageInput').files?.[0]; el('imageInput').value = ''; if (!file) return;
    busy(true, 'Saglabājam attēlu…');
    try {
      const form = new FormData(); form.append('file', file); form.append('upload_preset', CLOUDINARY.uploadPreset); form.append('folder', CLOUDINARY.folder);
      const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/image/upload`, { method: 'POST', body: form });
      const result = await response.json();
      if (!response.ok || !result.secure_url) throw new Error(result?.error?.message || 'Neizdevās saglabāt attēlu.');
      const updated = { ...player, image: result.secure_url, imagePublicId: result.public_id || '', updatedAt: nowIso() };
      const saved = await MS.saveRow('Players', updated);
      updateLocal('players', saved); player = saved; renderPlayer();
      el('syncState').innerHTML = '<span class="sync-dot"></span>Sinhronizēts';
    } catch (error) { el('syncState').textContent = error.message; } finally { busy(false); }
  }

  function setAvatar(item) { el('avatar').src = item.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(item.name)}&background=e5e7eb&color=111827&size=256`; }
  function showNotice(target, message, error = false) { target.textContent = message; target.classList.remove('hidden'); target.style.color = error ? '#b42318' : ''; }
  function showFatal(error) { document.body.innerHTML = `<main class="shell"><div class="card"><h2>Kļūda</h2><p>${UI.esc(error.message || error)}</p></div></main>`; }
})();