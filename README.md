# Träwelling-Import aus dem DB Navigator

Ein Skript für die iOS-App [Scriptable](https://scriptable.app), das eine im **DB Navigator** geteilte Reise automatisch bei [Träwelling](https://traewelling.de) eincheckt – Abschnitt für Abschnitt, ohne Rückfrage.

**Was es kann (v26):**

- **Eine Mitteilung pro Reise:** Strecke, Dauer, Kilometer und Träwelling-Punkte, dazu jeder Abschnitt als eigene Zeile (✅ eingecheckt, ⚠️ teilweise, ❌ Fehler). Fahren andere Träwelling-Nutzer im selben Zug mit, steht das auch drin.
- **Antippen öffnet Träwelling:** Nach dem Check-in kommst du direkt zu deiner Reise oder, wenn etwas fehlt, zum Dashboard zum Nachtragen.
- **Zwischenstand:** Dauert es länger als ein paar Sekunden, kommt vorab eine ⏳-Mitteilung. Antippen öffnet Scriptable, und der Rest wird eingecheckt.
- **Lernt deine Strecken:** Haltestellen und Teilstrecken, die du schon gefahren bist, merkt sich das Skript. Wiederholte Fahrten gehen dadurch deutlich schneller.
- **Robust:** Nummernwechsel (z. B. RB41 → RB40), verschiedene Schreibweisen von Haltestellen, Anfragelimits und iOS-Pausen im Hintergrund werden abgefangen.

Getestet in **Frankfurt, Gießen, Dresden und Berlin** mit Fernverkehr, Regionalzügen (auch mit Nummernwechsel wie RB41 → RB40), S-Bahn, U-Bahn, Tram und Bus.

> Inoffizielles Projekt. Nicht verbunden mit der Deutschen Bahn oder Träwelling.

## Was du brauchst

- iPhone oder iPad mit der App **Scriptable** (kostenlos im App Store)
- die App **Kurzbefehle** (vorinstalliert)
- die App **DB Navigator**
- einen Account bei **Träwelling** und einen API-Token (siehe unten)

## 1. Träwelling-API-Token erstellen

1. Auf [traewelling.de](https://traewelling.de) einloggen.
2. **Einstellungen → Deine Anwendungen** öffnen ([direkter Link](https://traewelling.de/settings/applications)).
3. Unten im Kasten **Dein AccessToken** auf **Token generieren** tippen.
4. Den Token **sofort kopieren** und nirgends sonst speichern.

Der Token ist wie ein Passwort: Wer ihn hat, kann in deinem Namen einchecken. Teile ihn nicht und lade ihn nirgends hoch. Träwelling selbst fragt dich nie danach. Wenn er doch einmal in falsche Hände gerät, erzeugst du mit *Token generieren* einen neuen und gibst ihn im Skript neu ein.

> Träwelling empfiehlt persönliche Access Tokens eigentlich für Debugging-Zwecke, für feste Integrationen eine OAuth-Anwendung. Für dieses Skript, das nur auf deinen eigenen Account zugreift, ist der persönliche Token der einfachste Weg.

## 2. Skript in Scriptable anlegen

1. Scriptable öffnen, oben rechts **+** tippen.
2. Den gesamten Inhalt von [`traewelling-import.js`](traewelling-import.js) einfügen.
3. Das Skript oben benennen, z. B. **Träwelling Check-in**.
4. Das Skript **einmal direkt in Scriptable starten** (▶︎). Es fragt nach dem Token – einfügen, *Speichern* tippen.
   Der Token landet im iOS-Schlüsselbund, nicht im Skript. (Die erste Fehlermeldung „Kein Datum im Text gefunden“ ist dabei normal.)
5. Mitteilungen für Scriptable erlauben, wenn iOS fragt.

## 3. Kurzbefehl einrichten

Der Kurzbefehl übergibt den Reisetext an das Skript, sodass alles aus dem Teilen-Menü des DB Navigators heraus funktioniert – auch im Hintergrund.

### Schnell: fertigen Kurzbefehl laden

➡️ **[Kurzbefehl „Träwelling check in v15“ hinzufügen](https://www.icloud.com/shortcuts/d4c787d179724c969820468b65497f87)**

Nach dem Import einmal in den Kurzbefehl schauen und prüfen:

- **Datei sichern:** Ordner ist **iCloud Drive → Scriptable** (bei Bedarf neu auswählen, der Ordner lässt sich nicht immer mitteilen), Unterpfad `trwl_input.txt`, *Überschreiben* an.
- **Skript ausführen:** Hier muss genau der Name stehen, den du deinem Skript in Scriptable gegeben hast. Sonst das Skript neu auswählen.
- **In App ausführen:** siehe Hinweis unten.

### Oder: selbst bauen

1. App **Kurzbefehle** öffnen → **+** → neuen Kurzbefehl anlegen, Name z. B. **Träwelling**.
2. Oben auf **ⓘ** (Details) tippen → **Im Share-Sheet anzeigen** einschalten. Als Eingabe **Text** (und **URLs**) zulassen.
3. Aktion **Text** hinzufügen und als Inhalt die Variable **Kurzbefehleingabe** einsetzen.
4. Aktion **Datei sichern** hinzufügen:
   - Eingabe: das Ergebnis aus Schritt 3 (*Text*)
   - **Speicherort erfragen: aus**
   - Ordner: **iCloud Drive → Scriptable**
   - Unterpfad: `trwl_input.txt`
   - **Überschreiben, falls vorhanden: an**
5. Aktion **Skript ausführen** (von Scriptable) hinzufügen:
   - Skript: **Träwelling Check-in**
   - **In App ausführen:** siehe Hinweis unten
6. Fertig.

> **Hinweis: „In App ausführen“ für mehr Stabilität**
> Standardmäßig ist *In App ausführen* aus. Dann läuft das Skript im Hintergrund, ohne dass sich Scriptable öffnet. iOS gibt Hintergrund-Skripten aber nur wenig Zeit. Bei langen Reisen oder langsamem Netz kann das Skript deshalb abbrechen, oder die Mitteilung kommt erst, wenn du Scriptable öffnest.
> Wenn es sicherer und stabiler laufen soll, schalte **In App ausführen: an**. Scriptable öffnet sich dann kurz, und das Skript hat so viel Zeit, wie es braucht.

Ohne iCloud Drive: Im Schritt 4 den lokalen Scriptable-Ordner („Auf meinem iPhone → Scriptable“) wählen. Das Skript sucht an beiden Stellen.

## 4. Benutzen

1. Im DB Navigator die Reise öffnen → **Teilen** → **Träwelling** (den Kurzbefehl) wählen.
2. Nach ein paar Sekunden kommt eine Mitteilung mit allen Abschnitten. Antippen öffnet die Reise auf Träwelling.
3. Klappt etwas nicht, steht im Titel, welcher Abschnitt fehlt, und bei der betroffenen Zeile der Grund. Antippen führt zum Nachtragen auf Träwelling.
4. Kommt stattdessen **„⏳ Fast fertig – tippen zum Abschließen“**, hat iOS das Skript im Hintergrund angehalten. Einfach antippen: Scriptable öffnet sich und checkt den Rest ein.

Alternativ: Reisetext kopieren und das Skript direkt in Scriptable starten – es liest dann die Zwischenablage.

## Einstellungen

Ganz oben im Skript:

| Einstellung | Bedeutung |
|---|---|
| `VISIBILITY` | 0 = öffentlich, 1 = ungelistet, 2 = nur Follower, 3 = privat |
| `BUSINESS` | 0 = privat, 1 = geschäftlich, 2 = Pendeln |
| `NOTIFY_SUCCESS` | `false` = Mitteilung nur, wenn etwas nicht geklappt hat |
| `TIMEOUT` | Sekunden pro Anfrage |
| `MAX_PARALLEL` | höchstens so viele Anfragen gleichzeitig |
| `TIME_BUDGET` | Sekunden, nach denen keine weiteren Ausweich-Versuche mehr gestartet werden |
| `PROGRESS_AFTER` | Sekunden, nach denen ein ⏳-Zwischenstand kommt, falls noch nicht alles fertig ist |

## Dateien, die das Skript anlegt

- `trwl_log.txt` – Protokoll des letzten Laufs (hilft bei der Fehlersuche), im Scriptable-Ordner in iCloud Drive
- `trwl_cache.json` – gemerkte Haltestellen und Strecken. Liegt **lokal auf dem iPhone** („Auf meinem iPhone → Scriptable“), weil iCloud zu langsam synchronisiert. Ein älterer Speicher aus iCloud wird beim ersten Start einmalig übernommen.
- `trwl_input.txt` – Übergabe vom Kurzbefehl, wird nach dem Lesen gelöscht

Diese Dateien enthalten deine Reisen und gehören **nicht** in ein Repository (sie stehen in der `.gitignore`).

## Häufige Probleme

- **„Token ungültig“** – Token in Träwelling neu erstellen und das Skript einmal direkt in Scriptable starten.
- **„Überschneidung mit bestehendem Check-in“** – Es gibt für diese Zeit schon einen Check-in. In Träwelling löschen und erneut versuchen.
- **„Träwelling-Anfragelimit“** – 1–2 Minuten warten und nochmal starten.
- **„⏳ Fast fertig“ oder Abbruch im Hintergrund** – Mitteilung antippen, dann läuft der Rest in Scriptable weiter. Passiert das oft, im Kurzbefehl bei *Skript ausführen* die Option **In App ausführen** einschalten.
- **Skript schlägt nach einer Streckenänderung fehl** – Den gemerkten Speicher zurücksetzen: `trwl_cache.json` unter „Auf meinem iPhone → Scriptable“ löschen.
- **Falsche Haltestelle** – In `trwl_log.txt` steht, welche Haltestellen gefunden wurden. Gerne als Issue melden (ohne persönliche Daten).
- **Zeit weicht um ein paar Minuten ab** – Das kommt aus den Fahrplandaten von Träwelling, nicht aus dem Skript.

## Lizenz

[MIT](LICENSE)
