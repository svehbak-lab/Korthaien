// Import av kundelisten fra Mystore: kontoer uten passord, falske
// registreringer holdes ute, og eksisterende kontoer overskrives ikke.
import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const DB = `/tmp/kundeimport-${process.pid}.db`;
rmSync(DB, { force: true });
process.env.DATABASE_URL = `file:${DB}`;
const { db, migrate } = await import("../src/db.ts");
const konto = await import("../src/kunder.ts");
await migrate();
process.on("exit", () => rmSync(DB, { force: true }));

const CSV = `﻿#,E-post,Fornavn,Etternavn,Gateadresse,Postnummer,By,Land,Telefon,Bedrift,Organisasjonsnummer,Nyhetsbrev,"Kunde siden",Fødselsdato,Ordrer,"Samlet ordreverdi",Pålogginger,"Siste innlogging","Sist endret","Påmeldt produktvarsel"
1,Ola@Eksempel.no,Ola,Nordmann,"Gata 1, oppgang B",0150,Oslo,Norge,91234567,,,1,2018-03-04,,12,"4520.50",30,2026-09-01,,Nei
2,falsk@gmail.com,Xq,Zr,Abc,KJHGFDSAQW,Lusaka,Zambia,123,,,0,2024-05-05,,0,0.00,0,,,Nei
3,kari@eksempel.no,Kari,Ås,Vei 2,5003,Bergen,,,,,0,2020-01-01,1999-01-01,0,0.00,1,,,Nei
4,ola@eksempel.no,Dobbel,Rad,,,,,,,,0,2019-01-01,,1,1.00,1,,,Nei
5,ikke-en-adresse,A,B,,,,,,,,0,2019-01-01,,1,1.00,1,,,Nei
`;

test("CSV-tolking takler BOM, anførselstegn og komma i felt", () => {
  const r = konto.lesCsv(CSV);
  assert.equal(r.length, 5);
  assert.equal(r[0]["E-post"], "Ola@Eksempel.no");
  assert.equal(r[0]["Gateadresse"], "Gata 1, oppgang B");
});

test("import: nye kontoer uten passord, falske og ugyldige hoppes over", async () => {
  // Kari finnes fra før med eget navn; det skal ikke overskrives.
  await db().execute({ sql: "INSERT INTO kunder (email, navn, created_at) VALUES ('kari@eksempel.no', 'Kari Selv', '2026-10-01T00:00:00Z')" });
  const r = await konto.importerMystoreKunder(CSV);
  assert.deepEqual(r, { rader: 5, nye: 1, oppdatert: 1, falske: 1, ugyldige: 2 });
  const ola = (await db().execute("SELECT * FROM kunder WHERE email = 'ola@eksempel.no'")).rows[0];
  assert.equal(ola.navn, "Ola Nordmann");
  assert.equal(ola.passord_hash, null);
  assert.equal(ola.kilde, "mystore");
  assert.equal(Number(ola.mystore_ordreverdi_ore), 452050);
  assert.equal(ola.created_at.slice(0, 10), "2018-03-04");
  const kari = (await db().execute("SELECT * FROM kunder WHERE email = 'kari@eksempel.no'")).rows[0];
  assert.equal(kari.navn, "Kari Selv");
  assert.equal(kari.postnr, "5003");
  assert.equal(kari.created_at.slice(0, 10), "2020-01-01");
  // Fødselsdato lagres ikke.
  const kol = (await db().execute("PRAGMA table_info(kunder)")).rows.map((x) => x.name);
  assert.ok(!kol.some((n) => /fod|birth/i.test(String(n))));
  // Kjøres den igjen, blir det ingen nye.
  const igjen = await konto.importerMystoreKunder(CSV);
  assert.equal(igjen.nye, 0);
});

test("en importert kunde som registrerer seg, blir bedt om å velge passord via e-post", async () => {
  await assert.rejects(konto.registrer({ email: "ola@eksempel.no", passord: "hemmelig123" }), /uten_passord/);
  // Og kan ikke logge inn uten passord.
  await assert.rejects(konto.loggInn("ola@eksempel.no", ""), /./);
});

test("oversikten teller kontoene", async () => {
  const o = await konto.kundeoversikt("");
  assert.equal(o.tall.totalt, 2);
  assert.equal(o.tall.fra_mystore, 1);
  assert.equal(o.tall.mystore_ikke_aktivert, 1);
  assert.equal((await konto.kundeoversikt("nordmann")).kunder.length, 1);
});

test("selgere med kreditt men uten konto står også i kundelisten, med saldo", async () => {
  await db().execute({ sql: "INSERT INTO kreditt_bevegelser (email, ore, grunn, created_at) VALUES ('selger@eksempel.no', 25000, 'manuell', '2026-10-01T00:00:00Z')" });
  await db().execute({ sql: "INSERT INTO kreditt_bevegelser (email, ore, grunn, created_at) VALUES ('ola@eksempel.no', 5000, 'manuell', '2026-10-01T00:00:00Z')" });
  const o = await konto.kundeoversikt("");
  assert.equal(o.antall, 3);
  const selger = o.kunder.find((k) => k.email === "selger@eksempel.no");
  assert.equal(selger.kilde, "kreditt");
  assert.equal(Number(selger.kreditt_ore), 25000);
  assert.equal(Number(o.kunder.find((k) => k.email === "ola@eksempel.no").kreditt_ore), 5000);
});
