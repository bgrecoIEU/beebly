"use client";

import { useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { errorMessage, formatDate, formatPrice } from "@/lib/format";
import type { EventRow, OrderResult, Side } from "@/lib/types";

type Props = {
  events: EventRow[] | null;
  onPlaced: () => Promise<void>;
};

export default function PlaceOrder({ events, onPlaced }: Props) {
  const [eventId, setEventId] = useState<string>("");
  const [side, setSide] = useState<Side>("sell");
  const [qty, setQty] = useState(1);
  // The typed price belongs to one event; switching events resets it to face value.
  const [priceEdit, setPriceEdit] = useState<{ eventId: string; value: string } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // Defaults: first upcoming event, its face value as price.
  const selected = events?.find((e) => e.id === eventId) ?? events?.[0] ?? null;
  const effectivePrice =
    selected && priceEdit?.eventId === selected.id
      ? priceEdit.value
      : selected
        ? String(selected.face_value)
        : "";
  const maxPrice = selected ? (selected.sold_out ? 9999.99 : selected.face_value) : undefined;

  function changeEvent(id: string) {
    setEventId(id);
    setPriceEdit(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!selected) {
      setMessage({ kind: "error", text: "No upcoming events are available yet." });
      return;
    }
    const numericPrice = Number(effectivePrice);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      setMessage({ kind: "error", text: "Enter a price above 0." });
      return;
    }
    setBusy(true);
    const { data, error } = await getSupabase().rpc("place_order", {
      p_event_id: selected.id,
      p_side: side,
      p_qty: qty,
      p_price: numericPrice,
      p_note: note,
    });
    if (error) {
      setMessage({ kind: "error", text: errorMessage(error) });
    } else {
      const result = data as OrderResult;
      setMessage({ kind: "ok", text: `Order placed. ${result.filled_qty} ticket(s) matched.` });
      setNote("");
      await onPlaced();
    }
    setBusy(false);
  }

  return (
    <section id="place-order" aria-labelledby="place-order-heading" className="card scroll-mt-4">
      <h2 id="place-order-heading" className="text-xl font-bold text-stone-900">
        Place an order
      </h2>

      <form onSubmit={onSubmit} noValidate className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="order-event" className="label">
            Event
          </label>
          <select
            id="order-event"
            value={selected?.id ?? ""}
            onChange={(e) => changeEvent(e.target.value)}
            className="field"
            disabled={!events || events.length === 0}
          >
            {!events && <option value="">Loading events…</option>}
            {events?.length === 0 && <option value="">No upcoming events</option>}
            {events?.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name} · {formatDate(ev.starts_at)} · face value {formatPrice(ev.face_value)}
                {ev.sold_out ? " · sold out" : ""}
              </option>
            ))}
          </select>
        </div>

        <fieldset>
          <legend className="label">Side</legend>
          <div className="grid grid-cols-2 gap-2">
            {(["sell", "buy"] as const).map((s) => (
              <label
                key={s}
                className={`flex min-h-10 cursor-pointer items-center justify-center rounded-lg border px-3 text-sm font-semibold has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-blue-700 ${
                  side === s
                    ? "border-stone-900 bg-stone-900 text-white"
                    : "border-stone-400 bg-white text-stone-900"
                }`}
              >
                <input
                  type="radio"
                  name="side"
                  value={s}
                  checked={side === s}
                  onChange={() => setSide(s)}
                  className="sr-only"
                />
                {s === "sell" ? "Sell (ask)" : "Buy (bid)"}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="order-qty" className="label">
              Quantity
            </label>
            <select
              id="order-qty"
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              className="field"
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="order-price" className="label">
              Price per ticket (€)
            </label>
            <input
              id="order-price"
              type="number"
              inputMode="decimal"
              min={0.01}
              max={maxPrice}
              step={0.01}
              value={effectivePrice}
              onChange={(e) => selected && setPriceEdit({ eventId: selected.id, value: e.target.value })}
              className="field"
              aria-describedby="price-hint"
            />
          </div>
        </div>

        <p id="price-hint" className="-mt-2 text-xs text-stone-600 sm:col-span-2">
          {selected?.sold_out ? (
            <span className="badge bg-stone-900 text-white">Sold out: no price cap</span>
          ) : selected ? (
            <>Max {formatPrice(selected.face_value)} (face value) until the event sells out.</>
          ) : null}
        </p>

        <div className="sm:col-span-2">
          <label htmlFor="order-note" className="label">
            Note (private, only your trade counterpart sees it)
          </label>
          <input
            id="order-note"
            data-testid="core-input"
            type="text"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Can transfer by email the day before"
            className="field"
          />
        </div>

        <div className="sm:col-span-2">
          <button
            type="submit"
            data-testid="core-submit"
            disabled={busy}
            className="btn btn-primary w-full sm:w-auto"
          >
            {busy ? "Placing…" : "Place order"}
          </button>
          <p className="mt-2 text-xs text-stone-600">
            By placing an order you confirm you can transfer the ticket (sell) or will pay the held
            amount (buy). Prototype: no real payments.
          </p>
          <div aria-live="polite">
            {message && (
              <p
                role={message.kind === "error" ? "alert" : "status"}
                className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                  message.kind === "ok"
                    ? "border-green-700 bg-green-50 text-green-900"
                    : "border-red-700 bg-red-50 text-red-900"
                }`}
              >
                <span className="font-semibold">{message.kind === "ok" ? "Success: " : "Error: "}</span>
                {message.text}
              </p>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}
