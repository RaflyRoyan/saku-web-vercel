import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { ToastContext, type ToastKind } from "../../hooks/useToast";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const STYLE: Record<ToastKind, string> = {
  sukses: "bg-emerald-50 text-masuk border-emerald-200",
  error: "bg-rose-50 text-keluar border-rose-200",
  peringatan: "bg-amber-50 text-amber-800 border-amber-200",
};

const ICON = { sukses: CircleCheck, error: CircleAlert, peringatan: TriangleAlert };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const show = useCallback((message: string, kind: ToastKind = "sukses") => {
    const id = nextId.current++;
    setItems((list) => [...list, { id, kind, message }]);
    // Peringatan (saldo minus, anggaran terlewati) tampil lebih lama supaya sempat dibaca
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), kind === "peringatan" ? 8000 : 4000);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Di atas bottom nav (HP), pojok bawah (laptop) */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6"
      >
        {items.map((t) => {
          const Icon = ICON[t.kind];
          return (
            <div
              key={t.id}
              role={t.kind === "error" ? "alert" : "status"}
              className={`pointer-events-auto flex w-full max-w-sm items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold shadow-sm ${STYLE[t.kind]}`}
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              {t.message}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
