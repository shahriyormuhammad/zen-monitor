import { formatCurrency, formatUnits } from "./numeric";
import {
  buildFocusedHref,
  normalizeSignalType,
  type SignalInsight,
  type SignalRecommendation,
} from "./signals";

export function buildSignalRecommendations({
  type,
  nmId,
  signalTitle,
  signalId,
}: {
  type: string;
  nmId?: number | null;
  signalTitle: string;
  signalId: string;
}): SignalRecommendation[] {
  const normalizedType = normalizeSignalType(type);

  switch (normalizedType) {
    case "negative_margin":
      return [
        {
          label: "Открыть юнит-экономику",
          description: "Проверьте себестоимость, комиссии, рекламу и итоговую чистую прибыль по SKU.",
          href: buildFocusedHref({
            path: "/economics-v2",
            nmId,
            signalType: normalizedType,
            signalTitle,
            signalId,
          }),
        },
        {
          label: "Сверить raw-цены в Explorer",
          description: "Откройте цены и скидки уже в контексте этого SKU, чтобы быстро проверить price/discount state.",
          href: buildFocusedHref({
            path: "/explorer",
            nmId,
            signalType: normalizedType,
            signalTitle,
            signalId,
            focusTab: "prices",
          }),
        },
      ];
    case "ads_leak":
      return [
        {
          label: "Проверить экономику SKU",
          description: "Сравните выручку, рекламу и чистую прибыль, прежде чем менять ставки или отключать трафик.",
          href: buildFocusedHref({
            path: "/economics-v2",
            nmId,
            signalType: normalizedType,
            signalTitle,
            signalId,
          }),
        },
        {
          label: "Открыть raw-рекламу",
          description: "Перейдите сразу в ARM-данные по этому SKU и проверьте всплеск расходов без ручного поиска.",
          href: buildFocusedHref({
            path: "/explorer",
            nmId,
            signalType: normalizedType,
            signalTitle,
            signalId,
            focusTab: "ads",
          }),
        },
      ];
    case "stock_out":
      return [
        {
          label: "Открыть юнит-экономику",
          description: "Сверьте скорость продаж и остаток по SKU перед решением о пополнении.",
          href: buildFocusedHref({
            path: "/economics-v2",
            nmId,
            signalType: normalizedType,
            signalTitle,
            signalId,
          }),
        },
        {
          label: "Открыть raw-заказы",
          description: "Посмотрите последние заказы этого SKU и подтвердите, что текущий остаток действительно заканчивается.",
          href: buildFocusedHref({
            path: "/explorer",
            nmId,
            signalType: normalizedType,
            signalTitle,
            signalId,
            focusTab: "orders",
          }),
        },
      ];
    case "logistics_spike":
      return [
        {
          label: "Открыть юнит-экономику",
          description: "Сравните логистику на единицу с общей маржой и влиянием на чистую прибыль.",
          href: buildFocusedHref({
            path: "/economics-v2",
            nmId,
            signalType: normalizedType,
            signalTitle,
            signalId,
          }),
        },
        {
          label: "Открыть raw-реализации",
          description: "Проверьте записи реализации по этому SKU и подтвердите источник логистических расходов.",
          href: buildFocusedHref({
            path: "/explorer",
            nmId,
            signalType: normalizedType,
            signalTitle,
            signalId,
            focusTab: "realizations",
          }),
        },
      ];
    case "content_risk":
      return [
        {
          label: "Открыть raw-воронку",
          description: "Перейдите к просмотрам и корзинам этого SKU, чтобы понять, как контентный риск бьёт по конверсии.",
          href: buildFocusedHref({
            path: "/explorer",
            nmId,
            signalType: normalizedType,
            signalTitle,
            signalId,
            focusTab: "funnel",
          }),
        },
        {
          label: "Проверить продажи",
          description: "Сопоставьте контентный риск с текущими продажами и конверсией перед приоритизацией работ.",
          href: buildFocusedHref({
            path: "/economics-v2",
            nmId,
            signalType: normalizedType,
            signalTitle,
            signalId,
          }),
        },
      ];
    case "seo_risk":
      return [
        {
          label: "Открыть raw-воронку",
          description: "Откройте просмотры и корзины по этому SKU, чтобы привязать SEO-риск к фактической конверсии.",
          href: buildFocusedHref({
            path: "/explorer",
            nmId,
            signalType: normalizedType,
            signalTitle,
            signalId,
            focusTab: "funnel",
          }),
        },
        {
          label: "Проверить юнит-экономику",
          description: "Сопоставьте SEO-риск с выручкой и прибылью, чтобы приоритизировать карточку по эффекту на бизнес.",
          href: buildFocusedHref({
            path: "/economics-v2",
            nmId,
            signalType: normalizedType,
            signalTitle,
            signalId,
          }),
        },
      ];
    case "conversion_drop":
      return [
        {
          label: "Открыть raw-воронку",
          description: "Перейдите сразу к просмотрам и корзинам этого SKU, чтобы подтвердить, где просела конверсия.",
          href: buildFocusedHref({
            path: "/explorer",
            nmId,
            signalType: normalizedType,
            signalTitle,
            signalId,
            focusTab: "funnel",
          }),
        },
        {
          label: "Проверить юнит-экономику",
          description: "Сопоставьте конверсионную проблему с продажами и прибылью по этому SKU.",
          href: buildFocusedHref({
            path: "/economics-v2",
            nmId,
            signalType: normalizedType,
            signalTitle,
            signalId,
          }),
        },
      ];
    default:
      return [
        {
          label: "Открыть юнит-экономику",
          description: "Перейдите сразу в экономику выбранного SKU, чтобы вручную разобрать сигнал на цифрах.",
          href: buildFocusedHref({
            path: "/economics-v2",
            nmId,
            signalType: normalizedType,
            signalTitle,
            signalId,
          }),
        },
      ];
  }
}

