# Current company REST/native ACL fixture

This uses the ordinary compiled server-only CRM fixture and two independent
PostgreSQL/Redis/workspace installations. The application, HTTP middleware,
TwentyORM query/lease/select path and native permissions are real. Private central
introspection responses are controlled, not Core or GoTrue proof.

## Run

Use the exact reviewed CRM runtime commit, not a floating branch or old fixture:

```sh
node tests/company-runtime/build-company-read-fixture.mjs \
  22b3a31a201fa12c33916276a738ca99b2403b97 /private/path/current-crm-images.json
node tests/company-runtime/native-company-read.integration.mjs \
  /private/path/current-crm-images.json 22b3a31a201fa12c33916276a738ca99b2403b97
```

The builder retains the original source archive, lock and stock native server
compile checks. Its development-dependency/server-only image is not production
packaging or frontend proof. Build prerequisites include the reviewed local base,
locked dependency cache and at least 20 GiB free disk. Build time is bounded to one
hour. No image or dependency supplier is assumed present from a historical record.

The integration requires local Docker and the existing digest-pinned PostgreSQL
and Redis suppliers. It creates only disposable private networks, volumes and
containers. CLI commands are bounded to 180 seconds and the remaining fixture
phase. Work commands use the remaining 30-minute planning budget with a
one-minute reserve; cleanup has a separate 60-second budget starting in finally. Company assertions share a 10-minute budget. HTTP calls use 15-second
client timeouts; application 9-second deadlines, 8 active reads and the real
30-per-credential/minute limit are unchanged. Independent assertion groups pause
60.05 seconds without changing credentials. A real 429 fails and is retained.

## Coverage

All earlier own/foreign records, credential, field/row/object ACL and pre-read
blocking assertions remain. Before final-phase mutations, the first unchanged
successful list request must traverse exactly five private introspections. The
fixture fails if the current application call chain differs.

The new cases hold only call five: `CompanyRestReadService`'s latest `currentRead`
after native query/rollback/release and before JSON publication. Actual committed
native field, row, object and role changes, plus controlled central revocation and
unavailability, must produce the exact finite error response without a data field.
The test does not patch request handlers, permissions, ORM or provider methods.
Hosted workspace provisioning must set the actual
`IS_ROW_LEVEL_PERMISSION_PREDICATES_ENABLED` flag true. This fixture upserts the
owned workspace row, asserts it, and deletes only the two exact feature-map cache
keys used by the existing native flush mechanism after stopping bootstrap
processes and before the new hosted process starts. Public onboarding does not
yet automate this prerequisite.

Successful create/run IDs establish cleanup ownership; the four short foreground
probes use create then start --attach and retain their IDs. Anonymous volumes are
collected only from each successful owned container inspection and checked absent
after rm --volumes. Stock node:http preserves the exact supplied Host, Origin and
credentials for existing get/pending REST requests, with bounded JSON and 15-second
timeouts. Successful stderr and stdout are both retained. All owned container,
volume and network absence checks require the known not-found error, not merely a
nonzero daemon status. Private raw command output, first failure, cleanup failures
and `result.json` survive at the printed output directory, including failed runs.
The complete command-output bound is 64 MiB; stored output is private and can
contain disposable fixture credentials. Do not publish those files as artifacts.

This stage does not cover a second A-company member, producer browser callback,
current MCP, real Core/GoTrue chains, business writes, payments or browser UI.
The exact `22b3a31a201fa12c33916276a738ca99b2403b97` successor built through the
stock server-only recipe and passed this fixture in both companies. Each company
passed all six final post-read negatives (field, row, object, native role, central
revocation and central unavailability), along with the inherited own/foreign,
credential, pre-read blocking and native ACL assertions. The completed run retained
18 owned container IDs, four anonymous volumes, four named volumes and two networks;
all were verified absent with their exact known not-found errors, with no primary
or cleanup failures. Private command stdout/stderr totaled 507,236 bytes.

Three product corrections are exercised: TokenModule imports CompanyAuthModule;
company-cache provider results use requested outer key order; and genuine typed
PERMISSION_DENIED exceptions are concealed as the existing 404 Record unavailable.
The fixture uses the supported TEXT CONTAINS operand for jobTitle row predicates,
keeping hidden-field and 200-empty-list assertions intact. Earlier startup,
fingerprint, initial error expectation, object denial and invalid TEXT IS fixture
failures remain retained separately. Their unrecorded inner throws are not inferred
from the later pass. Converter tests passed 52 cases, including TEXT IS rejection
and the sentinel CONTAINS filter; the affected service/auth tests passed 25 cases.

The company-mode cache now assembles permission keys in the original requested
order after concurrent providers complete. This addresses timing-dependent outer
key order without converting native TypeORM predicate/group instances or Date
values. Nested map insertion order and native array order still contribute to the
raw permission fingerprint; the differing component in the retained 401 remains
unknown. The request-order correction was built and exercised in the completed native run.
Standard declaration checking still has three unchanged TS2742 errors involving
the existing supplier types; full-project no-emit checking without declaration
emission passed. No dependency portability workaround was made.
