# vGarage redesign (branch `redesign`)

Overnight build of the agreed flows (see the "vGarage Flow Review" and "vGarage Prototype" artifacts)
plus a Material 3 UI. Work lands in phases, one commit each; the PR's Netlify deploy preview shows it.
Nothing is merged to `main` without Vinit's go-ahead.

## Rules agreed with Vinit
- **Product receipt**: parts bought; items go into stock; never has an odometer.
- **Service receipt**: a shop's bill; belongs to its service.
- **Service**: own date + odometer (checked against fuel + service timeline), shop or DIY, cost.
  DIY parts come from stock; each part remembers the receipt its stock came from, so parts
  receipts show on the service automatically. Attaching never changes a service's date/odometer.
- **Stock** = product receipts + "Add stock" (no receipt) − parts used − "Remove stock".
- Products link to service categories only through the product's "Used for".
- Nav: Home · Services · Fuel · Stock + More (Cars, Categories, Import & export, Admin). "+ Add" menu:
  Log fuel, Log service, Add product receipt, Add stock.
- Theme follows the device (light/dark). Desktop is as important as phone.
- Keep the existing dashboard features (MPG trend, seasons, savings, projected spend, health map,
  due soon, upcoming cost, tires). Add driving and spending trends with comparisons.

## Dev tooling
- `NEXT_PUBLIC_DEMO=1 npm run dev -- -p 3200` runs the app on an in-memory example dataset
  (`lib/demo/`), signed in, no database. Production builds never take that branch.
- Screenshots: `~/.cache/vgarage-qa/shoot.mjs` (playwright-core + Chromium on disk, outside the repo).
  Use `http://localhost:3200` (Next blocks dev resources for 127.0.0.1).

## Phases
- [x] 0. Demo mode + screenshot QA
- [x] 1. Design system (tokens light/dark, Roboto Flex, Material Symbols, shared components) + app shell
- [x] 2. Data fixes (service date, attach without overwrite, deletes, product archive, add/remove stock,
       category seeding/catalog updates/suggestions)
- [x] 3. Forms (service, product receipt, stock, fuel, car) + Add menu
- [x] 4. Analytics (miles driven, spend comparisons, cost per mile, insights)
- [x] 5. Pages (Home, Services, Fuel, Stock, More: Cars, Categories, Import & export, Admin; login)
- [ ] 6. QA on the real database, then the cleanup review (see CLAUDE.md) before merging

## SQL Vinit must run (Supabase SQL Editor)
- `supabase/convert_product_unit.sql` (from PR #1)
- `supabase/add_product_archive.sql` (Archive product; everything else works without it)

## Notes / decisions made overnight
- The catalog is a template: new entries and interval changes are offered on Service categories, never pushed
  into users' cars. "Keep mine" on an interval change is remembered per device (localStorage).
- Archiving a product requires nothing on hand, so an archived product can never be in stock or a picker.
- Old free-text category product lists stay readable; each has a "Make it a product" button in the category dialog.
- Decided later with Vinit: moving old `service_logs.receipt_url` photos into receipts (D5), the bad Oct 18 fill-up (D7).
