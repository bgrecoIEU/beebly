"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import { errorMessage } from "@/lib/format";
import type { BookRow, EventRow, MyOrder, MyTrade } from "@/lib/types";
import PlaceOrder from "./PlaceOrder";
import OrderBook from "./OrderBook";
import MyOrders from "./MyOrders";
import MyTrades from "./MyTrades";

type TabId = "market" | "my-orders" | "my-trades";

const tabs: { id: TabId; label: string }[] = [
  { id: "market", label: "Market" },
  { id: "my-orders", label: "My orders" },
  { id: "my-trades", label: "My trades" },
];

function isTab(value: string): value is TabId {
  return tabs.some((t) => t.id === value);
}

export default function MarketApp() {
  const router = useRouter();
  const session = useSession();

  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [book, setBook] = useState<BookRow[] | null>(null);
  const [orders, setOrders] = useState<MyOrder[] | null>(null);
  const [trades, setTrades] = useState<MyTrade[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // My orders is the default so a freshly saved order is visible right away.
  // The URL hash remembers the open tab (e.g. /app#market). Tabs only render after the
  // session loads on the client, so reading window here can't cause a hydration mismatch.
  const [tab, setTab] = useState<TabId>(() => {
    const fromHash = typeof window === "undefined" ? "" : window.location.hash.slice(1);
    return isTab(fromHash) ? fromHash : "my-orders";
  });
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    market: null,
    "my-orders": null,
    "my-trades": null,
  });

  function selectTab(id: TabId, focus = false) {
    setTab(id);
    window.history.replaceState(null, "", `#${id}`);
    if (focus) tabRefs.current[id]?.focus();
  }

  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    const i = tabs.findIndex((t) => t.id === tab);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    selectTab(tabs[next].id, true);
  }

  useEffect(() => {
    if (session === null) router.replace("/login");
  }, [session, router]);

  const loadBook = useCallback(async () => {
    const { data, error } = await getSupabase().rpc("get_order_book", { p_event_id: null });
    if (error) throw error;
    setBook((data ?? []) as BookRow[]);
  }, []);

  const loadOrders = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from("orders")
      .select("id, event_id, side, price, qty, qty_remaining, note, status, created_at, events(name, starts_at)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    setOrders((data ?? []) as unknown as MyOrder[]);
  }, []);

  const loadTrades = useCallback(async () => {
    const { data, error } = await getSupabase().rpc("get_my_trades");
    if (error) throw error;
    setTrades((data ?? []) as MyTrade[]);
  }, []);

  const refresh = useCallback(async () => {
    try {
      await Promise.all([loadBook(), loadOrders(), loadTrades()]);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [loadBook, loadOrders, loadTrades]);

  // First load: settle due trades, then fetch everything.
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const supabase = getSupabase();
      try {
        await supabase.rpc("release_due_trades");
        const { data, error } = await supabase
          .from("events")
          .select("id, name, venue_type, starts_at, face_value, sold_out")
          .gt("starts_at", new Date().toISOString())
          .order("starts_at", { ascending: true });
        if (error) throw error;
        if (!cancelled) setEvents((data ?? []) as EventRow[]);
      } catch (err) {
        if (!cancelled) {
          setEvents([]);
          setLoadError(errorMessage(err));
        }
      }
      if (!cancelled) await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, refresh]);

  // Keep the book fresh while the page is open.
  useEffect(() => {
    if (!userId) return;
    const timer = setInterval(() => {
      loadBook().catch(() => {});
    }, 20000);
    return () => clearInterval(timer);
  }, [userId, loadBook]);

  if (!session) {
    return (
      <p className="mx-auto max-w-5xl px-4 py-12 text-stone-700" role="status">
        Loading your market…
      </p>
    );
  }

  const counts: Record<TabId, number | null> = {
    market: book ? book.length : null,
    "my-orders": orders ? orders.length : null,
    "my-trades": trades ? trades.length : null,
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      {loadError && (
        <p role="alert" className="mb-4 rounded-lg border border-red-700 bg-red-50 px-3 py-2 text-sm text-red-900">
          <span className="font-semibold">Error: </span>
          {loadError}
        </p>
      )}

      <PlaceOrder
        events={events}
        onPlaced={async () => {
          selectTab("my-orders");
          await refresh();
        }}
      />

      <div
        role="tablist"
        aria-label="Market sections"
        className="mt-8 flex gap-1 overflow-x-auto border-b border-stone-300"
      >
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={active}
              aria-controls={`panel-${t.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => selectTab(t.id)}
              onKeyDown={onTabKey}
              className={`-mb-px shrink-0 rounded-t-lg border px-4 py-2 text-sm font-semibold ${
                active
                  ? "border-stone-300 border-b-white bg-white text-stone-900"
                  : "border-transparent text-stone-700 hover:bg-stone-100 hover:text-stone-900"
              }`}
            >
              {t.label}
              {counts[t.id] !== null && (
                <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-xs text-stone-800">
                  {counts[t.id]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-4">
        {tab === "market" && (
          <OrderBook events={events} book={book} onChanged={refresh} onRefresh={refresh} />
        )}
        {tab === "my-orders" && <MyOrders orders={orders} onChanged={refresh} />}
        {tab === "my-trades" && <MyTrades trades={trades} onChanged={refresh} />}
      </div>
    </div>
  );
}
