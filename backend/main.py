from datetime import date
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from auth import create_token, current_user, hash_password, verify_password
from db import Base, engine, get_db
from models import Task, User

Base.metadata.create_all(engine)

app = FastAPI(
    title="Kanban Sambar API",
    version="1.0.0",
    description=(
        "REST API for a personal Kanban board with three columns: **To Do**, **In Progress**, **Done**.\n\n"
        "**Auth flow:** call `/auth/register` or `/auth/login` to get a JWT, then click **Authorize** "
        "and paste the `access_token`. Every `/tasks` route only reads and writes the logged-in user's tasks.\n\n"
        "**Ordering:** each task has a `position` inside its column (0 = top). "
        "Use `PATCH /tasks/{task_id}/move` to change column and/or position; the server renumbers both columns."
    ),
    openapi_tags=[
        {"name": "Auth", "description": "Register, log in and identify the current user."},
        {"name": "Tasks", "description": "Create, read, update, delete and reorder the current user's tasks."},
    ],
)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://[^/]+:5173",
    allow_methods=["*"],
    allow_headers=["*"],
)

Status = Literal["todo", "in_progress", "done"]
Label = Literal["Bug", "Feature", "Improvement", "Urgent", "Research"]


class Credentials(BaseModel):
    email: EmailStr = Field(description="Login email, case-insensitive.", examples=["user@example.com"])
    password: str = Field(min_length=6, max_length=72, description="6–72 characters.", examples=["secret123"])


class UserOut(BaseModel):
    id: int = Field(description="User ID.")
    email: str = Field(description="User email (lowercased).")


class TokenOut(BaseModel):
    access_token: str = Field(description="JWT, valid for 12 hours. Send as `Authorization: Bearer <token>`.")
    token_type: str = Field("bearer", description="Always `bearer`.")
    user: UserOut


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=200, description="Task title, 1–200 characters.", examples=["Design login page"])
    description: str = Field("", description="Optional longer text.", examples=["Email + password form with validation"])
    due_date: date | None = Field(None, description="Optional due date (YYYY-MM-DD).", examples=["2026-10-31"])
    label: Label | None = Field(None, description="Optional label from the fixed list.", examples=["Feature"])


class TaskMove(BaseModel):
    status: Status = Field(description="Target column.", examples=["in_progress"])
    position: int = Field(
        ge=0,
        description="Target index in the column, 0 = top. Values past the end place the task last.",
        examples=[0],
    )


class TaskOut(BaseModel):
    id: int = Field(description="Task ID.")
    title: str
    description: str
    status: Status = Field(description="Column: `todo`, `in_progress` or `done`.")
    position: int = Field(description="Order inside the column, 0 = top.")
    due_date: date | None
    label: Label | None

    model_config = {"from_attributes": True}


def token_response(user: User) -> TokenOut:
    return TokenOut(access_token=create_token(user.id), user=UserOut(id=user.id, email=user.email))


@app.post(
    "/auth/register",
    response_model=TokenOut,
    status_code=201,
    tags=["Auth"],
    summary="Register a new user",
    description="Creates an account and returns a token, so the user is logged in right away.",
    responses={409: {"description": "Email already registered."}, 422: {"description": "Invalid email or password too short/long."}},
)
def register(body: Credentials, db: Session = Depends(get_db)):
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    user = User(email=email, password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    return token_response(user)


@app.post(
    "/auth/login",
    response_model=TokenOut,
    tags=["Auth"],
    summary="Log in",
    description="Checks email and password and returns a new token. Each device logs in separately and gets its own token.",
    responses={401: {"description": "Invalid email or password."}},
)
def login(body: Credentials, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    return token_response(user)


@app.get(
    "/auth/me",
    response_model=UserOut,
    tags=["Auth"],
    summary="Current user",
    description="Returns the user the token belongs to.",
    responses={401: {"description": "Missing, invalid or expired token."}},
)
def me(user: User = Depends(current_user)):
    return UserOut(id=user.id, email=user.email)


def get_own_task(task_id: int, user: User, db: Session) -> Task:
    task = db.scalar(select(Task).where(Task.id == task_id, Task.user_id == user.id))
    if not task:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    return task


def column_tasks(db: Session, user_id: int, status_: str) -> list[Task]:
    return list(
        db.scalars(
            select(Task)
            .where(Task.user_id == user_id, Task.status == status_)
            .order_by(Task.position, Task.id)
            .with_for_update()
        )
    )


@app.get(
    "/tasks",
    response_model=list[TaskOut],
    tags=["Tasks"],
    summary="List my tasks",
    description="Returns all of the current user's tasks, ordered by column then position.",
    responses={401: {"description": "Missing, invalid or expired token."}},
)
def list_tasks(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return db.scalars(
        select(Task).where(Task.user_id == user.id).order_by(Task.status, Task.position, Task.id)
    ).all()


@app.post(
    "/tasks",
    response_model=TaskOut,
    status_code=201,
    tags=["Tasks"],
    summary="Create a task",
    description="Creates a task at the bottom of the **To Do** column.",
    responses={401: {"description": "Missing, invalid or expired token."}, 422: {"description": "Title missing or too long."}},
)
def create_task(body: TaskIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    next_pos = db.scalar(
        select(func.coalesce(func.max(Task.position) + 1, 0)).where(
            Task.user_id == user.id, Task.status == "todo"
        )
    )
    task = Task(user_id=user.id, status="todo", position=next_pos, **body.model_dump())
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@app.put(
    "/tasks/{task_id}",
    response_model=TaskOut,
    tags=["Tasks"],
    summary="Edit a task",
    description="Replaces title, description, due date and label. Column and position are unchanged — use `/move` for that.",
    responses={401: {"description": "Missing, invalid or expired token."}, 404: {"description": "Task does not exist or belongs to another user."}},
)
def update_task(task_id: int, body: TaskIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    task = get_own_task(task_id, user, db)
    for field, value in body.model_dump().items():
        setattr(task, field, value)
    db.commit()
    db.refresh(task)
    return task


@app.delete(
    "/tasks/{task_id}",
    status_code=204,
    tags=["Tasks"],
    summary="Delete a task",
    description="Permanently deletes the task.",
    responses={401: {"description": "Missing, invalid or expired token."}, 404: {"description": "Task does not exist or belongs to another user."}},
)
def delete_task(task_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    task = get_own_task(task_id, user, db)
    db.delete(task)
    db.commit()


@app.patch(
    "/tasks/{task_id}/move",
    response_model=list[TaskOut],
    tags=["Tasks"],
    summary="Move / reorder a task",
    description=(
        "Moves the task to `status` at index `position`. Works for reordering inside a column "
        "and for moving between columns. Both affected columns are renumbered 0..n in one transaction "
        "with row locks, so concurrent moves from different devices can't produce duplicate positions. "
        "Returns the full updated task list."
    ),
    responses={401: {"description": "Missing, invalid or expired token."}, 404: {"description": "Task does not exist or belongs to another user."}},
)
def move_task(task_id: int, body: TaskMove, user: User = Depends(current_user), db: Session = Depends(get_db)):
    task = get_own_task(task_id, user, db)

    source = [t for t in column_tasks(db, user.id, task.status) if t.id != task.id]
    target = source if task.status == body.status else column_tasks(db, user.id, body.status)
    target.insert(min(body.position, len(target)), task)
    task.status = body.status

    for column in (source, target):
        for i, t in enumerate(column):
            t.position = i
    db.commit()
    return list_tasks(user, db)
