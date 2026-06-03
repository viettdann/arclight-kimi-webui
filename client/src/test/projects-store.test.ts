import { describe, it, expect, beforeEach } from 'vitest';
import type { ProjectSummary } from 'shared/types';
import { cloneErrorMessage, useProjectsStore } from '@/lib/projects-store';

const project = (name: string, status?: ProjectSummary['status']): ProjectSummary => ({
  name,
  workDir: `/work/${name}`,
  origin: 'local',
  ...(status ? { status } : {}),
});

describe('cloneErrorMessage', () => {
  it('maps clone_timeout to a timeout message', () => {
    expect(cloneErrorMessage('clone_timeout')).toBe('Clone timed out');
  });

  it('falls back to a generic failure message for other / missing codes', () => {
    expect(cloneErrorMessage()).toBe('Clone failed');
    expect(cloneErrorMessage('clone_failed')).toBe('Clone failed');
    expect(cloneErrorMessage('clone_canceled')).toBe('Clone failed');
  });
});

describe('useProjectsStore reducers', () => {
  beforeEach(() => {
    useProjectsStore.setState({ projects: [], status: 'idle', error: null, expanded: {} });
  });

  it('addProject appends a ready project and expands it', () => {
    useProjectsStore.getState().addProject(project('alpha'));
    const s = useProjectsStore.getState();
    expect(s.projects).toEqual([{ ...project('alpha'), status: 'ready' }]);
    expect(s.expanded.alpha).toBe(true);
  });

  it('addProject flips an existing cloning placeholder to ready in place', () => {
    useProjectsStore.getState().upsertCloning(project('beta'));
    useProjectsStore.getState().addProject(project('beta'));
    const s = useProjectsStore.getState();
    expect(s.projects).toHaveLength(1);
    expect(s.projects[0]?.status).toBe('ready');
    expect(s.expanded.beta).toBe(true);
  });

  it('upsertCloning adds a cloning placeholder without expanding', () => {
    useProjectsStore.getState().upsertCloning(project('gamma'));
    const s = useProjectsStore.getState();
    expect(s.projects[0]?.status).toBe('cloning');
    expect(s.expanded.gamma).toBeUndefined();
  });

  it('upsertCloning is a no-op when the project already exists', () => {
    useProjectsStore.getState().addProject(project('delta'));
    const before = useProjectsStore.getState().projects;
    useProjectsStore.getState().upsertCloning(project('delta'));
    expect(useProjectsStore.getState().projects).toBe(before);
  });

  it('dropProject removes the project and forgets its expanded flag', () => {
    useProjectsStore.getState().addProject(project('one'));
    useProjectsStore.getState().addProject(project('two'));
    useProjectsStore.getState().dropProject('one');
    const s = useProjectsStore.getState();
    expect(s.projects.map((p) => p.name)).toEqual(['two']);
    expect('one' in s.expanded).toBe(false);
  });

  it('dropProject is a no-op for an unknown name', () => {
    useProjectsStore.getState().addProject(project('keep'));
    const before = useProjectsStore.getState().projects;
    useProjectsStore.getState().dropProject('nope');
    expect(useProjectsStore.getState().projects).toBe(before);
  });

  it('toggleExpanded flips the flag both ways', () => {
    useProjectsStore.getState().toggleExpanded('x');
    expect(useProjectsStore.getState().expanded.x).toBe(true);
    useProjectsStore.getState().toggleExpanded('x');
    expect(useProjectsStore.getState().expanded.x).toBe(false);
  });

  it('expand is idempotent and never re-opens', () => {
    useProjectsStore.getState().expand('y');
    expect(useProjectsStore.getState().expanded.y).toBe(true);
    const before = useProjectsStore.getState().expanded;
    useProjectsStore.getState().expand('y');
    // Already expanded → same object reference, no churn.
    expect(useProjectsStore.getState().expanded).toBe(before);
  });
});
