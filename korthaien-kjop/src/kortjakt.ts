// Klient mot MTG Kortjakts MCP-server: https://www.mtgkortjakt.no/mcp
//
// Serveren er gratis, drevet av én person, og spør butikkene live for hvert
// oppslag. Ett kall herfra blir sju forespørsler ut — én til hver butikk,
// Korthaien inkludert. Derfor går jobben i rotasjon med pause mellom hvert
// kort, og derfor stopper den når Kortjakt sier at budsjettet er brukt opp.
//
// Protokollen er JSON-RPC. Svaret kommer som server-sent events, altså
// «event: message» og «data: {…}» — ikke rå JSON — så det må pakkes ut.

const URL_MCP = process.env.KORTJAKT_URL || "https://www.mtgkortjakt.no/mcp";

export type Tilbud = {
  tittel: string | null;
  pris_ore: number;
  frakt_ore: number | null;
  in_stock: boolean | null;
  antall: number | null;
  condition: string | null;
  set_name: string | null;
  collector_number: string | null;
  foil: boolean | null;
  url: string | null;
};

export type ButikkSvar = {
  shop: string;
  shop_name: string | null;
  // ok | no_match = butikken ble spurt. no_budget | timeout | busy | error =
  // den ble ikke sjekket, og da vet vi ingenting om den — det er noe annet
  // enn at den ikke har kortet, og må ikke forveksles.
  status: string;
  spurt: boolean;
  tilbud: Tilbud[];
};

export type SøkSvar = {
  kort: string;
  navnBekreftet: boolean;
  butikker: ButikkSvar[];
  // Butikker som ikke ble sjekket denne gangen. Er denne ikke tom, er
  // resultatet ufullstendig og kortet bør sjekkes igjen senere.
  usjekkede: string[];
};

const SPURT = new Set(["ok", "no_match"]);

const kr = (n: unknown): number | null => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) : null;
};

// Kortjakt svarer med text/event-stream. Hver melding er en «data:»-linje.
// Vi tar den siste som lar seg tolke som JSON — en feilmelding kommer samme
// vei, og da er det den vi vil ha.
export function pakkUtSSE(tekst: string): any {
  const biter = tekst
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .filter(Boolean);
  if (!biter.length) {
    // Noen oppsett svarer med rå JSON i stedet. Prøv det før vi gir opp.
    try {
      return JSON.parse(tekst);
    } catch {
      throw new Error(`Kortjakt svarte uten data-linje: ${tekst.slice(0, 200)}`);
    }
  }
  for (let i = biter.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(biter[i]);
    } catch {
      /* prøv neste */
    }
  }
  throw new Error(`Kortjakt svarte med ugyldig JSON: ${biter[0].slice(0, 200)}`);
}

// structuredContent er samme data som content[0].text, men ferdig tolket.
// Den foretrekkes; tekstblokken er reserven for om feltet forsvinner.
export function hentNyttelast(svar: any): any {
  if (svar?.error) {
    throw new Error(`Kortjakt: ${svar.error.message || JSON.stringify(svar.error)}`);
  }
  const r = svar?.result;
  if (!r) throw new Error("Kortjakt svarte uten result");
  if (r.structuredContent) return r.structuredContent;
  const tekst = r.content?.find((c: any) => c.type === "text")?.text;
  if (tekst) return JSON.parse(tekst);
  return r;
}

export function tolkSøk(n: any): SøkSvar {
  const butikker: ButikkSvar[] = (n?.shops || []).map((b: any) => {
    const status = String(b.status || "ukjent");
    return {
      shop: String(b.shop || ""),
      shop_name: b.shop_name ? String(b.shop_name) : null,
      status,
      spurt: SPURT.has(status),
      tilbud: (b.offers || []).map(
        (t: any): Tilbud => ({
          tittel: t.title ? String(t.title) : null,
          pris_ore: kr(t.price_nok) ?? 0,
          frakt_ore: kr(t.shipping_nok),
          in_stock: typeof t.in_stock === "boolean" ? t.in_stock : null,
          antall: t.quantity == null ? null : Number(t.quantity),
          condition: t.condition ? String(t.condition) : null,
          set_name: t.set_name ? String(t.set_name) : null,
          collector_number: t.collector_number == null ? null : String(t.collector_number),
          foil: typeof t.foil === "boolean" ? t.foil : null,
          url: t.url ? String(t.url) : null,
        })
      ),
    };
  });

  return {
    kort: String(n?.card || ""),
    navnBekreftet: n?.name_verified !== false,
    butikker,
    usjekkede: butikker.filter((b) => !b.spurt).map((b) => b.shop),
  };
}

async function kall(metode: string, params: any, tidsgrense = 30000): Promise<any> {
  const avbryt = AbortSignal.timeout(tidsgrense);
  const r = await fetch(URL_MCP, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      // Så Anton ser hvem som spør, og kan ta kontakt i stedet for å blokkere.
      "User-Agent": process.env.KORTJAKT_UA || "Korthaien-kuppjakt (korthaien.no)",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: metode, params }),
    signal: avbryt,
  });
  if (!r.ok) throw new Error(`Kortjakt svarte ${r.status} på ${metode}`);
  return hentNyttelast(pakkUtSSE(await r.text()));
}

export async function søkKort(opts: {
  navn: string;
  sett?: string;
  foil?: boolean;
  minCondition?: string;
  utland?: boolean;
  maksPerButikk?: number;
}): Promise<SøkSvar> {
  const args: any = { card: opts.navn };
  if (opts.sett) args.set = opts.sett;
  if (typeof opts.foil === "boolean") args.foil = opts.foil;
  if (opts.minCondition) args.min_condition = opts.minCondition;
  if (opts.utland) args.include_foreign = true;
  args.max_offers_per_shop = opts.maksPerButikk ?? 5;
  return tolkSøk(await kall("tools/call", { name: "search_card", arguments: args }));
}

export async function butikker(): Promise<any> {
  return kall("tools/call", { name: "list_shops", arguments: {} });
}
