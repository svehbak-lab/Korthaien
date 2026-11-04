// Katalogen i butikken er offentlig, og roboter blar i den. Et søk i hele
// katalogen (uten navn eller sett) tar et par sekunder å regne ut. Kommer
// mange slike samtidig, havner kundenes navnesøk i kø bak dem — 4. november
// tok et søk på «grim mon» 46 sekunder mens en prisskraper og en
// søkemotorrobot gikk gjennom katalogen.
//
// To grep:
//
//   1. Samme spørring innen et minutt får samme svar, uten ny utregning.
//      Robotene spør om den samme forsiden igjen og igjen. Spørringer som
//      allerede er i gang, deles: ti like på én gang gir én utregning.
//
//   2. Tunge spørringer (hele katalogen) går én om gangen i sin egen kø.
//      Lette spørringer (navnesøk, ett sett) går forbi. Da kan roboter bare
//      vente på hverandre, ikke på kundene.

const LEVETID_MS = 60_000;
const MAKS_LAGRET = 400;
const TUNGE_SAMTIDIG = 1;

type Oppføring = { t: number; svar: Promise<any> };
const lager = new Map<string, Oppføring>();

let tungeIGang = 0;
const venter: (() => void)[] = [];

async function iTungKø<T>(f: () => Promise<T>): Promise<T> {
  if (tungeIGang >= TUNGE_SAMTIDIG) await new Promise<void>((r) => venter.push(r));
  tungeIGang++;
  try {
    return await f();
  } finally {
    tungeIGang--;
    venter.shift()?.();
  }
}

export function erTung(f: { q?: string; sett?: string; ider?: unknown }): boolean {
  return !String(f.q || "").trim() && !String(f.sett || "").trim() && !f.ider;
}

export function katalogMedKø<T>(filter: Record<string, unknown>, regnUt: () => Promise<T>, nå = Date.now()): Promise<T> {
  const nøkkel = JSON.stringify(Object.keys(filter).sort().map((k) => [k, filter[k] ?? null]));
  const funnet = lager.get(nøkkel);
  if (funnet && nå - funnet.t < LEVETID_MS) return funnet.svar;

  const svar = erTung(filter as any) ? iTungKø(regnUt) : regnUt();
  lager.set(nøkkel, { t: nå, svar });
  // En feil skal ikke huskes; neste spørring prøver på nytt.
  svar.catch(() => { if (lager.get(nøkkel)?.svar === svar) lager.delete(nøkkel); });
  if (lager.size > MAKS_LAGRET) {
    for (const [k, v] of lager) {
      if (nå - v.t >= LEVETID_MS || lager.size > MAKS_LAGRET) lager.delete(k);
      if (lager.size <= MAKS_LAGRET * 0.8) break;
    }
  }
  return svar;
}

// Når lageret endres (salg, innlegging), skal neste søk vise det med en gang.
export function glemKatalog(): void {
  lager.clear();
}
