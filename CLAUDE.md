# Baggetorp Hytternäs vägsamfällighet – installation

Det här repot är föreningens **installation** av Vägappen. Produkten (appen och andelstalsverktyget) utvecklas i `SweetHillyBill/Vag`; läs riktlinjerna i Vag-repots `CLAUDE.md`.

- Föreningens egna filer: `forening.js` (namn, väg, ort, kommun, Supabase-projekt), `manifest.json`, `icon.png`, `qr/`, `OVERLAMNING.md`, `README.md`.
- Alla andra filer kommer från produkten. Ändra dem inte här: gör ändringen i Vag-repot och kopiera hit med `scripts/uppdatera-installation.sh` därifrån.
- Föreningens data (nyheter, register, styrelse) ligger i föreningens Supabase-databas, inte i filerna.
