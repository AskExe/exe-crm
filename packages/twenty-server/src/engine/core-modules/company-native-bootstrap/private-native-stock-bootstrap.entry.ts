import { runPrivateNativeStockBootstrap } from 'src/engine/core-modules/company-native-bootstrap/private-native-bootstrap-command';
// Fixed unmounted entry; a source flag is not deployment or native admission.
process.umask(0o077);
const hardLifetime = setTimeout(() => process.exit(124), 211000);
void runPrivateNativeStockBootstrap(true)
  .then(
    (result) => {
      process.stdout.write(JSON.stringify(result) + '\n');
    },
    () => {
      process.stderr.write('Private stock command requires reconciliation\n');
      process.exitCode = 1;
    },
  )
  .finally(() => clearTimeout(hardLifetime));
