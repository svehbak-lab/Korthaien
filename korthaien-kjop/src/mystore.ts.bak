import { db, normaliser } from "./db.js";

// ─────────────────────────────────────────────────────────────────────────────
// MYSTORE
// ─────────────────────────────────────────────────────────────────────────────
// Beholdningen din avgjør hvor mange kort en kunde får selge. Nøkkelen bor
// kun her på serveren — den skal aldri nær nettleseren, slik den gjør i KARDEX.
//
// Produktene kobles til katalogen ved å utlede sett og nummer fra SKU. Nå som
// hele Scryfall-katalogen ligger lokalt, er det et rent databaseoppslag.

export function harMystore(): boolean {
  return !!(process.env.MYSTORE_URL && process.env.MYSTORE_KEY);
}

type Produkt = { id: string; sku: string; name: string; stock: number };

async function hentProdukter(logg: (s: string) => void): Promise<Produkt[]> {
  const base = process.env.MYSTORE_URL!;
  const key = process.env.MYSTORE_KEY!;
  const alle: Produkt[] = [];
  let side = 1;
  let sider = 1;

  while (side <= sider && side <= 200) {
    const r = await fetch(`${base}/products?page[number]=${side}&page[size]=50`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/vnd.api+json" },
    });
    if (!r.ok) throw new Error(`Mystore svarte ${r.status}`);
    const data: any = await r.json();
    const bolk = Array.isArray(data.data) ? data.data : [];
    if (!bolk.length) break;
    for (const p of bolk) {
      alle.push({
        id: String(p.id),
        sku: String(p.attributes?.sku || ""),
        name: String(p.attributes?.name?.no || p.attributes?.name || ""),
        stock: parseInt(p.attributes?.stock || 0, 10) || 0,
      });
    }
    if (side === 1 && data.links?.last) {
      const m = String(data.links.last).match(/page\[number\]=(\d+)/);
      if (m) sider = parseInt(m[1], 10);
    }
    logg(`  side ${side}/${sider} — ${alle.length} produkter`);
    side++;
    await new Promise((r) => setTimeout(r, 200));
  }
  return alle;
}

// Samme utledning som utgavefiksen i KARDEX, men validert mot vår egen
// katalog i stedet for mot Scryfall over nett.
async function løsKort(p: Produkt): Promise<{ card_id: string; finish: string } | null> {
  const foil = /\bfoil\b/i.test(p.name) || /\bfoil\b/i.test(p.sku);
  const finish = foil ? "foil" : "nonfoil";
  const tokens = p.sku.split(/[^A-Za-z0-9]+/).filter(Boolean);

  let kode: string | null = null;
  let nummer: string | null = null;
  for (const t of tokens) {
    if (/^\d{1,4}[a-z]?$/i.test(t)) nummer = t.toLowerCase();
    else if (/[A-Za-z]/.test(t) && t.length <= 6) kode = t.toLowerCase();
  }

  if (kode && nummer) {
    const r = await db().execute({
      sql: "SELECT id FROM cards WHERE set_code = ? AND lower(collector_number) = ? LIMIT 1",
      args: [kode, nummer],
    });
    if (r.rows[0]) return { card_id: String(r.rows[0].id), finish };
  }

  if (kode && p.name) {
    const rent = p.name.replace(/\bfoil\b/i, "").replace(/\([^)]*\)/g, "").trim();
    const r = await db().execute({
      sql: "SELECT id FROM cards WHERE set_code = ? AND name_norm = ? LIMIT 1",
      args: [kode, normaliser(rent)],
    });
    if (r.rows[0]) return { card_id: String(r.rows[0].id), finish };
  }

  // Uten settkode nekter vi å gjette. Feil kobling her ville gitt feil
  // kvote, og dermed kort du ikke ville ha.
  return null;
}

export async function synkMystore(logg: (s: string) => void = console.log) {
  if (!harMystore()) {
    logg("MYSTORE_URL/MYSTORE_KEY er ikke satt — hopper over synk. Beholdning regnes som 0.");
    return { produkter: 0, koblet: 0, ukoblet: 0 };
  }
  logg("Henter produkter fra Mystore…");
  const produkter = await hentProdukter(logg);

  const nå = new Date().toISOString();
  let koblet = 0;
  const ukoblet: string[] = [];
  const setninger: { sql: string; args: any[] }[] = [];

  for (const p of produkter) {
    const treff = await løsKort(p);
    if (!treff) {
      ukoblet.push(p.sku || p.name);
      continue;
    }
    koblet++;
    setninger.push({
      sql: `INSERT INTO mystore_stock (card_id, finish, qty, product_id, synced_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(card_id, finish) DO UPDATE SET
              qty = excluded.qty, product_id = excluded.product_id, synced_at = excluded.synced_at`,
      args: [treff.card_id, treff.finish, p.stock, p.id, nå],
    });
  }

  for (let i = 0; i < setninger.length; i += 300) {
    await db().batch(setninger.slice(i, i + 300), "write");
  }

  logg(`Synk ferdig: ${koblet} koblet, ${ukoblet.length} uten treff.`);
  if (ukoblet.length) logg(`  eksempler uten treff: ${ukoblet.slice(0, 5).join(", ")}`);
  return { produkter: produkter.length, koblet, ukoblet: ukoblet.length };
}
