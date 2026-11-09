import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { useSession } from './lib/session';
import { supabase } from './lib/supabase';
import { roleLabel } from './lib/labels';
import { Loading, Msg } from './components/ui';
import Login from './pages/Login';
import Inrichten from './pages/Inrichten';
import Projecten from './pages/Projecten';
import NieuwProject from './pages/NieuwProject';
import ProjectPagina from './pages/Project';
import Personen from './pages/Personen';
import Instellingen from './pages/Instellingen';

export default function App() {
  const { session, ctx, orgExists, loading, error, refresh } = useSession();

  if (loading && !session) return <div className="center"><Loading /></div>;
  if (!session) return <Login />;
  if (error) return <div className="center"><div className="auth"><Msg>{error}</Msg><button onClick={refresh}>Opnieuw proberen</button></div></div>;
  if (loading) return <div className="center"><Loading /></div>;
  if (!ctx) {
    if (!orgExists) return <Inrichten />;
    return (
      <div className="center">
        <div className="auth card">
          <img src="/brand/regie-woordmerk.png" alt="Regie" />
          <h1>Nog geen toegang</h1>
          <p>Je bent ingelogd als <strong>{session.user.email}</strong>, maar je bent nog niet aan een werkruimte toegevoegd. Vraag de eigenaar om je toe te voegen via Instellingen.</p>
          <div className="row"><button onClick={refresh}>Opnieuw controleren</button><button onClick={() => supabase.auth.signOut()}>Uitloggen</button></div>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <nav className="side" aria-label="Hoofdnavigatie">
        <img className="logo" src="/brand/regie-woordmerk.png" alt="Regie" />
        <NavLink className="nav" to="/projecten">Projecten</NavLink>
        <NavLink className="nav" to="/personen">Personen</NavLink>
        <NavLink className="nav" to="/instellingen">Instellingen</NavLink>
        <div className="who">
          {ctx.person_name ?? session.user.email}<br />
          <span className="small">{roleLabel[ctx.role]}</span> · <button className="link small" onClick={() => supabase.auth.signOut()}>Uitloggen</button>
        </div>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/projecten" replace />} />
          <Route path="/projecten" element={<Projecten />} />
          <Route path="/projecten/nieuw" element={<NieuwProject />} />
          <Route path="/projecten/:id" element={<ProjectPagina />} />
          <Route path="/personen" element={<Personen />} />
          <Route path="/instellingen" element={<Instellingen />} />
          <Route path="*" element={<p>Pagina niet gevonden.</p>} />
        </Routes>
      </main>
    </div>
  );
}
