import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X, ArrowUpRight, FileText, Github, Table2 } from 'lucide-react';
import type { SourceType } from '../../../shared/api-types';

export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  return <button className={`button button-${variant} ${className}`} {...props} />;
}
export function Badge({ children, tone = 'neutral', dot = false }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'purple'; dot?: boolean }) {
  return <span className={`badge badge-${tone}`}>{dot && <span className="status-dot" />}{children}</span>;
}
export function SourceIcon({ type }: { type: SourceType }) {
  const Icon = type === 'GITHUB' ? Github : type === 'CSV' ? Table2 : FileText;
  return <span className={`source-icon ${type === 'CSV' ? 'source-csv' : ''}`}><Icon size={17} strokeWidth={1.6} /></span>;
}
export function SectionTitle({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="section-title"><h2>{title}</h2>{children}</div>;
}
export function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button className="text-link" onClick={onClick}>{children}<ArrowUpRight size={14} /></button>;
}
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); }; }, []);
  return <dialog ref={ref} className="modal" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }} aria-labelledby="modal-title">
    <div className="modal-header"><h2 id="modal-title">{title}</h2><Button variant="ghost" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18} /></Button></div>
    <div className="modal-body">{children}</div>
  </dialog>;
}
