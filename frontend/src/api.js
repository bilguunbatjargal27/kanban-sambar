const BASE = `http://${window.location.hostname}:8000`

export const auth = {
  get token() { return localStorage.getItem('token') },
  get user() { return JSON.parse(localStorage.getItem('user') || 'null') },
  save({ access_token, user }) {
    localStorage.setItem('token', access_token)
    localStorage.setItem('user', JSON.stringify(user))
  },
  clear() {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  },
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`
  const res = await fetch(BASE + path, { method, headers, body: body && JSON.stringify(body) })
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = Array.isArray(data?.detail) ? data.detail[0]?.msg : data?.detail
    throw new ApiError(res.status, detail || 'Request failed')
  }
  return data
}
