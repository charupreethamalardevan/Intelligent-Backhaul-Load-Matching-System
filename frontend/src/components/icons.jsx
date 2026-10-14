// Icon set, round-1 UI/UX rebuild: now backed by lucide-react instead of
// the old hand-rolled SVGs, per the design brief's explicit "use ONE
// consistent icon system (Lucide), never mix" instruction.
//
// Every export keeps its EXACT original name (IconGrid, IconTruck, ...)
// and the same `{ size, className }` call shape as the old hand-rolled
// set, so every file that already imports from './icons.jsx' --
// DashboardShell, RequestsPanel, MatchResults, StatCard call sites,
// FleetDashboard, PosterDashboard, AdminPage, SiteNav, LanguageSwitcher,
// Landing -- keeps working completely unchanged. Only what's drawn inside
// each icon changed, not its name or its props.
import {
  LayoutGrid,
  Truck,
  Route,
  Package,
  Users,
  CheckCircle2,
  Clock,
  Bell,
  Search,
  LogOut,
  Sun,
  Moon,
  Menu,
  X,
  TrendingUp,
  TrendingDown,
  MapPin,
  KeyRound,
  Clipboard,
} from 'lucide-react';

// Thin strokes, rounded caps -- matches the "subtle, not oversized" icon
// guidance. `strokeWidth` is slightly lighter than Lucide's 2px default so
// icons read as quiet UI chrome rather than bold illustrations.
const DEFAULTS = { strokeWidth: 1.75 };

export const IconGrid = ({ size = 18, className }) => <LayoutGrid size={size} className={className} {...DEFAULTS} />;
export const IconTruck = ({ size = 18, className }) => <Truck size={size} className={className} {...DEFAULTS} />;
export const IconRoute = ({ size = 18, className }) => <Route size={size} className={className} {...DEFAULTS} />;
export const IconBox = ({ size = 18, className }) => <Package size={size} className={className} {...DEFAULTS} />;
export const IconUsers = ({ size = 18, className }) => <Users size={size} className={className} {...DEFAULTS} />;
export const IconCheckCircle = ({ size = 18, className }) => <CheckCircle2 size={size} className={className} {...DEFAULTS} />;
export const IconClock = ({ size = 18, className }) => <Clock size={size} className={className} {...DEFAULTS} />;
export const IconBell = ({ size = 18, className }) => <Bell size={size} className={className} {...DEFAULTS} />;
export const IconSearch = ({ size = 18, className }) => <Search size={size} className={className} {...DEFAULTS} />;
export const IconLogout = ({ size = 18, className }) => <LogOut size={size} className={className} {...DEFAULTS} />;
export const IconSun = ({ size = 18, className }) => <Sun size={size} className={className} {...DEFAULTS} />;
export const IconMoon = ({ size = 18, className }) => <Moon size={size} className={className} {...DEFAULTS} />;
export const IconMenu = ({ size = 18, className }) => <Menu size={size} className={className} {...DEFAULTS} />;
export const IconX = ({ size = 18, className }) => <X size={size} className={className} {...DEFAULTS} />;
export const IconTrendUp = ({ size = 18, className }) => <TrendingUp size={size} className={className} {...DEFAULTS} />;
export const IconTrendDown = ({ size = 18, className }) => <TrendingDown size={size} className={className} {...DEFAULTS} />;
export const IconMapPin = ({ size = 18, className }) => <MapPin size={size} className={className} {...DEFAULTS} />;
export const IconKey = ({ size = 18, className }) => <KeyRound size={size} className={className} {...DEFAULTS} />;
export const IconClipboard = ({ size = 18, className }) => <Clipboard size={size} className={className} {...DEFAULTS} />;
