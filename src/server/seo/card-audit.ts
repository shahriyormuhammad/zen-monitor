import { sql } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';

export type SeoAuditPriority = 'P0' | 'P1' | 'P2' | 'P3' | 'OK';
export type SeoAuditSeverity = 'danger' | 'warning' | 'info';
export type SeoAuditField = 'title' | 'description' | 'characteristics' | 'media' | 'funnel' | 'stock' | 'data';

export type SeoAuditIssue = {
  code: string;
  field: SeoAuditField;
  severity: SeoAuditSeverity;
  priority: Exclude<SeoAuditPriority, 'OK'>;
  title: string;
  details: string;
  recommendation: string;
  source: 'wb_rules' | 'jarvis_sop' | 'metric' | 'data_quality';
};

export type SeoTextDraft = {
  title: string;
  description: string;
  hasTextChanges: boolean;
};

export type SeoAuditRow = {
  nmId: number;
  vendorCode: string | null;
  brand: string | null;
  category: string | null;
  photoUrl: string | null;
  title: string | null;
  description: string | null;
  descriptionPreview: string | null;
  updatedAt: string | null;
  score: number;
  priority: SeoAuditPriority;
  issues: SeoAuditIssue[];
  draft: SeoTextDraft;
  metrics: {
    titleLength: number;
    descriptionLength: number;
    photosCount: number;
    hasVideo: boolean;
    characteristicsCount: number;
    openCardCount: number;
    addToCartCount: number;
    orderCount: number;
    buyoutCount: number;
    addToCartPercent: number | null;
    cartToOrderPercent: number | null;
    orderToBuyoutPercent: number | null;
    stockQty: number | null;
  };
};

export type SeoAuditSummary = {
  totalCards: number;
  p0Count: number;
  p1Count: number;
  p2Count: number;
  okCount: number;
  avgScore: number;
  issuesByField: Record<SeoAuditField, number>;
};

export type SeoAuditResponse = {
  generatedAt: string;
  dateFrom: string;
  dateTo: string;
  summary: SeoAuditSummary;
  rows: SeoAuditRow[];
  rules: Array<{
    title: string;
    source: string;
  }>;
};

type AuditInput = {
  nmId: number;
  vendorCode: string | null;
  brand: string | null;
  category: string | null;
  photoUrl: string | null;
  title: string | null;
  description: string | null;
  updatedAt: Date | string | null;
  photosCount: number;
  hasVideo: boolean;
  characteristicsCount: number;
  openCardCount: number;
  addToCartCount: number;
  orderCount: number;
  buyoutCount: number;
  stockQty: number | null;
};

const STOP_WORDS = new Set([
  'для',
  'или',
  'это',
  'как',
  'что',
  'при',
  'без',
  'под',
  'над',
  'ваш',
  'ваша',
  'товар',
  'товара',
  'товары',
  'цвет',
  'размер',
]);

const RISKY_CLAIMS = [
  'профессиональ',
  'салон',
  'детск',
  'антистат',
  'гипоаллерген',
  'лечебн',
  'ортопед',
  'натуральн',
  'сертифик',
  'оригинал',
  'хит',
  'лучший',
  'топ',
  'премиум',
];

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toInt(value: unknown): number {
  return Math.max(0, Math.round(toNumber(value)));
}

function pct(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return Math.round((numerator / denominator) * 1000) / 10;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replaceAll('ё', 'е');
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-zа-я0-9]+/i)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
}

function getTopRepeatedWord(value: string): { word: string; count: number; density: number } | null {
  const words = tokenize(value);
  if (words.length === 0) {
    return null;
  }

  const counts = new Map<string, number>();
  for (const word of words) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  let top: { word: string; count: number; density: number } | null = null;
  for (const [word, count] of counts.entries()) {
    const density = count / words.length;
    if (!top || count > top.count || (count === top.count && density > top.density)) {
      top = { word, count, density };
    }
  }

  return top;
}

function hasDomain(value: string): boolean {
  return /(?:https?:\/\/|www\.|[a-zа-я0-9-]+\.(?:ru|рф|com|net|io|by|kz)\b)/i.test(value);
}

