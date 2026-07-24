const WORKER_URL = String(process.env.WORKER_URL || '').replace(/\/$/, '');
const MIGRATION_SECRET = String(process.env.MIGRATION_SECRET || '');
const SHEET_ID = String(process.env.SHEET_ID || '1-nheGOekslHRIf1KCeLDR5v-NN9oFtsCtfO082zQkHo');

if (!WORKER_URL) {
  throw new Error('Trūkst WORKER_URL. Piemērs: WORKER_URL=https://vezitivus-ms-api.<subdomain>.workers.dev');
}
if (!MIGRATION_SECRET) {
  throw new Error('Trūkst MIGRATION_SECRET. Izmanto to pašu vērtību, ko saglabāji ar wrangler secret put.');
}

const sheets = {
  players: 'Players',
  seasons: 'Seasons',
  memberships: 'Memberships',
  activities: 'Activities',
  registrations: 'Registrations',
  results: 'Results'
};

const payload = {};
for (const [key, sheetName] of Object.entries(sheets)) {
  process.stdout.write(`Nolasām ${sheetName}... `);
  payload[key] = await loadSheet(sheetName);
  console.log(`${payload[key].length} rindas`);
}

console.log('Sūtām datus uz Cloudflare D1...');
const response = await fetch(`${WORKER_URL}/api/migrate/google`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Migration-Secret': MIGRATION_SECRET
  },
  body: JSON.stringify(payload)
});

const result = await response.json().catch(() => ({}));
if (!response.ok || result.ok !== true) {
  throw new Error(result.error || `Migrācija neizdevās. HTTP ${response.status}`);
}

console.log('Migrācija pabeigta:', result.counts);
console.log(`Pārbaude: ${WORKER_URL}/health`);

async function loadSheet(sheetName) {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`);
  url.searchParams.set('sheet', sheetName);
  url.searchParams.set('tqx', 'out:csv');
  url.searchParams.set('_', String(Date.now()));

  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Neizdevās nolasīt ${sheetName}. HTTP ${response.status}`);
  }

  const csv = await response.text();
  const matrix = parseCsv(csv);
  if (!matrix.length) return [];
  const headers = matrix[0].map(value => String(value).trim());

  return matrix
    .slice(1)
    .filter(row => row.some(value => String(value).trim() !== ''))
    .map(row => Object.fromEntries(headers.map((header, index) => [header, normalizeValue(header, row[index] ?? '')])));
}

function normalizeValue(header, value) {
  const text = String(value ?? '').trim();
  if (header === 'accessCode' || header === 'adminPinHash') {
    return /^\d{1,5}$/.test(text) ? text.padStart(5, '0') : text;
  }
  if (header === 'bestCount' || header === 'points') {
    const number = Number(text.replace(',', '.'));
    return Number.isFinite(number) ? number : 0;
  }
  if (header === 'active') {
    return ['true', '1', 'yes', 'jā'].includes(text.toLowerCase());
  }
  return text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  if (value !== '' || row.length) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }

  return rows;
}
