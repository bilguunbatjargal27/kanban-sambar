import { useCallback, useEffect, useState } from 'react'
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd'
import { api, ApiError } from './api.js'

const COLUMNS = [
  { id: 'todo', title: 'To Do', color: '#6b7280' },
  { id: 'in_progress', title: 'In Progress', color: '#3b82f6' },
  { id: 'done', title: 'Done', color: '#22c55e' },
]

const LABELS = {
  Bug: '#ef4444',
  Feature: '#a855f7',
  Improvement: '#0ea5e9',
  Urgent: '#f97316',
  Research: '#14b8a6',
}

const DUE_FILTERS = [
  { id: 'all', title: 'Any due date' },
  { id: 'overdue', title: 'Overdue' },
  { id: 'today', title: 'Due today' },
  { id: 'week', title: 'Next 7 days' },
  { id: 'none', title: 'No due date' },
]

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dueInfo(due) {
  if (!due) return null
  const today = isoDate(new Date())
  const text = new Date(`${due}T00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  if (due < today) return { text, tone: 'overdue' }
  if (due === today) return { text: 'Today', tone: 'today' }
  return { text, tone: '' }
}

function matchesDue(due, filter) {
  if (filter === 'all') return true
  if (filter === 'none') return !due
  if (!due) return false
  const today = isoDate(new Date())
  if (filter === 'overdue') return due < today
  if (filter === 'today') return due === today
  const inWeek = new Date()
  inWeek.setDate(inWeek.getDate() + 7)
  return due >= today && due <= isoDate(inWeek)
}

function groupByStatus(tasks) {
  const groups = Object.fromEntries(COLUMNS.map((c) => [c.id, []]))
  for (const t of tasks) groups[t.status]?.push(t)
  for (const list of Object.values(groups)) list.sort((a, b) => a.position - b.position)
  return groups
}

export default function Board({ user, onLogout }) {
  const [tasks, setTasks] = useState([])
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [labelFilter, setLabelFilter] = useState('')
  const [dueFilter, setDueFilter] = useState('all')

  const handleError = useCallback((err) => {
    if (err instanceof ApiError && err.status === 401) onLogout()
    else setError(err.message)
  }, [onLogout])

  const load = useCallback(() => api('/tasks').then(setTasks).catch(handleError), [handleError])

  useEffect(() => {
    load()
    const onVisible = () => document.visibilityState === 'visible' && load()
    window.addEventListener('focus', load)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', load)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  const query = search.trim().toLowerCase()
  const isFiltering = Boolean(query || labelFilter || dueFilter !== 'all')
  const isVisible = (t) =>
    (!query || t.title.toLowerCase().includes(query) || t.description.toLowerCase().includes(query)) &&
    (!labelFilter || t.label === labelFilter) &&
    matchesDue(t.due_date, dueFilter)

  const groups = groupByStatus(tasks)
  const visible = Object.fromEntries(COLUMNS.map((c) => [c.id, groups[c.id].filter(isVisible)]))

  const clearFilters = () => {
    setSearch('')
    setLabelFilter('')
    setDueFilter('all')
  }

  const onDragEnd = ({ source, destination, draggableId }) => {
    if (!destination) return
    if (source.droppableId === destination.droppableId && source.index === destination.index) return

    const id = Number(draggableId)
    const next = groupByStatus(tasks)
    const moved = next[source.droppableId].find((t) => t.id === id)
    next[source.droppableId] = next[source.droppableId].filter((t) => t.id !== id)

    // The drop index counts only visible cards; translate it to an index in the full column
    // so hidden (filtered-out) tasks keep their relative order.
    const full = next[destination.droppableId]
    const shown = full.filter(isVisible)
    let position = full.length
    if (destination.index < shown.length) position = full.indexOf(shown[destination.index])
    else if (shown.length) position = full.indexOf(shown[shown.length - 1]) + 1

    full.splice(position, 0, { ...moved, status: destination.droppableId })
    setTasks(Object.values(next).flatMap((list) => list.map((t, i) => ({ ...t, position: i }))))

    api(`/tasks/${id}/move`, { method: 'PATCH', body: { status: destination.droppableId, position } })
      .then(setTasks)
      .catch((err) => { handleError(err); load() })
  }

  const save = async ({ id, ...fields }) => {
    try {
      if (id) {
        const updated = await api(`/tasks/${id}`, { method: 'PUT', body: fields })
        setTasks((ts) => ts.map((t) => (t.id === id ? updated : t)))
      } else {
        const created = await api('/tasks', { method: 'POST', body: fields })
        setTasks((ts) => [...ts, created])
      }
      setEditing(null)
    } catch (err) {
      handleError(err)
    }
  }

  const remove = async (id) => {
    if (!confirm('Delete this task?')) return
    try {
      await api(`/tasks/${id}`, { method: 'DELETE' })
      setTasks((ts) => ts.filter((t) => t.id !== id))
      setEditing(null)
    } catch (err) {
      handleError(err)
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">▦</span> Kanban Sambar</div>
        <div className="topbar-right">
          <span className="avatar" title={user.email}>{user.email[0].toUpperCase()}</span>
          <span className="email">{user.email}</span>
          <button className="btn ghost" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <div className="filters">
        <input
          className="search"
          type="search"
          placeholder="Search tasks…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={labelFilter} onChange={(e) => setLabelFilter(e.target.value)}>
          <option value="">All labels</option>
          {Object.keys(LABELS).map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={dueFilter} onChange={(e) => setDueFilter(e.target.value)}>
          {DUE_FILTERS.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
        </select>
        {isFiltering && <button className="btn ghost" onClick={clearFilters}>Clear</button>}
      </div>

      {error && <div className="toast" onClick={() => setError('')}>{error} ✕</div>}

      <DragDropContext onDragEnd={onDragEnd}>
        <main className="board">
          {COLUMNS.map((col) => (
            <section key={col.id} className="column" style={{ '--accent': col.color }}>
              <div className="column-head">
                <span className="pill">{col.title}</span>
                <span className="count">
                  {isFiltering ? `${visible[col.id].length} / ${groups[col.id].length}` : groups[col.id].length}
                </span>
                {col.id === 'todo' && (
                  <button
                    className="icon-btn"
                    title="New task"
                    onClick={() => setEditing({ title: '', description: '', due_date: null, label: null })}
                  >+</button>
                )}
              </div>
              <Droppable droppableId={col.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`card-list ${snapshot.isDraggingOver ? 'over' : ''}`}
                  >
                    {visible[col.id].map((task, index) => (
                      <Draggable key={task.id} draggableId={String(task.id)} index={index}>
                        {(p, s) => (
                          <TaskCard
                            task={task}
                            provided={p}
                            dragging={s.isDragging}
                            onOpen={() => setEditing(task)}
                            onDelete={() => remove(task.id)}
                          />
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                    {visible[col.id].length === 0 && !snapshot.isDraggingOver && (
                      <div className="empty">{isFiltering ? 'No matching tasks' : 'Drop tasks here'}</div>
                    )}
                  </div>
                )}
              </Droppable>
            </section>
          ))}
        </main>
      </DragDropContext>

      {editing && (
        <TaskModal task={editing} onSave={save} onDelete={remove} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

function TaskCard({ task, provided, dragging, onOpen, onDelete }) {
  const due = dueInfo(task.due_date)
  return (
    <article
      ref={provided.innerRef}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      className={`card ${dragging ? 'dragging' : ''}`}
      onClick={onOpen}
    >
      <h3>{task.title}</h3>
      {task.label && (
        <div className="labels">
          <span className="label" style={{ background: LABELS[task.label] }}>{task.label}</span>
        </div>
      )}
      {task.description && <p>{task.description}</p>}
      <div className="card-foot">
        <span className="ref">#{task.id}</span>
        {due && <span className={`due ${due.tone}`}>📅 {due.text}</span>}
        <span className="spacer" />
        <button
          className="icon-btn small danger"
          title="Delete"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
        >🗑</button>
      </div>
    </article>
  )
}

function TaskModal({ task, onSave, onDelete, onClose }) {
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [dueDate, setDueDate] = useState(task.due_date || '')
  const [label, setLabel] = useState(task.label || '')

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = (e) => {
    e.preventDefault()
    if (!title.trim()) return
    onSave({
      id: task.id,
      title: title.trim(),
      description,
      due_date: dueDate || null,
      label: label || null,
    })
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <form className="modal" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <h2>{task.id ? 'Edit task' : 'New task'}</h2>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required autoFocus />
        </label>
        <label>
          Description
          <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="row">
          <label>
            Due date
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          <label>
            Label
            <select value={label} onChange={(e) => setLabel(e.target.value)}>
              <option value="">No label</option>
              {Object.keys(LABELS).map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        </div>
        <div className="modal-actions">
          {task.id && <button type="button" className="btn danger" onClick={() => onDelete(task.id)}>Delete</button>}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary">Save</button>
        </div>
      </form>
    </div>
  )
}
