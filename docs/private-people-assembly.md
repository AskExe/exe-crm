# Private people assembly — disabled, Source-only

This unregistered factory is a descendant of CRM221. Ordinary modules and entries
never import it. No assembly import, test, typecheck, image, SQL or native write has
run on this Source. CRM221 is unchanged. Packaging must separately bind the exact
factory export into the immutable root-owned fixed
`/app/packages/twenty-server/private-people-runtime.cjs` admitted by the existing
UID1000 trust loader.

The protected factory creates a side-effect-free lifecycle synchronously. The
worker retains it before awaiting preparation. Fixed canonical owner1000 mode0400
files under `/run/secrets/crm-people-worker` provide `runtime-profile.json`,
`metadata-connection.json`, `writer-connection.json`, and `redis-connection.json`.
The existing root0700/trust/hash/no-link checks remain. Database login names are
fixed to `crm_people_metadata` and `crm_people_writer`, Redis to
`crm_people_cache`; no caller path/role/module/DSN or environment configuration is
accepted. Only PATH and production NODE_ENV are allowed. Actual validated Nest
configuration prevents environment fallback; database configuration writes and
replicas are disabled in this private context.

The context registers DiscoveryModule, the ten actual decorated providers, the
forty reviewed Source-literal relation entity classes, actual repository tokens,
real schema factories/cache/ORM/event emitter, and the owned datasource hook.
It does not import AppModule, broad metadata feature modules, controllers,
schedulers, jobs or provider integrations. A private token recomputes every
requested actual cache provider before returning, with a fresh metadata catalog
ceiling before and after. It does not enable CRM_COMPANY_MODE, use lite context,
empty permission maps or Memory Redis. API-key roles remain metadata, not actor
authority. The actual Redis client is retained before connect and wrapped by
real redisInsStore; no shared Redis flush or fallback exists.

Metadata uses a canonical private URL-only DataSource configuration, matching
the unchanged endpoint guard; explicit host/port/database overlays are absent.
Both private PG connection deadlines are fixed to250ms, retaining the unchanged
writer integer1..250 bound. Credentials remain only in protected worker memory,
never receipts or error bodies.

Each DataSource/client and its acquisition promise is retained before IO.
The optional internal datasource custody token changes only private assembly;
ordinary absent-token initialization/shutdown behavior remains unchanged.
Disposal closes the exact retained pools and Redis client with idempotent close
promises; native Nest teardown uses those same promises. It settles partial/late
preparation first and cannot acknowledge unknown pending IO. The earliest
original work/cleanup ceiling only shrinks. Deadline expiry or a sticky fatal
prevents late resource publication or ACK. A late acquisition outside that ceiling
is quarantined, not released using an unbounded callback. Dedicated resources are
never reused. The exact parent fail-stop remains necessary; this code does not
prove external query cancellation, rollback or parent-crash/transitive closure.

Connected preparation refusal attempts known IO settlement and partial/late
context/listener closure under only the already-admitted earliest end. It retains
the original fatal plus cleanup secondaries and never emits a success ACK. An
expired, disconnected or hung attempt remains uncertain/parent-fail-stop; no
renewed cleanup window or physical closure is inferred.

IO disposal preserves the in-memory event emitter for Core's final acceptance.
After deferred events are emitted, finalization must close the context/listeners
within the same original end before publish success ACK or clean disconnect.
An ambiguous event/final-close/ACK outcome remains uncertain and cannot replay.
No reviewed event/outbox subscriber is installed here: meaningful durable event
delivery is a separate qualification gate, not inferred from an empty emitter.

The writer identity/INSERT/lock/ledger ceilings and Core V2 authority/commit rules
are unchanged. Metadata uses a separate readonly connection: no table SELECT,
write/create/ownership/membership/sequence/SECURITY DEFINER broadening is admitted.
Only mapped core columns on the reviewed twenty read tables are a Source ceiling;
actual generated SQL/default/eager columns and positive column grants are still
unqualified. No SQL grants or migrations were executed. Unsupported inherited,
eager or nonliteral entity/import dependencies must fail qualification rather
than silently add feature modules/grants. Native bootstrap UNVERIFIED identities
remain refused; authorized verified-native onboarding is still required.

The proposed sixteen custody controls plus two option-compatibility cases cover retention before await, pending/late
settlement, exact close-promise reuse, shortened cleanup, sticky abort, failed
acquisition, duplicate resource identities, expired finalization, partial-preparation refusal
and the unchanged real adapter URL/timeout guards. They are
controlled and UNRUN, not real Redis/Nest/PG/worker qualification. Whole front and
server typechecks and scoped lint/format are required before publication. Actual
protected Linux assembly, generated SQL/column ACLs, events, cancellation and the
two-company create/import pilot remain separate release gates.
