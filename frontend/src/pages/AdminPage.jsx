import { useEffect, useMemo, useState } from 'react';
import { adminFetch, getAdminToken, setAdminToken } from '../lib/adminApi.js';
import { listDocuments, verifyDocument, rejectDocument, DOCUMENT_TYPE_LABELS } from '../lib/documentApi.js';
import { timeAgo, bucketByDay } from '../lib/time.js';
import DashboardShell from '../components/DashboardShell.jsx';
import StatCard from '../components/StatCard.jsx';
import { MiniLineChart, MiniBarChart } from '../components/MiniCharts.jsx';
import ActivityList from '../components/ActivityList.jsx';
import {
  IconGrid,
  IconUsers,
  IconClock,
  IconCheckCircle,
  IconX,
  IconKey,
  IconFile,
} from '../components/icons.jsx';

// Admin is deliberately separate from the regular app: its own token, its
// own login (checked against .env, not the User collection), and it's not
// linked from anywhere in the public UI -- reaching it means typing
// /admin directly, same as the original IBLMS project's own Admin design.
export default function AdminPage() {
  const [loggedIn, setLoggedIn] = useState(!!getAdminToken());

  if (!loggedIn) return <AdminLogin onLoggedIn={() => setLoggedIn(true)} />;
  return <AdminDashboard onLogout={() => { setAdminToken(null); setLoggedIn(false); }} />;
}

function AdminLogin({ onLoggedIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await adminFetch('/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      setAdminToken(data.token);
      onLoggedIn();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 380, paddingTop: 100 }}>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--accent-soft)',
              color: 'var(--primary)',
            }}
          >
            <IconKey size={18} />
          </div>
          <h3 style={{ margin: 0 }}>Admin login</h3>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
          <input className="input" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <p style={{ color: '#DC2626', fontSize: 14 }}>{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Logging in...' : 'Log in'}
          </button>
        </form>
      </div>
    </div>
  );
}

const ROLE_LABELS = {
  business_poster: 'Business Poster',
  individual_poster: 'Individual Poster',
  fleet_owner: 'Fleet Owner',
  owner_driver: 'Individual Owner',
  driver: 'Fleet Driver',
};

const ROLE_ORDER = ['business_poster', 'individual_poster', 'fleet_owner', 'owner_driver', 'driver'];

const NAV_SECTIONS = (pendingCount, pendingDocCount) => [
  { items: [{ key: 'overview', label: 'Overview', icon: IconGrid }] },
  {
    title: 'Accounts',
    items: [
      { key: 'pending', label: 'Pending', icon: IconClock, badge: pendingCount },
      { key: 'approved', label: 'Approved', icon: IconCheckCircle },
      { key: 'rejected', label: 'Rejected', icon: IconX },
      { key: 'all', label: 'All accounts', icon: IconUsers },
    ],
  },
  {
    title: 'Documents',
    items: [{ key: 'documents', label: 'Document review', icon: IconFile, badge: pendingDocCount }],
  },
];

const SECTION_META = {
  overview: { title: 'Overview', subtitle: 'How the platform is growing, at a glance.' },
  pending: { title: 'Pending accounts', subtitle: 'Waiting on document review before they can log in.' },
  approved: { title: 'Approved accounts', subtitle: 'Accounts cleared and able to use IBLMS.' },
  rejected: { title: 'Rejected accounts', subtitle: 'Accounts that did not pass document review.' },
  all: { title: 'All accounts', subtitle: 'Every signed-up account, regardless of status.' },
  documents: { title: 'Document review', subtitle: 'Verify or reject uploaded ownership, license and KYC documents.' },
};

