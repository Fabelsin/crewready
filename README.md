# CrewReady — прототип для NASA Space Apps 2026

## MoveCheck integration (current)

Branch `codex/movecheck-exercise-pool` is based on upstream `fe74ad9`, including the crew console, seven 3D scenes, reworked missions 5–7 (`42edd9c`) and task-indicator panels (`fe74ad9`). MoveCheck adds an optional movement break after the cognitive check: **two different movements from a pool of three** (squat, overhead reach, T-pose arm open), three repetitions each. Defaults rotate across assessments; each movement and each new assessment starts with fresh counters.

```bash
docker compose up -d --build
# open http://localhost:8765/
```

Do not double-click `index.html`; modules and camera assets need HTTP on localhost or HTTPS. Stop with `docker compose down`. Rebuild after source edits with the same `up -d --build` command. The app remains a static vanilla site; the Docker build validates assets and packages `dist/`, then Nginx serves the complete output.

```bash
npm ci
npm test
npx tsc --noEmit
npm run build
npm run test:browser
# optional after starting Docker:
node scripts/docker-smoke.js
```

MediaPipe SDK/WASM/model and Three.js runtime/addons are self-hosted under `public/`; no CDN or Google Font is needed. The core workflow is tested with non-loopback requests blocked. NASA source links and briefing videos remain available online through an explicit **Load NASA briefing video** action. No webcam pixels or landmarks leave the device. This is a locally served offline demo, not a cold-start PWA.

Results preserve the seven task metrics and the latest task-indicator bars with clearly labeled demo references. Cognitive and movement observations are separate; no synthetic medical/readiness score or automatic task clearance is produced. The optional break does not establish an improvement in alertness. Movement estimates are for Earth training, with separate validation/equipment needed onboard.

See [session schema 2](docs/SESSION_SCHEMA.md), [demo script](docs/DEMO_SCRIPT.md), [MediaPipe asset provenance](public/models/ASSET_MANIFEST.md), and [Three.js asset provenance](public/vendor/three/ASSET_MANIFEST.md). New sessions use `crewready.v5.sessions` and a browser-local crew profile. Old v3/v4 records remain untouched and are not assigned invented crew/routine context. TypeScript checks the new movement/session/Worker modules; legacy `app.js` and `scene3d.js` are syntax/browser checked. Full movement cycles use synthetic fixtures; real MediaPipe is separately tested on a fake browser camera. Human webcam accuracy remains unvalidated.

## Original mission notes

Проверка готовности экипажа МКС перед критической операцией: сон и сонливость → **проверка, своя для каждой миссии** → сравнение «Сегодня / Обычно» с личным baseline этой миссии → договорённость с напарником.

## Запуск

Статический сайт. Используйте Docker выше или соберите и запустите HTTP-сервер; не открывайте `index.html` через `file://`:

```bash
npm run build
python3 -m http.server 8765 --directory dist
# http://localhost:8765
```

## Структура сайта

| Адрес | Страница |
|---|---|
| (первый вход) | Интро: фоновое видео с МКС, эмблема, «Enter mission control» (Skip / Esc / Enter) |
| `#/` | Главная: назначение, проблема, 4 шага, научная основа, список миссий |
| `#/tasks` | Выбор миссии и режима (Live test / Crew scenario) |
| `#/about` | Методика, правило карточки, режимы, источники изображений |
| `#/run/<mission>/<step>` | Прохождение: `brief` → `check` → optional `movement` → `results` → `plan` |

## Семь миссий — семь разных проверок

| Миссия | Навык | Интерактив | Метрика |
|---|---|---|---|
| Capture a cargo spacecraft (Cygnus) | тайминг по команде напарника | наведение манипулятора по 2 осям, 3 захвата только по CAPTURE | реакция на команду, мс |
| Monitor spacecraft docking | устойчивое внимание | 3 индикатора сближения, отметить вышедший из диапазона за 3 с | время обнаружения, мс |
| Install a solar array (EVA) | точная моторика и порядок | запомнить порядок болтов, затянуть каждый в зелёное окно момента | средняя ошибка момента, % шкалы |
| Service the water recovery system | различение похожих символов | найти блок с ID из наряда (8/B, 0/O, 1/I, 5/S, 2/Z) | время решения, мс |
| Run an emergency drill | приоритет и пространственное мышление под тревогой | WARNING раньше CAUTION, найти модуль (ракурс станции меняется), первое действие, закрыть изолирующий люк со своей стороны | время реакции на тревогу, мс |
| Perform an ultrasound scan | точная моторика по указаниям | три точки на артерии: позиция, угол датчика поперёк сосуда, умеренное давление (вена сжимается); SAVE по команде сонографиста | время на цели, % |
| Run a microgravity experiment | рабочая память и мысленный поворот | запомнить 12 пробирок в штативе glovebox; второй штатив поворачивается на 180° перед ответом | точность, % |

Каждая проверка 30–75 с, работает с клавиатуры, мышью и на тач-экране. По результату (какие ошибки допущены) план предлагает конкретную перекрёстную проверку с напарником.

## Правило карточки «Review before task»

Метрика миссии хуже обычной минимум на **20%** **и** сна меньше обычного на **2 ч** **или** сонливость **4–5 из 5**. Демо-пороги, не клинические.

## Режимы

- **Live test** — история хранится только в localStorage этого браузера, отдельно для каждой миссии; сравнение появляется после 5 проверок. Для демонстрации можно подставить помеченный симулированный baseline.
- **Crew scenario** — симулированный астронавт после короткой ночи (5 ч 10 мин, сонливость 4/5) с пятью обычными проверками каждой миссии. Можно пройти проверку самому или загрузить записанный результат астронавта.

## Где что настраивать (`app.js`)

| Что | Где |
|---|---|
| Миссии: текст, критический шаг, напарник, метрика, данные Crew scenario | массив `OPS` |
| Проверки миссий | функции `captureCheck`, `monitorCheck`, `torqueCheck`, `verifyCheck`, `triageCheck`, `pursuitCheck`, `trayCheck` |
| Правило карточки | `RULE` |
| Подсказки для договорённости с напарником | `agreementText()` |

## Сеанс экипажа

После интро открывается вход: позиция экипажа (CDR / FE-1…FE-3), позывной и тип сеанса (Live assessment или Training scenario). В шапке — время GMT, позывной и тип сеанса, кнопка End session. Аутентификации нет: прототип, данные остаются в браузере.

## Брифинг миссии

Для каждой операции — официальное видео NASA (загружается с images-assets.nasa.gov по отдельной кнопке), цитата из описания NASA со ссылкой на первоисточник и объяснение, зачем нужна именно эта проверка.

## Медиа

- Интро: NASA «4K Earth Views» (jsc2021m000138), фрагмент 14 с, 1080p.
- Фото: NASA (images.nasa.gov) — ISS037/043/065/072/073.
- Видео брифингов: NHQ_2020_1005 (Cygnus), jsc2020m000166 (Demo-2 docking), jsc2022m000280 (EVA 82 iROSA), 318_ECLSSWaterRec, Saffire-VI, HumanHealth + KSC-04-S-00090, 282_ThinkingInsideBox.
- Логотипы NASA и NASA International Space Apps Challenge (Wikimedia Commons, из бренд-архива Space Apps) показаны, чтобы обозначить хакатон; NASA не поддерживает и не одобряет проект.
