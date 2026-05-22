import { eq, sql } from "drizzle-orm";
import { unzipSync } from "fflate";

import { db, withTenantContext } from "@/lib/db";
import { ausnDocumentRows, tenants } from "@/lib/db/schema";
import { decryptIfNeeded } from "@/lib/encryption";
import { wbApi, type WbDocumentListItem } from "@/lib/wb-api";
import type { WbRealizationReportItem } from "@/types/wb";
import {
  AUSN_WB_DOCUMENT_TYPES,
  type AusnDocumentType,
  getAusnMonthlyReconciliation,
  normalizeAusnMonth,
} from "./ausn";

type ExtractedFile = {
  path: string;
  extension: string;
  bytes: Uint8Array;
};

type XlsxCell = {
  value: string;
  column: number;
};

type ParsedAusnDocumentRow = {
  documentType: AusnDocumentType;
  amount: number;
  title: string;
  documentDate: string | null;
  source: string;
};

type AusnSyncWarning = {
  code: string;
  message: string;
};

export type AusnWbDocumentSyncResult = {
  report: Awaited<ReturnType<typeof getAusnMonthlyReconciliation>>;
  sync: {
    month: string;
    documentsFound: number;
    documentsQueued: number;
    documentRowsSaved: number;
    detailRows: number;
    detailReports: number;
    warnings: AusnSyncWarning[];
  };
};

const AUSN_DOCUMENT_CATEGORIES = new Set([
  "redeem-notification",
  "weekly-implementation-report",
  "upd",
  "updreport",
  "ukd-purchase-from-legal",
  "ukd-sale-to-legal",
  "ukd-sale-to-le-signed",
]);

const CATEGORY_TO_DOCUMENT_TYPE: Partial<Record<string, AusnDocumentType>> = {
  "redeem-notification": "buyout_income",
  "weekly-implementation-report": "weekly_withholding",
  upd: "upd_expense",
  updreport: "upd_expense",
  "ukd-purchase-from-legal": "ukd_expense_return",
  "ukd-sale-to-legal": "ukd_expense_return",
  "ukd-sale-to-le-signed": "ukd_expense_return",
};

const ENTITY_RE: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function roundMoney(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseMoney(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value !== "string") return 0;

  const normalized = value
    .replace(/\u00a0/g, " ")
    .replace(/[^\d,.\-\s]/g, "")
    .replace(/\s+/g, "")
    .replace(",", ".")
    .trim();

  if (!normalized) return 0;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toFiniteNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    return parseMoney(value);
  }
  return 0;
}

function getMonthRange(monthValue: string | null | undefined) {
  const month = normalizeAusnMonth(monthValue);
  const [year, monthNum] = month.split("-").map(Number);
  const from = new Date(Date.UTC(year!, monthNum! - 1, 1));
  const toExclusive = new Date(Date.UTC(year!, monthNum!, 1));
  const toInclusive = new Date(toExclusive.getTime() - 86_400_000);
  return {
    month,
    fromDate: from.toISOString().slice(0, 10),
    toDate: toInclusive.toISOString().slice(0, 10),
  };
}

function decodeXml(text: string) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (entity, raw: string) => {
    if (raw.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(raw.slice(2), 16));
    }
    if (raw.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(raw.slice(1), 10));
    }
    return ENTITY_RE[raw] ?? entity;
  });
}

