import { describe, it, expect, beforeEach } from 'vitest';
import { useRightSidebarStore } from '@/lib/right-sidebar-store';
import { useSidebarViewStore } from '@/lib/sidebar-view-store';

describe('useRightSidebarStore', () => {
  beforeEach(() => {
    useRightSidebarStore.setState({ open: false });
  });

  it('starts closed', () => {
    expect(useRightSidebarStore.getState().open).toBe(false);
  });

  it('toggle flips open state both ways', () => {
    useRightSidebarStore.getState().toggle();
    expect(useRightSidebarStore.getState().open).toBe(true);
    useRightSidebarStore.getState().toggle();
    expect(useRightSidebarStore.getState().open).toBe(false);
  });

  it('close forces closed regardless of current state', () => {
    useRightSidebarStore.getState().toggle();
    useRightSidebarStore.getState().close();
    expect(useRightSidebarStore.getState().open).toBe(false);
  });
});

describe('useSidebarViewStore', () => {
  beforeEach(() => {
    useSidebarViewStore.setState({ filesOpen: false });
  });

  it('starts on the tasks view', () => {
    expect(useSidebarViewStore.getState().filesOpen).toBe(false);
  });

  it('openFiles switches to the files view', () => {
    useSidebarViewStore.getState().openFiles();
    expect(useSidebarViewStore.getState().filesOpen).toBe(true);
  });

  it('backToTasks switches back', () => {
    useSidebarViewStore.getState().openFiles();
    useSidebarViewStore.getState().backToTasks();
    expect(useSidebarViewStore.getState().filesOpen).toBe(false);
  });
});
