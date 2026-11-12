import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Lock, Play, Search, ShieldCheck, TriangleAlert, Unlock } from "lucide-react";
import PageHeader from "../components/layout/PageHeader";
import { Button, fokus } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { useMe } from "../hooks/useAuth";
import { useToast } from "../hooks/useToast";
import { GRUP, KATALOG, paramPath, type Akses, type Endpoint, type Method, type Param } from "../lib/apiKatalog";

const WARNA_METHOD: Record<Method, string> = {
  GET: "bg-emerald-100 text-masuk",
  POST: "bg-brand-100 text-brand-800",
  PUT: "bg-violet-100 text-transfer",
  DELETE: "bg-rose-100 text-keluar",
};

const AKSES: Record<Akses, { label: string; icon: typeof Lock; kelas: string }> = {
  publik: { label: "Publik", icon: Unlock, kelas: "bg-stone-100 text-stone-700" },
  login: { label: "Perlu login", icon: Lock, kelas: "bg-brand-50 text-brand-800" },
  admin: { label: "Admin", icon: ShieldCheck, kelas: "bg-violet-50 text-transfer" },
};

const mono = "font-mono text-[13px]";

function MethodBadge({ method, kecil }: { method: Method; kecil?: boolean }) {
  return (
    <span className={`inline-flex shrink-0 justify-center rounded-md font-mono font-bold ${WARNA_METHOD[method]} ${kecil ? "w-14 py-0.5 text-[11px]" : "px-2 py-1 text-xs"}`}>
      {method}
    </span>
  );
}

/** Pewarnaan JSON sederhana: string, key, angka, boolean/null. */
function JsonView({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(text.slice(last, i));
    const t = m[0];
    const kelas = t.startsWith('"') ? (m[2] ? "text-sky-300" : "text-amber-200") : /^(true|false|null)$/.test(t) ? "text-violet-300" : "text-emerald-300";
    parts.push(
      <span key={i} className={kelas}>
        {t}
      </span>,
    );
    last = i + t.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function Kode({ children, salin }: { children: ReactNode; salin: string }) {
  const toast = useToast();
  const [ok, setOk] = useState(false);
  return (
    <div className="relative">
      <pre className={`max-h-[28rem] overflow-auto rounded-xl bg-stone-900 p-4 pr-12 leading-relaxed text-stone-100 ${mono}`}>{children}</pre>
      <button
        type="button"
        aria-label="Salin"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(salin);
            setOk(true);
            setTimeout(() => setOk(false), 1500);
          } catch {
            toast.show("Gagal menyalin.", "error");
          }
        }}
        className={`absolute top-2 right-2 flex size-9 items-center justify-center rounded-lg text-stone-400 hover:bg-white/10 hover:text-white ${fokus}`}
      >
        {ok ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      </button>
    </div>
  );
}

