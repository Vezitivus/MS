const SHEET_ID = '1-nheGOekslHRIf1KCeLDR5v-NN9oFtsCtfO082zQkHo';

const SCHEMA = {
  Players: ['id','name','image','imagePublicId','authToken','accessCode','createdAt','updatedAt'],
  Seasons: ['id','name','code','bestCount','active','adminPinHash','adminToken','createdAt','updatedAt'],
  Memberships: ['id','seasonId','playerId','role','status','joinedAt','createdAt','updatedAt'],
  Activities: ['id','seasonId','name','startAt','registrationOpenAt','registrationCloseAt','description','createdAt','updatedAt'],
  Registrations: ['id','seasonId','activityId','playerId','status','createdAt','updatedAt'],
  Results: ['id','seasonId','activityId','playerId','points','createdAt','updatedAt']
};

function doGet(e) {
  const request = readRequest_(e);
  const result = execute_(request.action || 'load', request.payload);
  const response = result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error };

  if (request.callback) {
    if (!/^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(request.callback)) {
      return json_({ ok: false, error: 'Nederīgs callback.' });
    }
    return ContentService
      .createTextOutput(request.callback + '(' + JSON.stringify(response) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return json_(response);
}

function doPost(e) {
  const request = readRequest_(e);
  const result = execute_(request.action, request.payload);
  const response = result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error };

  if (request.requestId) {
    return frameResponse_(request.requestId, response);
  }

  return json_(response);
}

function readRequest_(e) {
  const parameters = e && e.parameter ? e.parameter : {};
  let body = {};

  if (e && e.postData && e.postData.contents && !parameters.action) {
    try {
      body = JSON.parse(e.postData.contents);
    } catch (_) {
      body = {};
    }
  }

  let payload = {};
  const rawPayload = parameters.payload !== undefined ? parameters.payload : body.payload;

  if (typeof rawPayload === 'string' && rawPayload) {
    try {
      payload = JSON.parse(rawPayload);
    } catch (error) {
      throw new Error('Nederīgs payload JSON.');
    }
  } else if (rawPayload && typeof rawPayload === 'object') {
    payload = rawPayload;
  }

  return {
    action: String(parameters.action || body.action || ''),
    payload: payload,
    callback: String(parameters.callback || body.callback || ''),
    requestId: String(parameters.requestId || body.requestId || '')
  };
}

function execute_(action, payload) {
  try {
    setup();

    if (action === 'load') {
      return { ok: true, data: loadAll_() };
    }

    if (action === 'save') {
      return { ok: true, data: saveRow_(payload.table, payload.row) };
    }

    if (action === 'remove') {
      return { ok: true, data: removeRow_(payload.table, payload.id) };
    }

    throw new Error('Nezināma darbība: ' + action);
  } catch (error) {
    return { ok: false, error: errorMessage_(error) };
  }
}

function setup() {
  Object.keys(SCHEMA).forEach(function(name) {
    sheet_(name);
  });
  return 'Ready';
}

function spreadsheet_() {
  return SpreadsheetApp.openById(SHEET_ID);
}

function sheet_(name) {
  if (!SCHEMA[name]) {
    throw new Error('Nezināma tabula: ' + name);
  }

  const spreadsheet = spreadsheet_();
  let sheet = spreadsheet.getSheetByName(name);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }

  const headers = SCHEMA[name];
  const currentHeaders = sheet.getLastRow() > 0
    ? sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0]
    : [];

  if (sheet.getLastRow() === 0 || currentHeaders.join('|') !== headers.join('|')) {
    sheet
      .getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold')
      .setBackground('#111827')
      .setFontColor('#ffffff');
  }

  sheet.setFrozenRows(1);
  return sheet;
}

function rows_(name) {
  const sheet = sheet_(name);
  const headers = SCHEMA[name];
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return [];
  }

  return sheet
    .getRange(2, 1, lastRow - 1, headers.length)
    .getValues()
    .filter(function(row) {
      return row.some(function(value) {
        return value !== '' && value !== null;
      });
    })
    .map(function(row) {
      const item = {};
      headers.forEach(function(header, index) {
        const value = row[index];
        item[header] = value instanceof Date ? value.toISOString() : value;
      });
      return item;
    });
}

function loadAll_() {
  return {
    players: rows_('Players'),
    seasons: rows_('Seasons'),
    memberships: rows_('Memberships'),
    activities: rows_('Activities'),
    registrations: rows_('Registrations'),
    results: rows_('Results'),
    serverTime: new Date().toISOString()
  };
}

function saveRow_(name, row) {
  if (!name || !SCHEMA[name]) {
    throw new Error('Nederīga tabula.');
  }

  if (!row || !row.id) {
    throw new Error('Trūkst rindas ID.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const sheet = sheet_(name);
    const headers = SCHEMA[name];
    const rows = rows_(name);
    const index = rows.findIndex(function(item) {
      return String(item.id) === String(row.id);
    });
    const existing = index >= 0 ? rows[index] : {};
    const now = new Date().toISOString();
    const value = Object.assign({}, existing, row, {
      createdAt: existing.createdAt || row.createdAt || now,
      updatedAt: now
    });
    const values = headers.map(function(header) {
      return value[header] === undefined || value[header] === null ? '' : value[header];
    });

    if (index >= 0) {
      sheet.getRange(index + 2, 1, 1, headers.length).setValues([values]);
    } else {
      sheet.appendRow(values);
    }

    SpreadsheetApp.flush();
    return value;
  } finally {
    lock.releaseLock();
  }
}

function removeRow_(name, id) {
  if (!name || !SCHEMA[name]) {
    throw new Error('Nederīga tabula.');
  }

  if (!id) {
    throw new Error('Trūkst rindas ID.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const sheet = sheet_(name);
    const rows = rows_(name);
    const index = rows.findIndex(function(item) {
      return String(item.id) === String(id);
    });

    if (index >= 0) {
      sheet.deleteRow(index + 2);
      SpreadsheetApp.flush();
    }

    return true;
  } finally {
    lock.releaseLock();
  }
}

function frameResponse_(requestId, response) {
  const message = {
    source: 'MS_APPS_GS',
    requestId: requestId,
    ok: response.ok === true,
    data: response.data,
    error: response.error || ''
  };

  const safeJson = JSON.stringify(message).replace(/</g, '\\u003c');
  return HtmlService
    .createHtmlOutput('<!doctype html><meta charset="utf-8"><script>parent.postMessage(' + safeJson + ',"*");<\/script>')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function json_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorMessage_(error) {
  return String(error && error.message ? error.message : error || 'Nezināma kļūda');
}