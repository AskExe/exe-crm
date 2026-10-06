# Private company people transaction — Source only

This unrun descendant of CRM220 (`8992b38b`) supplies an internal adapter for
Core's accepted synchronous `NativePeopleAdapter.createHandle` contract. It
registers no Nest provider, public route, environment activation or onboarding
grant. The composition must explicitly enable it; ordinary ORM behavior is
unchanged when `usePrivateTransaction` is absent.

`createHandle` captures the closed Core V2 projection and canonical `{name,email}`
array before asynchronous work. It acquires no resource. `prepare` owns the
data-source acquisition and then retains one QueryRunner before connect. The
same runner locks policy, reads the actual native identity, inserts contacts and
inserts the immutable request ledger. No create-many route, upsert, conflict
ignore/update, file write, nested relation write or caller-generated record ID
is used. Unreviewed TypeORM subscribers/entity INSERT listeners refuse before
mutating work; they are not silently disabled. Each operation checks the original Core deadline; abort does not start
rollback concurrently with an unsettled query.

The protected operator mapping and new immutable operator-binding table must
agree on company, subject, workspace, client, binding, generation, audience,
native user/membership/member and native role. The fixed helper also checks the
request and current role target. It locks native policy tables and the exact
bound workspace-member table until COMMIT. A verified, enabled native user is
required; bootstrap's unverified owner is deliberately refused. Impersonation,
full-admin and global record/tool/settings privileges are refused. Person
metadata must be the active standard object. The real permission engine still
checks object/field/RLS permissions; its existing `canUpdateObjectRecords` INSERT
gate is retained. An explicit person read grant is needed for the native event
read. These are not inferred from Core company ownership.

The helper is default revoked and owned by a new isolated NOLOGIN/NOINHERIT
role, never the runtime login. PostgreSQL requires table UPDATE to acquire these
table locks. Only that fixed-body helper owner receives it; the business login
does not. Its body contains no DML. The operator must separately approve
USAGE/SELECT/UPDATE for the helper on only the measured workspace-member table.
The migration grants no login membership, runtime EXECUTE or business policy.
The fresh catalog ceiling checks the actual helper source/owner/search path,
role attributes, schema/database/object ownership, memberships, sequences,
non-system SECURITY DEFINER execution and effective table/column privileges.
Runtime writes are limited to person INSERT and ledger INSERT; policy/binding
UPDATE, DELETE and CREATE are refused. Grant adequacy is not yet measured.

The native ledger records request/digest, company/subject, original Core binding
and policy revision, actual native identity/role and generated contact IDs in the
same transaction. Duplicate requests refuse rather than replay. A lost or late
COMMIT acknowledgement is uncertain even if the server committed. It requires
separate exact-ledger reconciliation under fresh Core authority; no automatic
retry, ledger adoption or new request is performed here. Core retains its own
current authority locks through native acknowledgement. Cross-database failure
still permits an already-authorized in-flight native commit; this is not 2PC.

The private INSERT mode uses the owned runner for event reads and queues bounded
native CREATED/UPSERTED events without emission. Native event classes and Date
values are copied without getters or record hooks (two events, at most 4MiB each,
65,536 nodes each). Only `postCommit`, after Core settlement and final parent
acceptance within the original deadline, publishes them. Subscriber failure is
not automatically replayed. This memory queue is not a durable event outbox. Core's accepted NativePeopleTransaction
already declares postCommit(end); its coordinator returns the publish closure and
its consumer calls that closure only after final current-parent acceptance. The
actual protected adapter/package composition still must connect that existing
contract to this disabled adapter without treating native ACK as Core acceptance.
That composition is not implemented or enabled here.

Rollback/disposal retain pending acquisition and query custody, then settle and
release the exact runner. A positively configured connection timeout at most
250ms is required. The ordinary GlobalWorkspaceDataSourceService does not set
that connection-timeout option; it cannot be treated as a qualified private
composition unchanged. The protected operator package must supply the real
service/data-source/cache graph with dedicated measured credentials and that
finite connection option, rather than a synthetic service callback. If settlement or release cannot be proved within Core's
cleanup deadline, the result remains uncertain and quarantined. No settlement
callback starts rollback/release after that end. The future protected composition
must use a dedicated one-shot process and finite pool; its already-admitted parent
termination end must stop that exact process/pool on unsettled disposal. This is a
held fail-stop prerequisite, not implemented process or PostgreSQL cancellation
proof. A lost COMMIT still needs exact-ledger reconciliation under fresh authority. Native statement/lock timeouts and original work
end are not renewed. Actual pg cancellation/pool behavior needs a genuine test.

## Held validation proposal

A V2 object is data, not an authorization token. Only the trusted Core coordinator
inside its genuine current authority transaction may call this internal interface;
a parsed fixture or caller-authored self-consistent tuple is not that composition.

No syntax, import, Jest, SQL or native execution has occurred for this Source.
The three new spec files contain 32 controlled cases: closed canonical input,
owned acquisition/rollback/commit/disposal, changed native privileges/identity,
duplicate/lost acknowledgement and deferred event lifecycle. Their SQL and ORM
carriers are explicitly synthetic; they cannot qualify actual grants, RLS,
locking, COMMIT or customer onboarding.

After Source review, derive the accepted c6 host-only capture with the exact new
worktree/index/readset and a fresh owned work namespace. Keep hardened immutable
lock/cache admission, scripts disabled and the accepted in-process Nx native
preload. Run the three focused Jest files, server/front diff lint (front TS scope
is zero), formatting and both whole typechecks with the same approved prerequisite
graph and finite resource/cleanup bounds. No new supplier, DB/service, Docker,
public route or provisioning action is included. Exact executable bindings need
review before that invocation; no old device/full8 admission is runtime authority.

