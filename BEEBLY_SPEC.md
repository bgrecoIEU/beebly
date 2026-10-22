# Beebly: detailed build spec (for Claude Code)

> How to use: put this file in your project folder next to `CLAUDE.md` and `.env.local`. Then send the short prompt at the very bottom ("Prompt to send"). `CLAUDE.md` (the grading contract) ALWAYS wins over this file. If anything here conflicts with it, follow `CLAUDE.md` and tell me.

---

## 1. Product

- **Name:** Beebly
- **One-liner:** Beebly helps IE University students resell and buy tickets for curated events through a live order book, so they never miss a party or waste a ticket.
- **Who:** university students who go to parties and events.
- **Problem:** people buy tickets and then can't go (or sell out before they can buy), and informal resale in chats is unsafe.
- **Main feature (what a user does in 30 seconds):** place a bid (buy) or an ask (sell) for a ticket to an event, and trade against the order book.
- **Data shared between users:** YES (the order book is shared among logged-in users; personal data stays private).
- **MVP is a simulation:** no real money, no real tickets, no real ticket verification. The UI must say so clearly (footer and trade pages).

### Business rules

1. **Events are curated.** Only the owner (me) creates events, directly in Supabase. The app cannot create, edit or delete events.
2. **Order book per event.** Each event has bids (buyers, max price per ticket) and asks (sellers, min price per ticket).
3. **Orders:** quantity 1 to 4 tickets per order. Partial fills are allowed.
4. **Matching:** a bid and an ask match when `bid_price >= ask_price`, same event, different users.
   - Best price first (highest bid / lowest ask), then oldest first.
   - **Both ways to trade must exist:** (a) automatic matching when an order is placed, and (b) manual "Take" buttons on the book rows.
