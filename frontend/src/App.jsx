import { useState } from 'react'
import { api, auth } from './api.js'
import Board from './Board.jsx'

export default function App() {
  const [user, setUser] = useState(auth.user)

  const logout = () => {
    auth.clear()
    setUser(null)
  }

  return user ? <Board user={user} onLogout={logout} /> : <AuthForm onAuth={setUser} />
}

function AuthForm({ onAuth }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const data = await api(`/auth/${mode}`, { method: 'POST', body: { email, password } })
      auth.save(data)
      onAuth(data.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const isLogin = mode === 'login'
  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand">
          <span className="brand-mark">▦</span> Kanban Sambar
        </div>
        <h1>{isLogin ? 'Welcome back' : 'Create account'}</h1>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn primary" disabled={busy}>{busy ? '…' : isLogin ? 'Log in' : 'Register'}</button>
        <p className="switch">
          {isLogin ? 'No account?' : 'Already registered?'}{' '}
          <button type="button" className="link" onClick={() => { setMode(isLogin ? 'register' : 'login'); setError('') }}>
            {isLogin ? 'Register' : 'Log in'}
          </button>
        </p>
      </form>
    </div>
  )
}
