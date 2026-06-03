// In-process registry of in-flight background clones, keyed by `cloneId`.
// Single-instance only — clones live entirely in this process, so on restart
// the map is empty and any leftover on-disk `.cloning-*` marker is, by
// definition, an interrupted clone (see reconcile.ts). Used to (a) mark a
// project as `cloning` in listings and (b) cancel a running clone by aborting
// its git subprocess.

interface CloneEntry {
  controller: AbortController;
  userId: string;
  projectName: string;
  workDir: string;
}

const clones = new Map<string, CloneEntry>();

export function registerClone(cloneId: string, entry: CloneEntry): void {
  clones.set(cloneId, entry);
}

export function unregisterClone(cloneId: string): void {
  clones.delete(cloneId);
}

/** Names of every project this user is currently cloning — used to flag them
 *  as `cloning` in `listProjectsForUser`. */
export function cloningProjectNamesForUser(userId: string): Set<string> {
  const names = new Set<string>();
  for (const entry of clones.values()) {
    if (entry.userId === userId) names.add(entry.projectName);
  }
  return names;
}

/** Abort the user's clone of `projectName`, if any. Returns true when a
 *  matching in-flight clone was found and aborted. */
export function cancelCloneForProject(userId: string, projectName: string): boolean {
  for (const entry of clones.values()) {
    if (entry.userId !== userId || entry.projectName !== projectName) continue;
    // The background task reports `clone_canceled` by reading `signal.aborted`.
    entry.controller.abort();
    return true;
  }
  return false;
}
