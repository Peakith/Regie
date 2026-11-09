# Fase 1: oplevering

Datum: 9 november 2026 · Opleverniveau: **werkende lokale pilot-basis**. Niet online, niet voor dagelijks gebruik.

## 1. Wat werkt (gebruikershandelingen)

- Inloggen met e-mail en wachtwoord (lokaal). Eenmalig de organisatie inrichten; de eerste gebruiker wordt eigenaar.
- Interne gebruiker toevoegen met een rol en toegang intrekken. De toegang vervalt direct, ook bij een openstaande sessie.
- **Personen** zonder account (crew, editors, freelancers) met vakrollen. Contactgegevens staan apart en zijn afgeschermd. Bij een gelijke naam of e-mail krijg je een waarschuwing; er wordt niets automatisch samengevoegd.
- **Project aanmaken** met bedrijfslabel, registerjaar, handmatig projectnummer (of als concept zonder nummer), klant, verantwoordelijke en briefing. Er is ook een "eenvoudig project" met alleen taken.
- **Nummerregister:** uniek binnen de hele organisatie, ongeacht hoofdletters en spaties. Een nummer wordt nooit hergebruikt, ook niet na annuleren of archiveren. Correctie kan alleen door eigenaar of admin, met reden; het oude nummer blijft als alias bestaan.
- **Projectenoverzicht:**
  - Kolommen: nummer, project, klant, bedrijf, status, editors (afgeleid), aantal "zonder editor", crew, volgende draaidag, eerstvolgende deadline (verlopen is gemarkeerd) en geleverd/totaal.
  - Filters op bedrijf, status (inclusief "alle statussen, inclusief archief") en registerjaar; zoeken op nummer, naam of klant.
- **Deliverables:**
  - Specificaties (onbekend mag leeg blijven), varianten van een basisproduct, scope en editor-toewijzing (optie of bevestigd).
  - Versies (v1, v2, … met link). De vereiste opleverversie maak je expliciet.
  - Klantakkoord registreer je op precies één versie, met naam, datum en bewijs ("geregistreerd door medewerker"). Een akkoord intrekken vraagt een reden. Daarna markeer je de deliverable als geleverd.
- **Draaidagen:** datum, tijden, locatie, status (annuleren vraagt een reden), crew-inzet (optie of bevestigd) en notities voor callsheet en apparatuur. "Uitgevoerd" en "back-up bevestigd" worden vastgelegd met naam en tijdstip.
- **Taken:** verantwoordelijke, deadline, status, subtaken (cirkels zijn onmogelijk), koppeling aan een deliverable en de vlag "verplicht voor afsluiten".
- **Afronden:**
  - Je ziet een lijst met concrete blokkades, met per blokkade het object dat de oorzaak is, plus waarschuwingen.
  - Operationeel afsluiten kan pas als er geen blokkades meer zijn. Pauzeren, annuleren en heropenen vragen een reden.
  - De administratieve afronding (factuur, betaling, freelancers, overig) staat apart.
- **Beheer:** projecttoegang per gebruiker, nummer registreren of corrigeren, archiveren en wijzigingshistorie (audit).
- **Gelijktijdig bewerken:** iedere wijziging controleert de revisie. Bij een conflict ziet de tweede bewerker een melding en blijven diens wijzigingen in het formulier staan. Er wordt nooit stil overschreven.
- De interface is volledig Nederlands, met het Regie-logo, licht en donker thema, en een mobiele weergave (tabellen worden kaarten).

## 2. Wat echt is opgeslagen en wat voorbeelddata is

- Alles staat in een echte Postgres-database (lokale Supabase) met echte inlog en rechten op databaseniveau (RLS). Er is geen nep- of voorbeelddata in de app.
- Testdata leeft in een organisatie met `is_test = true`, gescheiden van echte data, en wordt na de tests verwijderd.
- **Versies zijn links, geen uploads.** Private bestandsopslag volgt in fase 3.

## 3. Wat getest is

**Integratietests** (`npm test`, 24 tests, allemaal geslaagd). Ze draaien als echte gebruikers via de API, zonder mocks.

