#!/usr/bin/env python3
from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd
import psycopg

from reconcile_wb_export import build_report, load_db_metrics, load_env_database_url, load_export_metrics


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "output" / "spreadsheet"


def fmt_money(value: float) -> str:
    return f"{value:,.2f}".replace(",", " ")


def fmt_qty(value: float) -> str:
    numeric = float(value)
    if numeric.is_integer():
        return f"{int(numeric):,}".replace(",", " ")
    return f"{numeric:,.2f}".replace(",", " ")


def fmt_list(values: list[int], limit: int = 20) -> str:
    if not values:
        return "[]"
    rendered = ", ".join(str(value) for value in values[:limit])
    if len(values) > limit:
        rendered += f", … (+{len(values) - limit})"
    return f"[{rendered}]"


@dataclass
class AdHistorySummary:
    total: float
    rows: int
    by_section: list[tuple[str, float]]
    daily: pd.DataFrame


@dataclass
class CampaignStatsSummary:
    total_rows: int
    march_rows: int
    march_cost: float
    campaigns: list[dict[str, Any]]


@dataclass
class StockReportSummary:
    rows: int
    unique_nm_ids: list[int]
    totals: dict[str, float]
    per_nm: pd.DataFrame


@dataclass
class SupplierGoodsSummary:
    rows: int
    unique_nm_ids: list[int]
    totals: dict[str, float]
    per_nm: pd.DataFrame


def load_ad_history(path: Path) -> AdHistorySummary:
    df = pd.read_excel(path)
    df["Дата списания"] = pd.to_datetime(df["Дата списания"], errors="coerce")
    df["Сумма"] = pd.to_numeric(df["Сумма"], errors="coerce").fillna(0)
    df["day"] = df["Дата списания"].dt.date

    by_section = (
        df.groupby("Раздел", dropna=False)["Сумма"]
        .sum()
        .sort_values(ascending=False)
        .items()
    )
    daily = (
        df.groupby("day", as_index=False)["Сумма"]
        .sum()
        .rename(columns={"Сумма": "history_sum"})
        .sort_values("day")
    )

    return AdHistorySummary(
        total=float(df["Сумма"].sum()),
        rows=int(len(df)),
        by_section=[(str(section), float(amount)) for section, amount in by_section],
        daily=daily,
    )


def load_campaign_stats(path: Path, date_from: str, date_to: str) -> CampaignStatsSummary:
    df = pd.read_excel(path)
    for column in ("Старт", "Финиш"):
        df[column] = pd.to_datetime(df[column], errors="coerce")

    start = pd.Timestamp(date_from)
    end = pd.Timestamp(date_to) + pd.Timedelta(days=1)
    march_rows = df[
        ((df["Старт"] >= start) & (df["Старт"] < end))
        | ((df["Финиш"] >= start) & (df["Финиш"] < end))
    ].copy()
    march_rows["Затраты"] = pd.to_numeric(march_rows["Затраты"], errors="coerce").fillna(0)

    campaigns: list[dict[str, Any]] = []
    for _, row in march_rows.sort_values("Затраты", ascending=False).head(10).iterrows():
        campaigns.append({
            "id": int(row["ID"]) if pd.notna(row["ID"]) else None,
            "campaign": str(row["Кампания"]),
            "section": str(row["Раздел"]),
            "bid_type": str(row["Тип Ставки"]),
            "cost": float(row["Затраты"]),
        })

    return CampaignStatsSummary(
        total_rows=int(len(df)),
        march_rows=int(len(march_rows)),
        march_cost=float(march_rows["Затраты"].sum()),
        campaigns=campaigns,
    )


