const SESSION_DAYS = 30;
const MAX_BODY_BYTES = 1_000_000;
const DEFAULT_ORIGIN = 'https://vezitivus.github.io';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        const check = await env.DB.prepare('SELECT 1 AS ok').first();
        return json(request, env, { ok: true, service: 'vezitivus-ms-api', database: check?.ok === 1 });
      }

      if (request.method === 'POST' && url.pathname === '/api/player/register') {
        return json(request, env, await registerPlayer(request, env), 201);
      }

      if (request.method === 'POST' && url.pathname === '/api/player/login') {
        return json(request, env, await loginPlayer(request, env));
      }

      if (request.method === 'GET' && url.pathname === '/api/player/bootstrap') {
        return json(request, env, await playerBootstrap(request, env));
      }

      if (request.method === 'PUT' && url.pathname === '/api/player/profile') {
        return json(request, env, await updatePlayerProfile(request, env));
      }

      if (request.method === 'POST' && url.pathname === '/api/player/join-season') {
        return json(request, env, await joinSeason(request, env));
      }

      if (request.method === 'POST' && url.pathname === '/api/player/register-activity') {
        return json(request, env, await registerActivity(request, env));
      }

      if (request.method === 'DELETE' && url.pathname === '/api/player/register-activity') {
        return json(request, env, await cancelActivityRegistration(request, env));
      }

      if (request.method === 'POST' && url.pathname === '/api/admin/login') {
        return json(request, env, await loginAdmin(request, env));
      }

      if (request.method === 'GET' && url.pathname === '/api/admin/bootstrap') {
        return json(request, env, await adminBootstrap(request, env));
      }

      if (request.method === 'PUT' && url.pathname === '/api/admin/season') {
        return json(request, env, await updateSeason(request, env));
      }

      if (request.method === 'POST' && url.pathname === '/api/admin/activity') {
        return json(request, env, await createActivity(request, env), 201);
      }

      const activityMatch = url.pathname.match(/^\/api\/admin\/activity\/([^/]+)$/);
      if (activityMatch && request.method === 'PUT') {
        return json(request, env, await updateActivity(request, env, activityMatch[1]));
      }
      if (activityMatch && request.method === 'DELETE') {
        return json(request, env, await deleteActivity(request, env, activityMatch[1]));
      }

      const resultsMatch = url.pathname.match(/^\/api\/admin\/activity\/([^/]+)\/results$/);
      if (resultsMatch && request.method === 'POST') {
        return json(request, env, await saveActivityResults(request, env, resultsMatch[1]));
      }

      if (request.method === 'POST' && url.pathname === '/api/logout') {
        return json(request, env, await logout(request, env));
      }

      if (request.method === 'POST' && url.pathname === '/api/migrate/google') {
        return json(request, env, await migrateGoogleData(request, env));
      }

      return json(request, env, { ok: false, error: 'Maršruts nav atrasts.' }, 404);
    } catch (error) {
      console.error(error);
      const status = Number(error?.status) || 500;
      const message = status >= 500 ? 'Servera kļūda. Mēģini vēlreiz.' : String(error.message || error);
      return json(request, env, { ok: false, error: message }, status);
    }
  }
};

