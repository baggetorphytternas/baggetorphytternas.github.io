# Överlämning – Vägföreningens app (Baggetorp Hytternäs vägsamfällighet)

Läget efter molnsessionen 31 okt 2026 (version 2.49). Läs också `CLAUDE.md`.

## Var allt finns
| Vad | Var |
|---|---|
| Publicerad app | https://baggetorphytternas.github.io/ (repo `baggetorphytternas/baggetorphytternas.github.io`, gren `main` – GitHub Pages) |
| Utvecklingsrepo | `SweetHillyBill/Vag`, gren `claude/vagforeningens-app-design-bykyed` (spegel av appen + edge-funktioner + SQL + tester) |
| Databas, inloggning, lagring | Supabase-projekt `xhoexctuopvragyqwofs` (gratisplan) |
| Mejl | Resend, domän `vagappen.se` (Loopia DNS), avsändare `bhvf@vagappen.se`, inkommande via webhook → edge-funktionen `ta-emot-mejl` |
| Hemligheter | Supabase → Edge Functions → Secrets: `RESEND_API_KEY`, `MAIL_FRAN`, `MAIL_FRAN_NAMN`, `RESEND_WEBHOOK_SECRET`. Aldrig i koden eller chatten. |

## Arbetssätt
1. Ändra i det publicerade repot (`index.html`, `app.js`, `app.css`, `sb.js`, `verktyg.html/js`), höj version + ändringslogg (Admin-sidan) och `?v=` på ändrade filer.
2. Testa med Playwright mot `tests/fake-supabase.js` (se `tests/README.md`) på mobil, platta och dator.
3. Pusha `main`, kopiera samma filer till Vag-repot och pusha där.
4. Databasändringar: lägg SQL i `supabase/migrations/` och kör via Supabase (MCP `apply_migration` lokalt, eller SQL Editor).
5. Edge-funktioner: källkod i `supabase/functions/<namn>/`; driftsätt med Supabase MCP `deploy_edge_function` (verify_jwt true för `skicka-utskick` och `notiser`, false för `ta-emot-mejl`).

## Databas (kort)
- `docs` (JSON per path), `medlemmar` (en rad per kontakt), `roller` (email, roll, superadmin), `ansokningar`, `inkorg`, `push_prenumerationer`, `push_nycklar`, `andringslogg`.
- Viktiga funktioner: `min_roll`, `ar_medlem`, `ar_styrelse`, `ar_admin`, `ar_superadmin`, `ar_vagansvarig`, `ar_funktionar`, `uppdatera_min_kontakt`, `lagg_till_min_kontakt`, `lagg_till_atgard_m`, `mina_atgarder`, `markera_min_atgard`, `godkann_ansokan`, `inloggningsstatus`.
- Lagring (alla låsta): `filer` (bilagor, startbild), `dokument` (medlemmarnas dokument), `styrelse` (styrelsens dokument, utskicksbilagor).
- Superadmin: calle@landsbergs.se.

## Öppna punkter
- Lägg in fastigheter som saknas (Styrelsen → Register) så att medlemmar kan välja dem.
- Fastigheter utan namn/beteckning: se Register-översikten.
- Supabase gratisplan: pausas efter ~1 veckas inaktivitet. GitHub Actions-jobbet `.github/workflows/hall-supabase-vaken.yml` i det publicerade repot frågar databasen varje dag så att det inte händer. Gratisplanen saknar automatiska backuper → ladda ner säkerhetskopia (Admin) regelbundet.
- Ej byggt: tvåstegsverifiering för admin, bilagor i inkommande mejl visas inte i Inkorgen, flera fastigheter per person via självregistrering.
- Länkarna under Dokument → Länkar går till startsidor; byt till exakta sidor vid behov.
- Idé för framtiden: en neutral version för flera föreningar kräver förenings-id i alla tabeller och RLS (se genomgången i chatten).
