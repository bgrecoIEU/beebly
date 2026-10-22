"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import { errorMessage, formatDate, formatPrice } from "@/lib/format";

type AdminEvent = {
  id: string;
  name: string;
  venue_type: string;
  starts_at: string;
  face_value: number;
  sold_out: boolean;
  open_orders: number;
  trades_count: number;
  tickets_traded: number;
  reported_count: number;
  spread_released: number;
  spread_pending: number;
};

type Draft = {
  id: string | null;
  name: string;
  venue_type: string;
  starts_at: string; // datetime-local value, in the owner's local time
  face_value: string;
  sold_out: boolean;
};

const emptyDraft: Draft = { id: null, name: "", venue_type: "", starts_at: "", face_value: "", sold_out: false };

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function OwnerConsole() {
  const router = useRouter();
  const session = useSession();
  const [owner, setOwner] = useState<boolean | null>(null);
  const [events, setEvents] = useState<AdminEvent[] | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (session === null) router.replace("/login");
  }, [session, router]);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase().rpc("admin_list_events");
    if (error) {
      setMessage({ kind: "error", text: errorMessage(error) });
      setEvents([]);
    } else {
      setEvents((data ?? []) as AdminEvent[]);
    }
    setLoadedAt(Date.now());
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    getSupabase()
      .rpc("is_owner")
      .then(({ data }) => {
        setOwner(Boolean(data));
        if (data) load();
      });
  }, [userId, load]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!draft.starts_at) {
      setMessage({ kind: "error", text: "Pick a start date and time." });
      return;
    }
    setBusy(true);
    const { error } = await getSupabase().rpc("admin_save_event", {
      p_id: draft.id,
      p_name: draft.name,
      p_venue_type: draft.venue_type,
      p_starts_at: new Date(draft.starts_at).toISOString(),
      p_face_value: Number(draft.face_value),
      p_sold_out: draft.sold_out,
    });
    setBusy(false);
    if (error) {
      setMessage({ kind: "error", text: errorMessage(error) });
      return;
    }
    setMessage({ kind: "ok", text: draft.id ? "Event updated." : "Event published." });
    setDraft(emptyDraft);
    await load();
  }

  function edit(ev: AdminEvent) {
    setDraft({
      id: ev.id,
      name: ev.name,
      venue_type: ev.venue_type,
      starts_at: toLocalInput(ev.starts_at),
      face_value: String(ev.face_value),
      sold_out: ev.sold_out,
    });
    setMessage(null);
    document.getElementById("event-form")?.scrollIntoView({ behavior: "smooth" });
  }

  if (!session || owner === null) {
    return (
      <p role="status" className="mx-auto max-w-5xl px-4 py-12 text-stone-700">
        Checking owner access…
      </p>
    );
  }

  if (!owner) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <div className="card">
          <h1 className="text-xl font-bold text-stone-900">This account is not an owner</h1>
          <p className="mt-2 text-sm text-stone-700">
            To make it one, run this in Supabase → SQL Editor, then reload:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-stone-900 p-3 text-xs text-white">
            {`insert into public.owners (user_id)
select id from auth.users where email = '${session.user.email ?? "you@example.com"}'
on conflict do nothing;`}
          </pre>
        </div>
      </div>
    );
  }

  const released = (events ?? []).reduce((s, e) => s + Number(e.spread_released), 0);
  const pending = (events ?? []).reduce((s, e) => s + Number(e.spread_pending), 0);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-6">
      <div>
        <p className="badge bg-amber-100 text-amber-900">Local only · owner</p>
        <h1 className="mt-2 text-2xl font-bold text-stone-900">Owner console</h1>
        <p className="text-sm text-stone-700">
          This page only exists when you run <code>npm run dev</code>.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="card">
          <dt className="text-sm text-stone-600">Spread earned (released)</dt>
          <dd className="text-2xl font-bold text-stone-900">{formatPrice(released)}</dd>
        </div>
        <div className="card">
          <dt className="text-sm text-stone-600">Spread on hold</dt>
          <dd className="text-2xl font-bold text-stone-900">{formatPrice(pending)}</dd>
        </div>
        <div className="card">
          <dt className="text-sm text-stone-600">Events</dt>
          <dd className="text-2xl font-bold text-stone-900">{events?.length ?? "…"}</dd>
        </div>
      </dl>

      <section id="event-form" aria-labelledby="event-form-heading" className="card scroll-mt-4">
        <h2 id="event-form-heading" className="text-xl font-bold text-stone-900">
          {draft.id ? "Edit event" : "Publish a new event"}
        </h2>
        <form onSubmit={onSave} noValidate className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="ev-name" className="label">Name</label>
            <input id="ev-name" type="text" maxLength={100} value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="field" />
          </div>
          <div>
            <label htmlFor="ev-venue" className="label">Venue type</label>
            <input id="ev-venue" type="text" maxLength={60} value={draft.venue_type}
              placeholder="e.g. Club night, Rooftop, Concert"
              onChange={(e) => setDraft({ ...draft, venue_type: e.target.value })} className="field" />
          </div>
          <div>
            <label htmlFor="ev-start" className="label">Starts at (your local time)</label>
            <input id="ev-start" type="datetime-local" value={draft.starts_at}
              onChange={(e) => setDraft({ ...draft, starts_at: e.target.value })} className="field" />
          </div>
          <div>
            <label htmlFor="ev-face" className="label">Face value (€)</label>
            <input id="ev-face" type="number" inputMode="decimal" min={0.01} step={0.01}
              value={draft.face_value}
              onChange={(e) => setDraft({ ...draft, face_value: e.target.value })} className="field" />
          </div>
          <div className="flex items-end">
            <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-stone-800">
              <input type="checkbox" checked={draft.sold_out}
                onChange={(e) => setDraft({ ...draft, sold_out: e.target.checked })}
                className="h-5 w-5 accent-stone-900" />
              Sold out (removes the face-value price cap)
            </label>
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" disabled={busy} className="btn btn-primary">
              {busy ? "Saving…" : draft.id ? "Save changes" : "Publish event"}
            </button>
            {draft.id && (
              <button type="button" onClick={() => setDraft(emptyDraft)} className="btn btn-secondary">
                Cancel editing
              </button>
            )}
          </div>
          <div aria-live="polite" className="sm:col-span-2">
            {message && (
              <p role={message.kind === "error" ? "alert" : "status"}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  message.kind === "ok"
                    ? "border-green-700 bg-green-50 text-green-900"
                    : "border-red-700 bg-red-50 text-red-900"
                }`}>
                <span className="font-semibold">{message.kind === "ok" ? "Success: " : "Error: "}</span>
                {message.text}
              </p>
            )}
          </div>
        </form>
      </section>

      <section aria-labelledby="events-heading" className="card">
        <h2 id="events-heading" className="text-xl font-bold text-stone-900">All events</h2>
        {!events ? (
          <p role="status" className="mt-4 text-stone-700">Loading events…</p>
        ) : events.length === 0 ? (
          <p className="mt-4 text-stone-700">No events yet. Publish your first one above.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {events.map((ev) => {
              const past = new Date(ev.starts_at).getTime() <= loadedAt;
              return (
                <li key={ev.id} className="rounded-lg border border-stone-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-stone-900">{ev.name}</h3>
                      <p className="text-sm text-stone-700">
                        {formatDate(ev.starts_at)} · {ev.venue_type} · Face value {formatPrice(ev.face_value)}
                      </p>
                      <p className="mt-1 flex flex-wrap gap-1">
                        <span className={`badge ${past ? "bg-stone-200 text-stone-800" : "bg-green-100 text-green-900"}`}>
                          {past ? "Past" : "Upcoming"}
                        </span>
                        {ev.sold_out && <span className="badge bg-stone-900 text-white">Sold out</span>}
                        {ev.reported_count > 0 && (
                          <span className="badge bg-red-100 text-red-900">{ev.reported_count} reported</span>
                        )}
                      </p>
                    </div>
                    <button type="button" onClick={() => edit(ev)} className="btn btn-secondary">
                      Edit
                    </button>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <div><dt className="text-stone-600">Open orders</dt><dd className="font-medium">{ev.open_orders}</dd></div>
                    <div><dt className="text-stone-600">Trades</dt><dd className="font-medium">{ev.trades_count} ({ev.tickets_traded} tickets)</dd></div>
                    <div><dt className="text-stone-600">Spread earned</dt><dd className="font-medium">{formatPrice(Number(ev.spread_released))}</dd></div>
                    <div><dt className="text-stone-600">Spread on hold</dt><dd className="font-medium">{formatPrice(Number(ev.spread_pending))}</dd></div>
                  </dl>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
