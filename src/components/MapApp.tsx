"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { logout, setSegmentStatus } from "@/app/actions";
import type { SegmentStatus } from "@/db/schema";
import type { SessionUser } from "@/lib/auth";
import { STATUS_META, STATUS_ORDER } from "@/lib/status";
import { lineLatLngs, outerRingLatLngs, type LatLng } from "./geo";
import type { Barrio, Segment } from "./types";
import { useLiveStatus } from "./useLiveStatus";

const StreetMap = dynamic(() => import("./StreetMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-neutral-200" />,
});

type Filter = SegmentStatus | "all";
type Selection = { kind: "segment"; id: number } | { kind: "street"; name: string } | null;
export type Focus = { key: number; points: LatLng[]; animate: boolean };

function countByStatus(list: Segment[]) {
  const c = { red: 0, yellow: 0, green: 0 };
  for (const s of list) c[s.status]++;
  return c;
}

type Props = { barrios: Barrio[]; segments: Segment[]; user: SessionUser | null; lastChangeId: number };

export default function MapApp({ barrios, segments: loaded, user, lastChangeId }: Props) {
  const { live, apply, connection } = useLiveStatus(lastChangeId);
  const segments = useMemo(
    () =>
      live.size === 0
        ? loaded
        : loaded.map((s) => {
            const status = live.get(s.id);
            return status && status !== s.status ? { ...s, status } : s;
          }),
    [loaded, live],
  );
  const [barrioId, setBarrioId] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<SegmentStatus>>(new Set());
  const [selection, setSelection] = useState<Selection>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>(() => ({
    key: 0,
    points: barrios.flatMap((b) => outerRingLatLngs(b.geometry).flat()),
    animate: false,
  }));

  const barrioName = useMemo(() => new Map(barrios.map((b) => [b.id, b.name])), [barrios]);

  const inBarrio = useMemo(
    () => (barrioId === null ? segments : segments.filter((s) => s.barrioId === barrioId)),
    [segments, barrioId],
  );
  const visible = useMemo(
    () => (filter === "all" ? inBarrio : inBarrio.filter((s) => s.status === filter)),
    [inBarrio, filter],
  );
  const counts = useMemo(() => countByStatus(inBarrio), [inBarrio]);

  // Per status, the streets that have segments in it, with how many.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return STATUS_ORDER.filter((st) => filter === "all" || filter === st).map((st) => {
      const perStreet = new Map<string, number>();
      for (const s of inBarrio) {
        if (s.status !== st || (q && !s.streetName.toLowerCase().includes(q))) continue;
        perStreet.set(s.streetName, (perStreet.get(s.streetName) ?? 0) + 1);
      }
      const streets = [...perStreet].sort(([a], [b]) => a.localeCompare(b, "es"));
      return { status: st, streets };
    });
  }, [inBarrio, filter, query]);

  const highlighted = useMemo(() => {
    if (!selection) return [];
    if (selection.kind === "segment") return segments.filter((s) => s.id === selection.id);
    return inBarrio.filter((s) => s.streetName === selection.name);
  }, [selection, segments, inBarrio]);

  const selectedSegment = selection?.kind === "segment" ? highlighted[0] : undefined;

  function toggleGroup(status: SegmentStatus) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(status)) next.add(status);
      return next;
    });
  }

  function focusOn(points: LatLng[]) {
    if (points.length) setFocus((f) => ({ key: f.key + 1, points, animate: true }));
  }

  function chooseBarrio(id: number | null) {
    setBarrioId(id);
    setSelection(null);
    const chosen = id === null ? barrios : barrios.filter((b) => b.id === id);
    focusOn(chosen.flatMap((b) => outerRingLatLngs(b.geometry).flat()));
  }

  function selectStreet(name: string) {
    setSelection({ kind: "street", name });
    setDrawerOpen(false);
    setError(null);
    focusOn(inBarrio.filter((s) => s.streetName === name).flatMap((s) => lineLatLngs(s.geometry)));
  }

  function selectSegment(id: number) {
    setSelection({ kind: "segment", id });
    setError(null);
  }

  function changeStatus(status: SegmentStatus) {
    if (!selectedSegment) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await setSegmentStatus(selectedSegment.id, status);
        apply(result.segmentId, result.status);
      } catch {
        setError("No se pudo guardar. ¿Sigue abierta la sesión?");
      }
    });
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <aside
        className={`fixed inset-y-0 left-0 z-[1000] flex w-80 max-w-[85vw] flex-col bg-white shadow-lg transition-transform md:static md:translate-x-0 md:shadow-none ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <header className="border-b border-neutral-200 p-4">
          <div className="flex items-center justify-between">
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              Mapeo de calles
              <span
                className={`h-2 w-2 rounded-full ${connection === "live" ? "bg-green-600" : "bg-neutral-400"}`}
                title={connection === "live" ? "En directo" : "Reconectando…"}
              />
            </h1>
            <button className="text-2xl leading-none md:hidden" onClick={() => setDrawerOpen(false)} aria-label="Cerrar">
              ×
            </button>
          </div>
          <p className="text-sm text-neutral-600">
            {barrioId === null ? "Todo el distrito" : barrioName.get(barrioId)} · {inBarrio.length} tramos
          </p>
          <div className="mt-1 text-sm text-neutral-600">
            {user ? (
              <form action={logout} className="flex items-center gap-2">
                <span>{user.username}</span>
                <button className="underline">Salir</button>
              </form>
            ) : (
              <Link href="/login" className="underline">
                Entrar para editar
              </Link>
            )}
          </div>
          <input
            type="search"
            placeholder="Buscar calle…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mt-3 w-full rounded border border-neutral-300 px-3 py-1.5 text-sm"
          />
        </header>

        <div className="flex-1 overflow-y-auto">
          {groups.map(({ status, streets }) => {
            // While searching, keep every group open so matches aren't hidden.
            const open = query.trim() !== "" || !collapsed.has(status);
            return (
              <section key={status}>
                <h2 className="sticky top-0 bg-neutral-50 text-sm font-medium">
                  <button
                    onClick={() => toggleGroup(status)}
                    aria-expanded={open}
                    className="flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-left hover:bg-neutral-100"
                  >
                    <svg
                      viewBox="0 0 12 12"
                      aria-hidden="true"
                      className={`h-3 w-3 text-neutral-500 transition-transform ${open ? "rotate-90" : ""}`}
                    >
                      <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                    <span className={`h-3 w-3 rounded-full ${STATUS_META[status].swatch}`} />
                    {STATUS_META[status].label}
                    <span className="ml-auto text-neutral-500">{counts[status]} tramos</span>
                  </button>
                </h2>
                {open && (
                  <ul>
                    {streets.map(([name, n]) => (
                      <li key={name}>
                        <button
                          onClick={() => selectStreet(name)}
                          className={`flex w-full items-baseline gap-2 px-4 py-1.5 text-left text-sm hover:bg-neutral-100 ${
                            selection?.kind === "street" && selection.name === name ? "bg-neutral-200 font-medium" : ""
                          }`}
                        >
                          <span className="flex-1">{name}</span>
                          <span className="text-xs text-neutral-500">{n}</span>
                        </button>
                      </li>
                    ))}
                    {streets.length === 0 && <li className="px-4 py-1.5 text-sm text-neutral-400">Ninguna</li>}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-[999] bg-black/30 md:hidden" onClick={() => setDrawerOpen(false)} />
      )}

      <main className="relative flex-1">
        <StreetMap
          barrios={barrios}
          barrioId={barrioId}
          segments={visible}
          highlighted={highlighted}
          selectedSegmentId={selectedSegment?.id ?? null}
          onSelectSegment={selectSegment}
          focus={focus}
        />

        <div className="absolute left-3 right-3 top-3 z-[500] flex flex-wrap items-center gap-2">
          <button
            onClick={() => setDrawerOpen(true)}
            className="rounded bg-white px-3 py-1.5 text-sm font-medium shadow md:hidden"
          >
            Calles
          </button>
          <select
            value={barrioId ?? ""}
            onChange={(e) => chooseBarrio(e.target.value ? Number(e.target.value) : null)}
            className="rounded bg-white px-2 py-1.5 text-sm shadow"
            aria-label="Barrio"
          >
            <option value="">Todos los barrios</option>
            {barrios.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <div className="flex overflow-hidden rounded bg-white text-sm shadow">
            <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>
              Todos
            </FilterButton>
            {STATUS_ORDER.map((st) => (
              <FilterButton key={st} active={filter === st} onClick={() => setFilter(st)}>
                <span className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-full ${STATUS_META[st].swatch}`} />
                {counts[st]}
              </FilterButton>
            ))}
          </div>
        </div>

        {selection && highlighted.length > 0 && (
          <div className="absolute bottom-6 left-3 right-3 z-[500] mx-auto max-w-md rounded-lg bg-white p-4 shadow-lg">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{highlighted[0].streetName}</p>
                <p className="text-sm text-neutral-600">
                  {selectedSegment
                    ? `${barrioName.get(selectedSegment.barrioId)} · tramo ${STATUS_META[selectedSegment.status].label.toLowerCase()}`
                    : streetSummary(highlighted)}
                </p>
              </div>
              <button className="text-xl leading-none" onClick={() => setSelection(null)} aria-label="Cerrar">
                ×
              </button>
            </div>
            {!selectedSegment ? (
              <p className="mt-2 text-sm text-neutral-600">Toca un tramo en el mapa para cambiar su estado.</p>
            ) : user ? (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {STATUS_ORDER.map((st) => (
                  <button
                    key={st}
                    disabled={pending || selectedSegment.status === st}
                    onClick={() => changeStatus(st)}
                    style={{ backgroundColor: STATUS_META[st].color }}
                    className="rounded px-2 py-2 text-xs font-medium text-white disabled:opacity-40"
                  >
                    {STATUS_META[st].label}
                  </button>
                ))}
              </div>
            ) : (
              <Link href="/login" className="mt-2 block text-sm underline">
                Entra para cambiar su estado
              </Link>
            )}
            {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
          </div>
        )}
      </main>
    </div>
  );
}

function streetSummary(list: Segment[]) {
  const c = countByStatus(list);
  return STATUS_ORDER.filter((st) => c[st] > 0)
    .map((st) => `${c[st]} ${STATUS_META[st].label.toLowerCase()}`)
    .join(" · ");
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center px-3 py-1.5 ${active ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"}`}
    >
      {children}
    </button>
  );
}
