# Private stock SDK image profile

`Dockerfile.stock-sdk` derives a dedicated, opt-in SDK image from a reviewed
immutable production image. It changes metadata only: the base layers, compiled
worker, SDK assets and dependencies remain identical. The normal production
Dockerfile and its default target are unchanged.

Supply the exact locally inspected base image ID and reviewed custody digests.
The base must be Linux ARM64, have no declared volumes, and contain the compiled
worker at the fixed entrypoint and the root-owned SDK assets under
`/app/packages/twenty-server/dist/assets/twenty-client-sdk`. Dockerfile arguments
are assertions supplied by the reviewer; building does not verify their truth.
Missing or false provenance must never be admitted by the supplier factory.

Use existing Docker tooling on the approved isolated Linux ARM64 engine:

```sh
docker build --pull=false --network=none \
  --file packages/twenty-docker/twenty/Dockerfile.stock-sdk \
  --build-arg CRM_IMAGE="$reviewed_base_image_id" \
  --build-arg SOURCE_SHA256="$reviewed_source_sha256" \
  --build-arg PACKAGE_SHA256="$reviewed_package_sha256" \
  --iidfile "$exclusive_receipt_directory/image-id" \
  packages/twenty-docker/twenty
```

The base must already be present and inspected on that engine before build.
No tag, registry publication, install, or application runtime is needed for this
metadata-only build. Preserve the build output and inspect the resulting image
ID, platform, labels, rootfs diff IDs, user `1000:1000`, workdir `/app`, exact Node
entrypoint, empty Cmd and null Volumes. Rootfs diff IDs must equal the base.
An interrupted build is unqualified until its outcome is resolved.

## Custody digest definitions

Version each custody JSON document explicitly. Serialize it with sorted object
keys, compact separators, UTF-8 and one trailing LF; each label is the lowercase
SHA256 of those exact document bytes. Keep those files beside the build receipt.
The Core executor validates label equality; it does not prescribe a digest
algorithm or independently reconstruct these documents.

For `askexe-stock-sdk-source-custody-v1`, bind the exact source commit/tree,
tracked source Dockerfile hash, original build metadata hash and immutable base
archive SHA256, OCI manifest digest and config digest. Retain references to the
original build/inspection evidence. The source label describes the base build's
source; the derivative Dockerfile hash belongs in its separate build receipt.

For `askexe-stock-sdk-package-custody-v1`, bind that same immutable base manifest
and config, relevant root/server/client-SDK package manifests and lockfile hashes,
the compiled worker SHA256, and the SDK subtree manifest SHA256. The subtree
manifest records every relative path, regular file hash/bytes/mode and directory
metadata, including owner/group and link type. Reject symlinks, hardlinks,
non-root ownership and group/other write permissions. The OCI rootfs binds the
remaining dependencies; a second node_modules census is unnecessary.

## Runtime admission remains separate

Image/profile inspection grants no execution capability. The parent operator
must independently bind the observed image ID and Linux engine ID to the reviewed
source/package digests in its protected `/run/exe-native-parent/stock-sdk.json`,
with the existing exact permissions and factory-issued capability. Update any
selected-bootstrap exact pin only through its reviewed Core custody path.

Run qualification through the existing `readPrivateStockSdkSupplier()` and
`OwnedStockSdkExecutor.generate()` on that Linux engine. Retain the actual zip,
exit/EOF/stdio closure and exact nonce-owned container removal/absence evidence.
The executor's fixed network, read-only root, credentials, resource, tmpfs and
cleanup guards remain authoritative. A Desktop smoke or a caller-constructed
supplier object does not qualify this profile.
