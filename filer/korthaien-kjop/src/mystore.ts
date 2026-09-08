import { db, normaliser } from "./db.js";
import { byggIndeks, finnSett } from "./settnavn.js";
import { gjettSett } from "./gjett.js";

// ─────────────────────────────────────────────────────────────────────────────
// MYSTORE
// ─────────────────────────────────────────────────────────────────────────────
// Butikken er bygget som et tre: settkategori → raritetskategori → produkter.
// Produktet selv vet ingenting om hvilket sett det tilhører — `sku` er bare et
// løpenummer, og navnet er kortnavnet alene. Settet finnes utelukkende i
// kategorien over.
//
// Derfor går synken gjennom kategorier, ikke produkter: vi bygger treet, finner
// hvilket sett hver gren hører til, og henter så produktene i grenen. Da blir
// kortoppslaget settkode + kortnavn, som er presist.

export function harMystore(): boolean {
  return !!(process.env.MYSTORE_URL && process.env.MYSTORE_KEY);
}

const HODER = () => ({
  Authorization: `Bearer ${process.env.MYSTORE_KEY}`,
  Accept: "application/vnd.api+json",
});

// Mystore struperegulerer. Vi holder en minsteavstand mellom kallene, og
// øker den permanent hvis vi likevel blir avvist — det er billigere å gå litt
// saktere enn å bli stengt ute midt i en jobb.
let minPause = 220;
let sistKall = 0;

async function hent(sti: string, forsøk = 0): Promise<any> {
  const vent = minPause - (Date.now() - sistKall);
  if (vent > 0) await pause(vent);
  sistKall = Date.now();

  const r = await fetch(process.env.MYSTORE_URL + sti, { headers: HODER() });

  if (r.status === 429) {
    if (forsøk >= 6) {
      throw new Error(
        `Mystore avviste ${sti} seks ganger på rad. Vent noen minutter og kjør på nytt — ` +
          `arbeidet som er gjort er lagret.`
      );
    }
    // Server-anvisning først, ellers doblende ventetid.
    const anvist = parseInt(r.headers.get("retry-after") || "0", 10);
    const ventetid = anvist > 0 ? anvist * 1000 : Math.min(60000, 3000 * 2 ** forsøk);
    minPause = Math.min(1500, Math.round(minPause * 1.6));
    console.log(`  · Mystore ba oss vente. Pause i ${Math.round(ventetid / 1000)} s, går saktere videre.`);
    await pause(ventetid);
    return hent(sti, forsøk + 1);
  }

  if (!r.ok) throw new Error(`Mystore svarte ${r.status} på ${sti}`);
  return r.json();
}

