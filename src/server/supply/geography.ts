/**
 * Geography helpers ported verbatim from Postal.
 *
 *   REGION_TO_OKRUG  — region/city name → federal district code
 *   OKRUG_ZONES      — WB unified tariff zones (ЮФО+СКФО, СФО+ДФО)
 *   WAREHOUSE_TARIFFS — WB warehouse → {federal district, tariff coefficient}
 *
 * Keep changes here in sync with the Postal source — both apps consume
 * the same WB regions / warehouses.
 */

export type Okrug =
  | 'ЦФО' | 'СЗФО' | 'ЮФО' | 'СКФО' | 'ПФО'
  | 'УФО' | 'СФО'  | 'ДФО' | 'KZ'   | 'AM';

/** Warehouse → federal district + relative tariff coefficient (Постал MVP). */
export const WAREHOUSE_TARIFFS: Record<string, { federal: Okrug; tariffCoef: number }> = {
  // ЦФО
  'Коледино':                { federal: 'ЦФО', tariffCoef: 1.00 },
  'Подольск':                { federal: 'ЦФО', tariffCoef: 1.05 },
  'Электросталь':            { federal: 'ЦФО', tariffCoef: 1.10 },
  'Белые Столбы':            { federal: 'ЦФО', tariffCoef: 1.00 },
  'Белая Дача':              { federal: 'ЦФО', tariffCoef: 1.10 },
  'Истра':                   { federal: 'ЦФО', tariffCoef: 1.00 },
  'Склад Чашниково':         { federal: 'ЦФО', tariffCoef: 1.00 },
  'Алексин (Тула)':          { federal: 'ЦФО', tariffCoef: 0.95 },
  'Рязань (Тюшевское)':      { federal: 'ЦФО', tariffCoef: 0.95 },
  'Владимир':                { federal: 'ЦФО', tariffCoef: 0.95 },
  'Котовск':                 { federal: 'ЦФО', tariffCoef: 0.85 },
  'Воронеж':                 { federal: 'ЦФО', tariffCoef: 0.85 },
  // СЗФО
  'Склад СПБ Шушары Московское': { federal: 'СЗФО', tariffCoef: 1.00 },
  'Обухово':                 { federal: 'СЗФО', tariffCoef: 1.00 },
  'Калининград':             { federal: 'СЗФО', tariffCoef: 1.15 },
  // ЮФО
  'Краснодар':               { federal: 'ЮФО', tariffCoef: 0.75 },
  'Волгоград':               { federal: 'ЮФО', tariffCoef: 0.70 },
  // СКФО
  'Невинномысск':            { federal: 'СКФО', tariffCoef: 0.60 },
  // ПФО
  'Казань':                  { federal: 'ПФО', tariffCoef: 0.85 },
  'Новосемейкино':           { federal: 'ПФО', tariffCoef: 0.65 },
  'Сарапул':                 { federal: 'ПФО', tariffCoef: 0.80 },
  'Пенза':                   { federal: 'ПФО', tariffCoef: 0.85 },
  // УФО
  'Перспективный':           { federal: 'УФО', tariffCoef: 0.70 },
  // СФО
  'Новосибирск':             { federal: 'СФО', tariffCoef: 0.80 },
  'Барнаул СЦ 2':            { federal: 'СФО', tariffCoef: 0.75 },
  // ДФО
  'Владивосток':             { federal: 'ДФО', tariffCoef: 1.30 },
  // СНГ
  'Алматы Атакент':                       { federal: 'KZ', tariffCoef: 0.80 },
  'Склад Астана Карагандинское шоссе':    { federal: 'KZ', tariffCoef: 0.80 },
  'Актобе':                               { federal: 'KZ', tariffCoef: 0.75 },
  'СК Ереван':                            { federal: 'AM', tariffCoef: 0.90 },
};

/**
 * WB unified tariff zones — warehouse in a paired okrug counts as local
 * for the other half of the pair.
 */
