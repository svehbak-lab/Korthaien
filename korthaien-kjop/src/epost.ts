import { db, hentSettings } from "./db.js";
import { endringslogg, SORTERING } from "./orders.js";

// ─────────────────────────────────────────────────────────────────────────────
// E-POST
// ─────────────────────────────────────────────────────────────────────────────
// Går gjennom Resend, som har et vanlig REST-grensesnitt — ingen ny pakke
// trengs. Alt sendes fra ordre@korthaien.no, men det domenet mottar ikke
// e-post, så svar må styres et sted du faktisk leser.
//
// Ingen e-post får velte en forespørsel. Sendingen kjøres alltid med
// unntakshåndtering: at en ordre kommer inn er viktigere enn at kunden får
// bekreftelsen med én gang.

const NØKKEL = () => process.env.RESEND_KEY || "";
const FRA = () => process.env.EPOST_FRA || "Korthaien <ordre@korthaien.no>";
const SVAR_TIL = () => process.env.EPOST_SVAR || "korthaien@gmail.com";
const MIN_ADRESSE = () => process.env.EPOST_TIL_MEG || "korthaien@gmail.com";
const ADMIN_URL = () => process.env.ADMIN_URL || "https://admin.kortsalg.korthaien.no";

export type Utfall = { sendt: boolean; grunn?: string };

async function send(brev: {
  til: string;
  emne: string;
  html: string;
  tekst: string;
  svarTil?: string;
  // Blindkopi. Ordrebekreftelsene går til deg som kopi av nøyaktig det
  // kunden fikk, så du ser det samme som hen.
  bcc?: string;
}): Promise<Utfall> {
  if (!NØKKEL()) return { sendt: false, grunn: "RESEND_KEY mangler" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${NØKKEL()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FRA(),
        to: [brev.til],
        ...(brev.bcc ? { bcc: [brev.bcc] } : {}),
        reply_to: brev.svarTil || SVAR_TIL(),
        subject: brev.emne,
        html: brev.html,
        text: brev.tekst,
      }),
    });
    if (!r.ok) {
      const tekst = await r.text();
      console.error("E-post avvist av Resend:", r.status, tekst.slice(0, 300));
      return { sendt: false, grunn: `Resend svarte ${r.status}` };
    }
    return { sendt: true };
  } catch (e: any) {
    console.error("E-post feilet:", e?.message);
    return { sendt: false, grunn: e?.message || "ukjent feil" };
  }
}

// ── formatering ──────────────────────────────────────────────────────────────
const kr = (øre: number) => {
  const n = Math.round(Number(øre) || 0);
  const hele = Math.trunc(n / 100);
  const rest = Math.abs(n % 100);
  const tall = new Intl.NumberFormat("nb-NO").format(hele);
  return rest ? `${tall},${String(rest).padStart(2, "0")} kr` : `${tall} kr`;
};

// Kundenavn og kortnavn havner i HTML. Uten dette kan et kortnavn med
// vinkelparenteser velte oppsettet, og et navn med en script-tag er verre.
const trygg = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (t) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[t]!
  );

const RAMME = (innhold: string, undertittel = "Innkjøp fra kunder") => `<!doctype html>
<html lang="nb"><body style="margin:0;background:#f6f5f2;padding:24px 12px;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#22201d">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:10px;padding:28px">
    <div style="font-weight:700;font-size:17px;margin-bottom:2px">Korthaien</div>
    <div style="color:#7a746c;font-size:13px;margin-bottom:20px">${undertittel}</div>
    ${innhold}
    <hr style="border:none;border-top:1px solid #eae7e1;margin:26px 0 14px">
    <div style="color:#7a746c;font-size:12px;line-height:1.6">
      Svar på denne e-posten hvis du lurer på noe — den går rett til meg.<br>
      Korthaien · korthaien.no
    </div>
  </div>
</body></html>`;

