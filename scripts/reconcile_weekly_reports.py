#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import pandas as pd
import psycopg


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "output" / "spreadsheet"


def load_env_database_url() -> str:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]

    env_path = ROOT / ".env"
    if not env_path.exists():
        raise RuntimeError("DATABASE_URL is not set and .env is missing")

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == "DATABASE_URL":
            return value.strip().strip('"').strip("'")

    raise RuntimeError("DATABASE_URL is not set and was not found in .env")


def fmt_money(value: float) -> str:
    return f"{value:,.2f}".replace(",", " ")


def fmt_qty(value: float) -> str:
    numeric = float(value)
    if numeric.is_integer():
        return f"{int(numeric):,}".replace(",", " ")
    return f"{numeric:,.2f}".replace(",", " ")


def load_weekly_totals(weekly_dir: Path, date_from: str, date_to: str) -> dict[str, Any]:
    files_by_report: dict[str, Path] = {}
    for path in sorted(weekly_dir.rglob("*.xlsx")):
        match = re.search(r"№(\d+)_", path.name)
        report_id = match.group(1) if match else path.stem
        files_by_report.setdefault(report_id, path)

    frames: list[pd.DataFrame] = []
    for report_id, path in files_by_report.items():
        df = pd.read_excel(path)
        df["__report_id"] = report_id
        df["Дата продажи"] = pd.to_datetime(df.get("Дата продажи"), errors="coerce")
        frames.append(df)

    if not frames:
        raise RuntimeError(f"No weekly .xlsx files found in {weekly_dir}")

    weekly = pd.concat(frames, ignore_index=True)
    start = pd.Timestamp(date_from)
    end = pd.Timestamp(date_to)
    weekly = weekly[(weekly["Дата продажи"] >= start) & (weekly["Дата продажи"] <= end)].copy()

    numeric_columns = [
        "Кол-во",
        "Цена розничная с учетом согласованной скидки",
        "К перечислению Продавцу за реализованный Товар",
        "Услуги по доставке товара покупателю",
        "Хранение",
        "Удержания",
        "Компенсация платёжных услуг/Комиссия за интеграцию платёжных сервисов",
        "Общая сумма штрафов",
        "Вознаграждение Вайлдберриз (ВВ), без НДС",
        "НДС с Вознаграждения Вайлдберриз",
    ]
    for column in numeric_columns:
        weekly[column] = pd.to_numeric(weekly.get(column), errors="coerce").fillna(0.0)

    reason_counts = (
        weekly.get("Обоснование для оплаты")
        .fillna("NA")
        .astype(str)
        .value_counts()
        .head(12)
        .to_dict()
    )

    return {
        "reports": len(files_by_report),
        "rows": int(len(weekly)),
        "qty": float(weekly["Кол-во"].sum()),
        "retail_amount": float(weekly["Цена розничная с учетом согласованной скидки"].sum()),
        "ppvz_for_pay": float(weekly["К перечислению Продавцу за реализованный Товар"].sum()),
        "delivery_rub": float(weekly["Услуги по доставке товара покупателю"].sum()),
        "storage_fee_rub": float(weekly["Хранение"].sum()),
        "deduction": float(weekly["Удержания"].sum()),
        "acquiring_fee": float(weekly["Компенсация платёжных услуг/Комиссия за интеграцию платёжных сервисов"].sum()),
        "penalty_rub": float(weekly["Общая сумма штрафов"].sum()),
        "commission_amount": float((weekly["Вознаграждение Вайлдберриз (ВВ), без НДС"] + weekly["НДС с Вознаграждения Вайлдберриз"]).sum()),
        "top_reasons": reason_counts,
    }