function TabelParam({ judul, items }: { judul: string; items: Param[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-bold text-stone-700">{judul}</h3>
      <div className="divide-y divide-garis overflow-hidden rounded-xl border border-garis bg-white">
        {items.map((p) => (
          <div key={p.nama} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:gap-4">
            <span className={`shrink-0 sm:w-40 ${mono} font-semibold text-stone-900`}>
              {p.nama}
              {p.wajib && <span className="ml-1 text-keluar" title="Wajib">*</span>}
            </span>
            <span className="text-sm text-stone-600">{p.ket || "—"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

interface Hasil {
  status: number;
  statusText: string;
  ms: number;
  body: string;
}

function urlDari(e: Endpoint, nilaiPath: Record<string, string>, nilaiQuery: Record<string, string>) {
  const path = e.path.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(nilaiPath[k] || `{${k}}`));
  const q = new URLSearchParams(Object.entries(nilaiQuery).filter(([, v]) => v.trim() !== ""));
  return `/api${path}${q.size ? `?${q}` : ""}`;
}

function curlDari(e: Endpoint, url: string, body: string) {
  const baris = [`curl -b saku.txt${e.method === "GET" ? "" : ` -X ${e.method}`} "${window.location.origin}${url}"`];
  if (e.method !== "GET") baris.push(`  -H "X-Requested-With: saku"`);
  if (e.method !== "GET" && body.trim()) baris.push(`  -H "Content-Type: application/json"`, `  -d '${body.replace(/\s*\n\s*/g, " ").trim()}'`);
  return baris.join(" \\\n");
}

/** Panel coba: isi parameter, kirim request asli dengan cookie sesi, tampilkan respons. */
function Coba({ e }: { e: Endpoint }) {
  const qc = useQueryClient();
  const params = paramPath(e.path);
  const [nilaiPath, setNilaiPath] = useState<Record<string, string>>({});
  const [nilaiQuery, setNilaiQuery] = useState<Record<string, string>>(() => Object.fromEntries((e.query ?? []).map((p) => [p.nama, p.contoh ?? ""])));
  const punyaBody = e.method !== "GET" && e.contoh !== undefined;
  const [body, setBody] = useState(() => (punyaBody ? JSON.stringify(e.contoh, null, 2) : ""));
  const [yakin, setYakin] = useState(false);
  const [tab, setTab] = useState<"respons" | "curl">("respons");
  const [hasil, setHasil] = useState<Hasil | null>(null);
  const [kirim, setKirim] = useState(false);

  const jsonError = useMemo(() => {
    if (!body.trim()) return null;
    try {
      JSON.parse(body);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "JSON tidak valid.";
    }
  }, [body]);
  const url = urlDari(e, nilaiPath, nilaiQuery);
  const kurang = params.filter((p) => !nilaiPath[p]?.trim());
  const ubahData = e.method !== "GET";
  const bisa = !kirim && !jsonError && kurang.length === 0 && (!ubahData || yakin);

  const jalankan = async () => {
    setKirim(true);
    const mulai = performance.now();
    try {
      const res = await fetch(url, {
        method: e.method,
        credentials: "same-origin",
        headers: { "X-Requested-With": "saku", ...(body.trim() && ubahData ? { "Content-Type": "application/json" } : {}) },
        body: ubahData && body.trim() ? body : undefined,
      });
      const teks = await res.text();
      let rapi = teks;
      try {
        rapi = JSON.stringify(JSON.parse(teks), null, 2);
      } catch {
        // bukan JSON: tampilkan apa adanya
      }
      setHasil({ status: res.status, statusText: res.statusText, ms: Math.round(performance.now() - mulai), body: rapi });
      setTab("respons");
      // Data aplikasi mungkin berubah (atau sesi berganti): segarkan semua query
      if (ubahData && res.ok) qc.invalidateQueries();
    } catch (err) {
      setHasil({ status: 0, statusText: "Gagal terhubung", ms: Math.round(performance.now() - mulai), body: err instanceof Error ? err.message : String(err) });
    } finally {
      setKirim(false);
      setYakin(false);
    }
  };

  const warnaStatus = !hasil ? "" : hasil.status >= 200 && hasil.status < 300 ? "bg-emerald-100 text-masuk" : hasil.status >= 400 && hasil.status < 500 ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-keluar";
  const input = `min-h-11 w-full rounded-xl border border-garis bg-white px-3 ${mono} placeholder:text-stone-400 focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:outline-none`;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <h3 className="flex items-center gap-2 font-bold">
        <Play className="size-4 text-brand-600" aria-hidden />
        Coba langsung
      </h3>

      {params.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {params.map((p) => (
            <label key={p} className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-stone-700">
                <span className={mono}>{`{${p}}`}</span> <span className="text-keluar">*</span>
              </span>
              <input value={nilaiPath[p] ?? ""} onChange={(ev) => setNilaiPath((x) => ({ ...x, [p]: ev.target.value }))} placeholder={p === "bulan" ? "2026-11" : "mis. TR-xxxx"} className={input} />
            </label>
          ))}
        </div>
      )}

      {(e.query ?? []).length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-stone-700">Query</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {e.query!.map((p) => (
              <label key={p.nama} className="flex items-center gap-2">
                <span className={`w-28 shrink-0 truncate ${mono} text-stone-600`}>{p.nama}</span>
                <input value={nilaiQuery[p.nama] ?? ""} onChange={(ev) => setNilaiQuery((x) => ({ ...x, [p.nama]: ev.target.value }))} placeholder={p.ket} aria-label={p.nama} className={input} />
              </label>
            ))}
          </div>
        </div>
      )}

      {ubahData && (
        <label className="flex flex-col gap-1">
          <span className="flex items-center justify-between text-sm font-semibold text-stone-700">
            Body (JSON)
            {jsonError && <span className="text-xs font-normal text-keluar">JSON tidak valid</span>}
          </span>
          <textarea
            value={body}
            onChange={(ev) => setBody(ev.target.value)}
            spellCheck={false}
            rows={Math.min(14, Math.max(3, body.split("\n").length + 1))}
            placeholder="Tanpa body"
            className={`w-full rounded-xl border bg-stone-900 p-3 leading-relaxed text-amber-100 placeholder:text-stone-500 focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:outline-none ${mono} ${jsonError ? "border-keluar" : "border-stone-900"}`}
          />
        </label>
      )}

      <p className={`break-all rounded-lg bg-stone-50 px-3 py-2 ${mono} text-stone-700`}>
        <span className="font-bold">{e.method}</span> {url}
      </p>

      {ubahData && (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <input type="checkbox" checked={yakin} onChange={(ev) => setYakin(ev.target.checked)} className="mt-0.5 size-5 shrink-0 accent-brand-700" />
          <span>
            <span className="font-semibold">Request ini mengubah data asli</span> di database{e.awas ? `. ${e.awas}` : "."} Centang untuk mengirim.
          </span>
        </label>
      )}

      <Button onClick={jalankan} loading={kirim} disabled={!bisa}>
        <Play className="size-4" aria-hidden />
        Kirim request
      </Button>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <SegmentedControl
            label="Tampilan hasil"
            value={tab}
            options={[
              { value: "respons", label: "Respons" },
              { value: "curl", label: "curl" },
            ]}
            onChange={setTab}
          />
          {hasil && tab === "respons" && (
            <span className="flex items-center gap-2 text-sm">
              <span className={`rounded-md px-2 py-0.5 font-mono font-bold ${warnaStatus}`}>{hasil.status || "ERR"}</span>
              <span className="text-stone-500 tabular-nums">{hasil.ms} ms</span>
            </span>
          )}
        </div>
        {tab === "curl" ? (
          <Kode salin={curlDari(e, url, body)}>{curlDari(e, url, body)}</Kode>
        ) : hasil ? (
          <div aria-live="polite">
            <Kode salin={hasil.body}>{hasil.body ? <JsonView text={hasil.body} /> : <span className="text-stone-400">(tanpa isi) {hasil.statusText}</span>}</Kode>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-garis px-4 py-6 text-center text-sm text-stone-500">Respons akan tampil di sini.</p>
        )}
      </div>
    </Card>
  );
}

