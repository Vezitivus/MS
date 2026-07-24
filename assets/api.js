(() => {
  'use strict';

  const CONFIG = {
    API_URL: 'https://script.google.com/macros/s/AKfycbyBVPgOoEUGQgUqeOUxT3CKDgnSK55lk5skfWIeCejWBNR7eKYxy_mrxdqN6CiaI4Lc/exec',
    SHEET_ID: '1-nheGOekslHRIf1KCeLDR5v-NN9oFtsCtfO082zQkHo',
    STORAGE_KEY: 'ms-season-session',
    CACHE_KEY: 'ms-app-cache-v8',
    TIMEOUT: 30000,
    VERIFY_ATTEMPTS: 8,
    VERIFY_DELAY: 650
  };

  const TABLES = {
    Players: { key: 'players', headers: ['id','name','image','imagePublicId','authToken','accessCode','createdAt','updatedAt'] },
    Seasons: { key: 'seasons', headers: ['id','name','code','bestCount','active','adminPinHash','adminToken','createdAt','updatedAt'] },
    Memberships: { key: 'memberships', headers: ['id','seasonId','playerId','role','status','joinedAt','createdAt','updatedAt'] },
    Activities: { key: 'activities', headers: ['id','seasonId','name','startAt','registrationOpenAt','registrationCloseAt','description','createdAt','updatedAt'] },
    Registrations: { key: 'registrations', headers: ['id','seasonId','activityId','playerId','status','createdAt','updatedAt'] },
    Results: { key: 'results', headers: ['id','seasonId','activityId','playerId','points','createdAt','updatedAt'] }
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function readJson(key, fallback = null) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value ?? fallback;
    } catch (_) {
      return fallback;
    }
  }

  function emptyDb() {
    return { players: [], seasons: [], memberships: [], activities: [], registrations: [], results: [] };
  }

  function session() { return readJson(CONFIG.STORAGE_KEY); }
  function setSession(value) { localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(value)); }
  function clearSession() { localStorage.removeItem(CONFIG.STORAGE_KEY); }
  function cache() { return readJson(CONFIG.CACHE_KEY, emptyDb()); }
  function setCache(value) { localStorage.setItem(CONFIG.CACHE_KEY, JSON.stringify({ ...emptyDb(), ...value, cachedAt: Date.now() })); }
  function clearCache() { localStorage.removeItem(CONFIG.CACHE_KEY); }

  function normalizeCell(value) {
    if (value == null) return '';
    if (value instanceof Date) return value.toISOString();
    return value;
  }

  function loadTable(tableName) {
    const table = TABLES[tableName];
    if (!table) return Promise.reject(new Error(`Nezināma tabula: ${tableName}`));

    return new Promise((resolve, reject) => {
      const callback = `msGviz${Date.now()}${Math.random().toString(36).slice(2)}`;
      const script = document.createElement('script');
      let finished = false;

      const finish = (error, rows) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        try { delete window[callback]; } catch (_) {}
        script.remove();
        error ? reject(error) : resolve(rows);
      };

      const timer = window.setTimeout(
        () => finish(new Error(`Neizdevās ielādēt Google Sheet lapu “${tableName}”.`)),
        CONFIG.TIMEOUT
      );

      window[callback] = response => {
        if (!response || response.status === 'error' || !response.table) {
          const detail = response?.errors?.[0]?.detailed_message || response?.errors?.[0]?.message || '';
          finish(new Error(detail || `Google Sheet lapa “${tableName}” nav pieejama.`));
          return;
        }

        const rows = (response.table.rows || []).map(sourceRow => {
          const row = {};
          table.headers.forEach((header, index) => {
            row[header] = normalizeCell(sourceRow.c?.[index]?.v);
          });
          return row;
        }).filter(row => String(row.id || '').trim() !== '');

        finish(null, rows);
      };

      const params = new URLSearchParams({
        sheet: tableName,
        headers: '1',
        tq: 'select *',
        tqx: `out:json;responseHandler:${callback}`,
        _: String(Date.now())
      });

      script.src = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?${params.toString()}`;
      script.async = true;
      script.onerror = () => finish(new Error(`Neizdevās sasniegt Google Sheet lapu “${tableName}”.`));
      document.head.appendChild(script);
    });
  }

  async function load() {
    const entries = await Promise.all(
      Object.entries(TABLES).map(async ([tableName, config]) => [config.key, await loadTable(tableName)])
    );
    const data = Object.fromEntries(entries);
    data.serverTime = new Date().toISOString();
    setCache(data);
    return data;
  }

  function updateCachedRow(tableName, row) {
    const config = TABLES[tableName];
    if (!config || !row?.id) return;
    const data = cache();
    const rows = Array.isArray(data[config.key]) ? [...data[config.key]] : [];
    const index = rows.findIndex(item => String(item.id) === String(row.id));
    if (index >= 0) rows[index] = { ...rows[index], ...row };
    else rows.push(row);
    data[config.key] = rows;
    setCache(data);
  }

  function removeCachedRow(tableName, id) {
    const config = TABLES[tableName];
    if (!config) return;
    const data = cache();
    data[config.key] = (data[config.key] || []).filter(item => String(item.id) !== String(id));
    setCache(data);
  }

  function submitForm(action, payload) {
    return new Promise((resolve, reject) => {
      const frameName = `msFrame${Date.now()}${Math.random().toString(36).slice(2)}`;
      const iframe = document.createElement('iframe');
      const form = document.createElement('form');
      let submitted = false;
      let finished = false;

      const cleanup = () => {
        form.remove();
        window.setTimeout(() => iframe.remove(), 0);
      };

      const finish = error => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        cleanup();
        error ? reject(error) : resolve(true);
      };

      const timer = window.setTimeout(
        () => finish(new Error('Google datu serveris neatbildēja uz saglabāšanas pieprasījumu.')),
        CONFIG.TIMEOUT
      );

      iframe.name = frameName;
      iframe.hidden = true;
      iframe.setAttribute('aria-hidden', 'true');
      iframe.onload = () => {
        if (submitted) finish();
      };
      document.body.appendChild(iframe);

      form.method = 'POST';
      form.action = CONFIG.API_URL;
      form.target = frameName;
      form.hidden = true;

      const fields = {
        action,
        payload: JSON.stringify(payload || {})
      };

      Object.entries(fields).forEach(([name, value]) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.appendChild(input);
      });

      document.body.appendChild(form);
      submitted = true;
      form.submit();
    });
  }

  async function verifySaved(tableName, row) {
    let lastError = null;
    for (let attempt = 0; attempt < CONFIG.VERIFY_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await sleep(CONFIG.VERIFY_DELAY);
      try {
        const rows = await loadTable(tableName);
        const found = rows.find(item => String(item.id) === String(row.id));
        if (found) return found;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(`Google neapstiprināja saglabāšanu lapā “${tableName}”.`);
  }

  async function verifyRemoved(tableName, id) {
    let lastError = null;
    for (let attempt = 0; attempt < CONFIG.VERIFY_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await sleep(CONFIG.VERIFY_DELAY);
      try {
        const rows = await loadTable(tableName);
        if (!rows.some(item => String(item.id) === String(id))) return true;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(`Google neapstiprināja dzēšanu lapā “${tableName}”.`);
  }

  async function saveRow(table, row) {
    if (!TABLES[table]) throw new Error('Nederīga datu tabula.');
    if (!row?.id) throw new Error('Trūkst rindas ID.');

    await submitForm('save', { table, row });
    const saved = await verifySaved(table, row);
    updateCachedRow(table, saved);
    return saved;
  }

  async function removeRow(table, id) {
    if (!TABLES[table]) throw new Error('Nederīga datu tabula.');
    if (!id) throw new Error('Trūkst rindas ID.');

    await submitForm('remove', { table, id });
    await verifyRemoved(table, id);
    removeCachedRow(table, id);
    return true;
  }

  window.MS = {
    load,
    sync: load,
    saveRow,
    removeRow,
    session,
    setSession,
    clearSession,
    cache,
    setCache,
    clearCache,
    CONFIG
  };
})();