def load_db_totals(database_url: str, tenant_id: str, date_from: str, date_to: str) -> dict[str, Any]:
    date_to_exclusive = (datetime.fromisoformat(date_to) + timedelta(days=1)).date().isoformat()
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select column_name
                from information_schema.columns
                where table_name = 'raw_api_realization_reports'
                """
            )
            available_columns = {row[0] for row in cur.fetchall()}

            def metric(column_name: str) -> str:
                return f"COALESCE(SUM({column_name}), 0)::numeric" if column_name in available_columns else "0::numeric"

            cur.execute(
                f"""
                select
                  count(*)::int as rows,
                  {metric('quantity')} as qty,
                  {metric('retail_amount')} as retail_amount,
                  {metric('ppvz_for_pay')} as ppvz_for_pay,
                  {metric('delivery_rub')} as delivery_rub,
                  {metric('storage_fee_rub')} as storage_fee_rub,
                  {metric('deduction')} as deduction,
                  {metric('acquiring_fee')} as acquiring_fee,
                  {metric('penalty_rub')} as penalty_rub,
                  {metric('commission_amount')} as commission_amount
                from raw_api_realization_reports
                where tenant_id = %s
                  and date_from >= %s::timestamp
                  and date_from < %s::timestamp
                """,
                (tenant_id, date_from, date_to_exclusive),
            )
            row = cur.fetchone()

    keys = [
        "rows",
        "qty",
        "retail_amount",
        "ppvz_for_pay",
        "delivery_rub",
        "storage_fee_rub",
        "deduction",
        "acquiring_fee",
        "penalty_rub",
        "commission_amount",
    ]
    values = dict(zip(keys, row))
    return {key: float(value) if key != "rows" else int(value) for key, value in values.items()}


def build_report(
    generated_at: str,
    tenant_id: str,
    date_from: str,
    date_to: str,
    weekly_dir: Path,
    weekly: dict[str, Any],
    db: dict[str, Any],
) -> str:
    compare_keys = [
        ("qty", "Количество (Кол-во)"),
        ("retail_amount", "Цена розничная с учетом скидки"),
        ("ppvz_for_pay", "К перечислению продавцу"),
        ("delivery_rub", "Логистика"),
        ("storage_fee_rub", "Хранение"),
        ("deduction", "Удержания"),
        ("acquiring_fee", "Эквайринг"),
        ("penalty_rub", "Штрафы"),
        ("commission_amount", "Комиссия WB"),
    ]

    lines = [
        "# Weekly Realization Reconciliation",
        "",
        f"- Generated at: `{generated_at}`",
        f"- Tenant ID: `{tenant_id}`",
        f"- Range: `{date_from}` -> `{date_to}`",
        f"- Weekly folder: `{weekly_dir}`",
        f"- Unique weekly reports used: `{weekly['reports']}`",
        f"- Weekly rows in range: `{weekly['rows']}`",
        f"- DB realization rows in range: `{db['rows']}`",
        "",
        "## Summary",
        "",
        f"- Weekly `К перечислению продавцу`: `{fmt_money(weekly['ppvz_for_pay'])}`",
        f"- DB `ppvz_for_pay`: `{fmt_money(db['ppvz_for_pay'])}`",
        f"- Delta: `{fmt_money(db['ppvz_for_pay'] - weekly['ppvz_for_pay'])}`",
        "",
        "## Metric deltas (weekly vs DB)",
        "",
        "| Metric | Weekly | DB | Delta DB-Weekly | Delta % |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]

    for key, label in compare_keys:
        weekly_value = float(weekly[key])
        db_value = float(db[key])
        delta = db_value - weekly_value
        delta_pct = (delta / weekly_value * 100) if weekly_value else 0.0
        lines.append(
            f"| {label} | {fmt_money(weekly_value)} | {fmt_money(db_value)} | {fmt_money(delta)} | {delta_pct:.2f}% |"
        )

    lines.extend([
        "",
        "## Weekly payment reasons (top)",
        "",
    ])
    for reason, count in weekly["top_reasons"].items():
        lines.append(f"- {reason}: `{count}`")

    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare WB weekly detailed reports against raw_api_realization_reports.")
    parser.add_argument("--tenant-id", required=True)
    parser.add_argument("--date-from", required=True)
    parser.add_argument("--date-to", required=True)
    parser.add_argument("--weekly-dir", required=True, type=Path)
    parser.add_argument("--output", required=False, type=Path)
    args = parser.parse_args()

    database_url = load_env_database_url()
    generated_at = datetime.now().isoformat(timespec="seconds")

    weekly = load_weekly_totals(args.weekly_dir, args.date_from, args.date_to)
    db = load_db_totals(database_url, args.tenant_id, args.date_from, args.date_to)

    report = build_report(
        generated_at=generated_at,
        tenant_id=args.tenant_id,
        date_from=args.date_from,
        date_to=args.date_to,
        weekly_dir=args.weekly_dir,
        weekly=weekly,
        db=db,
    )

    output_path = args.output or (OUTPUT_DIR / f"reconcile-weekly-{args.date_from}-to-{args.date_to}.md")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(report, encoding="utf-8")
    print(output_path)


if __name__ == "__main__":
    main()
