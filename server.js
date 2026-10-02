// ═══════════════════════════════════════════════════════
//  ViennaX Remastered – Backend (server.js)
//  Firebase Firestore als Datenbank
//  Passwörter mit bcrypt gehasht, JWT für Sessions
// ═══════════════════════════════════════════════════════

const express  = require('express');
const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const admin    = require('firebase-admin');
const path     = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Firebase initialisieren ───
// Entweder über Umgebungsvariable FIREBASE_SERVICE_ACCOUNT
// oder über die Datei serviceAccountKey.json im Projektordner
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // Render: Inhalt der JSON als Umgebungsvariable gesetzt
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  // Lokal: Datei liegt im Projektordner (NICHT in Git!)
  serviceAccount = require('./serviceAccountKey.json');
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const JWT_SECRET = process.env.JWT_SECRET || 'bitte-aendern-in-render-env';

// ─── Firestore Collections ───
const PFX = process.env.COLLECTION_PREFIX || '';
const USERS      = PFX + 'users';
const BERICHTE   = PFX + 'berichte';
const DUTY_HIST  = PFX + 'duty_history';
const UNFALL     = PFX + 'unfall';
const KONTAKTE   = PFX + 'kontakte';
const ACTIVITY   = PFX + 'activity';
const RAENGE        = PFX + 'raenge';
const ROLLEN        = PFX + 'rollen';
const PERSONALAKTEN = PFX + 'personalakten';
const PERMISSIONS   = PFX + 'permissions';
const AUFTRAEGE     = PFX + 'auftraege';
const BAUSTELLEN    = PFX + 'baustellen';
const WARTUNG       = PFX + 'wartung';
const HANDBUECHER     = PFX + 'handbuecher';
const FAHRZEUGE       = PFX + 'fahrzeuge';
const ANKUENDIGUNGEN  = PFX + 'ankuendigungen';
const SETTINGS        = PFX + 'settings';
const FUHRPARK        = PFX + 'fuhrpark_log';
const ABMELDUNGEN     = PFX + 'abmeldungen';

// ─── Standard-Admin beim ersten Start anlegen ───
async function initDB() {
  const snap = await db.collection(USERS).limit(1).get();
  if (snap.empty) {
    const hash = await bcrypt.hash('admin123', 10);
    await db.collection(USERS).add({
      username:      'admin',
      dienstnummer:  '0001',
      vorname:       'Max',
      nachname:      'Admin',
      password_hash: hash,
      role:          'admin',
      on_duty:       false,
      duty_start:    null,
      created_at:    admin.firestore.FieldValue.serverTimestamp()
    });
    await db.collection(KONTAKTE).add({
      vorname:      'Max',
      nachname:     'Admin',
      dienstnummer: '#0001',
      telefon:      '0001',
      abteilung:    'Berufsfeuerwehr Wien',
      rang:         'Administrator',
      created_at:   admin.firestore.FieldValue.serverTimestamp()
    });
    console.log('✅ Standard-Admin angelegt: username=admin, passwort=admin123');
    console.log('⚠️  Bitte sofort nach dem ersten Login das Passwort ändern!');
  }
  // Seed default Rollen if none exist
  const rollenSnap = await db.collection(ROLLEN).limit(1).get();
  if (rollenSnap.empty) {
    const defaultRollen = [
      {value:'beamter',label:'Beamter'},
      {value:'supervisor',label:'Supervisor'},
      {value:'leitender',label:'Leitender Beamter'},
      {value:'ausbilder',label:'Ausbilder'},
      {value:'einsatzleiter',label:'Einsatzleiter'},
      {value:'admin',label:'Administrator'}
    ];
    for (const r of defaultRollen) {
      await db.collection(ROLLEN).add({...r, created_at: admin.firestore.FieldValue.serverTimestamp()});
    }
    console.log('✅ Standard-Rollen angelegt');
  }
  // Seed default Ränge if none exist
  const rangSnap = await db.collection(RAENGE).limit(1).get();
  if (rangSnap.empty) {
    const defaultRaenge = [
      {name:'Probefeuerwehrmann',level:1},{name:'Feuerwehrmann',level:2},{name:'Oberfeuerwehrmann',level:3},
      {name:'Hauptfeuerwehrmann',level:4},{name:'Löschmeister',level:5},{name:'Oberlöschmeister',level:6},
      {name:'Brandmeister',level:7},{name:'Oberbrandmeister',level:8},{name:'Branddirektor',level:9}
    ];
    for (const r of defaultRaenge) {
      await db.collection(RAENGE).add({...r, created_at: admin.firestore.FieldValue.serverTimestamp()});
    }
    console.log('✅ Standard-Ränge angelegt');
  }
  console.log('✅ Firebase Firestore verbunden.');

  // Seed default Berechtigungen für Personalakten
  const permSnap = await db.collection(PERMISSIONS).doc('personalakte').get();
  if (!permSnap.exists) {
    await db.collection(PERMISSIONS).doc('personalakte').set({
      read_roles:  ['supervisor', 'leitender', 'ausbilder', 'einsatzleiter', 'admin'],
      write_roles: ['leitender', 'ausbilder', 'einsatzleiter', 'admin'],
      updated_at:  admin.firestore.FieldValue.serverTimestamp()
    });
    console.log('✅ Standard-Berechtigungen für Personalakten angelegt');
  }

  // Seed default Berechtigungen für Ankündigungen
  const ankPermSnap = await db.collection(PERMISSIONS).doc('ankuendigungen').get();
  if (!ankPermSnap.exists) {
    await db.collection(PERMISSIONS).doc('ankuendigungen').set({
      write_roles: ['leitender', 'einsatzleiter', 'admin'],
      updated_at:  admin.firestore.FieldValue.serverTimestamp()
    });
    console.log('✅ Standard-Berechtigungen für Ankündigungen angelegt');
  }

  // Seed default Berechtigungen für Fuhrpark-Tabelle (standardmäßig nur Admins)
  const fuhrparkPermSnap = await db.collection(PERMISSIONS).doc('fuhrpark').get();
  if (!fuhrparkPermSnap.exists) {
    await db.collection(PERMISSIONS).doc('fuhrpark').set({
      read_roles:  [],
      write_roles: [],
      updated_at:  admin.firestore.FieldValue.serverTimestamp()
    });
    console.log('✅ Standard-Berechtigungen für Fuhrpark-Tabelle angelegt (nur Admins)');
  }
}

// ─── Hilfsfunktion: Dokument mit ID als Objekt ───
// Konvertiert Firestore Timestamps rekursiv in ISO-Strings
function convertTimestamps(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj.toDate === 'function') return obj.toDate().toISOString();
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(convertTimestamps);
  if (typeof obj === 'object') {
    const result = {};
    for (const key of Object.keys(obj)) {
      result[key] = convertTimestamps(obj[key]);
    }
    return result;
  }
  return obj;
}
function docData(doc) {
  return convertTimestamps({ id: doc.id, ...doc.data() });
}

// ─── Auth-Middleware ───
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Nicht autorisiert' });
  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token ungültig oder abgelaufen' });
  }
}

// Hilfsfunktion: Prüft ob ein User Admin-Rechte hat (auch custom Admin-Rollen)
async function hasAdminAccess(userRoles) {
  if (userRoles.includes('admin')) return true;
  try {
    const doc = await db.collection(PERMISSIONS).doc('admin_roles').get();
    if (!doc.exists) return false;
    const adminRoles = doc.data().admin_roles || [];
    return userRoles.some(r => adminRoles.includes(r));
  } catch {
    return false;
  }
}

async function adminOnly(req, res, next) {
  const roles = req.user.roles || (req.user.role ? [req.user.role] : []);
  if (await hasAdminAccess(roles)) return next();
  return res.status(403).json({ error: 'Nur für Admins' });
}

// ════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════