export function buildSignalInsights({
  type,
  impactRub,
  metrics,
  content,
  totalStock,
}: {
  type: string;
  impactRub: number;
  metrics: {
    grossRevenue: number;
    netProfit: number;
    adSpend: number;
    logistics: number;
    soldQuantity: number;
    daysOfStock: number | null;
    views: number;
    carts: number;
  } | null;
  content: {
    title: string | null;
    photosCount: number;
    hasVideo: boolean;
    characteristicsCount: number;
  } | null;
  totalStock: number | null;
}) {
  const normalizedType = normalizeSignalType(type);
  const insights: SignalInsight[] = [];

  if (normalizedType === "negative_margin") {
    if (metrics) {
      insights.push(
        { label: "Чистая прибыль", value: formatCurrency(metrics.netProfit), tone: "danger" },
        { label: "Реклама за 14 дней", value: formatCurrency(metrics.adSpend), tone: metrics.adSpend > 0 ? "warning" : "default" },
        { label: "Продано единиц", value: formatUnits(metrics.soldQuantity), tone: "default" },
      );
    }
  }

  if (normalizedType === "ads_leak" && metrics) {
    const acos = metrics.grossRevenue > 0 ? (metrics.adSpend / metrics.grossRevenue) * 100 : 0;
    insights.push(
      { label: "ДРР", value: `${acos.toFixed(1)}%`, tone: acos > 45 ? "danger" : "warning" },
      { label: "Реклама", value: formatCurrency(metrics.adSpend), tone: "warning" },
      { label: "Выручка", value: formatCurrency(metrics.grossRevenue), tone: "default" },
    );
  }

  if (normalizedType === "stock_out") {
    insights.push(
      { label: "Остаток", value: totalStock !== null ? formatUnits(totalStock) : "Нет данных", tone: totalStock !== null && totalStock > 0 ? "warning" : "danger" },
      {
        label: "Запас по скорости",
        value: metrics?.daysOfStock !== null && metrics?.daysOfStock !== undefined
          ? `${Math.round(metrics.daysOfStock)} дн.`
          : "Нет данных",
        tone: metrics?.daysOfStock !== null && metrics?.daysOfStock !== undefined && metrics.daysOfStock < 4 ? "danger" : "default",
      },
      { label: "Продано за 14 дней", value: metrics ? formatUnits(metrics.soldQuantity) : "Нет данных", tone: "default" },
    );
  }

  if (normalizedType === "logistics_spike" && metrics) {
    const logisticsPerUnit = metrics.soldQuantity > 0 ? metrics.logistics / metrics.soldQuantity : 0;
    insights.push(
      { label: "Логистика на единицу", value: formatCurrency(logisticsPerUnit), tone: logisticsPerUnit > 250 ? "danger" : "warning" },
      { label: "Всего логистики", value: formatCurrency(metrics.logistics), tone: "warning" },
      { label: "Чистая прибыль", value: formatCurrency(metrics.netProfit), tone: metrics.netProfit < 0 ? "danger" : "default" },
    );
  }

  if (normalizedType === "content_risk" && content) {
    insights.push(
      { label: "Фотографии", value: `${content.photosCount} шт.`, tone: content.photosCount < 5 ? "warning" : "default" },
      { label: "Видео", value: content.hasVideo ? "Есть" : "Нет", tone: content.hasVideo ? "success" : "warning" },
      { label: "Характеристики", value: `${content.characteristicsCount} шт.`, tone: content.characteristicsCount > 0 ? "default" : "warning" },
    );
  }

  if ((normalizedType === "seo_risk" || normalizedType === "conversion_drop") && content) {
    const titleLength = content.title?.trim().length ?? 0;
    insights.push(
      { label: "Длина заголовка", value: titleLength > 0 ? `${titleLength} симв.` : "Нет данных", tone: titleLength > 0 && titleLength < 45 ? "warning" : "default" },
      { label: "Просмотры", value: metrics ? metrics.views.toLocaleString("ru-RU") : "Нет данных", tone: "default" },
      { label: "Добавления в корзину", value: metrics ? metrics.carts.toLocaleString("ru-RU") : "Нет данных", tone: "default" },
    );
  }

  if (insights.length === 0) {
    insights.push({
      label: "Оценка влияния",
      value: impactRub !== 0 ? formatCurrency(Math.abs(impactRub)) : "Требуется ручная проверка",
      tone: impactRub < 0 ? "danger" : "default",
    });
  }

  return insights;
}
