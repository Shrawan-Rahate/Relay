import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Menu, X } from 'lucide-react';
import type { CreateProjectRequest, Project } from '../../shared/api-types';
import { useAuth } from './auth/context';
import { ApiError, RelayApi, projectFrom } from './lib/api';
import Auth from './pages/Auth';
import LiveProjects from './pages/LiveProjects';
import LiveOverview from './pages/LiveOverview';
import LiveSourceManager from './pages/LiveSourceManager';
import ProjectNavigation from './components/ProjectNavigation';
import ThemeToggle from './components/ThemeToggle';
import { Button } from './components/ui';
import { canViewPage, projectPages, roleLabels, type ProjectPage } from './data/project-ui';
import AuthLayout from './components/AuthLayout';

type Page = ProjectPage | 'projects' | 'login' | 'register';
const pageFromHash = (): Page => {
  const page = window.location.hash.slice(1);
  return ['projects', 'login', 'register', ...projectPages.map(item => item.id)].includes(page) ? page as Page : 'projects';
};
export type LiveProjectContext = { project: Project; page: ProjectPage; api: RelayApi; refreshAccess: () => void };

export default function LiveApp({ onDemo, renderProjectPage }: { onDemo: () => void; renderProjectPage?: (context: LiveProjectContext) => ReactNode }) {
  const { state, controller } = useAuth();
  const [page, setPage] = useState<Page>(pageFromHash);
  const previousStatus = useRef(state.status);
  const navigate = (next: Page) => { setPage(next); window.location.hash = next; };
  useEffect(() => {
    const update = () => setPage(pageFromHash()); window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    const becameAuthenticated = state.status === 'authenticated' && previousStatus.current !== 'authenticated';
    previousStatus.current = state.status;
    if (becameAuthenticated || (state.status === 'authenticated' && (page === 'login' || page === 'register'))) {
      document.title = 'Relay · Projects';
      setPage('projects'); window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#projects`);
    } else if (state.status !== 'restoring' && state.status !== 'authenticated' && page !== 'login' && page !== 'register') {
      setPage('login'); window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#login`);
    }
  }, [state.status, page]);
  if (state.status === 'restoring') return <AuthLayout><section className="relay-auth-card relay-auth-restoring"><span className="relay-auth-eyebrow">WELCOME TO RELAY</span><h1>Picking up where you left off.</h1><p role="status">Restoring your secure session…</p></section></AuthLayout>;
  if (state.status !== 'authenticated' || !state.user) return <AuthLayout><Auth key={page === 'register' ? 'register' : 'login'} register={page === 'register'} onSwitch={() => navigate(page === 'register' ? 'login' : 'register')} onDemo={onDemo} /></AuthLayout>;
  return <Workspace key={state.user.id} page={page === 'login' || page === 'register' ? 'projects' : page} navigate={navigate} renderProjectPage={renderProjectPage} onLogout={() => void controller.logout()} />;
}

