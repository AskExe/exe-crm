# Private stock native image profile

`Dockerfile.stock-native` is an opt-in derivative of an independently qualified
immutable Linux ARM64 production image. It reuses the actual installed dependency
and compiled bytes. It copies the complete compiled server tree to `/app/dist`,
where the native launcher's fixed child path requires it. Relative compiled
imports, entity globs and adjacent assets move together. The original internal
package tree remains available for workspace dependency resolution. This is a
physical copy, with no resolver hook, source-path shim, compilation or install.

The fresh scratch stage copies the base rootfs without inheriting its production
labels or execution metadata. The result has exactly the three reviewed
`org.exe.*` labels, user `1000:1000`, workdir `/app`, entrypoint `["node"]`, the
fixed absolute native launcher command and no declared volumes. It exposes no
ports. Its complete environment projection retains the observed base `PATH`,
`NODE_VERSION=24.18.0`, `YARN_VERSION=1.22.22`, empty
`REACT_APP_SERVER_BASE_URL` and `APP_VERSION=0.9.75`. A changed base requires a
fresh review of these literals. No database, credentials, feature-enable flag or
ordinary production entrypoint environment is added. The private stock graph's
`PrivateNativeStockEnvironment` uses its fixed native configuration rather than
ambient process configuration; protected operator inputs remain authoritative.
The compiled `ASSET_PATH` follows `../assets` relative to its own location, so
copying the complete tree preserves `/app/dist/assets`. The copied compiled tree
is root-owned. Runtime read-only filesystem and
existing resource, authority, tenant, lease, transport and cleanup guards remain
required. Image construction alone grants no execution authority.

Use the approved isolated Linux ARM64 engine and an already-present inspected
immutable base image ID. Record both the OCI manifest and config digests; they
need not equal the local engine image ID. Supply only reviewed observed source
custody, never a guessed hash or a historical migration ledger:

```sh
docker build --pull=false --network=none \
  --file packages/twenty-docker/twenty/Dockerfile.stock-native \
  --build-arg CRM_IMAGE="$reviewed_base_image_id" \
  --build-arg GIT_SHA="$reviewed_source_revision" \
  --build-arg SOURCE_SHA256="$reviewed_source_custody_sha256" \
  --iidfile "$exclusive_receipt_directory/image-id" \
  packages/twenty-docker/twenty
```

Arguments assert reviewed facts; Docker does not verify them. Retain the build
output, image inspection and exact derivative Dockerfile hash. Qualify the
actual image before filling Core's closed `CRM_STOCK_SOURCE` pins.

## Required custody and qualification

Keep explicitly versioned compact UTF-8 JSON documents with sorted keys and one
trailing LF. Source custody binds the exact current commit/tree, base source
commit/tree, observed source equivalence for every runtime build input, base OCI
archive/manifest/config digests and original production build metadata. A source
revision with documentation-only differences may reuse compiled bytes only when
the tracked runtime inputs are demonstrably unchanged.

Package custody binds that source packet, actual derivative image ID/config,
base rootfs diff IDs, root/server/workspace manifests and lockfile hashes,
observed required launcher/child/module/asset hashes and the complete compiled
migration census. The immutable OCI rootfs binds dependencies; do not export or
re-census all node_modules. Record physical file type, ownership, modes and byte
hashes for required entries. Reject unexpected links or writable protected assets.

A real restricted package probe must exercise relocated imports, entity loading
and the TypeORM effective migration names/order. Hash the actual canonical
`[timestamp,name]` ledger projection expected by Core. Historical ledger counts
and names cannot substitute for this observation. Run existing targeted supplier
and launcher controls, then a fresh owned disposable native PostgreSQL setup and
restricted selected-native flow using the exact observed image and ledger.
Retain failures, original lease/authority checks and exact owned cleanup/absence
proof. Do not enable company mode or claim public activation from this profile.
