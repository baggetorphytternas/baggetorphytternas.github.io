# Vägföreningens app – riktlinjer

Appen publiceras från repot `baggetorphytternas/baggetorphytternas.github.io` (gren `main`). Samma filer (`index.html`, `sb.js`, `sw.js`) speglas hit. Edge-funktionernas källkod ligger i `supabase/functions/`.

## Designregler (gäller alltid)

- **Underflikar** ligger alltid överst på sidan, direkt under sidhuvudet och ovanför sidans rubrik, och stannar kvar där vid scroll.
  Mönster (samma på alla sidor):
  ```html
  <div class="page" id="page-x" hidden>
    <div class="subwrap"><div class="filters subnav" role="tablist" aria-label="X">
      <button type="button" class="chipbtn on" data-x="a">A</button>
      <button type="button" class="chipbtn" data-x="b"><span class="lg">Lång text</span><span class="sm">Kort</span></button>
    </div></div>
    …
  ```
  Inga ikoner i underflikarna. Lägg `board` på `.subwrap` om flikarna bara är för styrelsen. Alla flikar ska alltid synas: får de inte plats bryts de till fler rader (aldrig scroll i sidled); med fem eller fler flikar blir det ett jämnt rutnät med tre per rad på mobil.
- **Ingen sidrubrik eller inledande hjälptext** på sidorna: menyn och underflikarna visar var man är. Behövs knappar för hela sidan läggs de i `<header class="pghead"><div class="ph pgknappar">…</div></header>` direkt efter underflikarna.
- **Kort** i listor är lika stora (`grid-auto-rows:1fr`), kompakta, och öppnar en dialog med detaljer.
- **Kontrollera alltid** på mobil, platta och dator.
- Varje release: höj `Version X` och lägg till en rad i ändringsloggen på adminsidan; höj `sb.js?v=` om `sb.js` ändrats.

## Säkerhet

- Behörighet styrs i databasen (RLS och `security definer`-funktioner), aldrig bara i appen.
- Nivåer: medlem < styrelse < admin < superadmin. Bara superadmin kan utse eller ta bort admins.
- Alla filer ligger i låsta lagringsplatser (`filer`, `dokument`, `styrelse`) och hämtas med signerade adresser.

## Filer
- `index.html` – appens HTML. `app.js` – appens kod. `app.css` – gemensam stil. `sb.js` – inloggning och Supabase. Höj `?v=` på den fil som ändrats.
- Ingen inline-JavaScript: sidorna har en Content-Security-Policy som bara tillåter skript från appen själv.
- `verktyg.html` + `verktyg.js` – andelstalsverktyget (eget fönster, läser/skriver `vag/config`, bara admin kan ändra).
- `verktyg-karta.js` – kartan i verktyget (Leaflet i `leaflet/`, kartbilder från OpenStreetMap och OpenTopoMap, tillåtna i CSP). Vägnätet sparas i `vag/config` som `karta` och delsträckor får `geo` och `mot`.
- Testskript (Playwright) ligger i Vag-repot under `tests/`.

## Data
- `docs` (path → JSON): `site/main` (nyheter, möten, styrelse, funktionärer, dokumentlista, länkar, inställningar), `vag/config`, `styrelse/*`, `felanmalan/<uid>`, `synpunkter/<uid>`.
- `medlemmar` – medlemsregistret, en rad per kontaktperson. Appen sparar bara ändrade rader.
- `roller` – inloggning och behörighet. `andringslogg` – vem ändrade vad (triggers på docs, medlemmar, roller; bara admin läser).
- Databasändringar som kräver godkännande läggs som SQL-filer i Vag-repot under `supabase/migrations/`.
