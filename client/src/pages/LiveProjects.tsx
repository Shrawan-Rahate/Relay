import { useState, type FormEvent } from 'react';
import type { CreateProjectRequest, Project } from '../../../shared/api-types';
import { ArrowRight, Search } from 'lucide-react';
import { Button } from '../components/ui';
import { projectErrors, roleLabels, type FieldErrors } from '../data/project-ui';

export default function LiveProjects({ projects, loading, error, onRetry, onSelect, onCreate }: {
  projects: Project[]; loading: boolean; error?: string; onRetry: () => void; onSelect: (id: string) => void;
  onCreate: (request: CreateProjectRequest) => Promise<boolean>;
}) {
  const [query, setQuery] = useState(''); const [name, setName] = useState(''); const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({}); const [creating, setCreating] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); const request = { name: name.trim(), ...(description ? { description } : {}) };
    const issues = projectErrors(request); setErrors(issues); if (Object.keys(issues).length) return;
    setCreating(true);
    try { if (await onCreate(request)) { setName(''); setDescription(''); } } finally { setCreating(false); }
  };
  const visible = projects.filter(project => `${project.name} ${project.description ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="feature-page projects-page"><div className="page-heading"><h1>Projects</h1><p>Select a project you belong to, or create a new project.</p></div>
    {error && <div role="alert" className="analysis-error"><p>{error}</p><Button onClick={onRetry} disabled={loading}>Retry loading projects</Button></div>}
    {loading ? <p role="status">Loading project memberships…</p> : <><label className="list-search"><Search size={20} /><input aria-label="Search projects" placeholder="Search projects" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {visible.length ? <div className="project-list">{visible.map(project => <button className="project-list-row" key={project.id} onClick={() => onSelect(project.id)}><span><strong>{project.name}</strong><span>{project.description || 'No description provided.'}</span><small>{roleLabels[project.role]}</small></span><ArrowRight size={20} /><span className="sr-only">Select project and view details</span></button>)}</div> : !error && <div className="empty-state"><h2>{query ? 'No matching projects' : 'No project memberships yet'}</h2><p>{query ? 'Try another search.' : 'Create a project, or ask a reviewer to add your registered Relay email.'}</p></div>}</>}
    <section className="workflow-section"><h2>Create project</h2><p>You become a reviewer only after Relay creates the project and its membership.</p><form onSubmit={submit} noValidate><fieldset className="auth-fields" disabled={creating || loading}><label className="field-label" htmlFor="live-project-name">Project name</label><input id="live-project-name" className="text-input" required maxLength={200} value={name} onChange={event => setName(event.target.value)} aria-invalid={!!errors.name} /><p className="field-error">{errors.name}</p><label className="field-label" htmlFor="live-project-description">Description (optional)</label><textarea id="live-project-description" className="text-input" rows={4} maxLength={5000} value={description} onChange={event => setDescription(event.target.value)} /><p className="field-error">{errors.description}</p><Button variant="primary" type="submit">{creating ? 'Creating project…' : 'Create project'}<ArrowRight size={18} /></Button></fieldset></form></section>
  </div>;
}
