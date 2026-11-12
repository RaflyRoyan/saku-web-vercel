import postgres from "postgres";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

/**
 * Koneksi postgres.js untuk Vercel Function (serverless).
 * Production memakai Supabase transaction pooler (port 6543), yang tidak mendukung prepared statement.
 */
export function createSql(url: string, opsi: { max?: number } = {}): Sql {
  return postgres(url, {
    prepare: false,
    // Satu koneksi per instance function; request di instance yang sama antre di koneksi ini
    max: opsi.max ?? 1,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    types: {
      // numeric → number (bawaan postgres.js: string "15000.00")
      angka: {
        to: 1700,
        from: [1700],
        serialize: (x: number) => String(x),
        parse: (x: string) => Number(x),
      },
      // date → "yyyy-MM-dd" apa adanya; bawaan postgres.js membuat Date UTC yang bisa bergeser sehari di WIB
      tanggal: {
        to: 1082,
        from: [1082],
        serialize: (x: string) => x,
        parse: (x: string) => x,
      },
    },
  });
}