function linjetabell(linjer: any[]): string {
  const rader = linjer
    .map(
      (l, i) => `<tr>
      <td style="padding:6px 8px;color:#7a746c;font-size:13px">${i + 1}</td>
      <td style="padding:6px 8px">${trygg(l.card_name)}</td>
      <td style="padding:6px 8px;color:#7a746c;font-size:13px">${trygg(l.set_name)}${
        l.collector_number ? ` #${trygg(l.collector_number)}` : ""
      }${l.finish === "foil" ? " (foil)" : ""}${
        l.rarity ? `<br><span style="font-size:11px">${trygg(l.rarity)}</span>` : ""
      }</td>
      <td style="padding:6px 8px">${trygg(l.condition)}</td>
      <td style="padding:6px 8px;text-align:right">${l.qty_received ?? l.qty}</td>
      <td style="padding:6px 8px;text-align:right;white-space:nowrap">${kr(
        Number(l.unit_ore) * Number(l.qty_received ?? l.qty)
      )}</td>
    </tr>`
    )
    .join("");
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:14px 0">
    <thead><tr style="text-align:left;border-bottom:1px solid #eae7e1;color:#7a746c;font-size:12px">
      <th style="padding:6px 8px">#</th><th style="padding:6px 8px">Kort</th>
      <th style="padding:6px 8px">Utgave</th><th style="padding:6px 8px">Tilstand</th>
      <th style="padding:6px 8px;text-align:right">Antall</th>
      <th style="padding:6px 8px;text-align:right">Sum</th>
    </tr></thead><tbody>${rader}</tbody></table>`;
}

const linjetekst = (linjer: any[]) =>
  linjer
    .map(
      (l, i) =>
        // Uten samlernummeret ser fire utgaver av samme kort helt like ut
        // i lista, med ulik pris og ingen forklaring.
        `${i + 1}. ${l.card_name} — ${l.set_name}${
          l.collector_number ? ` #${l.collector_number}` : ""
        }${l.finish === "foil" ? " (foil)" : ""}${
          l.rarity ? ` [${l.rarity}]` : ""
        }, ${l.condition}, ${l.qty_received ?? l.qty} stk.`
    )
    .join("\n");

// ── bekreftelse til kunden ───────────────────────────────────────────────────
export async function sendBekreftelse(ordre: any): Promise<Utfall> {
  const s = await hentSettings();
  const instruksjoner: string[] = ordre.instruksjoner || [];

  const html = RAMME(`
    <h1 style="font-size:21px;margin:0 0 10px">Takk — salget er registrert</h1>
    <p style="margin:0 0 16px;line-height:1.6">
      Ordrenummeret ditt er <b>${trygg(ordre.order_no)}</b>. Skriv det ut eller ta
      vare på denne e-posten — lista under er også pakkseddelen din.
    </p>
    <div style="background:#f6f5f2;border-radius:8px;padding:14px 16px;margin-bottom:18px">
      <div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#3d7068">Store credit</div>
      <div style="font-size:24px;font-weight:600">${kr(ordre.total_ore)}</div>
      <div style="color:#7a746c;font-size:13px">Anslag — settes endelig når kortene er gjennomgått</div>
    </div>
    <h2 style="font-size:16px;margin:22px 0 8px">Slik gjør du</h2>
    <ol style="margin:0;padding-left:20px;line-height:1.7">
      ${instruksjoner.map((t) => `<li style="margin-bottom:8px">${trygg(t).replace(/\n/g, "<br>")}</li>`).join("")}
    </ol>
    <h2 style="font-size:16px;margin:22px 0 4px">Kortene, i den rekkefølgen de skal ligge</h2>
    <p style="margin:0;color:#7a746c;font-size:13px">Sortert på sett, så kortnavn.</p>
    ${linjetabell(ordre.linjer)}
  `);

  const tekst = `Takk — salget er registrert.

Ordrenummer: ${ordre.order_no}
Store credit: ${kr(ordre.total_ore)} (anslag, settes endelig ved mottak)

SLIK GJØR DU
${instruksjoner.map((t, i) => `${i + 1}. ${t}`).join("\n\n")}

