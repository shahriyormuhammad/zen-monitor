# WB supply-manager API (reverse-engineered from a real creation flow)

Decoded from a HAR of one full «Новая поставка» flow (2026-05-30). All calls are
**JSON-RPC 2.0 over POST** to `https://seller-supply.wildberries.ru`, body shape
`{"params":{…},"jsonrpc":"2.0","id":"…"}`, response `{"result":{…}}` (or
`{"error":{…}}`).

## Auth
Beyond the `.wildberries.ru` session cookies, every call needs three
SPA-injected request headers:
- `authorizev3` — long JWT (~727 chars)
- `wb-seller-lk` — JWT, **≈5-min TTL** (capture fresh, replay immediately)
- `root-version` — SPA build tag, e.g. `v1.95.0`

A plain `fetch` does **not** add these (the SPA's axios interceptor does). Our
automation captures them live from a real SPA request (`page.on('request')`),
then replays via in-page `fetch` so the call is genuine-browser-originated
(identical TLS/headers → passes antibot + CORS exactly like the SPA).

## Flow (in order)

| # | Endpoint (`/ns/…`) | params | returns |
|---|---|---|---|
| A1 | `sm-draft/…/api/v1/draft/create` | `{}` | `{draftID}` |
| A2 | `sm-draft/…/api/v1/draft/UpdateDraftGoods` | `{draftID, barcodes:[{barcode,quantity}]}` | `{}` |
| A3 | `sm-draft/…/api/v1/draft/listDraftGoods` | `{draftID,limit,offset,filter:{orderBy:{barcode:1},search:""}}` | `{goods[],total,quantity}` |
| B1 | `sm/…/api/v1/plan/validateWarehouseGoodsV2` | `{draftID,warehouseId,transitWarehouseId:null}` | `{items[{barcode,hasError,errors}]}` |
| B2 | `sm-supply/…/api/v1/supply/create` | `{boxTypeID,draftID,warehouseId,transitWarehouseId:null,isBoxOnPallet,isContainer}` | `{ids:[{Id,boxTypeId}]}` ← **preorderID**, status «Не запланировано», 0 ₽ |
| **C** | `sm/…/api/v1/plan/add` | `{preOrderId,deliveryDate}` | `{id:{supplyId,…}}` — **books the date** |
| D1 | `sm-box/…/api/v1/box/createBoxBarcodes` | `{supplyId,barcodeNumber}` | `{barcodes:["WB_…"]}` |
| D2 | `sm-box/…/api/v1/box/bindBarcodes` | `{incomeID,bind:[{boxcode,barcodes:[{barcode,quantity,expirationDate:null}],quantity}]}` | `{boxes}` |

Reads for the UI: `warehouse/getWarehouseFilterItems` (`{items:[{warehouseID,warehouseName}]}`),
`recommendations/getRecommendationsForWarehouses` (`{draftId,useNewRecommendations:true}` →
warehouses with `boxType.acceptanceCoefficients[{date,coefficient}]`, `logisticCoefficient`),
`supply/getAcceptanceCosts`, `plan/transitTariffsV2`, `supply/supplyDetails`, `supply/listSupplies`.

`boxTypeID`: 2 = Короб, 5 = Монопаллета, 6 = Суперсейф.

## ⚠️ Captcha / safety boundary

Step **C `plan/add`** (booking the delivery date — the financial commit) is the
**only** call that carries `x-wb-captcha-token` / `x-wb-captcha-latency`. Steps
A, B and D are captcha-free.

`src/lib/wb-rpa/wb-supply-create.ts` automates **A** (+ optionally **B**) and
**stops before C**: it auto-fills goods (the tedious part) and hands back a deep
link so the human picks the date/slot and confirms in the WB cabinet. This
respects "creating a supply is a financial action" and matches WB's own gate.