function Detail({ e, admin }: { e: Endpoint; admin: boolean }) {
  const A = AKSES[e.akses];
  return (
    <article className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-brand-700">{e.grup}</p>
        <h2 className="text-xl font-bold">{e.judul}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <MethodBadge method={e.method} />
          <code className={`break-all ${mono} font-semibold text-stone-900`}>/api{e.path}</code>
        </div>
        <span className={`inline-flex items-center gap-1.5 self-start rounded-full px-2.5 py-1 text-xs font-semibold ${A.kelas}`}>
          <A.icon className="size-3.5" aria-hidden />
          {A.label}
        </span>
        {e.ket && <p className="text-stone-700">{e.ket}</p>}
        {e.akses === "admin" && !admin && (
          <p className="flex items-center gap-2 rounded-xl bg-violet-50 px-3 py-2 text-sm text-transfer">
            <ShieldCheck className="size-4 shrink-0" aria-hidden />
            Anda bukan admin: request ini akan dijawab 403.
          </p>
        )}
        {e.awas && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {e.awas}
          </p>
        )}
      </header>

      {e.query && <TabelParam judul="Query" items={e.query} />}
      {e.field && <TabelParam judul="Body" items={e.field} />}
      <section className="flex flex-col gap-1">
        <h3 className="text-sm font-bold text-stone-700">Respons sukses</h3>
        <p className="text-sm text-stone-600">
          {e.respons.split("`").map((s, i) =>
            i % 2 ? (
              <code key={i} className={`rounded bg-stone-100 px-1 ${mono} text-stone-800`}>
                {s}
              </code>
            ) : (
              s
            ),
          )}
        </p>
      </section>

      <Coba key={e.id} e={e} />
    </article>
  );
}