function AdminDashboard({ onLogout }) {
  const [section, setSection] = useState('overview');
  const [stats, setStats] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [sectionUsers, setSectionUsers] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const [documents, setDocuments] = useState([]);
  const [docBusyId, setDocBusyId] = useState(null);
  const [docError, setDocError] = useState(null);

  function loadStats() {
    adminFetch('/admin/stats').then(setStats).catch(() => {});
  }

  // Fetched once (no status filter) to drive Overview's charts/activity --
  // independent of whichever account-status section is currently open.
  function loadAllUsers() {
    adminFetch('/admin/users').then((d) => setAllUsers(d.users)).catch(() => {});
  }

  function loadSectionUsers() {
    if (section === 'overview') return;
    const q = section === 'all' ? '' : `?status=${section}`;
    adminFetch(`/admin/users${q}`)
      .then((d) => setSectionUsers(d.users))
      .catch((err) => setError(err.message));
  }

  // Fetched once (no status filter), same "overview badge needs it
  // regardless of which tab is open" reasoning as loadAllUsers above --
  // also reused as the Documents tab's own list, refetched after a
  // verify/reject action.
  function loadDocuments() {
    listDocuments()
      .then(setDocuments)
      .catch((err) => setDocError(err.message));
  }

  useEffect(loadStats, []);
  useEffect(loadAllUsers, []);
  useEffect(loadSectionUsers, [section]);
  useEffect(loadDocuments, []);

  async function act(id, action) {
    setBusyId(id);
    setError(null);
    try {
      await adminFetch(`/admin/users/${id}/${action}`, { method: 'POST' });
      loadStats();
      loadAllUsers();
      loadSectionUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function actOnDocument(id, action) {
    setDocBusyId(id);
    setDocError(null);
    try {
      if (action === 'verify') await verifyDocument(id);
      else await rejectDocument(id);
      loadDocuments();
    } catch (err) {
      setDocError(err.message);
    } finally {
      setDocBusyId(null);
    }
  }

  const pendingDocCount = useMemo(() => documents.filter((d) => d.verificationStatus === 'pending').length, [documents]);

  const roleBreakdown = useMemo(
    () =>
      ROLE_ORDER.map((r) => ({
        label: ROLE_LABELS[r].split(' ')[0],
        value: allUsers.filter((u) => u.role === r).length,
      })),
    [allUsers],
  );

  const signupsChart = useMemo(() => bucketByDay(allUsers, (u) => u.createdAt, 14), [allUsers]);

  const recentActivity = useMemo(
    () =>
      [...allUsers]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 6)
        .map((u) => ({
          id: u.id,
          icon: u.status === 'pending' ? IconClock : u.status === 'rejected' ? IconX : IconCheckCircle,
          accent: u.status === 'pending' ? 'amber' : u.status === 'rejected' ? 'red' : 'primary',
          title: u.name || u.companyName || u.email,
          subtitle: `${ROLE_LABELS[u.role] || u.role} · ${u.status}`,
          time: timeAgo(u.createdAt),
        })),
    [allUsers],
  );

  const meta = SECTION_META[section];

  return (
    <DashboardShell
      brandMark="IB"
      brandName="IBLMS Admin"
      navSections={NAV_SECTIONS(stats?.pending, pendingDocCount)}
      activeKey={section}
      onNavigate={setSection}
      pageTitle={meta.title}
      pageSubtitle={meta.subtitle}
      userLabel="Admin"
      userSub="Super admin"
      onLogout={onLogout}
      notificationsEnabled={false}
    >
      {section === 'overview' ? (
        <>
          <div className="wg-overview-grid">
            <StatCard icon={IconUsers} label="Total accounts" value={stats?.total ?? '—'} accent="primary" />
            <StatCard icon={IconClock} label="Pending review" value={stats?.pending ?? '—'} accent="amber" />
            <StatCard icon={IconCheckCircle} label="Approved" value={stats?.approved ?? '—'} accent="primary" />
            <StatCard icon={IconX} label="Rejected" value={stats?.rejected ?? '—'} accent="red" />
          </div>

          <div className="wg-row-2">
            <div className="card">
              <div className="wg-panel-header">
                <h3>Signups, last 14 days</h3>
                <span className="wg-panel-sub">{allUsers.length} total accounts</span>
              </div>
              <MiniLineChart data={signupsChart} emptyText="No signups yet." />
            </div>
            <div className="card">
              <div className="wg-panel-header">
                <h3>Recent activity</h3>
              </div>
              <ActivityList items={recentActivity} emptyText="No accounts yet." />
            </div>
          </div>

          <div className="card">
            <div className="wg-panel-header">
              <h3>Accounts by role</h3>
            </div>
            <MiniBarChart data={roleBreakdown} />
          </div>
        </>
      ) : section === 'documents' ? (
        <DocumentsSection documents={documents} busyId={docBusyId} onAct={actOnDocument} error={docError} />
      ) : (
        <AccountsSection section={section} users={sectionUsers} busyId={busyId} onAct={act} error={error} />
      )}
    </DashboardShell>
  );
}

function DocumentsSection({ documents, busyId, onAct, error }) {
  return (
    <>
      {error && <p style={{ color: '#DC2626', fontSize: 14, marginBottom: 10 }}>{error}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {documents.map((d) => (
          <div key={d._id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>
                {DOCUMENT_TYPE_LABELS[d.documentType] || d.documentType}{' '}
                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--muted)' }}>
                  · {d.userId?.name || d.userId?.email || 'Unknown user'} ({ROLE_LABELS[d.userId?.role] || d.userId?.role || 'unknown role'})
                </span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{d.filename}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '4px 10px',
                  borderRadius: 999,
                  background: 'var(--accent-soft)',
                  color: 'var(--primary)',
                }}
              >
                {d.verificationStatus}
              </span>
              {d.verificationStatus === 'pending' && (
                <>
                  <button className="btn btn-primary" disabled={busyId === d._id} onClick={() => onAct(d._id, 'verify')}>
                    Verify
                  </button>
                  <button className="btn btn-outline" disabled={busyId === d._id} onClick={() => onAct(d._id, 'reject')}>
                    Reject
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
        {documents.length === 0 && <p style={{ fontSize: 14, color: 'var(--muted)' }}>No documents uploaded yet.</p>}
      </div>
    </>
  );
}

function AccountsSection({ section, users, busyId, onAct, error }) {
  return (
    <>
      {error && <p style={{ color: '#DC2626', fontSize: 14, marginBottom: 10 }}>{error}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {users.map((u) => (
          <div key={u.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>
                {u.name || u.companyName || u.email} <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--muted)' }}>({ROLE_LABELS[u.role] || u.role})</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{u.email}</div>
              {u.documents && u.documents.length > 0 && (
                <div style={{ fontSize: 13, color: 'var(--primary)', marginTop: 4 }}>
                  Document(s): {u.documents.map((d) => d.filename).join(', ')}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '4px 10px',
                  borderRadius: 999,
                  background: 'var(--accent-soft)',
                  color: 'var(--primary)',
                }}
              >
                {u.status}
              </span>
              {u.status === 'pending' && (
                <>
                  <button className="btn btn-primary" disabled={busyId === u.id} onClick={() => onAct(u.id, 'approve')}>
                    Approve
                  </button>
                  <button className="btn btn-outline" disabled={busyId === u.id} onClick={() => onAct(u.id, 'reject')}>
                    Reject
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
        {users.length === 0 && <p style={{ fontSize: 14, color: 'var(--muted)' }}>No {section === 'all' ? '' : section} accounts.</p>}
      </div>
    </>
  );
}
