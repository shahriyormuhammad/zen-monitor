# Load Testing

Практический контур проверки нагрузки для `enterprise-wb-analytics`.

## Цель

Понять реальный потолок сервера по read-only пользовательскому трафику:

- сколько одновременных операторов держит приложение;
- где начинается деградация: Next.js, Postgres, Supabase Auth, nginx;
- когда масштабировать сервер или менять архитектуру.

Не включать в базовый load test:

- ручной WB sync;
- WB LK / Playwright RPA;
- Telegram webhook spam;
- массовое создание аккаунтов.

Иначе тест измерит внешние лимиты Wildberries/Supabase/Auth, а не устойчивость нашего приложения.

## Подготовка

Нужен отдельный существующий smoke/load аккаунт с кабинетом:

```bash
export LOAD_BASE_URL='https://xn----ptbqdfd1ao2c.xn--p1ai'
export LOAD_EMAIL='load-user@example.com'
export LOAD_PASSWORD='replace-me'
```

Для локального теста:

```bash
export LOAD_BASE_URL='http://localhost:3000'
```

## Мониторинг сервера

Запустить в отдельном терминале до нагрузки:

```bash
LOAD_WATCH_DURATION_SECONDS=600 \
LOAD_WATCH_INTERVAL_SECONDS=5 \
npm run load:watch
```

Скрипт пишет CSV в `output/load/server-watch-*.csv` и печатает:

- load average;
- CPU used;
- RAM;
- `/api/health` status/time;
- Postgres connections/active/idle;
- RSS Next.js процесса.

## HTTP API Load

Базовый безопасный прогон:

```bash
LOAD_CONCURRENCY=10 \
LOAD_DURATION_SECONDS=120 \
LOAD_RAMP_SECONDS=20 \
npm run load:http
```

Ступени:

```bash
LOAD_CONCURRENCY=25  LOAD_DURATION_SECONDS=300 LOAD_RAMP_SECONDS=30 npm run load:http
LOAD_CONCURRENCY=50  LOAD_DURATION_SECONDS=300 LOAD_RAMP_SECONDS=45 npm run load:http
LOAD_CONCURRENCY=100 LOAD_DURATION_SECONDS=300 LOAD_RAMP_SECONDS=60 npm run load:http
LOAD_CONCURRENCY=200 LOAD_DURATION_SECONDS=300 LOAD_RAMP_SECONDS=90 npm run load:http
```

По умолчанию дергаются:

- `/api/views/dashboard`
- `/api/views/economics`
- `/api/views/stocks-v2`
- `/api/views/advertising`
- `/api/views/dashboard/signals`
- `/api/views/explorer?type=orders`

Можно сузить:

```bash
LOAD_TARGETS=dashboard,economics npm run load:http
```

или добавить путь вручную:

```bash
LOAD_TARGETS='dashboard,/api/views/products/options' npm run load:http
```

## Browser Load

Проверяет реальный браузерный UX через Playwright:

```bash
BROWSER_LOAD_USERS=10 \
BROWSER_LOAD_DURATION_SECONDS=180 \
BROWSER_LOAD_RAMP_SECONDS=30 \
npm run load:browser
```

Ступени:

```bash
BROWSER_LOAD_USERS=10 BROWSER_LOAD_DURATION_SECONDS=180 npm run load:browser
BROWSER_LOAD_USERS=25 BROWSER_LOAD_DURATION_SECONDS=180 npm run load:browser
```

100 браузеров запускать можно только с отдельной мощной машины. Для оценки серверного потолка основной инструмент — `load:http`.

## Tab Waterfall

Точечный аудит вкладок: что подтягивается при открытии страницы, какие API/чанки/картинки самые медленные, есть ли 4xx/5xx или уход на `/login`.

```bash
LOAD_BASE_URL='http://localhost:3000' \
LOAD_STORAGE_STATE='output/auth.json' \
npm run load:tabs
```

По умолчанию проверяются:

- `/overview`
- `/economics-v2`
- `/stocks-v2`
- `/advertising`
- `/settings`

Можно сузить набор:

```bash
TAB_WATERFALL_ROUTES='/overview,/advertising' npm run load:tabs
```

Отчет сохраняется в `output/load/tab-waterfall-*.json`. Смотри по каждой вкладке:

- `summary.byKind.api` — сколько API-запросов и их длительность;
- `summary.byKind.server-action` / `summary.byKind.rsc` — сколько Next server actions/RSC-запросов ушло помимо API;
- `summary.api` — самые медленные API;
- `summary.byKind.next-static` — сколько JS/CSS чанков догружается;
- `summary.failedOrBad` — ошибки, 4xx/5xx, незагруженные ресурсы.

## Критерии остановки

Остановить прогон и разбирать узкое место, если:

- `p95` API > `2000 ms`;
- browser `p95` > `8000 ms`;
- 5xx > `1%`;
- общие ошибки > `5%`;
- CPU держится выше `80%`;
- Postgres active connections близко к лимиту;
- в логах есть `statement timeout`, `ECONNRESET`, `upstream timed out`, `502/504`.

## Где лежат отчеты

```text
output/load/http-load-*.json
output/load/browser-load-*.json
output/load/tab-waterfall-*.json
output/load/server-watch-*.csv
```

## Текущие ожидаемые узкие места

- Один Next.js runtime process за nginx.
- `PG_POOL_MAX=15` по умолчанию: тяжелые API могут начать очередиться раньше CPU.
- `stocks-v2` делает много последовательных SQL-запросов.
- `economics` и `advertising` тяжелее dashboard и должны тестироваться отдельно.

## Команды help

```bash
npm run load:http -- --help
npm run load:browser -- --help
npm run load:tabs -- --help
npm run load:watch -- --help
```
