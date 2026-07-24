import app from './index.js';

const DEFAULT_ORIGIN = 'https://vezitivus.github.io';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/admin/create-season') {
      try {
        const body = await request.json();
        const name = cleanName(body.name);
        const code = cleanCode(body.code);
        const pin = cleanPin(body.pin);
        const bestCount = cleanBestCount(body.bestCount);
        const normalizedCode = normalizeText(code);

        const duplicate = await env.DB.prepare('SELECT id FROM seasons WHERE code_normalized = ?')
          .bind(normalizedCode)
          .first();
        if (duplicate) return json(request, env, { ok: false, error: 'Šāds sērijas kods jau pastāv.' }, 409);

        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const adminPinHash = await hashPin(pin);

        await env.DB.prepare(`
          INSERT INTO seasons (id, name, code, code_normalized, best_count, active, admin_pin_hash, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
        `).bind(id, name, code, normalizedCode, bestCount, adminPinHash, now, now).run();

        const token = await createAdminSession(env, id);
        return json(request, env, {
          ok: true,
          token,
          season: {
            id,
            name,
            code,
            bestCount,
            active: true,
            createdAt: now,
            updatedAt: now
          }
        }, 201);
      } catch (error) {
        const status = Number(error?.status) || 500;
        return json(request, env, {
          ok: false,
          error: status >= 500 ? 'Servera kļūda. Mēģini vēlreiz.' : String(error.message || error)
        }, status);
      }
    }

    return app.fetch(request, env, ctx);
  }
};

async function createAdminSession(env, seasonId) {
  const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 86400000).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now.toISOString()),
    env.DB.prepare(`
      INSERT INTO sessions (token_hash, session_type, subject_id, expires_at, created_at)
      VALUES (?, 'admin', ?, ?, ?)
    `).bind(tokenHash, seasonId, expiresAt, now.toISOString())
  ]);
  return token;
}

async function hashPin(pin) {
  const iterations = 120000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return `pbkdf2$${iterations}$${base64Url(salt)}$${base64Url(new Uint8Array(bits))}`;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function cleanName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) throw httpError(400, 'Sērijas nosaukumam jābūt no 2 līdz 80 rakstzīmēm.');
  return name;
}

function cleanCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{4,20}$/.test(code)) throw httpError(400, 'Sērijas kodam jābūt 4–20 rakstzīmēm.');
  return code;
}

function cleanPin(value) {
  const pin = String(value ?? '').trim();
  if (!/^\d{5}$/.test(pin)) throw httpError(400, 'Admin PIN jābūt tieši 5 cipariem.');
  return pin;
}

function cleanBestCount(value) {
  const count = Number(value ?? 12);
  if (!Number.isInteger(count) || count < 1 || count > 100) throw httpError(400, 'Labāko rezultātu skaitam jābūt no 1 līdz 100.');
  return count;
}

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('lv-LV').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function corsHeaders(request, env) {
  const configured = String(env.ALLOWED_ORIGIN || DEFAULT_ORIGIN).split(',').map(value => value.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': configured.includes(origin) ? origin : configured[0] || DEFAULT_ORIGIN,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Migration-Secret',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Cache-Control': 'no-store'
  };
}

function json(request, env, value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...corsHeaders(request, env), 'Content-Type': 'application/json; charset=utf-8' }
  });
}
