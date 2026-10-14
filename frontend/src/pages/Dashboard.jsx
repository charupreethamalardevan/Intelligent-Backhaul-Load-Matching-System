import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import FleetDashboard from './FleetDashboard.jsx';
import PosterDashboard from './PosterDashboard.jsx';

const FLEET_ROLES = ['fleet_owner', 'owner_driver', 'driver'];
const POSTER_ROLES = ['business_poster', 'individual_poster'];

// Fleet/Poster dashboards each render a full DashboardShell (sidebar +
// topbar, including their own logout button), so this component is just
// the role router -- no wrapping .page/.navbar/.hero chrome of its own,
// which would otherwise stack a second header above the shell's topbar.
export default function Dashboard() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate('/login');
  }, [loading, user, navigate]);

  if (loading || !user) return null;

  function handleLogout() {
    logout();
    navigate('/login');
  }

  if (FLEET_ROLES.includes(user.role)) return <FleetDashboard user={user} onLogout={handleLogout} />;
  if (POSTER_ROLES.includes(user.role)) return <PosterDashboard user={user} onLogout={handleLogout} />;
  return null;
}
