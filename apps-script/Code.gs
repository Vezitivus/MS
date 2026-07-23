const SHEET_ID = '1-nheGOekslHRIf1KCeLDR5v-NN9oFtsCtfO082zQkHo';

const TABLES = {
  seasons: 'Seasons',
  players: 'Players',
  activities: 'Activities',
  registrations: 'Registrations',
  results: 'Results',
  audit: 'Audit'
};

const HEADERS = {
  seasons: ['id','name','code','bestCount','active','createdAt','updatedAt'],
  players: ['id','seasonId','name','image','createdAt','updatedAt'],
  activities: ['id','seasonId','name','startAt','registrationOpenAt','registrationCloseAt','description','createdAt','updatedAt'],
  registrations: ['id','seasonId','activityId','playerId','status','createdAt','updatedAt'],
  results: ['id','seasonId','activityId','playerId','points','createdAt','updatedAt'],
  audit: ['id','action','payload','createdAt']
};

function doGet() {
  try {
    setup();
    return json_({ ok: true, data: bootstrap_(), service: 'MS Season API' });
  } catch (error) {
    return json_({ ok: false, error: errorMessage_(error) });
  }
}

function doPost(e) {
  try {
    setup();
    const body = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const request = JSON.parse(body);
    if (!request.action) throw new Error('Nav norādīta API darbība.');

    const payload = request.payload || {};
    const data = route_(String(request.action), payload);
    audit_(String(request.action), payload);
    return json_({ ok: true, data: data });
  } catch (error) {
    return json_({ ok: false, error: errorMessage_(error) });
  }
}

function route_(action, payload) {
  switch (action) {
    case 'bootstrap': return bootstrap_();
    case 'joinPlayer': return joinPlayer_(payload);
    case 'updatePlayer': return updatePlayer_(payload);
    case 'saveSeason': return saveSeason_(payload);
    case 'saveActivity': return saveActivity_(payload);
    case 'register': return register_(payload);
    case 'saveResult': return saveResult_(payload);
    case 'deleteActivity': return deleteActivity_(payload.id);
    default: throw new Error('Nezināma darbība: ' + action);
  }
}

function bootstrap_() {
  return {
    seasons: read_('seasons'),
    players: read_('players'),
    activities: read_('activities'),
    registrations: read_('registrations'),
    results: read_('results'),
    serverTime: new Date().toISOString()
  };
}

function joinPlayer_(payload) {
  requireFields_(payload, ['seasonId','name']);
  const name = String(payload.name).trim();
  if (name.length < 2) throw new Error('Vārdam jābūt vismaz 2 rakstzīmes garam.');

  const season = read_('seasons').find(row => String(row.id) === String(payload.seasonId));
  if (!season) throw new Error('Sezona nav atrasta.');

  const players = read_('players');
  let player = players.find(row =>
    String(row.seasonId) === String(payload.seasonId) &&
    normalize_(row.name) === normalize_(name)
  );

  if (!player) {
    player = upsert_('players', {
      id: Utilities.getUuid(),
      seasonId: payload.seasonId,
      name: name,
      image: ''
    });
  }
  return player;
}

function updatePlayer_(payload) {
  requireFields_(payload, ['id']);
  const existing = read_('players').find(row => String(row.id) === String(payload.id));
  if (!existing) throw new Error('Spēlētājs nav atrasts.');
  return upsert_('players', Object.assign({}, existing, payload));
}

function saveSeason_(payload) {
  requireFields_(payload, ['id','name','code']);
  const season = Object.assign({}, payload, {
    name: String(payload.name).trim(),
    code: String(payload.code).trim().toUpperCase(),
    bestCount: Math.max(1, Number(payload.bestCount) || 12),
    active: toBoolean_(payload.active)
  });

  if (season.active) {
    const seasons = read_('seasons');
    seasons.forEach(item => {
      if (String(item.id) !== String(season.id) && toBoolean_(item.active)) {
        upsert_('seasons', Object.assign({}, item, { active: false }));
      }
    });
  }
  return upsert_('seasons', season);
}

function saveActivity_(payload) {
  requireFields_(payload, ['id','seasonId','name','startAt']);
  const start = new Date(payload.startAt);
  if (isNaN(start.getTime())) throw new Error('Nederīgs aktivitātes datums.');

  const activity = Object.assign({}, payload, {
    name: String(payload.name).trim(),
    startAt: start.toISOString(),
    registrationOpenAt: payload.registrationOpenAt ? new Date(payload.registrationOpenAt).toISOString() : '',
    registrationCloseAt: payload.registrationCloseAt ? new Date(payload.registrationCloseAt).toISOString() : '',
    description: String(payload.description || '').trim()
  });
  return upsert_('activities', activity);
}

