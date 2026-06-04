import { GitCredentialsPanel } from '../preferences/git-credentials-panel';
import { InstructionsPanel } from '../preferences/instructions-panel';

/**
 * General section: instructions + git credentials.
 */
export function GeneralSection() {
  return (
    <div className="space-y-8">
      <InstructionsPanel />
      <GitCredentialsPanel />
    </div>
  );
}