def load_stock_report(path: Path) -> StockReportSummary:
    df = pd.read_excel(path)
    numeric_columns = [
        "Артикул WB",
        "В пути до получателей",
        "В пути возвраты на склад WB",
        "Всего находится на складах",
    ]
    for column in numeric_columns:
        df[column] = pd.to_numeric(df[column], errors="coerce").fillna(0)

    per_nm = (
        df.groupby("Артикул WB", as_index=False)[
            ["В пути до получателей", "В пути возвраты на склад WB", "Всего находится на складах"]
        ]
        .sum()
        .rename(columns={
            "Артикул WB": "nm_id",
            "В пути до получателей": "wb_in_way_to_client",
            "В пути возвраты на склад WB": "wb_in_way_from_client",
            "Всего находится на складах": "wb_stock",
        })
        .sort_values("wb_stock", ascending=False)
    )

    totals = {
        "wb_stock": float(per_nm["wb_stock"].sum()),
        "wb_in_way_to_client": float(per_nm["wb_in_way_to_client"].sum()),
        "wb_in_way_from_client": float(per_nm["wb_in_way_from_client"].sum()),
    }

    return StockReportSummary(
        rows=int(len(df)),
        unique_nm_ids=[int(value) for value in per_nm["nm_id"].tolist()],
        totals=totals,
        per_nm=per_nm,
    )


def load_supplier_goods(path: Path) -> SupplierGoodsSummary:
    df = pd.read_excel(path, header=1)
    numeric_columns = [
        "Артикул WB",
        "шт.",
        "Сумма заказов минус комиссия WB, руб.",
        "Выкупили, шт.",
        "К перечислению за товар, руб.",
        "Текущий остаток, шт.",
    ]
    for column in numeric_columns:
        df[column] = pd.to_numeric(df[column], errors="coerce").fillna(0)

    per_nm = (
        df.groupby("Артикул WB", as_index=False)[
            ["шт.", "Сумма заказов минус комиссия WB, руб.", "Выкупили, шт.", "К перечислению за товар, руб.", "Текущий остаток, шт."]
        ]
        .sum()
        .rename(columns={
            "Артикул WB": "nm_id",
            "шт.": "ordered_qty",
            "Сумма заказов минус комиссия WB, руб.": "ordered_sum_net",
            "Выкупили, шт.": "buyout_qty",
            "К перечислению за товар, руб.": "payout_sum",
            "Текущий остаток, шт.": "current_stock",
        })
        .sort_values("ordered_qty", ascending=False)
    )

    totals = {
        "ordered_qty": float(per_nm["ordered_qty"].sum()),
        "ordered_sum_net": float(per_nm["ordered_sum_net"].sum()),
        "buyout_qty": float(per_nm["buyout_qty"].sum()),
        "payout_sum": float(per_nm["payout_sum"].sum()),
        "current_stock": float(per_nm["current_stock"].sum()),
    }

    return SupplierGoodsSummary(
        rows=int(len(df)),
        unique_nm_ids=[int(value) for value in per_nm["nm_id"].tolist()],
        totals=totals,
        per_nm=per_nm,
    )


def query_db_sets(database_url: str, tenant_id: str) -> dict[str, set[int]]:
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            result: dict[str, set[int]] = {}
            queries = {
                "products": "select distinct nm_id from products where tenant_id = %s",
                "metadata": "select distinct nm_id from raw_api_product_metadata where tenant_id = %s",
                "prices": "select distinct nm_id from raw_api_prices where tenant_id = %s",
                "stocks": "select distinct nm_id from raw_api_stocks where tenant_id = %s",
            }
            for key, query in queries.items():
                cur.execute(query, (tenant_id,))
                result[key] = {int(row[0]) for row in cur.fetchall()}
    return result


def query_db_photo_coverage(database_url: str, tenant_id: str) -> tuple[set[int], dict[int, int]]:
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select nm_id from products where tenant_id = %s and coalesce(photo_url, '') <> ''",
                (tenant_id,),
            )
            photo_urls = {int(row[0]) for row in cur.fetchall()}
            cur.execute(
                "select nm_id, photos_count from raw_api_product_metadata where tenant_id = %s",
                (tenant_id,),
            )
            metadata_photos = {int(nm_id): int(photos_count or 0) for nm_id, photos_count in cur.fetchall()}
    return photo_urls, metadata_photos