export const OKRUG_ZONES: Record<Okrug, Okrug[]> = {
  'ЦФО':  ['ЦФО'],
  'СЗФО': ['СЗФО'],
  'ЮФО':  ['ЮФО', 'СКФО'],
  'СКФО': ['ЮФО', 'СКФО'],
  'ПФО':  ['ПФО'],
  'УФО':  ['УФО'],
  'СФО':  ['СФО', 'ДФО'],
  'ДФО':  ['СФО', 'ДФО'],
  'KZ':   ['KZ'],
  'AM':   ['AM'],
};

/** All distinct top-level okrug "zones" used in the cluster view. */
export const OKRUG_DISPLAY_ORDER: Okrug[] = ['ЦФО', 'СЗФО', 'ПФО', 'УФО', 'СФО', 'ДФО', 'ЮФО', 'СКФО'];

/** Representative city per okrug — used by the "Скорость" strategy. */
export const OKRUG_DEFAULT_CITY: Record<Okrug, string> = {
  'ЦФО':  'Москва',
  'СЗФО': 'Санкт-Петербург',
  'ЮФО':  'Краснодар',
  'СКФО': 'Ставрополь',
  'ПФО':  'Казань',
  'УФО':  'Екатеринбург',
  'СФО':  'Новосибирск',
  'ДФО':  'Владивосток',
  'KZ':   'Алматы',
  'AM':   'Ереван',
};

/** Region/city → federal district. Empty / unknown → null. */
export const REGION_TO_OKRUG: Record<string, Okrug> = {
  // ЦФО
  'Центральный': 'ЦФО', 'Москва': 'ЦФО', 'Московская': 'ЦФО',
  'Белгородская': 'ЦФО', 'Брянская': 'ЦФО', 'Владимирская': 'ЦФО',
  'Воронежская': 'ЦФО', 'Ивановская': 'ЦФО', 'Калужская': 'ЦФО',
  'Костромская': 'ЦФО', 'Курская': 'ЦФО', 'Липецкая': 'ЦФО',
  'Орловская': 'ЦФО', 'Рязанская': 'ЦФО', 'Смоленская': 'ЦФО',
  'Тамбовская': 'ЦФО', 'Тверская': 'ЦФО', 'Тульская': 'ЦФО',
  'Ярославская': 'ЦФО',
  // СЗФО
  'Северо-Западный': 'СЗФО', 'Санкт-Петербург': 'СЗФО', 'Ленинградская': 'СЗФО',
  'Архангельская': 'СЗФО', 'Вологодская': 'СЗФО', 'Калининградская': 'СЗФО',
  'Мурманская': 'СЗФО', 'Новгородская': 'СЗФО', 'Псковская': 'СЗФО',
  'Карелия': 'СЗФО', 'Коми': 'СЗФО', 'Ненецкий': 'СЗФО',
  // ЮФО
  'Южный': 'ЮФО', 'Краснодарский': 'ЮФО', 'Ростовская': 'ЮФО',
  'Астраханская': 'ЮФО', 'Волгоградская': 'ЮФО', 'Адыгея': 'ЮФО',
  'Калмыкия': 'ЮФО', 'Крым': 'ЮФО', 'Севастополь': 'ЮФО',
  // СКФО
  'Северо-Кавказский': 'СКФО', 'Ставропольский': 'СКФО',
  'Дагестан': 'СКФО', 'Чечня': 'СКФО', 'Ингушетия': 'СКФО',
  'Кабардино-Балкарская': 'СКФО', 'Карачаево-Черкесская': 'СКФО',
  'Северная Осетия': 'СКФО',
  // ПФО
  'Приволжский': 'ПФО', 'Татарстан': 'ПФО', 'Башкортостан': 'ПФО',
  'Нижегородская': 'ПФО', 'Самарская': 'ПФО', 'Саратовская': 'ПФО',
  'Пермский': 'ПФО', 'Оренбургская': 'ПФО', 'Кировская': 'ПФО',
  'Пензенская': 'ПФО', 'Ульяновская': 'ПФО', 'Удмуртская': 'ПФО',
  'Чувашская': 'ПФО', 'Марий Эл': 'ПФО', 'Мордовия': 'ПФО',
  // УФО
  'Уральский': 'УФО', 'Свердловская': 'УФО', 'Челябинская': 'УФО',
  'Тюменская': 'УФО', 'Курганская': 'УФО',
  'Ханты-Мансийский': 'УФО', 'Ямало-Ненецкий': 'УФО',
  // СФО
  'Сибирский': 'СФО', 'Новосибирская': 'СФО', 'Красноярский': 'СФО',
  'Омская': 'СФО', 'Томская': 'СФО', 'Кемеровская': 'СФО',
  'Иркутская': 'СФО', 'Алтайский': 'СФО', 'Алтай': 'СФО',
  'Хакасия': 'СФО', 'Тыва': 'СФО',
  // ДФО
  'Дальневосточный': 'ДФО', 'Приморский': 'ДФО', 'Хабаровский': 'ДФО',
  'Амурская': 'ДФО', 'Сахалинская': 'ДФО', 'Магаданская': 'ДФО',
  'Камчатский': 'ДФО', 'Чукотский': 'ДФО',
  'Саха': 'ДФО', 'Якутия': 'ДФО', 'Забайкальский': 'ДФО', 'Бурятия': 'ДФО',
  // Прямые названия городов
  'Магадан': 'ДФО', 'Владивосток': 'ДФО', 'Хабаровск': 'ДФО', 'Якутск': 'ДФО',
  'Петропавловск-Камчатский': 'ДФО', 'Анадырь': 'ДФО',
  'Мурманск': 'СЗФО', 'Архангельск': 'СЗФО', 'Нарьян-Мар': 'СЗФО', 'Сыктывкар': 'СЗФО',
  'Симферополь': 'ЮФО',
};

