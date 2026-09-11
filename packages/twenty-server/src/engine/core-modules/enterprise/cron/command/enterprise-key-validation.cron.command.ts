// Explicit operator check against the authoritative Exe license service.
import { Command, CommandRunner } from 'nest-commander';

import { readExeLicense } from '../../services/exe-license-authority';

@Command({
  name: 'cron:enterprise-key-validation',
  description:
    'Validate the enterprise installation license against GoTrue authority',
})
export class EnterpriseKeyValidationCronCommand extends CommandRunner {
  async run(): Promise<void> {
    if ((await readExeLicense())?.plan !== 'enterprise') {
      throw new Error('Enterprise installation license is invalid');
    }
  }

  async registerCron(): Promise<void> {
    // Enforcement happens on each feature request; no cached cron verdict.
  }
}