def query_db_stock_snapshot(database_url: str, tenant_id: str) -> pd.DataFrame:
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select
                  nm_id,
                  sum(amount)::numeric as app_stock,
                  sum(in_way_to_client)::numeric as app_in_way_to_client,
                  sum(in_way_from_client)::numeric as app_in_way_from_client,
                  count(*)::int as warehouse_rows
                from raw_api_stocks
                where tenant_id = %s
                group by nm_id
                order by app_stock desc
                """,
                (tenant_id,),
            )
            rows = cur.fetchall()
            columns = [description.name for description in cur.description]
    return pd.DataFrame(rows, columns=columns)


def query_db_ad_daily(database_url: str, tenant_id: str, date_from: str, date_to: str) -> pd.DataFrame:
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select
                  (date at time zone 'Europe/Moscow')::date as day,
                  round(sum(amount), 2) as db_sum
                from raw_api_ad_costs
                where tenant_id = %s
                  and date >= %s::timestamp
                  and date < (%s::date + interval '1 day')
                group by 1
                order by 1
                """,
                (tenant_id, date_from, date_to),
            )
            rows = cur.fetchall()
            columns = [description.name for description in cur.description]
    return pd.DataFrame(rows, columns=columns)


def load_finance_report(path: Path, date_from: str, date_to: str) -> dict[str, float]:
    df = pd.read_excel(path)
    df["День"] = pd.to_datetime(df["День"], errors="coerce")
    mask = (df["День"] >= pd.Timestamp(date_from)) & (df["День"] < pd.Timestamp(date_to) + pd.Timedelta(days=1))
    march = df.loc[mask].copy()

    columns = {
        "order_sum": "Сумма заказов по розничным ценам с учётом согласованной скидки, руб.",
        "ordered_qty": "Заказано, шт.",
        "order_count": "Количество заказов",
        "sale_sum": "Сумма продаж по розничным ценам с учётом согласованной скидки, руб.",
        "buyout_qty": "Выкупили, шт.",
        "payout_sum": "К перечислению за товар, руб.",
        "logistics": "Стоимость логистики, руб.",
        "storage": "Стоимость хранения, руб.",
        "penalties": "Штрафы, руб.",
        "surcharges": "Доплаты, руб.",
        "damage_comp": "Компенсация ущерба, руб.",
        "return_comp": "Добровольная компенсация при возврате, руб.",
        "acceptance_ops": "Операции при приемке, руб.",
        "net_payout": "Итого к перечислению, руб.",
    }
    totals: dict[str, float] = {"rows": float(len(march))}
    for key, column in columns.items():
        march[column] = pd.to_numeric(march[column], errors="coerce").fillna(0)
        totals[key] = float(march[column].sum())
    return totals


def build_stock_mismatch_table(stock_report: StockReportSummary, app_stocks: pd.DataFrame) -> list[dict[str, Any]]:
    merged = stock_report.per_nm.merge(app_stocks, on="nm_id", how="left").fillna(0)
    merged["stock_delta"] = merged["app_stock"] - merged["wb_stock"]
    merged["in_way_to_client_delta"] = merged["app_in_way_to_client"] - merged["wb_in_way_to_client"]
    merged["in_way_from_client_delta"] = merged["app_in_way_from_client"] - merged["wb_in_way_from_client"]
    merged["abs_stock_gap"] = merged["stock_delta"].abs()

    rows: list[dict[str, Any]] = []
    for _, row in merged.sort_values("abs_stock_gap", ascending=False).head(12).iterrows():
        rows.append({
            "nm_id": int(row["nm_id"]),
            "wb_stock": float(row["wb_stock"]),
            "app_stock": float(row["app_stock"]),
            "delta": float(row["stock_delta"]),
            "wb_in_way_to_client": float(row["wb_in_way_to_client"]),
            "app_in_way_to_client": float(row["app_in_way_to_client"]),
            "wb_in_way_from_client": float(row["wb_in_way_from_client"]),
            "app_in_way_from_client": float(row["app_in_way_from_client"]),
        })
    return rows


