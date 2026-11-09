<p align="center"><img src="assets/brand/regie-woordmerk.png" alt="Regie" width="260"></p>

# Regie

Projectmanagement voor filmproductie: nummerregister, projecten met automatische fases en mijlpalen, deliverables met versies en goedkeuringen, draaidagen met crew, back-ups en apparatuur, taken en lijsten, templates, dashboard, agenda, meldingen, freelancer-toegang en een API voor eigen tools.

**Status:** volledige app, **pilot-kandidaat, alleen lokaal**. Nog niet online en nog niet klaar voor dagelijks gebruik (geen automatische back-ups, niet getest op echte telefoons). Zie het [testverslag](docs/testverslag.md).

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
1. Kies **Account aanmaken** en maak je account aan.
2. Richt Regie in; je wordt dan **eigenaar**. Stel daarna tweestapsverificatie in (Instellingen → Beveiliging).
3. Voor de stagiair of een freelancer: Instellingen → Gebruikers → **Uitnodigen**. Stuur de link door; de persoon maakt een account aan met dat e-mailadres en opent de link.

Stoppen doe je met `npm run db:stop`; je gegevens blijven bewaard. **Let op:** `npm run db:reset` wist alle lokale gegevens.

## Tests

```bash
npm test
```

De integratietests draaien als echte gebruikers tegen de lokale database (inloggen, API en rechten). Ze maken een aparte, gemarkeerde testorganisatie aan en ruimen die daarna weer op. Je eigen gegevens worden niet geraakt.

## Documenten

- [Testverslag volledige app](docs/testverslag.md)
- [Gebruikershandleiding](docs/gebruikershandleiding.md) · [Beheer](docs/beheer.md) · [Integraties](docs/integraties.md) · [Kosten](docs/kosten.md)
- [Besluitenlog](docs/besluitenlog.md) (ook de "beslissingen" uit de masterprompt)
- Historie: [fase 0](docs/fase-0-voorstel.md), [fase 1](docs/fase-1-oplevering.md)
- Werkafspraken voor Claude: [CLAUDE.md](CLAUDE.md)

## Structuur

| Map | Inhoud |
|---|---|
| `supabase/migrations/` | Datamodel, rechten (RLS) en serverfuncties |
| `src/` | Webapp (React + TypeScript) |
| `tests/` | Integratietests tegen de lokale stack |
| `assets/brand/`, `public/brand/` | Logo's (plus witte varianten en app-iconen die daarvan zijn afgeleid) |
