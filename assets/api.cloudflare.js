(() => {
  'use strict';

  const CONFIG_KEY = 'ms-cloudflare-api-url';
  const PLAYER_TOKEN_KEY = 'ms-player-token-v1';
  const ADMIN_TOKEN_KEY = 'ms-admin-token-v1';
  const DEFAULT_API_URL = 'https://vezitivus-ms-api.YOUR_SUBDOMAIN.workers.dev';

  function apiUrl() {
    return String(localStorage.getItem(CONFIG_KEY) || DEFAULT_API_URL).replace(/\/$/, '');
  }

  function setApiUrl(value) {
    const url = String(value || '').trim().replace(/\/$/, '');
    if (!/^https:\/\//.test(url)) throw new Error('API adresei jāsākas ar https://');
    localStorage.setItem(CONFIG_KEY, url);
  }

  function playerToken() { return localStorage.getItem(PLAYER_TOKEN_KEY) || ''; }
  function adminToken() { return localStorage.getItem(ADMIN_TOKEN_KEY) || ''; }
  function setPlayerToken(value) { value ? localStorage.setItem(PLAYER_TOKEN_KEY, value) : localStorage.removeItem(PLAYER_TOKEN_KEY); }
  function setAdminToken(value) { value ? localStorage.setItem(ADMIN_TOKEN_KEY, value) : localStorage.removeItem(ADMIN_TOKEN_KEY); }

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (options.token) headers.set('Authorization', `Bearer ${options.token}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout || 12000);

    try {
      const response = await fetch(`${apiUrl()}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
        cache: 'no-store'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) {
        const error = new Error(data.error || `API kļūda: HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Serveris neatbild pietiekami ātri.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  const player = {
    async register({ name, pin, image = '', imagePublicId = '' }) {
      const data = await request('/api/player/register', { method: 'POST', body: { name, pin, image, imagePublicId } });
      setPlayerToken(data.token);
      return data;
    },
    async login({ name, pin }) {
      const data = await request('/api/player/login', { method: 'POST', body: { name, pin } });
      setPlayerToken(data.token);
      return data;
    },
    bootstrap() {
      return request('/api/player/bootstrap', { token: playerToken() });
    },
    updateProfile({ image = '', imagePublicId = '' }) {
      return request('/api/player/profile', { method: 'PUT', token: playerToken(), body: { image, imagePublicId } });
    },
    joinSeason(code) {
      return request('/api/player/join-season', { method: 'POST', token: playerToken(), body: { code } });
    },
    registerActivity(activityId) {
      return request('/api/player/register-activity', { method: 'POST', token: playerToken(), body: { activityId } });
    },
    cancelActivity(activityId) {
      return request('/api/player/register-activity', { method: 'DELETE', token: playerToken(), body: { activityId } });
    },
    async logout() {
      const token = playerToken();
      if (token) await request('/api/logout', { method: 'POST', token }).catch(() => {});
      setPlayerToken('');
    },
    token: playerToken
  };

  const admin = {
    async login({ code, pin }) {
      const data = await request('/api/admin/login', { method: 'POST', body: { code, pin } });
      setAdminToken(data.token);
      return data;
    },
    bootstrap() {
      return request('/api/admin/bootstrap', { token: adminToken() });
    },
    updateSeason(payload) {
      return request('/api/admin/season', { method: 'PUT', token: adminToken(), body: payload });
    },
    createActivity(payload) {
      return request('/api/admin/activity', { method: 'POST', token: adminToken(), body: payload });
    },
    updateActivity(activityId, payload) {
      return request(`/api/admin/activity/${encodeURIComponent(activityId)}`, { method: 'PUT', token: adminToken(), body: payload });
    },
    deleteActivity(activityId) {
      return request(`/api/admin/activity/${encodeURIComponent(activityId)}`, { method: 'DELETE', token: adminToken() });
    },
    saveResults(activityId, rows) {
      return request(`/api/admin/activity/${encodeURIComponent(activityId)}/results`, { method: 'POST', token: adminToken(), body: { rows } });
    },
    async logout() {
      const token = adminToken();
      if (token) await request('/api/logout', { method: 'POST', token }).catch(() => {});
      setAdminToken('');
    },
    token: adminToken
  };

  window.MSCloudflare = {
    request,
    apiUrl,
    setApiUrl,
    player,
    admin,
    clearAll() {
      setPlayerToken('');
      setAdminToken('');
    }
  };
})();
