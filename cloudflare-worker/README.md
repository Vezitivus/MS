# Vezitivus MS — Cloudflare Worker + D1

Šis backend aizstāj Google Sheets un Apps Script. Esošā GitHub Pages lapa paliek atsevišķi un tiks pārslēgta uz šo API tikai pēc veiksmīgas D1 pārbaudes.

## 1. Nepieciešams

- Cloudflare konts
- Node.js 18 vai jaunāks
- Git

## 2. Lejupielādē projektu

```bash
git clone https://github.com/Vezitivus/MS.git
cd MS/cloudflare-worker
npm install
```

## 3. Pieslēdz Cloudflare

```bash
npx wrangler login
```

## 4. Izveido D1 datubāzi

```bash
npm run db:create
```

Komanda izvadīs `database_id`. Atver `wrangler.jsonc` un aizvieto:

```text
REPLACE_WITH_D1_DATABASE_ID
```

ar Cloudflare izsniegto D1 ID.

## 5. Izveido tabulas

```bash
npm run db:migrate:remote
```

Pārbaude:

```bash
npm run db:check
```

Jāparādās tabulām:

- activities
- memberships
- players
- registrations
- results
- seasons
- sessions

## 6. Saglabā migrācijas paroli

Izdomā garu nejaušu paroli, piemēram, vismaz 32 rakstzīmes.

```bash
npx wrangler secret put MIGRATION_SECRET
```

Wrangler prasīs ievadīt vērtību. Tā netiek saglabāta GitHub.

## 7. Publicē Worker

```bash
npm run deploy
```

Komanda izvadīs adresi, piemēram:

```text
https://vezitivus-ms-api.TAVS-SUBDOMAIN.workers.dev
```

Pārbaudi:

```text
https://vezitivus-ms-api.TAVS-SUBDOMAIN.workers.dev/health
```

Pareiza atbilde:

```json
{
  "ok": true,
  "service": "vezitivus-ms-api",
  "database": true
}
```

## 8. Pārnes pašreizējos Google Sheets datus

### macOS / Linux

```bash
WORKER_URL="https://vezitivus-ms-api.TAVS-SUBDOMAIN.workers.dev" \
MIGRATION_SECRET="TAVA_MIGRACIJAS_PAROLE" \
npm run migrate:google
```

### Windows PowerShell

```powershell
$env:WORKER_URL="https://vezitivus-ms-api.TAVS-SUBDOMAIN.workers.dev"
$env:MIGRATION_SECRET="TAVA_MIGRACIJAS_PAROLE"
npm run migrate:google
```

Migrācijas skripts nolasa šīs Google Sheet lapas:

- Players
- Seasons
- Memberships
- Activities
- Registrations
- Results

PIN kodi D1 datubāzē tiek saglabāti tikai kā PBKDF2 hash, nevis redzamā tekstā.

## 9. Pārbaudi datus

```bash
npx wrangler d1 execute vezitivus-ms-db --remote --command="SELECT COUNT(*) AS players FROM players;"
npx wrangler d1 execute vezitivus-ms-db --remote --command="SELECT COUNT(*) AS seasons FROM seasons;"
npx wrangler d1 execute vezitivus-ms-db --remote --command="SELECT COUNT(*) AS memberships FROM memberships;"
npx wrangler d1 execute vezitivus-ms-db --remote --command="SELECT COUNT(*) AS registrations FROM registrations;"
```

## 10. Frontend pārslēgšana

GitHub jau pievienots jaunais klients:

```text
assets/api.cloudflare.js
```

Esošā lapa vēl nav pārslēgta, lai darbīgā versija netiktu sabojāta pirms Worker publicēšanas.

Kad Worker darbojas, jāieliek tā adrese `assets/api.cloudflare.js` failā vai pārlūkā jāizpilda:

```javascript
MSCloudflare.setApiUrl('https://vezitivus-ms-api.TAVS-SUBDOMAIN.workers.dev');
```

Pēc tam jāpārtaisa `index.html`, `season.html`, `admin.html` un `leaderboard.html`, lai tie izmantotu `MSCloudflare` API. Šo pārslēgšanu veic tikai pēc tam, kad `/health` un datu migrācija ir veiksmīga.

## Drošība pēc pārejas

Kad D1 versija ir pārbaudīta:

1. Google Sheet noņem publisko `writer` piekļuvi.
2. Apps Script deployment atspējo vai izdzēš.
3. Maina visus testā izmantotos PIN kodus.
4. Migrācijas endpointu var bloķēt, izdzēšot secret:

```bash
npx wrangler secret delete MIGRATION_SECRET
```
