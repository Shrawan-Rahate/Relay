import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronRight, CircleHelp, Command, FolderClosed, Menu, Search, X } from 'lucide-react';
import type { CreateProjectRequest, ReviewRequest } from '../../shared/api-types';
import Dashboard from './pages/Dashboard';
import KnowledgeGaps from './pages/KnowledgeGaps';
import SourceManager from './pages/SourceManager';
import Intelligence from './pages/Intelligence';
import Clarifications from './pages/Clarifications';
import ReviewerQueue from './pages/ReviewerQueue';
import VerifiedHandover from './pages/VerifiedHandover';
import SuccessorWorkspace from './pages/SuccessorWorkspace';
import Auth from './pages/Auth';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import ProjectNavigation from './components/ProjectNavigation';
import { buildHandoverPreview, publicationPreview, type DemoHandoverVersion } from './data/handovers';
import { initialAnswers, isReviewable, type DemoAnswer } from './data/clarifications';
import { canViewPage, projectPages, sampleProject, type ProjectPage, type ProjectPreview, type RoleView } from './data/project-ui';
import { Badge, Button, Modal, SourceIcon } from './components/ui';
import { gaps, sources, type DemoSource } from './data/demo';

type Page = ProjectPage | 'projects' | 'login' | 'register';
const pageLabels: Record<Page, string> = {
  overview: 'Overview', gaps: 'Knowledge gaps', sources: 'Source Manager', intelligence: 'AI Intelligence',
  clarifications: 'Clarifications', reviews: 'Reviewer Queue', handover: 'Verified Handover', successor: 'Successor Workspace',
  'project-detail': 'Project & members', projects: 'Projects', login: 'Login', register: 'Register',
};
const pageFromHash = (): Page => {
  const hash = window.location.hash.slice(1);
  return Object.prototype.hasOwnProperty.call(pageLabels, hash) ? hash as Page : 'overview';
};
export default function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  const [gapId, setGapId] = useState<string>();
  const [projects, setProjects] = useState<ProjectPreview[]>([sampleProject]);
  const [selectedProjectId, setSelectedProjectId] = useState(sampleProject.id);
  const [roleView, setRoleView] = useState<RoleView>('ALL_DEMO');
  const selectedProject = projects.find(project => project.id === selectedProjectId);
  const isSampleProject = selectedProject?.id === sampleProject.id;
  const [answers, setAnswers] = useState<DemoAnswer[]>(() => initialAnswers.map(answer => ({ ...answer, decisions: [] })));
  const previewDecision = (id: string, request: ReviewRequest) => setAnswers(current => current.map(answer => answer.id === id && isReviewable(answer) ? { ...answer, decisions: [...answer.decisions, { sequence: answer.decisions.length + 1, previewOrder: current.reduce((count, item) => count + item.decisions.length, 0) + 1, request }] } : answer));
  const [versions, setVersions] = useState<DemoHandoverVersion[]>([]);
  const [successorVersion, setSuccessorVersion] = useState<number | null>(null);
  const [acknowledgedVersions, setAcknowledgedVersions] = useState<number[]>([]);
  const handoverContent = buildHandoverPreview(answers);
  const previewPublication = () => {
    const nextVersion = versions.length + 1;
    setVersions(current => [...current, publicationPreview(handoverContent, nextVersion)]);
    return nextVersion;
  };
  const previewAcknowledgment = (version: number) => {
    if (versions.some(item => item.version === version)) setAcknowledgedVersions(current => current.includes(version) ? current : [...current, version]);
  };
  const [mobileOpen, setMobileOpen] = useState(false);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const update = () => { setCompact(media.matches); if (!media.matches) setMobileOpen(false); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const controls = () => Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('button, select, input, a[href]') ?? []).filter(control => control.getClientRects().length > 0 && !control.hasAttribute('disabled'));
    controls()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
      if (event.key !== 'Tab') return;
      const elements = controls();
      const first = elements[0]; const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, [mobileOpen]);
  const [modal, setModal] = useState<'search' | 'help' | 'workspace' | null>(null);
  const [source, setSource] = useState<DemoSource | null>(null);
  const [search, setSearch] = useState('');
  const navigate = (next: Page, id?: string) => { setPage(next); setGapId(id); setMobileOpen(false); window.location.hash = next; };
  const selectProject = (id: string, next: ProjectPage = 'overview') => {
    if (!projects.some(project => project.id === id)) return;
    setSelectedProjectId(id); setRoleView('ALL_DEMO'); setSource(null); setModal(null); setSearch(''); navigate(next);
  };
  const createProjectPreview = (request: CreateProjectRequest) => setProjects(current => [...current, { id: `demo-local-project-${crypto.randomUUID()}`, name: request.name, description: request.description ?? null, origin: 'local' }]);
  useEffect(() => { const update = () => setPage(pageFromHash()); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  useEffect(() => { document.title = `Relay · ${pageLabels[page]}`; }, [page]);
  useEffect(() => { const keydown = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key === 'k') { event.preventDefault(); setModal(current => current === 'search' ? null : 'search'); } }; window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown); }, []);
  const results = isSampleProject ? gaps.filter(gap => `${gap.title} ${gap.question}`.toLowerCase().includes(search.toLowerCase())) : [];
  const sourceResults = isSampleProject ? sources.filter(source => source.filename.toLowerCase().includes(search.toLowerCase())) : [];
  const isProjectPage = projectPages.some(item => item.id === page);
  const renderPage = () => {
    if (page === 'login' || page === 'register') return <Auth key={page} register={page === 'register'} onSwitch={() => navigate(page === 'register' ? 'login' : 'register')} onProjects={() => navigate('projects')} />;
    if (page === 'projects') return <Projects projects={projects} selectedId={selectedProjectId} onSelect={id => selectProject(id, 'project-detail')} onCreate={createProjectPreview} />;
    if (page === 'project-detail') return <ProjectDetail key={selectedProjectId} project={selectedProject} role={roleView} onOverview={() => navigate('overview')} onProjects={() => navigate('projects')} />;
    if (isProjectPage && !canViewPage(page as ProjectPage, roleView)) return <div className="feature-page"><div className="page-heading"><h1>{pageLabels[page]}</h1><p>This screen is outside the selected DEMO role view.</p></div><p className="feature-demo-note">This is a navigation preview, not authentication or authorization. Use the DEMO role selector to explore another view.</p><Button variant="primary" onClick={() => navigate('overview')}>Return to project overview<ArrowRight size={18} /></Button></div>;
    if (!isSampleProject) return <div className="feature-page"><div className="page-heading"><h1>{pageLabels[page]}</h1><p>{selectedProject?.name ?? 'No project selected'}</p></div><p className="feature-demo-note">DEMO · This local project preview has no loaded source, gap, review, or handover data. The sample project’s fixtures are kept separate.</p><Button variant="primary" onClick={() => navigate('project-detail')}>View project details<ArrowRight size={18} /></Button><button className="inline-link local-project-sample-link" onClick={() => selectProject(sampleProject.id)}>Explore the sample project<ArrowRight size={18} /></button></div>;
    switch (page) {
      case 'overview': return <Dashboard onGaps={() => navigate('gaps')} onSource={setSource} />;
      case 'sources': return <SourceManager readOnly={roleView === 'INCOMING'} onSource={setSource} onAnalyze={() => navigate('intelligence')} />;
      case 'intelligence': return <Intelligence onSource={setSource} onSources={() => navigate('sources')} />;
      case 'clarifications': return <Clarifications canOpenQueue={roleView === 'ALL_DEMO'} answers={answers} onAdd={answer => setAnswers(current => [...current, answer])} onSource={setSource} onQueue={() => navigate('reviews')} />;
      case 'reviews': return <ReviewerQueue answers={answers} onDecision={previewDecision} onSource={setSource} />;
      case 'handover': return <VerifiedHandover canOpenSuccessor={roleView === 'ALL_DEMO'} content={handoverContent} versions={versions} onPublishPreview={previewPublication} onSource={setSource} onReview={() => navigate('reviews')} onSuccessor={version => { setSuccessorVersion(version); navigate('successor'); }} />;
      case 'successor': return <SuccessorWorkspace canPrepareHandover={roleView === 'ALL_DEMO'} versions={versions} selectedVersion={successorVersion} onSelect={setSuccessorVersion} acknowledgedVersions={acknowledgedVersions} onAcknowledge={previewAcknowledgment} onHandover={() => navigate(roleView === 'ALL_DEMO' ? 'handover' : 'overview')} onSource={setSource} />;
      default: return <KnowledgeGaps key={gapId ?? 'all'} initialId={gapId} onSource={setSource} />;
    }
  };
  return <><a className="skip-link" href="#main" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>{mobileOpen && <button className="sidebar-backdrop" tabIndex={-1} aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside ref={sidebarRef} inert={compact && !mobileOpen} className={`sidebar ${mobileOpen ? 'is-open' : ''}`}><div className="brand"><svg width="28" height="30" viewBox="0 0 28 30" fill="none" aria-hidden="true"><path d="M3 23V7h9a6 6 0 0 1 0 12H8" stroke="currentColor" strokeWidth="3.2" /><path d="m14 17 10 9M19 4h6v6" stroke="currentColor" strokeWidth="3.2" /></svg><span>relay<span className="brand-dot">.</span></span><Button className="mobile-close icon-button" variant="ghost" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={18} /></Button></div>
      <ProjectNavigation projects={projects} selected={selectedProject} role={roleView} page={page} onSelect={selectProject} onRole={role => { setRoleView(role); setSource(null); setModal(null); }} onNavigate={navigate} onProjects={() => navigate('projects')} />
      <div className="sidebar-bottom"><button className="sidebar-search" onClick={() => setModal('search')}><Search size={17} /><span>Search context</span><kbd>⌘ K</kbd></button><button className="settings-button" onClick={() => navigate('login')}>Login form preview<ArrowRight size={16} /></button><button className="settings-button" onClick={() => navigate('register')}>Register form preview<ArrowRight size={16} /></button><button className="settings-button" onClick={() => setModal('help')}><CircleHelp size={18} />How Relay works</button><button className="settings-button" onClick={() => setModal('workspace')}>About this demo<ArrowRight size={16} /></button></div>
    </aside>
    <div className="app-body" inert={mobileOpen}><header className="topbar"><Button variant="ghost" className="mobile-menu icon-button" aria-label="Open navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu size={19} /></Button><nav className="breadcrumbs" aria-label="Breadcrumb"><button onClick={() => navigate('projects')}>Projects</button>{isProjectPage && selectedProject && <><ChevronRight size={13} /><button className="breadcrumb-project" onClick={() => navigate('project-detail')}><span className="project-symbol"><FolderClosed size={12} /></span>{selectedProject.name}</button></>}<ChevronRight size={13} /><span aria-current="page">{pageLabels[page]}</span></nav><span className="topbar-demo">DEMO</span></header>
      <main id="main" tabIndex={-1}>{renderPage()}</main>
    </div>
    {source && <Modal title={source.filename} onClose={() => setSource(null)}><div className="source-modal-meta"><SourceIcon type={source.type} /><span>{source.description}</span><Badge>DEMO</Badge></div><pre className="source-content">{source.content}</pre><div className="linked-evidence"><h3>Questions referencing this source</h3>{gaps.filter(gap => gap.evidence.some(evidence => evidence.sourceId === source.id)).map(gap => <button key={gap.id} className="inline-link" onClick={() => { setSource(null); navigate('gaps', gap.id); }}>{gap.question}<ArrowRight size={18} /></button>)}{!gaps.some(gap => gap.evidence.some(evidence => evidence.sourceId === source.id)) && <p className="field-help">No demo questions reference this example.</p>}</div><p className="footnote">Fixture content · No production source has been imported.</p></Modal>}
    {modal === 'search' && <Modal title="Find your context" onClose={() => setModal(null)}><label className="global-search"><Search size={18} /><input autoFocus placeholder="Search questions and sources…" value={search} onChange={event => setSearch(event.target.value)} aria-label="Search questions and sources" /><Command size={15} /><kbd>K</kbd></label><div className="search-results"><div className="eyebrow">KNOWLEDGE GAPS</div>{results.map(gap => <button key={gap.id} onClick={() => { navigate('gaps', gap.id); setModal(null); }}><CircleHelp size={16} /><span>{gap.title}<small>{gap.shortId}</small></span><ArrowRight size={15} /></button>)}<div className="eyebrow">SOURCE MATERIAL</div>{sourceResults.map(source => <button key={source.id} onClick={() => { setModal(null); setSource(source); }}><SourceIcon type={source.type} /><span>{source.filename}</span><ArrowRight size={15} /></button>)}{results.length === 0 && sourceResults.length === 0 && <p className="empty-search">{isSampleProject ? 'No results. Try “webhook” or “architecture”.' : 'No context loaded for this local project preview.'}</p>}</div></Modal>}
    {modal === 'help' && <Modal title="Knowledge, carried forward." onClose={() => setModal(null)}><p className="modal-intro">Relay helps teams reconstruct project context, ask better questions, and pass on reviewed knowledge.</p><ol className="help-steps"><li><strong>Connect</strong>Bring in documents, task exports, and repository context.</li><li><strong>Reconstruct</strong>Extract claims with evidence. Claims remain unverified.</li><li><strong>Verify & review</strong>Outgoing members clarify gaps. Reviewers verify their answers.</li><li><strong>Handover</strong>Publish an immutable snapshot for the incoming team.</li></ol><div className="demo-callout">No users, sessions, memberships, imports, or AI runs are created. All interactions are local previews.</div></Modal>}
    {modal === 'workspace' && <Modal title="About this demo" onClose={() => setModal(null)}><p className="modal-intro">Selected context: {selectedProject?.name ?? 'none'}. Project selection and the role selector only change the demo UI.</p><div className="demo-callout">There is no signed-in identity. No real memberships, approvals, published handovers, or receipts are represented. Local previews disappear on reload; no session tokens are stored.</div><Button variant="primary" onClick={() => setModal(null)}>Back to demo<ArrowRight size={15} /></Button></Modal>}
  </>;
}
