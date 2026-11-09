# Besluitenlog Regie

Labels: **bevestigd** (door Lars) · **voorstel** (wacht op bevestiging) · **aanname** (werkhypothese, niet als eis behandelen) · **open** (nog geen antwoord).

| # | Onderwerp | Besluit | Label | Datum |
|---|---|---|---|---|
| 1 | Productnaam en logo | Regie; beeldmerk en woordmerk in `assets/brand/` | bevestigd (logo aangeleverd) | 2026-11-09 |
| 2 | Doel | Overzicht van lopende projecten, editors, ingeplande freelancers en eerstvolgende acties | bevestigd | 2026-11-09 |
| 3 | Bedrijven | Studio Brutaal en Moviemates als projectlabel, geen toegangsgrens, geen merkuitingen | bevestigd | 2026-11-09 |
| 4 | Gebruikers | 2 intern, 5 freelancers, 10 klanten; niet iedereen krijgt een account | bevestigd | 2026-11-09 |
| 5 | Inzet | Crew → draaidagen, editors → deliverables; optie/bevestigd | bevestigd | 2026-11-09 |
| 6 | Externen in v1 | Freelancer- en klantportaal | bevestigd | 2026-11-09 |
| 7 | Budgetten | Blijven in Bruto | bevestigd | 2026-11-09 |
| 8 | Projectnummers | Handmatig ingevoerd, blijvend register | bevestigd | 2026-11-09 |
| 9 | Nummerregels | Organisatiebreed uniek (hoofdletter- en spatie-ongevoelig), nooit hergebruikt, alias bij correctie | bevestigd | 2026-11-09 |
| 10 | Projectjaar | Startjaar als aanpasbaar voorstel | bevestigd | 2026-11-09 |
| 11 | Koppelingen | Allemaal later (Dropbox als eerste) | bevestigd | 2026-11-09 |
| 12 | Stack | React/TS/Vite + Supabase; eerst alleen lokaal (Docker). Hosting (Cloudflare Pages) en mail (Resend) later | bevestigd (lokaal eerst) | 2026-11-09 |
| 13 | Uploads | PDF/JPEG/PNG, 20 MB/bestand, 500 MB totaal | bevestigd | 2026-11-09 |
| 14 | Offline | Lezen van gekozen items + nieuwe taken als concept; 24 uur geldig; klantportaal online | bevestigd | 2026-11-09 |
| 15 | Faselogica | Nu: aanbevolen fase berekend, overgang bevestigd door projectmanager. Wens: later automatisch naar de volgende fase zodra de afrondende taak klaar is | bevestigd (automatiseren is een latere wens) | 2026-11-09 |
| 16 | Afronding | Operationeel en administratief apart | bevestigd | 2026-11-09 |
| 17 | Kosten | Gratis pilot; dagelijks gebruik ≤ ~€20–25/mnd | bevestigd | 2026-11-09 |
| 18 | Plan dagelijks gebruik | Supabase Pro of Free + eigen back-up | open (later; eerst lokaal) | — |
| 19 | Rollen | Lars = eigenaar en beheerder; tweede interne gebruiker = stagiair. Geen aparte admin nodig zolang er één eigenaar is (advies: MFA aan voor de eigenaar zodra het online staat; een admin-rol pas bij een tweede senior gebruiker) | bevestigd | 2026-11-09 |
| 20 | Domein en afzenderadres | — | open (later) | — |
| 21 | Bewaartermijnen | Contacten, uploads, audit, back-ups | open (vóór dagelijks gebruik) | — |
| 22 | Prijzen en limieten | Gebaseerd op broncontrole van 9-11-2026; in deze sessie niet opnieuw te verifiëren (netwerk geblokkeerd) | aanname | 2026-11-09 |
| 23 | Accounts | Alle accounts (GitHub, Supabase, Cloudflare, Resend) op naam van Lars | bevestigd | 2026-11-09 |
| 24 | Lokale accounttoevoeging | Fase 1: persoon maakt zelf een lokaal account, eigenaar voegt het toe. Fase 3 vervangt dit door uitnodigingen | voorstel | 2026-11-09 |
| 25 | Stagiair-zicht | Stagiair ziet projectcontext van projecten met projectlidmaatschap, maar alleen eigen toegewezen/aangemaakte taken; wijzigt alleen status | voorstel (afgeleid uit rechtenmatrix) | 2026-11-09 |
| 26 | Versies in fase 1 | Versie = link/notitie; geen upload tot fase 3 | aanname | 2026-11-09 |

