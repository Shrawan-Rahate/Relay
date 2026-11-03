import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Project } from '../../../shared/api-types';
import { ApiError, type RelayApi } from '../lib/api';
import { workflowError } from '../lib/workflow-api';
import { Button } from './ui';
import './live-workflow.css';

export type WorkflowProps = { project: Project; api: RelayApi; refreshAccess: () => void };
export type FailureHandler = (error: unknown, display: (message: string) => void) => void;
export type WorkflowContext = WorkflowProps & { fail: FailureHandler };
/** Every async operation captures a ticket; cleanup invalidates it, including StrictMode cleanup. */
export function useWorkflowTicket() {
  const epoch = useRef(0);
  useEffect(() => { ++epoch.current; return () => { ++epoch.current; }; }, []);
  return useCallback(() => { const current = epoch.current; return () => current === epoch.current; }, []);
}
export function LiveWorkflowBoundary({ children, ...props }: WorkflowProps & { children: (context: WorkflowContext) => ReactNode }) {
  return <ScopedBoundary key={`${props.project.id}:${props.project.role}`} {...props}>{children}</ScopedBoundary>;
}
function ScopedBoundary({ children, ...props }: WorkflowProps & { children: (context: WorkflowContext) => ReactNode }) {
  const [denied, setDenied] = useState('');
  useEffect(() => { setDenied(''); }, [props.project]);
  const fail = useCallback<FailureHandler>((error, display) => {
    if (error instanceof ApiError && [401, 403, 404].includes(error.status)) setDenied(workflowError(error));
    else display(workflowError(error));
  }, []);
  if (denied) return <div className="feature-page live-workflow"><p className="field-error" role="alert">{denied}</p><Button onClick={props.refreshAccess}>Refresh project access</Button></div>;
  return children({ ...props, fail });
}
export function WorkflowError({ message, retry }: { message: string; retry?: () => void }) {
  return message ? <div><p className="field-error" role="alert">{message}</p>{retry && <Button type="button" onClick={retry}>Retry loading</Button>}</div> : null;
}
export function Provenance({ value }: { value: unknown }) {
  return <details><summary>Model and source provenance</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>;
}