/** Find okrug code by region/city name (with substring fallback). */
export function getOkrugForRegion(region: string | null | undefined): Okrug | null {
  if (!region) return null;
  const s = region.trim();
  if (REGION_TO_OKRUG[s]) return REGION_TO_OKRUG[s]!;
  for (const key of Object.keys(REGION_TO_OKRUG)) {
    if (s.includes(key)) return REGION_TO_OKRUG[key]!;
  }
  return null;
}

/** Pick the cheapest warehouse in the given okrug (and its paired zone). */
export function cheapestWarehouseInOkrug(okrug: Okrug): { name: string; tariffCoef: number } | null {
  const zones = OKRUG_ZONES[okrug] ?? [okrug];
  let best: { name: string; tariffCoef: number } | null = null;
  for (const [name, info] of Object.entries(WAREHOUSE_TARIFFS)) {
    if (!zones.includes(info.federal)) continue;
    if (!best || info.tariffCoef < best.tariffCoef) {
      best = { name, tariffCoef: info.tariffCoef };
    }
  }
  return best;
}

/** Pick the "fastest" warehouse for an okrug — for now, by lowest tariff
 *  within the same zone, but treating the largest hub as primary.
 *  TODO: replace with actual CITIES_DATA fastest mapping.
 */
export function fastestWarehouseInOkrug(okrug: Okrug): { name: string; tariffCoef: number } | null {
  // Default to the main hub of each okrug.
  const HUB: Record<Okrug, string> = {
    'ЦФО':  'Коледино',
    'СЗФО': 'Склад СПБ Шушары Московское',
    'ЮФО':  'Краснодар',
    'СКФО': 'Невинномысск',
    'ПФО':  'Казань',
    'УФО':  'Перспективный',
    'СФО':  'Новосибирск',
    'ДФО':  'Владивосток',
    'KZ':   'Алматы Атакент',
    'AM':   'СК Ереван',
  };
  const name = HUB[okrug];
  const info = WAREHOUSE_TARIFFS[name];
  if (!info) return null;
  return { name, tariffCoef: info.tariffCoef };
}