async function registerPlayer(request, env) {
  const body = await readJson(request);
  const name = cleanName(body.name);
  const pin = cleanPin(body.pin);
  const image = cleanOptional(body.image, 1000);
  const imagePublicId = cleanOptional(body.imagePublicId, 300);
  const normalized = normalizeText(name);
  const existing = await env.DB.prepare('SELECT id FROM players WHERE name_normalized = ?').bind(normalized).first();
  if (existing) throw httpError(409, 'Profils ar šādu vārdu jau pastāv.');

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const pinHash = await hashPin(pin);

  await env.DB.prepare(`
    INSERT INTO players (id, name, name_normalized, image, image_public_id, pin_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, name, normalized, image, imagePublicId, pinHash, now, now).run();

  const token = await createSession(env, 'player', id);
  return { ok: true, token, player: publicPlayer({ id, name, image, image_public_id: imagePublicId, created_at: now, updated_at: now }) };
}

async function loginPlayer(request, env) {
  const body = await readJson(request);
  const normalized = normalizeText(cleanName(body.name));
  const pin = cleanPin(body.pin);
  const player = await env.DB.prepare('SELECT * FROM players WHERE name_normalized = ?').bind(normalized).first();
  if (!player || !(await verifyPin(pin, player.pin_hash))) {
    throw httpError(401, 'Nepareizs vārds vai PIN kods.');
  }
  const token = await createSession(env, 'player', player.id);
  return { ok: true, token, player: publicPlayer(player) };
}

async function playerBootstrap(request, env) {
  const session = await requireSession(request, env, 'player');
  const player = await env.DB.prepare('SELECT * FROM players WHERE id = ?').bind(session.subject_id).first();
  if (!player) throw httpError(404, 'Spēlētājs nav atrasts.');

  const ownMemberships = rows(await env.DB.prepare(`
    SELECT id, season_id, player_id, role, status, joined_at, created_at, updated_at
    FROM memberships
    WHERE player_id = ? AND status != 'removed'
    ORDER BY joined_at
  `).bind(player.id).all()).map(mapMembership);

  const seasonIds = [...new Set(ownMemberships.map(item => item.seasonId))];
  if (!seasonIds.length) {
    return emptyBootstrap(publicPlayer(player), ownMemberships);
  }

  const placeholders = seasonIds.map(() => '?').join(',');
  const [seasonResult, activityResult, membershipResult, playerResult, resultResult, registrationResult] = await Promise.all([
    env.DB.prepare(`SELECT * FROM seasons WHERE id IN (${placeholders}) ORDER BY name`).bind(...seasonIds).all(),
    env.DB.prepare(`SELECT * FROM activities WHERE season_id IN (${placeholders}) ORDER BY start_at`).bind(...seasonIds).all(),
    env.DB.prepare(`SELECT * FROM memberships WHERE season_id IN (${placeholders}) AND status != 'removed'`).bind(...seasonIds).all(),
    env.DB.prepare(`
      SELECT DISTINCT p.id, p.name, p.image, p.image_public_id, p.created_at, p.updated_at
      FROM players p
      JOIN memberships m ON m.player_id = p.id
      WHERE m.season_id IN (${placeholders}) AND m.status != 'removed'
      ORDER BY p.name
    `).bind(...seasonIds).all(),
    env.DB.prepare(`SELECT * FROM results WHERE season_id IN (${placeholders})`).bind(...seasonIds).all(),
    env.DB.prepare(`SELECT * FROM registrations WHERE player_id = ? AND status != 'removed'`).bind(player.id).all()
  ]);

  return {
    ok: true,
    player: publicPlayer(player),
    players: rows(playerResult).map(publicPlayer),
    seasons: rows(seasonResult).map(mapSeason),
    memberships: rows(membershipResult).map(mapMembership),
    activities: rows(activityResult).map(mapActivity),
    registrations: rows(registrationResult).map(mapRegistration),
    results: rows(resultResult).map(mapResult),
    serverTime: new Date().toISOString()
  };
}

async function updatePlayerProfile(request, env) {
  const session = await requireSession(request, env, 'player');
  const body = await readJson(request);
  const image = cleanOptional(body.image, 1000);
  const imagePublicId = cleanOptional(body.imagePublicId, 300);
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE players SET image = ?, image_public_id = ?, updated_at = ? WHERE id = ?')
    .bind(image, imagePublicId, now, session.subject_id).run();
  const player = await env.DB.prepare('SELECT * FROM players WHERE id = ?').bind(session.subject_id).first();
  return { ok: true, player: publicPlayer(player) };
}

async function joinSeason(request, env) {
  const session = await requireSession(request, env, 'player');
  const body = await readJson(request);
  const code = cleanCode(body.code);
  const season = await env.DB.prepare('SELECT * FROM seasons WHERE code_normalized = ? AND active = 1')
    .bind(normalizeText(code)).first();
  if (!season) throw httpError(404, 'Sērija ar šādu kodu nav atrasta.');

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO memberships (id, season_id, player_id, role, status, joined_at, created_at, updated_at)
    VALUES (?, ?, ?, 'player', 'active', ?, ?, ?)
    ON CONFLICT(season_id, player_id) DO UPDATE SET
      status = 'active',
      updated_at = excluded.updated_at
  `).bind(id, season.id, session.subject_id, now, now, now).run();

  const membership = await env.DB.prepare('SELECT * FROM memberships WHERE season_id = ? AND player_id = ?')
    .bind(season.id, session.subject_id).first();
  return { ok: true, season: mapSeason(season), membership: mapMembership(membership) };
}

