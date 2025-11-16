import { useState } from 'react';
import { useSession } from '../context/SessionContext.jsx';

export default function AuthPanel() {
  const { login, setRole } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(event) {
    event.preventDefault();
    setLoading(true);
    try {
      await login(username, password);
      setUsername('');
      setPassword('');
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-sm bg-[#242a32] p-1 text-base text-slate-100">
      <p className="text-sm text-slate-400">Admin login</p>
      <form className="mt-1 flex flex-col gap-1" onSubmit={handleLogin}>
        <input
          className="rounded-sm bg-black/50 px-1 py-1 text-slate-100"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          className="rounded-sm bg-black/50 px-1 py-1 text-slate-100"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-sm bg-slate-200 px-1 py-1 text-sm font-semibold text-black disabled:opacity-50"
        >
          {loading ? 'Logging in…' : 'Login'}
        </button>
      </form>
      <div className="mt-1 flex gap-1 text-sm">
        <button
          type="button"
          onClick={() => setRole('user')}
          className="flex-1 rounded-sm bg-black/40 px-1 py-1 text-slate-200"
        >
          Driver
        </button>
        <button
          type="button"
          onClick={() => setRole('spectator')}
          className="flex-1 rounded-sm bg-black/40 px-1 py-1 text-slate-200"
        >
          Spectator
        </button>
      </div>
    </div>
  );
}
