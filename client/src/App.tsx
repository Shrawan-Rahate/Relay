import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, ChevronRight, CircleHelp, Command, Files, ScanText, FolderClosed, LayoutDashboard, Menu, MessageSquare, ClipboardCheck, Search, X } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import KnowledgeGaps from './pages/KnowledgeGaps';
import SourceManager from './pages/SourceManager';
import Intelligence from './pages/Intelligence';
import Clarifications from './pages/Clarifications';
import ReviewerQueue from './pages/ReviewerQueue';
import { initialAnswers, isReviewable, type DemoAnswer } from './data/clarifications';
import type { ReviewRequest } from '../../shared/api-types';
import { Badge, Button, Modal, SourceIcon } from './components/ui';
import { gaps, project, sources, type DemoSource } from './data/demo';

type Page = 'overview' | 'gaps' | 'sources' | 'intelligence' | 'clarifications' | 'reviews';
const pageLabels: Record<Page, string> = { overview: 'Overview', gaps: 'Knowledge gaps', sources: 'Source Manager', intelligence: 'AI Intelligence', clarifications: 'Clarifications', reviews: 'Reviewer Queue' };
const pageFromHash = (): Page => {
  const hash = window.location.hash.slice(1);
  return hash === 'gaps' || hash === 'sources' || hash === 'intelligence' || hash === 'clarifications' || hash === 'reviews' ? hash : 'overview';
};
export default function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  const [gapId, setGapId] = useState<string>();
  const [answers, setAnswers] = useState<DemoAnswer[]>(() => initialAnswers.map(answer => ({ ...answer, decisions: [] })));
  const previewDecision = (id: string, request: ReviewRequest) => setAnswers(current => current.map(answer => answer.id === id && isReviewable(answer) ? { ...answer, decisions: [...answer.decisions, { sequence: answer.decisions.length + 1, request }] } : answer));
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
    const controls = () => Array.from(sidebarRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []).filter(button => button.getClientRects().length > 0);
    controls()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
      if (event.key !== 'Tab') return;
      const buttons = controls();
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
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
  useEffect(() => { const update = () => setPage(pageFromHash()); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  useEffect(() => { document.title = `Relay · ${pageLabels[page]}`; }, [page]);
  useEffect(() => { const keydown = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setModal(m => m === 'search' ? null : 'search'); } }; window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown); }, []);
  const results = gaps.filter(g => `${g.title} ${g.question}`.toLowerCase().includes(search.toLowerCase()));
  return <><a className="skip-link" href="#main">Skip to content</a>{mobileOpen && <button className="sidebar-backdrop" tabIndex={-1} aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside ref={sidebarRef} inert={compact && !mobileOpen} className={`sidebar ${mobileOpen ? 'is-open' : ''}`}><div className="brand"><svg width="28" height="30" viewBox="0 0 28 30" fill="none" aria-hidden="true"><path d="M3 23V7h9a6 6 0 0 1 0 12H8" stroke="currentColor" strokeWidth="3.2" /><path d="m14 17 10 9M19 4h6v6" stroke="currentColor" strokeWidth="3.2" /></svg><span>relay<span className="brand-dot">.</span></span><Button className="mobile-close icon-button" variant="ghost" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={18} /></Button></div>
      <button className="workspace-switch" onClick={() => setModal('workspace')}><FolderClosed size={20} /><span>Demo workspace</span><ChevronDown size={14} /></button>
      <button className="sidebar-search" onClick={() => setModal('search')}><Search size={15} /><span>Search anything</span><kbd>⌘ K</kbd></button>
      <div className="nav-label">WORKSPACE</div><button className="workspace-nav" onClick={() => navigate('overview')}><FolderClosed size={17} />Projects<span>1</span></button>
      <div className="sidebar-project"><div><span className="project-dot" />Customer platform<ChevronDown size={13} /></div><nav aria-label="Project navigation"><button className={page === 'overview' ? 'active' : ''} aria-current={page === 'overview' ? 'page' : undefined} onClick={() => navigate('overview')}><LayoutDashboard size={17} />Overview</button><button className={page === 'sources' ? 'active' : ''} aria-current={page === 'sources' ? 'page' : undefined} onClick={() => navigate('sources')}><Files size={17} />Source Manager</button><button className={page === 'intelligence' ? 'active' : ''} aria-current={page === 'intelligence' ? 'page' : undefined} onClick={() => navigate('intelligence')}><ScanText size={17} />AI Intelligence</button><button className={page === 'gaps' ? 'active' : ''} aria-current={page === 'gaps' ? 'page' : undefined} onClick={() => navigate('gaps')}><CircleHelp size={17} />Knowledge gaps<span className="nav-count">{gaps.filter(g => g.status === 'OPEN').length}</span></button><button className={page === 'clarifications' ? 'active' : ''} aria-current={page === 'clarifications' ? 'page' : undefined} onClick={() => navigate('clarifications')}><MessageSquare size={17} />Clarifications</button><button className={page === 'reviews' ? 'active' : ''} aria-current={page === 'reviews' ? 'page' : undefined} onClick={() => navigate('reviews')}><ClipboardCheck size={17} />Reviewer Queue</button></nav></div>
      <div className="sidebar-bottom"><button className="settings-button" onClick={() => setModal('help')}><CircleHelp size={18} />How Relay works</button><button className="settings-button" onClick={() => setModal('workspace')}>About this demo<ArrowRight size={16} /></button></div>
    </aside>
    <div className="app-body" inert={mobileOpen}><header className="topbar"><Button variant="ghost" className="mobile-menu icon-button" aria-label="Open navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu size={19} /></Button><nav className="breadcrumbs" aria-label="Breadcrumb"><button onClick={() => navigate('overview')}>Projects</button><ChevronRight size={13} /><button className="breadcrumb-project" onClick={() => navigate('overview')}><span className="project-symbol"><FolderClosed size={12} /></span>{project.name}</button><ChevronRight size={13} /><span aria-current="page">{pageLabels[page]}</span></nav><span className="topbar-demo">DEMO</span></header>
      <main id="main" tabIndex={-1}>{page === 'overview' ? <Dashboard onGaps={() => navigate('gaps')} onSource={setSource} /> : page === 'sources' ? <SourceManager onSource={setSource} onAnalyze={() => navigate('intelligence')} /> : page === 'intelligence' ? <Intelligence onSource={setSource} onSources={() => navigate('sources')} /> : page === 'clarifications' ? <Clarifications answers={answers} onAdd={answer => setAnswers(current => [...current, answer])} onSource={setSource} onQueue={() => navigate('reviews')} /> : page === 'reviews' ? <ReviewerQueue answers={answers} onDecision={previewDecision} onSource={setSource} /> : <KnowledgeGaps key={gapId ?? 'all'} initialId={gapId} onSource={setSource} />}</main>
    </div>
    {source && <Modal title={source.filename} onClose={() => setSource(null)}><div className="source-modal-meta"><SourceIcon type={source.type} /><span>{source.description}</span><Badge>DEMO</Badge></div><pre className="source-content">{source.content}</pre><div className="linked-evidence"><h3>Questions referencing this source</h3>{gaps.filter(gap => gap.evidence.some(evidence => evidence.sourceId === source.id)).map(gap => <button key={gap.id} className="inline-link" onClick={() => { setSource(null); navigate('gaps', gap.id); }}>{gap.question}<ArrowRight size={18} /></button>)}{!gaps.some(gap => gap.evidence.some(evidence => evidence.sourceId === source.id)) && <p className="field-help">No demo questions reference this example.</p>}</div><p className="footnote">Fixture content · Original text shown without formatting. No production source has been imported.</p></Modal>}
    {modal === 'search' && <Modal title="Find your context" onClose={() => setModal(null)}><label className="global-search"><Search size={18} /><input autoFocus placeholder="Search questions and sources…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search questions and sources" /><Command size={15} /><kbd>K</kbd></label><div className="search-results"><div className="eyebrow">KNOWLEDGE GAPS</div>{results.map(g => <button key={g.id} onClick={() => { navigate('gaps', g.id); setModal(null); }}><CircleHelp size={16} /><span>{g.title}<small>{g.shortId}</small></span><ArrowRight size={15} /></button>)}<div className="eyebrow">SOURCE MATERIAL</div>{sources.filter(s => s.filename.toLowerCase().includes(search.toLowerCase())).map(s => <button key={s.id} onClick={() => { setModal(null); setSource(s); }}><SourceIcon type={s.type} /><span>{s.filename}</span><ArrowRight size={15} /></button>)}{results.length === 0 && !sources.some(s => s.filename.toLowerCase().includes(search.toLowerCase())) && <p className="empty-search">No results. Try “webhook” or “architecture”.</p>}</div></Modal>}
    {modal === 'help' && <Modal title="Knowledge, carried forward." onClose={() => setModal(null)}><p className="modal-intro">Relay helps teams reconstruct project context, ask better questions, and pass on reviewed knowledge.</p><ol className="help-steps"><li><strong>Connect</strong>Bring in documents, task exports, and repository context.</li><li><strong>Reconstruct</strong>Extract claims with evidence. Claims remain unverified.</li><li><strong>Verify & review</strong>Outgoing members clarify gaps. Reviewers verify their answers.</li><li><strong>Handover</strong>Publish an immutable snapshot for the incoming team.</li></ol><div className="demo-callout">This frontend uses labelled demo fixtures. No sources have been imported, no AI has run, and no data is sent to a server.</div></Modal>}
    {modal === 'workspace' && <Modal title="Demo workspace" onClose={() => setModal(null)}><p className="modal-intro">You’re exploring the Customer platform transition with sample source material and questions.</p><div className="demo-callout">All questions and source documents are DEMO fixtures. No real members, approvals, extraction runs, or published handovers are represented. Clarification and review actions only update non-persistent local previews. Live data will come from API integration.</div><Button variant="primary" onClick={() => setModal(null)}>Back to workspace<ArrowRight size={15} /></Button></Modal>}
  </>;
}