KORTENE, I DEN REKKEFØLGEN DE SKAL LIGGE
${linjetekst(ordre.linjer)}
`;

  return send({
    til: String(ordre.email),
    emne: `Salg registrert — ${ordre.order_no}`,
    html,
    tekst,
  });
}

// ── varsel til meg ───────────────────────────────────────────────────────────
export async function varsleMeg(ordre: any): Promise<Utfall> {
  const antall = ordre.linjer.reduce((n: number, l: any) => n + Number(l.qty), 0);
  const avvist = ordre.avvist?.length || 0;

  const html = RAMME(`
    <h1 style="font-size:21px;margin:0 0 12px">Nytt salg: ${trygg(ordre.order_no)}</h1>
    <table style="font-size:14px;line-height:1.8;margin-bottom:16px">
      <tr><td style="color:#7a746c;padding-right:14px">Kunde</td><td>${trygg(ordre.customer_name)}</td></tr>
      <tr><td style="color:#7a746c;padding-right:14px">E-post</td><td>${trygg(ordre.email)}</td></tr>
      <tr><td style="color:#7a746c;padding-right:14px">Telefon</td><td>${trygg(ordre.phone || "—")}</td></tr>
      <tr><td style="color:#7a746c;padding-right:14px">Kort</td><td>${antall} stk. på ${ordre.linjer.length} linjer</td></tr>
      <tr><td style="color:#7a746c;padding-right:14px">Sum</td><td><b>${kr(ordre.total_ore)}</b></td></tr>
      ${avvist ? `<tr><td style="color:#7a746c;padding-right:14px">Avvist</td><td>${avvist} linjer</td></tr>` : ""}
    </table>
    ${ordre.note ? `<p style="background:#f6f5f2;border-radius:8px;padding:12px 14px;margin:0 0 16px"><b>Melding fra kunden:</b><br>${trygg(ordre.note)}</p>` : ""}
    <p style="margin:0 0 18px">
      <a href="${ADMIN_URL()}" style="background:#22201d;color:#fff;text-decoration:none;
         padding:10px 18px;border-radius:6px;display:inline-block">Åpne i admin</a>
    </p>
    ${linjetabell(ordre.linjer)}
  `);

  return send({
    til: MIN_ADRESSE(),
    emne: `Nytt salg ${kr(ordre.total_ore)} — ${ordre.customer_name}`,
    html,
    tekst: `Nytt salg: ${ordre.order_no}
Kunde: ${ordre.customer_name} · ${ordre.email} · ${ordre.phone || "—"}
${antall} kort på ${ordre.linjer.length} linjer, ${kr(ordre.total_ore)}
${ordre.note ? `\nMelding: ${ordre.note}\n` : ""}
${linjetekst(ordre.linjer)}