5. **Spread revenue (platform keeps the spread):** in every trade the buyer pays their own bid price and the seller receives their own ask price. Beebly keeps the difference: `(buyer_price - seller_price) * qty`. Each user sees their own price. The landing page and every trade card state clearly: "Beebly keeps the difference between bid and ask." (No hidden fees.)
6. **Price cap:** while an event is NOT sold out, every bid and ask must be `<= face_value`. If the event is marked `sold_out = true` (set by me in Supabase), there is no cap (but keep a sanity maximum of 9999.99). The UI shows a "Sold out: no price cap" badge.
7. **Safe-resale guarantee (simulated escrow):**
   - Trade starts as `matched` (the buyer's payment is "held").
   - Seller clicks "Mark as transferred" -> `transferred`.
   - Buyer clicks "Confirm all good" -> `confirmed`, or "Report a problem" (with a short reason) -> `reported` and the funds stay **on hold**.
   - 24 hours after the event date, any trade that is `transferred` or `confirmed` (and not reported) becomes `released` (seller "paid"). A trade still `matched` (never transferred) becomes `refunded` (buyer "refunded").
   - A reported trade is never released automatically (stays on hold; no admin UI in the MVP).
8. **Seller reputation badge:** next to every seller in the book show a badge from their history: 0 released trades = "New", 1-2 = "Active", 3+ released with 0 reports = "Trusted". Show the count of released trades.
9. **No self-trading:** a user's orders never match their own.
10. **Privacy:** never show emails to other users. Each user gets an automatic public handle like `student_a1b2c3`. Order notes are private (only the counterpart of a trade sees them). Do not collect bank, card, ID or passport data anywhere.

---

## 2. Tech and architecture

- Next.js (App Router) + TypeScript + Tailwind CSS. Supabase (Auth + Postgres + RLS) via `@supabase/supabase-js`. Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the frontend. NEVER the secret/service_role key.
- **All writes go through Postgres RPC functions** (`SECURITY DEFINER`, `set search_path = public`, validate `auth.uid()` is not null). Revoke direct INSERT/UPDATE/DELETE on `orders`, `trades` and `events` from `anon` and `authenticated`. The client only calls RPCs and reads allowed data.
- Concurrency: inside `place_order`, take `pg_advisory_xact_lock(hashtext(event_id::text))` to serialize matching per event, and lock candidate rows with `FOR UPDATE`.
- No localStorage for user data (Supabase session handling is fine).
- Route protection on the client: `/app` redirects to `/login` when there is no session; `/login` and `/signup` redirect to `/app` when there is one.

### Tables (all with RLS ON)

**profiles**: `id uuid pk references auth.users`, `handle text unique not null`, `created_at`. Auto-created by a trigger on `auth.users` insert (SECURITY DEFINER) with `handle = 'student_' || substr(md5(id::text),1,6)`. RLS: a user reads/updates only their own row. Public handles are exposed only through the RPCs below.

**events**: `id uuid pk default gen_random_uuid()`, `name text`, `venue_type text`, `starts_at timestamptz`, `face_value numeric(8,2) check (face_value > 0)`, `sold_out boolean default false`, `created_at`. RLS: authenticated users can SELECT; nobody can write from the app.

**orders**: `id uuid pk`, `user_id uuid references auth.users`, `event_id uuid references events`, `side text check (side in ('buy','sell'))`, `price numeric(8,2) check (price > 0 and price <= 9999.99)`, `qty int check (qty between 1 and 4)`, `qty_remaining int check (qty_remaining between 0 and 4)`, `note text check (char_length(note) <= 200)`, `status text check (status in ('open','partial','filled','cancelled'))`, `created_at`. RLS: a user SELECTs only their own orders. The public book comes from the RPC below.

**trades**: `id uuid pk`, `event_id`, `buy_order_id`, `sell_order_id`, `buyer_id`, `seller_id`, `qty int`, `buyer_price numeric(8,2)`, `seller_price numeric(8,2)`, `spread_total numeric(10,2) generated always as ((buyer_price - seller_price) * qty) stored`, `status text check (status in ('matched','transferred','confirmed','reported','released','refunded'))`, `report_reason text`, timestamps for each step. RLS: SELECT only if `auth.uid() in (buyer_id, seller_id)`, but no direct SELECT grant for `authenticated`: users read trades only via `get_my_trades()` so they never see the counterpart price or `spread_total`.

### RPC functions (SQL, callable by `authenticated` only; revoke from `anon`/`public`)

1. `place_order(p_event_id uuid, p_side text, p_qty int, p_price numeric, p_note text) returns jsonb`
   - Validate: user is logged in; event exists and `starts_at > now()`; qty 1..4; price > 0; **cap rule** (price <= face_value unless `sold_out`); note trimmed and <= 200 chars; max 10 open orders per user per event.
   - Insert the order (`qty_remaining = qty`, `status = 'open'`), then **match**:
     - buy order: candidate sells with `price <= my price`, other users, status open/partial, ordered by `price asc, created_at asc`.
     - sell order: candidate buys with `price >= my price`, other users, status open/partial, ordered by `price desc, created_at asc`.
     - For each candidate: `fill = min(my remaining, candidate remaining)`; insert a trade with `buyer_price` = the buy order's price and `seller_price` = the sell order's price; update both orders' `qty_remaining` and `status` (`partial` or `filled`); repeat until nothing is left or no candidates.
   - Return `{ order_id, filled_qty, trades: [...] }`.
2. `take_order(p_order_id uuid, p_qty int, p_note text) returns jsonb`: immediate trade against that specific order only (not other rows), for `min(p_qty, remaining)`, with the same validations (not own order, event upcoming). Creates a filled counter-order record so it appears in "My orders". No leftover order is created.
3. `cancel_order(p_order_id uuid)`: only the owner, only if `open` or `partial`; sets `cancelled`.
4. `get_order_book(p_event_id uuid default null) returns table(...)`: open/partial orders for upcoming events (optionally one event): `order_id, event_id, side, price, qty_remaining, created_at, seller_handle/buyer_handle, seller_released_count, seller_reported_count`. **Never returns notes, user ids or emails.** Best bid and best ask per event are computed in the UI; the spread is not shown to users.
5. `mark_transferred(p_trade_id uuid)`: seller only, status `matched` -> `transferred`.
6. `confirm_trade(p_trade_id uuid)`: buyer only, status `transferred` -> `confirmed`.
7. `report_trade(p_trade_id uuid, p_reason text)`: buyer only, status `matched` or `transferred` or `confirmed` (before release) -> `reported`; reason <= 300 chars.
8. `release_due_trades()`: for the calling user's trades only: `transferred`/`confirmed` and `starts_at + interval '24 hours' < now()` -> `released`; `matched` past that time -> `refunded`. The UI calls it on every `/app` load.
9. `get_my_trades()`: the user's trades joined with event name, counterpart handle, the counterpart's note, and **only the user's own price** (plus the fixed "Beebly keeps the spread" text).

Also give me a **seed SQL** with 5 FICTIONAL events (no real club names, no IE logos): 3 upcoming at face values like 15, 20, 30; 1 upcoming marked `sold_out = true`; 1 in the past (so I can test release). Example names: "Welcome Party", "Spring Rooftop Night", "Sunset Sessions", "Winter Gala (sold out)", "Autumn Kickoff (past)".

---

## 3. Pages and data-testid map

The contract rules in `CLAUDE.md` are exact. Use these names without translating:

- `/` public landing (no login):
  - Headline: "Resell and buy event tickets, safely."
  - Subheadline: "Beebly is a live order book for IE University students: set the price you'd pay or accept, we match you, and payment stays on hold until after the party."
  - 3 short steps (Place a bid or ask -> Get matched -> Money released after the event).
  - A clear "Safe-resale guarantee" box and the fine print "Beebly keeps the difference between bid and ask. Prototype: no real payments or tickets."
  - ONE main button "Sign up" linking to `/signup` (plus a small text link "Log in").
- `/signup`: `signup-email`, `signup-password`, `signup-submit`. Email + password only, any email domain allowed, NO email confirmation, no CAPTCHA, no onboarding. After success go straight to `/app`.
- `/login`: `login-email`, `login-password`, `login-submit`. Wrong password shows a visible error and does not log in. After success go to `/app`.
- `/app` (logged-in only). A single page with these sections (use tabs or anchors, but keep everything on `/app`):
  1. **Place an order** (always visible at the top):
     - Event select (default: first upcoming event), side toggle Buy/Sell (**default Sell**), quantity select 1-4 (**default 1**), price input (**default = the selected event's face value**, updates when the event changes, always a valid value).
     - **`core-input`**: a plain TEXT field "Note (private, only your trade counterpart sees it)". Must be `type="text"`, optional, max 200 chars.
     - **`core-submit`**: "Place order". Typing only in `core-input` and clicking `core-submit` MUST save a new order using the defaults (even if it matches immediately).
     - Under the button: "By placing an order you confirm you can transfer the ticket (sell) or will pay the held amount (buy). Prototype: no real payments."
     - After submit show a visible result message: "Order placed. X ticket(s) matched." and clear the note.
  2. **Market (order book)**: event filter (select with "All events"). For each event: name, date, face value, "Sold out: no price cap" badge if applicable, best bid / best ask (the spread is never shown to users). Two tables: Asks (lowest first) and Bids (highest first), with price, qty, handle, reputation badge. Each row has `data-testid="book-row"` and a **"Take" button** `data-testid="take-button"` (not shown on your own orders), which opens a small confirm (qty 1..remaining, up to 4) and calls `take_order`.
  3. **My orders**: EVERY order the user has saved, in every status (open, partial, filled, cancelled), newest first. **Each one has `data-testid="core-item"` and shows the note text typed in `core-input`.** Show event, side, price, qty, remaining, status. "Cancel" button for open/partial. Do NOT use `core-item` anywhere else.
  4. **My trades**: cards with event, status, qty, the user's own price, counterpart handle and their note, the text "Payment is held until after the event; if there is a problem, funds stay on hold. Beebly keeps the difference between bid and ask." Actions: seller "Mark as transferred"; buyer "Confirm all good" and "Report a problem" (reason field). A visible status timeline (matched -> transferred -> confirmed -> released).
- **`logout`**: a button visible on every page of a logged-in user (header). It signs out and goes to `/`.

### Seller reputation and "My listings"
"My listings page" = the **My orders** and **My trades** sections above. The reputation badge comes from `get_order_book`.

---

## 4. UI/UX requirements

- Mobile first. Everything must work on a phone with no horizontal scroll (tables become stacked cards on small screens).
- Clean modern look, consistent palette, readable type, visible focus states, labels on every input, sufficient color contrast (WCAG 2.1 AA), buttons reachable by keyboard, errors and success messages in text (not only color).
- Loading and empty states ("No bids yet for this event").
- Do NOT use IE logos or real club/venue names. The page can say "for IE University students" in text only.
- Footer on every page: "Beebly is a student prototype. No real payments or tickets are processed."

---

## 5. Security checklist (must be true when you finish)

- RLS ON in every table; no table readable without login.
- `anon` cannot call any RPC; `authenticated` cannot INSERT/UPDATE/DELETE the tables directly.
- Only the URL and publishable key are used in the browser; no secret key anywhere (code, GitHub, logs).
- `.env.local` and `node_modules` are in `.gitignore`.
- Order notes, user ids and emails are never returned by `get_order_book`.
- Every RPC checks `auth.uid()` and ownership/role (seller vs buyer).
- Price cap and event-date checks are enforced inside the database, not only in the UI.

---

## 6. How to give me the SQL

Give me ONE SQL script (tables, RLS, functions, revoke/grant, trigger, indexes) in the right order, plus a separate seed script. Tell me exactly: Supabase -> SQL Editor -> New query -> paste -> Run. Make the scripts safe to re-run (`create or replace`, `drop policy if exists`, etc.).

---

## 7. Tests to run and report (use two accounts, A and B)

1. Sign up A and B. Both land on `/app` without email confirmation. Wrong password is rejected.
2. A places a SELL at face value with only the note filled in: it appears in A's My orders (`core-item` with the note), and B does not see the note anywhere.
3. B places a BUY at the same price: they match, two trades records are created, both see the trade in My trades with their own price.
4. Spread: A sells at 18, B buys at 20 for 2 tickets: trade has seller_price 18, buyer_price 20, spread_total 4.00.
5. Partial fill: A sells 3, B buys 1 -> A's order is `partial` with 2 remaining.
6. Price cap: try a bid above face value on a normal event (rejected); on the sold-out event (accepted).
7. A cannot match their own orders. B cannot cancel A's order. A cannot call `confirm_trade` as the buyer.
8. Logged out: reading `orders`, `trades`, `events` and calling any RPC fails.
9. Past event: trades on it become `released`/`refunded` after `release_due_trades()`.
10. Phone width: nothing scrolls sideways.
Report any test that fails and fix it.

---

## 8. Out of scope (do not build)

Real payments, ticket verification or QR, admin panel, email notifications, IE-domain restriction, chat, images. Keep it simple and working.

---

## Prompt to send to Claude Code (after `CLAUDE.md` and `.env.local` exist)

```
Read CLAUDE.md first, then BEEBLY_SPEC.md. CLAUDE.md always wins on conflicts.
Build the Beebly app exactly as specified in BEEBLY_SPEC.md: Next.js + TypeScript + Tailwind connected to my Supabase project (keys in .env.local).
Work in this order and stop to show me results after each one:
1. Project setup, landing page, /signup, /login, /app shell, logout, with the exact data-testid names.
2. The SQL (one schema script + one seed script) and where to paste it in Supabase. Wait for me to confirm I ran it.
3. The /app sections: place order, order book with filter and Take buttons, My orders (core-item), My trades.
4. Run the 10 tests in section 7 and report the results, fixing anything that fails.
5. Initialise git with a .gitignore that excludes .env.local and node_modules, then tell me how to run it locally.
Never put a secret/service_role key in the code. If something in the spec is unclear or conflicts with CLAUDE.md, ask me before guessing.
```
