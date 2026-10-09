import { run } from './private-native-stock-launcher.mjs';

// The fixed module owns native child closure and the original transport bound.
// This entry grants no deployment authority and is not wired to AppModule.
process.umask(0o077);
void run().catch(() => {
  process.stderr.write('Private stock launcher requires reconciliation\n');
  process.exitCode = 1;
});