/** Dokumentasi API interaktif (custom, tanpa Swagger UI): katalog endpoint + panel coba memakai sesi login. */
export default function DokumentasiApiPage() {
  const { data: me } = useMe();
  const [params, setParams] = useSearchParams();
  const [cari, setCari] = useState("");
  const terpilih = KATALOG.find((e) => e.id === params.get("ep")) ?? KATALOG.find((e) => e.id === "dashboard")!;

  const q = cari.trim().toLowerCase();
  const cocok = KATALOG.filter((e) => !q || `${e.method} ${e.path} ${e.judul} ${e.grup}`.toLowerCase().includes(q));

  const pilih = (id: string) => {
    setParams({ ep: id }, { replace: true });
    if (window.matchMedia("(max-width: 1023px)").matches) document.getElementById("detail-endpoint")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <>
      <PageHeader title="Dokumentasi API" />
      <div className="mb-5 flex flex-col gap-2 rounded-2xl border border-garis bg-white p-4 text-sm text-stone-700">
        <p>
          Base URL <code className={`rounded bg-stone-100 px-1.5 py-0.5 ${mono}`}>{window.location.origin}/api</code>. Autentikasi memakai cookie{" "}
          <code className={`rounded bg-stone-100 px-1 ${mono}`}>saku_token</code> dari login; halaman ini memakai sesi Anda saat ini.
        </p>
        <p>
          POST/PUT/DELETE wajib header <code className={`rounded bg-stone-100 px-1 ${mono}`}>X-Requested-With: saku</code>. Error berformat ProblemDetails:{" "}
          <code className={`rounded bg-stone-100 px-1 ${mono}`}>{"{ title, status, errors? }"}</code>.
        </p>
      </div>

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
        <nav aria-label="Daftar endpoint" className="flex flex-col gap-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1">
          <label className="relative block">
            <span className="sr-only">Cari endpoint</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" aria-hidden />
            <input
              type="search"
              value={cari}
              onChange={(ev) => setCari(ev.target.value)}
              placeholder="Cari endpoint"
              className="min-h-11 w-full rounded-xl border border-garis bg-white pr-3 pl-9 text-base placeholder:text-stone-400 focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:outline-none"
            />
          </label>
          {cocok.length === 0 && <p className="px-1 text-sm text-stone-500">Tidak ada endpoint yang cocok.</p>}
          {GRUP.map((g) => {
            const list = cocok.filter((e) => e.grup === g);
            if (!list.length) return null;
            return (
              <section key={g}>
                <h2 className="mb-1 px-1 text-xs font-bold tracking-wide text-stone-500 uppercase">{g}</h2>
                <ul className="flex flex-col">
                  {list.map((e) => {
                    const aktif = e.id === terpilih.id;
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          aria-current={aktif ? "true" : undefined}
                          onClick={() => pilih(e.id)}
                          className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left ${aktif ? "bg-brand-50 ring-1 ring-brand-200" : "hover:bg-white"} ${fokus}`}
                        >
                          <MethodBadge method={e.method} kecil />
                          <span className={`min-w-0 flex-1 truncate ${mono} ${aktif ? "font-semibold text-brand-800" : "text-stone-700"}`} title={e.judul}>
                            {e.path}
                          </span>
                          {e.akses === "admin" && <ShieldCheck className="size-3.5 shrink-0 text-transfer" aria-label="Admin" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </nav>

        <div id="detail-endpoint" className="scroll-mt-16 min-w-0">
          <Detail e={terpilih} admin={me?.peran === "admin"} />
        </div>
      </div>
    </>
  );
}