/** List all warehouses inside an okrug (including paired zone). */
export function warehousesInOkrug(okrug: Okrug): { name: string; tariffCoef: number }[] {
  const zones = OKRUG_ZONES[okrug] ?? [okrug];
  return Object.entries(WAREHOUSE_TARIFFS)
    .filter(([, info]) => zones.includes(info.federal))
    .map(([name, info]) => ({ name, tariffCoef: info.tariffCoef }));
}

/* ──────────────────────────────────────────────────────────────────────
 * Robust warehouse → okrug resolution.
 *
 * Reality check (May 2026, live DB): WB warehouse names DON'T match the
 * Postal WAREHOUSE_TARIFFS keys. They come city-based with " WB" / "СЦ "
 * / "СК " noise: "Тула", "Воронеж WB", "Екатеринбург - Перспективная 14",
 * "СЦ Хабаровск". Exact-key lookup silently dropped ~40% of stock, so the
 * deficit table over-counted need.
 *
 * Strategy: normalise the name, then match against a city → okrug map by
 * substring. This is the single source of truth for "which district does
 * this warehouse belong to".
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Pseudo / non-WB-FBO warehouse names that must NOT contribute to okrug
 * stock: aggregate rows ("WB summary", "Остальные") would double-count;
 * seller-own ("склад продавца …") isn't a WB warehouse.
 */
const PSEUDO_WAREHOUSES = ['wb summary', 'остальные', 'склад продавца'];

/**
 * City keyword → okrug. Keys are lowercase substrings checked against the
 * normalised warehouse name. Order matters only where one key is a prefix
 * of another (none currently conflict). Covers every warehouse observed in
 * production plus common WB FBO locations.
 */
