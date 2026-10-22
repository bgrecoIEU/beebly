"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { errorMessage, formatDate, formatPrice } from "@/lib/format";
import type { MyOrder } from "@/lib/types";

const statusStyle: Record<MyOrder["status"], string> = {
  open: "bg-blue-100 text-blue-900",
  partial: "bg-amber-100 text-amber-900",
  filled: "bg-green-100 text-green-900",
  cancelled: "bg-stone-200 text-stone-800",
};

type Props = {
  orders: MyOrder[] | null;
  onChanged: () => Promise<void>;
};

export default function MyOrders({ orders, onChanged }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cancel(id: string) {
    setBusyId(id);
    setError(null);
    const { error } = await getSupabase().rpc("cancel_order", { p_order_id: id });
    if (error) setError(errorMessage(error));
    else await onChanged();
    setBusyId(null);
  }

  return (
    <section id="my-orders" aria-labelledby="my-orders-heading" className="card scroll-mt-4">
      <h2 id="my-orders-heading" className="text-xl font-bold text-stone-900">
        My orders
      </h2>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-900">
          <span className="font-semibold">Error: </span>
          {error}
        </p>
      )}
      {!orders ? (
        <p role="status" className="mt-4 text-stone-700">
          Loading your orders…
        </p>
      ) : orders.length === 0 ? (
        <p className="mt-4 text-stone-700">You haven&apos;t placed any orders yet.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {orders.map((o) => (
            <li key={o.id} data-testid="core-item" className="rounded-lg border border-stone-200 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-stone-900">
                    <span className={o.side === "sell" ? "text-rose-800" : "text-emerald-800"}>
                      {o.side === "sell" ? "Sell" : "Buy"}
                    </span>{" "}
                    {o.qty} × {formatPrice(o.price)} · {o.events?.name ?? "Event"}
                  </p>
                  <p className="text-sm text-stone-700">
                    Remaining {o.qty_remaining} of {o.qty} · placed {formatDate(o.created_at)}
                  </p>
                  <p className="mt-1 break-words text-sm text-stone-800">
                    <span className="font-medium">Note: </span>
                    {o.note ? o.note : <span className="text-stone-600">No note</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`badge ${statusStyle[o.status]}`}>Status: {o.status}</span>
                  {(o.status === "open" || o.status === "partial") && (
                    <button
                      type="button"
                      onClick={() => cancel(o.id)}
                      disabled={busyId === o.id}
                      className="btn btn-danger min-h-9 px-3 py-1"
                    >
                      {busyId === o.id ? "Cancelling…" : "Cancel"}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
