#!/usr/bin/env python3
"""
Registry provenance audit for ghcr.io/askexe/exe-crm (bug 615c14d9).

This is the compensating DETECTION control for "registry write restricted to
CI" (bug 615c14d9 item 3). It catches a hand-built image that was pushed to
the registry OUTSIDE the audited release pipeline (release-stack-image.yml +
verify-image-provenance.py), which stamps org.exe.* chain-of-custody labels.
The enforcement half — restricting GHCR package write access to CI only — is
a founder config change in the GitHub org package settings; see
docs/provenance/exe-crm-historical-images-615c14d9.md.

Historical tags published BEFORE the pipeline existed are documented in
.github/known-unprovenanced-tags.txt and reported as KNOWN-LEGACY instead of
alerting forever. Any NEW tag lacking provenance alerts.

This tool is READ-ONLY: it reads image labels via
`docker buildx imagetools inspect` and never mutates the registry.

Label-reading approach mirrors .github/scripts/verify-image-provenance.py:
resolve the multi-arch index to its linux/amd64 child, then read the config
blob's Labels.
"""

import argparse
import json
import subprocess
import sys

INDEX_MEDIA_TYPES = (
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
)


def run(cmd):
    """Run a command, raising RuntimeError on nonzero exit."""
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(
            "command failed (%d): %s\n%s"
            % (proc.returncode, " ".join(cmd), proc.stderr.strip())
        )
    return proc.stdout


def read_labels(repo, tag):
    """Return the config Labels dict for repo:tag, resolved to linux/amd64.

    Raises RuntimeError on any read failure; callers record the failure as an
    "error" outcome for that tag rather than crashing the whole audit.
    """
    ref = "%s:%s" % (repo, tag)
    manifest = json.loads(run(["docker", "buildx", "imagetools", "inspect", ref, "--raw"]))

    if manifest.get("mediaType") in INDEX_MEDIA_TYPES:
        child_digest = None
        for child in manifest.get("manifests", []):
            platform = child.get("platform", {})
            if platform.get("os") == "linux" and platform.get("architecture") == "amd64":
                child_digest = child.get("digest")
                break
        if child_digest is None:
            raise RuntimeError("no linux/amd64 manifest in index for %s" % ref)
        manifest = json.loads(
            run(["docker", "buildx", "imagetools", "inspect", "%s@%s" % (repo, child_digest), "--raw"])
        )

    config_digest = (manifest.get("config") or {}).get("digest")
    if not config_digest:
        raise RuntimeError("no config digest on manifest for %s" % ref)
    config = json.loads(
        run(["docker", "buildx", "imagetools", "inspect", "%s@%s" % (repo, config_digest), "--raw"])
    )
    labels = (config.get("config") or {}).get("Labels")
    if labels is None:
        labels = (config.get("container_config") or {}).get("Labels")
    return labels or {}


def classify(labels):
    """Pure predicate over a labels dict.

    Returns "verified" (org.exe.* chain-of-custody labels, clean tree),
    "partial" (an opencontainers revision is recorded but no org.exe.* set),
    or "unverified" (no provenance information at all).
    """
    labels = labels or {}
    if labels.get("org.exe.git_sha") and str(
        labels.get("org.exe.tree_clean", "")
    ).strip().lower() == "true":
        return "verified"
    if labels.get("org.opencontainers.image.revision"):
        return "partial"
    return "unverified"


def audit(tags_to_labels, allowlist):
    """Classify each tag. Returns (rows, alerts).

    rows: list of (tag, outcome, status) tuples.
    alerts: list of tag names that must page a human.

    Only "unverified" AND not allowlisted alerts. "verified" never alerts.
    "partial" is reported (INFO) but does not alert — a real commit is
    recorded. An allowlisted "unverified" tag is KNOWN-LEGACY history.
    A read "error" is a WARN and never fails the run (a transient registry
    hiccup must not page).
    """
    rows = []
    alerts = []
    for tag in sorted(tags_to_labels):
        value = tags_to_labels[tag]
        if value is None or value == "error":
            rows.append((tag, "error", "WARN"))
            continue
        outcome = classify(value)
        if outcome == "verified":
            rows.append((tag, outcome, "OK"))
        elif outcome == "partial":
            rows.append((tag, outcome, "INFO"))
        elif tag in allowlist:
            rows.append((tag, outcome, "KNOWN-LEGACY"))
        else:
            rows.append((tag, outcome, "ALERT"))
            alerts.append(tag)
    return rows, alerts


def load_allowlist(path):
    tags = set()
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            tags.add(line)
    return tags


def build_alert_body(alerts, repo, allowlist_path):
    """Plain string concatenation, NO leading indentation on any line —
    GitHub renders indented lines as a code block."""
    body = ""
    body += "Unverified exe-crm image tag(s) detected in " + repo + ".\n"
    body += "\n"
    body += "These tags carry NO provenance labels (no org.exe.* chain-of-custody, no\n"
    body += "org.opencontainers.image.revision) and are NOT in the known-legacy allowlist\n"
    body += "(" + allowlist_path + "). They were likely built and pushed by hand, outside\n"
    body += "the audited release pipeline. This is bug 615c14d9 item 3: registry write\n"
    body += "must be restricted to CI; these tags bypassed that control.\n"
    body += "\n"
    for tag in alerts:
        body += "- " + repo + ":" + tag + " — UNVERIFIED (hand-built?)\n"
    body += "\n"
    body += "Rotate/redeploy off these tags if they are in use, then either delete them\n"
    body += "or re-release through release-stack-image.yml so they carry provenance labels.\n"
    return body


