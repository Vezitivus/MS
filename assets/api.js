(() => {
  'use strict';

  const CONFIG = {
    API_URL: 'https://script.google.com/macros/s/AKfycbyBVPgOoEUGQgUqeOUxT3CKDgnSK55lk5skfWIeCejWBNR7eKYxy_mrxdqN6CiaI4Lc/exec',
    STORAGE_KEY: 'ms-season-session',
    CACHE_KEY: 'ms-app-cache-v6',
    TIMEOUT: 30000
  };

  const TABLE_TO_KEY = {
    Players: 'players',
    Seasons: 'seasons',
    Memberships: 'memberships',
    Activities: 'activities',
    Registrations: 'registrations',
    Results: 'results'
  };

  function readJson(key, fallback = null) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value ?? fallback;
    } catch (_) {
      return fallback;
    }
  }

  function request(action, payload = {}) {
    return new Promise((resolve, reject) => {
      const callback = `__ms_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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

      const timer = window.setTimeout(() => {
        finish(new Error('Google datu serveris neatbild. Mēģini vēlreiz.'));
      }, CONFIG.TIMEOUT);

      window[callback] = response => {
        if (!response || response.ok !== true) {
          const message = response?.error || 'Google neatgrieza derīgu atbildi.';
          finish(new Error(message));
          return;
        }
        finish(null, response.data);
      };

      script.onerror = () => {
        finish(new Error('Neizdevās sasniegt Google datu serveri.'));
      };

      const query = new URLSearchParams({
        action: String(action),
        payload: JSON.stringify(payload || {}),
        callback,
        t: String(Date.now())
      });

      script.src = `${CONFIG.API_URL}?${query.toString()}`;
      script.async = true;
      script.referrerPolicy = 'no-referrer';
      document.head.appendChild(script);
    });
  }

  function session() {
    return readJson(CONFIG.STORAGE_KEY);
  }

  function setSession(value) {
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(value));
  }

  function clearSession() {
    localStorage.removeItem(CONFIG.STORAGE_KEY);
  }

  function cache() {
    return readJson(CONFIG.CACHE_KEY, {
      players: [],
      seasons: [],
      memberships: [],
      activities: [],
      registrations: [],
      results: []
    });
  }

  function setCache(value) {
    localStorage.setItem(
      CONFIG.CACHE_KEY,
      JSON.stringify({ ...value, cachedAt: Date.now() })
    );
  }

  function clearCache() {
    localStorage.removeItem(CONFIG.CACHE_KEY);
  }

  function upsertCachedRow(table, row) {
    const key = TABLE_TO_KEY[table];
    if (!key || !row?.id) return;

    const data = cache();
    const rows = Array.isArray(data[key]) ? [...data[key]] : [];
    const index = rows.findIndex(item => String(item.id) === String(row.id));

    if (index >= 0) rows[index] = { ...rows[index], ...row };
    else rows.push(row);

    data[key] = rows;
    setCache(data);
  }

  function removeCachedRow(table, id) {
    const key = TABLE_TO_KEY[table];
    if (!key) return;

    const data = cache();
    data[key] = (data[key] || []).filter(item => String(item.id) !== String(id));
    setCache(data);
  }

  async function load() {
    const data = await request('load');
    setCache(data);
    return data;
  }

  async function saveRow(table, row) {
    if (!TABLE_TO_KEY[table]) throw new Error('Nederīga datu tabula.');
    if (!row?.id) throw new Error('Trūkst rindas ID.');

    const saved = await request('save', { table, row });
    upsertCachedRow(table, saved || row);
    return saved || row;
  }

  async function removeRow(table, id) {
    if (!TABLE_TO_KEY[table]) throw new Error('Nederīga datu tabula.');
    if (!id) throw new Error('Trūkst rindas ID.');

    await request('remove', { table, id });
    removeCachedRow(table, id);
    return true;
  }

  window.MS = {
    request,
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