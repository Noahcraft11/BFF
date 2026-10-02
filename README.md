# ViennaX BF Wien – Deployment auf Render (Firebase)

> Neues Firebase-Key erzeugen (nicht den alten verwenden). Optional `COLLECTION_PREFIX=bf_` setzen, damit die Daten getrennt vom ASFINAG-Portal liegen.

## Projektstruktur

```
viennax/
├── server.js               ← Backend (Node.js + Express + Firebase)
├── package.json            ← Dependencies
├── render.yaml             ← Render-Konfiguration
├── serviceAccountKey.json  ← DEINE Firebase-Datei (NICHT in Git!)
└── public/
    └── index.html          ← Frontend
```

---

## Schritt 1 – Firebase vorbereiten

1. Gehe zu https://console.firebase.google.com
2. Dein Projekt öffnen → **Firestore Database** → „Datenbank erstellen"
3. Modus: **Produktionsmodus** → Region wählen (z.B. `europe-west3`)
4. Firestore Regeln setzen (unter „Regeln"):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false; // Nur Backend hat Zugriff
    }
  }
}
```

---

## Schritt 2 – GitHub Repository

1. Gehe zu https://github.com → „New repository"
2. Name: `viennax-bf-wien` → **Private**
3. Lade alle Dateien hoch **AUSSER** `serviceAccountKey.json`
   (steht in .gitignore, wird über Render Umgebungsvariable gesetzt)

---

## Schritt 3 – Render deployen

1. https://render.com → „New Web Service"
2. GitHub Repository verbinden
3. Einstellungen:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`

---

## Schritt 4 – serviceAccountKey.json auf Render hochladen

Da die JSON-Datei NICHT in Git ist, gibt es zwei Möglichkeiten:

### Option A: Als Umgebungsvariable (empfohlen)

1. Öffne deine `serviceAccountKey.json` mit einem Texteditor
2. Kopiere den gesamten Inhalt
3. Render Dashboard → dein Service → **Environment**
4. Neue Variable anlegen:
   - Key: `FIREBASE_SERVICE_ACCOUNT`
   - Value: (den kopierten JSON-Inhalt einfügen)
5. In `server.js` ist bereits Code dafür vorbereitet (wird automatisch erkannt)

### Option B: Secret File auf Render

1. Render Dashboard → dein Service → **Secret Files**
2. Filename: `serviceAccountKey.json`
3. Contents: Inhalt der JSON-Datei einfügen
4. Render speichert die Datei automatisch im Projektordner

---

## Schritt 5 – JWT_SECRET setzen

Render Dashboard → Environment:
- Key: `JWT_SECRET`
- Value: Ein langer zufälliger Text (z.B. `ViennaX-Geheim-2024-abc123xyz`)

---

## Nach dem ersten Start

- Standard-Login: **username:** `admin` / **Passwort:** `admin123`
- Sofort im Admin-Panel weiteren Admin anlegen und `admin123` nicht mehr verwenden!

---

## Lokales Testen

```bash
npm install
node server.js
# → http://localhost:3000
# serviceAccountKey.json muss im selben Ordner liegen
```