${ADMIN_URL()}`,
    // Svar går til kunden. Det er det du oftest vil gjøre fra dette varselet.
    svarTil: String(ordre.email),
  });
}

// ── varsel til deg når en jobb ryker ─────────────────────────────────────────
// Cron-jobber feiler i stillhet med mindre noen ser etter. Med e-post på plass
// koster det ingenting å få beskjed med én gang i stedet for ved en
// tilfeldighet en uke senere.
export async function varsleJobbfeil(jobb: string, feil: unknown): Promise<Utfall> {
  const melding = feil instanceof Error ? feil.message : String(feil);
  const spor = feil instanceof Error && feil.stack ? feil.stack.split("\n").slice(1, 6).join("\n") : "";

  return send({
    til: MIN_ADRESSE(),
    emne: `Jobben «${jobb}» feilet`,
    html: RAMME(`
      <h1 style="font-size:20px;margin:0 0 10px">Jobben «${trygg(jobb)}» feilet</h1>
      <p style="margin:0 0 14px;line-height:1.6">${trygg(melding)}</p>
      ${spor ? `<pre style="background:#f6f5f2;padding:12px;border-radius:8px;font-size:12px;overflow-x:auto">${trygg(spor)}</pre>` : ""}
      <p style="margin:14px 0 0;color:#7a746c;font-size:13px">
        ${new Date().toLocaleString("nb-NO")}
      </p>
    `),
    tekst: `Jobben «${jobb}» feilet.\n\n${melding}\n\n${spor}`,
  });
}

// ── statusendring til kunden ─────────────────────────────────────────────────
const STATUSTEKST: Record<string, { emne: string; tittel: string; brød: string }> = {
  received: {
    emne: "Kortene er mottatt",
    tittel: "Kortene er kommet fram",
    brød: "Jeg går gjennom dem nå og sjekker antall og tilstand. Du hører fra meg igjen når oppgjøret er klart.",
  },
  cancelled: {
    emne: "Salget er kansellert",
    tittel: "Salget er kansellert",
    brød: "Ordren er avsluttet, og kortene er frigjort til andre selgere. Vil du selge likevel, er det bare å legge inn et nytt salg.",
  },
  expired: {
    emne: "Fristen gikk ut",
    tittel: "Fristen gikk ut",
    brød: "Pakken kom ikke fram innen fristen, så kortene er frigjort til andre selgere. Har den kommet i posten likevel, ta kontakt — så ordner vi det.",
  },
};

export async function varsleStatus(orderId: number, status: string): Promise<Utfall> {
  const mal = STATUSTEKST[status];
  if (!mal) return { sendt: false, grunn: "ingen mal for denne statusen" };

  const o = await db().execute({ sql: "SELECT * FROM orders WHERE id = ?", args: [orderId] });
  const ordre: any = o.rows[0];
  if (!ordre?.email) return { sendt: false, grunn: "ordren har ingen e-post" };

  return send({
    til: String(ordre.email),
    emne: `${mal.emne} — ${ordre.order_no}`,
    html: RAMME(`
      <h1 style="font-size:21px;margin:0 0 10px">${mal.tittel}</h1>
      <p style="margin:0 0 14px;line-height:1.6">${mal.brød}</p>
      <p style="margin:0;color:#7a746c;font-size:14px">Ordrenummer ${trygg(ordre.order_no)}</p>
    `),
    tekst: `${mal.tittel}\n\n${mal.brød}\n\nOrdrenummer ${ordre.order_no}`,
  });
}

// ── oppgjør ──────────────────────────────────────────────────────────────────
// Den viktigste e-posten. Koden står øverst, endringene under, og lista til
// slutt for den som vil kontrollere.
export async function sendOppgjør(orderId: number): Promise<Utfall> {
  const o = await db().execute({ sql: "SELECT * FROM orders WHERE id = ?", args: [orderId] });
  const ordre: any = o.rows[0];
  if (!ordre?.email) return { sendt: false, grunn: "ordren har ingen e-post" };
  if (!ordre.discount_code) return { sendt: false, grunn: "ingen rabattkode lagt inn" };

  const l = await db().execute({
    sql: `SELECT * FROM order_lines WHERE order_id = ? AND fjernet_at IS NULL
           ORDER BY ${SORTERING}`,
    args: [orderId],
  });
  const logg = await endringslogg(orderId);
  const lovet = Number(ordre.quoted_ore || 0);
  const nå = Number(ordre.total_ore || 0);

  const endringer = logg.length
    ? `<h2 style="font-size:16px;margin:22px 0 6px">Dette ble endret</h2>
       <p style="margin:0 0 6px;line-height:1.6">Du ble forespeilet ${kr(lovet)}. Etter
       gjennomgangen ble summen ${kr(nå)}.</p>
       <ul style="margin:0;padding-left:20px;line-height:1.7">
         ${logg.map((e) => `<li>${trygg(e.tekst)}</li>`).join("")}
       </ul>`
    : "";

  const html = RAMME(`
    <h1 style="font-size:21px;margin:0 0 10px">Kortene er mottatt og godkjent</h1>
    <p style="margin:0 0 16px;line-height:1.6">Rabattkoden din på korthaien.no er:</p>
    <div style="background:#f6f5f2;border-radius:8px;padding:18px;text-align:center;margin-bottom:8px">
      <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:26px;
                  font-weight:700;letter-spacing:.08em">${trygg(ordre.discount_code)}</div>
      <div style="color:#7a746c;font-size:13px;margin-top:6px">Verdi ${kr(nå)}</div>
    </div>
    <p style="margin:0 0 4px;color:#7a746c;font-size:13px">
      Bruk koden i kassen på korthaien.no. Ordrenummer ${trygg(ordre.order_no)}.
    </p>
    ${ordre.credit_note ? `<p style="margin:14px 0 0;line-height:1.6">${trygg(ordre.credit_note)}</p>` : ""}
    ${endringer}
    <h2 style="font-size:16px;margin:22px 0 4px">Kortene jeg tok imot</h2>
    ${linjetabell(l.rows)}
  `);

  const tekst = `Kortene er mottatt og godkjent.

Rabattkoden din på korthaien.no: ${ordre.discount_code}
Verdi: ${kr(nå)}
Ordrenummer: ${ordre.order_no}
${ordre.credit_note ? `\n${ordre.credit_note}\n` : ""}${
    logg.length
      ? `\nDETTE BLE ENDRET\nDu ble forespeilet ${kr(lovet)}. Etter gjennomgangen ble summen ${kr(nå)}.\n` +
        logg.map((e) => `- ${e.tekst}`).join("\n") + "\n"
      : ""
  }
