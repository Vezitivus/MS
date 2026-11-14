const ALLOWED_ORIGIN = 'https://vezitivus.github.io';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface Env {
  DB: D1Database;
  IP_SALT: string;
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers();
  const origin = request.headers.get('Origin') || '';
  if (origin === ALLOWED_ORIGIN) {
    headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Access-Control-Max-Age', '86400');
  }
  return headers;
}

function json(request: Request, body: unknown, status = 200): Response {
  const headers = corsHeaders(request);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function ensureSchema(db: D1Database): Promise<void> {
  await db.prepare('CREATE TABLE IF NOT EXISTS stats (k TEXT PRIMARY KEY, v INTEGER NOT NULL)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY, seen INTEGER NOT NULL)').run();
  await db.prepare("INSERT OR IGNORE INTO stats (k, v) VALUES ('unique', 0)").run();
  await db.prepare("INSERT OR IGNORE INTO stats (k, v) VALUES ('total', 0)").run();
}

async function readCounts(db: D1Database): Promise<{ unique: number; total: number }> {
  const uniqueRow = await db.prepare("SELECT v FROM stats WHERE k = 'unique'").first<{ v: number }>();
  const totalRow = await db.prepare("SELECT v FROM stats WHERE k = 'total'").first<{ v: number }>();
  return {
    unique: Number(uniqueRow?.v ?? 0),
    total: Number(totalRow?.v ?? 0)
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    try {
      await ensureSchema(env.DB);

      if (request.method === 'GET' && (url.pathname === '/count' || url.pathname === '/')) {
        const counts = await readCounts(env.DB);
        return json(request, counts);
      }

      if (request.method === 'POST' && url.pathname === '/press') {
        let visitor = '';
        try {
          const body = await request.json() as { visitor?: unknown; id?: unknown };
          const raw = typeof body?.visitor === 'string' ? body.visitor : typeof body?.id === 'string' ? body.id : '';
          if (UUID_RE.test(raw.trim())) visitor = raw.trim().toLowerCase();
        } catch {
          visitor = '';
        }

        const ip = request.headers.get('CF-Connecting-IP') || '';
        const salt = env.IP_SALT || '';
        const ipHash = ip && salt ? await sha256Hex(`${ip}:${salt}`) : '';

        const keys: string[] = [];
        if (visitor) keys.push(`v:${visitor}`);
        if (ipHash) keys.push(`ip:${ipHash}`);

        const now = Date.now();
        const statements = keys.map((key) =>
          env.DB.prepare('INSERT OR IGNORE INTO visitors (id, seen) VALUES (?, ?)').bind(key, now)
        );
        statements.push(env.DB.prepare("UPDATE stats SET v = v + 1 WHERE k = 'total'"));

        const results = await env.DB.batch(statements);
        const insertResults = results.slice(0, keys.length);
        const allNew = keys.length > 0 && insertResults.every((row) => (row.meta?.changes ?? 0) === 1);
        if (allNew) {
          await env.DB.prepare("UPDATE stats SET v = v + 1 WHERE k = 'unique'").run();
        }

        const counts = await readCounts(env.DB);
        return json(request, counts);
      }

      return json(request, { error: 'not found' }, 404);
    } catch (error) {
      return json(request, { error: 'server error' }, 500);
    }
  }
};
