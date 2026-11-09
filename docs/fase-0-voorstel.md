# Regie — Fase 0: inspectie, scope- en architectuurvoorstel

Datum: 9 november 2026 · Status: **ter bevestiging door Lars** · Opleverniveau: *document*, geen software.

> Er is in fase 0 bewust geen applicatiecode geschreven en er zijn geen (betaalde) diensten aangemaakt.

---

## 1. Wat ik heb geïnspecteerd

| Onderdeel | Bevinding |
|---|---|
| Repository `peakith/regie` | Leeg: geen commits, geen README, geen code, geen lockfile, geen schema, geen deploymentconfiguratie, geen tests. Er is dus geen bestaande architectuur om te respecteren. |
| Branch | `claude/adoring-ritchie-n5n6r4` (eerste commit volgt met deze documenten). |
| Bouwomgeving (cloudsessie) | Node 22.23, npm 10.9, `psql` en `docker` aanwezig. Supabase CLI niet geïnstalleerd (kan als dev-dependency via npm). Lokaal draaien van Postgres + Supabase-stack voor tests is daarmee in principe mogelijk. |
| Netwerk in deze sessie | `supabase.com`, `resend.com` en `developers.cloudflare.com` waren **niet bereikbaar**. Ik heb de prijzen en limieten daarom **niet opnieuw kunnen controleren**; onderstaande cijfers komen uit de broncontrole in de masterprompt (9 nov. 2026) en zijn gelabeld als *niet opnieuw geverifieerd*. |
| Bruto en de reviewtool | Code en documentatie niet beschikbaar. Ik neem geen API, webhook, gedeelde login of databasecompatibiliteit aan. Geen afhankelijkheid voor de pilot. |
| Asana (screenshots) | Secties Eisen, Deal, Pre-productie, Productie, Post productie, Afsluiten productie, Losse taken; kolommen Assignee, Due date, Opmerkingen, FASE. Gebruikt als vertrekpunt, niet als 1-op-1 datamodel. Subtaken zijn niet zichtbaar en worden niet verzonnen. |
| Logo | Beeldmerk “R” en woordmerk “Regie”, zwart op transparant (PNG 624×624 en 1448×588). Opgeslagen in `assets/brand/`. Voor donkere weergave maken we een witte variant door inkleuring, niet door een nieuw ontwerp. |

**Productnaam:** de aangeleverde logo's maken **Regie** de productnaam (vervangt de werknaam “Projecten”). Geen logo, huisstijl of merktaal van Studio Brutaal of Moviemates.

---

## 2. Scopevoorstel eerste versie (pilot)

Ik neem de scope uit de masterprompt (sectie 3, punten 1–11) over **zonder uitbreiding**. In één zin: één gedeelde werkruimte met bedrijfslabel, handmatig projectnummerregister, projectoverzicht en projectpagina, personen los van accounts, taken/inbox/losse lijsten, deliverables met versies en akkoord per versie, draaidagen en inzet met overlapsignaal, freelancer- en klantportaal, private kleine uploads, beperkte offline ondersteuning, audit, export en back-up/herstel.

