import { useEffect, useState } from 'react';
import { apiFetch, apiUpload } from '../lib/api.js';
import DataTable from './DataTable.jsx';
import './dataViews.css';

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

  const columns = [
    {
      key: 'code',
      header: 'Invite code',
      render: (i) => (
        <>
          <div className="dv-cell-primary" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
            {i.code}
          </div>
          {i.driverName && <div className="dv-cell-sub">{i.driverName}</div>}
        </>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (i) => <span className={`dv-status-chip ${i.used ? 'tone-done' : 'tone-active'}`}>{i.used ? 'Used' : 'Unused'}</span>,
    },
  ];

  return (
    <div className="dv-panel">
      <div className="dv-panel-head">
        <h2>Invite a driver</h2>
      </div>
      <form onSubmit={handleCreate} className="dv-invite-form">
        <input
          className="input"
          placeholder="Driver name (optional)"
          value={driverName}
          onChange={(e) => setDriverName(e.target.value)}
          style={{ flex: 1, minWidth: 160 }}
        />
        <input type="file" onChange={(e) => setFile(e.target.files[0])} />
        <button className="btn btn-primary" type="submit" style={{ fontSize: 13 }}>
          Generate invite + upload license
        </button>
      </form>
      {error && <p style={{ color: '#DC2626', fontSize: 14, padding: '10px 18px 0' }}>{error}</p>}
      {newCode && <p className="dv-invite-code-banner">New invite code: {newCode}</p>}

      <DataTable columns={columns} rows={invites} rowKey={(i) => i.code} emptyText="No invites yet." />
    </div>
  );
}