| Proef (masterprompt §14) | Wat de test aantoont |
|---|---|
| 1 | SB26130-reconstructie: 6 deliverables, 1 draaidag, freelancer zonder account; er wordt geen account aangemaakt |
| 2 | Twee editors zichtbaar in het overzicht, "4 zonder editor", crew afgeleid; geen handmatig editorveld |
| 4 | Twee gelijktijdige registraties van hetzelfde nummer: precies één slaagt, de ander krijgt een begrijpelijke fout |
| 4 | `sb 26130` met andere hoofdletters of spaties wordt geweigerd |
| 5 | Nummer blijft gereserveerd na annuleren en archiveren; het project blijft vindbaar |
| — | Correctie: oud nummer wordt alias, blijft geblokkeerd, en de reden staat in de audit. Concept zonder nummer, nummer later instellen |
| 7 | Persoonlijke taak zonder project is alleen zichtbaar voor de maker |
| 8 | Een taak afvinken sluit niets af |
| 10 | Akkoord op v2; v3 vereist maken zet de status terug naar review; v3 heeft geen akkoord; historie van v2 blijft; een oudere versie goedkeuren wordt geweigerd |
| 10 | Status "goedgekeurd" rechtstreeks zetten via de API wordt geweigerd |
| 11 | Afsluiten wordt geblokkeerd met concrete redenen. De levenscyclus rechtstreeks via de API wijzigen wordt geweigerd. Een leeg filmproject sluit niet |
| 12 | Afsluiten lukt zodra alles klaar is; administratie blijft apart ("niet beoordeeld"). "Afgerond" zonder alle vinkjes wordt geweigerd |
| 15 | Niet ingelogd: geen data en geen functies. Stagiair zonder projectlidmaatschap ziet niets, ook niet via een directe ID |
| 15 | Stagiair als projectlid: alleen eigen toegewezen taken, alleen status wijzigen; geen akkoord, geen afsluiten, geen leden toevoegen, geen contactgegevens, geen audit |
| 15 | Medewerker ziet alleen projecten met projectlidmaatschap |
| 15 | Account uit een andere organisatie ziet niets |
| 18 | Ingetrokken lid verliest direct toegang, ook met een bestaande sessie |
| 20 | Tweede schrijver op een oude revisie: 0 rijen gewijzigd, de eerste wijziging blijft staan |
| — | Subtaken kunnen geen cirkel vormen |

**Zelfcontrole van de tests:** ik heb tijdelijk één rechtenregel verzwakt (stagiair en medewerker zien alle projecten). Twee tests faalden zoals verwacht; daarna is de database hersteld.

**Browsertest (Playwright, Chromium):** de volledige flow doorlopen:
- account aanmaken → inrichten → personen → project met nummer en nieuwe klant
- deliverables → editor → versie → akkoord → geleverd
- draaidag → crew → uitgevoerd → back-up
- verplichte afsluittaak → afronden toont de blokkades
- overzicht op desktop en op een smal scherm (390 px)

Geen JavaScript-fouten. Dit script staat niet in de repository.

## 4. Wat niet getest is

- Echte iPhone, Android en Safari: alleen Chromium-emulatie.
- Toetsenbordbediening alleen steekproefsgewijs: labels en focus zijn aanwezig, maar er is geen volledige audit gedaan.
- Mailbezorging: er wordt niets verstuurd (lokaal zonder bevestigingsmails).
- Online hosting en back-ups: bestaan nog niet.

## 5. Open punten en gevolgen

- **Alleen lokaal:** gegevens staan op je eigen Mac, zonder back-up. Gebruik het voor proefprojecten, nog niet als enige bron.
- **Accounts toevoegen gaat lokaal via zelf aanmaken + toevoegen.** Echte uitnodigingen volgen in fase 3.
- Bewust **niet** in fase 1 (volgt in fase 2): overlapcontrole voor dezelfde persoon op meerdere projecten, persoonlijke inbox en losse lijsten in de interface, agenda, templates, datumverschuiving, faseadvies en handmatige fasecorrectie.
- **Fase automatisch laten doorschuiven** (jouw wens): in fase 2 bouw ik eerst het berekende faseadvies. Automatisch doorzetten kan daarna, zodra de regels in echte projecten kloppen.
- Kosten: €0 (alles lokaal).

## 6. Gewijzigde bestanden, starten en terugrollen

- `supabase/migrations/20261109000001_fase1_kern.sql`: datamodel, RLS, triggers en serverfuncties.
- `src/**`: webapp. `tests/**`: integratietests. `scripts/schrijf-env-lokaal.mjs`: schrijft `.env.local` met alleen de publieke sleutel.
- Starten: zie de README.
- **Terugrollen:** dit is de eerste versie, dus er is niets om naar terug te gaan. Voor een lokale schone start: `npm run db:reset` (**wist lokale gegevens**). Toekomstige migraties zijn uitbreidend; een schema-wijziging draai je niet terug door alleen de frontend terug te zetten.

## Rechten zoals gebouwd (fase 1, intern)

| Rol | Ziet | Mag |
|---|---|---|
| Eigenaar | Alles in de organisatie | Alles, inclusief leden, nummercorrectie, administratie en audit |
| Admin | Alles in de werkruimte | Als eigenaar, maar kan geen eigenaar of admin aanwijzen of intrekken |
| Projectmanager | Projecten met projectlidmaatschap | Projecten aanmaken, inhoud bewerken, akkoord registreren, leveren, afsluiten en heropenen |
| Medewerker | Projecten met projectlidmaatschap | Inhoud bewerken (deliverables, versies, draaidagen, inzet, taken); geen akkoord, geen afsluiten |
| Stagiair | Projecten met projectlidmaatschap: projectcontext, plus alleen eigen toegewezen of zelf gemaakte taken | Status van die taken wijzigen; eigen taken aanmaken. Geen contactgegevens |
| Freelancer, klant | Niets (portaal volgt in fase 3) | — |

De rechten worden afgedwongen in de database (RLS-policies, triggers op beschermde velden en security-definer-functies met rolcontrole), niet alleen in de interface.
