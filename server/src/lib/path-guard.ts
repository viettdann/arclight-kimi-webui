// Path-guard: keep every filesystem op inside a user's workspace root.
// Full implementation lands at MVP-6 with the Files API. Tests in
// `test/path-guard.test.ts` (currently `it.todo`) will assert these rules:
//   1. Reject NUL byte (\0) in relPath
//   2. Reject leading '/' (absolute)
//   3. resolve(userRoot, relPath) must remain within userRoot
//   4. If the target exists, realpath() must also stay within userRoot
//      (defends against symlink escape).

export function resolveUserPath(_userRoot: string, _relPath: string): string {
  throw new Error('resolveUserPath not implemented (MVP-6)');
}
