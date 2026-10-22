"use client";

import { useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { errorMessage, formatDate, formatPrice, reputation } from "@/lib/format";
import type { BookRow, EventRow, OrderResult } from "@/lib/types";

type Props = {
  events: EventRow[] | null;
  book: BookRow[] | null;
  onChanged: () => Promise<void>;
  onRefresh: () => Promise<void>;
};

export default function OrderBook({ events, book, onChanged, onRefresh }: Props) {
  const [filter, setFilter] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const shown = (events ?? []).filter((e) => filter === "all" || e.id === filter);

  async function refresh() {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  }

  return (
    <section id="market" aria-labelledby="market-heading" className="card scroll-mt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="market-heading" className="text-xl font-bold text-stone-900">
          Market (order book)
        </h2>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="book-filter" className="label">
              Event
            </label>
            <select
              id="book-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="field"
            >
              <option value="all">All events</option>
              {events?.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                </option>
              ))}
            </select>
          </div>
          <button type="button" onClick={refresh} disabled={refreshing} className="btn btn-secondary">
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div aria-live="polite">
        {notice && (
          <p role="status" className="mt-4 rounded-lg border border-green-700 bg-green-50 px-3 py-2 text-sm text-green-900">
            <span className="font-semibold">Success: </span>
            {notice}
          </p>
        )}
      </div>

      {!events || !book ? (
        <p role="status" className="mt-4 text-stone-700">
          Loading the order book…
        </p>
      ) : shown.length === 0 ? (
        <p className="mt-4 text-stone-700">No upcoming events yet.</p>
      ) : (
        <div className="mt-6 space-y-8">
          {shown.map((ev) => (
            <EventBook
              key={ev.id}
              event={ev}
              rows={book.filter((r) => r.event_id === ev.id)}
              onTaken={async (text) => {
                setNotice(text);
                await onChanged();
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function EventBook({
  event,
  rows,
  onTaken,
}: {
  event: EventRow;
  rows: BookRow[];
  onTaken: (text: string) => Promise<void>;
}) {
  const asks = rows.filter((r) => r.side === "sell").sort((a, b) => a.price - b.price);
  const bids = rows.filter((r) => r.side === "buy").sort((a, b) => b.price - a.price);
  const bestAsk = asks[0]?.price;
  const bestBid = bids[0]?.price;

  return (
    <article aria-labelledby={`ev-${event.id}`} className="rounded-lg border border-stone-200 p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id={`ev-${event.id}`} className="text-lg font-semibold text-stone-900">
            {event.name}
          </h3>
          <p className="text-sm text-stone-700">
            {formatDate(event.starts_at)} · {event.venue_type} · Face value {formatPrice(event.face_value)}
          </p>
        </div>
        {event.sold_out && <span className="badge bg-stone-900 text-white">Sold out: no price cap</span>}
      </header>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-center text-sm">
        <Stat label="Best bid" value={bestBid !== undefined ? formatPrice(bestBid) : "None"} />
        <Stat label="Best ask" value={bestAsk !== undefined ? formatPrice(bestAsk) : "None"} />
      </dl>

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <BookSide title="Asks (sellers, lowest first)" empty="No asks yet for this event." rows={asks} event={event} onTaken={onTaken} />
        <BookSide title="Bids (buyers, highest first)" empty="No bids yet for this event." rows={bids} event={event} onTaken={onTaken} />
      </div>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-stone-100 px-2 py-2">
      <dt className="text-xs text-stone-600">{label}</dt>
      <dd className="font-semibold text-stone-900">{value}</dd>
    </div>
  );
}

function BookSide({
  title,
  empty,
  rows,
  event,
  onTaken,
}: {
  title: string;
  empty: string;
  rows: BookRow[];
  event: EventRow;
  onTaken: (text: string) => Promise<void>;
}) {
  return (
    <div>
      <h4 className="mb-2 font-semibold text-stone-900">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-sm text-stone-700">{empty}</p>
      ) : (
        <>
          <div aria-hidden="true" className="hidden grid-cols-[1fr_3rem_1.5fr_5rem] gap-2 px-3 text-xs font-medium text-stone-600 sm:grid">
            <span>Price</span>
            <span>Qty</span>
            <span>{rows[0].side === "sell" ? "Seller" : "Buyer"}</span>
            <span />
          </div>
          <ul className="space-y-2">
            {rows.map((row) => (
              <BookRowItem key={row.order_id} row={row} event={event} onTaken={onTaken} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function BookRowItem({
  row,
  event,
  onTaken,
}: {
  row: BookRow;
  event: EventRow;
  onTaken: (text: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maxQty = Math.min(row.qty_remaining, 4);
  const isAsk = row.side === "sell";
  const badge = reputation(row.seller_released_count, row.seller_reported_count);

  async function onConfirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await getSupabase().rpc("take_order", {
      p_order_id: row.order_id,
      p_qty: qty,
      p_note: note,
    });
    setBusy(false);
    if (error) {
      setError(errorMessage(error));
      return;
    }
    const result = data as OrderResult;
    setOpen(false);
    await onTaken(
      `${isAsk ? "Bought" : "Sold"} ${result.filled_qty} ticket(s) for ${event.name} at ${formatPrice(row.price)} each. See My trades.`,
    );
  }

  return (
    <li data-testid="book-row" className="rounded-lg border border-stone-200 bg-stone-50 p-3">
      <div className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[1fr_3rem_1.5fr_5rem]">
        <span className="font-semibold text-stone-900">
          {formatPrice(row.price)}
          <span className="ml-1 text-xs font-normal text-stone-600 sm:hidden">per ticket</span>
        </span>
        <span className="text-right text-sm text-stone-800 sm:text-left">
          <span className="sm:hidden">Qty </span>
          {row.qty_remaining}
        </span>
        <span className="min-w-0 text-sm text-stone-800">
          <span className="break-all">{row.handle}</span>
          {row.is_mine && <span className="ml-1 text-xs text-stone-600">(you)</span>}
          {isAsk && (
            <span className="mt-1 flex flex-wrap items-center gap-1">
              <span
                className={`badge ${
                  badge === "Trusted"
                    ? "bg-green-100 text-green-900"
                    : badge === "Active"
                      ? "bg-blue-100 text-blue-900"
                      : "bg-stone-200 text-stone-800"
                }`}
              >
                {badge}
              </span>
              <span className="text-xs text-stone-600">{row.seller_released_count} released</span>
            </span>
          )}
        </span>
        <span className="text-right">
          {!row.is_mine && (
            <button
              type="button"
              data-testid="take-button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="btn btn-dark min-h-9 px-3 py-1"
            >
              Take
            </button>
          )}
        </span>
      </div>

      {open && (
        <form onSubmit={onConfirm} className="mt-3 space-y-3 border-t border-stone-200 pt-3">
          <p className="text-sm text-stone-800">
            {isAsk ? "Buy" : "Sell"} at {formatPrice(row.price)} per ticket. Payment is held until after
            the event.
          </p>
          <div className="grid gap-3 sm:grid-cols-[6rem_1fr]">
            <div>
              <label htmlFor={`take-qty-${row.order_id}`} className="label">
                Quantity
              </label>
              <select
                id={`take-qty-${row.order_id}`}
                value={qty}
                onChange={(e) => setQty(Number(e.target.value))}
                className="field"
              >
                {Array.from({ length: maxQty }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`take-note-${row.order_id}`} className="label">
                Note (private, only your counterpart sees it)
              </label>
              <input
                id={`take-note-${row.order_id}`}
                type="text"
                maxLength={200}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="field"
              />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-900">
              <span className="font-semibold">Error: </span>
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className="btn btn-primary">
              {busy ? "Confirming…" : `Confirm ${isAsk ? "buy" : "sell"}`}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary">
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