function sisteSide(lenker: any): number {
  const m = String(lenker?.last || "").match(/page\[number\]=(\d+)/);
  return m ? parseInt(m[1], 10) : 1;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── kategoritreet ────────────────────────────────────────────────────────────
type Kategori = { id: string; navn: string; forelder: string | null };

async function hentKategorier(logg: (s: string) => void): Promise<Kategori[]> {
  const ut: Kategori[] = [];
  let side = 1;
  let sider = 1;
  while (side <= sider && side <= 60) {
    const d = await hent(`/categories?page[number]=${side}&page[size]=50`);
    for (const c of d.data || []) {
      ut.push({
        id: String(c.id),
        navn: String(c.attributes?.name?.no || c.attributes?.name || ""),
        forelder: c.relationships?.parent?.data?.id ? String(c.relationships.parent.data.id) : null,
      });
    }
    if (side === 1) sider = sisteSide(d.links);
    side++;
  }
  logg(`  ${ut.length} kategorier hentet`);
  return ut;
}

// Klatrer oppover i treet til vi finner en kategori som heter det samme som et
// sett i katalogen. En raritetskategori arver dermed settet fra grenen sin.
function knyttTilSett(
  kategorier: Kategori[],
  indeks: ReturnType<typeof byggIndeks>,
  overstyringer: Map<string, string | null>
) {
  const etterId = new Map(kategorier.map((k) => [k.id, k]));
  const resultat = new Map<string, { set_code: string | null; regel?: string }>();
  const buffer = new Map<string, { code: string; regel: string } | null>();

  // Samme kategorinavn går igjen tusenvis av ganger («Rare», «Common»), så
  // oppslaget bufres.
  const slåOpp = (navn: string) => {
    const n = normaliser(navn);
    if (!buffer.has(n)) {
      const t = finnSett(navn, indeks);
      buffer.set(n, t ? { code: t.code, regel: t.regel } : null);
    }
    return buffer.get(n)!;
  };

  for (const k of kategorier) {
    if (overstyringer.has(k.id)) {
      resultat.set(k.id, { set_code: overstyringer.get(k.id) ?? null, regel: "manuell" });
      continue;
    }
    let node: Kategori | undefined = k;
    let hopp = 0;
    let funnet: { code: string; regel: string } | null = null;
    while (node && hopp < 8) {
      funnet = slåOpp(node.navn);
      if (funnet) break;
      node = node.forelder ? etterId.get(node.forelder) : undefined;
      hopp++;
    }
    resultat.set(k.id, { set_code: funnet?.code || null, regel: funnet?.regel });
  }
  return resultat;
}

// ── produkter i én kategori ──────────────────────────────────────────────────
export type Produkt = { id: string; navn: string; lager: number; sku: string };

export async function hentProdukter(katId: string, maksSider = 40): Promise<Produkt[]> {
  const ut: Produkt[] = [];
  let side = 1;
  let sider = 1;
  while (side <= sider && side <= maksSider) {
    const d = await hent(`/categories/${katId}/products?page[number]=${side}&page[size]=50`);
    for (const p of d.data || []) {
      const a = p.attributes || {};
      ut.push({
        id: String(p.id),
        navn: String(a.name?.no || a.name || ""),
        // quantity_physical er det som faktisk står i hylla. quantity kan være
        // trukket ned av reserverte ordrer som ennå ikke er plukket.
        lager: Number(a.quantity_physical ?? a.quantity ?? 0) || 0,
        sku: String(a.sku || ""),
      });
    }
    if (side === 1) sider = sisteSide(d.links);
    side++;
  }
  return ut;
}

// ── hovedjobb ────────────────────────────────────────────────────────────────
export async function synkMystore(
  logg: (s: string) => void = console.log,
  opts: { alleSett?: boolean } = {}
) {
  if (!harMystore()) {
    logg("MYSTORE_URL/MYSTORE_KEY er ikke satt — hopper over synk. Beholdning regnes som 0.");
    return { kategorier: 0, koblet: 0, ukoblet: 0, sett: 0 };
  }

  const settRader = await db().execute("SELECT code, name FROM sets");
  const indeks = byggIndeks(
    settRader.rows.map((s: any) => ({ code: String(s.code), name: String(s.name) }))
  );

  const lenkeRader = await db().execute(
    "SELECT category_id, set_code FROM mystore_categories WHERE manuell = 1"
  );
  const overstyringer = new Map<string, string | null>(
    lenkeRader.rows.map((r: any) => [String(r.category_id), r.set_code ? String(r.set_code) : null])
  );

  // Settfamilier: hovedsettet pluss alle Scryfall-sett som peker på det.
  // Et kort i «Strixhaven Mystical Archive» ligger fysisk i en Strixhaven-
  // pakke, og butikken selger det som et Strixhaven-kort.
  const familie = await byggFamilier();

  logg("Henter kategorier fra Mystore…");
  const kategorier = await hentKategorier(logg);
  const kobling = knyttTilSett(kategorier, indeks, overstyringer);
  const nå = new Date().toISOString();

  for (let i = 0; i < kategorier.length; i += 200) {
    await db().batch(
      kategorier.slice(i, i + 200).map((k) => ({
        sql: `INSERT INTO mystore_categories (category_id, name, parent_id, set_code, manuell, seen_at)
              VALUES (?, ?, ?, ?, 0, ?)
              ON CONFLICT(category_id) DO UPDATE SET
                name = excluded.name, parent_id = excluded.parent_id,
                set_code = CASE WHEN mystore_categories.manuell = 1
                                THEN mystore_categories.set_code ELSE excluded.set_code END,
                seen_at = excluded.seen_at`,
        args: [k.id, k.navn, k.forelder, kobling.get(k.id)?.set_code || null, nå],
      })),
      "write"
    );
  }

  // Bare sett jeg kjøper fra trenger beholdning. Resten påvirker ingen kvote,
  // og å hente dem ville kostet tusenvis av kall til ingen nytte.
  const aktive = await db().execute("SELECT set_code FROM set_rules WHERE enabled = 1");
  const aktiveSett = new Set(aktive.rows.map((r: any) => String(r.set_code)));

  // Produktene ligger i løvnodene — raritetskategoriene nederst i treet.
  const harBarn = new Set(kategorier.filter((k) => k.forelder).map((k) => k.forelder!));
  const løvnoder = kategorier.filter((k) => !harBarn.has(k.id));
  const utenSett = løvnoder.filter((k) => !kobling.get(k.id)?.set_code).length;

  const skalHentes = løvnoder.filter((k) => {
    const kode = kobling.get(k.id)?.set_code;
    return kode ? opts.alleSett || aktiveSett.has(kode) : false;
  });

  logg(`  ${løvnoder.length} produktkategorier — ${løvnoder.length - utenSett} knyttet til et sett, ${utenSett} uten`);
  const perRegel = new Map<string, number>();
  for (const k of løvnoder) {
    const r = kobling.get(k.id)?.regel;
    if (r) perRegel.set(r, (perRegel.get(r) || 0) + 1);
  }
  if (perRegel.size) {
    logg("  matchet slik: " + [...perRegel].map(([r, n]) => `${r} ${n}`).join(", "));
  }
  if (!skalHentes.length) {
    logg("  Ingen kategorier å hente. Slå på settene du kjøper fra i admin først.");
  }
  logg(`  Henter produkter fra ${skalHentes.length} kategorier…`);

  let koblet = 0;
  const uløste: { p: Produkt; kat: string; setCode: string }[] = [];
  const stockRader: { sql: string; args: any[] }[] = [];
  const settSett = new Set<string>();

  for (let i = 0; i < skalHentes.length; i++) {
    const kat = skalHentes[i];
    const setCode = kobling.get(kat.id)!.set_code!;
    settSett.add(setCode);
    let produkter: Produkt[];
    try {
      produkter = await hentProdukter(kat.id);
    } catch (e: any) {
      logg(`  ⚠ ${kat.navn} (${kat.id}): ${e.message}`);
      continue;
    }

    for (const p of produkter) {
      const foil = /\bfoil\b/i.test(p.navn) || /\bfoil\b/i.test(kat.navn);
      const utenFoil = p.navn.replace(/\bfoil\b/gi, "");
      const rent = utenFoil.replace(/\([^)]*\)/g, "").trim();
      const n = normaliser(rent);
      // Splittkort listes én gang per halvdel: «Determined (Bound/Determined)».
      // Parentesen inneholder hele kortet, og «Bound/Determined» normaliseres
      // likt som Scryfalls «Bound // Determined».
      const iParentes = utenFoil.match(/\(([^)]*\/[^)]*)\)/);
      const helt = iParentes ? normaliser(iParentes[1]) : n;
      // Søk i hele familien, ikke bare hovedsettet. Hovedsettet vinner ved
      // likhet, deretter eldste barn — bonusark kom etter hovedutgivelsen.
      const sett = familie.get(setCode) || [setCode];
      const plass = sett.map(() => "?").join(",");
      const treff = await db().execute({
        sql: `SELECT c.id FROM cards c LEFT JOIN sets s ON s.code = c.set_code
               WHERE c.set_code IN (${plass})
                 AND (c.name_norm = ? OR c.name_norm = ? OR c.front_norm = ? OR c.back_norm = ?)
               ORDER BY (c.set_code = ?) DESC,
                        (c.name_norm = ? OR c.name_norm = ?) DESC,
                        s.released_at ASC
               LIMIT 1`,
        args: [...sett, n, helt, n, n, setCode, n, helt],
      });
      if (!treff.rows[0]) {
        uløste.push({ p, kat: kat.navn, setCode });
        continue;
      }
      koblet++;
      stockRader.push({
        sql: `INSERT INTO mystore_stock (card_id, finish, qty, product_id, synced_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(card_id, finish) DO UPDATE SET
                qty = excluded.qty, product_id = excluded.product_id, synced_at = excluded.synced_at`,
        args: [String(treff.rows[0].id), foil ? "foil" : "nonfoil", p.lager, p.id, nå],
      });
    }
    if ((i + 1) % 25 === 0) logg(`  ${i + 1}/${skalHentes.length} kategorier — ${koblet} koblet`);
  }

  for (let i = 0; i < stockRader.length; i += 300) {
    await db().batch(stockRader.slice(i, i + 300), "write");
  }

  // Lista bygges på nytt hver synk, så koblede produkter forsvinner av seg selv.
  await db().execute("DELETE FROM mystore_unmatched");
  for (let i = 0; i < uløste.length; i += 300) {
    await db().batch(
      uløste.slice(i, i + 300).map(({ p, kat, setCode }) => ({
        sql: `INSERT INTO mystore_unmatched (product_id, sku, name, stock, category, set_code, seen_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(product_id) DO UPDATE SET
                name = excluded.name, stock = excluded.stock, category = excluded.category,
                set_code = excluded.set_code, seen_at = excluded.seen_at`,
        args: [p.id, p.sku, p.navn, p.lager, kat, setCode, nå],
      })),
      "write"
    );
  }

  logg(`Synk ferdig: ${koblet} produkter koblet i ${settSett.size} sett, ${uløste.length} uten treff.`);
  if (uløste.length) {
    logg(`  eksempler: ${uløste.slice(0, 5).map((u) => `${u.p.navn} (${u.setCode})`).join(", ")}`);
    logg("  Koble dem i admin under Kobling.");
  }
  return { kategorier: kategorier.length, koblet, ukoblet: uløste.length, sett: settSett.size };
}