async function registerActivity(request, env) {
  const session = await requireSession(request, env, 'player');
  const body = await readJson(request);
  const activityId = requiredId(body.activityId, 'Trūkst aktivitātes ID.');
  const activity = await env.DB.prepare('SELECT * FROM activities WHERE id = ?').bind(activityId).first();
  if (!activity) throw httpError(404, 'Aktivitāte nav atrasta.');

  const membership = await env.DB.prepare(`
    SELECT id FROM memberships
    WHERE season_id = ? AND player_id = ? AND status != 'removed'
  `).bind(activity.season_id, session.subject_id).first();
  if (!membership) throw httpError(403, 'Vispirms pievienojies sērijai.');

  const nowDate = new Date();
  const openAt = activity.registration_open_at ? new Date(activity.registration_open_at) : new Date(new Date(activity.start_at).getTime() - 30 * 86400000);
  const closeAt = activity.registration_close_at ? new Date(activity.registration_close_at) : new Date(activity.start_at);
  if (nowDate < openAt) throw httpError(409, 'Pieteikšanās vēl nav sākusies.');
  if (nowDate > closeAt) throw httpError(409, 'Pieteikšanās ir beigusies.');

  const now = nowDate.toISOString();
  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO registrations (id, season_id, activity_id, player_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'registered', ?, ?)
    ON CONFLICT(activity_id, player_id) DO UPDATE SET
      status = 'registered',
      updated_at = excluded.updated_at
  `).bind(id, activity.season_id, activity.id, session.subject_id, now, now).run();

  const registration = await env.DB.prepare('SELECT * FROM registrations WHERE activity_id = ? AND player_id = ?')
    .bind(activity.id, session.subject_id).first();
  return { ok: true, registration: mapRegistration(registration) };
}

async function cancelActivityRegistration(request, env) {
  const session = await requireSession(request, env, 'player');
  const body = await readJson(request);
  const activityId = requiredId(body.activityId, 'Trūkst aktivitātes ID.');
  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE registrations SET status = 'removed', updated_at = ?
    WHERE activity_id = ? AND player_id = ?
  `).bind(now, activityId, session.subject_id).run();
  return { ok: true };
}

async function loginAdmin(request, env) {
  const body = await readJson(request);
  const code = cleanCode(body.code);
  const pin = cleanPin(body.pin);
  const season = await env.DB.prepare('SELECT * FROM seasons WHERE code_normalized = ?')
    .bind(normalizeText(code)).first();
  if (!season || !(await verifyPin(pin, season.admin_pin_hash))) {
    throw httpError(401, 'Nepareizs sērijas kods vai admin PIN.');
  }
  const token = await createSession(env, 'admin', season.id);
  return { ok: true, token, season: mapSeason(season) };
}

async function adminBootstrap(request, env) {
  const session = await requireSession(request, env, 'admin');
  const season = await env.DB.prepare('SELECT * FROM seasons WHERE id = ?').bind(session.subject_id).first();
  if (!season) throw httpError(404, 'Sērija nav atrasta.');

  const [playersResult, membershipsResult, activitiesResult, registrationsResult, resultsResult] = await Promise.all([
    env.DB.prepare(`
      SELECT DISTINCT p.id, p.name, p.image, p.image_public_id, p.created_at, p.updated_at
      FROM players p
      JOIN memberships m ON m.player_id = p.id
      WHERE m.season_id = ? AND m.status != 'removed'
      ORDER BY p.name
    `).bind(season.id).all(),
    env.DB.prepare('SELECT * FROM memberships WHERE season_id = ? AND status != \'removed\'').bind(season.id).all(),
    env.DB.prepare('SELECT * FROM activities WHERE season_id = ? ORDER BY start_at').bind(season.id).all(),
    env.DB.prepare('SELECT * FROM registrations WHERE season_id = ? AND status != \'removed\'').bind(season.id).all(),
    env.DB.prepare('SELECT * FROM results WHERE season_id = ?').bind(season.id).all()
  ]);

  return {
    ok: true,
    season: mapSeason(season),
    seasons: [mapSeason(season)],
    players: rows(playersResult).map(publicPlayer),
    memberships: rows(membershipsResult).map(mapMembership),
    activities: rows(activitiesResult).map(mapActivity),
    registrations: rows(registrationsResult).map(mapRegistration),
    results: rows(resultsResult).map(mapResult),
    serverTime: new Date().toISOString()
  };
}

