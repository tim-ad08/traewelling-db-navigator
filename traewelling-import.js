// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: subway; share-sheet-inputs: plain-text, url;
// Träwelling-Import aus dem DB Navigator (für die iOS-App "Scriptable")
// Checkt ohne Rückfrage ein und meldet jeden Abschnitt per Mitteilung.
// Nutzung: Kurzbefehl (Text als trwl_input.txt in den Scriptable-Ordner -> Run Script)
// oder Reisetext kopieren und Skript direkt starten.

const API = "https://traewelling.de/api/v1";
const VISIBILITY = 0;         // 0 = öffentlich, 1 = ungelistet, 2 = nur Follower, 3 = privat
const BUSINESS = 0;           // 0 = privat, 1 = geschäftlich, 2 = Pendeln
const NOTIFY_SUCCESS = true;  // false = nur bei Fehlern eine Mitteilung schicken
const TIMEOUT = 8;            // Sekunden pro Anfrage
const MAX_PARALLEL = 4;       // höchstens so viele Anfragen gleichzeitig
const VERSION = "v14";

// ---------- Hilfsfunktionen ----------
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const at = (day, h, m) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
const clean = s => s.replace(/\s+/g, " ").trim();
const sleep = ms => new Promise(res => Timer.schedule(ms, false, res));
const T0 = Date.now();