function Workspace({ page, navigate, onLogout, renderProjectPage }: { page: Exclude<Page, 'login' | 'register'>; navigate: (page: Page) => void; onLogout: () => void; renderProjectPage?: (context: LiveProjectContext) => ReactNode }) {
  const { api, state } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]); const [selectedId, setSelectedId] = useState('');
  const [selected, setSelected] = useState<Project | null>(null); const [loading, setLoading] = useState(true);
  const [selectionLoading, setSelectionLoading] = useState(false); const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0); const [mobileOpen, setMobileOpen] = useState(false);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const sidebarRef = useRef<HTMLElement>(null);
  const refreshAccess = () => setRefresh(value => value + 1);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const update = () => { setCompact(media.matches); if (!media.matches) setMobileOpen(false); };
    media.addEventListener('change', update); return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    let active = true; setLoading(true); setError(undefined);
    api.projects().then(items => { if (active) { setProjects(items); if (selectedId && !items.some(project => project.id === selectedId)) { setSelected(null); setSelectedId(''); } } })
      .catch(error => { if (active) { setError(error instanceof Error ? error.message : 'Projects could not be loaded.'); setProjects([]); setSelected(null); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, refresh, selectedId]);
  useEffect(() => {
    let active = true;
    if (!selectedId) return;
    setSelectionLoading(true); setError(undefined);
    api.project(selectedId).then(project => { if (active) setSelected(project); })
      .catch(error => { if (active) { setSelected(null); setError(error instanceof Error ? error.message : 'Project access could not be verified.'); } })
      .finally(() => { if (active) setSelectionLoading(false); });
    return () => { active = false; };
  }, [api, selectedId, refresh]);
  useEffect(() => {
    const update = () => refreshAccess();
    window.addEventListener('focus', update); const interval = window.setInterval(update, 60_000);
    return () => { window.removeEventListener('focus', update); window.clearInterval(interval); };
  }, []);
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.activeElement as HTMLElement | null; const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const controls = () => Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('button, select') ?? []).filter(item => !item.hasAttribute('disabled'));
    controls()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
      if (event.key !== 'Tab') return;
      const items = controls(), first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', key); previous?.focus(); };
  }, [mobileOpen]);
  const go = (next: Page) => { setMobileOpen(false); navigate(next); };
  const select = (id: string) => { setSelected(null); setSelectedId(id); go('overview'); };
  const create = async (request: CreateProjectRequest) => {
    try {
      const response = await api.request<{ project: Project }>('/api/projects', { method: 'POST', body: JSON.stringify(request) });
      const project = projectFrom(response.project); setProjects(current => [...current, project]); select(project.id); return true;
    } catch (error) { setError(error instanceof ApiError ? error.message : 'The project could not be created. Please retry.'); return false; }
  };
  const content = () => {
    if (page === 'projects') return <LiveProjects projects={projects} loading={loading} error={error} onRetry={refreshAccess} onSelect={select} onCreate={create} />;
    if (selectionLoading || loading) return <div className="feature-page"><p role="status">Loading project access…</p></div>;
    if (error) return <div className="feature-page"><p className="field-error" role="alert">{error}</p><Button onClick={refreshAccess}>Retry project access</Button><Button onClick={() => go('projects')}>All projects</Button></div>;
    if (!selected) return <div className="feature-page"><h1>Select a project</h1><Button onClick={() => go('projects')}>All projects<ArrowRight size={18} /></Button></div>;
    if (!canViewPage(page, selected.role)) return <div className="feature-page"><h1>Access restricted</h1><p>Your current project role does not allow this page.</p><Button onClick={refreshAccess}>Refresh project access</Button><Button onClick={() => go('overview')}>Project overview</Button></div>;
    if (page === 'overview') return <LiveOverview project={selected} onNavigate={go} />;
    if (page === 'sources') return null; // Kept mounted below while membership is revalidated.
    if (renderProjectPage) return renderProjectPage({ project: selected, page, api, refreshAccess });
    return <div className="feature-page"><div className="page-heading"><h1>{page === 'project-detail' ? selected.name : projectPages.find(item => item.id === page)?.label}</h1><p>{selected.description || 'No project description provided.'}</p></div><dl className="project-facts"><div><dt>Your project role</dt><dd>{roleLabels[selected.role]}</dd></div><div><dt>Signed in as</dt><dd>{state.user?.email}</dd></div></dl><p className="field-help">This workflow is not connected yet. No project content is shown here. Demo workflow previews are available after signing out and choosing DEMO.</p><Button onClick={refreshAccess}>Refresh project access</Button></div>;
  };
  return <><a className="skip-link" href="#main" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>{mobileOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside ref={sidebarRef} inert={compact && !mobileOpen} className={`sidebar ${mobileOpen ? 'is-open' : ''}`}><div className="brand"><span>relay<span className="brand-dot">.</span></span><Button variant="ghost" className="mobile-close icon-button" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={18} /></Button></div>
      {selected && !loading ? <ProjectNavigation mode="live" projects={projects} selected={selected} role={selected.role} page={page} onSelect={select} onNavigate={go} onProjects={() => go('projects')} /> : <button className="workspace-nav" onClick={() => go('projects')}>All projects</button>}
      <div className="sidebar-bottom"><Button onClick={refreshAccess}>Refresh access</Button><Button onClick={onLogout}>Sign out</Button><p className="sidebar-demo-help">{state.user?.email}</p></div>
    </aside><div className="app-body" inert={mobileOpen}><header className="topbar"><Button variant="ghost" className="mobile-menu icon-button" aria-label="Open navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu size={19} /></Button><nav className="breadcrumbs" aria-label="Breadcrumb"><button onClick={() => go('projects')}>Projects</button>{selected && !loading && !selectionLoading && <span>{selected.name} · {roleLabels[selected.role]}</span>}</nav><span className="topbar-demo">LIVE</span><ThemeToggle /></header><main id="main" tabIndex={-1}>{content()}{page === 'sources' && selected && !error && <div hidden={loading || selectionLoading} inert={loading || selectionLoading}><LiveSourceManager project={selected} api={api} refreshAccess={refreshAccess} /></div>}</main></div></>;
}
