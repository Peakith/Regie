# Beheer

## Lokaal starten en stoppen
Zie README. Kort: `npm run db:start`, `npm run env:lokaal`, `npm run dev`. Stoppen: `npm run db:stop` (gegevens blijven bewaard).

## Gebruiker toevoegen of verwijderen
- **Toevoegen:** Instellingen → Gebruikers → Uitnodigen. Je krijgt een link die één keer werkt en na 7 dagen verloopt. Stuur die zelf door. De persoon maakt een account aan met precies dat e-mailadres en opent de link.
- **Intrekken:** Instellingen → Gebruikers → Toegang intrekken. Dit werkt direct, ook bij een open sessie. Taken blijven bestaan en verschijnen onder "Toegewezen aan gedeactiveerde gebruiker".

## Sleutels vernieuwen
- **API-sleutel van een tool (bijv. Bruto):** maak een nieuwe sleutel (Instellingen → Koppelingen), zet die in de tool, en trek daarna de oude in.
- **Supabase-sleutels:** alleen in het dashboard van Supabase en in de omgevingsvariabelen van de hostingdienst. Nooit in git of in een chat.

## Back-up en export
- **Nu (lokaal):** er zijn geen automatische back-ups. Maak handmatig een export: Instellingen → Prullenbak en export → "Alles als JSON". Bewaar die op een plek die van jou is.
- **Database-dump lokaal:** `npx supabase db dump --local --data-only -f backup.sql`.
- **Online (nog in te richten):** Supabase Pro maakt dagelijkse back-ups. Daarnaast een wekelijkse export naar opslag van Lars. Het herstel moet minstens één keer getest zijn in de testomgeving voordat Regie voor dagelijks gebruik wordt gebruikt.

## Herstellen (testomgeving)
1. Nieuwe, lege testomgeving (`npx supabase db reset` lokaal, of een apart Supabase-project).
2. Dump terugzetten: `psql "<database-url>" -f backup.sql`.
3. App starten en controleren: register, een project, een draaidag.

## Terugrollen
- **App:** vorige versie opnieuw deployen. Lokaal: `git checkout <vorige commit>`.
- **Database:** migraties zijn uitbreidend en worden niet teruggedraaid door alleen de app terug te zetten. Maak vóór elke migratie die gegevens wijzigt eerst een back-up. Lokaal teruggaan naar een schone stand: `npm run db:reset` (**wist lokale gegevens**).

## Periodieke taak
`pg_cron` draait elke 5 minuten `tick_all()` (tijdsafhankelijke fases, meldingen) en `retry_due_events()` (mislukte koppelingsberichten). Is `pg_cron` niet beschikbaar, dan gebeurt het bijwerken bij het laden van het dashboard.