const LOG = [];
const log = msg => { LOG.push(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${msg}`); console.log(msg); };

function docsFM() {
  try { return FileManager.iCloud(); } catch (e) { return FileManager.local(); }
}
function writeLog() {
  try {
    const fm = docsFM();
    fm.writeString(fm.joinPath(fm.documentsDirectory(), "trwl_log.txt"),
      `Träwelling-Skript ${VERSION} – ${new Date().toLocaleString("de-DE")}\n` +
      `${reqCount} Anfragen, ${((Date.now() - T0) / 1000).toFixed(1)} s\n\n` + LOG.join("\n"));
  } catch (e) {}
}

async function notify(title, body) {
  const n = new Notification();
  n.title = title;
  n.body = body;
  await n.schedule();
}

// ---------- Haltestellen-Cache (spart bei bekannten Strecken fast alle Suchen) ----------
const CACHE_FILE = "trwl_cache.json";
let cache = { stations: {} };
let cacheDirty = false;

async function loadCache() {
  try {
    const fm = docsFM();
    const p = fm.joinPath(fm.documentsDirectory(), CACHE_FILE);
    if (!fm.fileExists(p)) return;
    try { await fm.downloadFileFromiCloud(p); } catch (e) {}
    const c = JSON.parse(fm.readString(p));
    if (c && c.stations) cache = c;
  } catch (e) {}
}
function saveCache() {
  if (!cacheDirty) return;
  try {
    const fm = docsFM();
    fm.writeString(fm.joinPath(fm.documentsDirectory(), CACHE_FILE), JSON.stringify(cache));
  } catch (e) {}
}

// ---------- Text aus dem Navigator zerlegen ----------
function parse(text) {
  text = text.replace(/\r/g, "");
  const dm = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!dm) throw new Error("Kein Datum im Text gefunden. Empfangen:\n" + text.slice(0, 200));
  let day = new Date(+dm[3], +dm[2] - 1, +dm[1]);

  const PLATFORM = String.raw`(?:, (?:Gleis|Bussteig|Bahnsteig|Bstg\.?|Steig|Pos\.)[^\n]*)?`;
  const re = new RegExp(String.raw`^([^\n]+)\nNach ([^\n]*)\nAb (\d{1,2}):(\d{2}) ([^\n]+?)` + PLATFORM +
    String.raw`\nAn (\d{1,2}):(\d{2}) ([^\n]+?)` + PLATFORM + "$", "gm");
  const legs = [];
  let m, lastArrMin = -1;
  while ((m = re.exec(text))) {
    const depMin = +m[3] * 60 + +m[4];
    const arrMin = +m[6] * 60 + +m[7];
    if (lastArrMin >= 0 && depMin < lastArrMin) day = addDays(day, 1);
    const dep = at(day, +m[3], +m[4]);
    const arrDay = arrMin < depMin ? addDays(day, 1) : day;
    const arr = at(arrDay, +m[6], +m[7]);
    day = arrDay;
    lastArrMin = arrMin;
    legs.push({
      train: m[1].trim(), direction: m[2].trim(),
      from: m[5].trim(), to: m[8].trim(), dep, arr,
    });
  }
  return legs;
}

// ---------- Zugbezeichnung verstehen ----------
// "RB41 (24862) / RB40 (24830)" -> Linien [rb41, rb40], Zugnummern [24862, 24830]
const canonLine = s => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
function trainInfo(t) {
  const labels = [], numbers = [];
  for (const part of t.split("/")) {
    const m = part.trim().match(/^(.*?)\s*(?:\((\d+)\))?$/);
    labels.push(canonLine(m[1]));
    if (m[2]) numbers.push(m[2]);
  }
  const digits = labels.map(l => (l.match(/\d+/) || [])[0]).filter(Boolean);
  return { labels, numbers, digits };
}

function matchesTrain(d, info) {
  const l = d.line || {};
  const ln = canonLine(l.name);
  const fn = String(l.fahrtNr || "");
  const lineDigits = ((l.name || "").match(/\d+/) || [])[0];
  return info.labels.includes(ln)
    || info.numbers.includes(fn)
    || info.digits.includes(fn)
    || (lineDigits && info.digits.includes(lineDigits));
}

// ---------- Haltestellennamen vergleichbar machen ----------
// "Hauptbahnhof, Frankfurt a.M." ~ "Frankfurt (Main) Hauptbahnhof" ~ "Frankfurt(Main)Hbf"
function canon(s) {
  return (s || "").toLowerCase()
    .replace(/^\s*(s\+u|s|u)\s+/, "")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\ba\.\s*m\.?|\bam main\b|\ba\.\s*d\.?\s*\w+/g, " ")
    .replace(/hauptbahnhof/g, "hbf")
    .replace(/straße/g, "str").replace(/strasse/g, "str").replace(/str\./g, "str")
    .replace(/[^a-z0-9äöüß]/g, "");
}

function splitName(name) {
  const i = name.lastIndexOf(",");
  if (i < 0) return { core: name, city: "" };
  return { core: name.slice(0, i).trim(), city: name.slice(i + 1).trim() };
}

// Wortvergleich: "Berlin Gesundbrunnen(S)" ~ "S+U Gesundbrunnen Bhf (Berlin)"
const STOPWORDS = new Set(["bhf", "bahnhof", "btf", "betriebshof", "tram", "bus", "pos",
  "und", "der", "die", "das", "den", "am", "an", "im", "in", "bei"]);
function words(s) {
  return (s || "").toLowerCase()
    .replace(/straße|strasse/g, "str").replace(/hauptbahnhof/g, "hbf")
    .split(/[^a-z0-9äöüß]+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w));
}
function wordScore(candidate, name) {
  // Gesucht: Wörter vor dem Komma, ohne Klammerzusätze wie "[Tram Bus ...]" oder "(S)"
  const core = splitName(name).core.replace(/\[[^\]]*\]|\([^)]*\)/g, " ");
  const need = [...new Set(words(core))];
  if (!need.length) return 0;
  const match = (h, w) => h === w || (Math.min(h.length, w.length) >= 4 && (h.startsWith(w) || w.startsWith(h)));
  const have = words(candidate);                                   // inkl. Ort in Klammern
  const haveMain = words(splitName(candidate).core.replace(/\([^)]*\)|\[[^\]]*\]/g, " "));
  const hit = need.filter(w => have.some(h => match(h, w))).length;
  const extra = haveMain.filter(h => !need.some(w => match(h, w))).length; // z. B. "Rhinstr."
  if (hit === need.length) return extra ? 50 : 70;
  if (need.length >= 2 && hit / need.length >= 0.5) return 40;
  return 0;
}

function charScore(candidate, name) {
  const c = canon(candidate);
  const { core, city } = splitName(name);
  const full = canon(name), combo = canon(city + " " + core);
  const cCore = canon(core), cCity = canon(city);
  if (!c || !cCore) return 0;
  if (c === full || c === combo) return 100;
  if (city && c.startsWith(combo)) return 80;
  if (cCity && c.includes(cCore) && c.includes(cCity)) return 60;
  if (!city && c.startsWith(full)) return 60;
  if (c.includes(cCore) || cCore.includes(c)) return 30;
  return 0;
}

// Gesamtbewertung; "(S)"/"(U)" im Navigator-Namen bevorzugt S-/U-Bahn-Stationen
function score(candidate, name) {
  let s = Math.max(charScore(candidate, name), wordScore(candidate, name));
  if (s > 0 && /\(S\)/.test(name) && /^\s*S(\+U)?\s/i.test(candidate || "")) s += 10;
  if (s > 0 && /\(U\)/.test(name) && /^\s*(S\+)?U\s/i.test(candidate || "")) s += 10;
  return s;
}

// Andere Schreibweisen, wahrscheinlichste zuerst
function variants(name) {
  const { core, city } = splitName(name);
  const v = [];
  const isS = /\(S\)/.test(name), isU = /\(U\)/.test(name);
  if (city) {
    const cityShort = clean(city.replace(/\ba\.\s*M\.?/i, "").replace(/\bam Main\b/i, ""));
    const base = clean(core.replace(/\([^)]*\)|\[[^\]]*\]/g, " "));
    if (/a\.\s*M|am Main/i.test(city)) v.push(`${cityShort} (Main) ${core}`);
    v.push(`${cityShort} ${base}`, base);
    if (isS) v.push(`S ${base}`);
    if (isU) v.push(`U ${base}`);
  } else {
    const noBr = clean(name.replace(/\([^)]*\)|\[[^\]]*\]/g, " "));
    const noCity = clean(noBr.replace(/^\S+\s+/, "")); // "Berlin Gesundbrunnen" -> "Gesundbrunnen"
    v.push(clean(name.replace(/\(/g, " (").replace(/\)/g, ") ")), noBr,
           clean(noBr.replace(/\bHbf\b/, "Hauptbahnhof")));
    if (isS) v.push(`S ${noCity}`, `S+U ${noCity}`);
    if (isU) v.push(`U ${noCity}`);
    v.push(noCity);
  }
  return [...new Set(v)].filter(x => x && x !== name);
}

// ---------- Träwelling-API ----------
async function getToken() {
  if (Keychain.contains("trwl_token")) return Keychain.get("trwl_token");
  if (!config.runsInApp) {
    throw new Error("Kein Token gespeichert. Skript einmal direkt in Scriptable starten.");
  }
  const a = new Alert();
  a.title = "Träwelling API-Token";
  a.message = "Einmalig einfügen, wird im iOS-Schlüsselbund gespeichert.";
  a.addSecureTextField("Token");
  a.addAction("Speichern");
  a.addCancelAction("Abbrechen");
  if ((await a.present()) === -1) throw new Error("Abgebrochen.");
  const t = a.textFieldValue(0).trim();
  Keychain.set("trwl_token", t);
  return t;
}

// Begrenzt gleichzeitige Anfragen, damit Träwelling nicht bremst
let active = 0, reqCount = 0, rateLimited = false;
const waiting = [];
async function slot(fn) {
  if (active >= MAX_PARALLEL) await new Promise(res => waiting.push(res));
  active++;
  try { return await fn(); }
  finally { active--; const next = waiting.shift(); if (next) next(); }
}

async function requestOnce(path, token, method, body) {
  return slot(async () => {
    reqCount++;
    const r = new Request(API + path);
    r.method = method;
    r.timeoutInterval = TIMEOUT;
    r.headers = {
      Authorization: "Bearer " + token,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (body) r.body = JSON.stringify(body);
    let json = null;
    try { json = await r.loadJSON(); } catch (e) {}
    const status = r.response ? r.response.statusCode : 0;
    const headers = (r.response && r.response.headers) || {};
    return { status, json, headers };
  });
}

// Anfrage; bei "zu viele Anfragen" (429) kurz warten und erneut versuchen
async function api(path, token, method = "GET", body = null) {
  for (let attempt = 0; ; attempt++) {
    const { status, json, headers } = await requestOnce(path, token, method, body);
    if (status === 401) {
      Keychain.remove("trwl_token");
      throw new Error("Token ungültig. Skript direkt in Scriptable starten und neu eingeben.");
    }
    if (status === 429 && attempt < 3) {
      rateLimited = true;
      const wait = Math.min(10, parseInt(headers["Retry-After"] || headers["retry-after"] || "2", 10) || 2);
      log(`429 bei ${path.split("?")[0]} – warte ${wait}s`);
      await sleep(wait * 1000);
      continue;
    }
    if (status >= 400) log(`HTTP ${status} bei ${method} ${path.split("?")[0]}`);
    return { status, json };
  }
}

async function search(query, token) {
  try {
    const r = await api("/trains/station/autocomplete/" + encodeURIComponent(query), token);
    return (r.json && r.json.data) || [];
  } catch (e) {
    if (/Token/.test(e.message)) throw e;
    return [];
  }
}

// Haltestellen-Kandidaten: erst Cache, dann Originalname; "deep" probiert auch andere Schreibweisen
async function stationCandidates(name, token, deep = false) {
  const out = [];
  const add = (id, nm, s) => { if (!out.some(o => o.id === id)) out.push({ id, name: nm, s }); };
  const hit = cache.stations[name];
  if (hit && !deep) { log(`Cache: ${name} -> ${hit.name}`); add(hit.id, hit.name, 999); return out; }

  const queries = deep ? [name, ...variants(name)] : [name];
  for (const q of queries) {
    for (const st of await search(q, token)) {
      const s = score(st.name, name);
      if (s >= 30) add(st.id, st.name, s);
    }
    if (!deep && out.some(o => o.s >= 60)) break;
  }
  out.sort((a, b) => b.s - a.s);
  log(`Suche${deep ? " (erweitert)" : ""}: ${name} -> ` + out.slice(0, 4).map(o => `${o.name} (${o.s})`).join(", "));
  return out;
}

function rememberStation(name, st) {
  const cur = cache.stations[name];
  if (!cur || cur.id !== st.id) { cache.stations[name] = { id: st.id, name: st.name }; cacheDirty = true; }
}
function forgetStation(name) {
  if (cache.stations[name]) { delete cache.stations[name]; cacheDirty = true; }
}

async function departuresAt(stationId, when, token) {
  const r = await api(`/station/${stationId}/departures?when=${encodeURIComponent(when.toISOString())}`, token);
  return (r.json && r.json.data) || [];
}

// Passende Abfahrten, beste zuerst: richtige Linie, exakte Zeit, passende Richtung
async function findDepartures(leg, startId, token) {
  const list = await departuresAt(startId, new Date(leg.dep.getTime() - 5 * 60000), token).catch(() => []);
  const info = trainInfo(leg.train);
  return list
    .filter(d => matchesTrain(d, info))
    .map(d => {
      const diff = Math.abs(new Date(d.plannedWhen || d.when) - leg.dep) / 60000;
      if (diff > 2) return null;
      const dirOk = score(d.direction || "", leg.direction) >= 30;
      return { d, pts: (dirOk ? 50 : 0) - diff * 10 };
    })
    .filter(Boolean)
    .sort((a, b) => b.pts - a.pts)
    .map(x => x.d);
}

// ---------- Fahrtverlauf ----------
const stopId = st => (st.station && st.station.id) || st.id;
const stopName = st => st.name || (st.station && st.station.name) || "";
const plannedDep = st => st.departurePlanned || st.departure;
const plannedArr = st => st.arrivalPlanned || st.arrival;

// Haltestelle im Fahrtverlauf: Name muss passen, Uhrzeit entscheidet bei Gleichstand
function pickStop(stops, name, time, getTime, after = -1) {
  let best = null;
  stops.forEach((st, i) => {
    if (i <= after) return;
    let s = score(stopName(st), name);
    if (s < 30) return;
    const t = getTime(st);
    if (t) s += Math.max(0, 30 - 3 * Math.abs(new Date(t) - time) / 60000);
    if (!best || s > best.s) best = { st, i, s };
  });
  return best;
}

async function loadTrip(tripId, lineName, startIds, token) {
  for (const sId of [...new Set(startIds.filter(Boolean))]) {
    try {
      const r = await api(`/trains/trip?hafasTripId=${encodeURIComponent(tripId)}` +
        `&lineName=${encodeURIComponent(lineName)}&start=${sId}`, token);
      const trip = r.json && r.json.data;
      if (trip && trip.stopovers && trip.stopovers.length) return trip;
    } catch (e) {
      if (/Token/.test(e.message)) throw e;
    }
  }
  return null;
}

async function post(c, token) {
  const r = await api("/trains/checkin", token, "POST", {
    tripId: c.tripId,
    lineName: c.lineName,
    start: stopId(c.from),
    departure: plannedDep(c.from),
    destination: stopId(c.to),
    arrival: plannedArr(c.to),
    visibility: VISIBILITY,
    business: BUSINESS,
  });
  if (r.status >= 200 && r.status < 300) return null;
  if (r.status === 409) return "Überschneidung mit bestehendem Check-in";
  const msg = r.json && (r.json.message || JSON.stringify(r.json));
  return `Fehler ${r.status} ${msg || ""}`.trim();
}

// ---------- Umstieg bei Nummernwechsel (z. B. HLB: RB41 bis Gießen, dann RB40) ----------
async function findContinuation(leg, dep, a, stops, token) {
  const info = trainInfo(leg.train);
  const lineName = dep.line.name;
  const sameTrain = d => canonLine(d.line && d.line.name) === canonLine(lineName)
    && String(d.line && d.line.fahrtNr) === String(dep.line.fahrtNr);

  const rank = (list, swTime) => list
    .filter(d => !sameTrain(d) && matchesTrain(d, info))
    .map(d => {
      const t = (new Date(d.plannedWhen || d.when) - swTime) / 60000;
      if (t < -2 || t > 30) return null;
      let pts = 0;
      if (info.numbers.includes(String(d.line.fahrtNr))) pts += 1000;
      if (canonLine(d.line.name) !== canonLine(lineName)) pts += 100;
      if (score(d.direction || "", leg.direction) >= 30) pts += 50;
      return { d, pts: pts - Math.abs(t) };
    })
    .filter(Boolean)
    .sort((x, y) => y.pts - x.pts)
    .slice(0, 3);

  const tryAt = async sw => {
    const where = stopName(sw);
    const swTime = new Date(plannedArr(sw));
    const when = new Date(swTime.getTime() - 2 * 60000);
    log(`Umstieg prüfen in ${where}`);

    // Erst nur die Tafel zur ID aus dem Fahrtverlauf; Bahnhofssuche nur als Rückfall
    let ids = [stopId(sw)];
    let ranked = rank(await departuresAt(ids[0], when, token).catch(() => []), swTime);
    if (!ranked.length) {
      const altId = ((await stationCandidates(where, token))[0] || {}).id;
      if (altId && altId !== ids[0]) {
        ids.push(altId);
        ranked = rank(await departuresAt(altId, when, token).catch(() => []), swTime);
      }
    }
    if (!ranked.length) {
      return { why: `in ${where} kein Anschluss gefunden` +
        (rateLimited ? " – Träwelling-Anfragelimit, in 1–2 Minuten nochmal versuchen" : "") };
    }

    let why = "";
    for (const { d: next } of ranked) {
      log(`  Kandidat ${next.line.name} (${next.line.fahrtNr}) Richtung ${next.direction}`);
      const trip2 = await loadTrip(next.tripId, next.line.name, [...ids, next.station && next.station.id], token);
      if (!trip2) { why = `Fahrtverlauf ${next.line.name} ab ${where} nicht ladbar`; continue; }
      const a2 = pickStop(trip2.stopovers, where, new Date(next.plannedWhen || next.when), plannedDep);
      if (!a2) { why = `${where} nicht im Verlauf der ${next.line.name}`; continue; }
      const b2 = pickStop(trip2.stopovers, leg.to, leg.arr, plannedArr, a2.i);
      if (!b2) { why = `${leg.to} nicht im Verlauf der ${next.line.name} (${next.line.fahrtNr})`; continue; }
      return { plan: [
        { tripId: dep.tripId, lineName, from: a.st, to: sw },
        { tripId: next.tripId, lineName: next.line.name, from: a2.st, to: b2.st },
      ] };
    }
    return { why };
  };

  // Umstiegskandidaten: Endhalt zuerst, dann die zwei Halte davor
  const cands = stops.slice(a.i + 1)
    .filter(st => plannedArr(st) && new Date(plannedArr(st)) < leg.arr)
    .slice(-3).reverse();
  if (!cands.length) return null;

  const first = await tryAt(cands[0]);
  if (first.plan) return first.plan;
  for (const sw of cands.slice(1)) {
    const r = await tryAt(sw);
    if (r.plan) return r.plan;
  }
  // Wenigstens bis zum Umstiegspunkt einchecken
  const partial = [{ tripId: dep.tripId, lineName, from: a.st, to: cands[0] }];
  partial.note = `Weiterfahrt ab ${stopName(cands[0])} nicht gefunden – bitte manuell eintragen.`;
  partial.why = first.why;
  return partial;
}

// ---------- Einen Abschnitt komplett bearbeiten ----------
// Mit einer konkreten Abfahrt planen: { plan } oder { err }
async function planWithDeparture(leg, dep, startId, token) {
  const trip = await loadTrip(dep.tripId, dep.line.name, [startId, dep.station && dep.station.id], token);
  if (!trip) return { err: "Fahrtverlauf konnte nicht geladen werden" };
  const stops = trip.stopovers;

  const a = pickStop(stops, leg.from, leg.dep, plannedDep);
  if (!a) return { err: `Start ${leg.from} nicht im Fahrtverlauf` };

  // Normalfall
  const b = pickStop(stops, leg.to, leg.arr, plannedArr, a.i);
  if (b) return { plan: [{ tripId: dep.tripId, lineName: dep.line.name, from: a.st, to: b.st }] };

  // In den Daten verknüpfte Anschlussfahrt
  const cont = trip.continuationTrip;
  if (cont && cont.stopovers && cont.stopovers.length) {
    const cs = cont.stopovers;
    const last = stops[stops.length - 1];
    const ci = cs.findIndex(st => canon(stopName(st)) === canon(stopName(last)));
    const b2 = pickStop(cs, leg.to, leg.arr, plannedArr, ci);
    if (b2) return { plan: [
      { tripId: dep.tripId, lineName: dep.line.name, from: a.st, to: last },
      { tripId: cont.tripId || cont.hafasTripId || cont.id,
        lineName: cont.lineName || (cont.line && cont.line.name) || dep.line.name,
        from: cs[ci >= 0 ? ci : 0], to: b2.st },
    ] };
  }

  // Nummernwechsel als getrennte Fahrten
  if (trainInfo(leg.train).labels.length > 1) {
    const plan = await findContinuation(leg, dep, a, stops, token);
    if (plan) return { plan };
  }
  log(`  ${dep.line.name} Richtung ${dep.direction}: Ziel nicht im Verlauf (${stops.map(stopName).slice(a.i, a.i + 8).join(" – ")} …)`);
  return { err: `Ziel ${leg.to} nicht im Fahrtverlauf` };
}

async function planLeg(leg, token) {
  const tried = new Set();
  let lastErr = `nicht in der Abfahrtstafel ab ${leg.from} gefunden`;
  for (const deep of [false, true]) {
    const stations = (await stationCandidates(leg.from, token, deep))
      .filter(st => !tried.has(st.id)).slice(0, 3);
    for (const st of stations) {
      tried.add(st.id);
      const deps = await findDepartures(leg, st.id, token);
      log(`${leg.train} ab ${st.name}: ${deps.length} passende Abfahrt(en)`);
      for (const dep of deps.slice(0, 3)) {
        const r = await planWithDeparture(leg, dep, st.id, token)
          .catch(e => { if (/Token/.test(e.message)) throw e; return { err: e.message }; });
        if (r.plan) { rememberStation(leg.from, st); return r.plan; }
        lastErr = r.err;
      }
    }
  }
  forgetStation(leg.from);
  throw new Error(lastErr);
}

async function runLeg(leg, token) {
  const label = `${leg.from} → ${leg.to}`;
  try {
    const plan = await planLeg(leg, token);
    for (const c of plan) {
      const err = await post(c, token);
      if (err) throw new Error(plan.length > 1 ? `${c.lineName} ab ${stopName(c.from)}: ${err}` : err);
    }
    const detail = plan.length > 1 || plan.note
      ? plan.map(c => `${c.lineName}: ${stopName(c.from)} → ${stopName(c.to)}`).join("\n")
      : label;
    if (plan.note) return { title: `⚠️ ${leg.train}`, body: `Grund: ${plan.why}\n${detail}\n${plan.note}` };
    return NOTIFY_SUCCESS ? { title: `✅ ${leg.train}`, body: detail } : null;
  } catch (e) {
    log(`Fehler ${leg.train}: ${e.message}`);
    return { title: `❌ ${leg.train}`, body: `${label}\n${e.message}` };
  }
}

// ---------- Übergabedatei vom Kurzbefehl lesen (funktioniert auch im Hintergrund) ----------
async function readInputFile() {
  const fms = [];
  try { fms.push(FileManager.iCloud()); } catch (e) {}
  fms.push(FileManager.local());
  for (const fm of fms) {
    const p = fm.joinPath(fm.documentsDirectory(), "trwl_input.txt");
    if (!fm.fileExists(p)) continue;
    try { await fm.downloadFileFromiCloud(p); } catch (e) {}
    const t = fm.readString(p) || "";
    fm.remove(p);
    return t;
  }
  return "";
}

// ---------- Ablauf ----------
async function main() {
  const parts = [];
  const sp = args.shortcutParameter;
  if (typeof sp === "string") parts.push(sp);
  else if (Array.isArray(sp)) parts.push(...sp.map(String));
  if (args.plainTexts) parts.push(...args.plainTexts);
  const input = parts.join("\n") || (await readInputFile()) || Pasteboard.paste() || "";

  const legs = parse(input);
  if (!legs.length) throw new Error("Keine Züge im Text erkannt.");
  const [token] = await Promise.all([getToken(), loadCache()]);

  // Jeder Abschnitt läuft komplett für sich (suchen -> Fahrtverlauf -> einchecken),
  // alle Abschnitte gleichzeitig. Mitteilungen kommen in der Reihenfolge der Reise.
  const results = legs.map(leg => runLeg(leg, token));
  for (const r of results) {
    const msg = await r;
    if (msg) await notify(msg.title, msg.body);
  }
  saveCache();
  log(`Fertig: ${reqCount} Anfragen`);
}

try {
  await main();
} catch (e) {
  log("Fehler: " + e.message);
  await notify(`Träwelling: Fehler (${VERSION})`, e.message);
}
saveCache();
writeLog();
Script.complete();
