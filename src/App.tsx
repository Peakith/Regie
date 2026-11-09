import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useSession, isInternal } from './lib/session';
import { supabase, must } from './lib/supabase';
import { LiveProvider, SyncStatus, useLive } from './lib/live';
import { useLoad } from './lib/useLoad';
import { roleLabel } from './lib/labels';
import { Loading, Msg } from './components/ui';
import Login from './pages/Login';
import Inrichten from './pages/Inrichten';
import Dashboard from './pages/Dashboard';
import Projecten from './pages/Projecten';
import NieuwProject from './pages/NieuwProject';
import ProjectPagina from './pages/Project';
import Register from './pages/Register';
import Agenda from './pages/Agenda';
import MijnTaken from './pages/MijnTaken';
import Lijsten from './pages/Lijsten';
import Bord from './pages/Bord';
import Personen from './pages/Personen';
import Templates from './pages/Templates';
import Instellingen from './pages/Instellingen';
import Crew from './pages/Crew';
import Uitnodiging from './pages/Uitnodiging';
import Offline from './pages/Offline';
import Zoeken from './components/Zoeken';
import MfaChallenge from './pages/MfaChallenge';
import Meldingen from './components/Meldingen';

const NAV: [string, string][] = [
  ['/dashboard', 'Dashboard'], ['/projecten', 'Projecten'], ['/register', 'Register'], ['/agenda', 'Agenda'],
  ['/mijn-taken', 'Mijn taken'], ['/lijsten', 'Lijsten'], ['/deliverables', 'Deliverables'],
  ['/personen', 'Personen & klanten'], ['/templates', 'Templates'], ['/instellingen', 'Instellingen'],
];

export default function App() {
  const { session, ctx, orgExists, needsMfa, loading, error, refresh } = useSession();
  const loc = useLocation();

  if (loc.pathname === '/offline') return <Offline />;
  if (loading && !session) return <div className="center"><Loading /></div>;
  if (!session) return <Login />;
  if (needsMfa) return <MfaChallenge />;
  if (loc.pathname === '/uitnodiging') return <Uitnodiging />;
  if (error && !navigator.onLine) return <Offline />;
  if (error) {
    return (
      <div className="center"><div className="auth">
        <Msg>{error}</Msg>
        <div className="row"><button onClick={refresh}>Opnieuw proberen</button><Link className="btn" to="/offline">Offline gegevens bekijken</Link></div>
      </div></div>
    );
  }
  if (loading) return <div className="center"><Loading /></div>;
  if (!ctx) {
    if (!orgExists) return <Inrichten />;
    return (
      <div className="center">
        <div className="auth card">
          <img src="/brand/regie-woordmerk.png" alt="Regie" />
          <h1>Nog geen toegang</h1>
          <p>Je bent ingelogd als <strong>{session.user.email}</strong>, maar je hebt (nog) geen toegang tot een werkruimte. Heb je een uitnodigingslink gekregen? Open die link opnieuw. Anders kan de eigenaar je uitnodigen.</p>
          <div className="row"><button onClick={refresh}>Opnieuw controleren</button><button onClick={() => supabase.auth.signOut()}>Uitloggen</button></div>
        </div>
      </div>
    );
  }

  const internal = isInternal(ctx.role);
  return (
    <LiveProvider enabled={import.meta.env.VITE_REALTIME !== 'uit'}>
      <OfflineSnapshot />
      {internal ? <InternalShell /> : <Crew />}
    </LiveProvider>
  );
}

function InternalShell() {
  const { ctx, session } = useSession();
  const [search, setSearch] = useState(false);
  const nav = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!ctx || !session) return null;
  return (
    <div className="shell">
      <nav className="side" aria-label="Hoofdnavigatie">
        <img className="logo" src="/brand/regie-woordmerk.png" alt="Regie" />
        <div className="tools">
          <button className="iconbtn" onClick={() => setSearch(true)} aria-label="Zoeken (⌘K)" title="Zoeken (⌘K / Ctrl+K)">Zoeken</button>
          <Meldingen />
        </div>
        <div className="nav-group">
          {NAV.map(([to, label]) => <NavLink key={to} className="nav" to={to}>{label}</NavLink>)}
        </div>
        <div className="who">
          {ctx.person_name ?? session.user.email}<br />
          <span className="small">{roleLabel[ctx.role]}</span> · <button className="link small" onClick={() => supabase.auth.signOut()}>Uitloggen</button>
        </div>
      </nav>
      <main className="main">
        <div className="statusbar"><SyncStatus /></div>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/projecten" element={<Projecten />} />
          <Route path="/projecten/nieuw" element={<NieuwProject />} />
          <Route path="/projecten/:id" element={<ProjectPagina />} />
          <Route path="/register" element={<Register />} />
          <Route path="/agenda" element={<Agenda />} />
          <Route path="/mijn-taken" element={<MijnTaken />} />
          <Route path="/lijsten" element={<Lijsten />} />
          <Route path="/deliverables" element={<Bord />} />
          <Route path="/personen" element={<Personen />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/instellingen" element={<Instellingen />} />
          <Route path="*" element={<p>Pagina niet gevonden.</p>} />
        </Routes>
      </main>
      {search && <Zoeken onClose={() => setSearch(false)} onPick={(to) => { setSearch(false); nav(to); }} />}
    </div>
  );
}

/** Bewaart bij elke verversing een alleen-lezen kopie voor offline gebruik (komende 7 dagen + eigen taken). */
function OfflineSnapshot() {
  const { tick, online } = useLive();
  useLoad(async () => {
    if (!online) return null;
    const snap = must(await supabase.rpc('offline_snapshot'));
    try { localStorage.setItem('regie-offline', JSON.stringify(snap)); } catch { /* opslag niet beschikbaar */ }
    return null;
  }, [tick === 0, online]);
  return null;
}
