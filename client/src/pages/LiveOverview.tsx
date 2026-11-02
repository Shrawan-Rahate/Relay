import { ArrowRight } from 'lucide-react';
import type { Project, ProjectRole } from '../../../shared/api-types';
import { Badge, Button } from '../components/ui';
import { roleLabels, type ProjectPage } from '../data/project-ui';
import './live-overview.css';

type Overview = {
  introduction: string;
  action: string;
  destination: ProjectPage;
  sections: { title: string; explanation: string }[];
};

const overviews: Record<ProjectRole, Overview> = {
  REVIEWER: {
    introduction: 'Review answers, identify unresolved knowledge, and prepare the handover.',
    action: 'Review answers', destination: 'reviews',
    sections: [
      { title: 'Pending review queue', explanation: 'The live review queue is not connected to this Overview. Pending and deferred answers cannot be shown yet.' },
      { title: 'Open knowledge gaps', explanation: 'Live knowledge gaps are not connected to this Overview. Their absence here does not mean all questions are resolved.' },
      { title: 'Team members and their roles', explanation: 'The live member list is not connected to this Overview. Only your own role has been loaded from project access.' },
      { title: 'Latest published handover', explanation: 'Published handovers are not connected to this Overview. Publication status and the latest version are unknown here.' },
    ],
  },
  OUTGOING: {
    introduction: 'Clarify the source material and help the next team understand what remains unknown.',
    action: 'Answer questions', destination: 'clarifications',
    sections: [
      { title: 'Connected sources', explanation: 'The live source list is not connected to this Overview. No source count or connection status is available here.' },
      { title: 'Unverified AI claims', explanation: 'Live AI claims are not connected to this Overview. Extracted claims must remain unverified until supported by the review workflow.' },
      { title: 'Open clarification questions', explanation: 'Live clarification questions are not connected to this Overview. No unanswered-question count is available here.' },
      { title: 'Submitted answers and review status', explanation: 'Live answers and their effective review status are not connected to this Overview. No submission or approval is implied.' },
    ],
  },
  INCOMING: {
    introduction: 'Read the published handover, distinguish confirmed knowledge from unknowns, and inspect next actions.',
    action: 'Read handover', destination: 'successor',
    sections: [
      { title: 'Latest published handover', explanation: 'Published handovers are not connected to this Overview. Publication status and the latest version are unknown here.' },
      { title: 'Confirmed knowledge and unknowns', explanation: 'Published snapshot content is not connected to this Overview. Confirmed knowledge and unresolved questions cannot be shown yet.' },
      { title: 'Evidence-backed next actions', explanation: 'Published actions and their supporting evidence are not connected to this Overview. No actions, owners, or deadlines are inferred.' },
      { title: 'Acknowledgment status', explanation: 'Your receipt for the published handover version is not connected to this Overview. Reading this page does not acknowledge a handover.' },
    ],
  },
};

/** Presentation only: backend project membership selects content, never authorizes a mutation. */
export default function LiveOverview({ project, onNavigate }: { project: Project; onNavigate: (page: ProjectPage) => void }) {
  const overview = overviews[project.role];
  return <div className="dashboard live-overview">
    <div className="page-heading"><p className="live-overview-eyebrow">Project overview · LIVE</p><h1>{project.name}</h1><p>{project.description || 'No project description provided.'}</p><Badge>Your project role: {roleLabels[project.role]}</Badge></div>
    <section className="handover-banner" aria-labelledby="overview-focus"><div><h2 id="overview-focus">{roleLabels[project.role]} overview</h2><p>{overview.introduction}</p></div><Button variant="primary" onClick={() => onNavigate(overview.destination)} aria-describedby="overview-integration-note">{overview.action}<ArrowRight size={20} aria-hidden="true" /></Button></section>
    <p id="overview-integration-note" className="live-overview-note">Live workflow data is not integrated yet. The action opens its workspace page; workflow tools may be unavailable there. Unavailable does not mean empty.</p>
    <div className="live-overview-grid">{overview.sections.map((section, index) => <section className="live-overview-card" key={section.title} aria-labelledby={`overview-section-${index}`}><h2 id={`overview-section-${index}`}>{section.title}</h2><Badge>Unavailable</Badge><p>{section.explanation}</p></section>)}</div>
  </div>;
}