KORTENE JEG TOK IMOT
${linjetekst(l.rows)}
`;

  return send({ til: String(ordre.email), emne: `Oppgjør — ${ordre.order_no}`, html, tekst });
}

// Kontaktskjemaet på forsiden. Går til meg, med kundens adresse som svar-til,
// så et svar havner der det skal uten at noen må klippe og lime.
//
// Teksten går gjennom trygg() som alt annet: innholdet kommer fra en åpen
// side, og en e-post er HTML.
export async function sendKontakt(inn: {
  navn: string;
  epost: string;
  melding: string;
  emne?: string;
}): Promise<Utfall> {
  const emne = (inn.emne || "").trim() || "Henvendelse fra korthaien.no";
  const html = RAMME(`
    <h1 style="font-size:21px;margin:0 0 12px">${trygg(emne)}</h1>
    <table style="font-size:14px;line-height:1.8;margin-bottom:16px">
      <tr><td style="color:#7a746c;padding-right:14px">Navn</td><td>${trygg(inn.navn)}</td></tr>
      <tr><td style="color:#7a746c;padding-right:14px">E-post</td><td>${trygg(inn.epost)}</td></tr>
    </table>
    <p style="background:#f6f5f2;border-radius:8px;padding:12px 14px;margin:0;white-space:pre-wrap">${trygg(
      inn.melding
    )}</p>
  `);

  return send({
    til: MIN_ADRESSE(),
    emne: `Kontakt: ${emne}`,
    html,
    tekst: `${emne}\n\nNavn: ${inn.navn}\nE-post: ${inn.epost}\n\n${inn.melding}`,
    // Svar går til kunden, ikke til butikkens egen adresse.
    svarTil: inn.epost,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SALG
// ─────────────────────────────────────────────────────────────────────────────
// Bekreftelsen sendes når betalingen er bekreftet, ikke når kassen åpnes. Du
// får den samme e-posten som blindkopi. Linjene står i samme rekkefølge som
// kjøpsordrene — sett, raritet, navn — så du kan plukke etter den.

const FINISH = (f: string) => (f === "foil" ? " (foil)" : "");

function salgslinjer(linjer: any[]): string {
  const rader = linjer
    .map(
      (l, i) => `<tr style="border-bottom:1px solid #f1eee8">
      <td style="padding:6px 8px;color:#7a746c;font-size:13px">${i + 1}</td>
      <td style="padding:6px 8px">${trygg(l.card_name)}${FINISH(l.finish)}${
        l.utgave ? `<br><span style="font-size:12px;color:#7a746c">${trygg(l.utgave)}</span>` : ""
      }</td>
      <td style="padding:6px 8px;color:#7a746c;font-size:13px">${trygg(l.set_name)}${
        l.collector_number ? ` #${trygg(l.collector_number)}` : ""
      }${l.rarity ? `<br><span style="font-size:11px">${trygg(l.rarity)}</span>` : ""}</td>
      <td style="padding:6px 8px">${l.produkt_id != null ? "—" : trygg(l.condition)}</td>
      <td style="padding:6px 8px;text-align:right">${l.antall}</td>
      <td style="padding:6px 8px;text-align:right;white-space:nowrap">${kr(Number(l.enhet_ore) * Number(l.antall))}</td>
    </tr>`
    )
    .join("");
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:14px 0">
    <thead><tr style="text-align:left;border-bottom:1px solid #eae7e1;color:#7a746c;font-size:12px">
      <th style="padding:6px 8px">#</th><th style="padding:6px 8px">Kort</th>
      <th style="padding:6px 8px">Utgave</th><th style="padding:6px 8px">Tilstand</th>
      <th style="padding:6px 8px;text-align:right">Antall</th>
      <th style="padding:6px 8px;text-align:right">Sum</th>
    </tr></thead><tbody>${rader}</tbody></table>`;
}

