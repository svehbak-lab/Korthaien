import PDFDocument from "pdfkit";
import { db, hentSettings } from "./db.js";

// ─────────────────────────────────────────────────────────────────────────────
// RAPPORTER
// ─────────────────────────────────────────────────────────────────────────────
// Én kjøring, to utskrifter. Salgslisten og oppsummeringen leser de samme
// radene for samme periode, så summen nederst i listen og tallene i
// oppsummeringen kan ikke komme i utakt.
//
// Oppsummeringen er bilaget i regnskapet. Derfor står det bare det et bilag
// trenger: hvem, hvilken periode, salg med moms og salg uten moms. Momsen på
// kortene beregnes senere etter avansemetoden, og står ikke her.

export type Salgsrad = {
  dato: string; // norsk dato, ÅÅÅÅ-MM-DD
  ordrenr: string;
  kunde: string;
  uten_mva_ore: number;
  med_mva_ore: number;
  // Slik salgslisten viser ordren: beløp uten mva, mvaen, og ordresummen.
  // Beløp uten mva er kortene pluss frakten fratrukket mva.
  eks_mva_ore: number;
  mva_ore: number;
  sum_ore: number;
};

export type Salgsrapport = {
  fra: string;
  til: string;
  rader: Salgsrad[];
  sum: {
    uten_mva_ore: number;
    med_mva_ore: number;
    herav_mva_ore: number;
    eks_mva_ore: number;
    totalt_ore: number;
  };
};

// Frakt og annet med ordinær moms er ført inkludert 25 % mva. Momsen er da
// en femtedel av beløpet. Den regnes av summen, ikke linje for linje, så
// avrundingen skjer én gang.
const MVA_SATS = 0.25;
// Symmetrisk avrunding, så en kreditering gir nøyaktig minus mvaen på salget.
const mvaAv = (inklØre: number) =>
  Math.sign(inklØre) * Math.round((Math.abs(inklØre) * MVA_SATS) / (1 + MVA_SATS));

function beløp(uten: number, med: number) {
  const mva = mvaAv(med);
  const sum = uten + med;
  return { uten_mva_ore: uten, med_mva_ore: med, eks_mva_ore: sum - mva, mva_ore: mva, sum_ore: sum };
}

export function osloDato(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(d);
}

const GYLDIG = /^\d{4}-\d{2}-\d{2}$/;

export function sjekkPeriode(fra: string, til: string): void {
  if (!GYLDIG.test(fra) || !GYLDIG.test(til)) throw new Error("Datoene må være på formen ÅÅÅÅ-MM-DD.");
  if (Number.isNaN(Date.parse(fra)) || Number.isNaN(Date.parse(til))) throw new Error("Ugyldig dato.");
  if (fra > til) throw new Error("Fra-datoen er etter til-datoen.");
}

