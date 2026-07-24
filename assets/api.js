(() => {
  'use strict';

  const CONFIG = {
    API_URL: 'https://script.google.com/macros/s/AKfycbyBVPgOoEUGQgUqeOUxT3CKDgnSK55lk5skfWIeCejWBNR7eKYxy_mrxdqN6CiaI4Lc/exec',
    SHEET_ID: '1-nheGOekslHRIf1KCeLDR5v-NN9oFtsCtfO082zQkHo',
    STORAGE_KEY: 'ms-season-session',
    CACHE_KEY: 'ms-app-cache-v9',
    TIMEOUT: 30000,
    VERIFY_ATTEMPTS: 8,
    VERIFY_DELAY: 500
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

  function normalizePinLike(value) {
    const text = String(value ?? '').trim();
    return /^\d+$/.test(text) && text.length < 5 ? text.padStart(5, '0') : text;
  }

  function normalizeRow(tableName, row = {}) {
    const normalized = { ...row };
    if (tableName === 'Players') normalized.accessCode = normalizePinLike(normalized.accessCode);
    if (tableName === 'Seasons') normalized.adminPinHash = normalizePinLike(normalized.adminPinHash);
    return normalized;
  }

  function normalizeDb(value = {}) {
    const data = emptyDb();
    Object.entries(TABLES).forEach(([tableName, config]) => {
      const rows = Array.isArray(value[config.key]) ? value[config.key] : [];
      data[config.key] = rows.map(row => normalizeRow(tableName, row));
    });
    data.serverTime = value.serverTime || new Date().toISOString();
    return data;
  }

  function jsonp(action = 'load', payload = {}) {
    return new Promise((resolve, reject) => {
      const callback = `msApi${Date.now()}${Math.random().toString(36).slice(2)}`;
      const script = document.createElement('script');
      let finished = false;

      const finish = (error, data) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        try { delete window[callback]; } catch (_) {}
        script.remove();
        error ? reject(error) : resolve(data);
      };

      const timer = window.setTimeout(
        () => finish(new Error('Google Apps Script neatbild.')),
        CONFIG.TIMEOUT
      );

      window[callback] = response => {
        if (!response || response.ok !== true) {
          finish(new Error(response?.error || 'Google Apps Script neatgrieza derīgu atbildi.'));
          return;
        }
        finish(null, response.data);
      };

      script.onerror = () => finish(new Error('Neizdevās ielādēt datus no Google Apps Script.'));
      const query = new URLSearchParams({
        action: String(action),
        payload: JSON.stringify(payload || {}),
        callback,
        _: String(Date.now())
      });
      script.src = `${CONFIG.API_URL}?${query.toString()}`;
      script.async = true;
      document.head.appendChild(script);
    });
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
            row[header] = sourceRow.c?.[index]?.v ?? '';
          });
          return normalizeRow(tableName, row);
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

  async function loadFromSheets() {
    const entries = await Promise.all(
      Object.entries(TABLES).map(async ([tableName, config]) => [config.key, await loadTable(tableName)])
    );
    return normalizeDb(Object.fromEntries(entries));
  }

  async function load() {
    let data;
    try {
      data = normalizeDb(await jsonp('load'));
    } catch (serverError) {
      try {
        data = await loadFromSheets();
      } catch (sheetError) {
        throw new Error(`${serverError.message} ${sheetError.message}`.trim());
      }
    }
    setCache(data);
    return data;
  }

  function updateCachedRow(tableName, row) {
    const config = TABLES[tableName];
    if (!config || !row?.id) return;
    const data = normalizeDb(cache());
    const rows = [...data[config.key]];
    const normalized = normalizeRow(tableName, row);
    const index = rows.findIndex(item => String(item.id) === String(normalized.id));
    if (index >= 0) rows[index] = { ...rows[index], ...normalized };
    else rows.push(normalized);
    data[config.key] = rows;
    setCache(data);
  }

  function removeCachedRow(tableName, id) {
    const config = TABLES[tableName];
    if (!config) return;
    const data = normalizeDb(cache());
    data[config.key] = data[config.key].filter(item => String(item.id) !== String(id));
    setCache(data);
  }

  function submitForm(action, payload) {
    return new Promise((resolve, reject) => {
      const requestId = `ms-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const frameName = `msFrame${Date.now()}${Math.random().toString(36).slice(2)}`;
      const iframe = document.createElement('iframe');
      const form = document.createElement('form');
      let submitted = false;
      let finished = false;

      const cleanup = () => {
        window.removeEventListener('message', onMessage);
        form.remove();
        window.setTimeout(() => iframe.remove(), 0);
      };

      const finish = (error, data = null) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        cleanup();
        error ? reject(error) : resolve(data);
      };

      const onMessage = event => {
        const message = event.data;
        if (!message || message.source !== 'MS_APPS_GS' || message.requestId !== requestId) return;
        if (message.ok !== true) finish(new Error(message.error || 'Google neizdevās saglabāt datus.'));
        else finish(null, message.data || null);
      };

      const timer = window.setTimeout(
        () => finish(new Error('Google datu serveris neatbildēja uz saglabāšanas pieprasījumu.')),
        CONFIG.TIMEOUT
      );

      window.addEventListener('message', onMessage);

      iframe.name = frameName;
      iframe.hidden = true;
      iframe.setAttribute('aria-hidden', 'true');
      iframe.onload = () => {
        if (!submitted) {
          submitted = true;
          form.submit();
          return;
        }
        window.setTimeout(() => finish(null, null), 250);
      };

      form.method = 'POST';
      form.action = CONFIG.API_URL;
      form.target = frameName;
      form.hidden = true;

      const fields = {
        action,
        payload: JSON.stringify(payload || {}),
        requestId
      };

      Object.entries(fields).forEach(([name, value]) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.appendChild(input);
      });

      document.body.appendChild(form);
      iframe.srcdoc = '<!doctype html><title>ready</title>';
      document.body.appendChild(iframe);
    });
  }

  async function verifySaved(tableName, row) {
    const config = TABLES[tableName];
    let lastError = null;
    for (let attempt = 0; attempt < CONFIG.VERIFY_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await sleep(CONFIG.VERIFY_DELAY);
      try {
        const data = normalizeDb(await jsonp('load'));
        const found = data[config.key].find(item => String(item.id) === String(row.id));
        if (found) return found;
      } catch (error) {
        lastError = error;
      }
    }
    try {
      const rows = await loadTable(tableName);
      const found = rows.find(item => String(item.id) === String(row.id));
      if (found) return found;
    } catch (error) {
      lastError = error;
    }
    throw lastError || new Error(`Google neapstiprināja saglabāšanu lapā “${tableName}”.`);
  }

  async function verifyRemoved(tableName, id) {
    const config = TABLES[tableName];
    let lastError = null;
    for (let attempt = 0; attempt < CONFIG.VERIFY_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await sleep(CONFIG.VERIFY_DELAY);
      try {
        const data = normalizeDb(await jsonp('load'));
        if (!data[config.key].some(item => String(item.id) === String(id))) return true;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(`Google neapstiprināja dzēšanu lapā “${tableName}”.`);
  }

  async function saveRow(table, row) {
    if (!TABLES[table]) throw new Error('Nederīga datu tabula.');
    if (!row?.id) throw new Error('Trūkst rindas ID.');
    const responseRow = await submitForm('save', { table, row });
    const saved = responseRow?.id ? normalizeRow(table, responseRow) : await verifySaved(table, row);
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
    normalizePinLike,
    CONFIG
  };
})();