import { db, normaliser } from "./db.js";
import { writeFileSync } from "node:fs";

// ─────────────────────────────────────────────────────────────────────────────
// SKRIVEFEILRAPPORT
// ─────────────────────────────────────────────────────────────────────────────
// Produkter som ikke fant kortet sitt, sortert etter hvorfor. «Horrible Awry»
// finnes ingen steder fordi kortet heter «Horribly Awry» — én bokstav. Slike
// bør rettes i Mystore, ikke omgås med uskarp matching: uskarpt nok til å
// fange skrivefeil er også uskarpt nok til å koble feil kort, og da får du
// feil beholdning uten å merke det.

// Levenshtein med tidlig utgang. Vi bryr oss bare om korte avstander, så
// beregningen avbrytes så snart raden er over taket.
function avstand(a: string, b: string, tak: number): number {
  if (Math.abs(a.length - b.length) > tak) return tak + 1;
  let forrige = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const rad = [i];
    let minste = i;
    for (let j = 1; j <= b.length; j++) {
      const kost = a[i - 1] === b[j - 1] ? 0 : 1;
      rad[j] = Math.min(rad[j - 1] + 1, forrige[j] + 1, forrige[j - 1] + kost);
      if (rad[j] < minste) minste = rad[j];
    }
    if (minste > tak) return tak + 1;
    forrige = rad;
  }
  return forrige[b.length];
}

// Tokens ligger i egne token-sett hos Scryfall, ikke i settet de ble trykt
// sammen med. De finnes derfor ikke i katalogen uansett hvor riktig navnet er.
const TOKEN = /\b(token|emblem|checklist|punch ?card|helper card)\b/i;

export type Rad = {
  gruppe: "skrivefeil" | "forslag" | "token" | "ukjent" | "tvetydig";
  produkt: string;
  produktId: string;
  sku: string;
  kategori: string;
  sett: string;
  lager: number;
  foil: boolean;
  forslag: string;
  forslagId: string;
  avstand: number | null;
};

