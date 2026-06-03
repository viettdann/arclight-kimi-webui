import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Dirty registry for the Settings modal.
 *
 * Each panel reports whether it holds unsaved work under a stable key; the
 * dialog reads the aggregate to decide whether closing must be blocked.
 *
 * The invariant (see plan §4.2): `dirty = (a button-gated form not yet saved)
 * OR (an autosave that failed)`. Autosave panels register only on failure so a
 * rejected write keeps its value as a draft and re-arms the close lock.
 */
interface SettingsDirtyValue {
  /** Add/remove a key from the dirty set. Stable across renders. */
  setDirty: (key: string, dirty: boolean) => void;
  /** True while any registered key is dirty. */
  isDirty: boolean;
}

export const SettingsDirtyContext = createContext<SettingsDirtyValue | null>(null);

/** Build the dirty registry state. The modal owns one instance and provides it. */
export function useSettingsDirtyState(): SettingsDirtyValue {
  const [dirtyKeys, setDirtyKeys] = useState<ReadonlySet<string>>(() => new Set());

  const setDirty = useCallback((key: string, dirty: boolean) => {
    setDirtyKeys((prev) => {
      const has = prev.has(key);
      if (dirty === has) return prev; // no-op — avoid churn
      const next = new Set(prev);
      if (dirty) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  // Key the value identity on the boolean, not the Set: swapping which keys are
  // dirty (size 1→2→1) leaves `isDirty` unchanged, so consumers shouldn't churn.
  const isDirty = dirtyKeys.size > 0;
  return useMemo(() => ({ setDirty, isDirty }), [setDirty, isDirty]);
}

/** Read the aggregate dirty flag + setter. Returns null outside the provider. */
export function useSettingsDirty(): SettingsDirtyValue | null {
  return useContext(SettingsDirtyContext);
}

/**
 * Register this panel's dirty flag under `key` for the modal's close lock.
 * Cleans up (clears the key) on unmount so a panel that leaves the tree never
 * pins the lock. No-op when rendered outside the Settings modal provider.
 */
export function useRegisterDirty(key: string, dirty: boolean): void {
  const ctx = useContext(SettingsDirtyContext);
  const setDirty = ctx?.setDirty;
  useEffect(() => {
    if (!setDirty) return;
    setDirty(key, dirty);
    return () => setDirty(key, false);
  }, [key, dirty, setDirty]);
}