**Uitgesteld** (zoals voorgesteld): automatische nummeruitgifte, alle koppelingen (Dropbox, Bruto, reviewtool, Moneybird, Adobe, Artlist, agenda's), videoreview/streaming, financiële module, apparatuurvoorraad, native apps, volledige offline samenwerking, workflow-engine, terugkerende producties, volledige Asana-migratie, chat/WhatsApp.

Weergaven in de pilot: lijsten voor projecten en taken, één eenvoudige agenda (draaidagen + editblokken), projectdashboard met doorklikbare signalen. Geen Gantt, kanbanbouwer of vrij configureerbaar dashboard.

---

## 3. Architectuurvoorstel

Er is geen bestaande code, dus ik stel de voorkeurskandidaat uit de masterprompt voor. Ik heb voor de vergelijking alleen gekeken naar alternatieven die een concreet probleem oplossen.

| Laag | Keuze (voorstel) | Waarom |
|---|---|---|
| Frontend | React + TypeScript + Vite, responsive; later PWA (vite-plugin-pwa / Workbox) | Eén codebase voor Mac, iPhone en Android in de browser. Statisch te hosten. |
| Database + auth + bestanden | **Supabase**, regio EU (Frankfurt; te verifiëren bij aanmaken) | Postgres met constraints en transacties (nummeruniciteit, idempotentie, revisies), RLS voor rechten op databaseniveau, private Storage met eigen policies, beheerde auth met uitnodigingen. Geen zelfgebouwde authenticatie. |
| Bevoorrechte handelingen | Postgres-functies (RPC) met expliciete rolcontrole + enkele Supabase Edge Functions (uitnodigen, export, uploadafronding) | Kritische handelingen lopen transactioneel op de server. De service key komt nooit in de browser. |
| Hosting frontend | Cloudflare Pages (gratis) | Statische hosting met HTTPS en previewomgevingen. |
| Accountmails | Resend via SMTP in Supabase Auth, met een eigen afzenderdomein | De standaardmailer van Supabase is niet geschikt voor externe uitnodigingen. Dit is een launchvoorwaarde voor fase 3. |
| Offline (fase 4) | IndexedDB-wachtrij met client-operatie-ID's + idempotente RPC | Past bij de beperkte offlinegrens (lezen + nieuwe taken als concept). |
| Tests | SQL/RLS-tests tegen een lokale Supabase-stack (Docker), Vitest voor logica, Playwright voor end-to-end | Tests op de echte risico's: rechten, uniciteit, dubbele uitvoering, fasegates, conflicten. |

**Alternatief dat ik heb overwogen:** een eigen Node-server met Postgres (bijv. Hetzner + Postgres) is goedkoper bij groei, maar vraagt zelf beheer van auth, back-ups, updates en beveiliging. Dat is te veel voor twee interne gebruikers zonder vaste beheerder. **Niet aanbevolen** voor de pilot.

### Kern van het datamodel (wordt in fase 1 als migrations uitgewerkt)

`organization`, `workspace`, `membership` (rol per werkruimte), `account` ↔ `person` (optionele koppeling), `client_org` + `client_contact`, `project` (UUID, bedrijfslabel, jaar, lifecycle, archiefvlag, berekende en gekozen fase apart, revisie), `project_number` (gereserveerd nummer + genormaliseerde unieke sleutel, organisatiebreed; aliassen bij correctie), `project_access` (expliciete toegang voor externen), `task_list` / `inbox`, `task` (+ `task_dependency`, parent zonder cycli, revisie), `deliverable` (variant van basisproduct, eigen deadline/status), `deliverable_version` (immutable) + `approval` (precies één versie, bron: “geregistreerd door medewerker”), `shoot_day`, `assignment` (persoon + rol + draaidag óf deliverable, optie/bevestigd/geweigerd/geannuleerd, optionele tijden), `edit_block`, `scope_change`, `milestone`/`decision`, `file` + `file_grant`, `comment` (intern/extern), `template` + `template_version`, `audit_log`, `operation` (idempotentie-sleutels), `external_ref` (voor later).

Editors en crew in het overzicht worden **afgeleid** uit `assignment`. Er komt geen apart editorveld.

---

## 4. Kosten (niet opnieuw geverifieerd, zie §1)

| Post | Gratis pilot | Dagelijks gebruik (voorstel) |
|---|---|---|
| Supabase | Free: 500 MB database, 1 GB bestanden, 5 GB egress; **pauzeert na 1 week inactiviteit; geen automatische back-ups** | Pro vanaf **$25/mnd** (≈ €21–23 bij een koers van circa 0,85–0,92; actuele koers nodig), excl. btw. Als zakelijke afnemer met btw-nummer waarschijnlijk btw verlegd; te controleren. Kosten bij overschrijding volgens de actuele tabel. |
| Cloudflare Pages | €0 | €0 (binnen de gratis build- en assetlimieten) |
| Resend | €0 (3.000 mails/mnd, 100/dag) | €0. Ruim voldoende voor ~17 personen. |
| Domein (afzender + app) | — / bestaand domein | ~€1/mnd als een nieuw domein nodig is. Een subdomein van een bestaand domein kost €0, mits er DNS-toegang is. |
| Back-upopslag (bestandsbytes + dumps) | Eigen opslag onder Lars' beheer | Bijv. versleuteld in een eigen cloudmap of objectopslag, binnen het gratis volume. Precieze keuze is open. |
| **Totaal** | **€0** | **≈ €22–25/mnd excl. btw**: precies op de grens van het budget. |

**Eerlijk oordeel:** een gratis pilot is haalbaar. Voor betrouwbaar dagelijks gebruik raad ik Supabase Pro aan (geen pauzes, dagelijkse back-ups van de database). Ook dan blijft een **eigen back-up van de bestandsbytes** nodig, omdat database-back-ups die niet bevatten. Het alternatief is Free houden met een eigen nachtelijke back-uproutine (database-dump + bestandssync via een geplande GitHub Action). Dat kost €0, maar de omgeving pauzeert bij een week inactiviteit en er is geen ondersteuning. Dat label ik als “pilot”, niet als “dagelijks gebruik”. Ik zet geen betaald plan aan zonder jouw concrete akkoord.

---

## 5. Belangrijkste risico's

1. **Rechtenlekken naar externen.** Daarom RLS vanaf de eerste migration, servermatig samengestelde portaalgegevens en tests op de ruwe API-response (proeven 14–18).
2. **Budget op de grens.** Pro + koersschommeling kan net boven €25 uitkomen. Beslissing nodig (vraag 4).
3. **Geen vaste beheerder.** Back-ups, updates en herstelproeven hebben een eigenaar nodig, anders blijft het een pilot.
4. **Offline op iPhone.** Safari kan opslag wissen. Ongesynchroniseerde concepten krijgen een zichtbaar risicolabel. Echt testen kan alleen op jouw toestellen.
5. **Mailbezorging.** Zonder geverifieerd afzenderdomein geen externe uitnodigingen. Dat blokkeert fase 3.
6. **Netwerk van deze bouwsessie.** De dienstendomeinen waren hier geblokkeerd. Voor fase 1 werk ik lokaal (Docker). Uitrollen naar Supabase/Cloudflare vereist dat die hosts worden toegestaan of dat jij de accounts zelf koppelt.

---

## 6. Wat ik van je nodig heb (maximaal vier gebundelde vragen)

**Vraag 1 — Scope, uploads en offline.** Akkoord met de scope in §2 en deze grenzen?
- Uploads: PDF, JPEG en PNG, max. 20 MB per bestand, 500 MB totaal. Andere typen via een geautoriseerde externe link.
- Offline: interne gebruikers en freelancers kiezen zelf welke taken en documenten ze offline bewaren (lezen) en kunnen offline **nieuwe** taken als concept vastleggen. Bestaande taken wijzigen, afvinken, uploaden en akkoord geven blijven online. Offline toegang vervalt 24 uur na de laatste online controle. Het klantportaal is alleen online.

**Vraag 2 — Fase- en nummerregels.** Akkoord met de volgende regels?
- (a) Regie berekent een *aanbevolen* fase; een projectmanager bevestigt faseovergangen. Er is geen automatisch doorzetten.
- (b) Projectjaar = startjaar, als aanpasbaar voorstel.
- (c) Projectnummer is organisatiebreed uniek, ongeacht hoofdletters en spaties, en wordt nooit hergebruikt. Correctie kan alleen door eigenaar/admin, met reden; het oude nummer blijft als alias bestaan.
- (d) Operationeel afgerond en administratief afgerond (checklist: factuur, betaling, freelancers, overig; zonder bedragen) zijn twee aparte bevestigingen.

**Vraag 3 — Rollen en beheer.** Ben jij eigenaar? Welke rol krijgt de tweede interne gebruiker (admin of projectmanager)? Wie is technisch beheerder voor back-ups, updates en herstel? Zet ik alle accounts (GitHub, Supabase, Cloudflare, Resend) op jouw naam en e-mail?

**Vraag 4 — Domein en budget.** Welk (sub)domein mag Regie gebruiken voor de app en het afzenderadres (bijv. `regie.<jullie-domein>.nl` en `noreply@…`), en heb je toegang tot de DNS? En kies je voor dagelijks gebruik **Supabase Pro (~€22–23 excl. btw, aanbevolen)** of **Free met een eigen back-uproutine** (€0, blijft label “pilot”)?

Na je antwoorden werk ik het besluitenlog bij en start ik fase 1: één volledige interne projectworkflow met echte opslag, gebouwd en getest tegen een lokale Supabase-stack.
