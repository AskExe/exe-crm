// Stub: exe-os uses its own license server
import { Command, CommandRunner } from 'nest-commander';

@Command({
  name: 'cron:enterprise-key-validation',
  description: 'Stub: enterprise key validation (no-op for exe-os)',
})
export class EnterpriseKeyValidationCronCommand extends CommandRunner {
  async run(): Promise<void> {
    // no-op: exe-os handles license validation externally
  }

  async registerCron(): Promise<void> {
    // no-op
  }
}
