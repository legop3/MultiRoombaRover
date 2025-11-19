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
    <div className="panel-section space-y-0.5 text-base">
      <p className="text-sm text-slate-400">Admin login</p>
      <form className="flex flex-col gap-0.5" onSubmit={handleLogin}>
        <input
          className="field-input"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          className="field-input"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" disabled={loading} className="button-dark w-full disabled:opacity-50">
          {loading ? 'Logging in…' : 'Login'}
        </button>
      </form>
      {/* <div className="flex gap-0.5 text-sm">
        <button type="button" onClick={() => setRole('user')} className="flex-1 button-dark">
          Driver
        </button>
        <button type="button" onClick={() => setRole('spectator')} className="flex-1 button-dark">
          Spectator
        </button>
      </div> */}
    </div>
  );
}
