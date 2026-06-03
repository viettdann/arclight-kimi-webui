import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useOpenFileStore, persistWidth } from '@/lib/open-file-store';

describe('useOpenFileStore', () => {
  beforeEach(() => {
    // Reset Zustand store state before each test to ensure isolation
    useOpenFileStore.setState({
      openFile: null,
      pending: null,
      dirty: false,
      editorWidthPct: 57,
    });
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('should initialize with default values', () => {
    const state = useOpenFileStore.getState();
    expect(state.openFile).toBeNull();
    expect(state.pending).toBeNull();
    expect(state.dirty).toBe(false);
    expect(state.editorWidthPct).toBe(57);
  });

  it('should update dirty flag', () => {
    useOpenFileStore.getState().setDirty(true);
    expect(useOpenFileStore.getState().dirty).toBe(true);

    useOpenFileStore.getState().setDirty(false);
    expect(useOpenFileStore.getState().dirty).toBe(false);
  });

  it('should open a file directly if not dirty', () => {
    useOpenFileStore.getState().open('/src/App.tsx', 'App.tsx');
    const state = useOpenFileStore.getState();
    expect(state.openFile).toEqual({ path: '/src/App.tsx', name: 'App.tsx' });
    expect(state.pending).toBeNull();
    expect(state.dirty).toBe(false);
  });

  it('should not reopen the same file (no-op)', () => {
    useOpenFileStore.getState().open('/src/App.tsx', 'App.tsx');
    useOpenFileStore.getState().setDirty(true);

    // Reopen same file
    useOpenFileStore.getState().open('/src/App.tsx', 'App.tsx');

    // Should not trigger dirty check or switch because it's the same file
    const state = useOpenFileStore.getState();
    expect(state.openFile).toEqual({ path: '/src/App.tsx', name: 'App.tsx' });
    expect(state.pending).toBeNull();
    expect(state.dirty).toBe(true);
  });

  it('should close file directly if not dirty', () => {
    useOpenFileStore.getState().open('/src/App.tsx', 'App.tsx');
    useOpenFileStore.getState().close();

    const state = useOpenFileStore.getState();
    expect(state.openFile).toBeNull();
    expect(state.pending).toBeNull();
    expect(state.dirty).toBe(false);
  });

  it('should stash close as pending and not clear openFile if dirty', () => {
    useOpenFileStore.getState().open('/src/App.tsx', 'App.tsx');
    useOpenFileStore.getState().setDirty(true);
    useOpenFileStore.getState().close();

    const state = useOpenFileStore.getState();
    expect(state.openFile).toEqual({ path: '/src/App.tsx', name: 'App.tsx' });
    expect(state.pending).toEqual({ kind: 'close' });
  });

  it('should stash switch as pending and not change openFile if dirty', () => {
    useOpenFileStore.getState().open('/src/App.tsx', 'App.tsx');
    useOpenFileStore.getState().setDirty(true);
    useOpenFileStore.getState().open('/src/main.tsx', 'main.tsx');

    const state = useOpenFileStore.getState();
    expect(state.openFile).toEqual({ path: '/src/App.tsx', name: 'App.tsx' });
    expect(state.pending).toEqual({
      kind: 'switch',
      file: { path: '/src/main.tsx', name: 'main.tsx' },
    });
  });

  it('should confirm pending close action', () => {
    useOpenFileStore.getState().open('/src/App.tsx', 'App.tsx');
    useOpenFileStore.getState().setDirty(true);
    useOpenFileStore.getState().close(); // stashes pending close

    useOpenFileStore.getState().confirmPending();

    const state = useOpenFileStore.getState();
    expect(state.openFile).toBeNull();
    expect(state.pending).toBeNull();
    expect(state.dirty).toBe(false);
  });

  it('should confirm pending switch action and change openFile', () => {
    useOpenFileStore.getState().open('/src/App.tsx', 'App.tsx');
    useOpenFileStore.getState().setDirty(true);
    useOpenFileStore.getState().open('/src/main.tsx', 'main.tsx'); // stashes pending switch

    useOpenFileStore.getState().confirmPending();

    const state = useOpenFileStore.getState();
    expect(state.openFile).toEqual({ path: '/src/main.tsx', name: 'main.tsx' });
    expect(state.pending).toBeNull();
    expect(state.dirty).toBe(false);
  });

  it('should cancel pending action', () => {
    useOpenFileStore.getState().open('/src/App.tsx', 'App.tsx');
    useOpenFileStore.getState().setDirty(true);
    useOpenFileStore.getState().close(); // stashes pending close

    useOpenFileStore.getState().cancelPending();

    const state = useOpenFileStore.getState();
    expect(state.openFile).toEqual({ path: '/src/App.tsx', name: 'App.tsx' });
    expect(state.pending).toBeNull();
    expect(state.dirty).toBe(true); // retains dirty status
  });

  it('should set editor width in memory', () => {
    useOpenFileStore.getState().setWidth(65);
    expect(useOpenFileStore.getState().editorWidthPct).toBe(65);
  });

  it('should persist editor width to localStorage', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    persistWidth(42);

    expect(setItemSpy).toHaveBeenCalledWith('editorWidthPct', '42');
    expect(localStorage.getItem('editorWidthPct')).toBe('42');
  });
});
