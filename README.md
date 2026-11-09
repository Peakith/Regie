<p align="center"><img src="assets/brand/regie-woordmerk.png" alt="Regie" width="260"></p>

# Regie

Zelfstandig projectmanagement voor filmproductie: projecten, projectnummerregister, deliverables met versies en akkoord, draaidagen, inzet van crew en editors. Portalen voor freelancers en klanten volgen in fase 3.

**Status:** fase 1, pilotfundament. Draait **alleen lokaal** op je eigen Mac. Het is nog geen online systeem en nog niet geschikt voor dagelijks gebruik; zie [fase 1-oplevering](docs/fase-1-oplevering.md).

## Lokaal draaien (Mac)

Eenmalig nodig:
- **Docker Desktop** (gratis voor persoonlijk en klein zakelijk gebruik), gestart.
- **Node.js 20 of nieuwer** (bijv. via nodejs.org).

```bash
git clone https://github.com/Peakith/Regie.git
```

```bash
cd Regie && npm install
```

```bash
npm run db:start
```

De eerste keer downloadt dit de database-onderdelen; reken op een paar minuten.

```bash
npm run env:lokaal
```

```bash
npm run dev
```

Open daarna http://127.0.0.1:5173:
1. Kies **Nieuw account (lokaal)** en maak je account aan.
2. Richt Regie in; je wordt dan **eigenaar**.
3. Voor de stagiair: laat diegene op het inlogscherm een account aanmaken. Voeg dat e-mailadres daarna toe via **Instellingen** en geef in het project (tab **Beheer**) toegang.

De databasebeheeromgeving (Supabase Studio) staat op http://127.0.0.1:54323.

Stoppen doe je met `npm run db:stop`; je gegevens blijven bewaard. **Let op:** `npm run db:reset` wist alle lokale gegevens.

## Tests

```bash
npm test
```

De integratietests draaien als echte gebruikers tegen de lokale database (inloggen, API en rechten). Ze maken een aparte, gemarkeerde testorganisatie aan en ruimen die daarna weer op. Je eigen gegevens worden niet geraakt.

## Documenten

- [Fase 0: scope- en architectuurvoorstel](docs/fase-0-voorstel.md)
- [Fase 1: oplevering, testverslag en rechten](docs/fase-1-oplevering.md)
- [Besluitenlog](docs/besluitenlog.md)
- Werkafspraken voor Claude: [CLAUDE.md](CLAUDE.md)

## Structuur

| Map | Inhoud |
|---|---|
| `supabase/migrations/` | Datamodel, rechten (RLS) en serverfuncties |
| `src/` | Webapp (React + TypeScript) |
| `tests/` | Integratietests tegen de lokale stack |
| `assets/brand/`, `public/brand/` | Logo's (plus witte varianten en app-iconen die daarvan zijn afgeleid) |