export async function salgsrapport(fra: string, til: string): Promise<Salgsrapport> {
  sjekkPeriode(fra, til);
  // Tidsstemplene er UTC, perioden er norske datoer. Vi henter et døgn ekstra
  // i hver ende og lar osloDato avgjøre — da havner et salg ti over midnatt
  // norsk tid på riktig dag, sommer som vinter.
  const før = new Date(Date.parse(fra) - 86400000).toISOString();
  const etter = new Date(Date.parse(til) + 2 * 86400000).toISOString();
  const r = await db().execute({
    sql: `SELECT ordrenr, kunde_navn, uten_mva_ore, med_mva_ore, betalt_at
            FROM salgsordrer
           WHERE status IN ('betalt', 'pakket', 'sendt', 'kansellert') AND betalt_at >= ? AND betalt_at < ?
           ORDER BY betalt_at, ordrenr`,
    args: [før, etter],
  });
  // En kansellert ordre er et salg i perioden den ble betalt, og en
  // tilbakeføring i perioden den ble kansellert. Den forsvinner ikke fra den
  // første: en rapport som allerede er levert som bilag, skal ikke endre seg.
  const k = await db().execute({
    sql: `SELECT ordrenr, kunde_navn, uten_mva_ore, med_mva_ore, kansellert_at
            FROM salgsordrer
           WHERE status = 'kansellert' AND kansellert_at >= ? AND kansellert_at < ?`,
    args: [før, etter],
  });

  const rader: Salgsrad[] = [];
  for (const x of r.rows as any[]) {
    const dato = osloDato(String(x.betalt_at));
    if (dato < fra || dato > til) continue;
    rader.push({
      dato,
      ordrenr: String(x.ordrenr),
      kunde: String(x.kunde_navn),
      ...beløp(Number(x.uten_mva_ore) || 0, Number(x.med_mva_ore) || 0),
    });
  }
  for (const x of k.rows as any[]) {
    const dato = osloDato(String(x.kansellert_at));
    if (dato < fra || dato > til) continue;
    rader.push({
      dato,
      ordrenr: `${x.ordrenr} kreditert`,
      kunde: String(x.kunde_navn),
      ...beløp(-(Number(x.uten_mva_ore) || 0), -(Number(x.med_mva_ore) || 0)),
    });
  }
  rader.sort((a, b) => (a.dato === b.dato ? a.ordrenr.localeCompare(b.ordrenr) : a.dato < b.dato ? -1 : 1));

  const uten = rader.reduce((n, x) => n + x.uten_mva_ore, 0);
  const med = rader.reduce((n, x) => n + x.med_mva_ore, 0);
  // Momsen summeres linje for linje, slik den står i listen. Da er summen
  // nederst i listen og tallet i oppsummeringen alltid det samme, øre for øre.
  const mva = rader.reduce((n, x) => n + x.mva_ore, 0);
  return {
    fra,
    til,
    rader,
    sum: { uten_mva_ore: uten, med_mva_ore: med, herav_mva_ore: mva, eks_mva_ore: uten + med - mva, totalt_ore: uten + med },
  };
}

