(() => {
  'use strict';

  const ADMIN_KEY = 'ms-series-admin-session-v9';
  const REFRESH_MS = 12000;
  const el = id => document.getElementById(id);
  const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const uid = () => UI.uid();
  const nowIso = () => new Date().toISOString();

  let db = normalizeDb(MS.cache());
  let currentSeason = null;
  let currentResultActivityId = '';
  let adminSession = readSession();
  let refreshing = false;

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

  function readSession() {
    try { return JSON.parse(localStorage.getItem(ADMIN_KEY) || 'null'); }
    catch (_) { return null; }
  }

  function saveSession(value) {
    localStorage.setItem(ADMIN_KEY, JSON.stringify(value));
    adminSession = value;
  }

  function clearSession() {
    localStorage.removeItem(ADMIN_KEY);
    adminSession = null;
  }

  function busy(on, text = 'Ielādējam sēriju…') {
    el('syncText').textContent = text;
    el('syncOverlay').classList.toggle('show', on);
  }

  function showError(error) {
    el('authMessage').textContent = error?.message || String(error);
    el('authMessage').classList.remove('hidden');
  }

  function hideError() { el('authMessage').classList.add('hidden'); }

  function setMode(create) {
    el('seriesLoginForm').classList.toggle('hidden', create);
    el('createSeriesForm').classList.toggle('hidden', !create);
    el('adminAuthTitle').textContent = create ? 'Izveidot sēriju' : 'Atvērt sēriju';
    el('adminAuthSub').textContent = create
      ? 'Nosaukums, privātais kods un 5 ciparu admin PIN.'
      : 'Ievadi sērijas kodu un administratora PIN.';
    hideError();
  }

  window.showCreateSeriesForm = () => setMode(true);
  window.showSeriesLoginForm = () => setMode(false);

  function normalizePin(value) {
    const text = String(value ?? '').trim();
    return /^\d+$/.test(text) && text.length < 5 ? text.padStart(5, '0') : text;
  }

  async function legacyHashPin(pin) {
    if (!window.crypto?.subtle) return '';
    const bytes = new TextEncoder().encode(`MS_APPS_SERIES_${String(pin)}`);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g, '-').replace(/\//g, '_');
  }

  async function pinMatches(stored, entered) {
    const saved = normalizePin(stored);
    const typed = normalizePin(entered);
    if (saved === typed) return true;
    const legacy = await legacyHashPin(typed);
    return Boolean(legacy && legacy === saved);
  }

  async function loadServer() {
    db = normalizeDb(await MS.load());
    return db;
  }

  function updateLocal(tableKey, row) {
    const rows = [...(db[tableKey] || [])];
    const index = rows.findIndex(item => String(item.id) === String(row.id));
    if (index >= 0) rows[index] = { ...rows[index], ...row };
    else rows.push(row);
    db[tableKey] = rows;
    MS.setCache(db);
  }

  function removeLocal(tableKey, id) {
    db[tableKey] = (db[tableKey] || []).filter(item => String(item.id) !== String(id));
    MS.setCache(db);
  }

  function restoreSeason() {
    currentSeason = db.seasons.find(item => String(item.id) === String(adminSession?.seasonId)) || null;
    if (!currentSeason) throw new Error('Sērija nav atrasta.');
  }

  el('seriesLoginForm').addEventListener('submit', async event => {
    event.preventDefault();
    busy(true, 'Meklējam sēriju…');
    hideError();
    try {
      await loadServer();
      const code = el('loginSeriesCode').value.trim().toUpperCase();
      const pin = el('loginAdminPin').value.trim();
      const season = db.seasons.find(item => String(item.code || '').trim().toUpperCase() === code);
      if (!season || !(await pinMatches(season.adminPinHash, pin))) {
        throw new Error('Nepareizs sērijas kods vai admin PIN.');
      }
      saveSession({ seasonId: season.id, adminToken: season.adminToken || '' });
      currentSeason = season;
      showAdmin();
    } catch (error) {
      clearSession();
      showError(error);
    } finally {
      busy(false);
    }
  });

  el('createSeriesForm').addEventListener('submit', async event => {
    event.preventDefault();
    busy(true, 'Saglabājam jauno sēriju…');
    hideError();
    try {
      await loadServer();
      const name = el('createSeriesName').value.trim();
      const code = el('createSeriesCode').value.trim().toUpperCase();
      const pin = el('createAdminPin').value.trim();
      const bestCount = Math.max(1, Number(el('createBestCount').value) || 12);
      if (name.length < 2) throw new Error('Ievadi sērijas nosaukumu.');
      if (code.length < 4) throw new Error('Sērijas kodam jābūt vismaz 4 rakstzīmēm.');
      if (!/^\d{5}$/.test(pin)) throw new Error('Admin PIN jābūt tieši 5 cipariem.');
      if (db.seasons.some(item => String(item.code || '').trim().toUpperCase() === code)) {
        throw new Error('Šāds sērijas kods jau pastāv.');
      }
      const timestamp = nowIso();
      const season = {
        id: uid(),
        name,
        code,
        bestCount,
        active: true,
        adminPinHash: pin,
        adminToken: uid(),
        createdAt: timestamp,
        updatedAt: timestamp
      };
      const saved = await MS.saveRow('Seasons', season);
      updateLocal('seasons', saved);
      saveSession({ seasonId: saved.id, adminToken: saved.adminToken || season.adminToken });
      currentSeason = saved;
      showAdmin();
    } catch (error) {
      clearSession();
      showError(error);
    } finally {
      busy(false);
    }
  });

  el('adminLogout').addEventListener('click', () => {
    clearSession();
    location.reload();
  });

  el('adminRefresh')?.addEventListener('click', async () => {
    busy(true, 'Atjaunojam dalībniekus…');
    try { await reloadAdmin(); }
    catch (error) { alert(error.message); }
    finally { busy(false); }
  });

  function showAdmin() {
    if (!currentSeason) throw new Error('Sērija nav atrasta.');
    el('authView').style.display = 'none';
    el('adminApp').classList.add('show');
    el('activeSeriesName').textContent = currentSeason.name;
    el('adminBrand').textContent = currentSeason.name;
    fillSeries();
    renderAll();
  }

  async function openAdmin() {
    if (!adminSession?.seasonId) return;
    busy(true, 'Ielādējam sērijas datus…');
    await loadServer();
    restoreSeason();
    if (
      adminSession.adminToken &&
      String(currentSeason.adminToken || '') !== String(adminSession.adminToken)
    ) {
      throw new Error('Admin sesija nav derīga.');
    }
    showAdmin();
  }

  async function reloadAdmin() {
    await loadServer();
    restoreSeason();
    el('activeSeriesName').textContent = currentSeason.name;
    el('adminBrand').textContent = currentSeason.name;
    fillSeries();
    renderAll();
  }

  async function refreshSilently() {
    if (refreshing || !adminSession?.seasonId || document.hidden) return;
    if (document.activeElement?.matches?.('input, textarea, select')) return;
    refreshing = true;
    try { await reloadAdmin(); }
    catch (_) {}
    finally { refreshing = false; }
  }

  all('.tab').forEach(button => button.addEventListener('click', async () => {
    all('.tab').forEach(item => item.classList.toggle('active', item === button));
    all('.tab-panel').forEach(panel => panel.classList.toggle('hidden', panel.id !== button.dataset.tab));
    if (button.dataset.tab !== 'series') await refreshSilently();
  }));

  function fillSeries() {
    el('seriesTitle').value = currentSeason.name || '';
    el('seriesCode').value = currentSeason.code || '';
    el('bestCount').value = currentSeason.bestCount || 12;
    el('seriesAdminPin').value = '';
  }

  el('seriesForm').addEventListener('submit', async event => {
    event.preventDefault();
    busy(true, 'Saglabājam sēriju…');
    try {
      const name = el('seriesTitle').value.trim();
      const code = el('seriesCode').value.trim().toUpperCase();
      const newPin = el('seriesAdminPin').value.trim();
      if (name.length < 2) throw new Error('Ievadi sērijas nosaukumu.');
      if (code.length < 4) throw new Error('Sērijas kodam jābūt vismaz 4 rakstzīmēm.');
      if (db.seasons.some(item =>
        String(item.id) !== String(currentSeason.id) &&
        String(item.code || '').trim().toUpperCase() === code
      )) throw new Error('Šāds sērijas kods jau pastāv.');
      if (newPin && !/^\d{5}$/.test(newPin)) throw new Error('PIN jābūt tieši 5 cipariem.');

      const updated = {
        ...currentSeason,
        name,
        code,
        bestCount: Math.max(1, Number(el('bestCount').value) || 12),
        updatedAt: nowIso()
      };
      if (newPin) {
        updated.adminPinHash = newPin;
        updated.adminToken = uid();
      }
      const saved = await MS.saveRow('Seasons', updated);
      updateLocal('seasons', saved);
      currentSeason = saved;
      saveSession({ seasonId: saved.id, adminToken: saved.adminToken || '' });
      showAdmin();
    } catch (error) {
      alert(error.message);
    } finally {
      busy(false);
    }
  });

  el('activityForm').addEventListener('submit', async event => {
    event.preventDefault();
    busy(true, 'Saglabājam aktivitāti…');
    try {
      const start = new Date(el('startAt').value);
      const name = el('activityName').value.trim();
      if (Number.isNaN(start.getTime())) throw new Error('Nederīgs aktivitātes datums.');
      if (!name) throw new Error('Ievadi aktivitātes nosaukumu.');
      const old = db.activities.find(item => String(item.id) === String(el('activityId').value));
      const timestamp = nowIso();
      const activity = {
        id: old?.id || uid(),
        seasonId: currentSeason.id,
        name,
        startAt: start.toISOString(),
        registrationOpenAt: el('openAt').value
          ? new Date(el('openAt').value).toISOString()
          : new Date(start.getTime() - 30 * 86400000).toISOString(),
        registrationCloseAt: el('closeAt').value
          ? new Date(el('closeAt').value).toISOString()
          : start.toISOString(),
        description: el('description').value.trim(),
        createdAt: old?.createdAt || timestamp,
        updatedAt: timestamp
      };
      const saved = await MS.saveRow('Activities', activity);
      updateLocal('activities', saved);
      el('activityForm').reset();
      el('activityId').value = '';
      renderActivities();
    } catch (error) {
      alert(error.message);
    } finally {
      busy(false);
    }
  });

  function activeMemberships() {
    return db.memberships.filter(item =>
      String(item.seasonId) === String(currentSeason.id) &&
      !['removed', 'cancelled', 'inactive'].includes(String(item.status || 'active').toLowerCase())
    );
  }

  function members() {
    const ids = new Set(activeMemberships().map(item => String(item.playerId)));
    return db.players.filter(player => ids.has(String(player.id)));
  }

  function activeRegistrations(activityId = '') {
    return db.registrations.filter(item =>
      String(item.seasonId) === String(currentSeason.id) &&
      (!activityId || String(item.activityId) === String(activityId)) &&
      !['removed', 'cancelled'].includes(String(item.status || 'registered').toLowerCase())
    );
  }

  function board() { return UI.leaderboard(db, currentSeason.id); }

  function renderAll() {
    renderActivities();
    renderPlayers();
    renderStandings();
    if (currentResultActivityId) renderResultRows();
  }

  function renderActivities() {
    const rows = db.activities
      .filter(item => String(item.seasonId) === String(currentSeason.id))
      .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

    el('activityList').innerHTML = rows.length
      ? rows.map(activity => {
          const count = activeRegistrations(activity.id).length;
          return `<div class="row"><div class="row-main"><div class="row-title">${UI.esc(activity.name)}</div><div class="row-sub">${UI.fmtDate(activity.startAt)} · ${count} pieteikušies</div></div><button class="btn" data-results="${activity.id}">Dalībnieki / rezultāti</button><button class="btn" data-edit="${activity.id}">Labot</button><button class="btn danger" data-delete="${activity.id}">Dzēst</button></div>`;
        }).join('')
      : '<div class="card empty">Aktivitāšu vēl nav.</div>';

    all('[data-results]', el('activityList')).forEach(button => {
      button.onclick = () => openResults(button.dataset.results);
    });
    all('[data-edit]', el('activityList')).forEach(button => {
      button.onclick = () => editActivity(button.dataset.edit);
    });
    all('[data-delete]', el('activityList')).forEach(button => {
      button.onclick = () => removeActivity(button.dataset.delete);
    });
  }

  function editActivity(id) {
    const activity = db.activities.find(item => String(item.id) === String(id));
    if (!activity) return;
    el('activityId').value = activity.id;
    el('activityName').value = activity.name;
    el('startAt').value = String(activity.startAt || '').slice(0, 16);
    el('openAt').value = String(activity.registrationOpenAt || '').slice(0, 16);
    el('closeAt').value = String(activity.registrationCloseAt || '').slice(0, 16);
    el('description').value = activity.description || '';
  }

  async function removeActivity(id) {
    if (!confirm('Dzēst aktivitāti un tās rezultātus?')) return;
    busy(true, 'Dzēšam aktivitāti…');
    try {
      await MS.removeRow('Activities', id);
      removeLocal('activities', id);
      for (const registration of db.registrations.filter(item => String(item.activityId) === String(id))) {
        await MS.removeRow('Registrations', registration.id);
        removeLocal('registrations', registration.id);
      }
      for (const result of db.results.filter(item => String(item.activityId) === String(id))) {
        await MS.removeRow('Results', result.id);
        removeLocal('results', result.id);
      }
      currentResultActivityId = '';
      el('activityResultsCard').classList.add('hidden');
      renderAll();
    } catch (error) {
      alert(error.message);
    } finally {
      busy(false);
    }
  }

  function renderPlayers() {
    const ranking = new Map(board().map(item => [String(item.id), item]));
    const rows = members().sort((a, b) => String(a.name).localeCompare(String(b.name), 'lv'));

    el('playerList').innerHTML = rows.length
      ? rows.map(player => {
          const stats = ranking.get(String(player.id)) || { rank: '—', total: 0, events: 0 };
          const registrations = activeRegistrations().filter(item => String(item.playerId) === String(player.id)).length;
          return `<div class="row"><div class="rank">${stats.rank}</div><img class="avatar sm" src="${player.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(player.name)}`}" alt=""><div class="row-main"><div class="row-title">${UI.esc(player.name)}</div><div class="row-sub">Pievienojies sērijai · ${registrations} pieteikumi aktivitātēm · ${stats.events} rezultāti</div></div><div class="points">${stats.total}</div></div>`;
        }).join('')
      : '<div class="card empty">Sērijai vēl nav pievienojies neviens dalībnieks.</div>';
  }

  function renderStandings() {
    const rows = board();
    el('standingsTitle').textContent = `Best ${Math.max(1, Number(currentSeason.bestCount) || 12)}`;
    el('standingsList').innerHTML = rows.length
      ? rows.map(player => `<div class="row"><div class="rank">${player.rank}</div><img class="avatar sm" src="${player.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(player.name)}`}" alt=""><div class="row-main"><div class="row-title">${UI.esc(player.name)}</div><div class="row-sub">Skaitīti ${player.countedEvents} no ${player.events} · labākais ${player.bestScore}</div></div><div class="points">${player.total}</div></div>`).join('')
      : '<div class="card empty">Kopvērtējumam vēl nav datu.</div>';
  }

  async function openResults(id) {
    currentResultActivityId = id;
    busy(true, 'Atjaunojam pieteikušos dalībniekus…');
    try {
      await loadServer();
      restoreSeason();
      el('activityResultsCard').classList.remove('hidden');
      renderActivities();
      renderPlayers();
      renderResultRows();
      el('activityResultsCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      alert(error.message);
    } finally {
      busy(false);
    }
  }

  el('closeActivityResults').addEventListener('click', () => {
    currentResultActivityId = '';
    el('activityResultsCard').classList.add('hidden');
  });

  function renderResultRows() {
    const activity = db.activities.find(item => String(item.id) === String(currentResultActivityId));
    if (!activity) return;

    const rows = members().map(player => {
      const registration = activeRegistrations(currentResultActivityId).find(item => String(item.playerId) === String(player.id));
      const result = db.results.find(item =>
        String(item.seasonId) === String(currentSeason.id) &&
        String(item.activityId) === String(currentResultActivityId) &&
        String(item.playerId) === String(player.id)
      );
      return { player, registration, result };
    }).sort((a, b) =>
      Number(Boolean(b.registration)) - Number(Boolean(a.registration)) ||
      String(a.player.name).localeCompare(String(b.player.name), 'lv')
    );

    const registeredCount = rows.filter(item => item.registration).length;
    el('activityResultsTitle').textContent = `${activity.name} · ${registeredCount} pieteikušies`;
    el('activityResultList').innerHTML = rows.length
      ? rows.map(({ player, registration, result }) => `<div class="row"><input class="participant-toggle" data-player="${player.id}" type="checkbox" ${registration ? 'checked' : ''}><div class="row-main"><div class="row-title">${UI.esc(player.name)}</div><div class="row-sub">${registration ? 'Pieteicies aktivitātei' : 'Nav pieteicies'}</div></div><input class="score-input" data-player="${player.id}" type="number" min="0" step="0.01" value="${result?.points ?? ''}" placeholder="Punkti"></div>`).join('')
      : '<div class="card empty">Sērijai vēl nav pievienojies neviens dalībnieks.</div>';

    el('saveActivityResults').classList.toggle('hidden', !rows.length);
  }

  el('saveActivityResults').addEventListener('click', async () => {
    busy(true, 'Saglabājam rezultātus…');
    try {
      for (const toggle of all('.participant-toggle', el('activityResultList'))) {
        const playerId = toggle.dataset.player;
        const timestamp = nowIso();
        const oldRegistration = db.registrations.find(item =>
          String(item.seasonId) === String(currentSeason.id) &&
          String(item.activityId) === String(currentResultActivityId) &&
          String(item.playerId) === String(playerId)
        );
        const registration = {
          id: oldRegistration?.id || uid(),
          seasonId: currentSeason.id,
          activityId: currentResultActivityId,
          playerId,
          status: toggle.checked ? 'registered' : 'removed',
          createdAt: oldRegistration?.createdAt || timestamp,
          updatedAt: timestamp
        };
        const savedRegistration = await MS.saveRow('Registrations', registration);
        updateLocal('registrations', savedRegistration);

        const input = el('activityResultList').querySelector(`.score-input[data-player="${playerId}"]`);
        const oldResult = db.results.find(item =>
          String(item.seasonId) === String(currentSeason.id) &&
          String(item.activityId) === String(currentResultActivityId) &&
          String(item.playerId) === String(playerId)
        );

        if (toggle.checked && input?.value !== '') {
          const result = {
            id: oldResult?.id || uid(),
            seasonId: currentSeason.id,
            activityId: currentResultActivityId,
            playerId,
            points: Number(input.value),
            createdAt: oldResult?.createdAt || timestamp,
            updatedAt: timestamp
          };
          const savedResult = await MS.saveRow('Results', result);
          updateLocal('results', savedResult);
        } else if (!toggle.checked && oldResult) {
          await MS.removeRow('Results', oldResult.id);
          removeLocal('results', oldResult.id);
        }
      }
      await reloadAdmin();
    } catch (error) {
      alert(error.message);
    } finally {
      busy(false);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshSilently();
  });
  window.setInterval(refreshSilently, REFRESH_MS);

  if (adminSession?.seasonId) {
    openAdmin()
      .catch(error => {
        clearSession();
        showError(error);
      })
      .finally(() => busy(false));
  } else {
    busy(false);
  }
})();