def emit_github_output(path, alert_count, alert_body):
    with open(path, "a", encoding="utf-8") as handle:
        handle.write("alert_count=%d\n" % alert_count)
        handle.write("alert_body<<AUDIT_EOF\n")
        handle.write(alert_body)
        handle.write("AUDIT_EOF\n")


def print_table(rows):
    width = max([len(tag) for tag, _, _ in rows] + [len("TAG")])
    print("%-*s  %-10s  %s" % (width, "TAG", "OUTCOME", "STATUS"))
    print("%-*s  %-10s  %s" % (width, "-" * width, "-" * 10, "-" * 12))
    for tag, outcome, status in rows:
        print("%-*s  %-10s  %s" % (width, tag, outcome, status))


def self_test():
    """Built-in fixtures; print PASS/FAIL per case, exit nonzero on any fail."""
    failures = []

    def check(name, condition):
        if condition:
            print("PASS %s" % name)
        else:
            print("FAIL %s" % name)
            failures.append(name)

    # (a) clean-tree org.exe.* labels -> verified
    check(
        "a: org.exe labels with clean tree -> verified",
        classify({"org.exe.git_sha": "abc", "org.exe.tree_clean": "true"}) == "verified",
    )
    # (b) dirty tree is not verified
    check(
        "b: dirty tree -> unverified",
        classify({"org.exe.git_sha": "abc", "org.exe.tree_clean": "false"}) == "unverified",
    )
    # (c) opencontainers revision only -> partial
    check(
        "c: opencontainers revision only -> partial",
        classify({"org.opencontainers.image.revision": "deadbeef"}) == "partial",
    )
    # (d) empty labels -> unverified
    check("d: empty labels -> unverified", classify({}) == "unverified")

    # (e) allowlist logic, driven through the same audit() the CLI uses
    tags = {"vX.Y.Z": {}}
    _, alerts = audit(tags, set())
    check("e1: unverified tag NOT in allowlist -> alert", alerts == ["vX.Y.Z"])
    _, alerts = audit(tags, {"vX.Y.Z"})
    check("e2: unverified tag in allowlist -> no alert", alerts == [])

    # (f) a verified tag never alerts even if not allowlisted
    _, alerts = audit(
        {"vA.B.C": {"org.exe.git_sha": "abc", "org.exe.tree_clean": "true"}}, set()
    )
    check("f: verified tag never alerts", alerts == [])

    # (g) a partial tag does not alert
    _, alerts = audit({"vD.E.F": {"org.opencontainers.image.revision": "deadbeef"}}, set())
    check("g: partial tag does not alert", alerts == [])

    # (h) github-output body has zero lines beginning with a space
    body = build_alert_body(["vX.Y.Z"], "ghcr.io/askexe/exe-crm", "allowlist.txt")
    check(
        "h: no body line starts with a space",
        not any(line.startswith(" ") for line in body.split("\n")),
    )

    return 1 if failures else 0


def main():
    parser = argparse.ArgumentParser(
        description="Audit published exe-crm image tags for provenance labels."
    )
    parser.add_argument("--tags", nargs="+", help="explicit tag names, e.g. v0.9.53")
    parser.add_argument("--repo", default="ghcr.io/askexe/exe-crm")
    parser.add_argument(
        "--allowlist",
        help="path to newline file of known-legacy tags (# comments and blanks ignored)",
    )
    parser.add_argument(
        "--input",
        help="path to JSON file mapping tag -> labels dict; used INSTEAD of live docker "
        "reads (tests / CI without docker)",
    )
    parser.add_argument(
        "--github-output",
        help="path to append alert_count= and an AUDIT_EOF-delimited alert_body to",
    )
    parser.add_argument(
        "--self-test", action="store_true", help="run built-in fixtures and exit 0/1"
    )
    args = parser.parse_args()

    if args.self_test:
        sys.exit(self_test())

    if not args.tags:
        parser.error("--tags is required (or use --self-test)")

    allowlist = load_allowlist(args.allowlist) if args.allowlist else set()

    tags_to_labels = {}
    if args.input:
        with open(args.input, "r", encoding="utf-8") as handle:
            tags_to_labels = json.load(handle)
    else:
        for tag in args.tags:
            try:
                tags_to_labels[tag] = read_labels(args.repo, tag)
            except RuntimeError as exc:
                print("WARN: could not read %s:%s — %s" % (args.repo, tag, exc), file=sys.stderr)
                tags_to_labels[tag] = "error"

    rows, alerts = audit(tags_to_labels, allowlist)
    print_table(rows)

    if args.github_output:
        body = build_alert_body(alerts, args.repo, args.allowlist or "(none)")
        emit_github_output(args.github_output, len(alerts), body)

    print("")
    if alerts:
        print("ALERT: %d unverified, non-legacy tag(s): %s" % (len(alerts), ", ".join(alerts)))
        sys.exit(1)
    print("OK: no new unverified tags (alerts=0)")
    sys.exit(0)


if __name__ == "__main__":
    main()
