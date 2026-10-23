import { db } from "./db.js";

// ─────────────────────────────────────────────────────────────────────────────
// KREDITTBOKA
// ─────────────────────────────────────────────────────────────────────────────
// Kreditt er en bok, ikke et tall. Saldoen er summen av linjene, og hver
// linje har en grunn. Det er forskjellen på å kunne svare «du fikk 1 240 for
// ordre K-1043 den 12. mars» og å måtte si «det står 1 240, vet ikke hvorfor».
//
// Et tall kan heller ikke rettes uten å lyve. Skriver du over 1 240 med 1 000,
// er de 240 borte uten spor. Her blir det en linje på −240 med en grunn, og
// begge tallene står igjen.
//
// Nøkkelen er e-postadressen i små bokstaver. Det finnes ingen kundekonto
// ennå; adressen er det eneste som følger en kunde fra ordre til ordre. Uten
// normaliseringen ville «Ola@x.no» og «ola@x.no» vært to kunder med hver sin
// saldo, og den feilen oppdages først når noen klager.

export const GRUNNER = {
  kjopsordre: "Oppgjør for kjøpsordre",
  manuell: "Lagt inn manuelt",
  kjop: "Brukt i butikken",
  refusjon: "Refundert til kreditt",
  retting: "Retting",
} as const;

export type Grunn = keyof typeof GRUNNER;

export const normaliserEpost = (e: string) => String(e || "").trim().toLowerCase();

export type Bevegelse = {
  id: number;
  email: string;
  ore: number;
  grunn: string;
  notat: string | null;
  order_no: string | null;
  created_at: string;
};

export async function saldo(email: string): Promise<number> {
  const r = await db().execute({
    sql: "SELECT COALESCE(SUM(ore), 0) AS n FROM kreditt_bevegelser WHERE email = ?",
    args: [normaliserEpost(email)],
  });
  return Number((r.rows[0] as any)?.n || 0);
}

export async function bevegelser(email: string): Promise<Bevegelse[]> {
  const r = await db().execute({
    sql: `SELECT * FROM kreditt_bevegelser WHERE email = ?
           ORDER BY created_at DESC, id DESC`,
    args: [normaliserEpost(email)],
  });
  return r.rows as any[] as Bevegelse[];
}

// Alle som har en linje i boka, med saldo og siste bevegelse. Også de med
// saldo null: en kunde som har brukt opp kreditten sin er fortsatt en kunde,
// og historikken skal kunne finnes fram.
export async function kontoer(q = ""): Promise<
  { email: string; saldo_ore: number; linjer: number; sist: string }[]
> {
  const søk = String(q || "").trim().toLowerCase();
  const r = await db().execute({
    sql: `SELECT email,
                 SUM(ore)        AS saldo_ore,
                 COUNT(*)        AS linjer,
                 MAX(created_at) AS sist
            FROM kreditt_bevegelser
           ${søk ? "WHERE email LIKE ?" : ""}
           GROUP BY email
           ORDER BY sist DESC`,
    args: søk ? [`%${søk}%`] : [],
  });
  return (r.rows as any[]).map((x) => ({
    email: String(x.email),
    saldo_ore: Number(x.saldo_ore || 0),
    linjer: Number(x.linjer || 0),
    sist: String(x.sist || ""),
  }));
}

export type NyBevegelse = {
  email: string;
  ore: number;
  grunn?: Grunn;
  notat?: string | null;
  order_no?: string | null;
};

export async function leggTil(b: NyBevegelse): Promise<Bevegelse> {
  const email = normaliserEpost(b.email);
  if (!email.includes("@")) throw new Error("Trenger en e-postadresse");

  const ore = Math.round(Number(b.ore));
  // Null er ikke en bevegelse. En linje uten beløp sier ingenting og ville
  // bare gjort boka lengre.
  if (!Number.isFinite(ore) || ore === 0) {
    throw new Error("Beløpet må være større eller mindre enn null");
  }

  const grunn = b.grunn && b.grunn in GRUNNER ? b.grunn : "manuell";

  const r = await db().execute({
    sql: `INSERT INTO kreditt_bevegelser (email, ore, grunn, notat, order_no, created_at)
          VALUES (?,?,?,?,?,?) RETURNING *`,
    args: [email, ore, grunn, b.notat?.trim() || null, b.order_no || null, new Date().toISOString()],
  });
  return (r.rows as any[])[0] as Bevegelse;
}

// Saldoen settes ved å bokføre differansen, ikke ved å overskrive. Da står
// både det gamle og det nye tallet igjen, og linjen forteller hvorfor.
export async function settSaldo(
  email: string,
  nyOre: number,
  notat?: string | null
): Promise<Bevegelse | null> {
  const nå = await saldo(email);
  const diff = Math.round(nyOre) - nå;
  if (diff === 0) return null;
  return leggTil({ email, ore: diff, grunn: "retting", notat: notat ?? null });
}
