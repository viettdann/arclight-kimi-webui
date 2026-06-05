import { GitAttributionPanel } from '../preferences/git-attribution-panel';
import { GitCredentialsPanel } from '../preferences/git-credentials-panel';
import { InstructionsPanel } from '../preferences/instructions-panel';

/**
 * General section: instructions + git credentials + git attribution.
 */
export function GeneralSection() {
  return (
    <div className="space-y-8">
      <InstructionsPanel />
      <GitCredentialsPanel />
      <GitAttributionPanel />
    </div>
  );
}
