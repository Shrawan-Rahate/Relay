import { ArrowRight } from 'lucide-react';
import { Button } from '../components/ui';
import MembershipManager from '../components/MembershipManager';
import { roleLabels, type ProjectPreview, type RoleView } from '../data/project-ui';

export default function ProjectDetail({ project, role, onOverview, onProjects }: { project?: ProjectPreview; role: RoleView; onOverview: () => void; onProjects: () => void }) {
  if (!project) return <div className="feature-page"><div className="page-heading"><h1>Project details</h1></div><div className="empty-state"><h2>Select a project first</h2><p>No project context is selected.</p><Button variant="primary" onClick={onProjects}>Browse demo projects<ArrowRight size={18} /></Button></div></div>;
  return <div className="feature-page project-detail-page"><div className="page-heading"><h1>{project.name}</h1><p>Project details & membership management</p></div><p className="feature-demo-note">DEMO · {project.origin === 'fixture' ? 'Sample project fixture.' : 'Locally created project preview.'} No real project, authenticated user, or membership is represented.</p><section><h2>Project context</h2><p className="project-description preserve-text">{project.description || 'No description provided for this preview.'}</p><dl className="project-facts"><div><dt>Origin</dt><dd>{project.origin === 'fixture' ? 'DEMO fixture' : 'Non-persistent local preview'}</dd></div><div><dt>Navigation role preview</dt><dd>{role === 'ALL_DEMO' ? 'All demo views' : roleLabels[role]}</dd></div><div><dt>Actual project membership</dt><dd>Not loaded · No signed-in identity</dd></div></dl><Button onClick={onOverview}>Open project overview<ArrowRight size={18} /></Button></section><MembershipManager key={`${project.id}-${role}`} role={role} /></div>;
}