Before a genuine pilot, missing prerequisites are a freshly compiled locked
Linux package containing this Source, protected operator composition and dedicated
native writer/read-only cache connections in the same database (the actual core-data-source object and
closed URL endpoint must match), measured minimum grants/helper body,
real mailed/verified native owner/member onboarding, genuine Core business-action
SQL qualification and revocation/commit/uncertain-ledger/A-versus-B tests. CRM219
and Core's 19 controlled ownership cases do not establish those prerequisites.

## Finite settlement evidence and limits

Read-only local pg-pool 3.6.2 Source shows connectionTimeoutMillis bounds pool
checkout and new connections (pending waiter removal / new-client stream destroy).
Local TypeORM 0.3.30 Source shows release returns a checked-out client to the pool;
it is not a cancellation API. Local pg client query_timeout returns an error and
changes the query callback; it is not evidence of server-side query cancellation.
These observed shared library bytes are recorded as readers, not locked-package
parity or import qualification. The accepted finite connection option and native
statement/lock timeout therefore remain aids, not physical closure proof. A native
operation can be pending beyond its work timeout. No renewed cleanup allowance,
late transaction reuse or automatic retry is permitted. Actual dedicated pool,
parent fail-stop, socket close, database rollback and COMMIT ambiguity must be
qualified before a genuine request is dispatched.

## Implemented internal one-shot boundary — unrun

The new PrivatePeopleSupervisedAdapter is default disabled and unregistered.
createHandle snapshots only. prepare uses one fixed root-owned Node executable
and worker entry under Linux UID1000, retains ChildProcess before awaits, sends
closed request/digest/sequence-bound IPC and hashes/discards each bounded64KiB
stdout/stderr stream. Unexpected/late ACK, capture failure or work abort retains
uncertainty and signals only the retained child. No caller executable, path, DSN,
role or transport callback is accepted. No new worker is spawned after failure.
The earliest cleanup deadline is retained across rollback/dispose; later cleanup
cannot extend it. EOF/exit/reap remain explicit success predicates, not inferred
from a signal. This is not parent-crash or descendant containment qualification.

The fixed worker accepts only PREPARE/COMMIT/ROLLBACK/DISPOSE/PUBLISH and one
PREPARE source/payload. It loads only the fixed root-owned immutable assembly
/app/packages/twenty-server/private-people-runtime.cjs admitted by canonical
UID1000 protected /run/secrets/crm-people-worker/assembly-trust.json. Parent roots
and file/fd/name metadata are checked; this trust mount must itself be supplied
by the protected operator, not a caller. The assembly must export actual
DataSource/GlobalWorkspaceOrmManager/WorkspaceCacheService/WorkspaceEventEmitter
instances and protected configuration. It is not an injected synthetic callback.
The concrete assembly/provider graph and compiled worker package are still
missing/unqualified; the implementation refuses absence instead of importing
AppModule or guessing provider services. The assembly's transitive imports and
its dedicated pool creation must be reviewed and packaged before use.

DISPOSE awaits native settlement/release then destroys both exact dedicated
DataSources before ACK. A hung pool.end/destroy is bounded by parent cleanup,
not converted to success. Native events remain memory-only after resource closure;
only Core's existing final acceptance can send PUBLISH within the original work
end. Lost IPC/ACK, child exit or subscriber failure never replays a request or
queue. Process/socket exit is not PostgreSQL cancellation/rollback proof. A
server COMMIT may have succeeded despite lost acknowledgement; fresh-authority
exact-ledger reconciliation is mandatory and no pool/handle is reused.

Eight initial controlled ChildProcess cases cover side-effect-free creation,
fixed command/environment, hung acquisition, hung COMMIT/late ACK, hung pool
closure, shorter-then-longer cleanup, output failure and final-acceptance-only
publication. Those eight plus the six newer sticky/transit controls and the32 prior cases total46. All are
UNRUN; controlled child ACK/exit/EOF carriers do not prove physical Linux/pool/SQL
behavior. No runtime/package/host/native claim is made by this Source.

## Sticky refusal and transit correction — unrun

Every supervisor success transition and final clean-exit predicate now requires
no retained primary/fatal state. A valid ACK followed by capture/protocol fatal
before continuation cannot become prepare/commit/dispose/publish success.
Publication error/timeout fail-stops the owned child and preserves primary plus
bounded cleanup secondaries under the already existing work/publication ends.
COMMIT IDs must exactly equal the immutable captured payload row count as well
as remain canonical unique UUIDs.

The protected internal pipe now carries a comparable absolute CLOCK_MONOTONIC
end from process.hrtime.bigint on the SAME Linux host/kernel. Parent samples
that clock before computing remaining; worker validates positive finite end and
60s cap, debits delivery/import/read time and only shrinks work/earliest cleanup
ends. No receive-relative allowance is recreated. This internal same-kernel
clock is not a public/Core frame clock or cross-host authority. Parent's Core
OriginalDeadline still independently governs every send and fail-stop.
Proxy/plain-object rejection precedes any phase descriptor access. Six proposed
additional controls cover zero Proxy traps, delayed delivery, absolute-end
nonrenewal, ACK-then-fatal, clean-exit protocol fatal and exact contact count.
All46 proposed cases remain unrun; physical same-kernel clock/package/channel,
SQL/native and parent/descendant containment remain unqualified.
