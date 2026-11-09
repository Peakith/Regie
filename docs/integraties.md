# Integraties

Opleverniveau: **prototype**. Er is geen enkele koppeling live verbonden met een extern systeem. Wat er staat, is de kant van Regie: een beveiligd aansluitpunt, een berichtenlog en de verwerking, getest met gesimuleerde berichten in de integratietests.

Elke koppeling is los aan/uit te zetten in **Instellingen → Koppelingen**. Staat een koppeling uit, dan wordt een bericht vastgelegd als "genegeerd" en verandert er niets. Zonder koppelingen werkt Regie volledig.

## Aansluitpunt (voor eigen tools)

| | |
|---|---|
| Adres (lokaal) | `POST http://127.0.0.1:54321/rest/v1/rpc/api_events` |
| Headers | `apikey: <publieke anon-sleutel>`, `x-regie-key: <API-sleutel van de tool>`, `Content-Type: application/json` |
| Body | `{"p_event_id": "uniek-id-van-de-afzender", "p_type": "offerte_akkoord", "p_payload": { … }}` |
| Idempotentie | Een tweede bericht met hetzelfde `p_event_id` maakt niets dubbel en staat in het log als **duplicaat** |
| Fouten | Status **fout** + foutmelding; automatisch opnieuw geprobeerd met oplopende wachttijd (2, 4, 8, 16 min), maximaal 5 keer. Daarna een melding aan de eigenaar. Handmatig opnieuw proberen kan in het berichtenlog |
| Sleutels | Per tool een eigen sleutel, aan te maken door de eigenaar. Alleen de hash wordt bewaard; de sleutel wordt één keer getoond |
| Lusbescherming | Wijzigingen uit een koppeling dragen hun bron mee (`regie.source`). Regie stuurt nog geen uitgaande berichten, dus een lus is nu niet mogelijk; uitgaande webhooks moeten deze bron respecteren |

Nummer reserveren: `POST /rest/v1/rpc/api_reserve_number` met `{"p_company": "SB", "p_year": 2026, "p_name": "…", "p_op": "<uuid>"}`. Zelfde `p_op` = zelfde nummer.

## Bruto (§10.1)

- **Leidend:** Bruto voor klant, deal, offerte, prijzen, marge en nacalculatie. Regie voor register, productie, mijlpalen.
- **Gebouwd in Regie:** `offerte_akkoord` (nummer → status project, conceptproject met klant en naam, voorgestelde deliverables en draaidagen ter bevestiging) en `nummer_status`.
- **Payload `offerte_akkoord`:** `number`, `project_name`, `client {name, kvk, bruto_id}`, `bruto_production_id`, `bruto_url`, `deliverables [{title, aspect_ratio, duration, feedback_rounds}]`, `shoot_days [{date, location}]`.
- **Niet gebouwd:** de aanpassing in Bruto zelf. Voorwaarde vooraf (masterprompt): `app.asar` uitpakken naar een eigen git-repository en een back-up van `margeboek.json` maken. Dat moet op de Mac van Lars gebeuren.
- Tot de koppeling actief is: Regie geeft de nummers uit; neem ze in Bruto over met "Eigen nummer".

## Reviewtool (§10.2)

- Gedeelde sleutel: deliverable-ID (UUID uit Regie) + versienummer.
- Berichten: `feedback_ontvangen` (`deliverable_id`, `version_no`, `review_id`) en `goedgekeurd` (`deliverable_id`, `version_no`, `approved_by`, `approved_at`, `evidence`). Een goedkeuring maakt een onveranderlijk besluit; een latere versie wordt nooit automatisch goedgekeurd.
- **Niet gebouwd:** het doorsturen van een versie naar de reviewtool (uitgaand), want de reviewtool bestaat nog niet.

## Dropbox (§10.3) en Moneybird (§10.4)

**ONBEKEND / niet gebouwd.** De documentatie van beide API's kon vanuit deze bouwsessie niet worden geverifieerd (uitgaand netwerk naar die domeinen geblokkeerd), en er zijn geen accounts. Tot die tijd: links handmatig vastleggen (tab "Bestanden & links", soort Dropbox/Moneybird) en mijlpalen handmatig afvinken. Regie maakt nooit zelf gedeelde links en maakt of verstuurt nooit facturen.

## Adobe en Artlist (§10.6)

Geen koppeling. Licenties leg je vast als link van het soort **Licentie**, met bron, titel, licentie-ID en geldigheid.
