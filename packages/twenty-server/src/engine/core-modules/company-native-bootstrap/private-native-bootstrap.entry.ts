import { runPrivateNativeBootstrap } from 'src/engine/core-modules/company-native-bootstrap/private-native-bootstrap-command';

// Dedicated private process only. Not imported by the ordinary entrypoint,
// Nest command module, web application or tenant worker. The operator artifact
// defaults off; the outer owned-container controller must enforce the same
// immutable lifetime, quotas and closure even if this process is killed.
const hardLifetime = setTimeout(() => process.exit(124), 211000);
void runPrivateNativeBootstrap(true)
  .then(
    (result) => {
      // No Core token, credentials, owner email or authority envelope is emitted.
      process.stdout.write(JSON.stringify(result) + '\n');
    },
    () => {
      // Raw TypeORM/file errors can include secret connection/query data. Preserve
      // marker state and expose only this finite refusal to the outer operator.
      process.stderr.write('Private native command requires reconciliation\n');
      process.exitCode = 1;
    },
  )
  .finally(() => {
    clearTimeout(hardLifetime);
  });
