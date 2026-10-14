import { useEffect, useState } from 'react';
import { apiFetch, apiUpload } from '../lib/api.js';

// Shown on the Fleet Owner's dashboard. Generating an invite code is also
// where the Fleet Owner uploads that driver's license -- the driver never
// uploads one themself (see backend/routes/invites.js).
export default function InviteManager() {
  const [invites, setInvites] = useState([]);
  const [driverName, setDriverName] = useState('');
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [newCode, setNewCode] = useState(null);

  function load() {
    apiFetch('/invites')
      .then((d) => setInvites(d.invites))
      .catch(() => {});
  }

  useEffect(load, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError(null);
    setNewCode(null);
    if (!file) {
      setError("Please attach the driver's license file.");
      return;
    }
    const fd = new FormData();
    fd.append('driver_name', driverName);
    fd.append('license_doc', file);
    try {
      const data = await apiUpload('/invites', fd);
      setNewCode(data.code);
      setDriverName('');
      setFile(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h3>Invite a driver</h3>
      <form onSubmit={handleCreate} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
        <input
          className="input"
          placeholder="Driver name (optional)"
          value={driverName}
          onChange={(e) => setDriverName(e.target.value)}
          style={{ flex: 1, minWidth: 160 }}
        />
        <input type="file" onChange={(e) => setFile(e.target.files[0])} />
        <button className="btn btn-primary" type="submit">
          Generate invite + upload license
        </button>
      </form>
      {error && <p style={{ color: '#DC2626', fontSize: 13, marginTop: 8 }}>{error}</p>}
      {newCode && (
        <p style={{ color: 'var(--primary)', fontWeight: 700, marginTop: 8 }}>New invite code: {newCode}</p>
      )}

      <div style={{ marginTop: 16 }}>
        {invites.map((i) => (
          <div
            key={i.code}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '8px 0',
              borderBottom: '1px solid var(--border)',
              fontSize: 13,
            }}
          >
            <span>
              {i.code} {i.driverName ? `— ${i.driverName}` : ''}
            </span>
            <span style={{ color: i.used ? 'var(--muted)' : 'var(--primary)', fontWeight: 700 }}>
              {i.used ? 'Used' : 'Unused'}
            </span>
          </div>
        ))}
        {invites.length === 0 && <p style={{ fontSize: 13, color: 'var(--muted)' }}>No invites yet.</p>}
      </div>
    </div>
  );
}
