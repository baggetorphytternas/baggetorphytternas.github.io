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
    <header class="pghead">…rubrik och hint…</header>
    …
  ```
  Inga ikoner i underflikarna. Lägg `board` på `.subwrap` om flikarna bara är för styrelsen.
- **Sidhuvud på sidor:** `.pghead` med `.ph` (rubrik till vänster, knappar till höger) och `.hint` under.
- **Kort** i listor är lika stora (`grid-auto-rows:1fr`), kompakta, och öppnar en dialog med detaljer.
- **Kontrollera alltid** på mobil, platta och dator.
- Varje release: höj `Version X` och lägg till en rad i ändringsloggen på adminsidan; höj `sb.js?v=` om `sb.js` ändrats.

## Säkerhet

- Behörighet styrs i databasen (RLS och `security definer`-funktioner), aldrig bara i appen.
- Nivåer: medlem < styrelse < admin < superadmin. Bara superadmin kan utse eller ta bort admins.
- Alla filer ligger i låsta lagringsplatser (`filer`, `dokument`, `styrelse`) och hämtas med signerade adresser.
