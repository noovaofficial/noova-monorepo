# Datenschutzerklärung — черновик

> **ЧЕРНОВИК. НЕ ПУБЛИКОВАТЬ БЕЗ ПРОВЕРКИ ЮРИСТОМ.**
> В отличие от Impressum, здесь большая часть текста — не выдумка и не
> шаблон, а прямое описание того, что код действительно делает: сроки
> хранения, что именно снимается с фото, кто получает данные. Я собрал это
> из `apps/api/src/env.ts`, `apps/api/src/jobs/retention.ts`,
> `apps/api/src/modules/verification/service.ts` и
> `documentation/planning/legal.md`. Расхождение между этим текстом и
> реальным поведением сервиса опаснее отсутствия текста вовсе — это то,
> за что штрафуют в первую очередь. Юрист должен свериться с кодом, а не
> только со стилем формулировок.
>
> **Открытые вопросы, требующие решения до публикации:**
> - **Место хостинга (L-09).** Ниже я написал раздел о хостинге как
>   плейсхолдер — я не знаю, стоят ли серверы в ЕС. Если нет, нужен раздел
>   о передаче данных в третью страну (гл. V GDPR) и, возможно, отдельные
>   договорные меры.
> - **Ответственный за защиту данных (DPO).** Обязателен, если выполняются
>   пороги ст. 37 GDPR (в т.ч. систематическая обработка данных особой
>   категории в существенном масштабе — а профили здесь как раз особая
>   категория). Нужно решение юриста, назначать ли DPO.
> - **Юрлицо и адрес** — те же плейсхолдеры, что и в Impressum.

---

## Datenschutzerklärung

### 1. Verantwortlicher

[Firmenname, Anschrift — siehe Impressum]
E-Mail: support@noova.cc

### 2. Datenschutzbeauftragter

[Falls nach Art. 37 DSGVO erforderlich: Name und Kontakt des
Datenschutzbeauftragten. Falls nicht bestellt, diesen Abschnitt entfernen —
nicht als „entfällt" stehen lassen, das liest sich wie eine unbeantwortete
Pflichtangabe.]

### 3. Besondere Kategorien personenbezogener Daten

Profile auf dieser Plattform enthalten Angaben, die Rückschlüsse auf das
Sexualleben oder die sexuelle Orientierung zulassen und damit unter
Art. 9 DSGVO fallen. Die Verarbeitung stützt sich auf [Rechtsgrundlage mit
Anwalt festlegen — in Betracht kommt insbesondere die ausdrückliche
Einwilligung der anzeigenschaltenden Person nach Art. 9 Abs. 2 lit. a
DSGVO, da sie die Angaben selbst und freiwillig veröffentlicht].

### 4. Altersverifikation

Der Zugang zur Plattform setzt eine Bestätigung der Volljährigkeit voraus
(Altersabfrage beim ersten Besuch). [Bitte mit Anwalt klären, ob eine reine
Selbstauskunft ohne technische Altersverifikation für diese Art von
Inhalten ausreicht oder ob ein strengeres Verfahren erforderlich ist.]

### 5. Registrierung und Nutzerkonto

Bei der Registrierung erheben wir E-Mail-Adresse, ein Passwort (nur als
Hash gespeichert, im Klartext nicht einsehbar) und die gewählte Rolle
(Suchende Person / Inserierende Person). Inserierende Personen geben
zusätzlich Anzeigedaten an (siehe Ziff. 6).

### 6. Anzeigen (Profile)

**Fotos.** Beim Hochladen werden Metadaten (EXIF, einschließlich etwaiger
GPS-Koordinaten des Aufnahmeorts) automatisch entfernt, bevor das Bild
gespeichert wird. Fotos durchlaufen vor Veröffentlichung eine manuelle
Prüfung; bis zur Freigabe sind sie ausschließlich für die hochladende
Person und die Moderation einsehbar. Veröffentlichte Fotos erhalten ein
sichtbares Wasserzeichen.

**Standort.** Der in der Anzeige angezeigte Standort wird auf ein Raster
von ca. 1 km gerundet; die tatsächliche Adresse wird nicht gespeichert und
nicht veröffentlicht.

**Kontaktdaten.** Kontaktangaben werden nicht in den öffentlich
ausgelieferten Seiteninhalt eingebettet, sondern erst auf gesonderte
Anfrage der suchenden Person ausgeliefert.

### 7. Verifizierung von Alter und Identität

