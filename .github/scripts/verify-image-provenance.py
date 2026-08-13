#!/usr/bin/env python3
"""
Artifact Chain-of-Custody G2 — build-provenance gate for exe-crm / exe-wiki.

THE INVARIANT: an image whose contents do not originate from the tag it wears
must never be published.

WHY THIS REPLACED THE DIGEST-COMPARISON GATE (bug cc8feeee)
-----------------------------------------------------------
The previous gate required stack.release.json `imageDigest` to equal the digest
of the image the run had just built. That is unsatisfiable by construction:

  1. A new build's digest cannot be known before the build.
  2. The build stamps the commit sha into the image CONFIG
     (org.exe.git_sha / org.opencontainers.image.revision).
  3. Recording the digest creates a NEW commit. Re-tagging onto it changes
     github.sha -> changes those labels -> changes the config -> changes the
     digest.
  4. So the "commit the digest and re-tag" remedy produces a *different* digest
     and drift-fails again, forever.

Evidence: no release-stack-image.yml run succeeded in exe-crm (since v0.9.47,
2026-06-09) or exe-wiki (since the pre-label v0.9.28) once labels were stamped.
Because build-push pushes BEFORE verification, every failed run left a pushed
image behind a red run — which is what led to hand-built, unlabelled images in
production.

THE FIX: verify chain-of-custody on the image ACTUALLY PUSHED, which is
satisfiable in one pass, and treat the digest as an OUTPUT for the exe-os stack
manifest to pin (stack-release.ts already consumes it that way).

Checks (ALL fail-closed):
  git_sha     org.exe.git_sha == the released commit
  repo        org.exe.repo    == this repository
  tree_clean  org.exe.tree_clean == "true"
  tag_digest  the pushed tag resolves to the digest we just built

Reads labels from the pushed image by DIGEST. A multi-arch manifest INDEX is
resolved to its linux/amd64 child before reading .Config.Labels — reading labels
off an index yields none and would false-negative (exe-os bug e98a77d8).

ESM/dep-free equivalent: stdlib only, no pip installs in CI.
"""

import argparse
import json
import subprocess
import sys

MEDIA_INDEX = {
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
}


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)} failed: {p.stderr.strip()}")
    return p.stdout


def inspect_raw(ref):
    return json.loads(run(["docker", "buildx", "imagetools", "inspect", ref, "--raw"]))


def resolve_amd64_child(ref, doc):
    """If ref is a manifest index, return the linux/amd64 child ref; else ref."""
    if doc.get("mediaType") not in MEDIA_INDEX:
        return ref, doc
    repo = ref.split("@")[0].rsplit(":", 1)[0] if "@" not in ref else ref.split("@")[0]
    for m in doc.get("manifests", []):
        plat = m.get("platform") or {}
        if plat.get("os") == "linux" and plat.get("architecture") == "amd64":
            child = f"{repo}@{m['digest']}"
            return child, inspect_raw(child)
    raise RuntimeError(f"no linux/amd64 child in index for {ref}")


def read_labels(ref):
    """Return the image config's labels dict for ref (index-aware)."""
    doc = inspect_raw(ref)
    child_ref, child = resolve_amd64_child(ref, doc)
    cfg_digest = (child.get("config") or {}).get("digest")
    if not cfg_digest:
        raise RuntimeError(f"manifest for {child_ref} has no config digest")
    repo = child_ref.split("@")[0]
    # imagetools can fetch a blob by digest via the repo@digest form
    cfg = json.loads(run(["docker", "buildx", "imagetools", "inspect",
                          f"{repo}@{cfg_digest}", "--raw"]))
    return ((cfg.get("config") or {}).get("Labels")
            or (cfg.get("container_config") or {}).get("Labels")
            or {})


