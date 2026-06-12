# Modern — Work Order App

Internal work-order management for **Modern Studio Equipment**. This is the
**Phase 1 spine**: manual order entry, per-item triage, the five tabs, priority,
the printable work order, and the office Orders view — on a real, multi-user
Supabase backend so the whole office sees one live board.

The floor never logs in. The app's job is to give the office a live picture and
to push clear, prioritized work to the floor **on paper**.

## What's in Phase 1

- **New Orders** — every new order, grouped, with per-item triage (In Stock →
  Pick List · Create WO → Work Order · Material → Purchasing).
- **Pick List** — in-stock items to grab off the shelf.
- **Work Order** — items to make, each opening a **printable work order** that
  matches the shop's paper sheet. RUSH/High orders print the priority loud.
- **Purchasing** — material buy queue. *Mark ordered* (so it isn't bought
  twice) and *Have it → Work Order* (auto-advances the item once material is in).
- **Orders** — the office "where's my order?" view: filter/sort with live
  counts and a per-product progress tracker. When an order's items are all done
  it shows **Ship** and **Will Call** actions; each records the **warehouse
  location** where the order is staged and sends it to the matching tab below.
- **Will Call / Shipping** — the two fulfillment tabs. Will Call shows held
  orders and where to find them. Shipping shows staged orders with a **Shipped**
  button that logs a **tracking number** when the order actually goes out.
- **Manual order entry** — the New Order form (phone orders today).
- **Auth** — email/password login; any authenticated office user has full access.
- **Realtime** — the board updates for everyone without a refresh.

**Deliberately not built yet** (later phases, per the brief): Shopify auto-pull,
the parts photo library (the Pick List and Work Order show graceful photo
placeholders), and StatusPro notifications.

## Stack

React + Vite · Tailwind CSS v4 · Supabase (Postgres + Auth + Realtime). Deploys
cleanly to Vercel.

---

## Run it

### Option A — local demo mode (no backend, 30 seconds)

Leave the Supabase env vars blank and the app runs against an in-browser
localStorage store seeded with sample orders. Great for clicking through the
workflow. Single machine only — open two tabs and they stay in sync, but it's
not shared across computers.

```bash
npm install
npm run dev
```

Open http://localhost:5173. A banner reminds you you're in local mode.

### Option B — real Supabase backend (multi-user)

1. **Create a project** at [supabase.com](https://supabase.com) (free tier is
   fine).

2. **Run the SQL.** In the Supabase dashboard → **SQL Editor**, run these in
   order (or use the Supabase CLI — see below):
   - `supabase/migrations/0001_init.sql`
   - `supabase/migrations/0002_functions.sql`
   - `supabase/migrations/0003_rls.sql`
   - `supabase/migrations/0004_realtime.sql`
   - `supabase/seed.sql` *(optional sample data)*

3. **Turn on email auth.** Dashboard → **Authentication → Providers → Email**
   (on by default). For a small internal team you'll likely want to **disable
   "Confirm email"** under Authentication → Sign In / Providers so accounts work
   immediately. Create your office users by signing up in the app, or add them
   under Authentication → Users.

4. **Set env vars.** Copy `.env.example` to `.env` and fill in from
   **Project Settings → API**:

   ```
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```

5. `npm run dev` — you'll get the login screen. Sign up / sign in, and you're on
   the live board.

> Using the Supabase CLI instead of the SQL editor? `supabase link` your project,
> then `supabase db push` applies everything in `supabase/migrations/`.

---

## Deploy (Vercel)

1. Push this folder to a GitHub repo.
2. Import it in Vercel. Framework preset: **Vite** (build `npm run build`,
   output `dist`).
3. Add the two `VITE_SUPABASE_*` environment variables in the Vercel project
   settings.
4. Deploy. Pushes to the main branch auto-deploy.

---

## Data model

```
orders     (id, order_no, customer, contact, received_at, priority, source,
            will_call, fulfillment, fulfillment_location, fulfilled_at,
            tracking_number, shipped_at)
  └─ items    (id, name, qty, dept, color, stage, needs_material, position)
       └─ materials (id, name, amount, ordered, received)
```

- **Triage and routing are per *item*, not per order.** One order can have items
  in Pick List, Work Order, and Purchasing simultaneously. It's only "done" when
  every item is done; the Orders view is where they reconverge.
- **`stage`**: `new` → `picklist` | `workorder` | `awaiting` → `done`.
- **Material `amount` is free text** ("20 ft", "2 sheets"). No inventory counts —
  "have it" means a human confirmed the material is on the shelf.
- Multi-step writes (`create_order`, `triage_need_material`, `receive_material`)
  are SQL functions so they're atomic under concurrent use.

## Project structure

```
src/
  App.jsx                  shell: tabs, board, modal routing
  theme.js                 colors, helpers (color = meaning only)
  lib/
    supabase.js            client + "is it configured?" check
    db.js                  picks the adapter; the app only imports `db`
    adapters/
      supabaseAdapter.js   the real backend (Postgres + RPC + realtime)
      localAdapter.js      localStorage demo mode
    seed.js                sample data for local mode
  hooks/
    useAuth.js             session (no-op in local mode)
    useOrders.js           live board: fetch + subscribe + mutations
  components/
    Auth.jsx               email/password login
    ui.jsx                 shared primitives (Pill, Btn, Group, Stepper…)
    modals/                NewOrder, Material, OrderDetail, PickPhoto, WorkOrderDoc
supabase/
  migrations/              schema, functions, RLS, realtime
  seed.sql                 sample board
```

The whole app talks to one `db` interface and never knows which backend is
behind it — swapping local ↔ Supabase is just the env vars.

## Operational notes (from the build brief)

- **The return path is the risk, not the code.** The board is only as accurate
  as the habit of someone marking jobs done as they finish on the floor. Name
  that person before launch.
- **Keep it office-only.** The floor stays on paper; the app prints the work
  orders.
- **Lean on managed services** (Supabase/Vercel) so there's little to maintain,
  and identify a real person who owns fixing it.
