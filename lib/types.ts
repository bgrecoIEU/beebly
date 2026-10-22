export type Side = "buy" | "sell";

export type EventRow = {
  id: string;
  name: string;
  venue_type: string;
  starts_at: string;
  face_value: number;
  sold_out: boolean;
};

export type BookRow = {
  order_id: string;
  event_id: string;
  side: Side;
  price: number;
  qty_remaining: number;
  created_at: string;
  handle: string;
  is_mine: boolean;
  seller_released_count: number;
  seller_reported_count: number;
};

export type OrderStatus = "open" | "partial" | "filled" | "cancelled";

export type MyOrder = {
  id: string;
  event_id: string;
  side: Side;
  price: number;
  qty: number;
  qty_remaining: number;
  note: string | null;
  status: OrderStatus;
  created_at: string;
  events: { name: string; starts_at: string } | null;
};

export type TradeStatus =
  | "matched"
  | "transferred"
  | "confirmed"
  | "reported"
  | "released"
  | "refunded";

export type MyTrade = {
  trade_id: string;
  event_id: string;
  event_name: string;
  event_starts_at: string;
  role: "buyer" | "seller";
  qty: number;
  my_price: number;
  my_total: number;
  status: TradeStatus;
  counterpart_handle: string;
  counterpart_note: string | null;
  report_reason: string | null;
  matched_at: string;
  transferred_at: string | null;
  confirmed_at: string | null;
  reported_at: string | null;
  released_at: string | null;
  refunded_at: string | null;
  spread_notice: string;
};

export type OrderResult = {
  order_id: string;
  filled_qty: number;
  trades: { trade_id: string; qty: number; my_price: number }[];
};