async function updateSeason(request, env) {
  const session = await requireSession(request, env, 'admin');
  const body = await readJson(request);
  const name = cleanName(body.name);
  const code = cleanCode(body.code);
  const codeNormalized = normalizeText(code);
  const bestCount = cleanBestCount(body.bestCount);
  const active = body.active === false ? 0 : 1;
  const duplicate = await env.DB.prepare('SELECT id FROM seasons WHERE code_normalized = ? AND id != ?')
    .bind(codeNormalized, session.subject_id).first();
  if (duplicate) throw httpError(409, 'Šāds sērijas kods jau pastāv.');

  const now = new Date().toISOString();
  if (body.newPin) {
    const newPinHash = await hashPin(cleanPin(body.newPin));
    await env.DB.prepare(`
      UPDATE seasons SET name = ?, code = ?, code_normalized = ?, best_count = ?, active = ?, admin_pin_hash = ?, updated_at = ?
      WHERE id = ?
    `).bind(name, code, codeNormalized, bestCount, active, newPinHash, now, session.subject_id).run();
  } else {
    await env.DB.prepare(`
      UPDATE seasons SET name = ?, code = ?, code_normalized = ?, best_count = ?, active = ?, updated_at = ?
      WHERE id = ?
    `).bind(name, code, codeNormalized, bestCount, active, now, session.subject_id).run();
  }
  const season = await env.DB.prepare('SELECT * FROM seasons WHERE id = ?').bind(session.subject_id).first();
  return { ok: true, season: mapSeason(season) };
}

