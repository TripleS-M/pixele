'use client';

import { useState } from 'react';
import { Logo } from '@/components/Shell';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = '/admin';
        return;
      }
      setError((await res.json().catch(() => ({}))).error || 'Sign-in failed.');
    } catch {
      setError('Could not reach the server.');
    }
    setBusy(false);
  };

  return (
    <div className="shell">
      <header className="topbar">
        <Logo tag="CONTROL ROOM" />
      </header>
      <main className="main">
        <form className="window login" onSubmit={submit}>
          <div className="titlebar">
            <span>Restricted access</span>
          </div>
          <div className="window-body stack">
            <label className="field">
              <span>Admin password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus
                required
              />
            </label>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <button className="btn primary" disabled={busy || !password}>
              {busy ? 'Verifying…' : 'Sign in'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