// Alle User für Login-Dropdown (kein Passwort!)
app.get('/api/users/list', async (req, res) => {
  try {
    const snap = await db.collection(USERS).orderBy('created_at').get();
    const users = snap.docs.map(d => {
      const u = docData(d);
      return {
        id: u.id, username: u.username, dienstnummer: u.dienstnummer,
        vorname: u.vorname, nachname: u.nachname,
        role: u.role, roles: u.roles || (u.role ? [u.role] : ['beamter']),
        rang: u.rang || '', on_duty: u.on_duty, duty_start: u.duty_start || null,
        duty_fahrzeug: u.duty_fahrzeug || null
      };
    });
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { userId, password } = req.body;
  if (!userId || !password) return res.status(400).json({ error: 'Fehlende Felder' });
  try {
    const doc = await db.collection(USERS).doc(userId).get();
    if (!doc.exists) return res.status(401).json({ error: 'Ungültige Zugangsdaten' });
    const user = docData(doc);
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Ungültige Zugangsdaten' });

    const userRoles = user.roles && user.roles.length ? user.roles : (user.role ? [user.role] : ['beamter']);

    // Wartungsmodus prüfen – Nicht-Admins blockieren
    const isAdmin = await hasAdminAccess(userRoles);
    if (!isAdmin) {
      const wartungsDoc = await db.collection(SETTINGS).doc('wartungsmodus').get().catch(() => null);
      if (wartungsDoc && wartungsDoc.exists && wartungsDoc.data().aktiv) {
        const msg = wartungsDoc.data().nachricht || 'Das System befindet sich im Wartungsmodus.';
        return res.status(503).json({ error: `Wartungsmodus aktiv: ${msg}` });
      }
    }
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, roles: userRoles },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({
      token,
      user: {
        id: user.id, username: user.username, dienstnummer: user.dienstnummer,
        vorname: user.vorname, nachname: user.nachname,
        role: user.role, roles: user.roles || (user.role ? [user.role] : ['beamter']),
        rang: user.rang || '',
        onDuty: user.on_duty, dutyStart: user.duty_start
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════
//  USERS (Admin)
// ════════════════════════════════════════

app.get('/api/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const snap = await db.collection(USERS).orderBy('created_at').get();
    const users = snap.docs.map(d => {
      const u = docData(d);
      return {
        id: u.id, username: u.username, dienstnummer: u.dienstnummer,
        vorname: u.vorname, nachname: u.nachname,
        role: u.role, roles: u.roles || (u.role ? [u.role] : ['beamter']),
        rang: u.rang || '',
        on_duty: u.on_duty, duty_start: u.duty_start
      };
    });
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/users', authMiddleware, adminOnly, async (req, res) => {
  const { username, dienstnummer, vorname, nachname, password, role, roles, rang } = req.body;
  if (!username || !dienstnummer || !vorname || !nachname || !password)
    return res.status(400).json({ error: 'Alle Felder ausfüllen' });
  try {
    // Prüfen ob Username/Dienstnummer schon vergeben
    const existing = await db.collection(USERS)
      .where('username', '==', username).limit(1).get();
    if (!existing.empty) return res.status(409).json({ error: 'Benutzername bereits vergeben' });
    const existingDN = await db.collection(USERS)
      .where('dienstnummer', '==', dienstnummer).limit(1).get();
    if (!existingDN.empty) return res.status(409).json({ error: 'Dienstnummer bereits vergeben' });

    const finalRoles = roles && roles.length ? roles : (role ? [role] : ['beamter']);
    const hash = await bcrypt.hash(password, 10);
    const ref = await db.collection(USERS).add({
      username, dienstnummer, vorname, nachname,
      password_hash: hash,
      roles: finalRoles,
      role: finalRoles[0], // legacy fallback
      rang: rang || '',
      on_duty: false,
      duty_start: null,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    trimActivity();
    // Kontakt automatisch anlegen
    await db.collection(KONTAKTE).add({
      vorname, nachname,
      dienstnummer: '#' + dienstnummer,
      telefon: dienstnummer,
      abteilung: 'Berufsfeuerwehr Wien',
      rang: rang || finalRoles[0],
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    trimActivity();
    res.json({ id: ref.id, username, dienstnummer, vorname, nachname, roles: finalRoles, rang });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/users/:id/role', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { role, roles } = req.body;
    const finalRoles = roles && roles.length ? roles : (role ? [role] : []);
    await db.collection(USERS).doc(req.params.id).update({
      roles: finalRoles,
      role: finalRoles[0] || 'beamter' // legacy fallback
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Vollständige Bearbeitung eines Benutzers
app.put('/api/users/:id', authMiddleware, adminOnly, async (req, res) => {
  const { username, dienstnummer, vorname, nachname, password, roles, role, rang } = req.body;
  if (!username || !dienstnummer || !vorname || !nachname)
    return res.status(400).json({ error: 'Pflichtfelder fehlen' });
  try {
    // Prüfen ob Username/Dienstnummer von ANDEREM User belegt
    const existingUser = await db.collection(USERS)
      .where('username', '==', username).limit(1).get();
    if (!existingUser.empty && existingUser.docs[0].id !== req.params.id)
      return res.status(409).json({ error: 'Benutzername bereits vergeben' });
    const existingDN = await db.collection(USERS)
      .where('dienstnummer', '==', dienstnummer).limit(1).get();
    if (!existingDN.empty && existingDN.docs[0].id !== req.params.id)
      return res.status(409).json({ error: 'Dienstnummer bereits vergeben' });

    const finalRoles = roles && roles.length ? roles : (role ? [role] : ['beamter']);
    const update = {
      username, dienstnummer, vorname, nachname,
      roles: finalRoles,
      role: finalRoles[0],
      rang: rang || ''
    };
    if (password && password.length >= 4) {
      update.password_hash = await require('bcrypt').hash(password, 10);
    }
    await db.collection(USERS).doc(req.params.id).update(update);
    res.json({ ok: true, id: req.params.id, ...update });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/users/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await db.collection(USERS).doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════
//  ROLLEN
// ════════════════════════════════════════

app.get('/api/rollen', authMiddleware, async (req, res) => {
  try {
    const snap = await db.collection(ROLLEN).orderBy('created_at').get();
    res.json(snap.docs.map(docData));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/rollen', authMiddleware, adminOnly, async (req, res) => {
  const { label, value } = req.body;
  if (!label || !value) return res.status(400).json({ error: 'Label und Value erforderlich' });
  try {
    // check uniqueness
    const existing = await db.collection(ROLLEN).where('value','==',value).limit(1).get();
    if (!existing.empty) return res.status(409).json({ error: 'Kürzel bereits vergeben' });
    const ref = await db.collection(ROLLEN).add({
      label, value,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    trimActivity();
    const doc = await ref.get();
    res.json(docData(doc));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/rollen/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await db.collection(ROLLEN).doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════
//  RÄNGE
// ════════════════════════════════════════

app.get('/api/raenge', authMiddleware, async (req, res) => {
  try {
    const snap = await db.collection(RAENGE).orderBy('level').get();
    res.json(snap.docs.map(docData));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/raenge', authMiddleware, adminOnly, async (req, res) => {
  const { name, level } = req.body;
  if (!name || !level) return res.status(400).json({ error: 'Name und Stufe erforderlich' });
  try {
    const ref = await db.collection(RAENGE).add({
      name, level: Number(level),
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    trimActivity();
    const doc = await ref.get();
    res.json(docData(doc));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/raenge/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await db.collection(RAENGE).doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════
//  DUTY
// ════════════════════════════════════════

app.post('/api/duty/start', authMiddleware, async (req, res) => {
  try {
    const now = new Date().toISOString();
    const { name, fahrzeugId } = req.body;
    const updateData = { on_duty: true, duty_start: now, duty_fahrzeug: fahrzeugId || null };
    await db.collection(USERS).doc(req.user.id).update(updateData);

    // Fahrzeug als belegt markieren (User zur Besatzung hinzufügen)
    if (fahrzeugId) {
      const fRef = db.collection(FAHRZEUGE).doc(fahrzeugId);
      const fSnap = await fRef.get().catch(() => null);
      if (fSnap && fSnap.exists) {
        const fData = fSnap.data();
        const besatzung = Array.isArray(fData.besatzung) ? [...fData.besatzung] : (fData.besetzt_von ? [fData.besetzt_von] : []);
        const maxBesatzung = fData.max_besatzung || 1;
        if (!besatzung.includes(req.user.id)) besatzung.push(req.user.id);
        const newStatus = besatzung.length >= maxBesatzung ? 'im_einsatz' : 'verfügbar';
        await fRef.update({
          besatzung,
          besetzt_von: besatzung[0] || null,
          status: newStatus,
          updated_at: admin.firestore.FieldValue.serverTimestamp()
        }).catch(() => {});
      }
    }

    let fahrzeugText = '';
    if (fahrzeugId) {
      const fDoc = await db.collection(FAHRZEUGE).doc(fahrzeugId).get().catch(() => null);
      if (fDoc && fDoc.exists) fahrzeugText = ` · FZG: ${fDoc.data().kennzeichen}`;
    }
    await db.collection(ACTIVITY).add({
      text: `${name} hat den Dienst angetreten${fahrzeugText}.`,
      color: 'green',
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    trimActivity();
    res.json({ ok: true, dutyStart: now });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/duty/end', authMiddleware, async (req, res) => {
  const { name, dienstnummer } = req.body;
  try {
    const now = new Date().toISOString();
    const userDoc = await db.collection(USERS).doc(req.user.id).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const actualDutyStart = userData.duty_start || null;
    const fahrzeugId = userData.duty_fahrzeug || null;
    let duration = '–';
    if (actualDutyStart) {
      const ms = new Date(now) - new Date(actualDutyStart);
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      duration = `${h}h ${m}m`;
    }
    await db.collection(USERS).doc(req.user.id).update({ on_duty: false, duty_start: null, duty_fahrzeug: null });

    // Fahrzeug Besatzung aktualisieren (User entfernen)
    if (fahrzeugId) {
      const fRef = db.collection(FAHRZEUGE).doc(fahrzeugId);
      const fSnap = await fRef.get().catch(() => null);
      if (fSnap && fSnap.exists) {
        const fData = fSnap.data();
        let besatzung = Array.isArray(fData.besatzung) ? fData.besatzung.filter(id => id !== req.user.id) : [];
        const maxBesatzung = fData.max_besatzung || 1;
        const newStatus = besatzung.length === 0 ? 'verfügbar' : (besatzung.length >= maxBesatzung ? 'im_einsatz' : 'verfügbar');
        await fRef.update({
          besatzung,
          besetzt_von: besatzung[0] || null,
          status: newStatus,
          updated_at: admin.firestore.FieldValue.serverTimestamp()
        }).catch(() => {});
      }
    }

    // Fahrzeugkennzeichen für den Eintrag holen
    let fahrzeugKennzeichen = null;
    if (fahrzeugId) {
      const fDoc = await db.collection(FAHRZEUGE).doc(fahrzeugId).get().catch(() => null);
      if (fDoc && fDoc.exists) fahrzeugKennzeichen = fDoc.data().kennzeichen || null;
    }

    // Vorname/Nachname aus dem name-String trennen
    const nameParts = (name || '').trim().split(' ');
    const vorname = nameParts[0] || '';
    const nachname = nameParts.slice(1).join(' ') || '';

    const durationMs = actualDutyStart ? (new Date(now) - new Date(actualDutyStart)) : 0;

    await db.collection(DUTY_HIST).add({
      user_id:              req.user.id,
      dienstnummer:         dienstnummer || null,
      name:                 name || '',
      vorname,
      nachname,
      start_time:           actualDutyStart ? admin.firestore.Timestamp.fromDate(new Date(actualDutyStart)) : null,
      end_time:             admin.firestore.Timestamp.fromDate(new Date(now)),
      duration,
      duration_ms:          durationMs,
      fahrzeug_id:          fahrzeugId || null,
      fahrzeug_kennzeichen: fahrzeugKennzeichen,
      created_at:           admin.firestore.FieldValue.serverTimestamp()
    });
    trimActivity();
    await db.collection(ACTIVITY).add({
      text: `${name} hat den Dienst beendet. (${duration})`,
      color: 'red',
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    trimActivity();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════
//  BERICHTE
// ════════════════════════════════════════

app.get('/api/berichte', authMiddleware, async (req, res) => {
  try {
    const snap = await db.collection(BERICHTE).orderBy('created_at', 'desc').get();
    res.json(snap.docs.map(docData));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/berichte', authMiddleware, async (req, res) => {
  const {
    typ, prio, status, verfasser, dienstnummer,
    datum, beginn, ende,
    ort, einsatzleitung, weitereKraefte,
    einsatzgrund, massnahmen, schaeden,
    auswirkungen, geraumt, abschluss, verfasst_von,
    // Rückwärtskompatibilität
    beschreibung, ergebnis, beteiligte
  } = req.body;

  const einsatzgrundFinal = einsatzgrund || beschreibung;
  if (!einsatzgrundFinal) return res.status(400).json({ error: 'Einsatzgrund fehlt' });

  // auswirkungen kann Array [{name, val}] oder String sein – immer als JSON-String speichern
  let auswirkungenStr = '';
  if (Array.isArray(auswirkungen)) {
    auswirkungenStr = JSON.stringify(auswirkungen);
  } else if (typeof auswirkungen === 'string' && auswirkungen) {
    auswirkungenStr = auswirkungen; // bereits JSON-String oder alter Wert
  }

  try {
    const countSnap = await db.collection(BERICHTE).count().get();
    const nr = countSnap.data().count + 1;
    const ref = await db.collection(BERICHTE).add({
      nr,
      typ:           typ || 'BF Einsatzbericht',
      prio:          prio || 'mittel',
      status:        status || 'abgeschlossen',
      verfasser,
      dienstnummer,
      verfasst_von:  verfasst_von || verfasser,
      datum:         datum || '',
      beginn:        beginn || '',
      ende:          ende || '',
      ort:           ort || '',
      einsatzleitung: einsatzleitung || '',
      weitereKraefte: weitereKraefte || '',
      einsatzgrund:  einsatzgrundFinal,
      massnahmen:    massnahmen || ergebnis || '',
      schaeden:      schaeden || '',
      auswirkungen:  auswirkungenStr,
      geraumt:       geraumt || '',
      abschluss:     abschluss || '',
      // Kompatibilitätsfelder
      beschreibung:  einsatzgrundFinal,
      beteiligte:    beteiligte || weitereKraefte || '',
      ergebnis:      massnahmen || ergebnis || '',
      user_id:       req.user.id,
      created_at:    admin.firestore.FieldValue.serverTimestamp()
    });
    await db.collection(ACTIVITY).add({
      text:  `Neuer Einsatzbericht von ${verfasst_von || verfasser}${ort ? ' · ' + ort : ''}`,
      color: 'blue',
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    trimActivity();
    const newDoc = await ref.get();
    res.json(docData(newDoc));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/berichte/:id/status', authMiddleware, async (req, res) => {
  try {
    await db.collection(BERICHTE).doc(req.params.id).update({ status: req.body.status });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════
//  DIENSTBUCH
// ════════════════════════════════════════

app.get('/api/duty-history', authMiddleware, async (req, res) => {
  try {
    const snap = await db.collection(DUTY_HIST).orderBy('created_at', 'desc').limit(100).get();
    res.json(snap.docs.map(docData));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Alle Diensteinträge eines bestimmten Users (Admin only)
app.get('/api/duty-history/user/:userId', authMiddleware, async (req, res) => {
  const roles = req.user.roles || (req.user.role ? [req.user.role] : []);
  if (!(await hasAdminAccess(roles)))
    return res.status(403).json({ error: 'Nur für Admins' });
  try {
    const snap = await db.collection(DUTY_HIST)
      .where('user_id', '==', req.params.userId)
      .orderBy('created_at', 'desc')
      .get();
    res.json(snap.docs.map(docData));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Dienstzeit-Statistiken: Monatszeit + Gesamtzeit (Admin oder eigener User)
app.get('/api/duty-history/stats/:userId', authMiddleware, async (req, res) => {
  const roles = req.user.roles || (req.user.role ? [req.user.role] : []);
  const isAdmin = await hasAdminAccess(roles);
  if (!isAdmin && req.user.id !== req.params.userId)
    return res.status(403).json({ error: 'Kein Zugriff' });
  try {
    const snap = await db.collection(DUTY_HIST)
      .where('user_id', '==', req.params.userId)
      .get();
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // Hilfsfunktion: "1h 23m" → Minuten
    function parseDuration(dur) {
      if (!dur) return 0;
      let mins = 0;
      // Format "1h 23m"
      const h = dur.match(/(\d+)h/);
      const m = dur.match(/(\d+)m/);
      if (h || m) {
        if (h) mins += parseInt(h[1]) * 60;
        if (m) mins += parseInt(m[1]);
        return mins;
      }
      // Altes Format "01:23:45"
      const parts = dur.split(':');
      if (parts.length >= 2) {
        mins += parseInt(parts[0]) * 60;
        mins += parseInt(parts[1]);
      }
      return mins;
    }

    // Hilfsfunktion: Firestore Timestamp, ISO-String oder Date robust in ein Date-Objekt wandeln
    function toJsDate(value) {
      if (!value) return null;
      if (typeof value.toDate === 'function') return value.toDate(); // Firestore Timestamp
      if (value instanceof Date) return value;
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }

    let totalMins = 0;
    let monthMins = 0;
    snap.docs.forEach(doc => {
      const d = doc.data();
      const mins = parseDuration(d.duration);
      totalMins += mins;
      const entryDate = toJsDate(d.end_time);
      if (entryDate && entryDate.getMonth() === currentMonth && entryDate.getFullYear() === currentYear) {
        monthMins += mins;
      }
    });

    function fmtMins(m) {
      const h = Math.floor(m / 60);
      const min = m % 60;
      return `${h}h ${min}m`;
    }

    res.json({
      total: fmtMins(totalMins),
      totalMinutes: totalMins,
      thisMonth: fmtMins(monthMins),
      thisMonthMinutes: monthMins,
      monthLabel: now.toLocaleString('de-AT', { month: 'long', year: 'numeric' })
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════
//  ADMIN: DIENSTZEIT-VERWALTUNG
// ════════════════════════════════════════

// Admin: User manuell ausstempeln
app.post('/api/admin/duty/end/:userId', authMiddleware, adminOnly, async (req, res) => {
  try {
    const targetId = req.params.userId;
    const now = new Date().toISOString();
    const userDoc = await db.collection(USERS).doc(targetId).get();
    if (!userDoc.exists) return res.status(404).json({ error: 'User nicht gefunden' });
    const userData = userDoc.data();
    if (!userData.on_duty) return res.status(400).json({ error: 'User ist nicht im Dienst' });

    const actualDutyStart = userData.duty_start || null;
    const fahrzeugId = userData.duty_fahrzeug || null;
    let duration = '–';
    if (actualDutyStart) {
      const ms = new Date(now) - new Date(actualDutyStart);
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      duration = `${h}h ${m}m`;
    }

    await db.collection(USERS).doc(targetId).update({ on_duty: false, duty_start: null, duty_fahrzeug: null });

    // Fahrzeug freigeben
    if (fahrzeugId) {
      const fRef = db.collection(FAHRZEUGE).doc(fahrzeugId);
      const fSnap = await fRef.get().catch(() => null);
      if (fSnap && fSnap.exists) {
        const fData = fSnap.data();
        let besatzung = Array.isArray(fData.besatzung) ? fData.besatzung.filter(id => id !== targetId) : [];
        const newStatus = besatzung.length === 0 ? 'verfügbar' : 'im_einsatz';
        await fRef.update({ besatzung, besetzt_von: besatzung[0] || null, status: newStatus, updated_at: admin.firestore.FieldValue.serverTimestamp() }).catch(() => {});
      }
    }

    // Duty-History Eintrag
    if (actualDutyStart) {
      await db.collection(DUTY_HIST).add({
        user_id: targetId,
        user_name: `${userData.vorname} ${userData.nachname}`,
        dienstnummer: userData.dienstnummer || '',
        start_time: actualDutyStart,
        end_time: now,
        duration,
        fahrzeug: fahrzeugId || null,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        note: `Manuell ausgestempelt von Admin`
      });
    }

    await db.collection(ACTIVITY).add({
      text: `${userData.vorname} ${userData.nachname} wurde von einem Admin ausgestempelt (${duration}).`,
      color: 'amber',
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    trimActivity();
    res.json({ ok: true, duration });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin: Manuellen Diensteintrag hinzufügen
app.post('/api/admin/duty/entry/:userId', authMiddleware, adminOnly, async (req, res) => {
  try {
    const targetId = req.params.userId;
    const { start_time, end_time, note } = req.body;
    if (!start_time || !end_time) return res.status(400).json({ error: 'Start- und Endzeit erforderlich' });

    const userDoc = await db.collection(USERS).doc(targetId).get();
    if (!userDoc.exists) return res.status(404).json({ error: 'User nicht gefunden' });
    const userData = userDoc.data();

    const startDate = new Date(start_time);
    const endDate = new Date(end_time);
    if (isNaN(startDate) || isNaN(endDate)) return res.status(400).json({ error: 'Ungültige Zeitangaben' });
    if (endDate <= startDate) return res.status(400).json({ error: 'Endzeit muss nach Startzeit liegen' });

    const ms = endDate - startDate;
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const duration = `${h}h ${m}m`;

    await db.collection(DUTY_HIST).add({
      user_id: targetId,
      user_name: `${userData.vorname} ${userData.nachname}`,
      dienstnummer: userData.dienstnummer || '',
      start_time: start_time,
      end_time: end_time,
      duration,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      note: note || 'Manuell eingetragen'
    });

    await db.collection(ACTIVITY).add({
      text: `Admin hat für ${userData.vorname} ${userData.nachname} einen Diensteintrag hinzugefügt (${duration}).`,
      color: 'blue',
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    trimActivity();
    res.json({ ok: true, duration });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin: Duty-History-Eintrag löschen
app.delete('/api/admin/duty/entry/:entryId', authMiddleware, adminOnly, async (req, res) => {
  try {
    await db.collection(DUTY_HIST).doc(req.params.entryId).delete();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin: Duty-History-Eintrag bearbeiten (Start/End-Zeit korrigieren)
app.put('/api/admin/duty/entry/:entryId', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { start_time, end_time, note } = req.body;
    if (!start_time || !end_time) return res.status(400).json({ error: 'Start- und Endzeit erforderlich' });
    const startDate = new Date(start_time);
    const endDate   = new Date(end_time);
    if (isNaN(startDate) || isNaN(endDate)) return res.status(400).json({ error: 'Ungültige Zeitangaben' });
    if (endDate <= startDate) return res.status(400).json({ error: 'Endzeit muss nach Startzeit liegen' });
    const ms = endDate - startDate;
    const h  = Math.floor(ms / 3600000);
    const m  = Math.floor((ms % 3600000) / 60000);
    const duration = `${h}h ${m}m`;
    const update = { start_time, end_time, duration };
    if (note !== undefined) update.note = note;
    await db.collection(DUTY_HIST).doc(req.params.entryId).update(update);
    res.json({ ok: true, duration });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════
//  TELEFONBUCH
// ════════════════════════════════════════

app.get('/api/kontakte', authMiddleware, async (req, res) => {
  try {
    const snap = await db.collection(KONTAKTE).orderBy('nachname').get();
    res.json(snap.docs.map(docData));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/kontakte', authMiddleware, async (req, res) => {
  const { vorname, nachname, dienstnummer, telefon, abteilung, rang } = req.body;
  if (!vorname || !nachname) return res.status(400).json({ error: 'Name erforderlich' });
  try {
    const ref = await db.collection(KONTAKTE).add({
      vorname, nachname, dienstnummer, telefon, abteilung, rang,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    trimActivity();
    const doc = await ref.get();
    res.json(docData(doc));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/kontakte/:id', authMiddleware, adminOnly, async (req, res) => {
  const { vorname, nachname, dienstnummer, telefon, abteilung, rang } = req.body;
  if (!vorname || !nachname) return res.status(400).json({ error: 'Name erforderlich' });
  try {
    const update = { vorname, nachname, dienstnummer, telefon, abteilung, rang };
    await db.collection(KONTAKTE).doc(req.params.id).update(update);
    res.json({ ok: true, id: req.params.id, ...update });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/kontakte/:id', authMiddleware, async (req, res) => {
  try {
    await db.collection(KONTAKTE).doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════
//  AKTIVITÄTEN
// ════════════════════════════════════════

app.get('/api/activity', authMiddleware, async (req, res) => {
  try {
    const snap = await db.collection(ACTIVITY).orderBy('created_at', 'desc').limit(7).get();
    res.json(snap.docs.map(docData));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Hilfsfunktion: nach jedem neuen Activity-Eintrag alte löschen (max. 7 behalten)
async function trimActivity() {
  try {
    const snap = await db.collection(ACTIVITY).orderBy('created_at', 'desc').get();
    const toDelete = snap.docs.slice(7);
    for (const doc of toDelete) await doc.ref.delete();
  } catch {}
}

// ════════════════════════════════════════
//  PASSWORT ÄNDERN
// ════════════════════════════════════════
app.post('/api/users/change-password', authMiddleware, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ error: 'Felder fehlen' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Passwort mind. 6 Zeichen' });
  try {
    const doc = await db.collection(USERS).doc(req.user.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'User nicht gefunden' });
    const user = doc.data();
    const match = await bcrypt.compare(oldPassword, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Aktuelles Passwort falsch' });
    const newHash = await bcrypt.hash(newPassword, 10);
    await db.collection(USERS).doc(req.user.id).update({ password_hash: newHash });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Eigenes Profil aktualisieren (Telefonnummer)
app.put('/api/users/me', authMiddleware, async (req, res) => {
  try {
    const { telefon } = req.body;
    const update = { telefon: telefon || '' };
    await db.collection(USERS).doc(req.user.id).update(update);
    res.json({ ok: true, ...update });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
//  ARBEITSUNFÄLLE
// ════════════════════════════════════════

app.get('/api/unfall', authMiddleware, async (req, res) => {
  try {
    const snap = await db.collection(UNFALL).orderBy('created_at', 'desc').get();
    res.json(snap.docs.map(docData));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/unfall', authMiddleware, async (req, res) => {
  const { name, hergang } = req.body;
  if (!name || !hergang) return res.status(400).json({ error: 'Name und Hergang erforderlich' });
  try {
    const countSnap = await db.collection(UNFALL).count().get();
    const nr = countSnap.data().count + 1;
    const ref = await db.collection(UNFALL).add({
      nr,
      ...req.body,
      user_id: req.user.id,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    trimActivity();
    await db.collection(ACTIVITY).add({
      text: `Arbeitsunfall gemeldet von ${name}`,
      color: 'red',
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    trimActivity();
    const newDoc = await ref.get();
    res.json(docData(newDoc));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/unfall/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await db.collection(UNFALL).doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
//  BERECHTIGUNGEN (Admin)
// ════════════════════════════════════════

// Berechtigungen abrufen
app.get('/api/permissions', authMiddleware, async (req, res) => {
  try {
    const doc = await db.collection(PERMISSIONS).doc('personalakte').get();
    if (!doc.exists) return res.json({ read_roles: [], write_roles: [] });
    res.json(doc.data());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Berechtigungen speichern (nur Admin)
app.put('/api/permissions', authMiddleware, adminOnly, async (req, res) => {
  const { read_roles, write_roles } = req.body;
  if (!Array.isArray(read_roles) || !Array.isArray(write_roles))
    return res.status(400).json({ error: 'Ungültige Daten' });
  try {
    await db.collection(PERMISSIONS).doc('personalakte').set({
      read_roles, write_roles,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin-Rollen abrufen (welche Rollen haben Admin-Rechte)
app.get('/api/permissions/admin-roles', authMiddleware, adminOnly, async (req, res) => {
  try {
    const doc = await db.collection(PERMISSIONS).doc('admin_roles').get();
    if (!doc.exists) return res.json({ admin_roles: [] });
    res.json({ admin_roles: doc.data().admin_roles || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin-Rollen speichern (nur Admin)
app.put('/api/permissions/admin-roles', authMiddleware, adminOnly, async (req, res) => {
  const { admin_roles } = req.body;
  if (!Array.isArray(admin_roles))
    return res.status(400).json({ error: 'Ungültige Daten' });
  // Sicherheit: 'admin' kann nicht entfernt werden
  const safe = admin_roles.filter(r => r !== 'admin');
  try {
    await db.collection(PERMISSIONS).doc('admin_roles').set({
      admin_roles: safe,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
//  PERSONALAKTEN
// ════════════════════════════════════════

// Hilfsfunktion: Berechtigungen laden
async function getPersonalaktePerms() {
  const doc = await db.collection(PERMISSIONS).doc('personalakte').get();
  if (!doc.exists) return { read_roles: ['admin'], write_roles: ['admin'] };
  return doc.data();
}

// Personalakte abrufen
// → eigene Akte: immer erlaubt
// → fremde Akte: nur mit Leserecht
app.get('/api/personalakte/:userId', authMiddleware, async (req, res) => {
  const targetId = req.params.userId;
  const callerRoles = req.user.roles || (req.user.role ? [req.user.role] : []);
  const isSelf = req.user.id === targetId;

  if (!isSelf) {
    const isAdmin = await hasAdminAccess(callerRoles);
    if (!isAdmin) {
      const perms = await getPersonalaktePerms();
      const canRead = callerRoles.some(r => perms.read_roles.includes(r));
      if (!canRead) return res.status(403).json({ error: 'Kein Leserecht für diese Personalakte' });
    }
  }

  try {
    const doc = await db.collection(PERSONALAKTEN).doc(targetId).get();
    if (!doc.exists) {
      // Leere Akte zurückgeben falls noch keine existiert
      return res.json({
        user_id:      targetId,
        notizen:      '',
        ausbildung:   [],
        befoerderungen: [],
        eintraege:    [],
        updated_at:   null
      });
    }
    res.json({ user_id: targetId, ...doc.data() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Personalakte anlegen / aktualisieren (Schreibrecht erforderlich)
app.put('/api/personalakte/:userId', authMiddleware, async (req, res) => {
  const targetId = req.params.userId;
  const callerRoles = req.user.roles || (req.user.role ? [req.user.role] : []);

  const perms = await getPersonalaktePerms();
  const canWrite = callerRoles.includes('admin') || callerRoles.some(r => perms.write_roles.includes(r));
  if (!canWrite) return res.status(403).json({ error: 'Kein Schreibrecht für Personalakten' });

  const { notizen, ausbildung, befoerderungen, eintraege } = req.body;
  try {
    const update = {
      notizen:        notizen        || '',
      ausbildung:     ausbildung     || [],
      befoerderungen: befoerderungen || [],
      eintraege:      eintraege      || [],
      updated_by:     req.user.id,
      updated_at:     admin.firestore.FieldValue.serverTimestamp()
    };
    await db.collection(PERSONALAKTEN).doc(targetId).set(update, { merge: true });

    // Aktivität loggen
    const userDoc = await db.collection(USERS).doc(targetId).get();
    const name = userDoc.exists
      ? `${userDoc.data().vorname} ${userDoc.data().nachname}`
      : targetId;
    await db.collection(ACTIVITY).add({
      text:  `Personalakte von ${name} aktualisiert`,
      color: 'yellow',
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    trimActivity();

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Einzelnen Eintrag (Verwarnungen, Lob etc.) hinzufügen
app.post('/api/personalakte/:userId/eintrag', authMiddleware, async (req, res) => {
  const targetId = req.params.userId;
  const callerRoles = req.user.roles || (req.user.role ? [req.user.role] : []);

  const perms = await getPersonalaktePerms();
  const canWrite = callerRoles.includes('admin') || callerRoles.some(r => perms.write_roles.includes(r));
  if (!canWrite) return res.status(403).json({ error: 'Kein Schreibrecht für Personalakten' });

  const { typ, titel, inhalt } = req.body;
  // typ: 'lob' | 'verwarnung' | 'notiz' | 'sonstiges'
  if (!typ || !titel || !inhalt)
    return res.status(400).json({ error: 'typ, titel und inhalt erforderlich' });

  try {
    const neuerEintrag = {
      id:         Date.now().toString(),
      typ,
      titel,
      inhalt,
      erstellt_von: req.user.id,
      erstellt_am:  new Date().toISOString()
    };

    await db.collection(PERSONALAKTEN).doc(targetId).set({
      eintraege:  admin.firestore.FieldValue.arrayUnion(neuerEintrag),
      updated_by: req.user.id,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.json({ ok: true, eintrag: neuerEintrag });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Einzelnen Eintrag löschen
app.delete('/api/personalakte/:userId/eintrag/:eintragId', authMiddleware, async (req, res) => {
  const targetId = req.params.userId;
  const callerRoles = req.user.roles || (req.user.role ? [req.user.role] : []);

  const perms = await getPersonalaktePerms();
  const canWrite = callerRoles.includes('admin') || callerRoles.some(r => perms.write_roles.includes(r));
  if (!canWrite) return res.status(403).json({ error: 'Kein Schreibrecht für Personalakten' });

  try {
    const doc = await db.collection(PERSONALAKTEN).doc(targetId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Akte nicht gefunden' });

    const aktuelleEintraege = doc.data().eintraege || [];
    const gefiltertEintraege = aktuelleEintraege.filter(e => e.id !== req.params.eintragId);

    await db.collection(PERSONALAKTEN).doc(targetId).update({
      eintraege:  gefiltertEintraege,
      updated_by: req.user.id,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
//  AUFTRÄGE
// ════════════════════════════════════════

app.get('/api/auftraege', authMiddleware, async (req, res) => {
  try {
    const snap = await db.collection(AUFTRAEGE).orderBy('created_at', 'desc').get();
    res.json(snap.docs.map(docData));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auftraege', authMiddleware, async (req, res) => {
  const { titel } = req.body;
  if (!titel) return res.status(400).json({ error: 'Titel erforderlich' });
  try {
    const countSnap = await db.collection(AUFTRAEGE).count().get();
    const nr = countSnap.data().count + 1;
    const ref = await db.collection(AUFTRAEGE).add({
      nr, ...req.body,
      user_id: req.user.id,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    trimActivity();
    await db.collection(ACTIVITY).add({
      text: `Neuer Auftrag erstellt: ${titel}`,
      color: 'blue',
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    trimActivity();
    const newDoc = await ref.get();
    res.json(docData(newDoc));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/auftraege/:id', authMiddleware, async (req, res) => {
  try {
    await db.collection(AUFTRAEGE).doc(req.params.id).update({
      ...req.body, updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/auftraege/:id', authMiddleware, async (req, res) => {
  try {
    await db.collection(AUFTRAEGE).doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
//  BAUSTELLEN
// ════════════════════════════════════════

app.get('/api/baustellen', authMiddleware, async (req, res) => {
  try {
    const snap = await db.collection(BAUSTELLEN).orderBy('created_at', 'desc').get();
    res.json(snap.docs.map(docData));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/baustellen', authMiddleware, async (req, res) => {
  const { titel } = req.body;
  if (!titel) return res.status(400).json({ error: 'Bezeichnung erforderlich' });
  try {
    const countSnap = await db.collection(BAUSTELLEN).count().get();
    const nr = countSnap.data().count + 1;
    const ref = await db.collection(BAUSTELLEN).add({
      nr, ...req.body,
      user_id: req.user.id,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    trimActivity();
    await db.collection(ACTIVITY).add({
      text: `Neue Baustellengenehmigung beantragt: ${titel}`,
      color: 'amber',
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    trimActivity();
    const newDoc = await ref.get();
    res.json(docData(newDoc));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/baustellen/:id', authMiddleware, async (req, res) => {
  try {
    await db.collection(BAUSTELLEN).doc(req.params.id).update({
      ...req.body, updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/baustellen/:id', authMiddleware, async (req, res) => {
  try {
    await db.collection(BAUSTELLEN).doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
//  WARTUNGSPROTOKOLLE
// ════════════════════════════════════════

app.get('/api/wartung', authMiddleware, async (req, res) => {
  try {
    const snap = await db.collection(WARTUNG).orderBy('created_at', 'desc').get();
    res.json(snap.docs.map(docData));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/wartung', authMiddleware, async (req, res) => {
  const { anlage } = req.body;
  if (!anlage) return res.status(400).json({ error: 'Anlage erforderlich' });
  try {
    const countSnap = await db.collection(WARTUNG).count().get();
    const nr = countSnap.data().count + 1;
    const ref = await db.collection(WARTUNG).add({
      nr, ...req.body,
      user_id: req.user.id,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    trimActivity();
    await db.collection(ACTIVITY).add({
      text: `Wartungsprotokoll erstellt für: ${anlage}`,
      color: 'purple',
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    trimActivity();
    const newDoc = await ref.get();
    res.json(docData(newDoc));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/wartung/:id', authMiddleware, async (req, res) => {
  try {
    await db.collection(WARTUNG).doc(req.params.id).update({
      ...req.body, updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/wartung/:id', authMiddleware, async (req, res) => {
  try {
    await db.collection(WARTUNG).doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
//  FAHRZEUGE
// ════════════════════════════════════════

// Alle Fahrzeuge abrufen (alle eingeloggten User)
app.get('/api/fahrzeuge', authMiddleware, async (req, res) => {
  try {
    const snap = await db.collection(FAHRZEUGE).orderBy('created_at').get();
    res.json(snap.docs.map(docData));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Fahrzeug anlegen (nur Admin)
app.post('/api/fahrzeuge', authMiddleware, adminOnly, async (req, res) => {
  const { kennzeichen, bezeichnung, typ, farbe, status, notizen, max_besatzung } = req.body;
  if (!kennzeichen || !bezeichnung) return res.status(400).json({ error: 'Kennzeichen und Bezeichnung erforderlich' });
  try {
    // Kennzeichen eindeutig prüfen
    const existing = await db.collection(FAHRZEUGE).where('kennzeichen','==',kennzeichen.toUpperCase()).limit(1).get();
    if (!existing.empty) return res.status(409).json({ error: 'Kennzeichen bereits vorhanden' });
    const ref = await db.collection(FAHRZEUGE).add({
      kennzeichen:   kennzeichen.toUpperCase(),
      bezeichnung,
      typ:           typ || 'PKW',
      farbe:         farbe || '',
      status:        status || 'verfügbar', // verfügbar | im_einsatz | in_wartung | außer_betrieb
      besatzung:     [], // Array von user_ids
      max_besatzung: Number(max_besatzung) || 1,
      notizen:       notizen || '',
      created_at:    admin.firestore.FieldValue.serverTimestamp(),
      updated_at:    admin.firestore.FieldValue.serverTimestamp()
    });
    const doc = await ref.get();
    res.json(docData(doc));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Fahrzeug bearbeiten (nur Admin)
app.put('/api/fahrzeuge/:id', authMiddleware, adminOnly, async (req, res) => {
  const { kennzeichen, bezeichnung, typ, farbe, status, notizen, max_besatzung } = req.body;
  if (!kennzeichen || !bezeichnung) return res.status(400).json({ error: 'Kennzeichen und Bezeichnung erforderlich' });
  try {
    // Kennzeichen-Duplikat prüfen (außer sich selbst)
    const existing = await db.collection(FAHRZEUGE).where('kennzeichen','==',kennzeichen.toUpperCase()).limit(1).get();
    if (!existing.empty && existing.docs[0].id !== req.params.id)
      return res.status(409).json({ error: 'Kennzeichen bereits vorhanden' });
    await db.collection(FAHRZEUGE).doc(req.params.id).update({
      kennzeichen: kennzeichen.toUpperCase(),
      bezeichnung, typ: typ || 'PKW', farbe: farbe || '',
      status: status || 'verfügbar', notizen: notizen || '',
      max_besatzung: Number(max_besatzung) || 1,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Fahrzeug löschen (nur Admin)
app.delete('/api/fahrzeuge/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await db.collection(FAHRZEUGE).doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
//  FUHRPARK-TABELLE (Parkplatz-Logs & Fahrzeugzustand)
// ════════════════════════════════════════

// Berechtigungen abrufen – jeder eingeloggte User darf das lesen,
// damit das Frontend den Nav-Punkt korrekt ein-/ausblenden kann
app.get('/api/permissions/fuhrpark', authMiddleware, async (req, res) => {
  try {
    const doc = await db.collection(PERMISSIONS).doc('fuhrpark').get();
    if (!doc.exists) return res.json({ read_roles: [], write_roles: [] });
    res.json(doc.data());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Berechtigungen speichern (nur Admin) – hier legt der Admin fest, wer die Tabelle sehen/bearbeiten darf
app.put('/api/permissions/fuhrpark', authMiddleware, adminOnly, async (req, res) => {
  const { read_roles, write_roles } = req.body;
  if (!Array.isArray(read_roles) || !Array.isArray(write_roles))
    return res.status(400).json({ error: 'Ungültige Daten' });
  try {
    await db.collection(PERMISSIONS).doc('fuhrpark').set({
      read_roles, write_roles,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Hilfsfunktion: Lese-/Schreibzugriff auf die Fuhrpark-Tabelle prüfen (Admins immer erlaubt)
async function checkFuhrparkAccess(req, mode) {
  const userRoles = req.user.roles || (req.user.role ? [req.user.role] : []);
  if (await hasAdminAccess(userRoles)) return true;
  try {
    const doc = await db.collection(PERMISSIONS).doc('fuhrpark').get();
    if (!doc.exists) return false;
    const roles = (mode === 'write' ? doc.data().write_roles : doc.data().read_roles) || [];
    return userRoles.some(r => roles.includes(r));
  } catch { return false; }
}

// Alle Einträge abrufen (nur berechtigte Rollen)
app.get('/api/fuhrpark', authMiddleware, async (req, res) => {
  if (!(await checkFuhrparkAccess(req, 'read')))
    return res.status(403).json({ error: 'Keine Berechtigung für die Fuhrpark-Tabelle' });
  try {
    const snap = await db.collection(FUHRPARK).orderBy('created_at', 'desc').get();
    res.json(snap.docs.map(docData));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Neuen Eintrag anlegen (Parkplatz-Log / Zustand) – nur berechtigte Rollen
app.post('/api/fuhrpark', authMiddleware, async (req, res) => {
  if (!(await checkFuhrparkAccess(req, 'write')))
    return res.status(403).json({ error: 'Keine Berechtigung' });
  const { fahrzeug_id, kennzeichen, datum, fahrer, standort, km_stand, zustand, bemerkung } = req.body;
  if (!kennzeichen || !datum) return res.status(400).json({ error: 'Fahrzeug und Datum erforderlich' });
  try {
    const ref = await db.collection(FUHRPARK).add({
      fahrzeug_id:    fahrzeug_id || null,
      kennzeichen:    kennzeichen.toUpperCase(),
      datum,
      fahrer:         fahrer || '',
      standort:       standort || '',
      km_stand:       km_stand || '',
      zustand:        zustand || 'einwandfrei', // einwandfrei | kleinere_maengel | beschaedigt | werkstatt | ausser_betrieb
      bemerkung:      bemerkung || '',
      ersteller_id:   req.user.id,
      ersteller_name: req.user.vorname ? `${req.user.vorname} ${req.user.nachname}` : req.user.username,
      created_at:     admin.firestore.FieldValue.serverTimestamp(),
      updated_at:     admin.firestore.FieldValue.serverTimestamp()
    });
    await db.collection(ACTIVITY).add({
      text:  `Fuhrpark-Eintrag für ${kennzeichen.toUpperCase()} erfasst.`,
      color: 'blue',
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    trimActivity();
    const doc = await ref.get();
    res.json(docData(doc));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Eintrag bearbeiten – ermöglicht Excel-artiges Inline-Editieren einzelner Zellen
app.put('/api/fuhrpark/:id', authMiddleware, async (req, res) => {
  if (!(await checkFuhrparkAccess(req, 'write')))
    return res.status(403).json({ error: 'Keine Berechtigung' });
  const { fahrzeug_id, kennzeichen, datum, fahrer, standort, km_stand, zustand, bemerkung } = req.body;
  try {
    const update = { updated_at: admin.firestore.FieldValue.serverTimestamp() };
    if (fahrzeug_id !== undefined) update.fahrzeug_id = fahrzeug_id || null;
    if (kennzeichen !== undefined) update.kennzeichen = (kennzeichen || '').toUpperCase();
    if (datum       !== undefined) update.datum = datum;
    if (fahrer      !== undefined) update.fahrer = fahrer;
    if (standort    !== undefined) update.standort = standort;
    if (km_stand    !== undefined) update.km_stand = km_stand;
    if (zustand      !== undefined) update.zustand = zustand;
    if (bemerkung   !== undefined) update.bemerkung = bemerkung;
    await db.collection(FUHRPARK).doc(req.params.id).update(update);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Eintrag löschen (nur berechtigte Rollen)
app.delete('/api/fuhrpark/:id', authMiddleware, async (req, res) => {
  if (!(await checkFuhrparkAccess(req, 'write')))
    return res.status(403).json({ error: 'Keine Berechtigung' });
  try {
    await db.collection(FUHRPARK).doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
//  HANDBÜCHER
// ════════════════════════════════════════

// Alle Handbücher abrufen (alle eingeloggten Nutzer)
app.get('/api/handbuecher', authMiddleware, async (req, res) => {
  try {
    const snap = await db.collection(HANDBUECHER).orderBy('created_at', 'desc').get();
    res.json(snap.docs.map(docData));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Neues Handbuch anlegen (nur Admin)
app.post('/api/handbuecher', authMiddleware, adminOnly, async (req, res) => {
  const { titel, kategorie, inhalt, beschreibung, erlaubte_rollen } = req.body;
  if (!titel || !inhalt) return res.status(400).json({ error: 'Titel und Inhalt sind erforderlich' });
  try {
    const now = admin.firestore.Timestamp.now();
    const ref = await db.collection(HANDBUECHER).add({
      titel,
      kategorie:       kategorie || 'allgemein',
      beschreibung:    beschreibung || '',
      inhalt,
      erlaubte_rollen: Array.isArray(erlaubte_rollen) ? erlaubte_rollen : [],
      erstellt_von:    req.user.id,
      created_at:      now,
      updated_at:      now
    });
    await db.collection(ACTIVITY).add({
      text:  `Neues Handbuch erstellt: ${titel}`,
      color: 'blue',
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    trimActivity();
    const newDoc = await ref.get();
    res.json(docData(newDoc));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Handbuch bearbeiten (nur Admin)
app.put('/api/handbuecher/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await db.collection(HANDBUECHER).doc(req.params.id).update({
      ...req.body,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Handbuch löschen (nur Admin)
app.delete('/api/handbuecher/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await db.collection(HANDBUECHER).doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
//  WARTUNGSMODUS (System-Maintenance)
// ════════════════════════════════════════

// Wartungsmodus-Status abrufen (öffentlich, damit Login-Seite ihn anzeigen kann)
app.get('/api/system/wartungsmodus', async (req, res) => {
  try {
    const doc = await db.collection(SETTINGS).doc('wartungsmodus').get();
    if (!doc.exists) return res.json({ aktiv: false, nachricht: '' });
    res.json(doc.data());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Wartungsmodus aktivieren/deaktivieren (nur Admin)
// POST { aktiv: true/false, nachricht: "..." }
app.post('/api/system/wartungsmodus', authMiddleware, adminOnly, async (req, res) => {
  const { aktiv, nachricht } = req.body;
  try {
    await db.collection(SETTINGS).doc('wartungsmodus').set({
      aktiv: !!aktiv,
      nachricht: nachricht || 'Das System befindet sich im Wartungsmodus.',
      geaendert_von: req.user.id,
      geaendert_am: admin.firestore.FieldValue.serverTimestamp()
    });

    // Wenn Wartungsmodus aktiviert wird → alle Nicht-Admins aus dem Dienst entfernen
    if (aktiv) {
      const usersSnap = await db.collection(USERS).where('on_duty', '==', true).get();
      const batch = db.batch();
      const now = new Date().toISOString();
      const betroffeneUser = [];

      for (const userDoc of usersSnap.docs) {
        const userData = userDoc.data();
        const userRoles = userData.roles || (userData.role ? [userData.role] : ['beamter']);
        const istAdmin = await hasAdminAccess(userRoles);
        if (istAdmin) continue; // Admins bleiben im Dienst

        const actualDutyStart = userData.duty_start || null;
        const fahrzeugId = userData.duty_fahrzeug || null;
        let duration = '–';
        if (actualDutyStart) {
          const ms = new Date(now) - new Date(actualDutyStart);
          const h = Math.floor(ms / 3600000);
          const m = Math.floor((ms % 3600000) / 60000);
          duration = `${h}h ${m}m`;
        }
        const durationMs = actualDutyStart ? (new Date(now) - new Date(actualDutyStart)) : 0;

        // User außer Dienst setzen
        batch.update(db.collection(USERS).doc(userDoc.id), {
          on_duty: false, duty_start: null, duty_fahrzeug: null
        });

        // Duty-History-Eintrag erstellen
        const histRef = db.collection(DUTY_HIST).doc();
        batch.set(histRef, {
          user_id:              userDoc.id,
          dienstnummer:         userData.dienstnummer || null,
          name:                 `${userData.vorname || ''} ${userData.nachname || ''}`.trim(),
          vorname:              userData.vorname || '',
          nachname:             userData.nachname || '',
          start_time:           actualDutyStart ? admin.firestore.Timestamp.fromDate(new Date(actualDutyStart)) : null,
          end_time:             admin.firestore.Timestamp.fromDate(new Date(now)),
          duration,
          duration_ms:          durationMs,
          fahrzeug_id:          fahrzeugId || null,
          fahrzeug_kennzeichen: null,
          abmeldung_grund:      'Wartungsmodus aktiviert',
          created_at:           admin.firestore.FieldValue.serverTimestamp()
        });

        // Fahrzeug freigeben
        if (fahrzeugId) {
          const fRef = db.collection(FAHRZEUGE).doc(fahrzeugId);
          const fSnap = await fRef.get().catch(() => null);
          if (fSnap && fSnap.exists) {
            const fData = fSnap.data();
            const besatzung = Array.isArray(fData.besatzung)
              ? fData.besatzung.filter(id => id !== userDoc.id)
              : [];
            batch.update(fRef, {
              besatzung,
              besetzt_von: besatzung[0] || null,
              status: besatzung.length === 0 ? 'verfügbar' : 'im_einsatz',
              updated_at: admin.firestore.FieldValue.serverTimestamp()
            });
          }
        }

        betroffeneUser.push(`${userData.vorname || ''} ${userData.nachname || ''}`.trim());
      }

      await batch.commit();

      // Activity-Log
      if (betroffeneUser.length > 0) {
        await db.collection(ACTIVITY).add({
          text: `⚠️ Wartungsmodus aktiviert – ${betroffeneUser.length} Benutzer automatisch außer Dienst gestellt.`,
          color: 'orange',
          created_at: admin.firestore.FieldValue.serverTimestamp()
        });
      } else {
        await db.collection(ACTIVITY).add({
          text: '⚠️ Wartungsmodus aktiviert.',
          color: 'orange',
          created_at: admin.firestore.FieldValue.serverTimestamp()
        });
      }
      trimActivity();
      return res.json({ ok: true, abgemeldet: betroffeneUser.length, betroffene: betroffeneUser });
    } else {
      await db.collection(ACTIVITY).add({
        text: '✅ Wartungsmodus deaktiviert.',
        color: 'green',
        created_at: admin.firestore.FieldValue.serverTimestamp()
      });
      trimActivity();
      return res.json({ ok: true, abgemeldet: 0 });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
//  ANKÜNDIGUNGEN
// ════════════════════════════════════════

// Alle Ankündigungen abrufen (alle eingeloggten Nutzer)
app.get('/api/ankuendigungen', authMiddleware, async (req, res) => {
  try {
    const snap = await db.collection(ANKUENDIGUNGEN).orderBy('created_at', 'desc').get();
    res.json(snap.docs.map(docData));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ankündigung erstellen (nur berechtigte Rollen)
app.post('/api/ankuendigungen', authMiddleware, async (req, res) => {
  const userRoles = req.user.roles || (req.user.role ? [req.user.role] : []);
  // Berechtigungen laden
  let writeRoles = ['leitender', 'einsatzleiter', 'admin'];
  try {
    const permDoc = await db.collection(PERMISSIONS).doc('ankuendigungen').get();
    if (permDoc.exists) writeRoles = permDoc.data().write_roles || writeRoles;
  } catch {}
  const isAdmin = await hasAdminAccess(userRoles);
  if (!isAdmin && !userRoles.some(r => writeRoles.includes(r))) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const { titel, inhalt, prioritaet, pinned } = req.body;
  if (!titel || !inhalt) return res.status(400).json({ error: 'Titel und Inhalt erforderlich' });
  try {
    const ref = await db.collection(ANKUENDIGUNGEN).add({
      titel,
      inhalt,
      prioritaet: prioritaet || 'normal', // normal | wichtig | dringend
      pinned:     pinned || false,
      autor_id:   req.user.id,
      autor_name: req.user.vorname ? `${req.user.vorname} ${req.user.nachname}` : req.user.username,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    trimActivity();
    await db.collection(ACTIVITY).add({
      text: `Neue Ankündigung: ${titel}`,
      color: 'amber',
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    trimActivity();
    const newDoc = await ref.get();
    res.json(docData(newDoc));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ankündigung löschen (nur berechtigte Rollen)
app.delete('/api/ankuendigungen/:id', authMiddleware, async (req, res) => {
  const userRoles = req.user.roles || (req.user.role ? [req.user.role] : []);
  let writeRoles = ['leitender', 'einsatzleiter', 'admin'];
  try {
    const permDoc = await db.collection(PERMISSIONS).doc('ankuendigungen').get();
    if (permDoc.exists) writeRoles = permDoc.data().write_roles || writeRoles;
  } catch {}
  const isAdmin = await hasAdminAccess(userRoles);
  if (!isAdmin && !userRoles.some(r => writeRoles.includes(r))) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  try {
    await db.collection(ANKUENDIGUNGEN).doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ankündigungs-Berechtigungen lesen/setzen (nur Admin)
app.get('/api/permissions/ankuendigungen', authMiddleware, async (req, res) => {
  try {
    const doc = await db.collection(PERMISSIONS).doc('ankuendigungen').get();
    res.json(doc.exists ? doc.data() : { write_roles: ['leitender','einsatzleiter','admin'] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/permissions/ankuendigungen', authMiddleware, adminOnly, async (req, res) => {
  try {
    await db.collection(PERMISSIONS).doc('ankuendigungen').set({
      write_roles: req.body.write_roles || [],
      updated_at:  admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
//  ABMELDUNGEN (Abwesenheiten mit Zeitraum & Grund)
// ════════════════════════════════════════

// Hilfsfunktion: Darf der User ALLE Abmeldungen einsehen? (Admins immer erlaubt)
async function checkAbmeldungenReadAccess(req) {
  const userRoles = req.user.roles || (req.user.role ? [req.user.role] : []);
  if (await hasAdminAccess(userRoles)) return true;
  try {
    const doc = await db.collection(PERMISSIONS).doc('abmeldungen').get();
    if (!doc.exists) return false;
    const roles = doc.data().read_roles || [];
    return userRoles.some(r => roles.includes(r));
  } catch { return false; }
}

// Abmeldungen abrufen: berechtigte Rollen sehen alle, alle anderen nur ihre eigenen
app.get('/api/abmeldungen', authMiddleware, async (req, res) => {
  try {
    const snap = await db.collection(ABMELDUNGEN).orderBy('created_at', 'desc').get();
    let list = snap.docs.map(docData);
    const canReadAll = await checkAbmeldungenReadAccess(req);
    if (!canReadAll) list = list.filter(a => a.ersteller_id === req.user.id);
    res.json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Neue Abmeldung anlegen (jeder eingeloggte Benutzer, Grund ist optional)
app.post('/api/abmeldungen', authMiddleware, async (req, res) => {
  const { von, bis, grund } = req.body;
  if (!von || !bis) return res.status(400).json({ error: 'Zeitraum (von/bis) erforderlich' });
  try {
    const ref = await db.collection(ABMELDUNGEN).add({
      von,
      bis,
      grund:          (grund || '').trim(),
      ersteller_id:   req.user.id,
      ersteller_name: req.user.vorname ? `${req.user.vorname} ${req.user.nachname}` : req.user.username,
      dienstnummer:   req.user.dienstnummer || '',
      created_at:     admin.firestore.FieldValue.serverTimestamp()
    });
    await db.collection(ACTIVITY).add({
      text: `${req.user.vorname ? req.user.vorname+' '+req.user.nachname : req.user.username} hat sich für ${von} – ${bis} abgemeldet.`,
      color: 'purple',
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    trimActivity();
    const newDoc = await ref.get();
    res.json(docData(newDoc));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Abmeldung löschen (eigene Abmeldung oder berechtigte Rolle/Admin)
app.delete('/api/abmeldungen/:id', authMiddleware, async (req, res) => {
  try {
    const doc = await db.collection(ABMELDUNGEN).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Nicht gefunden' });
    const isOwner = doc.data().ersteller_id === req.user.id;
    if (!isOwner && !(await checkAbmeldungenReadAccess(req))) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }
    await db.collection(ABMELDUNGEN).doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Berechtigungen: wer darf ALLE Abmeldungen einsehen? (nur Admin liest/setzt)
app.get('/api/permissions/abmeldungen', authMiddleware, async (req, res) => {
  try {
    const doc = await db.collection(PERMISSIONS).doc('abmeldungen').get();
    res.json(doc.exists ? doc.data() : { read_roles: [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/permissions/abmeldungen', authMiddleware, adminOnly, async (req, res) => {
  try {
    await db.collection(PERMISSIONS).doc('abmeldungen').set({
      read_roles: req.body.read_roles || [],
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Alle anderen Routen → index.html ───
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Server starten ───
const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 ViennaX läuft auf Port ${PORT}`));
}).catch(e => {
  console.error('❌ Firebase Fehler beim Start:', e.message);
  process.exit(1);
});