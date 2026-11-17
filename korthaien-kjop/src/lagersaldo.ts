import { db } from "./db.js";

// ─────────────────────────────────────────────────────────────────────────────
// LAGERSALDO
// ─────────────────────────────────────────────────────────────────────────────
// Lagerboken er bevegelser, og beholdningen er summen av dem. Det er riktig
// regnskap, men dyrt å spørre: hver side i butikken summerte hele boken, og
// Turso tar betalt per rad som leses. I november ga det 1–2 milliarder leste
// rader i døgnet.
//
// lager_saldo er summen, ferdig regnet: én rad per kort, finish og tilstand.
// Triggere på lager_bevegelser holder den oppdatert, så ingen kode som fører
// bevegelser trenger å vite om den. sist_inn er siste gang noe kom INN —
// det «Nyeste» sorterer på.
//
// Triggere kan ikke stå i schema.sql: migreringen splitter på semikolon, og
// en trigger har semikolon inni seg.

const TRIGGERE = [
  `CREATE TRIGGER IF NOT EXISTS lager_saldo_inn AFTER INSERT ON lager_bevegelser BEGIN
     INSERT INTO lager_saldo (card_id, finish, condition, antall, sist_inn)
     VALUES (NEW.card_id, NEW.finish, NEW.condition, NEW.antall,
             CASE WHEN NEW.antall > 0 THEN NEW.created_at END)
     ON CONFLICT (card_id, finish, condition) DO UPDATE SET
       antall = antall + excluded.antall,
       sist_inn = CASE WHEN excluded.sist_inn IS NOT NULL
                        AND (sist_inn IS NULL OR excluded.sist_inn > sist_inn)
                       THEN excluded.sist_inn ELSE sist_inn END;
   END`,
  `CREATE TRIGGER IF NOT EXISTS lager_saldo_ut AFTER DELETE ON lager_bevegelser BEGIN
     UPDATE lager_saldo SET antall = antall - OLD.antall
      WHERE card_id = OLD.card_id AND finish = OLD.finish AND condition = OLD.condition;
   END`,
  `CREATE TRIGGER IF NOT EXISTS lager_saldo_endret AFTER UPDATE ON lager_bevegelser BEGIN
     UPDATE lager_saldo SET antall = antall - OLD.antall
      WHERE card_id = OLD.card_id AND finish = OLD.finish AND condition = OLD.condition;
     INSERT INTO lager_saldo (card_id, finish, condition, antall, sist_inn)
     VALUES (NEW.card_id, NEW.finish, NEW.condition, NEW.antall,
             CASE WHEN NEW.antall > 0 THEN NEW.created_at END)
     ON CONFLICT (card_id, finish, condition) DO UPDATE SET antall = antall + excluded.antall;
   END`,
];

const BYGG = [
  { sql: "DELETE FROM lager_saldo", args: [] },
  {
    sql: `INSERT INTO lager_saldo (card_id, finish, condition, antall, sist_inn)
          SELECT card_id, finish, condition, SUM(antall),
                 MAX(CASE WHEN antall > 0 THEN created_at END)
            FROM lager_bevegelser GROUP BY card_id, finish, condition`,
    args: [],
  },
];

export async function sikreLagersaldo(): Promise<void> {
  await db().execute(`CREATE TABLE IF NOT EXISTS lager_saldo (
      card_id   TEXT NOT NULL,
      finish    TEXT NOT NULL,
      condition TEXT NOT NULL,
      antall    INTEGER NOT NULL DEFAULT 0,
      sist_inn  TEXT,
      PRIMARY KEY (card_id, finish, condition)
    ) WITHOUT ROWID`);
  // Triggerne før byggingen: en bevegelse som føres mens tabellen bygges,
  // kommer da med enten i byggingen eller via triggeren — aldri i ingen av dem.
  for (const t of TRIGGERE) await db().execute(t);
  const bygget = await db().execute("SELECT 1 FROM settings WHERE key = 'lager_saldo_bygget'");
  if (bygget.rows.length) return;
  await db().batch(
    [...BYGG, { sql: "INSERT OR REPLACE INTO settings (key, value) VALUES ('lager_saldo_bygget', 'true')", args: [] }],
    "write"
  );
}

// Nattlig kontroll: stemmer saldoen med boken? Gjør den ikke det, bygges den
// på nytt. Skal aldri slå til, men koster bare to lesninger av lageret i døgnet.
export async function kontrollerLagersaldo(): Promise<number> {
  const r = await db().execute(`
    SELECT COUNT(*) AS n FROM (
      SELECT card_id, finish, condition, SUM(antall) AS a FROM lager_bevegelser
       GROUP BY card_id, finish, condition
    ) b
    FULL OUTER JOIN lager_saldo s
      ON s.card_id = b.card_id AND s.finish = b.finish AND s.condition = b.condition
     WHERE COALESCE(b.a, 0) <> COALESCE(s.antall, 0)`);
  const avvik = Number((r.rows[0] as any)?.n || 0);
  if (avvik) await db().batch(BYGG, "write");
  return avvik;
}
