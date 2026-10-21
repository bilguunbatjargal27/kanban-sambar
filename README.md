# Kanban Sambar

A personal Kanban board: register or log in, then manage your own tasks across **To Do**, **In Progress** and **Done**, with drag-and-drop ordering that is saved to the database.

**Stack:** FastAPI · SQLAlchemy 2 · PostgreSQL · React + Vite · @hello-pangea/dnd

A visual walkthrough of the architecture, decisions and trade-offs is in [`docs/overview.html`](docs/overview.html). Open it in a browser.

## Features

- **Auth:** register and log in with email and password. Passwords are stored as bcrypt hashes; sessions use a JWT that lasts 12 hours. Each user sees only their own tasks.
- **Board:** three columns. Tasks keep their column and order after a refresh and across devices.
- **Tasks:** create, edit and delete, with title, description, due date and label (Bug, Feature, Improvement, Urgent, Research).
- **Drag and drop:** move tasks between columns or reorder them within one. The new order is saved on the backend.
- **Search and filter:** by text, label and due date (overdue, today, next 7 days, none).
- **Responsive:** works on desktop and mobile, including touch drag.

## Running locally

Tested with Python 3.14, Node 22 and PostgreSQL 14.

### 1. Database

```bash
createdb kanban_sambar
```

Tables are created automatically when the backend starts.

### 2. Backend (http://localhost:8000)

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn main:app --reload
```

| Env var | Default |
|---|---|
| `DATABASE_URL` | `postgresql+psycopg://localhost/kanban_sambar` |
| `SECRET_KEY` | `dev-secret-change-me` (set a real value outside local dev) |

Interactive API docs: http://localhost:8000/docs

### 3. Frontend (http://localhost:5173)

```bash
cd frontend
npm install
npm run dev
```

## API

| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Create an account and return a token |
| POST | `/auth/login` | Log in and return a token |
| GET | `/auth/me` | Current user |
| GET | `/tasks` | My tasks, ordered by column and position |
| POST | `/tasks` | Create a task at the bottom of To Do |
| PUT | `/tasks/{id}` | Edit title, description, due date and label |
| DELETE | `/tasks/{id}` | Delete a task |
| PATCH | `/tasks/{id}/move` | Move or reorder: `{status, position}` |

Every `/tasks` route requires `Authorization: Bearer <token>`. A task that belongs to another user returns 404.

## Data model

- **users:** `id`, `email` (unique), `password_hash`, `created_at`
- **tasks:** `id`, `user_id` (FK, cascade delete), `title`, `description`, `status` (CHECK), `position`, `due_date`, `label` (CHECK), `created_at`, `updated_at`

**Ordering:** each column is numbered `0..n`. A move locks the affected rows (`SELECT … FOR UPDATE`), takes the task out, inserts it at the new index and renumbers both columns in one transaction, so moves made from several devices at once never produce duplicate positions.

## Project structure

```
backend/
  main.py      routes and request/response schemas
  auth.py      bcrypt hashing, JWT creation/verification, current_user dependency
  models.py    SQLAlchemy models
  db.py        engine, session, get_db dependency
frontend/src/
  App.jsx      login/register screen
  Board.jsx    board, drag & drop, filters, task modal
  api.js       fetch wrapper with Bearer token
  index.css    styles and responsive breakpoints
docs/
  overview.html  architecture and trade-offs walkthrough
```

## Trade-offs and next steps

- **Logout** only removes the token on that device. Revoking it would need refresh tokens or a deny-list.
- **Token storage:** the token is kept in `localStorage`. An httpOnly cookie would protect it better against XSS.
- **Multi-device sync:** the board reloads when the window regains focus. Live updates would need WebSockets.
- **Search and filter** run in the browser over the user's tasks. With large boards they would move to server query params.
- **Database schema** is created with `create_all`. Alembic migrations, automated tests, login rate limiting and a required `SECRET_KEY` are the next steps before production.