function summer(o: any): { html: string; tekst: string } {
  const rabatt = Number(o.rabatt_ore) || 0;
  const rader: [string, string][] = [[`Kort (${o.antall_kort} stk.)`, kr(o.varer_ore)]];
  if (rabatt > 0) rader.push([`Rabatt (${o.rabattkode})`, `−${kr(rabatt)}`]);
  rader.push([`Frakt: ${o.frakt_navn}`, kr(o.frakt_ore)]);
  const totalRad = rader.length;
  rader.push(["Totalt", kr(Number(o.varer_ore) - rabatt + Number(o.frakt_ore))]);
  if (Number(o.gavekort_ore) > 0) rader.push([`Betalt med gavekort (${o.rabattkode})`, kr(o.gavekort_ore)]);
  if (Number(o.kreditt_ore) > 0) rader.push(["Betalt med kreditt", kr(o.kreditt_ore)]);
  if (Number(o.stripe_ore) > 0) rader.push(["Betalt med kort/Vipps", kr(o.stripe_ore)]);
  return {
    html: `<table style="width:100%;font-size:14px;margin:4px 0 16px">${rader
      .map(
        ([a, b], i) => `<tr><td style="padding:3px 8px;${i === totalRad ? "font-weight:700" : ""}">${trygg(a)}</td>
        <td style="padding:3px 8px;text-align:right;${i === totalRad ? "font-weight:700" : ""}">${b}</td></tr>`
      )
      .join("")}</table>`,
    tekst: rader.map(([a, b]) => `${a}: ${b}`).join("\n"),
  };
}

const leveringsadresse = (o: any) =>
  [o.kunde_navn, o.adresse, `${o.postnr || ""} ${o.poststed || ""}`.trim(), o.land && o.land !== "NO" ? o.land : ""]
    .filter(Boolean)
    .join("\n");

