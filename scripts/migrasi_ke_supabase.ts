// Salin semua data Google Sheets ke Postgres (Supabase). Sekali jalan saat cutover; aman diulang:
// baris yang id-nya sudah ada di database dilewati.
//
// Jalankan (butuh tsx karena import berakhiran .js):
//   node --env-file=.env.migrasi --import tsx scripts/migrasi_ke_supabase.ts
//
// .env.migrasi: SPREADSHEET_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY,
//               DATABASE_URL_MIGRASI (Supabase session pooler, port 5432)
import { createSql } from "../server/db/client.js";
import { kolomOf, NAMA_TABEL, tabelDb, type NamaTabel } from "../server/db/schema.js";
import { keDb } from "../server/db/store.js";
import { GoogleSheetStore } from "./sheets-lama/google-store.js";
import { parseRows } from "./sheets-lama/parse.js";

function wajib(nama: string): string {
  const v = process.env[nama];
  if (!v) throw new Error(`${nama} wajib diisi di .env.migrasi.`);
  return v;
}

const MAKS_INSERT = 500;

async function main() {
  const sql = createSql(wajib("DATABASE_URL_MIGRASI"));
  const store = new GoogleSheetStore({
    spreadsheetId: wajib("SPREADSHEET_ID"),
    clientEmail: wajib("GOOGLE_CLIENT_EMAIL"),
    privateKey: wajib("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
  });

  try {
    const data = await store.readMany(NAMA_TABEL);
    // Pengguna dulu: tabel lain punya foreign key user_id. Urutan baris sheet = urutan insert (kolom `no`).
    const urutan: NamaTabel[] = ["Pengguna", ...NAMA_TABEL.filter((t) => t !== "Pengguna")];
    let gagal = false;

    for (const tabel of urutan) {
      const kolom = kolomOf(tabel);
      const baris = parseRows(tabel, data[tabel]).map((r) => keDb(tabel, r.data));
      try {
        await sql.begin(async (tx) => {
          for (let i = 0; i < baris.length; i += MAKS_INSERT) {
            await tx`insert into ${tx(tabelDb(tabel))} ${tx(baris.slice(i, i + MAKS_INSERT), kolom)} on conflict (id) do nothing`;
          }
        });
        const [{ n }] = await sql`select count(*)::int as n from ${sql(tabelDb(tabel))}`;
        console.log(`${tabel.padEnd(18)} ${String(baris.length).padStart(6)} baris di sheet, ${String(n).padStart(6)} di database`);
      } catch (err) {
        gagal = true;
        // Pesan Postgres menyebut kolom/constraint yang bermasalah, tanpa isi kredensial
        console.error(`${tabel}: gagal (${err instanceof Error ? err.message : String(err)}). Perbaiki selnya lalu jalankan ulang.`);
      }
    }
    if (gagal) process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

await main();