const WAREHOUSE_CITY_OKRUG: Array<[string, Okrug]> = [
  // ЦФО
  ['коледино', 'ЦФО'], ['подольск', 'ЦФО'], ['электросталь', 'ЦФО'],
  ['белые столбы', 'ЦФО'], ['белая дача', 'ЦФО'], ['истра', 'ЦФО'],
  ['чашниково', 'ЦФО'], ['внуково', 'ЦФО'], ['вёшки', 'ЦФО'], ['вешки', 'ЦФО'],
  ['радумля', 'ЦФО'], ['пушкино', 'ЦФО'], ['софьино', 'ЦФО'], ['сабурово', 'ЦФО'],
  ['тула', 'ЦФО'], ['алексин', 'ЦФО'], ['рязань', 'ЦФО'], ['владимир', 'ЦФО'],
  ['воронеж', 'ЦФО'], ['котовск', 'ЦФО'], ['тамбов', 'ЦФО'], ['тверь', 'ЦФО'],
  ['эммаусское', 'ЦФО'], ['смоленск', 'ЦФО'], ['курск', 'ЦФО'], ['липецк', 'ЦФО'],
  ['брянск', 'ЦФО'], ['ярославль', 'ЦФО'], ['белгород', 'ЦФО'], ['калуга', 'ЦФО'],
  ['орёл', 'ЦФО'], ['иваново', 'ЦФО'], ['кострома', 'ЦФО'], ['москва', 'ЦФО'],
  // СЗФО
  ['шушары', 'СЗФО'], ['санкт-петербург', 'СЗФО'], ['спб', 'СЗФО'],
  ['уткина заводь', 'СЗФО'], ['обухово', 'СЗФО'], ['псков', 'СЗФО'],
  ['вологда', 'СЗФО'], ['череповец', 'СЗФО'], ['сыктывкар', 'СЗФО'],
  ['мурманск', 'СЗФО'], ['архангельск', 'СЗФО'], ['калининград', 'СЗФО'],
  ['новгород ', 'СЗФО'], ['петрозаводск', 'СЗФО'],
  // ЮФО
  ['краснодар', 'ЮФО'], ['волгоград', 'ЮФО'], ['ростов', 'ЮФО'],
  ['адыгея', 'ЮФО'], ['крым', 'ЮФО'], ['симферополь', 'ЮФО'],
  ['севастополь', 'ЮФО'], ['астрахань', 'ЮФО'], ['крыловская', 'ЮФО'],
  ['тихорецк', 'ЮФО'], ['сальск', 'ЮФО'],
  // СКФО
  ['невинномысск', 'СКФО'], ['пятигорск', 'СКФО'], ['этока', 'СКФО'],
  ['махачкала', 'СКФО'], ['ставрополь', 'СКФО'], ['минеральные воды', 'СКФО'],
  ['нальчик', 'СКФО'], ['грозный', 'СКФО'], ['владикавказ', 'СКФО'],
  // ПФО
  ['казань', 'ПФО'], ['новосемейкино', 'ПФО'], ['самара', 'ПФО'],
  ['сарапул', 'ПФО'], ['ижевск', 'ПФО'], ['пенза', 'ПФО'], ['кузнецк', 'ПФО'],
  ['оренбург', 'ПФО'], ['пермь', 'ПФО'], ['нижний новгород', 'ПФО'],
  ['ларина', 'ПФО'], ['киров', 'ПФО'], ['уфа', 'ПФО'], ['саратов', 'ПФО'],
  ['ульяновск', 'ПФО'], ['чебоксары', 'ПФО'], ['йошкар', 'ПФО'],
  ['саранск', 'ПФО'], ['тольятти', 'ПФО'],
  // УФО
  ['екатеринбург', 'УФО'], ['перспективн', 'УФО'], ['испытателей', 'УФО'],
  ['челябинск', 'УФО'], ['тюмень', 'УФО'], ['сургут', 'УФО'],
  ['нижний тагил', 'УФО'], ['курган', 'УФО'], ['магнитогорск', 'УФО'],
  ['ханты-мансийск', 'УФО'],
  // СФО
  ['новосибирск', 'СФО'], ['омск', 'СФО'], ['барнаул', 'СФО'],
  ['кемерово', 'СФО'], ['новокузнецк', 'СФО'], ['томск', 'СФО'],
  ['красноярск', 'СФО'], ['абакан', 'СФО'], ['иркутск', 'СФО'], ['братск', 'СФО'],
  // ДФО
  ['владивосток', 'ДФО'], ['хабаровск', 'ДФО'], ['артём', 'ДФО'], ['артем', 'ДФО'],
  ['белогорск', 'ДФО'], ['чита', 'ДФО'], ['благовещенск', 'ДФО'],
  ['якутск', 'ДФО'], ['улан-удэ', 'ДФО'],
  // СНГ
  ['атакент', 'KZ'], ['алматы', 'KZ'], ['астана', 'KZ'], ['караганд', 'KZ'],
  ['актобе', 'KZ'], ['шымкент', 'KZ'],
  ['ереван', 'AM'], ['арташисян', 'AM'],
];

/** Strip WB-specific noise from a warehouse name before matching. */
function normaliseWarehouse(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bwb\b/g, '')        // " WB" suffix
    .replace(/\bсц\b/g, '')        // "СЦ " (сортировочный центр)
    .replace(/\bск\b/g, '')        // "СК " (склад)
    .replace(/склад продавца/g, 'склад продавца') // keep, handled as pseudo
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve a WB warehouse name to its okrug. Returns null for pseudo
 * warehouses (aggregate rows, seller-own) and genuinely unknown names.
 */
export function warehouseToOkrug(name: string | null | undefined): Okrug | null {
  if (!name) return null;
  const raw = name.toLowerCase();
  for (const pseudo of PSEUDO_WAREHOUSES) {
    if (raw.includes(pseudo)) return null;
  }
  const norm = normaliseWarehouse(name);
  if (!norm) return null;
  for (const [city, okrug] of WAREHOUSE_CITY_OKRUG) {
    if (norm.includes(city)) return okrug;
  }
  // Last-chance: maybe it matches a tariff-dict key directly.
  const tariff = WAREHOUSE_TARIFFS[name];
  if (tariff) return tariff.federal;
  return null;
}
