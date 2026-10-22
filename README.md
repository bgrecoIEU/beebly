# beebly

Beebly is a live order book where IE University students resell and buy event tickets. It's a student prototype: no real payments or tickets.

Stack: Next.js (App Router) + TypeScript + Tailwind, with Supabase (Auth + Postgres + RLS). All writes go through Postgres RPC functions.

## Setup

1. **Supabase database.** Supabase -> SQL Editor -> New query -> paste [supabase/schema.sql](supabase/schema.sql) -> Run. Then open a new query, paste [supabase/seed.sql](supabase/seed.sql) and Run. Both scripts are safe to re-run. Re-running the seed also moves the event dates forward again.
2. **Turn off email confirmation.** Supabase -> Authentication -> Sign In / Providers -> Email -> turn off "Confirm email". The grading contract requires this.
3. **Keys.** Copy `.env.example` to `.env.local` and fill in the Project URL and the publishable (anon) key from Supabase -> Project Settings -> API. Never use the secret/service_role key.
4. **Run locally:**

   ```bash
   npm install
   npm run dev
   ```

   Open http://localhost:3000.

## Deploying on Vercel

Import the GitHub repo and add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` as environment variables.

## Owner console (local only)

The `/admin` page lets the owner publish and edit events and see the spread earned. It only exists under `npm run dev`; production builds such as Vercel return 404. The database also checks the `owners` table on every owner call, so the deployed site can't be used to manage events either.

To make your account an owner, sign up in the app, then run this once in Supabase -> SQL Editor:

```sql
insert into public.owners (user_id)
select id from auth.users where email = 'you@example.com'
on conflict do nothing;
```

Then run `npm run dev`, log in and open http://localhost:3000/admin. An "Owner" link also appears in the header.

## Managing events in Supabase

You can still edit events directly in Supabase (Table Editor -> `events`). To mark an event as sold out, which removes the price cap, set `sold_out = true`.
