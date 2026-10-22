-- Beebly schema: tables, RLS, functions, grants, trigger, indexes.
-- Safe to re-run. Paste into Supabase -> SQL Editor -> New query -> Run.

-- =========================================================================
-- 1. Tables
-- =========================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text unique not null check (handle ~ '^[a-z0-9_]{3,30}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  venue_type text not null,
  starts_at timestamptz not null,
  face_value numeric(8,2) not null check (face_value > 0),
  sold_out boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  side text not null check (side in ('buy', 'sell')),
  price numeric(8,2) not null check (price > 0 and price <= 9999.99),
  qty int not null check (qty between 1 and 4),
  qty_remaining int not null check (qty_remaining between 0 and 4 and qty_remaining <= qty),
  note text check (char_length(note) <= 200),
  status text not null default 'open' check (status in ('open', 'partial', 'filled', 'cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  buy_order_id uuid not null references public.orders (id) on delete cascade,
  sell_order_id uuid not null references public.orders (id) on delete cascade,
  buyer_id uuid not null references auth.users (id) on delete cascade,
  seller_id uuid not null references auth.users (id) on delete cascade,
  qty int not null check (qty between 1 and 4),
  buyer_price numeric(8,2) not null check (buyer_price > 0),
  seller_price numeric(8,2) not null check (seller_price > 0),
  spread_total numeric(10,2) generated always as ((buyer_price - seller_price) * qty) stored,
  status text not null default 'matched'
    check (status in ('matched', 'transferred', 'confirmed', 'reported', 'released', 'refunded')),
  report_reason text check (char_length(report_reason) <= 300),
  matched_at timestamptz not null default now(),
  transferred_at timestamptz,
  confirmed_at timestamptz,
  reported_at timestamptz,
  released_at timestamptz,
  refunded_at timestamptz,
  check (buyer_id <> seller_id),
  check (buyer_price >= seller_price)
);

-- =========================================================================
-- 2. Indexes
-- =========================================================================

create index if not exists orders_book_idx on public.orders (event_id, side, status, price);
create index if not exists orders_user_idx on public.orders (user_id, created_at desc);
create index if not exists trades_buyer_idx on public.trades (buyer_id);
create index if not exists trades_seller_idx on public.trades (seller_id, status);
create index if not exists trades_event_idx on public.trades (event_id);
create index if not exists events_starts_idx on public.events (starts_at);

-- =========================================================================
-- 3. Row Level Security
-- =========================================================================

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.orders enable row level security;
alter table public.trades enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "events_select_authenticated" on public.events;
create policy "events_select_authenticated" on public.events
  for select to authenticated using (auth.uid() is not null);

drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own" on public.orders
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "trades_select_party" on public.trades;
create policy "trades_select_party" on public.trades
  for select to authenticated using (auth.uid() in (buyer_id, seller_id));

-- Table privileges: anon gets nothing; authenticated can only read (writes go through RPCs).
revoke all on public.profiles, public.events, public.orders, public.trades from anon, public;
revoke insert, update, delete, truncate, references, trigger
  on public.events, public.orders, public.trades from authenticated;
revoke insert, delete, truncate, references, trigger on public.profiles from authenticated;
grant select on public.profiles, public.events, public.orders to authenticated;
-- Trades hold both prices and the spread: users read them only through get_my_trades(),
-- which returns their own price. No direct table reads.
revoke select on public.trades from authenticated;
revoke update on public.profiles from authenticated;
grant update (handle) on public.profiles to authenticated;

-- =========================================================================
-- 4. Profile trigger (auto handle on sign-up)
-- =========================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, handle)
  values (new.id, 'student_' || substr(md5(new.id::text), 1, 6))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for users created before this script ran.
insert into public.profiles (id, handle)
select id, 'student_' || substr(md5(id::text), 1, 6) from auth.users
on conflict (id) do nothing;

-- =========================================================================
-- 5. RPC functions (all writes go through these)
-- =========================================================================

-- 5.1 place_order: insert an order, then match it against the book.
create or replace function public.place_order(
  p_event_id uuid,
  p_side text,
  p_qty int,
  p_price numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_event public.events%rowtype;
  v_price numeric(8,2);
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_open_count int;
  v_order_id uuid;
  v_remaining int;
  v_cand record;
  v_fill int;
  v_trade_id uuid;
  v_trades jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'You must be logged in.' using errcode = '28000';
  end if;
  if p_side is null or p_side not in ('buy', 'sell') then
    raise exception 'Side must be buy or sell.';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 4 then
    raise exception 'Quantity must be between 1 and 4.';
  end if;
  if p_price is null or p_price <= 0 or p_price > 9999.99 then
    raise exception 'Price must be between 0.01 and 9999.99.';
  end if;
  v_price := round(p_price, 2);
  if v_price <= 0 then
    raise exception 'Price must be between 0.01 and 9999.99.';
  end if;
  if char_length(v_note) > 200 then
    raise exception 'Note must be 200 characters or fewer.';
  end if;

  -- Serialize matching per event.
  perform pg_advisory_xact_lock(hashtext(p_event_id::text));

  select * into v_event from public.events where id = p_event_id;
  if not found then
    raise exception 'Event not found.';
  end if;
  if v_event.starts_at <= now() then
    raise exception 'This event has already started.';
  end if;
  if not v_event.sold_out and v_price > v_event.face_value then
    raise exception 'Price cannot be above the face value (%) unless the event is sold out.', v_event.face_value;
  end if;

  select count(*) into v_open_count
  from public.orders
  where user_id = v_uid and event_id = p_event_id and status in ('open', 'partial');
  if v_open_count >= 10 then
    raise exception 'You already have 10 open orders for this event. Cancel one first.';
  end if;

  insert into public.orders (user_id, event_id, side, price, qty, qty_remaining, note, status)
  values (v_uid, p_event_id, p_side, v_price, p_qty, p_qty, v_note, 'open')
  returning id into v_order_id;

  v_remaining := p_qty;

  for v_cand in
    select o.id, o.user_id, o.price, o.qty_remaining
    from public.orders o
    where o.event_id = p_event_id
      and o.user_id <> v_uid
      and o.status in ('open', 'partial')
      and o.qty_remaining > 0
      and o.side = case when p_side = 'buy' then 'sell' else 'buy' end
      and (
        (p_side = 'buy' and o.price <= v_price)
        or (p_side = 'sell' and o.price >= v_price)
      )
    order by
      case when p_side = 'buy' then o.price end asc,
      case when p_side = 'sell' then o.price end desc,
      o.created_at asc
    for update
  loop
    exit when v_remaining = 0;
    v_fill := least(v_remaining, v_cand.qty_remaining);

    insert into public.trades (
      event_id, buy_order_id, sell_order_id, buyer_id, seller_id, qty, buyer_price, seller_price
    )
    values (
      p_event_id,
      case when p_side = 'buy' then v_order_id else v_cand.id end,
      case when p_side = 'sell' then v_order_id else v_cand.id end,
      case when p_side = 'buy' then v_uid else v_cand.user_id end,
      case when p_side = 'sell' then v_uid else v_cand.user_id end,
      v_fill,
      case when p_side = 'buy' then v_price else v_cand.price end,
      case when p_side = 'sell' then v_price else v_cand.price end
    )
    returning id into v_trade_id;

    update public.orders
    set qty_remaining = qty_remaining - v_fill,
        status = case when qty_remaining - v_fill = 0 then 'filled' else 'partial' end
    where id = v_cand.id;

    v_remaining := v_remaining - v_fill;
    -- Only the caller's own price is returned.
    v_trades := v_trades || jsonb_build_object('trade_id', v_trade_id, 'qty', v_fill, 'my_price', v_price);
  end loop;

  update public.orders
  set qty_remaining = v_remaining,
      status = case
        when v_remaining = 0 then 'filled'
        when v_remaining < p_qty then 'partial'
        else 'open'
      end
  where id = v_order_id;

  return jsonb_build_object(
    'order_id', v_order_id,
    'filled_qty', p_qty - v_remaining,
    'trades', v_trades
  );
end;
$$;

-- 5.2 take_order: trade immediately against one specific order.
create or replace function public.take_order(
  p_order_id uuid,
  p_qty int,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_event_id uuid;
  v_target public.orders%rowtype;
  v_event public.events%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_fill int;
  v_side text;
  v_order_id uuid;
  v_trade_id uuid;
begin
  if v_uid is null then
    raise exception 'You must be logged in.' using errcode = '28000';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 4 then
    raise exception 'Quantity must be between 1 and 4.';
  end if;
  if char_length(v_note) > 200 then
    raise exception 'Note must be 200 characters or fewer.';
  end if;

  select event_id into v_event_id from public.orders where id = p_order_id;
  if not found then
    raise exception 'Order not found.';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_event_id::text));

  select * into v_target from public.orders where id = p_order_id for update;
  if v_target.status not in ('open', 'partial') or v_target.qty_remaining = 0 then
    raise exception 'This order is no longer available.';
  end if;
  if v_target.user_id = v_uid then
    raise exception 'You cannot take your own order.';
  end if;

  select * into v_event from public.events where id = v_target.event_id;
  if v_event.starts_at <= now() then
    raise exception 'This event has already started.';
  end if;

  v_fill := least(p_qty, v_target.qty_remaining);
  v_side := case when v_target.side = 'sell' then 'buy' else 'sell' end;

  -- Filled counter-order so the trade shows up in "My orders".
  insert into public.orders (user_id, event_id, side, price, qty, qty_remaining, note, status)
  values (v_uid, v_target.event_id, v_side, v_target.price, v_fill, 0, v_note, 'filled')
  returning id into v_order_id;

  insert into public.trades (
    event_id, buy_order_id, sell_order_id, buyer_id, seller_id, qty, buyer_price, seller_price
  )
  values (
    v_target.event_id,
    case when v_side = 'buy' then v_order_id else v_target.id end,
    case when v_side = 'sell' then v_order_id else v_target.id end,
    case when v_side = 'buy' then v_uid else v_target.user_id end,
    case when v_side = 'sell' then v_uid else v_target.user_id end,
    v_fill,
    v_target.price,
    v_target.price
  )
  returning id into v_trade_id;

  update public.orders
  set qty_remaining = qty_remaining - v_fill,
      status = case when qty_remaining - v_fill = 0 then 'filled' else 'partial' end
  where id = v_target.id;

  return jsonb_build_object(
    'order_id', v_order_id,
    'filled_qty', v_fill,
    'trades', jsonb_build_array(
      jsonb_build_object('trade_id', v_trade_id, 'qty', v_fill, 'my_price', v_target.price)
    )
  );
end;
$$;

-- 5.3 cancel_order: owner only, open/partial only.
create or replace function public.cancel_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  if v_uid is null then
    raise exception 'You must be logged in.' using errcode = '28000';
  end if;

  select * into v_order from public.orders
  where id = p_order_id and user_id = v_uid
  for update;
  if not found then
    raise exception 'Order not found.';
  end if;
  if v_order.status not in ('open', 'partial') then
    raise exception 'Only open or partially filled orders can be cancelled.';
  end if;

  update public.orders set status = 'cancelled' where id = p_order_id;
  return jsonb_build_object('order_id', p_order_id, 'status', 'cancelled');
end;
$$;

-- 5.4 get_order_book: public book without notes, user ids or emails.
drop function if exists public.get_order_book(uuid);
create or replace function public.get_order_book(p_event_id uuid default null)
returns table (
  order_id uuid,
  event_id uuid,
  side text,
  price numeric,
  qty_remaining int,
  created_at timestamptz,
  handle text,
  is_mine boolean,
  seller_released_count int,
  seller_reported_count int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be logged in.' using errcode = '28000';
  end if;

  return query
  select
    o.id,
    o.event_id,
    o.side,
    o.price,
    o.qty_remaining,
    o.created_at,
    p.handle,
    o.user_id = auth.uid(),
    (select count(*)::int from public.trades t where t.seller_id = o.user_id and t.status = 'released'),
    (select count(*)::int from public.trades t where t.seller_id = o.user_id and t.status = 'reported')
  from public.orders o
  join public.events e on e.id = o.event_id
  join public.profiles p on p.id = o.user_id
  where o.status in ('open', 'partial')
    and o.qty_remaining > 0
    and e.starts_at > now()
    and (p_event_id is null or o.event_id = p_event_id)
  order by
    o.event_id,
    o.side,
    case when o.side = 'sell' then o.price end asc,
    case when o.side = 'buy' then o.price end desc,
    o.created_at asc;
end;
$$;

-- 5.5 mark_transferred: seller only, matched -> transferred.
create or replace function public.mark_transferred(p_trade_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_trade public.trades%rowtype;
  v_starts timestamptz;
begin
  if v_uid is null then
    raise exception 'You must be logged in.' using errcode = '28000';
  end if;

  select * into v_trade from public.trades where id = p_trade_id for update;
  if not found or v_uid not in (v_trade.buyer_id, v_trade.seller_id) then
    raise exception 'Trade not found.';
  end if;
  if v_trade.seller_id <> v_uid then
    raise exception 'Only the seller can mark a trade as transferred.';
  end if;
  if v_trade.status <> 'matched' then
    raise exception 'Only matched trades can be marked as transferred.';
  end if;
  select starts_at into v_starts from public.events where id = v_trade.event_id;
  if v_starts + interval '24 hours' < now() then
    raise exception 'The transfer window for this event has closed.';
  end if;

  update public.trades set status = 'transferred', transferred_at = now() where id = p_trade_id;
  return jsonb_build_object('trade_id', p_trade_id, 'status', 'transferred');
end;
$$;

-- 5.6 confirm_trade: buyer only, transferred -> confirmed.
create or replace function public.confirm_trade(p_trade_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_trade public.trades%rowtype;
  v_starts timestamptz;
begin
  if v_uid is null then
    raise exception 'You must be logged in.' using errcode = '28000';
  end if;

  select * into v_trade from public.trades where id = p_trade_id for update;
  if not found or v_uid not in (v_trade.buyer_id, v_trade.seller_id) then
    raise exception 'Trade not found.';
  end if;
  if v_trade.buyer_id <> v_uid then
    raise exception 'Only the buyer can confirm a trade.';
  end if;
  if v_trade.status <> 'transferred' then
    raise exception 'Only transferred trades can be confirmed.';
  end if;
  select starts_at into v_starts from public.events where id = v_trade.event_id;
  if v_starts + interval '24 hours' < now() then
    raise exception 'The confirmation window for this event has closed.';
  end if;

  update public.trades set status = 'confirmed', confirmed_at = now() where id = p_trade_id;
  return jsonb_build_object('trade_id', p_trade_id, 'status', 'confirmed');
end;
$$;

-- 5.7 report_trade: buyer only, before release -> reported (funds stay on hold).
create or replace function public.report_trade(p_trade_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_trade public.trades%rowtype;
  v_starts timestamptz;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null then
    raise exception 'You must be logged in.' using errcode = '28000';
  end if;
  if v_reason is null then
    raise exception 'Please describe the problem.';
  end if;
  if char_length(v_reason) > 300 then
    raise exception 'Reason must be 300 characters or fewer.';
  end if;

  select * into v_trade from public.trades where id = p_trade_id for update;
  if not found or v_uid not in (v_trade.buyer_id, v_trade.seller_id) then
    raise exception 'Trade not found.';
  end if;
  if v_trade.buyer_id <> v_uid then
    raise exception 'Only the buyer can report a problem.';
  end if;
  if v_trade.status not in ('matched', 'transferred', 'confirmed') then
    raise exception 'This trade can no longer be reported.';
  end if;
  select starts_at into v_starts from public.events where id = v_trade.event_id;
  if v_starts + interval '24 hours' < now() then
    raise exception 'The reporting window for this event has closed.';
  end if;

  update public.trades
  set status = 'reported', reported_at = now(), report_reason = v_reason
  where id = p_trade_id;
  return jsonb_build_object('trade_id', p_trade_id, 'status', 'reported');
end;
$$;

-- 5.8 release_due_trades: settle the caller's trades 24h after the event.
create or replace function public.release_due_trades()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_released int;
  v_refunded int;
begin
  if v_uid is null then
    raise exception 'You must be logged in.' using errcode = '28000';
  end if;

  update public.trades t
  set status = 'released', released_at = now()
  from public.events e
  where e.id = t.event_id
    and v_uid in (t.buyer_id, t.seller_id)
    and t.status in ('transferred', 'confirmed')
    and e.starts_at + interval '24 hours' < now();
  get diagnostics v_released = row_count;

  update public.trades t
  set status = 'refunded', refunded_at = now()
  from public.events e
  where e.id = t.event_id
    and v_uid in (t.buyer_id, t.seller_id)
    and t.status = 'matched'
    and e.starts_at + interval '24 hours' < now();
  get diagnostics v_refunded = row_count;

  return jsonb_build_object('released', v_released, 'refunded', v_refunded);
end;
$$;

-- 5.9 get_my_trades: the caller's trades with only their own price.
drop function if exists public.get_my_trades();
create or replace function public.get_my_trades()
returns table (
  trade_id uuid,
  event_id uuid,
  event_name text,
  event_starts_at timestamptz,
  role text,
  qty int,
  my_price numeric,
  my_total numeric,
  status text,
  counterpart_handle text,
  counterpart_note text,
  report_reason text,
  matched_at timestamptz,
  transferred_at timestamptz,
  confirmed_at timestamptz,
  reported_at timestamptz,
  released_at timestamptz,
  refunded_at timestamptz,
  spread_notice text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'You must be logged in.' using errcode = '28000';
  end if;

  return query
  select
    t.id,
    t.event_id,
    e.name,
    e.starts_at,
    case when t.buyer_id = v_uid then 'buyer' else 'seller' end,
    t.qty,
    case when t.buyer_id = v_uid then t.buyer_price else t.seller_price end,
    (case when t.buyer_id = v_uid then t.buyer_price else t.seller_price end) * t.qty,
    t.status,
    cp.handle,
    co.note,
    t.report_reason,
    t.matched_at,
    t.transferred_at,
    t.confirmed_at,
    t.reported_at,
    t.released_at,
    t.refunded_at,
    'Beebly keeps the difference between bid and ask.'::text
  from public.trades t
  join public.events e on e.id = t.event_id
  join public.profiles cp
    on cp.id = case when t.buyer_id = v_uid then t.seller_id else t.buyer_id end
  join public.orders co
    on co.id = case when t.buyer_id = v_uid then t.sell_order_id else t.buy_order_id end
  where v_uid in (t.buyer_id, t.seller_id)
  order by t.matched_at desc;
end;
$$;

-- =========================================================================
-- 6. Function privileges: authenticated only
-- =========================================================================

revoke all on function public.handle_new_user() from public, anon, authenticated;

revoke all on function public.place_order(uuid, text, int, numeric, text) from public, anon;
revoke all on function public.take_order(uuid, int, text) from public, anon;
revoke all on function public.cancel_order(uuid) from public, anon;
revoke all on function public.get_order_book(uuid) from public, anon;
revoke all on function public.mark_transferred(uuid) from public, anon;
revoke all on function public.confirm_trade(uuid) from public, anon;
revoke all on function public.report_trade(uuid, text) from public, anon;
revoke all on function public.release_due_trades() from public, anon;
revoke all on function public.get_my_trades() from public, anon;

grant execute on function public.place_order(uuid, text, int, numeric, text) to authenticated;
grant execute on function public.take_order(uuid, int, text) to authenticated;
grant execute on function public.cancel_order(uuid) to authenticated;
grant execute on function public.get_order_book(uuid) to authenticated;
grant execute on function public.mark_transferred(uuid) to authenticated;
grant execute on function public.confirm_trade(uuid) to authenticated;
grant execute on function public.report_trade(uuid, text) to authenticated;
grant execute on function public.release_due_trades() to authenticated;
grant execute on function public.get_my_trades() to authenticated;

-- Stop Supabase from auto-granting future functions in public to anon.
alter default privileges in schema public revoke execute on functions from anon, public;

-- =========================================================================
-- 7. Owner tools (used by the local-only /admin page)
-- =========================================================================
-- Owners are added by hand in the SQL Editor, e.g.:
--   insert into public.owners (user_id)
--   select id from auth.users where email = 'you@example.com'
--   on conflict do nothing;

create table if not exists public.owners (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- RLS on with no policies: nobody can read or write it from the app.
alter table public.owners enable row level security;
revoke all on public.owners from anon, authenticated, public;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.owners where user_id = auth.uid());
$$;

create or replace function public._require_owner()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be logged in.' using errcode = '28000';
  end if;
  if not exists (select 1 from public.owners where user_id = auth.uid()) then
    raise exception 'Only the owner can do this.' using errcode = '42501';
  end if;
end;
$$;

-- All events (past included) with order and revenue stats.
drop function if exists public.admin_list_events();
create or replace function public.admin_list_events()
returns table (
  id uuid,
  name text,
  venue_type text,
  starts_at timestamptz,
  face_value numeric,
  sold_out boolean,
  open_orders int,
  trades_count int,
  tickets_traded int,
  reported_count int,
  spread_released numeric,
  spread_pending numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_owner();

  return query
  select
    e.id,
    e.name,
    e.venue_type,
    e.starts_at,
    e.face_value,
    e.sold_out,
    (select count(*)::int from public.orders o
      where o.event_id = e.id and o.status in ('open', 'partial')),
    (select count(*)::int from public.trades t where t.event_id = e.id),
    (select coalesce(sum(t.qty), 0)::int from public.trades t
      where t.event_id = e.id and t.status <> 'refunded'),
    (select count(*)::int from public.trades t
      where t.event_id = e.id and t.status = 'reported'),
    (select coalesce(sum(t.spread_total), 0) from public.trades t
      where t.event_id = e.id and t.status = 'released'),
    (select coalesce(sum(t.spread_total), 0) from public.trades t
      where t.event_id = e.id and t.status in ('matched', 'transferred', 'confirmed', 'reported'))
  from public.events e
  order by e.starts_at desc;
end;
$$;

create or replace function public.admin_save_event(
  p_id uuid,
  p_name text,
  p_venue_type text,
  p_starts_at timestamptz,
  p_face_value numeric,
  p_sold_out boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_venue text := btrim(coalesce(p_venue_type, ''));
  v_id uuid;
begin
  perform public._require_owner();

  if v_name = '' or char_length(v_name) > 100 then
    raise exception 'Name is required (max 100 characters).';
  end if;
  if v_venue = '' or char_length(v_venue) > 60 then
    raise exception 'Venue type is required (max 60 characters).';
  end if;
  if p_starts_at is null then
    raise exception 'Start date and time are required.';
  end if;
  if p_face_value is null or p_face_value <= 0 or p_face_value > 9999.99 then
    raise exception 'Face value must be between 0.01 and 9999.99.';
  end if;

  if p_id is null then
    insert into public.events (name, venue_type, starts_at, face_value, sold_out)
    values (v_name, v_venue, p_starts_at, round(p_face_value, 2), coalesce(p_sold_out, false))
    returning id into v_id;
  else
    update public.events
    set name = v_name,
        venue_type = v_venue,
        starts_at = p_starts_at,
        face_value = round(p_face_value, 2),
        sold_out = coalesce(p_sold_out, false)
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Event not found.';
    end if;
  end if;

  return jsonb_build_object('event_id', v_id);
end;
$$;

revoke all on function public._require_owner() from public, anon, authenticated;
revoke all on function public.is_owner() from public, anon;
revoke all on function public.admin_list_events() from public, anon;
revoke all on function public.admin_save_event(uuid, text, text, timestamptz, numeric, boolean) from public, anon;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.admin_list_events() to authenticated;
grant execute on function public.admin_save_event(uuid, text, text, timestamptz, numeric, boolean) to authenticated;
