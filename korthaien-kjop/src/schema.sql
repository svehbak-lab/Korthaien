-- ─────────────────────────────────────────────────────────────────────────────
-- KORTHAIEN KJØP — skjema
-- ─────────────────────────────────────────────────────────────────────────────

-- Alle MTG-sett, importert fra Scryfall.
CREATE TABLE IF NOT EXISTS sets (
  code         TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  released_at  TEXT,
  card_count   INTEGER DEFAULT 0,
  -- Ditt eget navn på settet, der Scryfalls offisielle er upraktisk. Kundene
  -- sier «Beta», ikke «Limited Edition Beta». Scryfall-navnet blir stående i
  -- «name», så importen kan fortsette å oppdatere det uten å røre ditt.
  visningsnavn TEXT,
  -- Scryfall splitter én utgivelse i flere sett: «The Brothers War» blir bro,
  -- brr (Retro Artifacts), brc (Commander) og abro (Art Series). Butikker
  -- holder dem samlet under hovedsettet, slik kundene tenker om dem.
  -- parent_code er Scryfalls egen kobling mellom dem.
  parent_code  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sets_parent ON sets(parent_code);

-- Én rad per trykk av et kort. Foil og vanlig deler rad, men har egen pris.
CREATE TABLE IF NOT EXISTS cards (
  id                TEXT PRIMARY KEY,       -- Scryfall-ID
  oracle_id         TEXT NOT NULL,          -- samme kort på tvers av sett
  name              TEXT NOT NULL,
  name_norm         TEXT NOT NULL,          -- for søk: små bokstaver, uten tegn
  -- Dobbeltsidige kort heter «Akki Lavarunner // Tok-Tok, Volcano Born» hos
  -- Scryfall, men butikker og kunder bruker forsiden alene. Uten denne
  -- kolonnen finner de aldri hverandre.
  front_norm        TEXT,
  -- ...og baksiden. Butikker lister splittkort én gang per halvdel:
  -- «Determined (Bound/Determined)» er samme kort som «Bound // Determined».
  back_norm         TEXT,
  -- Hvilken versjon av kortet dette er: vanlig, extended, borderless,
  -- showcase, etched, fullart. Butikken skiller dem med et tilleggsord i
  -- navnet, Scryfall med egne rader og egen pris.
  variant           TEXT NOT NULL DEFAULT 'vanlig',
  set_code          TEXT NOT NULL,
  collector_number  TEXT,
  rarity            TEXT,
  usd               REAL,                   -- vanlig
  usd_foil          REAL,
  has_nonfoil       INTEGER NOT NULL DEFAULT 1,
  has_foil          INTEGER NOT NULL DEFAULT 0,
  image_uri         TEXT,
  -- Kortopplysninger fra Scryfall. Brukes til produktside og filtermeny; de
  -- påvirker ikke pris eller kvote. Dobbeltsidige kort har tekst og kostnad
  -- per side, ikke på kortet, så halvdelene slås sammen ved import.
  type_line         TEXT,
  oracle_text       TEXT,
  mana_cost         TEXT,
  cmc               REAL,
  colors            TEXT,
  color_identity    TEXT,
  power             TEXT,
  toughness         TEXT,
  loyalty           TEXT,
  keywords          TEXT,
  artist            TEXT,
  legalities        TEXT,
  reserved          INTEGER NOT NULL DEFAULT 0,
  -- Tokens og emblemer selges, men kjøpes aldri inn.
  er_token          INTEGER NOT NULL DEFAULT 0,
  -- Serienummererte kort. Unike eksemplarer med trykt nummer; prisen sier
  -- ingenting om hva et vanlig eksemplar er verdt.
  er_serialized     INTEGER NOT NULL DEFAULT 0,
  -- Tykk displayutgave av en commander (Scryfalls promo-type «thick»).
  er_display        INTEGER NOT NULL DEFAULT 0,
  er_scroll         INTEGER NOT NULL DEFAULT 0,
  released_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_cards_name    ON cards(name_norm);
CREATE INDEX IF NOT EXISTS idx_cards_front   ON cards(front_norm);
CREATE INDEX IF NOT EXISTS idx_cards_back    ON cards(back_norm);
CREATE INDEX IF NOT EXISTS idx_cards_variant ON cards(set_code, name_norm, variant);
CREATE INDEX IF NOT EXISTS idx_cards_set     ON cards(set_code, collector_number);
CREATE INDEX IF NOT EXISTS idx_cards_oracle  ON cards(oracle_id);

-- Hva jeg vil ha, satt per sett. Gjelder alle kort i settet med mindre
-- kortet har en egen overstyring i card_wants.
--   conditions: JSON-liste, f.eks. ["NM","EX"]
--   ladder:     JSON-objekt, f.eks. {"NM":100,"EX":85} — prosent av kjøpsprisen
CREATE TABLE IF NOT EXISTS set_rules (
  set_code        TEXT PRIMARY KEY,
  enabled         INTEGER NOT NULL DEFAULT 0,
  wanted_default  INTEGER NOT NULL DEFAULT 0,
  wanted_foil     INTEGER NOT NULL DEFAULT 0,
  conditions      TEXT,
  ladder          TEXT,
  -- Hvor stor andel av markedsprisen du betaler for et Near Mint-eksemplar
  -- fra dette settet. NULL betyr at den globale satsen gjelder. Trappen er
  -- relativ til denne, ikke til markedsprisen.
  buy_pct         REAL,
  updated_at      TEXT NOT NULL
);

-- Overstyring for enkeltkort. Finish skilles, siden foil og vanlig er
-- forskjellige varer med helt ulik verdi.
-- Manuell markedspris på enkeltkort, i dollar. Erstatter Scryfall-prisen for
-- akkurat dette kortet og ellers ingenting: kurs, buy_pct og trappen for
-- settet gjelder som før. For reservelistekort er indeksene for tynne til å
-- stoles på, og da henter du tallet fra en butikk som faktisk selger dem.
-- Engangskode for admin. Én rad, id alltid 1. Hemmeligheten er base32 og
-- deles bare i oppsettsøyeblikket. confirmed_at settes først når du har
-- bevist at appen virker — ellers kunne en halvferdig skanning låst deg ute.
CREATE TABLE IF NOT EXISTS admin_totp (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  secret        TEXT NOT NULL,
  confirmed_at  TEXT,
  updated_at    TEXT NOT NULL
);

-- Reservekoder for tapt telefon. Lagres som hash, brukes én gang hver.
CREATE TABLE IF NOT EXISTS admin_backup_codes (
  hash       TEXT PRIMARY KEY,
  used_at    TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS card_prices (
  card_id     TEXT NOT NULL,
  finish      TEXT NOT NULL CHECK (finish IN ('nonfoil','foil')),
  usd         REAL NOT NULL,
  kilde       TEXT,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (card_id, finish)
);

-- Tilstander du tar imot for ett bestemt kort, når settets regel er for grov.
-- Noen kort i et sett er verdt å ta i dårlig stand selv om resten ikke er det.
-- Varelageret føres som bevegelser. Beholdningen er summen av dem. Se
-- kommentaren øverst i lager.ts for hvorfor.
CREATE TABLE IF NOT EXISTS lager_bevegelser (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id     TEXT NOT NULL,
  finish      TEXT NOT NULL CHECK (finish IN ('nonfoil','foil')),
  condition   TEXT NOT NULL,
  -- Fortegn: positivt inn, negativt ut.
  antall      INTEGER NOT NULL,
  grunn       TEXT NOT NULL,
  order_id    INTEGER,
  notat       TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lager_kort  ON lager_bevegelser (card_id, finish, condition);
CREATE INDEX IF NOT EXISTS idx_lager_ordre ON lager_bevegelser (order_id);

-- Utsalgspris per raritet og dollarintervall. Et rare til under 0,90 dollar
-- koster det samme uansett om markedet sier 0,20 eller 0,80.
CREATE TABLE IF NOT EXISTS salg_intervaller (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  rarity     TEXT NOT NULL,
  usd_fra    REAL NOT NULL,
  -- NULL betyr «og oppover».
  usd_til    REAL,
  -- Enten en fast pris, eller en faktor å gange markedsprisen med. Faste
  -- priser virker i den nedre enden; over et par dollar må prisen følge
  -- markedet, ellers trengs det hundre intervaller.
  pris_ore   INTEGER NOT NULL DEFAULT 0,
  faktor     REAL,
  -- Hvordan grunnprisen rundes: '5opp', '9opp', 'krone' eller 'ingen'.
  avrunding  TEXT,
  updated_at TEXT NOT NULL
);

-- Manuell utsalgspris for Near Mint. Trappen regner ut de andre tilstandene.
CREATE TABLE IF NOT EXISTS card_sale_prices (
  card_id    TEXT NOT NULL,
  finish     TEXT NOT NULL CHECK (finish IN ('nonfoil','foil')),
  nm_ore     INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (card_id, finish)
);

CREATE TABLE IF NOT EXISTS card_conditions (
  card_id     TEXT PRIMARY KEY,
  conditions  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS card_wants (
  card_id     TEXT NOT NULL,
  finish      TEXT NOT NULL CHECK (finish IN ('nonfoil','foil')),
  wanted      INTEGER NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (card_id, finish)
);

-- Speil av beholdningen i Mystore. Fylles av synkjobben.
CREATE TABLE IF NOT EXISTS mystore_stock (
  card_id       TEXT NOT NULL,
  finish        TEXT NOT NULL,
  qty           INTEGER NOT NULL DEFAULT 0,
  product_id    TEXT,
  -- Navn og kategori lagres så du kan se hvilket produkt kortet faktisk er
  -- koblet til. Uten dem er en kobling bare en ID, og da kan du ikke
  -- kontrollere om den er riktig.
  product_name  TEXT,
  category      TEXT,
  synced_at     TEXT NOT NULL,
  -- Sist antallet økte: når kortet kom inn. synced_at skrives om for alle
  -- kort hver natt og sier derfor ingenting om hva som er nytt.
  inn_at        TEXT,
  PRIMARY KEY (card_id, finish)
);

-- Ordrer. En ordre reserverer kvote fra den sendes inn til kortene er lagt
-- inn i Mystore, ellers kan to kunder selge meg samme siste eksemplar.
--   pending   ventet i posten, holder kvote
--   received  kommet fram og kontrollert, holder fortsatt kvote fordi
--             beholdningen i Mystore ennå ikke er oppdatert
--   stocked   lagerført i Mystore — nå overtar mystore_stock tellingen
CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no       TEXT NOT NULL UNIQUE,
  -- Satt når kortene er lagt inn i Mystore. Til da holder ordren kvoten,
  -- uavhengig av om kunden har fått oppgjøret sitt. De to tingene skjer til
  -- ulik tid, og kvoten må følge hyllene, ikke pengene.
  kvote_frigitt_at TEXT,
  customer_name  TEXT NOT NULL,
  email          TEXT NOT NULL,
  phone          TEXT,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','received','stocked','cancelled','expired')),
  total_nok      INTEGER NOT NULL DEFAULT 0,
  total_ore      INTEGER NOT NULL DEFAULT 0,
  quoted_ore     INTEGER NOT NULL DEFAULT 0,
  -- Tidspunktet kunden krysset av for vilkår og alder. Selve haken er verdiløs
  -- som bevis; det som betyr noe er at spørsmålet ble stilt, og når.
  vilkar_godtatt TEXT,
  note           TEXT,
  admin_note     TEXT,
  discount_code  TEXT,
  credit_note    TEXT,
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  received_at    TEXT,
  credit_sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);

-- Linjene fryser navn, sett og pris slik de var da ordren ble sendt.
-- Scryfall-prisen endrer seg daglig, og kunden skal ha det hen ble lovet.
CREATE TABLE IF NOT EXISTS order_lines (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  card_id           TEXT NOT NULL,
  finish            TEXT NOT NULL,
  condition         TEXT NOT NULL,
  qty               INTEGER NOT NULL,
  unit_nok          INTEGER NOT NULL,
  unit_ore          INTEGER NOT NULL DEFAULT 0,
  unit_ore_start    INTEGER NOT NULL DEFAULT 0,
  condition_start   TEXT,
  -- 'kunde' er linjer fra innsendingen, 'admin' er linjer du la til ved
  -- mottak fordi kunden sendte noe annet enn hen trodde.
  -- Kopieres fra kortet ved innsending. Uten den kan ikke lista sorteres på
  -- sjeldenhet, og en ny Scryfall-import kunne endret den under føttene på
  -- en ordre som allerede er sendt.
  rarity            TEXT,
  -- Utgaven kunden oppga, hvis du har byttet den ved mottak. Uten den kan
  -- ikke endringsloggen fortelle hva som ble byttet fra.
  set_name_start    TEXT,
  kilde             TEXT NOT NULL DEFAULT 'kunde',
  -- Linjer slettes ikke. En fjernet linje er en del av forklaringen kunden
  -- skal få, og et slettet rad kan ikke forklare noe.
  fjernet_at        TEXT,
  card_name         TEXT NOT NULL,
  set_code          TEXT NOT NULL,
  set_name          TEXT NOT NULL,
  collector_number  TEXT,
  qty_received      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_lines_order ON order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_lines_card  ON order_lines(card_id, finish);

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- Produkter fra Mystore som synken ikke klarte å koble til et kort.
-- Uten denne lista ser «jeg har ingen» og «jeg klarte ikke koble» helt like
-- ut for systemet, men de betyr stikk motsatt ting for kvoten.
CREATE TABLE IF NOT EXISTS mystore_unmatched (
  product_id  TEXT PRIMARY KEY,
  sku         TEXT,
  name        TEXT,
  stock       INTEGER NOT NULL DEFAULT 0,
  category    TEXT,
  set_code    TEXT,
  seen_at     TEXT NOT NULL
);

-- Kategoritreet i butikken. Settet ligger i en foreldrekategori, ikke i
-- produktet, så denne tabellen er det som knytter produkter til sett.
-- manuell = 1 betyr at du har rettet koblingen selv, og da lar synken den være.
CREATE TABLE IF NOT EXISTS mystore_categories (
  category_id  TEXT PRIMARY KEY,
  name         TEXT,
  parent_id    TEXT,
  set_code     TEXT,
  manuell      INTEGER NOT NULL DEFAULT 0,
  -- gjettet = settet er utledet fra kortene i kategorien, ikke fra navnet
  gjettet      INTEGER NOT NULL DEFAULT 0,
  -- forslag = kandidater fra innholdsanalysen, når den ikke var sikker nok
  forslag      TEXT,
  seen_at      TEXT NOT NULL
);

-- Manuelle koblinger. Disse overstyrer SKU-utledningen og huskes på tvers av
-- synker, så en jobb du har gjort én gang aldri må gjøres om igjen.
CREATE TABLE IF NOT EXISTS mystore_links (
  product_id  TEXT PRIMARY KEY,
  card_id     TEXT,
  finish      TEXT,
  ignored     INTEGER NOT NULL DEFAULT 0,
  -- Hvor koblingen kom fra: 'manuell', 'auto-skrivefeil' eller 'auto-token'.
  -- Automatiske koblinger kan angres samlet; manuelle røres aldri.
  kilde       TEXT,
  updated_at  TEXT NOT NULL
);

-- Hvilke kort som er sjekket, og når. Rotasjonen leser denne: aldri sjekkede
-- først, så de som har ventet lengst.
CREATE TABLE IF NOT EXISTS kupp_sjekk (
  card_id       TEXT NOT NULL,
  finish        TEXT NOT NULL,
  sist_sjekket  TEXT,
  siste_status  TEXT,
  PRIMARY KEY (card_id, finish)
);

-- Funnene. Et tilbud som forsvinner slettes ikke, det får borte_at — at et
-- kupp ble tatt er også opplysning. forst_sett viser hvor lenge det har ligget.
CREATE TABLE IF NOT EXISTS kupp_treff (
  card_id          TEXT NOT NULL,
  finish           TEXT NOT NULL,
  shop             TEXT NOT NULL,
  url              TEXT NOT NULL,
  shop_name        TEXT,
  tittel           TEXT,
  pris_ore         INTEGER NOT NULL,
  frakt_ore        INTEGER,
  condition        TEXT,
  collector_number TEXT,
  in_stock         INTEGER,
  salg_ore         INTEGER NOT NULL,
  marked_ore       INTEGER,
  avvik_pct        INTEGER NOT NULL,
  usikker          INTEGER NOT NULL DEFAULT 0,
  forst_sett       TEXT NOT NULL,
  sist_sett        TEXT NOT NULL,
  borte_at         TEXT,
  PRIMARY KEY (card_id, finish, shop, url)
);

CREATE INDEX IF NOT EXISTS idx_kupp_avvik ON kupp_treff (borte_at, avvik_pct DESC);

-- Dine egne priser der de spriker fra det salgspris.ts mener kortet er verdt.
-- avvik_pct er fortegnsbærende: positivt = priset for lavt, negativt = for høyt.
CREATE TABLE IF NOT EXISTS kupp_egen (
  card_id TEXT NOT NULL,
  finish TEXT NOT NULL,
  url TEXT NOT NULL,
  tittel TEXT,
  pris_ore INTEGER NOT NULL,
  salg_ore INTEGER NOT NULL,
  marked_ore INTEGER,
  condition TEXT,
  collector_number TEXT,
  antall INTEGER,
  avvik_pct INTEGER NOT NULL,
  usikker INTEGER NOT NULL DEFAULT 0,
  forst_sett TEXT NOT NULL,
  sist_sett TEXT NOT NULL,
  borte_at TEXT,
  PRIMARY KEY (card_id, finish, url));

CREATE INDEX IF NOT EXISTS idx_kupp_egen ON kupp_egen (borte_at, avvik_pct);

-- Daglig øyeblikksbilde av lageret, skrevet av lagersynken. Grunnlaget for
-- utviklingskurven i Lagerrapport. Beløp i øre, som alt annet.
CREATE TABLE IF NOT EXISTS lager_historikk (
  dato TEXT PRIMARY KEY,
  antall INTEGER NOT NULL DEFAULT 0,
  antall_foil INTEGER NOT NULL DEFAULT 0,
  verdi_ore INTEGER NOT NULL DEFAULT 0,
  verdi_foil_ore INTEGER NOT NULL DEFAULT 0,
  butikk_kort INTEGER NOT NULL DEFAULT 0,
  butikk_ore INTEGER NOT NULL DEFAULT 0,
  malt_at TEXT);

-- Fraktalternativene kunden velger mellom i kassen. Prisen og
-- forsikringsgrensen står her og ikke i koden, fordi Posten endrer dem og du
-- skal slippe en utrulling for å rette et tall.
--
-- forsikret_ore er NULL for sendinger uten sporing og forsikring. Null og
-- NULL er to ulike ting her: 0 ville betydd «forsikret for ingenting».
CREATE TABLE IF NOT EXISTS frakt_alternativer (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  navn          TEXT NOT NULL,
  pris_ore      INTEGER NOT NULL,
  forsikret_ore INTEGER,
  beskrivelse   TEXT,
  sortering     INTEGER NOT NULL DEFAULT 0,
  -- Alternativer slettes ikke, de slås av. En ordre som er sendt med et
  -- alternativ skal fortsatt kunne vise hva den ble sendt med.
  aktiv         INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL);

-- Kreditt er en bok, ikke et tall. Saldoen er summen av linjene, og hver
-- linje har en grunn — ellers kan verken du eller kunden svare på hvor en
-- saldo kom fra. Det var hele poenget med at folk skal kunne følge summer
-- inn og ut.
--
-- Nøkkelen er e-postadressen i små bokstaver. Det finnes ingen kundekonto
-- ennå; adressen er det eneste som følger en kunde fra ordre til ordre.
CREATE TABLE IF NOT EXISTS kreditt_bevegelser (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  -- Positivt inn, negativt ut. Aldri null — en linje uten beløp sier
  -- ingenting og ville bare gjort boka lengre.
  ore        INTEGER NOT NULL,
  grunn      TEXT NOT NULL,
  notat      TEXT,
  order_no   TEXT,
  created_at TEXT NOT NULL);

CREATE INDEX IF NOT EXISTS idx_kreditt_epost ON kreditt_bevegelser (email, created_at);

-- ─────────────────────────────────────────────────────────────────────────
-- EGNE PRODUKTER
-- ─────────────────────────────────────────────────────────────────────────
-- Sealed og komplette sett. De står her og ikke i cards fordi alt i cards
-- kommer fra Scryfall: settkode, samlernummer, raritet, og en nattlig
-- prisimport som overskriver. En boosterboks har ingen av delene. Legges
-- den inn der, må kjøpslista, prisintervallene og importen alle lære seg å
-- hoppe over den — en lekkasje som aldri tetter seg.
--
-- Antallet står som et tall og ikke som bevegelser slik kortene har det.
-- Bevegelsestabellen er nøklet på card_id og finnes fordi kjøpslista må
-- kunne svare på hvor hvert eksemplar kom fra. Et produkt kjøpes ikke inn
-- av kunder, så den historikken har ingen å svare for.
CREATE TABLE IF NOT EXISTS produkter (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 'sealed' eller 'komplettsett'.
  type        TEXT NOT NULL,
  navn        TEXT NOT NULL,
  beskrivelse TEXT,
  pris_ore    INTEGER NOT NULL,
  antall      INTEGER NOT NULL DEFAULT 0,
  bilde_url   TEXT,
  -- Valgfri kobling til et sett, slik at produktet kan vises på settsiden.
  set_code    TEXT,
  -- Komplette sett: foil eller ikke. Uten eget bilde tegnes bildet ut fra
  -- settet og dette flagget.
  foil        INTEGER NOT NULL DEFAULT 0,
  sortering   INTEGER NOT NULL DEFAULT 0,
  -- Produkter slettes ikke mens de kan stå på en ordre. De slås av.
  aktiv       INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL);

CREATE INDEX IF NOT EXISTS idx_produkter_type ON produkter (type, aktiv, sortering);

-- ─────────────────────────────────────────────────────────────────────────
-- SALGSORDRER
-- ─────────────────────────────────────────────────────────────────────────
-- Salg i Korthaiens egen butikk. Tabellen finnes før kassen, fordi
-- rapportene bygges først: kassen fyller den, rapportene leser den.
--
-- Beløpene er delt etter moms og ikke etter hva de er betaling for. Det er
-- det regnskapet spør om:
--   uten_mva_ore  varer solgt etter avansemetoden (kortene). Momsen
--                 beregnes senere av marginen, ikke av salgsprisen.
--   med_mva_ore   alt med ordinær moms, inkludert momsen (i dag frakten).
-- Kassen kan gjerne føre frakt og varer i egne kolonner i tillegg; disse to
-- er det rapportene summerer.
--
-- Et salg teller den dagen det er betalt (betalt_at, UTC), regnet om til
-- norsk dato. En ordre som aldri blir betalt, er aldri et salg.
CREATE TABLE IF NOT EXISTS salgsordrer (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ordrenr       TEXT NOT NULL UNIQUE,
  kunde_navn    TEXT NOT NULL,
  email         TEXT,
  uten_mva_ore  INTEGER NOT NULL DEFAULT 0,
  med_mva_ore   INTEGER NOT NULL DEFAULT 0,
  -- apen       kassen er åpnet, kortene er holdt av til utloper_at
  -- betalt     betalingen er bekreftet; ordren venter på pakking
  -- pakket     plukket og pakket, ikke levert til posten
  -- sendt      levert til posten
  -- kansellert avbrutt etter betaling, pengene tilbake som kreditt
  -- utlopt     kassen ble forlatt; reservasjonen er frigitt
  status        TEXT NOT NULL DEFAULT 'apen',
  betalt_at     TEXT,
  created_at    TEXT NOT NULL,
  -- NULL for gjestekjøp.
  kunde_id      INTEGER,
  telefon       TEXT,
  adresse       TEXT,
  postnr        TEXT,
  poststed      TEXT,
  land          TEXT,
  frakt_id      INTEGER,
  frakt_navn    TEXT,
  frakt_ore     INTEGER NOT NULL DEFAULT 0,
  varer_ore     INTEGER NOT NULL DEFAULT 0,
  -- Hvordan summen ble betalt. kreditt_ore + stripe_ore = varer + frakt.
  kreditt_ore   INTEGER NOT NULL DEFAULT 0,
  stripe_ore    INTEGER NOT NULL DEFAULT 0,
  -- Rabattkode brukt på ordren. Prosentkoder gir rabatt_ore (trukket fra
  -- kortene); gavekort-koder betaler gavekort_ore av totalen, som kreditt.
  rabattkode    TEXT,
  rabatt_ore    INTEGER NOT NULL DEFAULT 0,
  gavekort_ore  INTEGER NOT NULL DEFAULT 0,
  stripe_session TEXT,
  -- Betalingen hos Stripe (payment_intent). Trengs for å refundere til kortet.
  stripe_betaling TEXT,
  utloper_at    TEXT,
  antall_kort   INTEGER NOT NULL DEFAULT 0,
  pakket_at     TEXT,
  sendt_at      TEXT,
  kansellert_at TEXT,
  sporingsnr    TEXT,
  kunde_notat   TEXT,
  admin_notat   TEXT);

-- Linjene fryser navn, sett og pris slik de var da kassen ble åpnet. Prisene
-- i butikken endrer seg med importen; kunden skal betale det hen ble vist.
CREATE TABLE IF NOT EXISTS salgsordre_linjer (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ordre_id         INTEGER NOT NULL REFERENCES salgsordrer(id) ON DELETE CASCADE,
  card_id          TEXT NOT NULL,
  finish           TEXT NOT NULL,
  condition        TEXT NOT NULL,
  antall           INTEGER NOT NULL,
  enhet_ore        INTEGER NOT NULL,
  card_name        TEXT NOT NULL,
  set_code         TEXT NOT NULL,
  set_name         TEXT NOT NULL,
  collector_number TEXT,
  rarity           TEXT);

CREATE INDEX IF NOT EXISTS idx_salgslinjer_ordre ON salgsordre_linjer (ordre_id);
CREATE INDEX IF NOT EXISTS idx_salgslinjer_kort ON salgsordre_linjer (card_id, finish, condition);
CREATE INDEX IF NOT EXISTS idx_salgsordrer_kunde ON salgsordrer (kunde_id, created_at);
CREATE INDEX IF NOT EXISTS idx_salgsordrer_epost ON salgsordrer (email, created_at);
CREATE INDEX IF NOT EXISTS idx_salgsordrer_stripe ON salgsordrer (stripe_session);

-- Månedstallene for salgsdashbordet, skrevet ned når måneden er over. De
-- kan regnes ut av ordrene, men et tall som er logget, står selv om en ordre
-- senere kanselleres eller rettes — det er det du sammenligner med.
CREATE TABLE IF NOT EXISTS salg_statistikk (
  maaned        TEXT PRIMARY KEY,
  omsetning_ore INTEGER NOT NULL,
  ordrer        INTEGER NOT NULL,
  kort          INTEGER NOT NULL,
  logget_at     TEXT NOT NULL);

-- ─────────────────────────────────────────────────────────────────────────
-- KUNDEKONTO
-- ─────────────────────────────────────────────────────────────────────────
-- Kontoen er e-postadressen. Det er den kjøpssiden allerede bruker, og den
-- kredittboka er nøklet på — så en kunde som har solgt til deg før, har
-- kreditten sin første gang hen logger inn.
--
-- Passordet lagres aldri, bare et scrypt-hash av det. En kunde som bare
-- bruker Google, har ingen passord_hash i det hele tatt.
CREATE TABLE IF NOT EXISTS kunder (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  email             TEXT NOT NULL UNIQUE,
  navn              TEXT NOT NULL DEFAULT '',
  passord_hash      TEXT,
  google_sub        TEXT UNIQUE,
  -- Satt når kunden har vist at hen eier adressen: lenken i e-posten,
  -- «glemt passord» eller Google. Før det følger verken kreditten eller
  -- gjesteordrene på adressen med kontoen.
  epost_bekreftet_at TEXT,
  telefon           TEXT,
  adresse           TEXT,
  postnr            TEXT,
  poststed          TEXT,
  land              TEXT NOT NULL DEFAULT 'NO',
  created_at        TEXT NOT NULL,
  sist_inne_at      TEXT,
  -- Hvor kontoen kom fra: 'konto' (registrert her) eller 'mystore'
  -- (importert fra kundelisten i Mystore, uten passord).
  kilde             TEXT NOT NULL DEFAULT 'konto',
  nyhetsbrev        INTEGER NOT NULL DEFAULT 0,
  mystore_ordrer    INTEGER,
  mystore_ordreverdi_ore INTEGER,
  mystore_sist_inne TEXT);

-- Sesjonen er et tilfeldig token i en cookie; her ligger bare et hash av
-- det. Lekker tabellen, kan ingen logge inn med det som står her.
CREATE TABLE IF NOT EXISTS kunde_sesjoner (
  token_hash  TEXT PRIMARY KEY,
  kunde_id    INTEGER NOT NULL REFERENCES kunder(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL);

-- Engangslenker for nytt passord. Samme grunn til å lagre hash.
CREATE TABLE IF NOT EXISTS kunde_tokens (
  token_hash  TEXT PRIMARY KEY,
  kunde_id    INTEGER NOT NULL REFERENCES kunder(id) ON DELETE CASCADE,
  formaal     TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  brukt_at    TEXT);

CREATE INDEX IF NOT EXISTS idx_kunde_sesjoner_kunde ON kunde_sesjoner (kunde_id);

CREATE INDEX IF NOT EXISTS idx_salgsordrer_betalt ON salgsordrer (status, betalt_at);

-- ─────────────────────────────────────────────────────────────────────────
-- ORDRENUMMER
-- ─────────────────────────────────────────────────────────────────────────
-- Fortløpende numre: K-00034 for kjøpsordrer, S-15000 for salgsordrer. Et
-- nummer deles ut med én UPDATE ... RETURNING, så to ordrer i samme øyeblikk
-- aldri får det samme. Ordrene fra før beholder numrene de har — kundene
-- har dem i e-postene sine.
--
-- Startverdiene settes bare første gang (INSERT OR IGNORE). Telleren
-- fortsetter derfra, også etter omstart.
CREATE TABLE IF NOT EXISTS nummerserier (
  navn    TEXT PRIMARY KEY,
  prefiks TEXT NOT NULL,
  neste   INTEGER NOT NULL,
  -- Antall siffer, fylt ut med nuller foran. 0 betyr ingen utfylling.
  siffer  INTEGER NOT NULL DEFAULT 0);

INSERT OR IGNORE INTO nummerserier (navn, prefiks, neste, siffer) VALUES ('kjop', 'K-', 34, 5);
INSERT OR IGNORE INTO nummerserier (navn, prefiks, neste, siffer) VALUES ('salg', 'S-', 15000, 0);

-- ─────────────────────────────────────────────────────────────────────────
-- BILDER
-- ─────────────────────────────────────────────────────────────────────────
-- Bilder du laster opp selv, som toppbildet på forsiden. De ligger i
-- databasen fordi det ikke finnes noen fillagring ved siden av den, og de
-- er få og små. Et bilde endres aldri: et nytt bilde får ny id, så det kan
-- mellomlagres i nettleseren for alltid.
CREATE TABLE IF NOT EXISTS bilder (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  mime       TEXT NOT NULL,
  data       BLOB NOT NULL,
  bredde     INTEGER,
  hoyde      INTEGER,
  created_at TEXT NOT NULL);

-- Rabattkoder. To slags:
--   saldo   — gavekort: et beløp som brukes ned over flere kjøp. Saldoen er
--             summen av bevegelsene, som kreditten. Premier i turneringer,
--             gamle koder fra Mystore.
--   prosent — kampanje: en prosent av kortene, valgfritt med siste dag og
--             et tak på antall bruk.
-- Kodene er ikke knyttet til noen konto. Den som har koden, kan bruke den.
CREATE TABLE IF NOT EXISTS rabattkoder (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kode        TEXT NOT NULL UNIQUE,
  type        TEXT NOT NULL CHECK (type IN ('saldo', 'prosent')),
  prosent     INTEGER,
  gyldig_til  TEXT,
  maks_bruk   INTEGER,
  aktiv       INTEGER NOT NULL DEFAULT 1,
  merknad     TEXT,
  created_at  TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS rabattkode_bevegelser (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kode_id     INTEGER NOT NULL REFERENCES rabattkoder(id),
  ore         INTEGER NOT NULL,
  grunn       TEXT NOT NULL,
  notat       TEXT,
  ordrenr     TEXT,
  created_at  TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS rabattkode_bevegelser_kode ON rabattkode_bevegelser(kode_id);
