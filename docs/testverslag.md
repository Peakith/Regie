# Testverslag: volledige app (9 november 2026)

Opleverniveau: **pilot-kandidaat, alleen lokaal**. Nog geen pilot en niet klaar voor dagelijks gebruik: Regie staat niet online, er zijn geen automatische back-ups en er is niet getest op echte telefoons.

## Hoe getest

1. **Integratietests** (`npm test`): 55 tests, **allemaal geslaagd**. Ze draaien als echte gebruikers (en als externe tool met API-sleutel) tegen de lokale Supabase-stack: inloggen, API, RLS en serverfuncties, zonder mocks. Testdata staat in een organisatie met `is_test = true` en wordt daarna opgeruimd.
2. **Browsertest** (Playwright, Chromium, productiebuild): account aanmaken → inrichten → persoon → nummer uitgeven → project met template T1 (voorbeeld + bevestigen) → alle zeven projecttabs → draaidag bevestigen, crew inboeken, apparatuur → versie + goedkeuring → dashboard, agenda, mijn taken, deliverables-bord, templates, instellingen (alle tabbladen) → lijst "Boodschappen kantoor" → zoeken met Ctrl+K → mobiel 390 px (geen horizontale scroll) → offline weergave met netwerk uit. Alles geslaagd. De enige melding kwam van een te ruime selector in het testscript zelf (de besluittekst staat ook in een keuzelijst). Er waren geen JavaScript-fouten. Het script staat niet in de repository.

## Acceptatiecriteria (§16)

| # | Criterium | Resultaat |
|---|---|---|
| 1 | Wijziging binnen 10 s op ander apparaat | **Deels.** Code voor realtime + verversen bij focus en elke 30 s is gebouwd. Realtime kon lokaal niet draaien (image niet te downloaden), dus de 10 s is **niet getest**; zonder realtime kan het tot 30 s duren |
| 2 | Gelijktijdige wijziging → conflict met beide waarden | Getest (revisietest). Projectgegevens tonen beide versies; andere formulieren tonen een conflictmelding en houden je invoer vast |
| 3 | Twee gelijktijdige SB-nummers → verschillend | Getest (4 gelijktijdig) |
| 4 | Bestaand nummer → geweigerd met projectnaam | Getest |
| 5 | Verloren pitch blijft vindbaar, nooit opnieuw voorgesteld | Getest |
| 6 | Project over de jaarwisseling houdt `SB26…` | Getest |
| 7 | Gearchiveerd project vindbaar en alleen-lezen | Getest |
| 8 | HDD-back-up ontbreekt → blijft in Productie + blokkade | Getest |
| 9 | Operationeel klaar, niet gefactureerd → "Blijft hangen" | Getest (ook na 14 dagen) |
| 10 | Handmatige fase met reden in audit; automatiek staat stil | Getest |
| 11 | Goedkeuring v2 keurt v3 niet goed | Getest |
| 12 | 3e ronde bij 2 afgesproken → mogelijk meerwerk | Getest |
| 13 | Draaidag +3 dagen → juiste taken schuiven (werkdagen), ongedaan maken | Getest |
| 14 | Dubbele boeking → waarschuwing vóór opslaan | Getest (server) + in de browser gebouwd |
| 15 | Stagiair ziet geen financiële gegevens, ook niet via API | Getest |
| 16 | Freelancer: geen toegang tot ander project via directe link | Getest |
| 17 | Ingetrokken freelancer direct buitengesloten | Getest |
| 18 | Dubbel Bruto-bericht → één project, duplicaat in log | Getest (met gesimuleerd bericht; Bruto zelf is niet aangepast) |
| 19 | Gewijzigde template laat projecten ongewijzigd | Getest |
| 20 | Back-up van gisteren terugzetten | **Niet getest**: er is nog geen online omgeving met back-ups |
| 21 | Vliegtuigmodus: callsheet leesbaar, "Offline" zichtbaar | In Chromium getest; **niet op een echte telefoon** |
| 22 | Losse lijst zonder template of project | Getest |

Ook getest: tweestapsverificatie wordt in de database afgedwongen (sessie zonder code krijgt geen gegevens), uitnodiging is eenmalig en alleen voor het juiste e-mailadres, AU1 dubbel uitvoeren maakt niets dubbel, meldingen worden gebundeld, soft delete en herstel, export alleen voor eigenaar/admin/PM, import uit Asana met voorbeeld en zonder hernummeren.

## Niet getest

- Echte iPhone, Android en Safari (alleen Chromium-emulatie); installeren op het beginscherm.
- Pushmeldingen (niet gebouwd; vraagt hosting met HTTPS).
- Realtime binnen 10 seconden (zie 1).
- Back-up en herstel, deploy, terugrollen in een online omgeving.
- Echte koppelingen met Bruto, reviewtool, Dropbox en Moneybird.
- Toegankelijkheid: labels, focus en contrast zijn aanwezig, maar er is geen volledige WCAG-audit gedaan.
- Prestaties met honderden projecten.