## Volledige app (masterprompt van 9-11-2026)

Lars vroeg op 9-11-2026 om de fases over te slaan en de volledige app in één keer te bouwen, op basis van een nieuwe masterprompt. Waar die masterprompt afwijkt van eerdere besluiten, staat dat hieronder. Een **aanname** blijft een aanname tot Lars hem bevestigt.

| # | Onderwerp | Besluit | Label | Datum |
|---|---|---|---|---|
| 27 | Werkwijze | Fases overslaan; volledige app in één oplevering. Werkt nog steeds alleen lokaal; online zetten vraagt accounts en akkoord (zie 40) | bevestigd (opdracht Lars) | 2026-11-09 |
| 28 | Productnaam | Blijft **Regie** (masterprompt noemt "Productieplanner" als werktitel die Lars mag wijzigen; logo's in `assets/brand/` zijn leidend) | aanname | 2026-11-09 |
| 29 | Nummeruitgifte | Vervangt #8: Regie geeft nummers uit (hoogste + 1 per bedrijf per jaar), met vrije nummers, eigen code en weigering van bestaande nummers. Uitgifte transactioneel met lock per bedrijf+jaar en unieke index | bevestigd (masterprompt §5) | 2026-11-09 |
| 30 | Nummerformaat | `PREFIX + JJ + 3 cijfers` (SB, MMS), instelbaar per bedrijf. Afwijkende historische nummers worden ongewijzigd geïmporteerd en gemarkeerd | aanname (A3) | 2026-11-09 |
| 31 | Faselogica | Vervangt #15: fases gaan **automatisch** volgens §6, met handmatige correctie (reden verplicht) en "Automatiek hervatten" | bevestigd (masterprompt §6) | 2026-11-09 |
| 32 | Rechten | Vervangt #25 en het projectlidmaatschap uit fase 1: alle interne rollen zien alle projecten; stagiair mag projecten en taken bewerken, maar niet verwijderen, goedkeuren, exporteren of uitnodigen; financiële mijlpalen alleen voor eigenaar/admin/PM | bevestigd (masterprompt §3) | 2026-11-09 |
| 33 | Klantportaal | Vervangt #6 voor klanten: geen klanttoegang in deze scope (masterprompt §2). Freelancer-toegang is wel gebouwd | bevestigd (masterprompt) | 2026-11-09 |
| 34 | Back-up per draaidag | Template-taak "back-up SSD + HDD" is gebouwd als twee vinkjes op de draaidag zelf (één bron van waarheid voor de faselogica), niet als aparte taak | voorstel | 2026-11-09 |
| 35 | T2 en T3 inhoud | Samenstelling T2 (welke T1-taken mee) en T3 (aantal feedbackrondes leeg gelaten) zijn een voorstel. "Opvolging volgende productie" heeft geen automatische deadline (oplevering is geen anker) | voorstel | 2026-11-09 |
| 36 | Uitnodigen | Eenmalige link (7 dagen), die de eigenaar zelf doorstuurt. Automatisch mailen vraagt een afzenderdomein en hosting (zie #20) | voorstel | 2026-11-09 |
| 37 | Tweestapsverificatie | TOTP via Supabase Auth; wie een tweede factor heeft, krijgt in de database alleen toegang met aal2. Passkeys als tweede factor: **ONBEKEND** of beschikbaar in de gekozen versie, niet gebruikt | voorstel | 2026-11-09 |
| 38 | API voor koppelingen | `POST /rest/v1/rpc/api_events` en `/rest/v1/rpc/api_reserve_number` met header `x-regie-key` (masterprompt noemde `/api/v1/...`; zelfde functie, geen extra dienst nodig) | voorstel | 2026-11-09 |
| 39 | Dropbox, Moneybird | Niet gebouwd: API's niet te verifiëren vanuit deze sessie (netwerk geblokkeerd) en geen accounts. In de app staat "koppeling niet actief", zonder knoppen | open | 2026-11-09 |
| 40 | Online zetten, apps in stores, push | Niet gedaan: vraagt accounts op naam van Lars (Supabase, Cloudflare, Apple, Google) en akkoord over kosten. Push vraagt hosting met HTTPS | open | 2026-11-09 |
| 41 | Audit-log | Zichtbaar voor eigenaar, admin en PM (bevat oude/nieuwe waarden, ook financiële) | voorstel | 2026-11-09 |
| 42 | Bewaartermijn audit | Minimaal 7 jaar (masterprompt §13); er wordt niets automatisch opgeschoond | aanname (Lars bevestigt) | 2026-11-09 |
