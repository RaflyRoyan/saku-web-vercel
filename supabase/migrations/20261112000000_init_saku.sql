-- Schema awal Saku di Supabase. Satu tabel per sheet di server/sheets/schema.ts, nama kolom sama.
-- teks → text, angka → numeric, tanggal → date, bulan → char(7) 'yyyy-MM', datetime → timestamptz
-- Constraint sengaja longgar supaya data lama dari Google Sheets bisa masuk; perketat di migrasi berikutnya.

create table pengguna (
  id text primary key,
  username text not null unique,
  password_hash text not null,
  nama text,
  peran text,
  aktif boolean not null default true,
  last_login timestamptz,
  versi_token integer default 0,
  gagal_login integer default 0,
  terkunci_sampai timestamptz,
  created_by text, created_at timestamptz default now(), updated_by text, updated_at timestamptz
);

-- Master bersama (tanpa user_id), hanya admin yang menulis
create table akun (
  id text primary key,
  nama text, jenis text, urutan integer, aktif boolean default true,
  created_by text, created_at timestamptz default now(), updated_by text, updated_at timestamptz
);

create table kelompok_kategori (
  id text primary key,
  nama text, urutan integer, aktif boolean default true,
  created_by text, created_at timestamptz default now(), updated_by text, updated_at timestamptz
);

create table kategori (
  id text primary key,
  nama text, tipe text, kode_sistem text, aktif boolean default true, kelompok_id text,
  created_by text, created_at timestamptz default now(), updated_by text, updated_at timestamptz
);

-- Data per pengguna
create table akun_pengguna (
  id text primary key,
  user_id text not null references pengguna(id),
  akun_id text, urutan integer,
  created_by text, created_at timestamptz default now(), updated_by text, updated_at timestamptz
);

create table periode (
  id text primary key,
  user_id text not null references pengguna(id),
  nama text, tanggal_mulai date, tanggal_selesai date, keterangan text,
  created_by text, created_at timestamptz default now(), updated_by text, updated_at timestamptz
);

create table saldo_awal (
  id text primary key,
  user_id text not null references pengguna(id),
  periode_id text, akun_id text, saldo numeric(16,2),
  created_by text, created_at timestamptz default now(), updated_by text, updated_at timestamptz
);

create table anggaran (
  id text primary key,
  user_id text not null references pengguna(id),
  periode_id text, kelompok_id text, kategori_id text, nominal numeric(16,2),
  created_by text, created_at timestamptz default now(), updated_by text, updated_at timestamptz
);

create table transaksi (
  id text primary key,
  user_id text not null references pengguna(id),
  periode_id text, tanggal date, tipe text,
  akun_id text, akun_tujuan_id text, kategori_id text,
  nominal numeric(16,2), biaya_admin numeric(16,2),
  deskripsi text, berulang_id text, label text,
  created_by text, created_at timestamptz default now(), updated_by text, updated_at timestamptz
);

create table berulang (
  id text primary key,
  user_id text not null references pengguna(id),
  nama text, akun_id text, kategori_id text, nominal numeric(16,2),
  tgl_jatuh_tempo integer, ingatkan_h_min integer,
  mulai char(7), selesai char(7), aktif boolean default true,
  created_by text, created_at timestamptz default now(), updated_by text, updated_at timestamptz
);

create table berulang_lewati (
  id text primary key,
  user_id text not null references pengguna(id),
  berulang_id text, bulan char(7),
  created_by text, created_at timestamptz default now(), updated_by text, updated_at timestamptz
);

create table tabungan (
  id text primary key,
  user_id text not null references pengguna(id),
  tanggal date, jenis text, periode_id text, akun_id text,
  nominal numeric(16,2), keterangan text, transaksi_id text, diteruskan numeric(16,2),
  created_by text, created_at timestamptz default now(), updated_by text, updated_at timestamptz
);

create table split_bill (
  id text primary key,
  user_id text not null references pengguna(id),
  tanggal date, nama text, akun_id text, kategori_id text, akun_terima_id text,
  pajak numeric(16,2), servis numeric(16,2), diskon numeric(16,2), total numeric(16,2),
  transaksi_id text,
  created_by text, created_at timestamptz default now(), updated_by text, updated_at timestamptz
);

create table split_item (
  id text primary key,
  user_id text not null references pengguna(id),
  split_id text, nama text, qty numeric(10,2), harga numeric(16,2), peserta text, urutan integer,
  created_by text, created_at timestamptz default now(), updated_by text, updated_at timestamptz
);

create table split_peserta (
  id text primary key,
  user_id text not null references pengguna(id),
  split_id text, nama text, saya boolean default false, nominal numeric(16,2),
  lunas boolean default false, transaksi_id text, urutan integer,
  created_by text, created_at timestamptz default now(), updated_by text, updated_at timestamptz
);

create table pengaturan (
  id text primary key,
  user_id text not null references pengguna(id),
  kunci text, nilai text,
  created_by text, created_at timestamptz default now(), updated_by text, updated_at timestamptz,
  unique (user_id, kunci)
);

create table tagihan_qris (
  id text primary key,
  user_id text not null references pengguna(id),
  tanggal date, nominal numeric(16,2), keterangan text, akun_id text, kategori_id text,
  lunas boolean default false, transaksi_id text,
  created_by text, created_at timestamptz default now(), updated_by text, updated_at timestamptz
);

-- Index untuk query yang paling sering
create index on transaksi (user_id, periode_id);
create index on transaksi (user_id, tanggal desc);
create index on periode (user_id);
create index on saldo_awal (user_id, periode_id);
create index on anggaran (user_id, periode_id);
create index on akun_pengguna (user_id);
create index on berulang (user_id);
create index on berulang_lewati (user_id);
create index on tabungan (user_id);
create index on split_bill (user_id);
create index on split_item (split_id);
create index on split_peserta (split_id);
create index on tagihan_qris (user_id);

-- RLS aktif tanpa policy: Data API (anon/authenticated) tidak bisa membaca apa pun.
-- Function Vercel konek sebagai role postgres, jadi tidak terpengaruh.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
