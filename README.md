# CT-expo Production Tracker (MVP)

Это MVP трекера производства с приятным UX поверх Google Sheets.

## Что умеет (MVP)
- Kanban-доска по статусам (Backlog / Ready / In progress / Blocked / Done)
- Поиск + фильтры по участку и исполнителю
- Drag&drop между статусами (обновляет Google Sheets)
- Карточка задачи (редактирование, план/факт минут, дедлайн, комментарий)

## Что нужно
- Google Sheet с листом `Tasks` (см. ниже)
- Google Apps Script Web App (API)
- GitHub Pages для фронтенда

---

## 1) Google Sheet: лист `Tasks`

Создай лист `Tasks` и добавь заголовки в первой строке:

task_id | order_id | item | operation | workcenter | status | assignee | priority | due_date | planned_min | done_min | note | updated_at

- `task_id` можно оставить пустым при создании — API сам сгенерирует.
- `due_date` формат: yyyy-mm-dd

(Опционально) Создай лист `Worklog` для истории (API будет писать туда по желанию).

## 2) Apps Script (API)
См. файл `apps_script.gs`. Вставь код в Apps Script, укажи ID таблицы и токен, задеплой как Web App.

## 3) GitHub Pages
Залей эти файлы в репозиторий:
- index.html
- styles.css
- app.js

В настройках репозитория включи GitHub Pages (deploy from branch).

## 4) Подключение API в браузере
Открой страницу, затем:
- DevTools → Application → Local Storage
- добавь:
  - CT_API_URL = <URL Web App>
  - CT_API_TOKEN = <твой токен> (если включён в скрипте)

Готово.