// ─────────────────────────────────────────────────────────────────────────────
// GJETT SETT FOR KATEGORIER UTEN FORELDER
// ─────────────────────────────────────────────────────────────────────────────
// Mystore gir ingen forelder for disse, så vi ser på hva som ligger i dem.
// Bare kategorier med et tydelig flertall kobles automatisk; resten legges
// fram med kandidater du velger mellom.

export async function gjettKategorier(
  logg: (s: string) => void = console.log,
  opts: { bareForeslå?: boolean; maks?: number; påNytt?: boolean } = {}
) {
  if (!harMystore()) {
    logg("MYSTORE_URL/MYSTORE_KEY er ikke satt.");
    return { undersøkt: 0, koblet: 0, usikre: 0 };
  }

  // Kategorier som allerede er analysert hoppes over, så en avbrutt kjøring
  // fortsetter der den slapp i stedet for å bruke kall på det samme igjen.
  const r = await db().execute({
    sql: `SELECT c.category_id, c.name FROM mystore_categories c
           WHERE c.set_code IS NULL AND c.manuell = 0
             AND (c.forslag IS NULL OR ? = 1)
             AND NOT EXISTS (SELECT 1 FROM mystore_categories b WHERE b.parent_id = c.category_id)
           ORDER BY c.category_id`,
    args: [opts.påNytt ? 1 : 0],
  });

  const kandidater = r.rows.slice(0, opts.maks || 500);
  logg(`Undersøker ${kandidater.length} kategorier uten sett…`);

  let koblet = 0;
  let usikre = 0;
  let feilPåRad = 0;
  const nå = new Date().toISOString();

  for (let i = 0; i < kandidater.length; i++) {
    const k: any = kandidater[i];
    let produkter: Produkt[];
    try {
      // To sider holder som stikkprøve. Er 100 kort fra samme sett, er de
      // resterende det også.
      produkter = await hentProdukter(String(k.category_id), 2);
    } catch (e: any) {
      logg(`  ⚠ ${k.name} (${k.category_id}): ${e.message}`);
      feilPåRad++;
      // Fem på rad betyr at det ikke er denne ene kategorien som er problemet.
      if (feilPåRad >= 5) {
        logg("  Stopper her — Mystore slipper oss ikke til. Det som er koblet så langt er lagret.");
        break;
      }
      continue;
    }
    feilPåRad = 0;
    if (!produkter.length) continue;

    const g = await gjettSett(produkter.map((p) => p.navn));
    if (g.sikker && !opts.bareForeslå) {
      await db().execute({
        sql: `UPDATE mystore_categories SET set_code = ?, manuell = 0, gjettet = 1, seen_at = ?
               WHERE category_id = ?`,
        args: [g.sikker.set_code, nå, String(k.category_id)],
      });
      koblet++;
      logg(`  ✓ ${k.name} (${k.category_id}) → ${g.sikker.set_name} — ${g.sikker.treff} av ${g.antallKort} kort`);
    } else {
      usikre++;
      // Kandidatene lagres så koblingsskjermen kan vise dem uten å spørre
      // Mystore på nytt.
      await db().execute({
        sql: "UPDATE mystore_categories SET forslag = ?, seen_at = ? WHERE category_id = ?",
        args: [JSON.stringify(g.kandidater.slice(0, 4)), nå, String(k.category_id)],
      });
    }
    if ((i + 1) % 20 === 0) logg(`  ${i + 1}/${kandidater.length} — ${koblet} koblet`);
  }

  logg(`Ferdig: ${koblet} kategorier koblet automatisk, ${usikre} trenger et valg.`);
  return { undersøkt: kandidater.length, koblet, usikre };
}

// Hovedsett → [hovedsett, ...barn]. Scryfall oppgir forelderen selv, så
// familiene trenger ikke vedlikeholdes for hånd når nye sett kommer.
async function byggFamilier(): Promise<Map<string, string[]>> {
  const r = await db().execute("SELECT code, parent_code FROM sets");
  const kart = new Map<string, string[]>();
  for (const x of r.rows as any[]) {
    const kode = String(x.code);
    if (!kart.has(kode)) kart.set(kode, [kode]);
    const forelder = x.parent_code ? String(x.parent_code) : null;
    if (forelder && forelder !== kode) {
      if (!kart.has(forelder)) kart.set(forelder, [forelder]);
      kart.get(forelder)!.push(kode);
    }
  }
  return kart;
}