[Hinweis für den Juristen — Stand laut `legal.md` Punkt L-02: Aktuell
werden nur Anzeigen veröffentlicht, für die eine Partneragentur die
Prüfung vorgenommen hat; ein „Verifiziert“-Abzeichen bedeutet derzeit eine
Moderationsentscheidung, nicht die Aufbewahrung eines geprüften Dokuments
durch uns selbst. Sobald Selbstregistrierung mit eigener Dokumentenprüfung
eingeführt wird, gilt zusätzlich:] Zur Prüfung eingereichte Dokumente
(Ausweisfoto, Gesichtsfoto, Kombinationsfoto) werden nach Abschluss der
Prüfung noch bis zu 30 Tage aufbewahrt und danach automatisiert und
unwiderruflich gelöscht; erhalten bleibt lediglich der Umstand und das
Datum der Entscheidung, nicht die Dokumente selbst.

### 8. Zahlungen und GlowCoin

Bezahlte Leistungen (Schaltung und Verlängerung von Anzeigen) werden über
ein internes Guthaben namens GlowCoin abgewickelt. Der Kauf von GlowCoin
erfolgt über den Zahlungsdienstleister Paymento per Kryptowährung; dabei
werden die für die Zahlungsabwicklung erforderlichen Daten an Paymento
übermittelt. Wir selbst verarbeiten keine vollständigen Zahlungsdaten
(z. B. Wallet-Zugangsdaten) — diese verbleiben beim Zahlungsdienstleister.

### 9. Cookies und lokale Speicherung

Wir setzen folgende Cookies ein:

| Cookie | Zweck | Typ |
|---|---|---|
| Sitzungscookie | hält die Anmeldung aufrecht (httpOnly, nicht per JavaScript auslesbar) | technisch notwendig |
| Anmeldestatus / Rolle | steuert, welche Oberfläche angezeigt wird (kein Sicherheitsmerkmal) | technisch notwendig |
| Altersbestätigung | merkt die Bestätigung der Volljährigkeit | technisch notwendig |
| Sprache, Darstellung (hell/dunkel) | merkt Nutzereinstellungen | technisch notwendig |

Es werden keine Tracking- oder Werbecookies Dritter eingesetzt. [Mit
Anwalt abgleichen, sobald Analyse- oder Marketing-Tools hinzukommen —
dann wird ein Consent-Banner nach TTDSG erforderlich.]

### 10. Landkarten (OpenStreetMap)

Kartenkacheln werden über einen eigenen Server bezogen und nicht direkt
vom Kartenanbieter geladen — die IP-Adresse der besuchenden Person wird
dadurch nicht an den Kartenanbieter übermittelt.

### 11. Protokolldaten

IP-Adressen werden in Protokollen ausschließlich in gehashter,
nicht umkehrbarer Form gespeichert.

### 12. Empfänger von Daten (Auftragsverarbeiter)

- Objektspeicher für Fotos [Anbieter/Standort ergänzen]
- Hosting-Infrastruktur [Anbieter/Standort ergänzen — siehe offene Frage
  zum Serverstandort oben]
- Zahlungsdienstleister Paymento (siehe Ziff. 8)
- Versand von Systemmails (Bestätigungs-, Zurücksetz-E-Mails)
  [Anbieter ergänzen]

Mit allen genannten Empfängern bestehen bzw. sind Auftragsverarbeitungs-
verträge nach Art. 28 DSGVO abzuschließen. [Von Entwicklerseite technisch
umgesetzt; das Vertragswerk selbst ist Aufgabe der Rechtsabteilung.]

### 13. Speicherdauer

| Datenart | Dauer |
|---|---|
| Zurücksetz-/Bestätigungslinks | 7 Tage nach Ablauf bzw. Nutzung |
| Prüfungsdokumente (Ausweis, Fotos zur Altersprüfung) | bis zu 30 Tage nach Abschluss der Prüfung |
| Gelöschte, nicht mehr benötigte Fotos | bis zu 30 Tage |
| Statistikdaten zu Anzeigenaufrufen | bis zu 365 Tage |
| Moderationsentscheidungen (Protokoll) | bis zu 365 Tage |
| Kontolöschung | 14 Tage Bedenkzeit ab Antrag, danach unwiderrufliche Löschung von Anzeigen, Fotos (inkl. Dateien), Kommentaren und Favoriten |

Nach Ablauf der 14-tägigen Bedenkzeit werden Konto, Anzeigen und Fotos
(einschließlich der Dateien im Objektspeicher) unwiderruflich gelöscht.
Ausgenommen bleiben Einträge im Moderationsprotokoll (ohne Bezug zur
gelöschten Person, siehe oben) und abgeschlossene Zahlungsvorgänge, soweit
handels- oder steuerrechtliche Aufbewahrungspflichten entgegenstehen.

### 14. Rechte der betroffenen Person

Sie haben das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16),
Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18),
Datenübertragbarkeit (Art. 20) und Widerspruch (Art. 21) sowie das Recht,
sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren (Art. 77).

Eine Kontolöschung kann jederzeit im eigenen Kontobereich veranlasst
werden.

### 15. Kontakt für Datenschutzanfragen

E-Mail: support@noova.cc