def verify(actual_sha, expected_sha, actual_repo, expected_repo,
           tree_clean, built_digest, tag_digest):
    """Pure predicate — no I/O, unit-testable. Returns list of failures."""
    def norm(v):
        return v.strip().lower() if isinstance(v, str) else v

    failures = []

    if not actual_sha:
        failures.append(("git_sha",
                         f"image carries no org.exe.git_sha label (expected {expected_sha}). "
                         "Un-stamped image — cannot prove contents came from the tag."))
    elif norm(actual_sha) != norm(expected_sha):
        failures.append(("git_sha",
                         f"image org.exe.git_sha ({actual_sha}) != released commit ({expected_sha}). "
                         "Image contents do not originate from the tag it wears."))

    if not actual_repo:
        failures.append(("repo", f"image carries no org.exe.repo label (expected {expected_repo})."))
    elif norm(actual_repo) != norm(expected_repo):
        failures.append(("repo",
                         f"image org.exe.repo ({actual_repo}) != this repository ({expected_repo})."))

    if norm(tree_clean) != "true":
        failures.append(("tree_clean",
                         f"image org.exe.tree_clean is {tree_clean!r}, expected 'true'. "
                         "Released images must be built from a clean tree."))

    if tag_digest is not None and norm(tag_digest) != norm(built_digest):
        failures.append(("tag_digest",
                         f"the released tag resolves to {tag_digest}, but this run built "
                         f"{built_digest}. The tag does not point at the artifact we verified "
                         "(concurrent push or tag reuse)."))

    return failures


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image-tag", required=True, help="published tag ref, e.g. ghcr.io/askexe/exe-crm:v0.9.55")
    ap.add_argument("--built-digest", required=True, help="digest from build-push (sha256:...)")
    ap.add_argument("--expected-sha", required=True)
    ap.add_argument("--expected-repo", required=True)
    ap.add_argument("--self-test", action="store_true", help="run the negative-test suite and exit")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    if not args.built_digest.startswith("sha256:") or len(args.built_digest) != 71:
        print(f"::error::build-push did not produce a valid sha256 digest (got {args.built_digest!r}). "
              "Refusing to release without an immutable digest.")
        return 1

    repo_no_tag = args.image_tag.rsplit(":", 1)[0]
    pinned = f"{repo_no_tag}@{args.built_digest}"

    # Labels come from the image we PUSHED, addressed by its immutable digest —
    # never from the mutable tag, which a concurrent push could move.
    labels = read_labels(pinned)

    # Independently: does the tag actually point at what we built?
    try:
        tag_digest = resolve_tag_digest(args.image_tag)
    except Exception as e:  # noqa: BLE001
        print(f"::error::could not resolve the released tag {args.image_tag}: {e}")
        return 1

    failures = verify(
        actual_sha=labels.get("org.exe.git_sha"),
        expected_sha=args.expected_sha,
        actual_repo=labels.get("org.exe.repo"),
        expected_repo=args.expected_repo,
        tree_clean=labels.get("org.exe.tree_clean"),
        built_digest=args.built_digest,
        tag_digest=tag_digest,
    )

    print(f"Verifying chain-of-custody for {pinned}")
    print(f"  org.exe.git_sha    = {labels.get('org.exe.git_sha')}  (expected {args.expected_sha})")
    print(f"  org.exe.repo       = {labels.get('org.exe.repo')}  (expected {args.expected_repo})")
    print(f"  org.exe.tree_clean = {labels.get('org.exe.tree_clean')}")
    print(f"  tag resolves to    = {tag_digest}  (built {args.built_digest})")

    if failures:
        for check, msg in failures:
            print(f"::error::[{check}] {msg}")
        print("::error::Chain-of-custody verification FAILED. Failing closed.")
        return 1

    print(f"Verified: {args.image_tag} is {args.built_digest} and provably built "
          f"from {args.expected_sha} in {args.expected_repo}.")
    return 0


def resolve_tag_digest(tag_ref):
    """Registry's own digest for a tag (Docker-Content-Digest), via imagetools."""
    out = run(["docker", "buildx", "imagetools", "inspect", tag_ref])
    for line in out.splitlines():
        if line.strip().lower().startswith("digest:"):
            return line.split(":", 1)[1].strip()
    raise RuntimeError(f"no Digest line in imagetools output for {tag_ref}")


def self_test():
    """Negative tests for the pure predicate — proves the gate fails closed."""
    GOOD = dict(actual_sha="abc123", expected_sha="abc123",
                actual_repo="AskExe/exe-crm", expected_repo="AskExe/exe-crm",
                tree_clean="true", built_digest="sha256:" + "a" * 64,
                tag_digest="sha256:" + "a" * 64)
    cases = [
        ("happy path passes", GOOD, []),
        ("ATTACK: image built from a DIFFERENT sha",
         {**GOOD, "actual_sha": "deadbeef"}, ["git_sha"]),
        ("ATTACK: un-stamped image (no git_sha label)",
         {**GOOD, "actual_sha": None}, ["git_sha"]),
        ("ATTACK: image from a different repo",
         {**GOOD, "actual_repo": "AskExe/exe-wiki"}, ["repo"]),
        ("ATTACK: un-stamped repo label",
         {**GOOD, "actual_repo": None}, ["repo"]),
        ("ATTACK: built from a dirty tree",
         {**GOOD, "tree_clean": "false"}, ["tree_clean"]),
        ("ATTACK: missing tree_clean label",
         {**GOOD, "tree_clean": None}, ["tree_clean"]),
        ("ATTACK: re-tagged OLD image (tag != built digest)",
         {**GOOD, "tag_digest": "sha256:" + "b" * 64}, ["tag_digest"]),
        ("ATTACK: everything wrong at once",
         {**GOOD, "actual_sha": "x", "actual_repo": "y", "tree_clean": "false",
          "tag_digest": "sha256:" + "c" * 64},
         ["git_sha", "repo", "tree_clean", "tag_digest"]),
        ("case/whitespace normalisation does NOT weaken the check",
         {**GOOD, "actual_sha": "  ABC123  ", "actual_repo": "askexe/EXE-CRM",
          "tree_clean": "TRUE"}, []),
    ]
    failed = 0
    for name, kwargs, expected_checks in cases:
        got = [c for c, _ in verify(**kwargs)]
        ok = sorted(got) == sorted(expected_checks)
        print(f"  {'PASS' if ok else 'FAIL'}  {name}")
        if not ok:
            print(f"        expected failures {expected_checks}, got {got}")
            failed += 1
    print(f"\n{len(cases) - failed}/{len(cases)} self-tests passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