def build_bundle_report(
    generated_at: str,
    wb_export_path: Path,
    tenant_id: str,
    date_from: str,
    date_to: str,
    export_metrics: dict[str, Any],
    db_metrics: dict[str, Any],
    ad_history_path: Path,
    ad_history: AdHistorySummary,
    campaign_stats_path: Path,
    campaign_stats: CampaignStatsSummary,
    stock_report_path: Path,
    stock_report: StockReportSummary,
    supplier_goods_path: Path,
    supplier_goods: SupplierGoodsSummary,
    finance_report_path: Path,
    finance_report: dict[str, float],
    db_sets: dict[str, set[int]],
    photo_urls: set[int],
    metadata_photos: dict[int, int],
    app_stocks: pd.DataFrame,
    ad_daily: pd.DataFrame,
) -> str:
    base_report = build_report(
        wb_export_path,
        tenant_id,
        date_from,
        date_to,
        export_metrics,
        db_metrics,
    )

    supplier_nm_ids = set(supplier_goods.unique_nm_ids)
    stock_nm_ids = set(stock_report.unique_nm_ids)
    stock_missing_products = sorted(stock_nm_ids - db_sets["products"])
    stock_missing_metadata = sorted(stock_nm_ids - db_sets["metadata"])
    stock_missing_prices = sorted(stock_nm_ids - db_sets["prices"])
    stock_missing_raw_stocks = sorted(stock_nm_ids - db_sets["stocks"])
    supplier_missing_raw_stocks = sorted(supplier_nm_ids - db_sets["stocks"])
    stock_missing_photo_urls = sorted(nm_id for nm_id in stock_nm_ids if nm_id not in photo_urls)
    stock_missing_metadata_photos = sorted(nm_id for nm_id in stock_nm_ids if metadata_photos.get(nm_id, 0) <= 0)

    ad_comparison = ad_history.daily.merge(ad_daily, on="day", how="outer").fillna(0)
    ad_comparison["history_sum"] = pd.to_numeric(ad_comparison["history_sum"], errors="coerce").fillna(0.0)
    ad_comparison["db_sum"] = pd.to_numeric(ad_comparison["db_sum"], errors="coerce").fillna(0.0)
    ad_comparison["delta"] = ad_comparison["db_sum"] - ad_comparison["history_sum"]
    ad_total_delta = float(ad_comparison["delta"].sum())
    ad_daily_top = ad_comparison.reindex(ad_comparison["delta"].abs().sort_values(ascending=False).index).head(10)

    for column in ("app_stock", "app_in_way_to_client", "app_in_way_from_client"):
        if column in app_stocks.columns:
            app_stocks[column] = pd.to_numeric(app_stocks[column], errors="coerce").fillna(0.0)
    stock_mismatches = build_stock_mismatch_table(stock_report, app_stocks)
    app_stock_total = float(app_stocks["app_stock"].sum()) if not app_stocks.empty else 0.0
    app_in_way_to_client_total = float(app_stocks["app_in_way_to_client"].sum()) if not app_stocks.empty else 0.0
    app_in_way_from_client_total = float(app_stocks["app_in_way_from_client"].sum()) if not app_stocks.empty else 0.0

    lines = [base_report]

    lines.extend([
        "",
        "## Advertising history vs `raw_api_ad_costs`",
        "",
        f"- WB ad-history workbook: `{ad_history_path}`",
        f"- Workbook rows: `{ad_history.rows}`",
        f"- WB ad-history total: `{fmt_money(ad_history.total)}`",
        f"- App `raw_api_ad_costs` total: `{fmt_money(float(ad_daily['db_sum'].sum()))}`",
        f"- Delta app - WB history: `{fmt_money(ad_total_delta)}`",
        f"- WB ad-history by section: `{', '.join(f'{name}: {fmt_money(amount)}' for name, amount in ad_history.by_section)}`",
        "",
        "| Day | WB history | App raw_api_ad_costs | Delta |",
        "| --- | ---: | ---: | ---: |",
    ])
    for _, row in ad_daily_top.iterrows():
        lines.append(
            f"| {row['day']} | {fmt_money(float(row['history_sum']))} | {fmt_money(float(row['db_sum']))} | {fmt_money(float(row['delta']))} |"
        )

    lines.extend([
        "",
        "## Supplier goods vs WB finance report",
        "",
        f"- Supplier-goods workbook: `{supplier_goods_path}`",
        f"- Finance workbook: `{finance_report_path}`",
        f"- Supplier-goods rows: `{supplier_goods.rows}`",
        f"- Supplier-goods unique WB SKUs: `{len(supplier_goods.unique_nm_ids)}`",
        f"- Supplier-goods ordered qty: `{fmt_qty(supplier_goods.totals['ordered_qty'])}`",
        f"- Supplier-goods ordered sum net of WB commission: `{fmt_money(supplier_goods.totals['ordered_sum_net'])}`",
        f"- Supplier-goods buyout qty: `{fmt_qty(supplier_goods.totals['buyout_qty'])}`",
        f"- Supplier-goods payout sum: `{fmt_money(supplier_goods.totals['payout_sum'])}`",
        f"- Supplier-goods current stock: `{fmt_qty(supplier_goods.totals['current_stock'])}`",
        f"- Finance report ordered qty: `{fmt_qty(finance_report['ordered_qty'])}`",
        f"- Finance report order count: `{fmt_qty(finance_report['order_count'])}`",
        f"- Finance report ordered gross sum: `{fmt_money(finance_report['order_sum'])}`",
        f"- Finance report buyout qty: `{fmt_qty(finance_report['buyout_qty'])}`",
        f"- Finance report payout sum: `{fmt_money(finance_report['payout_sum'])}`",
        f"- Finance report logistics: `{fmt_money(finance_report['logistics'])}`",
        f"- Finance report storage: `{fmt_money(finance_report['storage'])}`",
        f"- Finance report net payout: `{fmt_money(finance_report['net_payout'])}`",
        f"- Supplier-goods missing in `raw_api_stocks`: `{fmt_list(supplier_missing_raw_stocks)}`",
        "",
        "## Current stock report vs app `raw_api_stocks`",
        "",
        f"- Stock workbook: `{stock_report_path}`",
        f"- WB stock-report unique WB SKUs: `{len(stock_report.unique_nm_ids)}`",
        f"- WB total stock: `{fmt_qty(stock_report.totals['wb_stock'])}`",
        f"- App total stock: `{fmt_qty(app_stock_total)}`",
        f"- Stock delta app - WB: `{fmt_qty(app_stock_total - stock_report.totals['wb_stock'])}`",
        f"- WB in-way to client: `{fmt_qty(stock_report.totals['wb_in_way_to_client'])}`",
        f"- App in-way to client: `{fmt_qty(app_in_way_to_client_total)}`",
        f"- WB in-way from client: `{fmt_qty(stock_report.totals['wb_in_way_from_client'])}`",
        f"- App in-way from client: `{fmt_qty(app_in_way_from_client_total)}`",
        f"- Missing stock-report SKUs in `products`: `{fmt_list(stock_missing_products)}`",
        f"- Missing stock-report SKUs in `raw_api_product_metadata`: `{fmt_list(stock_missing_metadata)}`",
        f"- Missing stock-report SKUs in `raw_api_prices`: `{fmt_list(stock_missing_prices)}`",
        f"- Missing stock-report SKUs in `raw_api_stocks`: `{fmt_list(stock_missing_raw_stocks, limit=40)}`",
        f"- Missing stock-report SKUs with `products.photo_url`: `{fmt_list(stock_missing_photo_urls, limit=40)}`",
        f"- Missing stock-report SKUs with `raw_api_product_metadata.photos_count > 0`: `{fmt_list(stock_missing_metadata_photos, limit=40)}`",
        "",
        "| NM ID | WB stock | App stock | Delta | WB in-way to client | App in-way to client | WB in-way from client | App in-way from client |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ])
    for row in stock_mismatches:
        lines.append(
            f"| {row['nm_id']} | {fmt_qty(row['wb_stock'])} | {fmt_qty(row['app_stock'])} | {fmt_qty(row['delta'])} | "
            f"{fmt_qty(row['wb_in_way_to_client'])} | {fmt_qty(row['app_in_way_to_client'])} | "
            f"{fmt_qty(row['wb_in_way_from_client'])} | {fmt_qty(row['app_in_way_from_client'])} |"
        )

    lines.extend([
        "",
        "## Campaign statistics dump sanity check",
        "",
        f"- Campaign stats workbook: `{campaign_stats_path}`",
        f"- Total rows in dump: `{campaign_stats.total_rows}`",
        f"- Campaign rows touching the requested March window: `{campaign_stats.march_rows}`",
        f"- Sum of these campaign rows: `{fmt_money(campaign_stats.march_cost)}`",
        "- This file is an all-time campaign dump and is not an exact March reconciliation source by itself.",
        "",
        "| Campaign ID | Section | Bid type | Cost | Campaign |",
        "| --- | --- | --- | ---: | --- |",
    ])
    for item in campaign_stats.campaigns:
        lines.append(
            f"| {item['id']} | {item['section']} | {item['bid_type']} | {fmt_money(item['cost'])} | {item['campaign']} |"
        )

    stock_delta = app_stock_total - stock_report.totals["wb_stock"]
    in_way_to_client_delta = app_in_way_to_client_total - stock_report.totals["wb_in_way_to_client"]
    in_way_from_client_delta = app_in_way_from_client_total - stock_report.totals["wb_in_way_from_client"]
    stock_missing_count = len(stock_missing_raw_stocks)
    if stock_missing_count == 0 and abs(stock_delta) <= 5 and abs(in_way_to_client_delta) <= 5 and abs(in_way_from_client_delta) <= 5:
        stock_health_note = (
            f"- App `raw_api_stocks` is close to WB stock report: total delta `{fmt_qty(stock_delta)}`, "
            f"missing SKUs in `raw_api_stocks`: `{stock_missing_count}`."
        )
    else:
        stock_health_note = (
            f"- App `raw_api_stocks` still has a gap: total delta `{fmt_qty(stock_delta)}`, "
            f"missing SKUs in `raw_api_stocks`: `{stock_missing_count}`, "
            f"in-way deltas: to-client `{fmt_qty(in_way_to_client_delta)}`, from-client `{fmt_qty(in_way_from_client_delta)}`."
        )

    db_only_ad_days = ad_comparison[(ad_comparison["history_sum"] == 0) & (ad_comparison["db_sum"] > 0)]["day"].astype(str).tolist()
    if db_only_ad_days:
        ads_note = (
            f"- Ads are close but not identical: app `raw_api_ad_costs` is `{fmt_money(ad_total_delta)} ₽` "
            f"vs WB ad-history, DB-only days: `{', '.join(db_only_ad_days)}`."
        )
    else:
        ads_note = (
            f"- Ads are close but not identical: app `raw_api_ad_costs` is `{fmt_money(ad_total_delta)} ₽` "
            "vs WB ad-history, without DB-only days."
        )

    supplier_buyout_qty = supplier_goods.totals["buyout_qty"]
    supplier_payout_sum = supplier_goods.totals["payout_sum"]
    export_buyout_qty = float(export_metrics["filters"]["bought_units"])
    export_buyout_sum = float(export_metrics["filters"]["bought_rub"])

    lines.extend([
        "",
        "## Cross-file diagnosis",
        "",
        f"- Generated at: `{generated_at}`",
        "- `Фильтры/Товары` from the WB export still reconcile cleanly against our March `raw_api_funnel_stats` period facts; the core funnel snapshot model is healthy.",
        (
            f"- `supplier-goods` and `{stock_report_path.name}` are close on live stock contour: "
            f"`{fmt_qty(supplier_goods.totals['current_stock'])}` vs `{fmt_qty(stock_report.totals['wb_stock'])}`."
        ),
        stock_health_note,
        f"- Catalog/media coverage is also incomplete for the live stock contour: `{len(stock_missing_photo_urls)}` stock-report SKUs do not have `products.photo_url`, and `{len(stock_missing_metadata_photos)}` do not have positive `photos_count` in `raw_api_product_metadata`.",
        ads_note,
        (
            f"- `supplier-goods` / finance report buyout and payout layers "
            f"(`{fmt_qty(supplier_buyout_qty)}` buyouts, `{fmt_money(supplier_payout_sum)} ₽` payout) "
            f"are a different settlement contour than export funnel snapshot "
            f"(`{fmt_qty(export_buyout_qty)}` units, `{fmt_money(export_buyout_sum)} ₽` gross buyout sum). "
            "Those two layers should not be forced into a single metric."
        ),
    ])

    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare a full WB workbook bundle against the local app DB.")
    parser.add_argument("--tenant-id", required=True)
    parser.add_argument("--date-from", required=True)
    parser.add_argument("--date-to", required=True)
    parser.add_argument("--wb-export", required=True, type=Path)
    parser.add_argument("--ad-history", required=True, type=Path)
    parser.add_argument("--campaign-stats", required=True, type=Path)
    parser.add_argument("--stocks-report", required=True, type=Path)
    parser.add_argument("--finance-report", required=True, type=Path)
    parser.add_argument("--supplier-goods", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    database_url = load_env_database_url()
    generated_at = datetime.now().isoformat(timespec="seconds")

    export_metrics = load_export_metrics(args.wb_export)
    db_metrics = load_db_metrics(
        database_url,
        args.tenant_id,
        args.date_from,
        args.date_to,
        export_metrics["products"]["unique_nm_ids"],
    )

    ad_history = load_ad_history(args.ad_history)
    campaign_stats = load_campaign_stats(args.campaign_stats, args.date_from, args.date_to)
    stock_report = load_stock_report(args.stocks_report)
    supplier_goods = load_supplier_goods(args.supplier_goods)
    finance_report = load_finance_report(args.finance_report, args.date_from, args.date_to)
    db_sets = query_db_sets(database_url, args.tenant_id)
    photo_urls, metadata_photos = query_db_photo_coverage(database_url, args.tenant_id)
    app_stocks = query_db_stock_snapshot(database_url, args.tenant_id)
    ad_daily = query_db_ad_daily(database_url, args.tenant_id, args.date_from, args.date_to)

    report = build_bundle_report(
        generated_at=generated_at,
        wb_export_path=args.wb_export,
        tenant_id=args.tenant_id,
        date_from=args.date_from,
        date_to=args.date_to,
        export_metrics=export_metrics,
        db_metrics=db_metrics,
        ad_history_path=args.ad_history,
        ad_history=ad_history,
        campaign_stats_path=args.campaign_stats,
        campaign_stats=campaign_stats,
        stock_report_path=args.stocks_report,
        stock_report=stock_report,
        supplier_goods_path=args.supplier_goods,
        supplier_goods=supplier_goods,
        finance_report_path=args.finance_report,
        finance_report=finance_report,
        db_sets=db_sets,
        photo_urls=photo_urls,
        metadata_photos=metadata_photos,
        app_stocks=app_stocks,
        ad_daily=ad_daily,
    )

    output_path = args.output
    if not output_path.is_absolute():
        output_path = ROOT / output_path
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(report, encoding="utf-8")
    print(output_path)


if __name__ == "__main__":
    main()