export async function sendSalgsbekreftelse(ordreId: number): Promise<Utfall> {
  const { hentOrdre } = await import("./salg.js");
  const r = await db().execute({ sql: "SELECT ordrenr FROM salgsordrer WHERE id = ?", args: [ordreId] });
  const o = await hentOrdre(String(r.rows[0]?.ordrenr || ""));
  if (!o) return { sendt: false, grunn: "fant ikke ordren" };
  const s = summer(o);
  const adr = leveringsadresse(o);
  const html = RAMME(
    `<h2 style="font-size:20px;margin:0 0 6px">Takk for bestillingen!</h2>
     <p style="margin:0 0 14px">Ordrenummer <b>${trygg(o.ordrenr)}</b>. Betalingen er mottatt, og jeg pakker
     kortene så snart jeg kan. Du får en ny e-post når pakken er sendt.</p>
     ${salgslinjer(o.linjer)}
     ${s.html}
     <div style="font-size:13px;color:#7a746c;margin-bottom:4px">Sendes til</div>
     <div style="white-space:pre-line;margin-bottom:14px">${trygg(adr)}</div>
     ${o.kunde_notat ? `<div style="font-size:13px;color:#7a746c;margin-bottom:4px">Din kommentar</div>
       <div style="white-space:pre-line;margin-bottom:14px">${trygg(o.kunde_notat)}</div>` : ""}
     <p style="font-size:13px;color:#7a746c;margin:14px 0 0">Kortene selges etter avansemetoden for brukte
     varer, så merverdiavgift er ikke spesifisert for dem. Frakt inkluderer 25 % mva${Number(o.frakt_ore) > 0 ? ` (${kr(Math.round(Number(o.frakt_ore) / 5))})` : ""}.
     Angrerett: 14 dager fra du mottar varene. Korthaien Svein-Harald Bakke, org.nr. 914 503 493.</p>`,
    "Ordrebekreftelse"
  );
  const tekst = [
    `Takk for bestillingen! Ordrenummer ${o.ordrenr}.`,
    "",
    ...o.linjer.map(
      (l: any, i: number) =>
        `${i + 1}. ${l.card_name}${FINISH(l.finish)}${l.utgave ? ` (${l.utgave})` : ""} — ${l.set_name}${l.collector_number ? ` #${l.collector_number}` : ""}${
          l.rarity ? ` [${l.rarity}]` : ""
        }, ${l.condition}, ${l.antall} stk., ${kr(Number(l.enhet_ore) * Number(l.antall))}`
    ),
    "",
    s.tekst,
    "",
    "Sendes til:",
    adr,
  ].join("\n");
  return send({
    til: String(o.email),
    bcc: MIN_ADRESSE(),
    emne: `Ordrebekreftelse ${o.ordrenr} — Korthaien`,
    html,
    tekst,
  });
}

export async function varsleSendt(ordreId: number): Promise<Utfall> {
  const r = await db().execute({ sql: "SELECT * FROM salgsordrer WHERE id = ?", args: [ordreId] });
  const o: any = r.rows[0];
  if (!o) return { sendt: false, grunn: "fant ikke ordren" };
  const spor = o.sporingsnr
    ? `<p>Sporingsnummer: <b>${trygg(o.sporingsnr)}</b>. Du kan følge pakken på
       <a href="https://sporing.posten.no/sporing/${encodeURIComponent(o.sporingsnr)}">posten.no</a>.</p>`
    : "";
  return send({
    til: String(o.email),
    emne: `Ordre ${o.ordrenr} er sendt — Korthaien`,
    html: RAMME(
      `<h2 style="font-size:20px;margin:0 0 6px">Pakken er på vei</h2>
       <p>Ordre <b>${trygg(o.ordrenr)}</b> er levert til posten med ${trygg(String(o.frakt_navn || "").toLowerCase())}.</p>
       ${spor}`,
      "Ordren er sendt"
    ),
    tekst: `Ordre ${o.ordrenr} er sendt med ${o.frakt_navn}.${o.sporingsnr ? ` Sporingsnummer: ${o.sporingsnr}.` : ""}`,
  });
}

export async function sendTilbakestilling(email: string, lenke: string): Promise<Utfall> {
  return send({
    til: email,
    emne: "Nytt passord — Korthaien",
    html: RAMME(
      `<h2 style="font-size:20px;margin:0 0 6px">Lag et nytt passord</h2>
       <p>Trykk på knappen for å velge et nytt passord. Lenken virker i én time, og bare én gang.</p>
       <p style="margin:20px 0"><a href="${trygg(lenke)}" style="background:#22201d;color:#fff;padding:10px 18px;
         border-radius:6px;text-decoration:none;font-weight:600">Velg nytt passord</a></p>
       <p style="font-size:13px;color:#7a746c">Ba du ikke om dette, kan du se bort fra e-posten. Ingenting endres
       før noen bruker lenken.</p>`,
      "Kundekonto"
    ),
    tekst: `Velg et nytt passord her (virker i én time): ${lenke}\n\nBa du ikke om dette, kan du se bort fra e-posten.`,
  });
}

export async function sendBekreftEpost(email: string, lenke: string): Promise<Utfall> {
  return send({
    til: email,
    emne: "Bekreft e-postadressen — Korthaien",
    html: RAMME(
      `<h2 style="font-size:20px;margin:0 0 6px">Bekreft e-postadressen din</h2>
       <p>Trykk på knappen for å bekrefte at adressen er din. Da følger kreditten og tidligere ordrer på
       adressen med kontoen. Lenken virker i et døgn.</p>
       <p style="margin:20px 0"><a href="${trygg(lenke)}" style="background:#22201d;color:#fff;padding:10px 18px;
         border-radius:6px;text-decoration:none;font-weight:600">Bekreft adressen</a></p>
       <p style="font-size:13px;color:#7a746c">Lagde du ikke en konto hos Korthaien, kan du se bort fra e-posten.
       Uten bekreftelse får ingen tilgang til kreditten eller ordrene dine.</p>`,
      "Kundekonto"
    ),
    tekst: `Bekreft e-postadressen din her (virker i et døgn): ${lenke}\n\nLagde du ikke en konto, kan du se bort fra e-posten.`,
  });
}

// Ønskelista: kortene kunden ventet på, er på lager.
export async function sendØnskelisteVarsel(email: string, kort: { navn: string; url: string; finish: string }[]): Promise<Utfall> {
  const linjer = kort
    .map((k) => `<li style="margin:4px 0"><a href="${trygg(k.url)}">${trygg(k.navn)}</a>${k.finish === "foil" ? " (foil)" : k.finish === "nonfoil" ? " (ikke foil)" : ""}</li>`)
    .join("");
  return send({
    til: email,
    emne: kort.length === 1 ? `${kort[0].navn} er på lager — Korthaien` : `${kort.length} kort fra ønskelista er på lager — Korthaien`,
    html: RAMME(
      `<h2 style="font-size:20px;margin:0 0 6px">Nå er det inne</h2>
       <p>${kort.length === 1 ? "Kortet" : "Kortene"} du ba om beskjed for, er på lager hos Korthaien:</p>
       <ul style="padding-left:18px">${linjer}</ul>
       <p style="font-size:13px;color:#7a746c">Det er førstemann til mølla. Du kan fjerne kort fra ønskelista under «Min side».</p>`,
      "Ønskeliste"
    ),
    tekst: `På lager hos Korthaien:\n${kort.map((k) => `- ${k.navn}: ${k.url}`).join("\n")}`,
  });
}