// ── formatering ─────────────────────────────────────────────────────────────
// Skriftene i PDF-en er standardskriftene (Helvetica), som har æ, ø og å men
// ikke det typografiske minustegnet eller smalt mellomrom. Derfor formaterer
// vi selv i stedet for å stole på Intl, som bruker begge.
function kr(øre: number): string {
  const neg = øre < 0;
  const n = Math.abs(Math.round(øre));
  const hele = String(Math.trunc(n / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${neg ? "-" : ""}${hele},${String(n % 100).padStart(2, "0")}`;
}

function norskDato(iso: string): string {
  const [å, m, d] = iso.split("-");
  return `${d}.${m}.${å}`;
}

function periodetekst(fra: string, til: string): string {
  return fra === til ? norskDato(fra) : `${norskDato(fra)} – ${norskDato(til)}`;
}

function nå(): string {
  return new Intl.DateTimeFormat("nb-NO", {
    timeZone: "Europe/Oslo",
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date());
}

function orgnr(s: string): string {
  const n = String(s || "").replace(/\s/g, "");
  return n.length === 9 ? `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}` : n;
}

// PDF-en bygges i minnet. Rapportene er små — selv et år med salg er noen
// hundre linjer — så det er enklere enn å strømme.
function tilBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((ok, feil) => {
    const biter: Buffer[] = [];
    doc.on("data", (b: Buffer) => biter.push(b));
    doc.on("end", () => ok(Buffer.concat(biter)));
    doc.on("error", feil);
    doc.end();
  });
}

const MARG = 50;
const BLEKK = "#111111";
const GRÅ = "#555555";

function nyttDokument(tittel: string): PDFKit.PDFDocument {
  return new PDFDocument({
    size: "A4",
    margins: { top: MARG, bottom: MARG, left: MARG, right: MARG },
    bufferPages: true,
    info: { Title: tittel, Author: "Korthaien", Creator: "Korthaien admin" },
  });
}

function hode(doc: PDFKit.PDFDocument, tittel: string, firma: string, org: string, periode: string) {
  const bredde = doc.page.width - 2 * MARG;
  doc.fillColor(BLEKK).font("Helvetica-Bold").fontSize(18).text(tittel, MARG, MARG);
  doc.moveDown(0.4);
  doc.font("Helvetica").fontSize(10).fillColor(GRÅ);
  doc.text(firma);
  doc.text(`Org.nr. ${org}`);
  doc.moveDown(0.6);
  doc.fillColor(BLEKK).font("Helvetica-Bold").fontSize(11).text(`Periode: ${periode}`);
  doc.moveDown(0.8);
  doc.moveTo(MARG, doc.y).lineTo(MARG + bredde, doc.y).lineWidth(0.8).strokeColor(BLEKK).stroke();
  doc.moveDown(0.8);
}

// Sidetall og genereringstidspunkt på hver side, lagt på til slutt når vi
// vet hvor mange sider det ble.
function fot(doc: PDFKit.PDFDocument) {
  const sider = doc.bufferedPageRange();
  const tid = nå();
  for (let i = 0; i < sider.count; i++) {
    doc.switchToPage(sider.start + i);
    const y = doc.page.height - MARG + 14;
    const bredde = doc.page.width - 2 * MARG;
    // Bunnmargen må ut av veien, ellers lager pdfkit en ny side for teksten.
    const gammel = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(8).fillColor(GRÅ);
    doc.text(`Generert ${tid}`, MARG, y, { width: bredde / 2, lineBreak: false });
    doc.text(`Side ${i + 1} av ${sider.count}`, MARG + bredde / 2, y, {
      width: bredde / 2, align: "right", lineBreak: false,
    });
    doc.page.margins.bottom = gammel;
  }
}

// pdfkit bryter teksten når den får en bredde, selv med lineBreak av, og
// et langt kundenavn la seg oppå raden under. Vi kutter selv i stedet.
function passInn(doc: PDFKit.PDFDocument, tekst: string, bredde: number): string {
  if (doc.widthOfString(tekst) <= bredde) return tekst;
  let t = tekst;
  while (t.length > 1 && doc.widthOfString(t + "…") > bredde) t = t.slice(0, -1);
  return t.trimEnd() + "…";
}

// ── salgslisten ─────────────────────────────────────────────────────────────
export async function salgslistePdf(rapport: Salgsrapport): Promise<Buffer> {
  const s = await hentSettings();
  const firma = s.firmanavn || "Korthaien";
  const org = orgnr(s.org_nr);
  const periode = periodetekst(rapport.fra, rapport.til);
  const doc = nyttDokument(`Salgsliste ${periode}`);

  const bredde = doc.page.width - 2 * MARG;
  // Dato, ordrenr, kunde, uten mva, med mva, sum. Beløpene høyrestilt i
  // like brede kolonner, så kronene står under hverandre.
  const kol = [
    { navn: "Dato", b: 62, h: false },
    { navn: "Ordrenr", b: 70, h: false },
    { navn: "Kunde", b: bredde - 62 - 70 - 3 * 72, h: false },
    { navn: "Uten mva", b: 72, h: true },
    { navn: "Mva", b: 72, h: true },
    { navn: "Sum", b: 72, h: true },
  ];
  const RAD = 16;

  const tabellhode = () => {
    let x = MARG;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(BLEKK);
    const y = doc.y;
    for (const k of kol) {
      doc.text(k.navn, x, y, { width: k.b - (k.h ? 0 : 6), align: k.h ? "right" : "left", lineBreak: false });
      x += k.b;
    }
    doc.y = y + RAD - 3;
    doc.moveTo(MARG, doc.y).lineTo(MARG + bredde, doc.y).lineWidth(0.6).strokeColor(BLEKK).stroke();
    doc.y += 5;
  };

  const rad = (celler: string[], fet = false) => {
    if (doc.y + RAD > doc.page.height - MARG - 10) {
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(10).fillColor(GRÅ)
        .text(`Salgsliste ${periode} (forts.)`, MARG, MARG);
      doc.moveDown(0.8);
      tabellhode();
    }
    let x = MARG;
    const y = doc.y;
    doc.font(fet ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(BLEKK);
    celler.forEach((c, i) => {
      const k = kol[i];
      const w = k.b - (k.h ? 0 : 6);
      doc.text(passInn(doc, c, w), x, y, { width: w, align: k.h ? "right" : "left", lineBreak: false });
      x += k.b;
    });
    doc.y = y + RAD;
  };

  hode(doc, "Salgsliste", firma, org, periode);
  doc.font("Helvetica").fontSize(9).fillColor(GRÅ)
    .text("Beløp i kroner. «Sum» er ordresummen. «Mva» er 25 % mva på frakt og annet med ordinær mva; kortene selges etter avansemetoden og har ingen mva her. «Uten mva» er sum minus mva.", MARG, doc.y, { width: bredde });
  doc.moveDown(1);

  tabellhode();
  if (!rapport.rader.length) {
    doc.font("Helvetica-Oblique").fontSize(9).fillColor(GRÅ).text("Ingen salg i perioden.", MARG, doc.y);
    doc.moveDown(1);
  }
  for (const x of rapport.rader) {
    rad([norskDato(x.dato), x.ordrenr, x.kunde, kr(x.eks_mva_ore), kr(x.mva_ore), kr(x.sum_ore)]);
  }

  doc.y += 2;
  doc.moveTo(MARG, doc.y).lineTo(MARG + bredde, doc.y).lineWidth(0.8).strokeColor(BLEKK).stroke();
  doc.y += 5;
  const n = rapport.rader.length;
  rad(["Sum", `${n} salg`, "", kr(rapport.sum.eks_mva_ore), kr(rapport.sum.herav_mva_ore), kr(rapport.sum.totalt_ore)], true);

  fot(doc);
  return tilBuffer(doc);
}

// ── oppsummeringen ──────────────────────────────────────────────────────────
// Én side. Dette er bilaget.
export async function oppsummeringPdf(rapport: Salgsrapport): Promise<Buffer> {
  const s = await hentSettings();
  const firma = s.firmanavn || "Korthaien";
  const org = orgnr(s.org_nr);
  const periode = periodetekst(rapport.fra, rapport.til);
  const doc = nyttDokument(`Salgsoppsummering ${periode}`);
  const bredde = doc.page.width - 2 * MARG;

  hode(doc, "Salgsoppsummering", firma, org, periode);

  const linje = (tekst: string, beløp: string, opts: { fet?: boolean; liten?: boolean } = {}) => {
    const y = doc.y;
    doc.font(opts.fet ? "Helvetica-Bold" : "Helvetica").fontSize(opts.liten ? 9.5 : 12)
      .fillColor(opts.liten ? GRÅ : BLEKK);
    doc.text(tekst, MARG + (opts.liten ? 14 : 0), y, { width: bredde - 150, lineBreak: false });
    doc.text(beløp, MARG + bredde - 150, y, { width: 150, align: "right", lineBreak: false });
    doc.y = y + (opts.liten ? 17 : 24);
  };

  linje("Salg med mva", `${kr(rapport.sum.med_mva_ore)} kr`);
  linje("herav mva 25 %", `${kr(rapport.sum.herav_mva_ore)} kr`, { liten: true });
  doc.y += 6;
  linje("Salg uten mva", `${kr(rapport.sum.uten_mva_ore)} kr`);
  doc.y += 4;
  doc.moveTo(MARG, doc.y).lineTo(MARG + bredde, doc.y).lineWidth(0.8).strokeColor(BLEKK).stroke();
  doc.y += 10;
  linje("Totalt", `${kr(rapport.sum.totalt_ore)} kr`, { fet: true });

  doc.moveDown(1.5);
  doc.font("Helvetica").fontSize(9).fillColor(GRÅ).text(
    `Grunnlag: ${rapport.rader.length} salg i Korthaiens nettbutikk med betalingsdato i perioden, fratrukket ordrer kreditert i perioden. ` +
      "«Salg med mva» er frakt og annet med ordinær mva, beløpet inkluderer 25 % mva. " +
      "«Salg uten mva» er varer solgt etter avansemetoden; mva av marginen beregnes separat. " +
      "Salgslisten for samme periode viser hvert enkelt salg.",
    MARG, doc.y, { width: bredde, lineGap: 2 }
  );

  fot(doc);
  return tilBuffer(doc);
}
