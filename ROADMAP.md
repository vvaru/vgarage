# vGarage Roadmap

Personal car maintenance tracker PWA — Next.js 16, Supabase, Tailwind CSS v4.

---

## v0.0 — Initial Release ✅
**Shipped:** Auth (Google + email/password), dashboard with service reminders and fuel stats, service log with CRUD, fuel log with MPG tracking.

## v0.1 — History & Import ✅
**Shipped:** Carfax-style PDF export, receipt attachments (upload/crop/compress), Carfax JSON import via Claude prompt, service categories system with products, spend analytics, fuel period filters and seasonal MPG averages, shop name/location on service records.

---

## v0.2 — Fixes & Polish 🔧
_Targeted corrections based on observed issues._

- [ ] **Carfax prompt uses hardcoded vehicle** — interpolate actual `year make model` from vehicle record
- [ ] **PDF export PNG images** — `addImage` format hint is hardcoded `'JPEG'`; use `'PNG'` when source is PNG
- [ ] **Receipt viewer in-app** — tap-to-view lightbox for attached receipts without exporting PDF
- [ ] **Fuel log edit** — add/delete only; same edit flow as service records
- [ ] **Fuel MPG stale on delete** — deleting a fillup should recalculate the next entry's MPG
- [ ] **Seasonal MPG empty state** — show all four seasons with `—` placeholders before data exists
- [ ] **schema migration check** — detect missing V2 columns on startup and surface a clear setup prompt
- [ ] **`performed_by` schema default** — change from `'owner'` to explicit; prevents silent wrong attribution on partial inserts

---

## v0.3 — Major Features 🚀
_Significant new functionality._

### Service record overhaul (add flow)
New multi-step add flow:
1. Attach receipt(s) first
2. Select number of products bought + services performed
3. Each item gets its own pending entry (odometer, maintenance/repair, shop/owner, sub-category, date, cost, notes; receipt card shows the attached image)
4. On save, entries with the same date are **unified** into a single grouped record in both the service log UI and the PDF export, with each line item shown within the group

### Upcoming services — expanded cards
- Tap a service card to expand it and see the full history for that sub-category (date, odometer, cost of each past record)
- Mileage-based prediction: calculate actual miles/month from odometer readings (fuel + service logs) and predict whether an interval will be hit by miles before the time limit (e.g. oil change due at 5,000 mi but averaging 1,800 mi/month → due in ~2.8 months, not the rated 6 months)
- Upcoming cost card uses product `last_price` or historical average, predicted against the real miles/month rate

### Sub-category products (Category Manager)
- Add multiple products per sub-category: **Product Name**, **Product Link**, **Last Bought at Price**
- Product prices feed into the upcoming cost prediction
- (Already in schema; needs full UI in Category Manager and wiring to dashboard cost card)

### Service log — type filter
- Filter bar to select a specific service/product type (e.g. "Oil Change")
- Shows all records matching that type
- If other services were performed on the same date, the full grouped record is shown alongside

### Additional v0.3 items
- [ ] **VIN decoder** — auto-fill make/model/year/trim from NHTSA free API on vehicle setup
- [ ] **Export to CSV** — raw data export alongside PDF
- [ ] **Multiple vehicles** — schema already supports it; needs a vehicle switcher UI
- [ ] **Repair warranty reminders** — "warranty expires" date field on repair records + dashboard card

---

## Notes on the schema suggestion you asked about (v0.2 item)
The `performed_by` column in `service_logs` currently defaults to `'owner'` in the database. Every Carfax import correctly sets it to `'shop'` in code, so nothing is broken right now. The suggestion is just a safety net: change the default to `null` and add a `NOT NULL` constraint so that any future code path that forgets to set it will get a database error instead of silently marking a shop service as owner-performed. It's a defensive database hygiene change, not a fix for anything that's currently wrong.