async function createActivity(request, env) {
  const session = await requireSession(request, env, 'admin');
  const body = await readJson(request);
  const activity = cleanActivity(body, session.subject_id, crypto.randomUUID(), null);
  await env.DB.prepare(`
    INSERT INTO activities (id, season_id, name, start_at, registration_open_at, registration_close_at, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(activity.id, activity.season_id, activity.name, activity.start_at, activity.registration_open_at, activity.registration_close_at, activity.description, activity.created_at, activity.updated_at).run();
  return { ok: true, activity: mapActivity(activity) };
}

async function updateActivity(request, env, activityId) {
  const session = await requireSession(request, env, 'admin');
  const existing = await env.DB.prepare('SELECT * FROM activities WHERE id = ? AND season_id = ?')
    .bind(activityId, session.subject_id).first();
  if (!existing) throw httpError(404, 'Aktivitāte nav atrasta.');
  const body = await readJson(request);
  const activity = cleanActivity(body, session.subject_id, existing.id, existing.created_at);
  await env.DB.prepare(`
    UPDATE activities SET name = ?, start_at = ?, registration_open_at = ?, registration_close_at = ?, description = ?, updated_at = ?
    WHERE id = ? AND season_id = ?
  `).bind(activity.name, activity.start_at, activity.registration_open_at, activity.registration_close_at, activity.description, activity.updated_at, activity.id, session.subject_id).run();
  return { ok: true, activity: mapActivity(activity) };
}

async function deleteActivity(request, env, activityId) {
  const session = await requireSession(request, env, 'admin');
  const result = await env.DB.prepare('DELETE FROM activities WHERE id = ? AND season_id = ?')
    .bind(activityId, session.subject_id).run();
  if (!result.meta?.changes) throw httpError(404, 'Aktivitāte nav atrasta.');
  return { ok: true };
}

async function saveActivityResults(request, env, activityId) {
  const session = await requireSession(request, env, 'admin');
  const activity = await env.DB.prepare('SELECT * FROM activities WHERE id = ? AND season_id = ?')
    .bind(activityId, session.subject_id).first();
  if (!activity) throw httpError(404, 'Aktivitāte nav atrasta.');

  const body = await readJson(request);
  if (!Array.isArray(body.rows)) throw httpError(400, 'Trūkst rezultātu saraksta.');
  if (body.rows.length > 500) throw httpError(400, 'Vienā reizē drīkst saglabāt līdz 500 dalībniekiem.');

  const memberRows = rows(await env.DB.prepare(`
    SELECT player_id FROM memberships WHERE season_id = ? AND status != 'removed'
  `).bind(session.subject_id).all());
  const memberIds = new Set(memberRows.map(item => String(item.player_id)));
  const now = new Date().toISOString();
  const statements = [];

  for (const row of body.rows) {
    const playerId = requiredId(row.playerId, 'Trūkst spēlētāja ID.');
    if (!memberIds.has(playerId)) continue;
    const registered = row.registered === true;
    const registrationId = cleanOptional(row.registrationId, 100) || crypto.randomUUID();
    statements.push(env.DB.prepare(`
      INSERT INTO registrations (id, season_id, activity_id, player_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(activity_id, player_id) DO UPDATE SET
        status = excluded.status,
        updated_at = excluded.updated_at
    `).bind(registrationId, session.subject_id, activity.id, playerId, registered ? 'registered' : 'removed', now, now));

    const hasPoints = row.points !== '' && row.points !== null && row.points !== undefined && Number.isFinite(Number(row.points));
    if (registered && hasPoints) {
      const resultId = cleanOptional(row.resultId, 100) || crypto.randomUUID();
      statements.push(env.DB.prepare(`
        INSERT INTO results (id, season_id, activity_id, player_id, points, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(activity_id, player_id) DO UPDATE SET
          points = excluded.points,
          updated_at = excluded.updated_at
      `).bind(resultId, session.subject_id, activity.id, playerId, Number(row.points), now, now));
    } else if (!registered) {
      statements.push(env.DB.prepare('DELETE FROM results WHERE activity_id = ? AND player_id = ?').bind(activity.id, playerId));
    }
  }

  await runInChunks(env.DB, statements, 80);
  return { ok: true, saved: body.rows.length };
}

async function logout(request, env) {
  const token = bearerToken(request);
  if (token) {
    const tokenHash = await sha256(token);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
  }
  return { ok: true };
}

async function migrateGoogleData(request, env) {
  const provided = request.headers.get('X-Migration-Secret') || '';
  if (!env.MIGRATION_SECRET || provided !== env.MIGRATION_SECRET) {
    throw httpError(403, 'Migrācijas piekļuve liegta.');
  }

  const data = await readJson(request);
  const now = new Date().toISOString();
  const statements = [];
  const counts = { players: 0, seasons: 0, memberships: 0, activities: 0, registrations: 0, results: 0 };

  for (const source of arrayOf(data.players)) {
    const name = cleanName(source.name);
    const pin = migrationPin(source.accessCode);
    const pinHash = await hashPin(pin);
    const createdAt = isoOrNow(source.createdAt, now);
    const updatedAt = isoOrNow(source.updatedAt, now);
    statements.push(env.DB.prepare(`
      INSERT INTO players (id, name, name_normalized, image, image_public_id, pin_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        name_normalized = excluded.name_normalized,
        image = excluded.image,
        image_public_id = excluded.image_public_id,
        pin_hash = excluded.pin_hash,
        updated_at = excluded.updated_at
    `).bind(requiredId(source.id, 'Spēlētājam trūkst ID.'), name, normalizeText(name), cleanOptional(source.image, 1000), cleanOptional(source.imagePublicId, 300), pinHash, createdAt, updatedAt));
    counts.players += 1;
  }

  for (const source of arrayOf(data.seasons)) {
    const name = cleanName(source.name);
    const code = cleanCode(source.code);
    const pin = migrationPin(source.adminPinHash ?? source.adminPin);
    const pinHash = await hashPin(pin);
    const createdAt = isoOrNow(source.createdAt, now);
    const updatedAt = isoOrNow(source.updatedAt, now);
    statements.push(env.DB.prepare(`
      INSERT INTO seasons (id, name, code, code_normalized, best_count, active, admin_pin_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        code = excluded.code,
        code_normalized = excluded.code_normalized,
        best_count = excluded.best_count,
        active = excluded.active,
        admin_pin_hash = excluded.admin_pin_hash,
        updated_at = excluded.updated_at
    `).bind(requiredId(source.id, 'Sērijai trūkst ID.'), name, code, normalizeText(code), cleanBestCount(source.bestCount), toBoolInt(source.active, 1), pinHash, createdAt, updatedAt));
    counts.seasons += 1;
  }

  for (const source of arrayOf(data.memberships)) {
    const createdAt = isoOrNow(source.createdAt, now);
    const updatedAt = isoOrNow(source.updatedAt, now);
    const joinedAt = isoOrNow(source.joinedAt, createdAt);
    statements.push(env.DB.prepare(`
      INSERT INTO memberships (id, season_id, player_id, role, status, joined_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(season_id, player_id) DO UPDATE SET
        role = excluded.role,
        status = excluded.status,
        joined_at = excluded.joined_at,
        updated_at = excluded.updated_at
    `).bind(requiredId(source.id, 'Dalībai trūkst ID.'), requiredId(source.seasonId), requiredId(source.playerId), cleanOptional(source.role, 30) || 'player', cleanOptional(source.status, 30) || 'active', joinedAt, createdAt, updatedAt));
    counts.memberships += 1;
  }

  for (const source of arrayOf(data.activities)) {
    const createdAt = isoOrNow(source.createdAt, now);
    const updatedAt = isoOrNow(source.updatedAt, now);
    statements.push(env.DB.prepare(`
      INSERT INTO activities (id, season_id, name, start_at, registration_open_at, registration_close_at, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        start_at = excluded.start_at,
        registration_open_at = excluded.registration_open_at,
        registration_close_at = excluded.registration_close_at,
        description = excluded.description,
        updated_at = excluded.updated_at
    `).bind(requiredId(source.id), requiredId(source.seasonId), cleanName(source.name), requiredDate(source.startAt, 'Nederīgs aktivitātes datums.'), optionalDate(source.registrationOpenAt), optionalDate(source.registrationCloseAt), cleanOptional(source.description, 5000), createdAt, updatedAt));
    counts.activities += 1;
  }

  for (const source of arrayOf(data.registrations)) {
    const createdAt = isoOrNow(source.createdAt, now);
    const updatedAt = isoOrNow(source.updatedAt, now);
    statements.push(env.DB.prepare(`
      INSERT INTO registrations (id, season_id, activity_id, player_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(activity_id, player_id) DO UPDATE SET
        status = excluded.status,
        updated_at = excluded.updated_at
    `).bind(requiredId(source.id), requiredId(source.seasonId), requiredId(source.activityId), requiredId(source.playerId), cleanOptional(source.status, 30) || 'registered', createdAt, updatedAt));
    counts.registrations += 1;
  }

  for (const source of arrayOf(data.results)) {
    const createdAt = isoOrNow(source.createdAt, now);
    const updatedAt = isoOrNow(source.updatedAt, now);
    statements.push(env.DB.prepare(`
      INSERT INTO results (id, season_id, activity_id, player_id, points, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(activity_id, player_id) DO UPDATE SET
        points = excluded.points,
        updated_at = excluded.updated_at
    `).bind(requiredId(source.id), requiredId(source.seasonId), requiredId(source.activityId), requiredId(source.playerId), Number(source.points) || 0, createdAt, updatedAt));
    counts.results += 1;
  }

  await runInChunks(env.DB, statements, 80);
  return { ok: true, counts };
}

function cleanActivity(body, seasonId, id, existingCreatedAt) {
  const now = new Date().toISOString();
  const name = cleanName(body.name);
  const startAt = requiredDate(body.startAt, 'Nederīgs aktivitātes sākuma laiks.');
  const openAt = body.registrationOpenAt ? requiredDate(body.registrationOpenAt, 'Nederīgs pieteikšanās sākums.') : new Date(new Date(startAt).getTime() - 30 * 86400000).toISOString();
  const closeAt = body.registrationCloseAt ? requiredDate(body.registrationCloseAt, 'Nederīgs pieteikšanās beigu laiks.') : startAt;
  if (new Date(openAt) > new Date(closeAt)) throw httpError(400, 'Pieteikšanās sākums nevar būt pēc beigām.');
  return {
    id,
    season_id: seasonId,
    name,
    start_at: startAt,
    registration_open_at: openAt,
    registration_close_at: closeAt,
    description: cleanOptional(body.description, 5000),
    created_at: existingCreatedAt || now,
    updated_at: now
  };
}

async function createSession(env, type, subjectId) {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now.toISOString()),
    env.DB.prepare(`
      INSERT INTO sessions (token_hash, session_type, subject_id, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(tokenHash, type, subjectId, expiresAt, now.toISOString())
  ]);
  return token;
}

async function requireSession(request, env, requiredType) {
  const token = bearerToken(request);
  if (!token) throw httpError(401, 'Nepieciešama pieslēgšanās.');
  const tokenHash = await sha256(token);
  const session = await env.DB.prepare(`
    SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?
  `).bind(tokenHash, new Date().toISOString()).first();
  if (!session || session.session_type !== requiredType) throw httpError(401, 'Sesija nav derīga.');
  return session;
}

function bearerToken(request) {
  const value = request.headers.get('Authorization') || '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

async function hashPin(pin) {
  const iterations = 120000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return `pbkdf2$${iterations}$${base64Url(salt)}$${base64Url(new Uint8Array(bits))}`;
}

async function verifyPin(pin, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const salt = fromBase64Url(parts[2]);
  const expected = fromBase64Url(parts[3]);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, expected.length * 8));
  return timingSafeEqual(bits, expected);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function randomToken() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function publicPlayer(row) {
  return {
    id: row.id,
    name: row.name,
    image: row.image || '',
    imagePublicId: row.image_public_id || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

function mapSeason(row) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    bestCount: Number(row.best_count) || 12,
    active: Number(row.active) === 1,
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

function mapMembership(row) {
  return {
    id: row.id,
    seasonId: row.season_id,
    playerId: row.player_id,
    role: row.role,
    status: row.status,
    joinedAt: row.joined_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapActivity(row) {
  return {
    id: row.id,
    seasonId: row.season_id,
    name: row.name,
    startAt: row.start_at,
    registrationOpenAt: row.registration_open_at || '',
    registrationCloseAt: row.registration_close_at || '',
    description: row.description || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRegistration(row) {
  return {
    id: row.id,
    seasonId: row.season_id,
    activityId: row.activity_id,
    playerId: row.player_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapResult(row) {
  return {
    id: row.id,
    seasonId: row.season_id,
    activityId: row.activity_id,
    playerId: row.player_id,
    points: Number(row.points) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function emptyBootstrap(player, memberships) {
  return {
    ok: true,
    player,
    players: [player],
    seasons: [],
    memberships,
    activities: [],
    registrations: [],
    results: [],
    serverTime: new Date().toISOString()
  };
}

function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

async function runInChunks(db, statements, size) {
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size));
  }
}

async function readJson(request) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > MAX_BODY_BYTES) throw httpError(413, 'Pieprasījums ir pārāk liels.');
  try {
    return await request.json();
  } catch (_) {
    throw httpError(400, 'Nederīgs JSON pieprasījums.');
  }
}

function cleanName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) throw httpError(400, 'Vārdam jābūt no 2 līdz 80 rakstzīmēm.');
  return name;
}

function cleanPin(value) {
  const pin = String(value ?? '').trim();
  if (!/^\d{5}$/.test(pin)) throw httpError(400, 'PIN kodam jābūt tieši 5 cipariem.');
  return pin;
}

function migrationPin(value) {
  let pin = String(value ?? '').trim();
  if (/^\d{1,5}$/.test(pin)) pin = pin.padStart(5, '0');
  return cleanPin(pin);
}

function cleanCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{4,20}$/.test(code)) {
    throw httpError(400, 'Sērijas kodam jābūt 4–20 rakstzīmēm: burtiem, cipariem, “-” vai “_”.');
  }
  return code;
}

function cleanBestCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 100) throw httpError(400, 'Labāko rezultātu skaitam jābūt no 1 līdz 100.');
  return count;
}

function cleanOptional(value, maxLength) {
  const text = String(value ?? '').trim();
  if (text.length > maxLength) throw httpError(400, 'Ievadītā vērtība ir pārāk gara.');
  return text;
}

function requiredId(value, message = 'Trūkst ID.') {
  const id = String(value || '').trim();
  if (!id || id.length > 100) throw httpError(400, message);
  return id;
}

function requiredDate(value, message) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw httpError(400, message);
  return date.toISOString();
}

function optionalDate(value) {
  return value ? requiredDate(value, 'Nederīgs datums.') : null;
}

function isoOrNow(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('lv-LV')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function toBoolInt(value, fallback = 0) {
  if (value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true') return 1;
  if (value === false || value === 0 || value === '0' || String(value).toLowerCase() === 'false') return 0;
  return fallback;
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function corsHeaders(request, env) {
  const configured = String(env.ALLOWED_ORIGIN || DEFAULT_ORIGIN)
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  const allowedOrigin = configured.includes(origin) ? origin : configured[0] || DEFAULT_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
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
    headers: {
      ...corsHeaders(request, env),
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}