function stripXml(value: string) {
  return decodeXml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function columnIndexFromRef(ref: string) {
  const letters = (ref.match(/[A-Z]+/i)?.[0] ?? "").toUpperCase();
  let index = 0;
  for (const letter of letters) {
    index = (index * 26) + letter.charCodeAt(0) - 64;
  }
  return Math.max(index - 1, 0);
}

function parseSharedStrings(xml: string) {
  const strings: string[] = [];
  const siMatches = xml.match(/<si[\s\S]*?<\/si>/g) ?? [];
  siMatches.forEach((si) => {
    const parts = Array.from(si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((match) => decodeXml(match[1] ?? ""));
    strings.push(parts.join(""));
  });
  return strings;
}

function extractXlsxRows(bytes: Uint8Array) {
  const zip = unzipSync(bytes);
  const sharedStringsXml = zip["xl/sharedStrings.xml"]
    ? new TextDecoder().decode(zip["xl/sharedStrings.xml"])
    : "";
  const sharedStrings = parseSharedStrings(sharedStringsXml);
  const sheetPaths = Object.keys(zip)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .sort();
  const rows: XlsxCell[][] = [];

  sheetPaths.forEach((sheetPath) => {
    const sheetXml = new TextDecoder().decode(zip[sheetPath]!);
    const rowMatches = sheetXml.match(/<row\b[\s\S]*?<\/row>/g) ?? [];
    rowMatches.forEach((rowXml) => {
      const cells: XlsxCell[] = [];
      const cellMatches = rowXml.match(/<c\b[\s\S]*?<\/c>/g) ?? [];
      cellMatches.forEach((cellXml) => {
        const ref = cellXml.match(/\br="([^"]+)"/)?.[1] ?? "";
        const type = cellXml.match(/\bt="([^"]+)"/)?.[1] ?? "";
        const column = columnIndexFromRef(ref);
        let value = "";

        if (type === "s") {
          const index = Number.parseInt(cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "", 10);
          value = Number.isFinite(index) ? sharedStrings[index] ?? "" : "";
        } else if (type === "inlineStr") {
          value = stripXml(cellXml.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? "");
        } else {
          value = decodeXml(cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
        }

        if (value.trim()) {
          cells.push({ value: value.trim(), column });
        }
      });
      if (cells.length > 0) {
        rows.push(cells);
      }
    });
  });

  return rows;
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function rowText(row: XlsxCell[]) {
  return normalizeText(row.map((cell) => cell.value).join(" "));
}

function moneyCandidates(row: XlsxCell[]) {
  return row.flatMap((cell) => {
    const raw = cell.value;
    const hasMoneyShape = /(?:\d[\d\s]*[,.]\d{1,2})|(?:руб)/i.test(raw);
    const matches = raw.match(/-?\d[\d\s]*(?:[,.]\d{1,2})?/g) ?? [];
    return matches.flatMap((match) => {
      const value = Math.abs(parseMoney(match));
      if (!Number.isFinite(value) || value <= 0) return [];
      return [{
        value,
        column: cell.column,
        hasMoneyShape: hasMoneyShape || /[,.]\d{1,2}/.test(match),
      }];
    });
  });
}

function selectMoney(row: XlsxCell[]) {
  const candidates = moneyCandidates(row)
    .filter((candidate) => candidate.value < 1_000_000_000);
  const moneyShaped = candidates.filter((candidate) => candidate.hasMoneyShape);
  const pool = moneyShaped.length > 0 ? moneyShaped : candidates;
  return pool.sort((a, b) => b.column - a.column)[0]?.value ?? 0;
}

function firstAmountByLabels(rows: XlsxCell[][], labels: string[]) {
  for (const row of rows) {
    const text = rowText(row);
    if (labels.every((label) => text.includes(label))) {
      const amount = selectMoney(row);
      if (amount > 0) return amount;
    }
  }
  return 0;
}

function maxAmountByAnyLabel(rows: XlsxCell[][], labels: string[]) {
  let amount = 0;
  rows.forEach((row) => {
    const text = rowText(row);
    if (labels.some((label) => text.includes(label))) {
      amount = Math.max(amount, selectMoney(row));
    }
  });
  return amount;
}

function classifyXlsx(path: string, rows: XlsxCell[][]): AusnDocumentType | null {
  const fileName = normalizeText(path);
  const text = rows.slice(0, 80).map(rowText).join(" ");

  if (fileName.includes("укд") || text.includes("универсальный корректировочный документ")) {
    return "ukd_expense_return";
  }
  if (fileName.includes("упд") || text.includes("универсальный передаточный документ")) {
    return "upd_expense";
  }
  if (fileName.includes("выкуп") || (text.includes("уведомление") && text.includes("выкуп"))) {
    return "buyout_income";
  }
  if (fileName.includes("offer") || fileName.includes("оферт") || text.includes("отчет по оферте") || text.includes("к оферте")) {
    return "weekly_withholding";
  }
  return null;
}

function extractAmountFromXlsx(type: AusnDocumentType, rows: XlsxCell[][]) {
  if (type === "weekly_withholding") {
    return firstAmountByLabels(rows, ["итого к перечислению продавцу за текущий период"])
      || firstAmountByLabels(rows, ["итого", "перечислению продавцу"]);
  }
  if (type === "upd_expense" || type === "ukd_expense_return") {
    return firstAmountByLabels(rows, ["всего к оплате"])
      || firstAmountByLabels(rows, ["всего к уплате"])
      || maxAmountByAnyLabel(rows, ["всего", "итого"]);
  }
  if (type === "buyout_income") {
    return maxAmountByAnyLabel(rows, ["итого", "всего", "сумма"]);
  }
  return 0;
}

function extractFilesFromPayload(fileName: string, extension: string, documentBase64: string): ExtractedFile[] {
  const rootBytes = new Uint8Array(Buffer.from(documentBase64, "base64"));
  const rootExtension = extension.toLowerCase();
  const files: ExtractedFile[] = [];

  const visit = (path: string, ext: string, bytes: Uint8Array) => {
    if (ext === "zip") {
      const zip = unzipSync(bytes);
      Object.entries(zip).forEach(([childPath, childBytes]) => {
        const childExtension = childPath.split(".").pop()?.toLowerCase() ?? "";
        visit(`${path}/${childPath}`, childExtension, childBytes);
      });
      return;
    }

    files.push({ path, extension: ext, bytes });
  };

  visit(fileName, rootExtension, rootBytes);
  return files;
}

export function parseAusnRowsFromDownloadedDocument(
  fileName: string,
  extension: string,
  documentBase64: string
): ParsedAusnDocumentRow[] {
  return extractFilesFromPayload(fileName, extension, documentBase64).flatMap((file) => {
    if (file.extension !== "xlsx") return [];

    const rows = extractXlsxRows(file.bytes);
    const type = classifyXlsx(file.path, rows);
    if (!type) return [];

    const amount = roundMoney(extractAmountFromXlsx(type, rows));
    if (amount <= 0) return [];

    return [{
      documentType: type,
      amount,
      title: file.path.split("/").pop()?.slice(0, 500) || file.path.slice(0, 500),
      documentDate: null,
      source: `wb-api:${file.path}`,
    }];
  });
}

function preferredExtension(document: WbDocumentListItem): string | null {
  const extensions = document.extensions.map((extension) => extension.toLowerCase());
  return extensions.find((extension) => extension === "zip")
    ?? extensions.find((extension) => extension === "xlsx")
    ?? extensions.find((extension) => extension === "xml")
    ?? null;
}

function fallbackRowFromDocument(document: WbDocumentListItem): ParsedAusnDocumentRow | null {
  const type = CATEGORY_TO_DOCUMENT_TYPE[document.name];
  if (!type) return null;
  return {
    documentType: type,
    amount: 0,
    title: document.category || document.serviceName,
    documentDate: document.creationTime ? document.creationTime.slice(0, 10) : null,
    source: `wb-api:${document.serviceName}`,
  };
}

function detailAmount(item: WbRealizationReportItem) {
  const withDisc = toFiniteNumber(item.retail_price_withdisc_rub);
  if (withDisc !== 0) return Math.abs(withDisc);
  return Math.abs(toFiniteNumber(item.retail_amount));
}

function calculateDetailRows(reports: WbRealizationReportItem[]): ParsedAusnDocumentRow[] {
  let income = 0;
  let incomeReturn = 0;
  const reportIds = new Set<number>();

  reports.forEach((item) => {
    reportIds.add(item.realizationreport_id);
    const operation = normalizeText(`${item.doc_type_name ?? ""} ${item.supplier_oper_name ?? ""}`);
    const amount = detailAmount(item);
    if (amount <= 0) return;

    if (operation.includes("возврат") || item.quantity < 0) {
      incomeReturn += amount;
      return;
    }
    if (operation.includes("продажа") || operation.includes("реализац") || item.quantity > 0) {
      income += amount;
    }
  });

  const rows: ParsedAusnDocumentRow[] = [];
  if (income > 0) {
    rows.push({
      documentType: "detail_income",
      amount: roundMoney(income),
      title: `Детализация WB API: доходы, ${reports.length} строк`,
      documentDate: null,
      source: `wb-api-detail:reports=${reportIds.size}`,
    });
  }
  if (incomeReturn > 0) {
    rows.push({
      documentType: "detail_income_return",
      amount: roundMoney(incomeReturn),
      title: `Детализация WB API: возврат доходов, ${reports.length} строк`,
      documentDate: null,
      source: `wb-api-detail:reports=${reportIds.size}`,
    });
  }
  return rows;
}

async function getTenantToken(tenantId: string) {
  const rows = await withTenantContext(db, tenantId, async (tx) => (
    tx.select({ wbApiToken: tenants.wbApiToken })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
  ));
  const encryptedToken = rows[0]?.wbApiToken?.trim();
  if (!encryptedToken) {
    throw new Error("Для кабинета не задан WB API токен.");
  }
  return decryptIfNeeded(encryptedToken, tenantId).trim();
}

export async function syncAusnFromWbDocuments(
  tenantId: string,
  monthValue: string | null | undefined,
): Promise<AusnWbDocumentSyncResult> {
  const range = getMonthRange(monthValue);
  const token = await getTenantToken(tenantId);
  const warnings: AusnSyncWarning[] = [];

  const documents = await wbApi.getAllDocumentsList(token, {
    beginTime: range.fromDate,
    endTime: range.toDate,
    locale: "ru",
    sort: "date",
    order: "asc",
  });

  const queuedDocuments = documents
    .filter((document) => AUSN_DOCUMENT_CATEGORIES.has(document.name))
    .map((document) => ({ document, extension: preferredExtension(document) }))
    .filter((item): item is { document: WbDocumentListItem; extension: string } => Boolean(item.extension));

  if (queuedDocuments.length > 50) {
    warnings.push({
      code: "too_many_documents",
      message: "WB вернул больше 50 документов за месяц. В один прогон загружены первые 50, повторный фоновый режим нужно выделить отдельно.",
    });
  }

  const downloadQueue = queuedDocuments.slice(0, 50);
  let parsedRows: ParsedAusnDocumentRow[] = [];

  if (downloadQueue.length > 0) {
    await delay(10_000);
    const batch = await wbApi.downloadDocuments(
      token,
      downloadQueue.map(({ document, extension }) => ({ serviceName: document.serviceName, extension }))
    );
    parsedRows = parseAusnRowsFromDownloadedDocument(batch.fileName, batch.extension, batch.document);
  }

  const parsedTypes = new Set(parsedRows.map((row) => row.documentType));
  queuedDocuments.forEach(({ document }) => {
    const fallback = fallbackRowFromDocument(document);
    if (fallback && !parsedTypes.has(fallback.documentType)) {
      warnings.push({
        code: "document_parse_missing",
        message: `Документ ${document.serviceName} найден, но сумма из файла не распознана автоматически.`,
      });
    }
  });

  let detailRows: ParsedAusnDocumentRow[] = [];
  let detailReportRows = 0;
  let detailReports = 0;
  try {
    await delay(10_000);
    const reports = await wbApi.getAllRealizationReports(token, range.fromDate, range.toDate);
    detailReportRows = reports.length;
    detailReports = new Set(reports.map((item) => item.realizationreport_id)).size;
    detailRows = calculateDetailRows(reports);
  } catch (error) {
    warnings.push({
      code: "detail_api_failed",
      message: error instanceof Error
        ? `Детализация WB API не загрузилась: ${error.message}`
        : "Детализация WB API не загрузилась.",
    });
  }

  const rowsToSave = [...parsedRows, ...detailRows].filter((row) => row.amount > 0);

  await withTenantContext(db, tenantId, async (tx) => {
    await tx.execute(sql`
      DELETE FROM ausn_document_rows
      WHERE tenant_id = ${tenantId}
        AND month = ${range.fromDate}::date
        AND document_type IN (${sql.join(AUSN_WB_DOCUMENT_TYPES.map((type) => sql`${type}`), sql`, `)});
    `);

    if (rowsToSave.length > 0) {
      await tx.insert(ausnDocumentRows).values(rowsToSave.map((row) => ({
        tenantId,
        month: range.fromDate,
        documentType: row.documentType,
        amount: row.amount.toFixed(2),
        title: row.title,
        documentDate: row.documentDate,
        source: row.source,
      })));
    }
  });

  const report = await getAusnMonthlyReconciliation(tenantId, range.month);

  return {
    report,
    sync: {
      month: range.month,
      documentsFound: documents.length,
      documentsQueued: downloadQueue.length,
      documentRowsSaved: rowsToSave.length,
      detailRows: detailReportRows,
      detailReports,
      warnings,
    },
  };
}
