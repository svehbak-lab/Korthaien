import { db, hentSettings, normaliser, CONDITIONS } from "./db.js";
import { prisØre, hentAlleSetRules, hentManuellePriser, prisenFor, standardRegel } from "./pricing.js";
import { hentKvoterBulk, regnLedig } from "./quota.js";

// ─────────────────────────────────────────────────────────────────────────────
// HVORFOR
// ─────────────────────────────────────────────────────────────────────────────
// Et kort som ikke dukker opp i søket kan være stoppet av fem ulike ting, og
// grensesnittet sier ingenting om hvilken. Denne går gjennom hver eneste
// trykning av et kort og forteller hva som stenger — eller at ingenting gjør
// det, og at problemet ligger et annet sted.
//
//   npm run hvorfor -- "Mox Ruby"

export async function hvorfor(navn: string, logg: (s: string) => void = console.log): Promise<void> {
  const norm = normaliser(navn);
  if (!norm) {
    logg("Oppgi et kortnavn: npm run hvorfor -- \"Mox Ruby\"");
    return;
  }

  const s = await hentSettings();
  const regler = await hentAlleSetRules(s);

  const r = await db().execute({
    sql: `SELECT c.id, c.name, c.set_code, c.collector_number, c.variant, c.rarity,
                 c.usd, c.usd_foil, c.has_nonfoil, c.has_foil,
                 st.name AS set_name, st.released_at
            FROM cards c LEFT JOIN sets st ON st.code = c.set_code
           WHERE c.name_norm = ? OR c.front_norm = ? OR c.name_norm LIKE ?
           ORDER BY st.released_at, c.collector_number`,
    args: [norm, norm, norm + "%"],
  });

  if (!r.rows.length) {
    logg(`Fant ingen kort som heter «${navn}» i katalogen.`);
    logg("Er Scryfall-importen kjørt? npm run import");
    return;
  }

  logg(`\n${r.rows.length} trykninger av «${navn}»`);
  logg(`Kurs ${s.usd_nok} · kjøper ${s.buy_pct} % globalt · bunn ${s.min_buy_ore} øre per kort\n`);

  const nøkler: { card_id: string; finish: string }[] = [];
  for (const x of r.rows as any[]) {
    if (Number(x.has_nonfoil)) nøkler.push({ card_id: String(x.id), finish: "nonfoil" });
    if (Number(x.has_foil)) nøkler.push({ card_id: String(x.id), finish: "foil" });
  }
  const kvoter = await hentKvoterBulk(nøkler);
  const manuelle = await hentManuellePriser((r.rows as any[]).map((x) => String(x.id)));

  let vises = 0;
  for (const x of r.rows as any[]) {
    const settNavn = x.set_name || x.set_code;
    const regel = regler.get(String(x.set_code)) || standardRegel(String(x.set_code), s);

    logg(`── ${settNavn} [${String(x.set_code).toUpperCase()}] #${x.collector_number || "?"} ${x.variant && x.variant !== "vanlig" ? `(${x.variant})` : ""}`);
    logg(`   id ${x.id}`);

    if (!regler.has(String(x.set_code))) {
      logg("   ✗ Settet har ingen regel i det hele tatt — det er aldri satt opp i admin.");
      logg("");
      continue;
    }
    if (!regel.enabled) {
      logg("   ✗ Settet er slått AV i admin. Slå det på under Sett.");
      logg("");
      continue;
    }
    const andel = regel.buy_pct === null ? `${s.buy_pct} % (global)` : `${regel.buy_pct} % (egen sats)`;
    logg(`   sett: på · ønsker ${regel.wanted_default} vanlige, ${regel.wanted_foil} foil · tar imot ${regel.conditions.join(", ")} · betaler ${andel}`);

    for (const finish of ["nonfoil", "foil"] as const) {
      if (finish === "nonfoil" && !Number(x.has_nonfoil)) continue;
      if (finish === "foil" && !Number(x.has_foil)) continue;

      const merke = finish === "foil" ? "foil   " : "vanlig ";
      const oppslag = kvoter.get(`${x.id}:${finish}`);
      const kvote = regnLedig(oppslag, finish, regel);
      const usd = prisenFor(x, finish);
      const manuell = manuelle.get(`${x.id}:${finish}`) ?? null;

      const deler: string[] = [];
      deler.push(`ønsket ${kvote.wanted} (${kvote.kilde})`);
      deler.push(`lager ${kvote.stock}`);
      deler.push(`reservert ${kvote.reserved}`);
      deler.push(`ledig ${kvote.available}`);
      logg(`   ${merke} ${deler.join(" · ")}`);

      const grunner: string[] = [];
      if (kvote.kilde === "kort" && kvote.wanted === 0) {
        grunner.push("kortet har en egen overstyring på 0 — den slår settregelen. Fjern den under Kort.");
      } else if (kvote.wanted === 0) {
        grunner.push(finish === "foil"
          ? "settet har foil-antall 0. Foil arves aldri fra det vanlige antallet."
          : "settet ønsker 0 av dette.");
      }
      if (kvote.wanted > 0 && kvote.available <= 0) {
        grunner.push(`kvoten er brukt opp: ${kvote.stock} på lager og ${kvote.reserved} reservert i aktive ordrer.`);
      }
      const priser = CONDITIONS
        .filter((c) => regel.conditions.includes(c))
        .map((c) => `${c} ${(prisØre(x, finish, c, regel, s, manuell) / 100).toFixed(2)}`);

      if (manuell) {
        logg(`   ${" ".repeat(7)} manuell pris $${manuell} → ${priser.join(" · ")}`);
        logg(`   ${" ".repeat(7)} (Scryfall sier $${usd || "—"}, men den overstyres)`);
      } else if (!usd) {
        grunner.push(finish === "foil"
          ? "Scryfall har ingen foil-pris (usd_foil er tom), og det er ingen manuell pris. Uten pris kan kortet ikke tilbys."
          : "Scryfall har ingen pris (usd er tom), og det er ingen manuell pris. Dette gjelder ofte gamle og sjeldne kort som nesten ikke omsettes — sett prisen selv under Kort.");
      } else {
        logg(`   ${" ".repeat(7)} $${usd} → ${priser.join(" · ") || "ingen conditions satt"}`);
      }

      if ((manuell || usd) && regel.conditions.every((c) => prisØre(x, finish, c, regel, s, manuell) <= 0)) {
        grunner.push(`alle prisene havner under bunnen på ${s.min_buy_ore} øre.`);
      }

      if (grunner.length) {
        for (const g of grunner) logg(`   ${" ".repeat(7)} ✗ ${g}`);
      } else {
        logg(`   ${" ".repeat(7)} ✓ vises i søket`);
        vises++;
      }
    }
    logg("");
  }

  logg(vises
    ? `${vises} av trykningene skal være synlige i søket.`
    : "Ingen av trykningene vises. Grunnene står over hver enkelt.");
}
