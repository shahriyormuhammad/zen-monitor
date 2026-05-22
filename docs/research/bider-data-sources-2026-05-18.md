# Bider Data Sources Research · 2026-05-18

Scope: observable behavior only. No private Bider code, secrets, tokens, phone
numbers, seller names, INN values or proprietary payload values are copied here.

## Observed Local Layout

Installed app:

- `C:\Users\vitea_b\AppData\Local\Bider\Bider.exe`
- app version observed earlier: `418.1`

Local data folders:

- `Config/Users.md`
- `Config/Wnd.md`
- `Market/WbCatalogs.md`
- `Market/WbClusters.md`
- `Trading/CardsMeta.md`
- `Trading/CmpMeta.md`
- `Trading/Cards/Card_<nmId>.md`
- `Trading/CmpData/Cmp_<advertId>.md`
- `InitClusters.zip`

Counts observed in this installation:

- `Trading/CmpData`: 267 campaign files.
- `Trading/Cards`: 154 card files.

Files are JSON despite `.md` extension.

## Observed Credential/Identity Fields

`Config/Users.md` contains fields indicating two WB access contours:

- WB seller account/session contour:
  `Phone`, `WBTokenV3`, `WbxRefresh`, `WbxId`, `XSupplierId`, `XUserId`,
  `CurrentSupplierId`, `WbUsers`, `WbSellers`, `Suppliers`.
- WB advertising API/key contour:
  `AdvertKey`.
- License/app state contour:
  `Lic`, `Valid`, `AppVer`, `BuildVer`, `ApiState`.

Interpretation: Bider does not rely only on official WB API keys. It also keeps
WB seller web-session credentials created by phone/SMS login and uses supplier
identity from the seller cabinet.

## Observed Network Hosts

While the app was open, `Bider.exe` had HTTPS connections and DNS cache entries
for these WB hosts:

- `seller-auth.wildberries.ru`
- `seller.wildberries.ru`
- `seller-analytics-api.wildberries.ru`
- `advert-api.wildberries.ru`
- `seller-content.wildberries.ru`
- `cmp.wildberries.ru`

It also referenced `bider.ru` and had one additional HTTPS connection that is
likely app/backend/license/update related.

Interpretation:

- `seller-auth` / `seller` are used for phone-based WB LK authorization and
  supplier/session context.
- `advert-api` is used for advertising campaign metadata, stats, bids, budgets
  and campaign operations.
- `seller-analytics-api` and `seller-content` are used for cards, prices,
  stock/analytics/catalog data.
- `cmp.wildberries.ru` is likely used for search/catalog visibility, positions
  and marketplace-facing card/search data.
- Bider backend is likely used for license, update and/or prepared cluster
  dictionaries (`InitClusters.zip`, `WbClusters.md`).

## Observed Cached Data Shapes

`Trading/CardsMeta.md` keys include:

- `Cards`, `Id`, `ImtId`, `SubjectId`, `SuppId`, `VendorCode`
- `BasicPriceU`, `PriceU`, `SalePriceU`, `Spp`, `SppU`, `BasicSale`
- `CabStock`, `TotalQty`, `PromoId`, `UpdPrices`

`Trading/CmpMeta.md` keys include:

- `Cmps`, `Id`, `Name`, `Status`, `AdvType`, `BidType`, `PayModel`
- `Budget`, `MinBudget`, `MinCPM`, `MinCPMAuto`
- `CreateTime`, `ChangeDate`, `SubjId`, `SubjName`, `SuppId`
- update markers: `UpdBudget`, `UpdFullStat`, `UpdFullStatN`,
  `UpdFullStatX`, `UpdPlaceN`, `KwpSU`, `PsU`, `FsU`, `SpamU`

`Trading/CmpData/Cmp_<advertId>.md` keys include:

- `Bid`, `Bid2`, `Target`
- `Nm`, `NmDays`, `NmKwP`, `NmPm`
- `Ps`, `PsV`
- `VerFullStat`, `VerFullStatX`

`Trading/Cards/Card_<nmId>.md` keys include:

- card info: `Name`, `Brand`, `SubjectId`, `VendorCode`-like metadata
- commercial state: `price`, `basic`, `SppU`, `stocks`, `qty`
- market visibility: `rank`, `KwPos`, `kw`, `kv`, `Tags`
- social/card quality: `Feedbacks`, `ReviewRating`, `Grade`
- update markers: `LastModified`, `UpdateAt`, `UpdCardInfo`, `UpdDetails`

## Practical Conclusion

Bider is a local-first cache around several data sources:

1. WB API token/key for official advertising and seller APIs.
2. WB LK phone/SMS session for cabinet-only data and supplier context.
3. WB public/marketplace search/catalog endpoints for visibility and ranking.
4. Local JSON cache split by campaign/card for fast UI.
5. Bider backend/static bundle for license/update and probably cluster
   dictionaries.

We should not copy Bider internals or private endpoints. The right equivalent
in Procifry is to implement the same source architecture with our own schemas,
official WB APIs where possible, and user-authorized WB LK browser session where
official API coverage is missing.

## Current Procifry Coverage

Already present:

- Official WB API client in `src/lib/wb-api/index.ts`.
- Advertising API coverage: campaign discovery/details, fullstats, bids,
  min bids, normquery stats, pause/start.
- WB LK phone/SMS flow:
  `src/lib/wb-rpa/wb-lk-interactive-login.ts`.
- Encrypted WB LK storage state:
  `src/lib/wb-rpa/storage-state.ts`.
- Research/capture script:
  `scripts/inspect-wb-api.ts`.
- Existing WB LK research:
  `docs/research/wb-api-redistribution.md`.

Gap:

- WB LK/session contour is mostly used for redistribution/stock operations.
  It is not yet a first-class data source for the advertising terminal,
  campaign/card cache and search visibility terminal.

## Recommended Implementation

P109 · Source Health and Auth Unification:

- Settings should clearly show two required WB contours:
  WB API token and WB LK phone session.
- Add source health per tenant:
  `api_token_ok`, `lk_session_ok`, `advertising_ok`, `content_ok`,
  `search_visibility_ok`, last successful sync times.
- Do not expose or log WB tokens/cookies.

P110 · LK-backed Read Client:

- Add a read-only WB LK browser-context client using saved encrypted
  `storageState`.
- Prefer official APIs first; use LK session only for data not available or not
  reliable through official APIs.
- Avoid direct anti-bot bypass work. Use a real user-authorized browser context
  and low-rate scheduled fetches.

P111 · Bider-style Local Cache Model:

- Normalize cached layers into our DB:
  `advertising_campaign_snapshot`, `advertising_campaign_daily`,
  `advertising_campaign_position`, `advertising_card_snapshot`,
  `wb_search_visibility_snapshot`.
- Keep source markers and update timestamps per layer.

P112 · Terminal Integration:

- Campaign terminal should use campaign snapshot + daily stats + bid/budget
  state, not auto-strategies.
- Product terminal should join cards, prices, stocks, SPP, visibility, reviews
  and ad metrics in one dense table.
- Search visibility terminal should use query/keyword position history and
  card rank data.

Fastest next slice:

1. Add source-health panel in Settings.
2. Wire existing WB LK session status into advertising terminal readiness.
3. Add a background capture/sync job for campaign/card snapshot metadata.
4. Extend terminal campaign rows with status, budget, bid type and pay model
   from snapshot metadata.
