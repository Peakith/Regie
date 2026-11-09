# Werkafspraken Regie

- Interfacetaal Nederlands; tijdzone Europe/Amsterdam. Productnaam **Regie**; gebruik alleen de logo's in `assets/brand/`; geen huisstijl van Studio Brutaal of Moviemates.
- Werk fase voor fase (zie `docs/fase-0-voorstel.md`). Breid de scope niet uit. Toekomstige functies krijgen geen nepknoppen.
- Houd `docs/besluitenlog.md` bij met de labels bevestigd/voorstel/aanname/open. Een aanname wordt nooit stilzwijgend een eis.
- Rechten worden op de server afgedwongen (RLS + RPC). Vertrouw geen project-ID's of rollen die de client meestuurt. Externen krijgen servermatig samengestelde data.
- Interne sleutels zijn UUID's; een projectnummer is nooit een foreign key.
- Kritische handelingen zijn transactioneel en idempotent (operatie-ID's). Gebruik revisienummers tegen stil overschrijven.
- Geen secrets in git, logs of chat; `.env.example` bevat alleen placeholders.
- Benoem opleverniveaus eerlijk: prototype, pilot of dagelijks gebruik. Demodata is gelabeld en gescheiden.
- Rapporteer per fase: wat werkt, wat echt is opgeslagen, wat getest is (en hoe), wat niet getest is, open problemen en kosten, gewijzigde bestanden en de terugrolstap.

## Lokale ontwikkeling
- `npm run db:start` → `npm run env:lokaal` → `npm run dev`; tests: `npm test` (lokale stack moet draaien).
- In de cloudsessie is public.ecr.aws geblokkeerd: start Supabase met `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`.
- Testdata hoort in organisaties met `is_test = true` en wordt opgeruimd; raak echte lokale data niet aan.
- Schemawijzigingen altijd als nieuwe, uitbreidende migratie in `supabase/migrations/`.