function specialSymbolCount(value: string): number {
  return (value.match(/[/*+@№%&$={}[\]<>]/g) ?? []).length;
}

function findRiskyClaims(value: string): string[] {
  const normalized = normalizeText(value);
  return RISKY_CLAIMS.filter((claim) => normalized.includes(claim)).slice(0, 6);
}

function addIssue(issues: SeoAuditIssue[], issue: SeoAuditIssue) {
  issues.push(issue);
}

function pickRowPriority(issues: SeoAuditIssue[]): SeoAuditPriority {
  if (issues.some((issue) => issue.priority === 'P0')) {
    return 'P0';
  }
  if (issues.some((issue) => issue.priority === 'P1')) {
    return 'P1';
  }
  if (issues.some((issue) => issue.priority === 'P2')) {
    return 'P2';
  }
  if (issues.some((issue) => issue.priority === 'P3')) {
    return 'P3';
  }
  return 'OK';
}

function scoreIssues(issues: SeoAuditIssue[]): number {
  const penalty = issues.reduce((sum, issue) => {
    if (issue.severity === 'danger') {
      return sum + 16;
    }
    if (issue.severity === 'warning') {
      return sum + 8;
    }
    return sum + 3;
  }, 0);

  return Math.max(0, Math.min(100, 100 - penalty));
}

function preview(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
}

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripUnsafeSeoMarkers(value: string): string {
  return collapseSpaces(
    value
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/www\.\S+/gi, ' ')
      .replace(/[a-zа-я0-9-]+\.(?:ru|рф|com|net|io|by|kz)\b/gi, ' ')
      .replace(/#[\p{L}\p{N}_-]+/gu, ' ')
      .replace(/(?:seo|сео|ключевые\s+слова|теги)\s*:*/gi, ' ')
      .replace(/[/*+@№%&$={}[\]<>]/g, ' '),
  );
}

function limitTitleByWords(value: string): string {
  if (value.length <= 60) {
    return value;
  }

  const words = value.split(/\s+/);
  let result = '';
  for (const word of words) {
    const next = result ? `${result} ${word}` : word;
    if (next.length > 60) {
      break;
    }
    result = next;
  }

  return result || value.slice(0, 60).trim();
}

export function buildSeoTextDraft(title: string | null, description: string | null): SeoTextDraft {
  const currentTitle = collapseSpaces(title ?? '');
  const currentDescription = collapseSpaces(description ?? '');
  const draftTitle = limitTitleByWords(stripUnsafeSeoMarkers(currentTitle));
  const draftDescription = stripUnsafeSeoMarkers(currentDescription);

  return {
    title: draftTitle,
    description: draftDescription,
    hasTextChanges: draftTitle !== currentTitle || draftDescription !== currentDescription,
  };
}

export function validateSeoTextPatch(input: {
  title: string | null | undefined;
  description: string | null | undefined;
}): string[] {
  const errors: string[] = [];
  const title = collapseSpaces(input.title ?? '');
  const description = collapseSpaces(input.description ?? '');

  if (!title) {
    errors.push('Название обязательно для применения SEO-правки.');
  }
  if (title.length > 60) {
    errors.push('Название должно быть не длиннее 60 символов.');
  }
  if (hasDomain(title) || hasDomain(description)) {
    errors.push('В названии и описании нельзя оставлять домены или ссылки.');
  }
  if (/(?:#|seo|сео|ключевые\s+слова|теги)/i.test(`${title} ${description}`)) {
    errors.push('Нельзя применять SEO-списки, теги и hashtag-маркеры.');
  }
  if (specialSymbolCount(description) >= 3) {
    errors.push('В описании слишком много спецсимволов из запрещённой группы.');
  }
  if (description.length > 5000) {
    errors.push('Описание должно быть не длиннее 5000 символов.');
  }

  return errors;
}

export function auditSeoCard(input: AuditInput): SeoAuditRow {
  const issues: SeoAuditIssue[] = [];
  const title = input.title?.trim() ?? '';
  const description = input.description?.trim() ?? '';
  const allText = `${title} ${description}`;
  const titleLength = title.length;
  const descriptionLength = description.length;
  const addToCartPercent = pct(input.addToCartCount, input.openCardCount);
  const cartToOrderPercent = pct(input.orderCount, input.addToCartCount);
  const orderToBuyoutPercent = pct(input.buyoutCount, input.orderCount);

  if (!title) {
    addIssue(issues, {
      code: 'title_missing',
      field: 'title',
      severity: 'danger',
      priority: 'P0',
      title: 'Нет названия',
      details: 'Карточка не проходит базовую SEO-проверку без наименования.',
      recommendation: 'Подготовить название после проверки предмета, семантики и конкурентов.',
      source: 'wb_rules',
    });
  } else if (titleLength > 60) {
    addIssue(issues, {
      code: 'title_too_long',
      field: 'title',
      severity: 'danger',
      priority: 'P1',
      title: 'Название длиннее 60 символов',
      details: `Сейчас ${titleLength} символов. WB указывает максимум 60 и оптимум около 40.`,
      recommendation: 'Сжать название до главного предмета и релевантных уточнений без перечисления ключей.',
      source: 'wb_rules',
    });
  } else if (titleLength < 25) {
    addIssue(issues, {
      code: 'title_too_short',
      field: 'title',
      severity: 'warning',
      priority: 'P2',
      title: 'Короткое название',
      details: `Сейчас ${titleLength} символов. Может не хватать точного предмета или важного уточнения.`,
      recommendation: 'Проверить семантику и добавить только подтверждённый релевантный хвост.',
      source: 'jarvis_sop',
    });
  }

  const titleRepeat = getTopRepeatedWord(title);
  if (titleRepeat && titleRepeat.count >= 3) {
    addIssue(issues, {
      code: 'title_repetition',
      field: 'title',
      severity: 'warning',
      priority: 'P2',
      title: 'Повтор в названии',
      details: `Слово "${titleRepeat.word}" повторяется ${titleRepeat.count} раза.`,
      recommendation: 'Убрать дубли и синонимы, оставить один точный предмет.',
      source: 'wb_rules',
    });
  }

  if (!description) {
    addIssue(issues, {
      code: 'description_missing',
      field: 'description',
      severity: 'warning',
      priority: 'P1',
      title: 'Нет описания',
      details: 'Описание необязательное, но WB считает его важным для понимания товара и индексации текста.',
      recommendation: 'Подготовить лаконичное описание с пользой, свойствами и органичными ключами без SEO-списка.',
      source: 'wb_rules',
    });
  } else if (descriptionLength < 120) {
    addIssue(issues, {
      code: 'description_too_short',
      field: 'description',
      severity: 'warning',
      priority: 'P2',
      title: 'Описание короткое',
      details: `Сейчас ${descriptionLength} символов. Для многих карточек этого мало, чтобы закрыть свойства и вопросы покупателя.`,
      recommendation: 'Добавить только фактические свойства, сценарий применения, комплектацию и ограничения товара.',
      source: 'jarvis_sop',
    });
  }

  if (description && hasDomain(description)) {
    addIssue(issues, {
      code: 'description_domain',
      field: 'description',
      severity: 'danger',
      priority: 'P0',
      title: 'В описании есть домен или ссылка',
      details: 'WB запрещает указывать домены и внешние сайты в описании.',
      recommendation: 'Удалить домены, ссылки и внешние контакты из черновика правки.',
      source: 'wb_rules',
    });
  }

  if (description && /(?:#|seo|сео|ключевые\s+слова|теги)/i.test(description)) {
    addIssue(issues, {
      code: 'description_seo_markers',
      field: 'description',
      severity: 'danger',
      priority: 'P1',
      title: 'Описание похоже на SEO-список',
      details: 'WB рекомендует не указывать теги и SEO-запросы списком.',
      recommendation: 'Переписать как нормальный текст: слова для выдачи встроить органично, без спецсимволов.',
      source: 'wb_rules',
    });
  }

  const repeatedWord = getTopRepeatedWord(description);
  if (repeatedWord && repeatedWord.count > 5 && repeatedWord.density >= 0.06) {
    addIssue(issues, {
      code: 'description_repetition',
      field: 'description',
      severity: 'warning',
      priority: 'P1',
      title: 'Переспам в описании',
      details: `Слово "${repeatedWord.word}" повторяется ${repeatedWord.count} раз.`,
      recommendation: 'Убрать повторы, оставить полезное описание и распределить свойства по характеристикам.',
      source: 'jarvis_sop',
    });
  }

  const symbolCount = specialSymbolCount(description);
  if (symbolCount >= 3) {
    addIssue(issues, {
      code: 'description_special_symbols',
      field: 'description',
      severity: 'warning',
      priority: 'P2',
      title: 'Много спецсимволов в описании',
      details: `Найдено ${symbolCount} спецсимволов из группы, которую WB просит не использовать в описании.`,
      recommendation: 'Упростить текст: слова разделять пробелами, не делать SEO-набор через символы.',
      source: 'wb_rules',
    });
  }

  const riskyClaims = findRiskyClaims(allText);
  if (riskyClaims.length > 0) {
    addIssue(issues, {
      code: 'unverified_claims',
      field: 'description',
      severity: 'warning',
      priority: 'P1',
      title: 'Есть свойства, требующие подтверждения',
      details: `Найдены маркеры: ${riskyClaims.join(', ')}.`,
      recommendation: 'Оставлять такие слова только если они подтверждены товаром, документами, характеристиками или отзывами.',
      source: 'jarvis_sop',
    });
  }

  if (input.photosCount <= 0) {
    addIssue(issues, {
      code: 'photos_missing',
      field: 'media',
      severity: 'danger',
      priority: 'P0',
      title: 'Нет фото',
      details: 'WB указывает, что товар без фото не показывается покупателям.',
      recommendation: 'Добавить фото до любых SEO-экспериментов.',
      source: 'wb_rules',
    });
  } else if (input.photosCount < 5) {
    addIssue(issues, {
      code: 'photos_low_count',
      field: 'media',
      severity: 'warning',
      priority: 'P2',
      title: 'Мало фото',
      details: `Сейчас ${input.photosCount} фото. Для карточки может не хватать контентной воронки.`,
      recommendation: 'Проверить первые 3 фото, УТП, размеры, материал, упаковку и возражения из отзывов.',
      source: 'jarvis_sop',
    });
  }

  if (!input.hasVideo) {
    addIssue(issues, {
      code: 'video_missing',
      field: 'media',
      severity: 'info',
      priority: 'P3',
      title: 'Нет видео',
      details: 'Видео не обязательно, но может закрывать сценарий применения, фактуру или размер.',
      recommendation: 'Добавлять видео только как гипотезу под конкретную проблему карточки.',
      source: 'jarvis_sop',
    });
  }

  if (input.characteristicsCount === 0) {
    addIssue(issues, {
      code: 'characteristics_missing',
      field: 'characteristics',
      severity: 'danger',
      priority: 'P1',
      title: 'Нет характеристик',
      details: 'Характеристики помогают WB фильтровать товар и показывать его по релевантным запросам.',
      recommendation: 'Получить характеристики предмета через Content API и заполнить релевантные поля.',
      source: 'wb_rules',
    });
  } else if (input.characteristicsCount < 5) {
    addIssue(issues, {
      code: 'characteristics_low_count',
      field: 'characteristics',
      severity: 'warning',
      priority: 'P2',
      title: 'Мало характеристик',
      details: `Заполнено ${input.characteristicsCount} характеристик. Без списка обязательных полей это базовая эвристика.`,
      recommendation: 'Сверить с предметом WB: required/popular/hasFilter характеристики заполнить первыми.',
      source: 'jarvis_sop',
    });
  }

  if (input.openCardCount >= 500 && addToCartPercent !== null && addToCartPercent < 5) {
    addIssue(issues, {
      code: 'weak_cart_conversion',
      field: 'funnel',
      severity: 'warning',
      priority: 'P1',
      title: 'Слабый переход в корзину',
      details: `${addToCartPercent}% при ${input.openCardCount} переходах в карточку.`,
      recommendation: 'Проверить ожидания: главное фото, первые слайды, описание, цену, отзывы и релевантность ключей.',
      source: 'metric',
    });
  }

  if (input.addToCartCount >= 50 && cartToOrderPercent !== null && cartToOrderPercent < 25) {
    addIssue(issues, {
      code: 'weak_cart_to_order',
      field: 'funnel',
      severity: 'warning',
      priority: 'P2',
      title: 'Корзины плохо переходят в заказ',
      details: `${cartToOrderPercent}% из корзины в заказ.`,
      recommendation: 'Проверить цену покупателя, СПП, доставку, остатки, отзывы и наличие размеров/вариантов.',
      source: 'metric',
    });
  }

  if (input.stockQty !== null && input.stockQty <= 0) {
    addIssue(issues, {
      code: 'stock_empty',
      field: 'stock',
      severity: 'danger',
      priority: 'P0',
      title: 'Нет остатка на WB',
      details: 'SEO-правки не дадут эффекта, если товар недоступен к покупке.',
      recommendation: 'Сначала восстановить остаток или исключить карточку из первоочередного SEO-плана.',
      source: 'metric',
    });
  }

  if (!input.updatedAt) {
    addIssue(issues, {
      code: 'metadata_missing',
      field: 'data',
      severity: 'warning',
      priority: 'P1',
      title: 'Нет свежего слепка контента',
      details: 'В локальном кэше нет Content API metadata для этой карточки.',
      recommendation: 'Запустить синхронизацию WB перед подготовкой payload-правки.',
      source: 'data_quality',
    });
  }

  const priority = pickRowPriority(issues);
  const score = scoreIssues(issues);

  return {
    nmId: input.nmId,
    vendorCode: input.vendorCode,
    brand: input.brand,
    category: input.category,
    photoUrl: input.photoUrl,
    title: title || null,
    description: description || null,
    descriptionPreview: preview(description),
    updatedAt: input.updatedAt ? new Date(input.updatedAt).toISOString() : null,
    score,
    priority,
    issues,
    draft: buildSeoTextDraft(title, description),
    metrics: {
      titleLength,
      descriptionLength,
      photosCount: input.photosCount,
      hasVideo: input.hasVideo,
      characteristicsCount: input.characteristicsCount,
      openCardCount: input.openCardCount,
      addToCartCount: input.addToCartCount,
      orderCount: input.orderCount,
      buyoutCount: input.buyoutCount,
      addToCartPercent,
      cartToOrderPercent,
      orderToBuyoutPercent,
      stockQty: input.stockQty,
    },
  };
}

function buildSummary(rows: SeoAuditRow[]): SeoAuditSummary {
  const issuesByField: Record<SeoAuditField, number> = {
    title: 0,
    description: 0,
    characteristics: 0,
    media: 0,
    funnel: 0,
    stock: 0,
    data: 0,
  };

  for (const row of rows) {
    for (const issue of row.issues) {
      issuesByField[issue.field] += 1;
    }
  }

  const scoreSum = rows.reduce((sum, row) => sum + row.score, 0);

  return {
    totalCards: rows.length,
    p0Count: rows.filter((row) => row.priority === 'P0').length,
    p1Count: rows.filter((row) => row.priority === 'P1').length,
    p2Count: rows.filter((row) => row.priority === 'P2').length,
    okCount: rows.filter((row) => row.priority === 'OK' || row.priority === 'P3').length,
    avgScore: rows.length > 0 ? Math.round(scoreSum / rows.length) : 0,
    issuesByField,
  };
}

export async function getSeoAudit(tenantId: string, dateFrom: Date, dateTo: Date): Promise<SeoAuditResponse> {
  const fromDate = dateFrom.toISOString().slice(0, 10);
  const toDate = dateTo.toISOString().slice(0, 10);

  const rowsRaw = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    WITH funnel AS (
      SELECT
        nm_id,
        SUM(open_card_count)::bigint AS open_card_count,
        SUM(add_to_cart_count)::bigint AS add_to_cart_count,
        SUM(order_count)::bigint AS order_count,
        SUM(buyout_count)::bigint AS buyout_count
      FROM raw_api_funnel_stats
      WHERE tenant_id = ${tenantId}
        AND period_start::date >= ${fromDate}::date
        AND period_start::date <= ${toDate}::date
      GROUP BY nm_id
    ),
    latest_stock_date AS (
      SELECT MAX(date) AS date
      FROM raw_api_stocks
      WHERE tenant_id = ${tenantId}
    ),
    stock AS (
      SELECT
        s.nm_id,
        SUM(s.amount)::bigint AS stock_qty
      FROM raw_api_stocks s
      JOIN latest_stock_date d
        ON s.date = d.date
      WHERE s.tenant_id = ${tenantId}
      GROUP BY s.nm_id
    )
    SELECT
      p.nm_id,
      p.vendor_code,
      p.brand,
      p.category,
      p.photo_url,
      meta.title,
      meta.description,
      meta.photos_count,
      meta.has_video,
      meta.characteristics_count,
      meta.updated_at,
      COALESCE(f.open_card_count, 0) AS open_card_count,
      COALESCE(f.add_to_cart_count, 0) AS add_to_cart_count,
      COALESCE(f.order_count, 0) AS order_count,
      COALESCE(f.buyout_count, 0) AS buyout_count,
      stock.stock_qty
    FROM products p
    LEFT JOIN raw_api_product_metadata meta
      ON meta.tenant_id = ${tenantId}
     AND meta.nm_id = p.nm_id
    LEFT JOIN funnel f
      ON f.nm_id = p.nm_id
    LEFT JOIN stock
      ON stock.nm_id = p.nm_id
    WHERE p.tenant_id = ${tenantId}
      AND COALESCE(p.is_hidden, FALSE) = FALSE
      AND COALESCE(p.is_archived, FALSE) = FALSE
    ORDER BY
      CASE WHEN COALESCE(f.open_card_count, 0) > 0 THEN 0 ELSE 1 END,
      COALESCE(f.open_card_count, 0) DESC,
      p.vendor_code ASC
    LIMIT 1000
  `));

  const rows = rowsRaw.map((row) => {
    const record = row as Record<string, unknown>;
    return auditSeoCard({
      nmId: toInt(record.nm_id),
      vendorCode: (record.vendor_code as string | null) ?? null,
      brand: (record.brand as string | null) ?? null,
      category: (record.category as string | null) ?? null,
      photoUrl: (record.photo_url as string | null) ?? null,
      title: (record.title as string | null) ?? null,
      description: (record.description as string | null) ?? null,
      updatedAt: (record.updated_at as Date | string | null) ?? null,
      photosCount: toInt(record.photos_count),
      hasVideo: Boolean(record.has_video),
      characteristicsCount: toInt(record.characteristics_count),
      openCardCount: toInt(record.open_card_count),
      addToCartCount: toInt(record.add_to_cart_count),
      orderCount: toInt(record.order_count),
      buyoutCount: toInt(record.buyout_count),
      stockQty: toNullableNumber(record.stock_qty),
    });
  });

  return {
    generatedAt: new Date().toISOString(),
    dateFrom: fromDate,
    dateTo: toDate,
    summary: buildSummary(rows),
    rows,
    rules: [
      { title: 'Название: максимум 60 символов, оптимум около 40, без дублей и нерелевантных слов.', source: 'WB Seller, правила заполнения карточки' },
      { title: 'Описание: без доменов, тегов, SEO-списков, спецсимволов и повторов.', source: 'WB Seller, как создать и оптимизировать карточку' },
      { title: 'Характеристики: заполнять релевантные фильтры предмета WB, сначала required/popular/hasFilter.', source: 'WB Content API + Jarvis SOP' },
      { title: 'Изменения на WB: только вручную с карточки, после проверки текста оператором.', source: 'WB Developers Content API' },
    ],
  };
}
