# MS Season

Mobilā sezonu sacensību sistēma ar diviem galvenajiem skatiem:

- `index.html` / `season.html` — spēlētāja profils un pieteikšanās
- `admin.html` — sezonu, aktivitāšu un rezultātu vadība
- `leaderboard.html` — mobilais kopvērtējums

## Google Sheets datubāze

Sistēma sagatavota darbam ar `MS Apps — Season Database`.

Spreadsheet ID:

`1-nheGOekslHRIf1KCeLDR5v-NN9oFtsCtfO082zQkHo`

## Apps Script pieslēgšana

1. Atver Google Sheet.
2. Extensions → Apps Script.
3. Iekopē `apps-script/Code.gs` saturu.
4. Palaid funkciju `setup()` un apstiprini piekļuvi.
5. Deploy → New deployment → Web app.
6. Execute as: Me.
7. Who has access: Anyone.
8. Nokopē Web App URL.
9. Failā `assets/api.js` aizvieto `API_URL: ''` ar savu Web App URL.

Kamēr `API_URL` ir tukšs, aplikācija darbojas demo režīmā un glabā datus konkrētās ierīces `localStorage`.

## Publicēšana

Repozitorijs pašlaik ir privāts. GitHub Pages izmantošanai ieslēdz Pages repozitorija iestatījumos, ja tavs GitHub plāns atbalsta Pages privātam repozitorijam, vai padari repozitoriju publisku.

Pēc Pages ieslēgšanas galvenā adrese būs aptuveni:

`https://vezitivus.github.io/MS/`

## Datu modelis

- `Seasons` — sezonas un Best X iestatījums
- `Players` — spēlētāji un profila attēli
- `Activities` — aktivitātes un reģistrācijas periodi
- `Registrations` — pieteikumi aktivitātēm
- `Results` — punkti katrā aktivitātē
- `Audit` — darbību žurnāls

Kopvērtējums tiek aprēķināts no katra spēlētāja labākajiem X rezultātiem.