export async function lagSkrivefeilrapport(
  filsti: string,
  logg: (s: string) => void = console.log
): Promise<Rad[]> {
  const u = await db().execute(
    `SELECT product_id, sku, name, stock, category, set_code
       FROM mystore_unmatched ORDER BY set_code, name`
  );
  if (!u.rows.length) {
    logg("Ingen ukoblede produkter — ingenting å rapportere.");
    return [];
  }
  logg(`Undersøker ${u.rows.length} ukoblede produkter…`);

  // Kortnavnene per sett hentes én gang, ikke per produkt.
  const perSett = new Map<string, { norm: string; navn: string; id: string }[]>();
  async function kortISett(kode: string) {
    if (!perSett.has(kode)) {
      const r = await db().execute({
        sql: "SELECT id, name, name_norm, front_norm, back_norm FROM cards WHERE set_code = ?",
        args: [kode],
      });
      const liste: { norm: string; navn: string; id: string }[] = [];
      for (const x of r.rows as any[]) {
        for (const felt of ["name_norm", "front_norm", "back_norm"]) {
          if (x[felt]) liste.push({ norm: String(x[felt]), navn: String(x.name), id: String(x.id) });
        }
      }
      perSett.set(kode, liste);
    }
    return perSett.get(kode)!;
  }

  const rader: Rad[] = [];

  for (const p of u.rows as any[]) {
    const navn = String(p.name || "");
    const sett = String(p.set_code || "");
    const felles = {
      produkt: navn,
      produktId: String(p.product_id),
      sku: String(p.sku || ""),
      kategori: String(p.category || ""),
      sett,
      lager: Number(p.stock || 0),
      foil: /\bfoil\b/i.test(navn),
      forslagId: "",
    };

    if (TOKEN.test(navn)) {
      rader.push({ ...felles, gruppe: "token", forslag: "", avstand: null });
      continue;
    }

    const rent = normaliser(navn.replace(/\bfoil\b/gi, "").replace(/\([^)]*\)/g, ""));
    if (!rent || !sett) {
      rader.push({ ...felles, gruppe: "ukjent", forslag: "", avstand: null });
      continue;
    }

    // Taket skalerer med navnelengden. Det gamle taket på lengde/8 ga ett tegn
    // for «Dawn Angel», som er to tegn fra «Dawn Evangel» — åpenbart samme
    // kort for et menneske, men utenfor grensen. En fjerdedel av navnet
    // fanger den typen feil uten å bli meningsløst løst.
    const tak = Math.min(5, Math.max(1, Math.round(rent.length * 0.25)));
    // Vi leter etter beste treff, men også etter om noe annet er like nær.
    // Er to kort like nær, er forslaget et gjett og ikke en rettelse.
    let beste: { navn: string; d: number; id: string } | null = null;
    const likeNære = new Set<string>();
    for (const k of await kortISett(sett)) {
      const d = avstand(rent, k.norm, tak);
      if (d > tak) continue;
      if (!beste || d < beste.d) {
        beste = { navn: k.navn, d, id: k.id };
        likeNære.clear();
        likeNære.add(k.id);
      } else if (d === beste.d) {
        likeNære.add(k.id);
      }
    }

    if (beste && likeNære.size === 1) {
      // Ett tegn fra et entydig treff er trygt nok til å koble automatisk.
      // Lengre unna er det et forslag du bør se på, ikke en konklusjon.
      rader.push({
        ...felles,
        gruppe: beste.d <= 1 ? "skrivefeil" : "forslag",
        forslag: beste.navn, forslagId: beste.id, avstand: beste.d,
      });
    } else if (beste) {
      rader.push({
        ...felles, gruppe: "tvetydig",
        forslag: `${beste.navn} (og ${likeNære.size - 1} andre like nær)`,
        forslagId: "", avstand: beste.d,
      });
    } else {
      rader.push({ ...felles, gruppe: "ukjent", forslag: "", forslagId: "", avstand: null });
    }
  }

  rader.sort(
    (a, b) =>
      a.gruppe.localeCompare(b.gruppe) ||
      (a.avstand ?? 9) - (b.avstand ?? 9) ||
      b.lager - a.lager ||
      a.produkt.localeCompare(b.produkt, "nb")
  );

  // Semikolon og BOM, så norsk Excel åpner filen riktig uten import-dialog.
  const csv = [
    "Gruppe;Produktnavn i Mystore;Forslag fra katalogen;Avstand;Sett;Kategori;Pa lager;SKU",
    ...rader.map((r) =>
      [r.gruppe, r.produkt, r.forslag, r.avstand ?? "", r.sett.toUpperCase(), r.kategori, r.lager, r.sku]
        .map((f) => `"${String(f).replace(/"/g, '""')}"`)
        .join(";")
    ),
  ].join("\r\n");
  writeFileSync(filsti, "\uFEFF" + csv, "utf8");

  const tell = (g: string) => rader.filter((r) => r.gruppe === g).length;
  logg("");
  logg(`  ${tell("skrivefeil")} er ett tegn fra et entydig kort — kobles automatisk`);
  logg(`  ${tell("forslag")} har et entydig forslag lenger unna — se over dem selv`);
  logg(`  ${tell("tvetydig")} har flere kort like nær — må vurderes for hånd`);
  logg(`  ${tell("token")} er tokens eller lignende, som ikke finnes i katalogen`);
  logg(`  ${tell("ukjent")} har ingen nær match — trolig alternative utgaver og promoer`);
  logg("");
  logg(`Skrevet til ${filsti}`);

  const topp = rader.filter((r) => r.gruppe === "skrivefeil" || r.gruppe === "forslag").slice(0, 15);
  if (topp.length) {
    logg("\nDe mest sannsynlige:");
    for (const r of topp) {
      logg(`  ${r.sett.toUpperCase().padEnd(5)} «${r.produkt}» → «${r.forslag}» (${r.avstand} tegn, ${r.lager} på lager)`);
    }
  }
  return rader;
}
