# Admin dashboard and D1 setup

The store and events pages load catalog data from **Cloudflare D1** via `GET /api/products` and `GET /api/events`. The owner signs in at **`admin.html`** (not linked from the public nav) to manage records.

## 1. Create the D1 database

```bash
npx wrangler d1 create danas-estate-sales
```

Copy the `database_id` from the command output into [`wrangler.jsonc`](wrangler.jsonc) under `d1_databases[0].database_id` (replace the placeholder UUID if it is still the sample value).

## 2. Run migrations (schema + seed)

Remote:

```bash
npx wrangler d1 execute danas-estate-sales --file=./migrations/001_init.sql
npx wrangler d1 execute danas-estate-sales --file=./migrations/002_seed.sql
npx wrangler d1 execute danas-estate-sales --file=./migrations/003_product_image_urls.sql
```

If the store returns an error about `image_urls_json`, the remote database was deployed before this migration — run `003_product_image_urls.sql` against production D1 (same commands as above).

Local development database:

```bash
npx wrangler d1 execute danas-estate-sales --local --file=./migrations/001_init.sql
npx wrangler d1 execute danas-estate-sales --local --file=./migrations/002_seed.sql
```

## 3. Secrets

Set the admin password (used by `POST /api/admin/login`):

```bash
npx wrangler secret put ADMIN_PASSWORD
```

For local development, copy [`.dev.vars.example`](.dev.vars.example) to `.dev.vars` and set `ADMIN_PASSWORD` there. Do not commit `.dev.vars`.

If you use Stripe checkout from the Worker, set `STRIPE_SECRET_KEY` the same way (already documented elsewhere).

## 4. Run the Worker locally

```bash
npx wrangler dev
```

Static files are served from [`public/`](public/) (`assets.directory` in [`wrangler.jsonc`](wrangler.jsonc)). Keeping the asset root there avoids `wrangler dev` watching the whole repository (including `.wrangler/`), which otherwise can cause a tight reload loop.

Open `/store.html`, `/events.html`, and `/admin.html` through the dev server origin (not `file://`) so `/api/*` routes resolve.

## 5. Cloudflare Pages + Functions

This repo includes matching routes under [`functions/api/`](functions/api/) so **Pages Functions** can serve the same catalog and admin APIs. Bind the same D1 database and `ADMIN_PASSWORD` secret to the **Pages** project so `env.DB` and `env.ADMIN_PASSWORD` exist in each function.

Checkout remains at [`functions/api/cart.js`](functions/api/cart.js).

## 6. Product and event fields (quick reference)

- **Products**: `id` (slug), `name`, `description`, `price_cents`, `category_slug` (matches store filter `data-cat`, e.g. `furniture`), `category_label`, `image_count`, optional `hero_image_url`, optional `badge`, `sort_order`, `is_active`.
- **Events**: `id` (slug), `starts_on` (`YYYY-MM-DD`), `month_key` (three-letter filter key, e.g. `apr`), `date_month_label` / `date_day` / `date_year` (displayed on the card), `title`, `location`, `schedule_text`, `event_type`, `lead`, `extras` (JSON array of `{ "label", "body" }`), `tags` (JSON string array), `sort_order`, `is_active`.

Sessions expire after **24 hours**; the client stores the bearer token in `sessionStorage`.
