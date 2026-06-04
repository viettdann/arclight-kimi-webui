import { beforeEach, describe, expect, it } from 'vitest';
import { useDraftStore } from '@/lib/draft-store';

const DRAFTS_KEY = 'composerDrafts';

describe('useDraftStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useDraftStore.setState({ drafts: {} });
  });

  it('setDraft stores text keyed by sessionId', () => {
    useDraftStore.getState().setDraft('s1', 'hello');
    expect(useDraftStore.getState().drafts).toEqual({ s1: 'hello' });
  });

  it('setDraft with empty text drops the key', () => {
    useDraftStore.getState().setDraft('s1', 'hello');
    useDraftStore.getState().setDraft('s1', '');
    expect('s1' in useDraftStore.getState().drafts).toBe(false);
  });

  it('keeps drafts isolated per session', () => {
    useDraftStore.getState().setDraft('s1', 'a');
    useDraftStore.getState().setDraft('s2', 'b');
    expect(useDraftStore.getState().drafts).toEqual({ s1: 'a', s2: 'b' });
  });

  it('clearDraft removes only the target session', () => {
    useDraftStore.getState().setDraft('s1', 'a');
    useDraftStore.getState().setDraft('s2', 'b');
    useDraftStore.getState().clearDraft('s1');
    expect(useDraftStore.getState().drafts).toEqual({ s2: 'b' });
  });

  it('persists to localStorage on every mutation', () => {
    useDraftStore.getState().setDraft('s1', 'persisted');
    expect(JSON.parse(localStorage.getItem(DRAFTS_KEY)!)).toEqual({ s1: 'persisted' });

    useDraftStore.getState().clearDraft('s1');
    expect(JSON.parse(localStorage.getItem(DRAFTS_KEY)!)).toEqual({});
  });
});
