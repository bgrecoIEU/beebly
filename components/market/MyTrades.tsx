"use client";

import { useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { errorMessage, formatDate, formatPrice } from "@/lib/format";
import type { MyTrade } from "@/lib/types";

type Props = {
  trades: MyTrade[] | null;
  onChanged: () => Promise<void>;
};

export default function MyTrades({ trades, onChanged }: Props) {
  return (
    <section id="my-trades" aria-labelledby="my-trades-heading" className="card scroll-mt-4">
      <h2 id="my-trades-heading" className="text-xl font-bold text-stone-900">
        My trades
      </h2>
      {!trades ? (
        <p role="status" className="mt-4 text-stone-700">
          Loading your trades…
        </p>
      ) : trades.length === 0 ? (
        <p className="mt-4 text-stone-700">No trades yet. When one of your orders matches, it shows up here.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {trades.map((t) => (
            <TradeCard key={t.trade_id} trade={t} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </section>
  );
}

const steps = ["matched", "transferred", "confirmed", "released"] as const;

function Timeline({ trade }: { trade: MyTrade }) {
  const times: Record<(typeof steps)[number], string | null> = {
    matched: trade.matched_at,
    transferred: trade.transferred_at,
    confirmed: trade.confirmed_at,
    released: trade.released_at,
  };
  return (
    <div>
      <ol aria-label="Trade progress" className="mt-3 flex flex-wrap items-center gap-1 text-xs">
        {steps.map((s, i) => {
          const done = Boolean(times[s]);
          return (
            <li key={s} className="flex items-center gap-1">
              <span
                className={`badge ${done ? "bg-green-100 text-green-900" : "bg-stone-100 text-stone-600"}`}
              >
                {done ? "✓ " : ""}
                {s}
                <span className="sr-only">{done ? " (done)" : " (pending)"}</span>
              </span>
              {i < steps.length - 1 && <span aria-hidden="true" className="text-stone-500">→</span>}
            </li>
          );
        })}
      </ol>
      {trade.status === "reported" && (
        <p className="mt-2 text-sm font-medium text-red-900">
          Reported: funds stay on hold.{trade.report_reason ? ` Reason: ${trade.report_reason}` : ""}
        </p>
      )}
      {trade.status === "refunded" && (
        <p className="mt-2 text-sm font-medium text-stone-800">
          Refunded: the ticket was never marked as transferred, so the buyer was refunded.
        </p>
      )}
    </div>
  );
}

function TradeCard({ trade, onChanged }: { trade: MyTrade; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");

  const isSeller = trade.role === "seller";
  const canReport = !isSeller && ["matched", "transferred", "confirmed"].includes(trade.status);

  async function call(fn: string, args: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const { error } = await getSupabase().rpc(fn, args);
    if (error) setError(errorMessage(error));
    else {
      setReporting(false);
      await onChanged();
    }
    setBusy(false);
  }

  function onReport(e: FormEvent) {
    e.preventDefault();
    call("report_trade", { p_trade_id: trade.trade_id, p_reason: reason });
  }

  return (
    <li className="rounded-lg border border-stone-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-stone-900">{trade.event_name}</h3>
          <p className="text-sm text-stone-700">{formatDate(trade.event_starts_at)}</p>
        </div>
        <span className="badge bg-stone-900 text-white">Status: {trade.status}</span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-stone-600">You are</dt>
          <dd className="font-medium text-stone-900">{isSeller ? "Seller" : "Buyer"}</dd>
        </div>
        <div>
          <dt className="text-stone-600">Quantity</dt>
          <dd className="font-medium text-stone-900">{trade.qty}</dd>
        </div>
        <div>
          <dt className="text-stone-600">{isSeller ? "You receive" : "You pay"}</dt>
          <dd className="font-medium text-stone-900">
            {formatPrice(trade.my_price)} each ({formatPrice(trade.my_total)})
          </dd>
        </div>
        <div>
          <dt className="text-stone-600">{isSeller ? "Buyer" : "Seller"}</dt>
          <dd className="break-all font-medium text-stone-900">{trade.counterpart_handle}</dd>
        </div>
      </dl>
      <p className="mt-2 break-words text-sm text-stone-800">
        <span className="font-medium">Their note: </span>
        {trade.counterpart_note ? trade.counterpart_note : <span className="text-stone-600">No note</span>}
      </p>

      <Timeline trade={trade} />

      <p className="mt-3 text-xs text-stone-600">
        Payment is held until after the event; if there is a problem, funds stay on hold. Beebly keeps
        the difference between bid and ask.
      </p>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-900">
          <span className="font-semibold">Error: </span>
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {isSeller && trade.status === "matched" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => call("mark_transferred", { p_trade_id: trade.trade_id })}
            className="btn btn-primary"
          >
            Mark as transferred
          </button>
        )}
        {!isSeller && trade.status === "transferred" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => call("confirm_trade", { p_trade_id: trade.trade_id })}
            className="btn btn-primary"
          >
            Confirm all good
          </button>
        )}
        {canReport && !reporting && (
          <button type="button" onClick={() => setReporting(true)} className="btn btn-danger">
            Report a problem
          </button>
        )}
      </div>

      {reporting && (
        <form onSubmit={onReport} className="mt-3 space-y-2">
          <label htmlFor={`reason-${trade.trade_id}`} className="label">
            What went wrong?
          </label>
          <input
            id={`reason-${trade.trade_id}`}
            type="text"
            maxLength={300}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="field"
          />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className="btn btn-danger">
              Submit report
            </button>
            <button type="button" onClick={() => setReporting(false)} className="btn btn-secondary">
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