function register_(payload) {
  requireFields_(payload, ['seasonId','activityId','playerId']);
  const activity = read_('activities').find(row => String(row.id) === String(payload.activityId));
  if (!activity) throw new Error('Aktivitāte nav atrasta.');

  const player = read_('players').find(row => String(row.id) === String(payload.playerId));
  if (!player) throw new Error('Spēlētājs nav atrasts.');

  const registrations = read_('registrations');
  const existing = registrations.find(row =>
    String(row.activityId) === String(payload.activityId) &&
    String(row.playerId) === String(payload.playerId)
  );

  return upsert_('registrations', Object.assign({}, existing || {}, payload, {
    id: existing ? existing.id : Utilities.getUuid(),
    status: payload.status || 'registered'
  }));
}

function saveResult_(payload) {
  requireFields_(payload, ['seasonId','activityId','playerId','points']);
  const points = Number(payload.points);
  if (!isFinite(points) || points < 0) throw new Error('Punktiem jābūt pozitīvam skaitlim.');

  const results = read_('results');
  const existing = results.find(row =>
    String(row.activityId) === String(payload.activityId) &&
    String(row.playerId) === String(payload.playerId)
  );

  return upsert_('results', Object.assign({}, existing || {}, payload, {
    id: existing ? existing.id : Utilities.getUuid(),
    points: points
  }));
}

function deleteActivity_(id) {
  if (!id) throw new Error('Nav norādīta aktivitāte.');
  removeWhere_('activities', row => String(row.id) === String(id));
  removeWhere_('registrations', row => String(row.activityId) === String(id));
  removeWhere_('results', row => String(row.activityId) === String(id));
  return true;
}

function setup() {
  Object.keys(TABLES).forEach(key => sheet_(key));
  return 'Ready';
}

function spreadsheet_() {
  return SpreadsheetApp.openById(SHEET_ID);
}

function sheet_(key) {
  const spreadsheet = spreadsheet_();
  const name = TABLES[key];
  const headers = HEADERS[key];
  if (!name || !headers) throw new Error('Nezināma tabula: ' + key);

  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold')
      .setBackground('#111827')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  } else {
    const currentHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    if (currentHeaders.join('|') !== headers.join('|')) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }
  return sheet;
}

function read_(key) {
  const sheet = sheet_(key);
  const headers = HEADERS[key];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  return sheet.getRange(2, 1, lastRow - 1, headers.length)
    .getValues()
    .filter(row => row.some(value => value !== ''))
    .map(row => {
      const item = {};
      headers.forEach((header, index) => item[header] = serializeCell_(row[index]));
      return item;
    });
}

function upsert_(key, object) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = sheet_(key);
    const headers = HEADERS[key];
    const rows = read_(key);
    const now = new Date().toISOString();
    const index = rows.findIndex(row => String(row.id) === String(object.id));
    const current = index >= 0 ? rows[index] : {};
    const value = Object.assign({}, current, object, {
      createdAt: current.createdAt || object.createdAt || now,
      updatedAt: now
    });
    const row = headers.map(header => value[header] === undefined || value[header] === null ? '' : value[header]);

    if (index >= 0) sheet.getRange(index + 2, 1, 1, headers.length).setValues([row]);
    else sheet.appendRow(row);
    return value;
  } finally {
    lock.releaseLock();
  }
}

function removeWhere_(key, predicate) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = sheet_(key);
    const headers = HEADERS[key];
    const rows = read_(key);
    const keep = rows.filter(row => !predicate(row));

    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).clearContent();
    }
    if (keep.length) {
      sheet.getRange(2, 1, keep.length, headers.length)
        .setValues(keep.map(item => headers.map(header => item[header] === undefined ? '' : item[header])));
    }
  } finally {
    lock.releaseLock();
  }
}

function audit_(action, payload) {
  try {
    upsert_('audit', {
      id: Utilities.getUuid(),
      action: action,
      payload: JSON.stringify(payload),
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    console.error(error);
  }
}

function requireFields_(object, fields) {
  fields.forEach(field => {
    if (object[field] === undefined || object[field] === null || object[field] === '') {
      throw new Error('Trūkst lauka: ' + field);
    }
  });
}

function normalize_(value) {
  return String(value || '').trim().toLocaleLowerCase('lv-LV');
}

function toBoolean_(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function serializeCell_(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function errorMessage_(error) {
  return String(error && error.message ? error.message : error || 'Nezināma kļūda');
}

function json_(object) {
  return ContentService
    .createTextOutput(JSON.stringify(object))
    .setMimeType(ContentService.MimeType.JSON);
}