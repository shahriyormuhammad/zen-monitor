# Bider reference analysis - 2026-05-18

Status: sanitized product research. Use as a workflow reference only.

## Boundary

- Do not copy Bider code, assets, exact UI, texts, icons, color system, database files, or protected implementation details.
- Do not store phones, seller names, tokens, INN, campaign IDs, WB tokens, or API keys from the local Bider installation in this repository.
- Allowed target: build a Procifry-native advertising and WB visibility terminal with similar operator value, our own UX, our own architecture, guardrails, audit, and official WB integrations where possible.

## Observed source

- Desktop app: Bider v.418.1, opened in Windows VM.
- Observed screens: `Vyidacha WB`, `Kartochki`, `Reklama`, `Nastroiki`.
- Local data was inspected only as high-level metadata. Sensitive fields were intentionally excluded.

## Product shape

Bider is a dense desktop operator terminal, not a marketing dashboard.

Core pattern:

1. Top-level modules as tabs.
2. Global sync button, period filters, seller selector, account/licence status.
3. Large master tables with very compact rows.
4. Selected row opens a bottom detail area.
5. Detail area has tabs for daily metrics, stocks, catalogs, search queries, and zones.
6. Color is used for operational state: active, pause, selected row, warnings, money/bid/status signals.

This is the key idea to adapt: table-first control surface for a WB operator.

User clarification from 2026-05-18:

- The goal is not to copy Bider's dark theme or exact colors.
- The goal is to reproduce the useful data visualization model: dense tables, selected row, bottom details, query/stock/day tabs, and metrics placed next to actions.
- The Procifry implementation should look native to our product, but keep Bider-like operator visibility and information density.

## Screen map

### Vyidacha WB

Observed function:

- Left panel with WB search queries and frequency.
- Query search input.
- Filters for own products and organic results.
- Geo selector.
- Large right area for query output / positions / visibility.
- Bottom synonyms area.

Procifry adaptation:

- `Search visibility` module: query frequency, geo, own/organic/ad positions, product rank, category rank, share of visible products, and history by day.
- Connect it to product groups and advertising decisions, so a bid change can be judged by visibility impact, not only clicks.

### Kartochki

Observed function:

- Master product table with image, name, nmId, brand/subject, colors, tags, rating/reviews, price, stock, baskets/orders, DRR, ad spend, auction/CPC/budget, and visibility signals.
- Selected product panel with product card and detailed metric tabs.
- Daily table for selected product.
- Extra tabs for stock, catalogs, and queries.

Procifry adaptation:

- `Products terminal` inside advertising: compact product rows with financial and ad context together.
- Bottom split panel: product summary + daily performance + stock + catalog/query visibility.
- Group-aware metrics: margin, profit, DRR, ad spend, orders, stock risk, and cannibalization by product group.

### Reklama

Observed function:

- Filters by campaign type/status: active, paused, all, archive.
- Campaign table with product image, campaign name/status, campaign metadata, period, zones, targeting, bid, budget, CTR, spend, daily spend, account/payment numbers, conversions, baskets/orders, DRR, and revenue.
- Selected campaign panel with product/campaign summary and detail tabs.
- Detail tables include day-level metrics and query/zone breakdowns.

Procifry adaptation:

- `Advertising terminal` advanced mode:
  - campaign master table;
  - status filters;
  - bid/budget/CTR/clicks/spend/orders/revenue/DRR columns;
  - selected campaign detail panel;
  - query and zone analysis;
  - action controls with dry-run, approval, guardrails, and audit.

### Nastroiki

Observed function:

- Account list.
- Seller/shop list.
- API-token state.
- Licence state.
- Helper controls for sync, save, proxy, zoom, and support.

Procifry adaptation:

- Keep this in our tenant/admin settings, not in the advertising terminal.
- Show token health and data freshness, but never expose raw tokens after save.
- Add role-based access, audit, and warnings for expired or missing WB API scopes.

## Data clues

High-level local metadata only:

- Product/card dataset: around 146 cards.
- Campaign dataset: around 37 campaigns.
- Campaign metadata includes minimum CPM, minimum auto CPM, and minimum budget.
- Local app stores card, campaign, catalog, cluster, account, and seller metadata.

Do not reuse local Bider data structures as an implementation contract. Treat this only as proof of the product domains the terminal covers.

## Mapping to current Procifry code

Relevant existing areas:

- `docs/advertising/ADVERTISING_AUTOPILOT_MINIMAL_UX.md`
- `src/components/advertising/**`
- `src/server/advertising/**`
- `src/app/api/views/advertising/**`

Recommended direction:

- Keep current decision center and autopilot architecture.
- Add an advanced `Advertising Terminal` view for power users.
- Do not replace the current simpler UX; make terminal mode an operator-grade workspace.

## MVP plan

P96 - Terminal spec:

- Convert this research into a concrete Procifry UX/data spec.
- Define exact columns, filters, detail tabs, and allowed actions.
- Decide which metrics come from current DB, WB APIs, calculated economics, or new sync jobs.

P97 - Terminal shell:

- Add advanced advertising page/view.
- Implement dense dark table layout, global filters, status counters, and bottom split panel.
- Use mock/server-shaped data first if needed, but keep API contracts realistic.

P98 - Campaign and product tables:

- Add campaign master table.
- Add product master table.
- Support active/pause/archive filters, search, sorting, and selected row state.

P99 - Detail panels:

- Add daily metrics tab.
- Add stock tab.
- Add catalogs tab.
- Add search queries / zones tab.

P100 - Search visibility:

- Add query frequency and geo-based visibility view.
- Link query visibility to products, product groups, and campaigns.

P101 - Controlled actions:

- Bid/budget/pause/resume actions through existing guardrails.
- Dry-run before mutation.
- Approval path for risky actions.
- Audit log for every operator and autopilot change.

## Risks

- Exact cloning creates legal and product risk. Build a functional analogue with our own design.
- Desktop-level density can be too heavy for normal web users. Keep this as advanced mode.
- Bider may rely on private or fragile WB behavior. Procifry should prefer official APIs and explicit fallbacks.
- Token/account data is sensitive. Keep secrets out of docs, screenshots, logs, and client payloads.
- The best improvement over Bider is not visual similarity, but safer control: tenant isolation, approvals, audit, PnL-aware decisions, and data freshness warnings.
