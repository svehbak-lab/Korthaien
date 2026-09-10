-- ─────────────────────────────────────────────────────────────────────────────
-- KORTHAIEN KJØP — skjema
-- ─────────────────────────────────────────────────────────────────────────────

-- Alle MTG-sett, importert fra Scryfall.
CREATE TABLE IF NOT EXISTS sets (
  code         TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  released_at  TEXT,
  card_count   INTEGER DEFAULT 0,
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
