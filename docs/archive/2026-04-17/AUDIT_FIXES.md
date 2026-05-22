# Аудит кода — задачи на исправление

> Дата аудита: 2026-04-15 (4 прохода)  
> Статус: требуют исправления  
> Исполнитель: агент (не менять ничего вне описанного ниже)

---

## Содержание

### Блок A — Инфраструктура и конфигурация
1. [КРИТИЧЕСКАЯ — render.yaml: ENCRYPTION_KEY перегенерируется при деплое](#fix-1)
2. [ВЫСОКАЯ — encryption.ts: краш приложения при старте без ENCRYPTION_KEY](#fix-3)
3. [СРЕДНЯЯ — encryption.ts: слабая генерация ключа из UTF-8 строки](#fix-5)
4. [СРЕДНЯЯ — decryptIfNeeded молча глотает ошибки расшифровки](#fix-6)
5. [НИЗКАЯ — render.yaml: NEXT_PUBLIC переменные без документированного значения](#fix-10)

### Блок B — Потеря данных при синхронизации (sync-wb.ts)
6. [КРИТИЧЕСКАЯ — Stocks sync: DELETE без транзакции — потеря данных при ошибке](#fix-11)
7. [КРИТИЧЕСКАЯ — Products + archive: два шага без транзакции](#fix-12)
8. [КРИТИЧЕСКАЯ — Потеря retry event для ads sync](#fix-13)
9. [ВЫСОКАЯ — Race condition scheduled vs manual sync](#fix-14)
10. [СРЕДНЯЯ — Фиксированный delay для ads retry вместо backoff при 429](#fix-15)

### Блок C — Безопасность и race conditions
11. [ВЫСОКАЯ — Race condition при принятии инвайта](#fix-2)
12. [ВЫСОКАЯ — BotService.sendSignal: параметр signal без типа и валидации](#fix-4)
13. [СРЕДНЯЯ — bot/service.ts: `catch (err: any)` без типизации](#fix-8)

### Блок D — База данных и производительность
14. [КРИТИЧЕСКАЯ — Отсутствие индексов на rawApiRealizationReports и rawApiOrders](#fix-16)
15. [ВЫСОКАЯ — Отсутствие индексов на rawApiSales, rawApiPrices, rawApiAdCosts](#fix-17)
16. [СРЕДНЯЯ — DB: отсутствие составных индексов на riskSignals, users, timeline](#fix-9)

### Блок E — Аналитический движок (engine.ts)
17. [ВЫСОКАЯ — Потеря точности float в финансовых расчётах](#fix-18)
18. [ВЫСОКАЯ — Отсутствие NaN/Infinity guard в финансовых метриках](#fix-19)
19. [СРЕДНЯЯ — analytics/engine.ts: множество `any` типов](#fix-7)

### Блок F — Frontend lint и оптимизация
20. [НИЗКАЯ — ESLint warning: `<img>` вместо `next/image`](#fix-20)

---

<a name="fix-1"></a>
## 1. КРИТИЧЕСКАЯ — render.yaml: ENCRYPTION_KEY перегенерируется при деплое

**Файл:** `render.yaml`, строка 24  
**Критичность:** КРИТИЧЕСКАЯ — сломает все зашифрованные WB-токены в продакшене после каждого редеплоя

### Проблема

```yaml
- key: ENCRYPTION_KEY
  generateValue: true   # ← генерирует новый случайный ключ при каждом деплое
```

`generateValue: true` в Render создаёт **новый случайный ключ при каждом деплое**. WB-токены в таблице `tenants.wbApiToken` зашифрованы текущим ключом. После перегенерации ключа `decrypt()` будет бросать исключения для всех уже сохранённых токенов — все tenants потеряют доступ к своим кабинетам WB.

### Что нужно сделать

Изменить `generateValue: true` на `sync: false` (ключ задаётся вручную один раз через Render Dashboard и не меняется при деплоях):

```yaml
# render.yaml, строка 23-25
- key: ENCRYPTION_KEY
  sync: false     # ← установить вручную в Render Dashboard один раз
```

**После правки:** убедиться что в Render Dashboard для этого сервиса уже прописан правильный `ENCRYPTION_KEY`. Если значение ещё не установлено вручную — установить его перед следующим деплоем. Значение должно быть достаточно длинной строкой (минимум 32 символа).

---

<a name="fix-2"></a>
## 2. ВЫСОКАЯ — Race condition при принятии инвайта

**Файл:** `src/app/(dashboard)/cabinets/user-actions.ts`, строки 108–144  
**Критичность:** ВЫСОКАЯ — при одновременных запросах один инвайт может быть принят дважды разными пользователями

### Проблема

Текущая логика `acceptInvitation`:

```typescript
// Шаг 1: читаем инвайт и проверяем статус
const invite = await db.select().from(invitations)
  .where(eq(invitations.token, token)).limit(1);

if (invite[0].status !== 'pending') throw new Error("Приглашение уже использовано");
// ← ОКНО ГОНКИ: между этой проверкой и следующим UPDATE
// два одновременных запроса оба пройдут проверку

// Шаг 2: обновляем статус
await db.update(invitations).set({ status: 'accepted' })
  .where(eq(invitations.id, invite[0].id));
```

Между шагом 1 и шагом 2 нет блокировки на уровне БД. Два одновременных вызова могут оба пройти проверку `status !== 'pending'` и оба выполнить INSERT в `userTenants`.

### Что нужно сделать

Использовать транзакцию с атомарным `UPDATE ... WHERE status = 'pending' RETURNING *` вместо отдельных SELECT + UPDATE:

```typescript
export async function acceptInvitation(token: string) {
  const user = await requireAuthenticatedUser();
  await ensureLocalUserProfile(user.id, user.email ?? null);

  const result = await db.transaction(async (tx) => {
    // Атомарно: берём инвайт и сразу меняем статус — только один поток пройдёт
    const [claimed] = await tx
      .update(invitations)
      .set({ status: 'accepted' })
      .where(
        and(
          eq(invitations.token, token),
          eq(invitations.status, 'pending')
        )
      )
      .returning();

    if (!claimed) {
      // Инвайт не найден, уже использован или не pending
      const [existing] = await tx.select().from(invitations)
        .where(eq(invitations.token, token)).limit(1);

      if (!existing) throw new Error("Приглашение не найдено");
      if (existing.status !== 'pending') throw new Error("Приглашение уже использовано");
      throw new Error("Приглашение недоступно");
    }

    if (new Date() > claimed.expiresAt) {
      // Откатываем — истёкший инвайт возвращаем в pending
      await tx.update(invitations)
        .set({ status: 'pending' })
        .where(eq(invitations.id, claimed.id));
      throw new Error("Срок действия приглашения истек");
    }

    if (!user.email || user.email.toLowerCase() !== claimed.email.toLowerCase()) {
      await tx.update(invitations)
        .set({ status: 'pending' })
        .where(eq(invitations.id, claimed.id));
      throw new AppError("Это приглашение выдано для другого email", 403);
    }

    await tx.insert(userTenants).values({
      userId: user.id,
      tenantId: claimed.tenantId,
      role: claimed.role,
    }).onConflictDoNothing();

    await tx.update(users)
      .set({ tenantId: claimed.tenantId, role: claimed.role, email: user.email ?? claimed.email })
      .where(eq(users.id, user.id));

    return { tenantId: claimed.tenantId };
  });

  revalidatePath('/');
  return { success: true, tenantId: result.tenantId };
}
```

**Ключевое изменение:** `UPDATE ... WHERE status = 'pending' RETURNING *` — если строк не обновлено, значит кто-то другой уже забрал инвайт. Это атомарная операция на уровне PostgreSQL, не требует `SELECT FOR UPDATE`.

---

<a name="fix-3"></a>
## 3. ВЫСОКАЯ — encryption.ts: краш приложения при старте без ENCRYPTION_KEY

**Файл:** `src/lib/encryption.ts`, строки 5–9  
**Критичность:** ВЫСОКАЯ — при отсутствии `ENCRYPTION_KEY` приложение падает при **импорте модуля**, а не при вызове функции

### Проблема

```typescript
// Выполняется при импорте — не в функции!
const keyRaw = process.env.ENCRYPTION_KEY;
if (!keyRaw) {
  throw new Error('Критическая ошибка: Переменная окружения ENCRYPTION_KEY не задана!');
}
const ENCRYPTION_KEY = Buffer.from(keyRaw, 'utf-8').subarray(0, 32);
```

`encryption.ts` импортируется через цепочку `tenants` → `wbApiToken` → практически везде в приложении. Если `ENCRYPTION_KEY` не задана, **весь сервер падает при старте** с неинформативным стек-трейсом на уровне модульного резолвера.

### Что нужно сделать

Перенести проверку и инициализацию ключа внутрь функции-геттера с ленивой инициализацией:

```typescript
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

let _cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (_cachedKey) return _cachedKey;
  const keyRaw = process.env.ENCRYPTION_KEY;
  if (!keyRaw) {
    throw new Error(
      '[encryption] ENCRYPTION_KEY не задана. ' +
      'Установите переменную окружения длиной не менее 32 символов.'
    );
  }
  _cachedKey = Buffer.from(keyRaw, 'utf-8').subarray(0, 32);
  return _cachedKey;
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(hash: string): string {
  const [ivHex, authTagHex, encryptedHex] = hash.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

export function decryptIfNeeded(value: string): string {
  if (!value) return value;
  const parts = value.split(':');
  if (parts.length !== 3) return value;
  try {
    return decrypt(value);
  } catch (err) {
    console.error('[encryption] decryptIfNeeded: расшифровка не удалась, возвращаю исходное значение', err instanceof Error ? err.message : err);
    return value;
  }
}
```

**Изменения:**
1. Ключ инициализируется лениво при первом вызове `getKey()`, а не при импорте
2. `decryptIfNeeded` теперь логирует ошибку (см. также Fix #6)

---

<a name="fix-4"></a>
## 4. ВЫСОКАЯ — BotService.sendSignal: параметр signal без типа и валидации

**Файл:** `src/server/bot/service.ts`, строка 43, и заголовок файла строка 1  
**Критичность:** ВЫСОКАЯ — `signal.title.toUpperCase()` упадёт с `TypeError` если поле отсутствует или равно `null`

### Проблема

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */  // ← отключает защиту TypeScript

static async sendSignal(tenantId: string, signal: any) {
  // ...
  const message =
    `${emoji} *ВНИМАНИЕ: ${signal.title.toUpperCase()}*\n\n`  // ← crash если title=undefined
    + `📦 Артикул: \`${signal.vendorCode}\` (${signal.nmId})\n`
    + `⚠️ *Проблема:* ${signal.description}\n\n`
    + `💡 *Предложение:* ${signal.action}\n\n`
```

### Что нужно сделать

**Шаг 1.** Удалить директиву `/* eslint-disable @typescript-eslint/no-explicit-any */` из строки 1.

**Шаг 2.** Добавить интерфейс для параметра `signal` перед классом `BotService`:

```typescript
interface SignalPayload {
  title: string;
  severity: 'critical' | 'high' | 'medium';
  vendorCode: string;
  nmId: number | string;
  description: string;
  action: string;
}
```

**Шаг 3.** Изменить сигнатуру метода:

```typescript
// было:
static async sendSignal(tenantId: string, signal: any) {

// стало:
static async sendSignal(tenantId: string, signal: SignalPayload) {
```

**Шаг 4.** Заменить все `catch (err: any)` на `catch (err: unknown)` и исправить обращение к `err.message`:

```typescript
// было:
} catch (err: any) {
  console.error("[Bot Service] Failed to send message:", err.message);
}

// стало:
} catch (err: unknown) {
  console.error("[Bot Service] Failed to send message:", err instanceof Error ? err.message : err);
}
```

Аналогично исправить строки 130 и 246 в том же файле.

---

<a name="fix-5"></a>
## 5. СРЕДНЯЯ — encryption.ts: слабая генерация ключа из UTF-8 строки

**Файл:** `src/lib/encryption.ts`, строка 9  
**Критичность:** СРЕДНЯЯ — криптографически ключ слабее чем должен быть

### Проблема

```typescript
const ENCRYPTION_KEY = Buffer.from(keyRaw, 'utf-8').subarray(0, 32);
```

Если `ENCRYPTION_KEY` содержит обычный ASCII-текст (например, `replace-with-32-byte-secret` из `.env.example`), энтропия ключа равна примерно 6 бит на символ вместо 8. Это допустимо в текущей архитектуре, но криптографически неоптимально.

### Что нужно сделать

**Вариант A (минимальное изменение):** Добавить в `.env.example` и документацию требование передавать ключ в hex-формате, и обновить `getKey()`:

```typescript
// В getKey():
// Если ключ выглядит как hex-строка длиной 64 символа — декодируем как hex
if (/^[0-9a-fA-F]{64}$/.test(keyRaw)) {
  _cachedKey = Buffer.from(keyRaw, 'hex');
} else {
  // Обратная совместимость: UTF-8 subarray
  _cachedKey = Buffer.from(keyRaw, 'utf-8').subarray(0, 32);
}
```

**В `.env.example`** обновить комментарий:

```bash
# ENCRYPTION_KEY: рекомендуется hex-строка из 64 символов (32 байта).
# Генерация: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=replace-with-64-char-hex-string
```

> **Важно:** Изменение алгоритма парсинга ключа применять только к **новым** установкам. Существующие production-данные зашифрованы старым ключом — не менять формат для уже работающего инстанса без миграции данных.

---

<a name="fix-6"></a>
## 6. СРЕДНЯЯ — decryptIfNeeded молча глотает ошибки расшифровки

**Файл:** `src/lib/encryption.ts`, строки 35–50  
**Критичность:** СРЕДНЯЯ — повреждённый или неправильно зашифрованный WB-токен будет передан как есть в WB API, вызвав непонятную ошибку далеко от места проблемы

### Проблема

```typescript
export function decryptIfNeeded(value: string): string {
  // ...
  try {
    return decrypt(value);
  } catch {
    return value;  // ← молча возвращает нерасшифрованное значение
  }
}
```

### Что нужно сделать

Добавить логирование ошибки (уже включено в Fix #3 как часть переписанного `decryptIfNeeded`). Убедиться что финальная версия функции выглядит так:

```typescript
export function decryptIfNeeded(value: string): string {
  if (!value) return value;
  const parts = value.split(':');
  if (parts.length !== 3) return value;
  try {
    return decrypt(value);
  } catch (err) {
    console.error(
      '[encryption] decryptIfNeeded: не удалось расшифровать значение, возможно данные повреждены или ключ изменился.',
      err instanceof Error ? err.message : err
    );
    return value;
  }
}
```

---

<a name="fix-7"></a>
## 7. СРЕДНЯЯ — analytics/engine.ts: множество `any` типов

**Файл:** `src/server/analytics/engine.ts`  
**Критичность:** СРЕДНЯЯ — убивает type-safety, потенциальные runtime-ошибки при изменении схемы БД

### Проблема

Найденные вхождения:

| Строка | Код | Риск |
|--------|-----|------|
| 2264 | `} as any;` | Скрывает несоответствие типов |
| 4893 | `tx: any` | Параметр транзакции без типа |
| 6467 | `(economicsRows as any[]).find(...)` | `.nmId` может отсутствовать |
| 6797 | `const signals: any[] = []` | Нет контракта на сигналы |
| 6799 | `for (const row of (data as any[]))` | Любые поля могут быть undefined |
| 6959 | `(members as any[]).map(m => m.nm_id)` | `.nm_id` может отсутствовать |
| 7213 | `const rows = rawData as any[]` | Нет валидации сырых данных |
| 7423–7424 | `(series: any)`, `(entry: any)` | Нет типов для series/entry |

### Что нужно сделать

Для каждого вхождения — добавить минимальный inline-тип или извлечь interface.

**Строка 6467 — пример исправления:**
```typescript
// было:
const economics = (economicsRows as any[]).find((row) => Number(row.nmId) === signal.nmId);

// стало:
interface EconomicsRow { nmId: number | string; [key: string]: unknown }
const economics = (economicsRows as EconomicsRow[]).find((row) => Number(row.nmId) === signal.nmId);
```

**Строка 4893:**
```typescript
import type { PgTransaction } from 'drizzle-orm/pg-core';
// ... или использовать Parameters<typeof db.transaction>[0] extends (tx: infer T) => unknown ? T : never
// Минимальный вариант:
// было:
async function someHelper(tx: any, ...) {
// стало:
async function someHelper(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], ...) {
```

**Строки 6797–6799:**
```typescript
interface RawSignalRow {
  nm_id: number;
  type: string;
  severity: string;
  // добавить остальные поля по факту использования
  [key: string]: unknown;
}
const signals: RawSignalRow[] = [];
for (const row of (data as RawSignalRow[])) {
```

---

<a name="fix-8"></a>
## 8. СРЕДНЯЯ — bot/service.ts: `catch (err: any)` без типизации

**Файл:** `src/server/bot/service.ts`, строки 68, 130, 246  
**Критичность:** СРЕДНЯЯ — маскирует тип ошибки, `err.message` может быть undefined если err — не Error

### Проблема

```typescript
} catch (err: any) {
  console.error("[Bot Service] Failed to send message:", err.message);
  // err.message = undefined если err — строка или объект без поля message
}
```

### Что нужно сделать

Заменить все три вхождения (строки 68, 130, 246):

```typescript
// было:
} catch (err: any) {
  console.error("[Bot Service] Failed to send message:", err.message);
}

// стало:
} catch (err: unknown) {
  console.error("[Bot Service] Failed to send message:", err instanceof Error ? err.message : String(err));
}
```

---

<a name="fix-9"></a>
## 9. СРЕДНЯЯ — DB: отсутствие индекса на tenantId в нескольких таблицах

**Файл:** `src/lib/db/schema.ts`  
**Критичность:** СРЕДНЯЯ — при росте данных запросы без индекса будут делать full sequential scan

### Проблема

Следующие таблицы содержат поле `tenantId` (используется почти в каждом запросе), но не имеют отдельного индекса:

- `riskSignals` — есть `riskTenantIdx`, но он одиночный без покрытия по `status`
- `signalOperatorTimeline` — нет индекса по `(tenantId, createdAt)`
- `users` — нет индекса по `tenantId` (активный тенант)

Все запросы вида `WHERE tenant_id = $1 AND status = $2 ORDER BY created_at` без составного индекса будут работать медленнее по мере роста таблиц.

### Что нужно сделать

В `src/lib/db/schema.ts` добавить составные индексы в определения таблиц:

**Таблица `riskSignals` (строка ~288):**
```typescript
}, (table) => ({
  riskTenantIdx: index('risk_tenant_idx').on(table.tenantId),
  riskNmIdx: index('risk_nm_idx').on(table.nmId),
  riskAssigneeIdx: index('risk_assignee_idx').on(table.tenantId, table.assigneeUserId),
  // Добавить:
  riskTenantStatusCreatedIdx: index('risk_tenant_status_created_idx')
    .on(table.tenantId, table.status, table.createdAt),
  riskTenantWorkflowIdx: index('risk_tenant_workflow_idx')
    .on(table.tenantId, table.workflowState, table.createdAt),
}));
```

**Таблица `signalOperatorTimeline` — найти определение и добавить:**
```typescript
signalTimelineTenantCreatedIdx: index('signal_timeline_tenant_created_idx')
  .on(table.tenantId, table.createdAt),
```

**Таблица `users`:**
```typescript
}, (table) => ({
  // Добавить:
  usersTenantIdx: index('users_tenant_idx').on(table.tenantId),
}));
```

После изменения схемы — запустить:
```bash
npm run db:migrate
```

> **Важно:** Создание индексов на больших таблицах в PostgreSQL блокирует запись. Для продакшена с данными лучше использовать `CREATE INDEX CONCURRENTLY` вручную, а не через Drizzle migrate.

---

<a name="fix-10"></a>
## 10. НИЗКАЯ — render.yaml: NEXT_PUBLIC переменные без документированного значения

**Файл:** `render.yaml`, строки 19–22  
**Критичность:** НИЗКАЯ — риск деплоя без обязательных переменных, приложение запустится но не будет работать auth

### Проблема

```yaml
- key: NEXT_PUBLIC_SUPABASE_URL
  sync: false
- key: NEXT_PUBLIC_SUPABASE_ANON_KEY
  sync: false
```

`sync: false` означает что значение нужно установить вручную в Render Dashboard. Нет никакого напоминания или проверки что они установлены. Если деплой делается на новое окружение и забыли установить — `middleware.ts` выбросит ошибку `Supabase environment variables are not configured.` при **каждом** запросе, но health-check `/api/health` может пройти (он проверяет только `DATABASE_URL`).

### Что нужно сделать

**Вариант 1 (рекомендуется):** Добавить `APP_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` и `NEXT_PUBLIC_SUPABASE_ANON_KEY` в `requiredEnvKeys` в health-check:

**Файл:** `src/app/api/health/route.ts`, строка 8:
```typescript
const requiredEnvKeys = [
  "DATABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "ENCRYPTION_KEY",  // добавить — тоже критично
] as const;
```

**Вариант 2:** Добавить комментарии в `render.yaml` для напоминания оператору:

```yaml
- key: NEXT_PUBLIC_SUPABASE_URL
  sync: false  # REQUIRED: Set manually in Render Dashboard before first deploy
- key: NEXT_PUBLIC_SUPABASE_ANON_KEY
  sync: false  # REQUIRED: Set manually in Render Dashboard before first deploy
```

---

<a name="fix-11"></a>
## 11. КРИТИЧЕСКАЯ — Stocks sync: DELETE без транзакции — потеря данных при ошибке

**Файл:** `src/inngest/sync-wb.ts`, строки 843–900  
**Критичность:** КРИТИЧЕСКАЯ — при ошибке во время INSERT все stocks уже удалены и не восстановятся

### Проблема

```typescript
// Строка 849: удаляем ВСЁ
await db.delete(rawApiStocks).where(eq(rawApiStocks.tenantId, tenantId));

// ...агрегация данных...

// Строка 887-898: вставляем по чанкам
for (const chunk of chunkArray(dedupedStocks, 500)) {
  batches += 1;
  await db.insert(rawApiStocks).values(chunk).onConflictDoUpdate({...});
}
// ↑ Если ошибка на 3-м чанке из 10 → данные потеряны навсегда
```

DELETE выполняется ДО INSERT, но они не обёрнуты в одну транзакцию. Если INSERT любого чанка упадёт (timeout, deadlock, дисковое пространство), все stocks удалены, а новые вставлены лишь частично.

### Что нужно сделать

Обернуть DELETE + INSERT в одну транзакцию:

```typescript
await db.transaction(async (tx) => {
  await tx.delete(rawApiStocks).where(eq(rawApiStocks.tenantId, tenantId));

  let batches = 0;
  for (const chunk of chunkArray(dedupedStocks, 500)) {
    batches += 1;
    await tx.insert(rawApiStocks).values(chunk).onConflictDoUpdate({
      target: [rawApiStocks.tenantId, rawApiStocks.nmId, rawApiStocks.warehouseName],
      set: {
        amount: sql`EXCLUDED.amount`,
        inWayToClient: sql`EXCLUDED.in_way_to_client`,
        inWayFromClient: sql`EXCLUDED.in_way_from_client`,
        date: sql`EXCLUDED.date`,
      },
    });
  }

  return { records: dedupedStocks.length, batches };
});
```

---

<a name="fix-12"></a>
## 12. КРИТИЧЕСКАЯ — Products + archive: два шага без транзакции

**Файл:** `src/inngest/sync-wb.ts`, строки 601–621  
**Критичность:** КРИТИЧЕСКАЯ — если archive UPDATE упадёт, новые продукты вставлены но старые не архивированы

### Проблема

```typescript
// Шаг 1: Insert/update products
await db.insert(products).values(inserts).onConflictDoUpdate({...});

// Шаг 2: Архивируем все остальные продукты
await db.execute(sql`
  UPDATE products
  SET is_archived = CASE WHEN nm_id IN (${nmIdList}) THEN FALSE ELSE TRUE END
  WHERE tenant_id = ${tenantId}
`);
// ↑ Если этот запрос упадёт — новые продукты есть, но старые не помечены как архив
```

### Что нужно сделать

Обернуть оба шага в одну транзакцию:

```typescript
await db.transaction(async (tx) => {
  for (const chunk of chunkArray(inserts, 500)) {
    await tx.insert(products).values(chunk).onConflictDoUpdate({...});
  }

  const nmIdList = sql.join(activeNmIds.map(id => sql`${id}`), sql`, `);
  await tx.execute(sql`
    UPDATE products
    SET is_archived = CASE WHEN nm_id IN (${nmIdList}) THEN FALSE ELSE TRUE END
    WHERE tenant_id = ${tenantId}
  `);
});
```

---

<a name="fix-13"></a>
## 13. КРИТИЧЕСКАЯ — Потеря retry event для ads sync

**Файл:** `src/inngest/sync-wb.ts`, строки 1334–1357  
**Критичность:** КРИТИЧЕСКАЯ — ошибка при отправке retry event молча проглатывается, данные рекламы не будут досинхронизированы

### Проблема

```typescript
try {
  await step.run(`schedule-ads-retry-${nextAdsRetryAttempt}`, async () => {
    await inngest.send({
      name: ADS_RETRY_EVENT_NAME,
      data: { tenantId, from, to, attempt, requestedSources, parentSyncRunId },
    });
  });
} catch (error) {
  console.error("[Sync] Failed to schedule delayed Ads retry", { ... });
  // ← ОШИБКА: retry потерян навсегда, нет re-throw, нет альтернативного пути
}
```

Если `inngest.send()` упадёт (сетевая ошибка, Inngest недоступен), retry event будет потерян. Нет ни re-throw, ни fallback механизма.

### Что нужно сделать

**Вариант A (рекомендуется):** Убрать try-catch и дать ошибке всплыть — Inngest сам повторит весь step:

```typescript
// Убрать try-catch: пусть step.run обработает ошибку через стандартный Inngest retry
await step.run(`schedule-ads-retry-${nextAdsRetryAttempt}`, async () => {
  await inngest.send({
    name: ADS_RETRY_EVENT_NAME,
    data: { tenantId, from, to, attempt: nextAdsRetryAttempt, requestedSources: adsRetrySources, parentSyncRunId: adsRetryParentSyncRunId },
  });
});
```

**Вариант B (если нужно не блокировать основной sync):** Записать факт неудачного retry в summary для ручной обработки:

```typescript
try {
  await step.run(`schedule-ads-retry-${nextAdsRetryAttempt}`, async () => {
    await inngest.send({ ... });
  });
} catch (error) {
  console.error("[Sync] Failed to schedule delayed Ads retry", { tenantId, error });
  // Записать в summary как pending action
  sourceResults.push({
    source: 'ads_retry_scheduling',
    status: 'failed',
    meta: { reason: 'retry_event_lost', attempt: nextAdsRetryAttempt, error: serializeError(error) },
  });
}
```

---

<a name="fix-14"></a>
## 14. ВЫСОКАЯ — Race condition scheduled vs manual sync

**Файл:** `src/server/jobs/wb-scheduled-sync.ts`, строки 106–140  
**Критичность:** ВЫСОКАЯ — два sync могут запуститься одновременно для одного tenant

### Проблема

Проверка «есть ли активный sync run» и создание нового run — два отдельных шага (Inngest steps), между которыми есть временное окно:

```typescript
// Step 1: проверяем
const [activeRun] = await step.run(`check-active-${tenant.id}`, async () => {
  return db.select().from(syncRuns).where(
    and(eq(syncRuns.tenantId, tenant.id), eq(syncRuns.status, 'pending'))
  ).limit(1);
});
if (activeRun?.id) { skippedBusy += 1; continue; }

// ← ОКНО ГОНКИ: manual sync может создать run в этот момент

// Step 2: создаём
const [syncRun] = await step.run(`create-sync-run-${tenant.id}`, async () => {
  return db.insert(syncRuns).values({...}).returning();
});
```

### Что нужно сделать

Объединить проверку и создание в один атомарный SQL-запрос (INSERT IF NOT EXISTS):

```typescript
await step.run(`create-sync-run-${tenant.id}`, async () => {
  // Атомарно: вставить новый run ТОЛЬКО если нет active pending/running
  const [created] = await db.execute(sql`
    INSERT INTO sync_runs (tenant_id, trigger_source, status, date_from, date_to, requested_at)
    SELECT ${tenant.id}, 'scheduled', 'pending', ${dateFrom}, ${dateTo}, NOW()
    WHERE NOT EXISTS (
      SELECT 1 FROM sync_runs
      WHERE tenant_id = ${tenant.id}
        AND status IN ('pending', 'running')
        AND requested_at > NOW() - INTERVAL '${sql.raw(String(lockMinutes))} minutes'
    )
    RETURNING id
  `);

  if (!created) {
    skippedBusy += 1;
    return null;
  }

  return created;
});
```

---

<a name="fix-15"></a>
## 15. СРЕДНЯЯ — Фиксированный delay для ads retry вместо backoff при 429

**Файл:** `src/server/jobs/wb-ads-retry.ts` (логика delay)  
**Критичность:** СРЕДНЯЯ — при rate limiting от WB, все retry идут с одинаковыми интервалами

### Проблема

Задержка между retry фиксированная и не учитывает причину ошибки:

```typescript
const getRetryDelayMinutes = (attempt: number) => (
  attempt <= 1 ? ADS_RETRY_FIRST_DELAY_MINUTES : ADS_RETRY_NEXT_DELAY_MINUTES
);
```

Если WB вернул 429, следующий retry через фиксированные N минут может снова получить 429.

### Что нужно сделать

Добавить экспоненциальный backoff с учётом причины ошибки:

```typescript
const getRetryDelayMinutes = (attempt: number, lastErrorCode?: number) => {
  const baseDelay = attempt <= 1 ? ADS_RETRY_FIRST_DELAY_MINUTES : ADS_RETRY_NEXT_DELAY_MINUTES;
  // При 429 удваиваем delay
  const rateLimitMultiplier = lastErrorCode === 429 ? Math.pow(2, attempt - 1) : 1;
  return Math.min(baseDelay * rateLimitMultiplier, 120); // max 2 часа
};
```

---

<a name="fix-16"></a>
## 16. КРИТИЧЕСКАЯ — Отсутствие индексов на rawApiRealizationReports и rawApiOrders

**Файл:** `src/lib/db/schema.ts`, строки 514–549  
**Критичность:** КРИТИЧЕСКАЯ — эти таблицы участвуют в КАЖДОМ запросе аналитики через LATERAL JOIN в engine.ts, full scan на каждый запрос

### Проблема

`rawApiRealizationReports` (строки 514–539) — **ноль индексов** кроме PK по `rrdId`.  
`rawApiOrders` (строки 541–549) — **ноль индексов** кроме PK по `srid`.

Эти таблицы содержат исторические данные и растут постоянно. Каждый аналитический запрос в engine.ts использует `WHERE tenant_id = $1 AND date >= $2 AND date <= $3` — без индексов это full sequential scan.

В `engine.ts` (строки ~7194–7251) есть LATERAL JOIN, который для **каждой строки** основного запроса делает подзапрос в эти таблицы — без индексов это O(N*M) на каждый dashboard-запрос.

### Что нужно сделать

Добавить индексы в `src/lib/db/schema.ts`:

**rawApiRealizationReports (строка 539, перед закрывающей скобкой):**
```typescript
export const rawApiRealizationReports = pgTable('raw_api_realization_reports', {
  // ...существующие поля...
}, (table) => ({
  realizationTenantDateIdx: index('realization_tenant_date_idx')
    .on(table.tenantId, table.dateFrom, table.dateTo),
  realizationTenantNmDateIdx: index('realization_tenant_nm_date_idx')
    .on(table.tenantId, table.nmId, table.dateFrom),
}));
```

**rawApiOrders (строка 549, перед закрывающей скобкой):**
```typescript
export const rawApiOrders = pgTable('raw_api_orders', {
  // ...существующие поля...
}, (table) => ({
  ordersTenantDateIdx: index('orders_tenant_date_idx')
    .on(table.tenantId, table.date),
  ordersTenantNmDateIdx: index('orders_tenant_nm_date_idx')
    .on(table.tenantId, table.nmId, table.date),
}));
```

---

<a name="fix-17"></a>
## 17. ВЫСОКАЯ — Отсутствие индексов на rawApiSales, rawApiPrices, rawApiAdCosts для date range

**Файл:** `src/lib/db/schema.ts`  
**Критичность:** ВЫСОКАЯ — используются в аналитических JOIN с фильтрацией по дате

### Проблема

- `rawApiSales` (~строка 877) — есть uniqueIndex по `(tenantId, nmId, saleId)`, но нет индекса для `WHERE tenantId = $1 AND date >= $2`
- `rawApiPrices` (~строка 891) — вообще нет индексов
- `rawApiAdCosts` (строка 562) — есть uniqueIndex по `(tenantId, nmId, date, placement)`, но нет простого индекса для диапазона `WHERE tenantId = $1 AND date BETWEEN $2 AND $3`

### Что нужно сделать

Добавить индексы:

**rawApiSales:**
```typescript
salesTenantDateIdx: index('sales_tenant_date_idx')
  .on(table.tenantId, table.date),
```

**rawApiPrices:**
```typescript
pricesTenantNmIdx: uniqueIndex('prices_tenant_nm_idx')
  .on(table.tenantId, table.nmId),
```

**rawApiAdCosts (добавить к существующим):**
```typescript
adCostsTenantDateIdx: index('ad_costs_tenant_date_idx')
  .on(table.tenantId, table.date),
```

После всех изменений в schema.ts запустить:
```bash
npm run db:migrate
```

---

<a name="fix-18"></a>
## 18. ВЫСОКАЯ — Потеря точности float в финансовых расчётах engine.ts

**Файл:** `src/server/analytics/engine.ts`, строки 7438–7460, 7486–7507  
**Критичность:** ВЫСОКАЯ — финансовые метрики (DRR, прибыль, маржа) могут быть неточны

### Проблема

Все денежные значения из БД парсятся через `parseFloat()`:

```typescript
const rRevenue = parseFloat(r.revenue || '0');       // строка 7439
const rSoldQty = parseFloat(r.soldQty || '0');       // строка 7440
const rFinanceRevenue = parseFloat(r.financeRevenue || '0'); // строка 7441
const rAdSpend = parseFloat(r.adSpend || '0');       // строка 7458
```

Затем происходит цепочка арифметики (деление, умножение, вычитание) и округление:

```typescript
soldQty: Math.round(rSoldQty * 100) / 100,  // строка 7487
```

Проблемы:
1. `parseFloat()` теряет точность для больших чисел (> 2^53)
2. Цепочка float-операций накапливает ошибки округления
3. `Math.round(0.005 * 100) = 0` (а не 1) из-за IEEE 754
4. В group-level агрегации (строки 7511–7547) суммы неокруглённых float тоже накапливают ошибку

### Что нужно сделать

**Минимальное исправление (без внешних зависимостей):** Заменить `Math.round(x * 100) / 100` на более точную функцию:

```typescript
// Добавить хелпер в начало файла или в lib/utils.ts:
function roundFinancial(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
```

Заменить все вхождения паттерна `Math.round(x * 100) / 100` на `roundFinancial(x)`.

---

<a name="fix-19"></a>
## 19. ВЫСОКАЯ — Отсутствие NaN/Infinity guard в финансовых метриках

**Файл:** `src/server/analytics/engine.ts`, строки 7460–7507  
**Критичность:** ВЫСОКАЯ — деление на ноль или NaN из предыдущих вычислений попадёт в JSON ответ API

### Проблема

```typescript
// строки 7465-7472: деление может вернуть Infinity или NaN
const rFunnelAvgPrice = rExactFunnelAvgPrice
  ?? (rFunnelBuyoutQty !== null && rFunnelBuyoutRevenue !== null && rFunnelBuyoutQty > 0
    ? rFunnelBuyoutRevenue / rFunnelBuyoutQty  // ← может быть Infinity если qty = 0.00001
    : null);

// строка 7474: может стать NaN если любой аргумент NaN
const profitBeforeTax = rOpProfit - rCostTotal - rAdSpend;
```

`JSON.stringify(NaN)` = `null`, `JSON.stringify(Infinity)` = `null` — фронтенд получит null вместо числа, без понимания причины.

### Что нужно сделать

Добавить guard-хелпер и использовать после каждого деления:

```typescript
function safeNumber(value: number, fallback: number = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

// Пример использования:
const rFunnelAvgPrice = rExactFunnelAvgPrice
  ?? (rFunnelBuyoutQty !== null && rFunnelBuyoutRevenue !== null && rFunnelBuyoutQty > 0
    ? safeNumber(rFunnelBuyoutRevenue / rFunnelBuyoutQty)
    : null);

const profitBeforeTax = safeNumber(rOpProfit - rCostTotal - rAdSpend);
```

---

## Порядок выполнения

### Фаза 0 — До следующего деплоя (блокеры)
| # | Fix | Файл | Что |
|---|-----|------|-----|
| 1 | [#1](#fix-1) | render.yaml | ENCRYPTION_KEY → `sync: false` |

### Фаза 1 — До выхода в прод (потеря данных)
| # | Fix | Файл | Что |
|---|-----|------|-----|
| 2 | [#11](#fix-11) | sync-wb.ts:843 | Stocks: обернуть DELETE+INSERT в транзакцию |
| 3 | [#12](#fix-12) | sync-wb.ts:601 | Products: обернуть insert+archive в транзакцию |
| 4 | [#13](#fix-13) | sync-wb.ts:1334 | Ads retry: убрать catch или записать в summary |
| 5 | [#2](#fix-2) | user-actions.ts:108 | acceptInvitation: атомарный UPDATE+RETURNING |
| 6 | [#3](#fix-3) | encryption.ts:5 | Ленивая инициализация ключа |
| 7 | [#6](#fix-6) | encryption.ts:35 | decryptIfNeeded: добавить логирование |

### Фаза 2 — До production scale (индексы и точность)
| # | Fix | Файл | Что |
|---|-----|------|-----|
| 8 | [#16](#fix-16) | schema.ts:514,541 | Индексы на realization_reports и orders |
| 9 | [#17](#fix-17) | schema.ts:877,891,562 | Индексы на sales, prices, ad_costs |
| 10 | [#9](#fix-9) | schema.ts:288,294 | Индексы на riskSignals, timeline, users |
| 11 | [#18](#fix-18) | engine.ts:7438 | roundFinancial() вместо Math.round hack |
| 12 | [#19](#fix-19) | engine.ts:7460 | safeNumber() guard для деления |

### Фаза 3 — Текущий спринт (типизация и cleanup)
| # | Fix | Файл | Что |
|---|-----|------|-----|
| 13 | [#4](#fix-4) | bot/service.ts:1,43 | SignalPayload interface, убрать eslint-disable |
| 14 | [#8](#fix-8) | bot/service.ts:68,130,246 | catch (err: unknown) |
| 15 | [#7](#fix-7) | engine.ts | Убрать все `as any` (8 мест) |
| 16 | [#14](#fix-14) | wb-scheduled-sync.ts:106 | INSERT IF NOT EXISTS для scheduled sync |
| 17 | [#15](#fix-15) | wb-ads-retry.ts | Exponential backoff при 429 |
| 18 | [#5](#fix-5) | encryption.ts:9 | Hex-ключ (только для новых установок) |
| 19 | [#10](#fix-10) | render.yaml + health/route.ts | ENCRYPTION_KEY в health-check |
| 20 | [#20](#fix-20) | ProductSalesHighlights.tsx:33 | заменить `<img>` на `next/image` |

---

## Сводка по критичности

| Критичность | Кол-во | Основные риски |
|------------|--------|---------------|
| **КРИТИЧЕСКАЯ** | 5 | Потеря WB-токенов, потеря stocks/products, потеря ads retry, отсутствие индексов |
| **ВЫСОКАЯ** | 7 | Race conditions, потеря точности финансов, NaN в метриках, отсутствие индексов |
| **СРЕДНЯЯ** | 5 | Типизация, backoff, логирование ошибок |
| **НИЗКАЯ** | 3 | Документация render.yaml, health-check, frontend image optimization warning |

---

## Что проверено и НЕ требует изменений

- **Все 36 API-роутов** в `src/app/api/views/*` — каждый вызывает `requireTenantAccessFromRequest` перед возвратом данных
- **Middleware** (`src/lib/supabase/middleware.ts`) — корректная защита UI-роутов и редиректы на login
- **WB API client** (`src/lib/wb-api/client.ts`) — правильный exponential backoff, RETRYABLE_STATUS_CODES, обрезка ошибок до 500 символов
- **Auth helper** (`src/lib/auth/tenant-access.ts`) — корректная проверка ролей, membership validation
- **SQL-запросы** — параметризованные через drizzle, SQL-injection невозможен
- **React-компоненты** — useEffect deps корректны, event listeners убираются в cleanup, нет dangerouslySetInnerHTML (XSS-safe)
- **Zustand store** — не содержит sensitive данных, только tenantId/role/dateRange
- **Inngest function structure** — корректная обработка ошибок на верхнем уровне (финализация syncRun в catch)
- **Funnel sync** (строки 738–841) — единственный source уже обёрнутый в транзакцию (ОК)

---

## Обновление аудита: проход 3 (2026-04-15)

### Что перепроверено

- `npm run lint`
- `npm run test`
- `npm run build`
- `npm run smoke:operator:runtime`

### Новый найденный дефект

<a name="fix-20"></a>
## 20. НИЗКАЯ — ESLint warning: `<img>` вместо `next/image`

**Файл:** `src/components/dashboard/ProductSalesHighlights.tsx`, строка 33  
**Критичность:** НИЗКАЯ — не ломает функционал, но ухудшает LCP/оптимизацию изображений и держит lint в warning-состоянии

### Проблема

```tsx
<img src={imageSrc} alt={name} className="h-full w-full object-cover" loading="lazy" />
```

ESLint (`@next/next/no-img-element`) сообщает, что для Next.js нужно использовать `Image` из `next/image`.

### Что нужно сделать

1. Использовать один из вариантов:
   - `next/image` с корректным `width/height` (или `fill`) и настройкой `remotePatterns`;
   - локальный `eslint-disable-next-line @next/next/no-img-element` для контролируемого `<img>` (если это осознанное решение для WB image URL).
2. Повторно запустить `npm run lint` и добиться `0 warnings`.

### Статус по ранее зафиксированным пунктам (на 2026-04-15)

**Подтверждённо закрыто в коде:**

- #3, #6
- #11, #12, #13
- #14, #15
- #16, #17
- #18, #19

**Остаётся в работе / не закрыто полностью:**

- #1 (render.yaml: `ENCRYPTION_KEY` → `sync: false`)
- #2 (race condition в `acceptInvitation`)
- #4 и #8 (типизация `bot/service.ts`)
- #5 (hex-режим ключа для новых установок)
- #7 (в `engine.ts` остаются `any`, включая `eslint-disable`)
- #10 (документирование/проверка env в health-check)

### Приоритет на следующий проход

1. Закрыть #1 и #2 перед следующим прод-деплоем.
2. Закрыть #7 (убрать `any` из `engine.ts`) как основной остаточный техдолг.
3. Закрыть #4, #8, #10 и #20 в одном cleanup-проходе.

### Валидация замечаний другого агента (2026-04-15)

**Подтверждено:**

- Есть `lint` warning по `<img>` в `src/components/dashboard/ProductSalesHighlights.tsx` (это уже зафиксировано как #20).
- `drizzle-kit generate` на текущем состоянии даёт `No schema changes, nothing to migrate`.
- `acceptInvitation` действительно содержит SQL-проверку email и `pending`-статуса перед принятием инвайта.
- API-роуты в `src/app/api/views/*` используют `requireTenantAccessFromRequest`.

**Не подтвердилось / устарело:**

- Замечание про `TS1117` в `src/lib/signal-queue-utils.test.ts` не воспроизвелось: в `makeSignal` сейчас только одно поле `aging`, дубля ключа нет.
- Замечание, что `PROJECT_PASSPORT.md` "устарел по безопасности/schema drift", неактуально:
  - в документе уже отмечены `7.1 Безопасность и изоляция (РЕШЕНО)` и `7.3 Schema drift (РЕШЕНО)`;
  - `Phase 1` и `Phase 3` уже помечены как `ВЫПОЛНЕНО`.

**Уточнение по middleware/API:**

- В `src/proxy.ts` matcher по-прежнему исключает `/api` глобально (это сделано осознанно для публичных/системных endpoint-ов типа Inngest/бота).
- Безопасность tenant-доступа обеспечивается не глобальным proxy-мидлваром для `/api`, а пер-роут проверками `requireTenantAccessFromRequest`.

---

## Обновление аудита: проход 4 (2026-04-15)

### Выполнено по замечаниям всех агентов

- `#5` (`src/lib/encryption.ts`): добавлена поддержка 64-символьного hex-ключа (`hex:`/plain hex), сохранена backward compatibility для legacy UTF-8 ключа.
- `#7` (`src/server/analytics/engine.ts`): полностью убраны `any`, введены явные типы и безопасный numeric-parser.
- `#20` (`src/components/dashboard/ProductSalesHighlights.tsx`): закрыт lint warning (`@next/next/no-img-element`) через локальный `eslint-disable-next-line` для WB image URL.
- Подтверждено в коде как выполненное и рабочее: `#1`, `#2`, `#4`, `#8`, `#10`, `#11`, `#12`, `#13`, `#14`, `#15`, `#16`, `#17`, `#18`, `#19`.

### Итоговые проверки

- `npm run lint` — OK (0 warnings)
- `npm run test` — OK (29/29)
- `npm run build` — OK
- `npm run smoke:operator:runtime` — OK

---

## Обновление аудита: проход 5 (2026-04-15)

### Разбор дополнительного чеклиста стабильности (1–2 дня)

| # | Пункт | Статус | Комментарий |
|---|---|---|---|
| 1 | Единый pre-deploy gate (`lint+test+build+db-check+smoke`) | ЧАСТИЧНО | `scripts/release-baseline.mjs` уже проверяет `drizzle check + build + lint + test`, но smoke пока вынесен в manual/human check. |
| 2 | Telegram-алерты: `health!=ok`, падение systemd, sync error per source | ЧАСТИЧНО | Telegram-уведомления в проекте есть, но системные алерты для `health/systemd` и унифицированный alert по source-failures sync не заведены как единый контур. |
| 3 | Централизованные retry WB API (timeout/backoff+jitter/max-attempts/endpoint limits) | ЧАСТИЧНО/БЛИЗКО К ГОТОВО | Централизованный retry-клиент уже есть в `src/lib/wb-api/client.ts`; per-endpoint таймауты/лимиты частично есть в WB-слое, но не сведены в единый policy-манифест. |
| 4 | Идемпотентность sync (unique keys/upsert) | ВЫПОЛНЕНО | Основные sync-ветки используют `onConflictDoUpdate/DoNothing` + уникальные индексы для raw таблиц. |
| 5 | Dead-letter queue + ручной retry | НЕ ВЫПОЛНЕНО | Выделенного DLQ-контура в коде нет. |
| 6 | Ночные бэкапы БД (`pg_dump`) + хранение 7 дней + test restore | НЕ ВЫПОЛНЕНО | Есть pre-deploy backup-практика, но нет регулярного nightly backup + автоматизированного restore-check. |
| 7 | Жёсткий post-deploy check (`SHA parity`, `systemctl`, `/api/health`, UI smoke) | ЧАСТИЧНО | SHA/systemctl/health задокументированы в server runbook, но нет одного исполняемого скрипта с fail-fast. |
| 8 | Ротация логов + 3 метрики (sync duration, source error %, data lag) | ЧАСТИЧНО | Runtime-состояние sync и freshness в продукте есть, но отдельного ops-dashboard с этими 3 KPI и формализованной log-rotation политикой нет. |

### Приоритет внедрения на 1–2 дня

1. **Gate + post-deploy hard-check**: объединить в два скрипта (`predeploy` и `postdeploy`) с `exit 1` при любом сбое.
2. **Алерты в Telegram**: health/systemd/sync-source-errors в одном watcher-джобе на сервере.
3. **Nightly backup + restore test**: `pg_dump` по расписанию + retention `>=7` + nightly/weekly restore-проба в test DB.
4. **DLQ + manual retry**: отдельная таблица failed-jobs/failures и CLI-скрипт `retry` по `id`.
5. **Ops-metrics + log rotation**: добавить дашборд/endpoint с 3 KPI и зафиксировать ротацию логов (journald/logrotate policy).

---

## Обновление аудита: проход 6 (2026-04-15)

### Реализовано по чеклисту стабильности

- Добавлен единый строгий pre-deploy gate: `npm run predeploy:gate` (`release-baseline + smoke:operator:runtime`).
- Добавлен жесткий post-deploy check: `npm run postdeploy:goal-bot` (SHA parity, `systemctl is-active`, internal/external `/api/health`, UI smoke login-flow).
- Добавлен watchdog для Telegram-алертов: `npm run ops:watchdog` (health, падение `systemd`, новые ошибки sync по источникам из `sync_runs.summary.sources`).
- Добавлен nightly backup-контур: `npm run db:backup:nightly` (`pg_dump` -> `.sql.gz`, retention, restore-test в отдельную БД + sanity checks).
- Обновлены `.env.example` и deployment/runbook-документы под новый ops-контур.

### Статус после внедрения

| # | Пункт | Статус |
|---|---|---|
| 1 | Единый pre-deploy gate | ВЫПОЛНЕНО |
| 2 | Telegram-алерты health/systemd/sync-source | ВЫПОЛНЕНО |
| 3 | Централизованные retry WB API | ЧАСТИЧНО/БЛИЗКО К ГОТОВО (без изменений в этом проходе) |
| 4 | Идемпотентность sync | ВЫПОЛНЕНО |
| 5 | Dead-letter queue + manual retry | НЕ ВЫПОЛНЕНО |
| 6 | Nightly backup + restore-test | ВЫПОЛНЕНО |
| 7 | Жесткий post-deploy check | ВЫПОЛНЕНО |
| 8 | Ротация логов + 3 ops-метрики | ЧАСТИЧНО (доконтурить отдельным проходом) |
