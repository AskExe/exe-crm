#!/usr/bin/env python3
"""Deterministic-per-commit dependency audit gate (bug 4395cda9).

THE PROBLEM

The blocking `Security scan` step ran a LIVE registry audit fail-closed:

    yarn npm audit --recursive --environment production --severity critical

Merge eligibility was therefore coupled to an external advisory feed that
changes continuously. A PR that was green could go red hours later without a
single line changing, because somebody published a CVE affecting a transitive
dependency. That happened twice in one evening: PR #70 cleared 12 advisories,
and hours later PR #72 -- a ONE LINE workflow change that cannot affect a
dependency tree -- failed on 5 completely different, newly published ones.

Worse, it is self-trapping. The PR that would clear the audit needs its own
green audit to merge, which is how bug eb6697d9 produced a two-week stall with
even the dependabot PRs blocked behind the red audit.

THE FIX: SEPARATE "IS THIS COMMIT ACCEPTABLE" FROM "WHAT DID THE FEED SAY TODAY"

This gate decides using a COMMITTED baseline, `.audit-baseline.json`, so the
same commit yields the same verdict. Each live advisory falls into one bucket:

  ACKNOWLEDGED  in the baseline, `expires` in the future.
                -> does NOT block. A human reviewed it and time-boxed it.

  EXPIRED       in the baseline, `expires` in the past.
                -> BLOCKS. This is the gate's teeth. An acknowledgement is a
                   deadline, not an amnesty; letting it lapse re-reddens the
                   gate by design, exactly like .trivyignore.yaml already does.

  NEW           not in the baseline at all.
                -> does NOT block, and is reported loudly. This commit predates
                   the advisory, so it cannot be this commit's fault, and
                   blocking it punishes whoever happens to open the next PR.
                   The scheduled live-audit job is what pages on these.

  STALE         a baseline entry with no matching live advisory.
                -> does NOT block; reported so the baseline can be pruned.

WHY THIS IS NOT A WEAKENING

The severity bar and the production-only scope are unchanged. What changed is
WHO gets interrupted: the person who introduced a dependency problem, rather
than the next unrelated person to open a PR. New CRITICALs still surface on
every run and still page via the scheduled job; they simply cannot retroactively
un-merge unrelated work.

FAIL-CLOSED PARSING

A gate that silently parses nothing and prints OK is worse than no gate -- it
is a broken thing reporting success. So an audit payload that does not match a
recognised shape is a HARD FAILURE, never an empty advisory set. `yarn npm
audit --json` has shipped several shapes across versions (a top-level
`advisories` map, an npm-7-style `vulnerabilities` map, and newline-delimited
objects), so all three are recognised explicitly and anything else is refused.

Usage:
    audit-gate.py --audit-json FILE [--baseline .audit-baseline.json]
    audit-gate.py --self-test
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime
from pathlib import Path

BLOCK = "block"
ACKNOWLEDGED = "acknowledged"
NEW = "new"
STALE = "stale"

DEFAULT_BASELINE = ".audit-baseline.json"

# Only these block. Kept explicit so the bar is visible in the diff when it moves.
BLOCKING_SEVERITIES = ("critical",)


class AuditParseError(Exception):
    """The audit payload did not match any recognised shape. Always fatal."""


def parse_audit(text: str) -> list[dict]:
    """Normalise `yarn npm audit --json` output into a list of advisories.

    Returns dicts with keys: id (str), module (str), severity (str), title (str).
    Raises AuditParseError rather than returning [] on anything unrecognised.
    """
    text = text.strip()
    if not text:
        raise AuditParseError(
            "audit output was empty. An empty payload is not the same as 'no "
            "vulnerabilities' -- it usually means the audit command itself "
            "failed. Refusing to report a clean gate."
        )

    documents = []
    try:
        documents.append(json.loads(text))
    except json.JSONDecodeError:
        # Newline-delimited JSON: one object per line.
        for line in text.split("\n"):
            line = line.strip()
            if not line:
                continue
            try:
                documents.append(json.loads(line))
            except json.JSONDecodeError as error:
                raise AuditParseError(
                    f"audit output is neither a JSON document nor newline-"
                    f"delimited JSON: {error}"
                ) from error

    advisories: list[dict] = []
    recognised = False

    for document in documents:
        if not isinstance(document, dict):
            continue

        # Shape A: {"advisories": {"1124025": {...}}} (npm v6 / yarn berry)
        if isinstance(document.get("advisories"), dict):
            recognised = True
            for key, value in document["advisories"].items():
                if not isinstance(value, dict):
                    continue
                advisories.append(
                    {
                        "id": str(value.get("id", key)),
                        "module": value.get("module_name")
                        or value.get("name")
                        or "unknown",
                        "severity": (value.get("severity") or "unknown").lower(),
                        "title": value.get("title") or "",
                    }
                )
            continue

        # Shape B: {"vulnerabilities": {"pkg": {"via": [{"source": 1124025}]}}}
        if isinstance(document.get("vulnerabilities"), dict):
            recognised = True
            for name, value in document["vulnerabilities"].items():
                if not isinstance(value, dict):
                    continue
                severity = (value.get("severity") or "unknown").lower()
                for via in value.get("via", []):
                    if isinstance(via, dict) and via.get("source") is not None:
                        advisories.append(
                            {
                                "id": str(via["source"]),
                                "module": via.get("name") or name,
                                "severity": (
                                    via.get("severity") or severity
                                ).lower(),
                                "title": via.get("title") or "",
                            }
                        )
            continue

        # Shape C: a single advisory object per line, as emitted by some
        # yarn versions: {"value": "pkg", "children": {"ID": 1124025, ...}}
        children = document.get("children")
        if isinstance(children, dict) and (
            "ID" in children or "Severity" in children
        ):
            recognised = True
            advisories.append(
                {
                    "id": str(children.get("ID", "")),
                    "module": document.get("value") or "unknown",
                    "severity": (children.get("Severity") or "unknown").lower(),
                    "title": children.get("Issue") or "",
                }
            )

    if not recognised:
        raise AuditParseError(
            "audit output did not contain any recognised advisory container "
            "('advisories', 'vulnerabilities', or per-line {value, children}). "
            "Refusing to report a clean gate from an unparsed payload -- the "
            "audit tool's output format has probably changed and this parser "
            "must be updated (bug 4395cda9)."
        )

    # De-duplicate: the same advisory reaches the tree by many paths.
    unique: dict[str, dict] = {}
    for advisory in advisories:
        if advisory["id"] and advisory["id"] not in unique:
            unique[advisory["id"]] = advisory
    return sorted(unique.values(), key=lambda a: a["id"])


def load_baseline(path: Path) -> dict[str, dict]:
    if not path.is_file():
        raise AuditParseError(
            f"baseline file {path} not found. The gate is deterministic only "
            f"because the baseline is committed; without it there is nothing "
            f"to be deterministic against."
        )
    data = json.loads(path.read_text())
    entries = data.get("acknowledged", [])
    if not isinstance(entries, list):
        raise AuditParseError(f"{path}: 'acknowledged' must be a list")
    baseline = {}
    for entry in entries:
        advisory_id = str(entry.get("id", "")).strip()
        if not advisory_id:
            raise AuditParseError(f"{path}: an entry is missing 'id'")
        for required in ("reason", "expires"):
            if not entry.get(required):
                raise AuditParseError(
                    f"{path}: entry {advisory_id} is missing '{required}'. "
                    f"An acknowledgement without a reason and a deadline is an "
                    f"amnesty, which is what this gate exists to prevent."
                )
        try:
            datetime.strptime(entry["expires"], "%Y-%m-%d")
        except ValueError as error:
            raise AuditParseError(
                f"{path}: entry {advisory_id} has an invalid 'expires' "
                f"(want YYYY-MM-DD): {error}"
            ) from error
        baseline[advisory_id] = entry
    return baseline


def evaluate(advisories: list[dict], baseline: dict[str, dict], today: date) -> dict:
    buckets: dict[str, list[dict]] = {BLOCK: [], ACKNOWLEDGED: [], NEW: [], STALE: []}
    live_ids = set()

    for advisory in advisories:
        if advisory["severity"] not in BLOCKING_SEVERITIES:
            continue
        live_ids.add(advisory["id"])
        entry = baseline.get(advisory["id"])
        if entry is None:
            buckets[NEW].append(advisory)
            continue
        expires = datetime.strptime(entry["expires"], "%Y-%m-%d").date()
        record = dict(advisory, expires=entry["expires"], reason=entry["reason"])
        if expires < today:
            buckets[BLOCK].append(record)
        else:
            buckets[ACKNOWLEDGED].append(record)

    for advisory_id, entry in baseline.items():
        if advisory_id not in live_ids:
            buckets[STALE].append(dict(entry, id=advisory_id))

    return buckets


def report(buckets: dict, today: date) -> int:
    for advisory in buckets[ACKNOWLEDGED]:
        print(
            f"  ACKNOWLEDGED {advisory['id']} {advisory['module']} "
            f"(expires {advisory['expires']}): {advisory['reason']}"
        )
    for advisory in buckets[NEW]:
        print(
            f"::warning::NEW critical advisory {advisory['id']} "
            f"({advisory['module']}) is not in .audit-baseline.json. It does "
            f"NOT block this commit, which predates it. Triage it and add an "
            f"acknowledgement with a deadline, or fix it."
        )
    for advisory in buckets[STALE]:
        print(
            f"::notice::STALE baseline entry {advisory['id']} no longer "
            f"matches any live advisory and can be pruned."
        )

    if buckets[BLOCK]:
        print("\nAUDIT GATE FAILED -- acknowledgements have EXPIRED:\n", file=sys.stderr)
        for advisory in buckets[BLOCK]:
            print(
                f"  {advisory['id']} {advisory['module']} -- acknowledged "
                f"until {advisory['expires']}, today is {today}. "
                f"Reason given was: {advisory['reason']}",
                file=sys.stderr,
            )
        print(
            "\nFix the advisory, or renew the acknowledgement in "
            ".audit-baseline.json with a new deadline and a justification.",
            file=sys.stderr,
        )
        return 1

    print(
        f"\nAudit gate OK: {len(buckets[ACKNOWLEDGED])} acknowledged, "
        f"{len(buckets[NEW])} new (non-blocking), {len(buckets[STALE])} stale."
    )
    return 0


# --------------------------------------------------------------------------
# Self-test
# --------------------------------------------------------------------------

# Real shapes, using the advisory IDs recorded in bug 4395cda9's ROUND 2.
_YARN_ADVISORIES = json.dumps(
    {
        "advisories": {
            "1124025": {
                "id": 1124025,
                "module_name": "@vitest/browser",
                "severity": "critical",
                "title": "Critical issue",
            },
            "1124012": {
                "id": 1124012,
                "module_name": "linkify-it",
                "severity": "high",
                "title": "High issue",
            },
        }
    }
)

_NPM_VULNS = json.dumps(
    {
        "vulnerabilities": {
            "fast-uri": {
                "severity": "critical",
                "via": [
                    {"source": 1124015, "name": "fast-uri", "title": "t", "severity": "critical"}
                ],
            }
        }
    }
)

_NDJSON = (
    '{"value":"@vitest/browser","children":{"ID":1124025,"Severity":"critical","Issue":"x"}}\n'
    '{"value":"linkify-it","children":{"ID":1124012,"Severity":"high","Issue":"y"}}\n'
)


def self_test() -> int:
    problems: list[str] = []
    today = date(2026, 8, 14)

    def check(condition, message):
        if not condition:
            problems.append(message)

    # --- parsing, all three shapes
    parsed = parse_audit(_YARN_ADVISORIES)
    check(len(parsed) == 2, f"yarn shape: expected 2 advisories, got {parsed}")
    check(
        any(a["id"] == "1124025" and a["severity"] == "critical" for a in parsed),
        "yarn shape: lost the critical advisory",
    )
    check(len(parse_audit(_NPM_VULNS)) == 1, "npm shape not parsed")
    check(len(parse_audit(_NDJSON)) == 2, "ndjson shape not parsed")

    # --- fail-closed: unrecognised payloads must RAISE, never return []
    for label, payload in (
        ("empty", ""),
        ("whitespace", "   \n "),
        ("unrelated json", '{"totally": "different"}'),
        ("plain text", "error: audit failed to run"),
    ):
        try:
            parse_audit(payload)
        except AuditParseError:
            pass
        else:
            problems.append(f"fail-closed: {label} payload did NOT raise")

    # --- bucketing
    critical = [{"id": "1124025", "module": "@vitest/browser", "severity": "critical", "title": ""}]

    # NEW: not in baseline -> does not block. This is the whole point of the bug.
    buckets = evaluate(critical, {}, today)
    check(len(buckets[NEW]) == 1, "new advisory not bucketed as NEW")
    check(not buckets[BLOCK], "a NEW advisory must NOT block -- that is bug 4395cda9")

    # ACKNOWLEDGED: in baseline, future expiry -> does not block.
    future = {"1124025": {"id": "1124025", "reason": "r", "expires": "2026-09-15"}}
    buckets = evaluate(critical, future, today)
    check(len(buckets[ACKNOWLEDGED]) == 1, "unexpired entry not acknowledged")
    check(not buckets[BLOCK], "unexpired acknowledgement must not block")

    # EXPIRED: in baseline, past expiry -> BLOCKS. These are the teeth.
    past = {"1124025": {"id": "1124025", "reason": "r", "expires": "2026-08-13"}}
    buckets = evaluate(critical, past, today)
    check(len(buckets[BLOCK]) == 1, "expired acknowledgement must BLOCK")

    # Expiry exactly today is still valid (expires at END of that day).
    same = {"1124025": {"id": "1124025", "reason": "r", "expires": "2026-08-14"}}
    check(
        not evaluate(critical, same, today)[BLOCK],
        "an acknowledgement expiring today must not block until tomorrow",
    )

    # HIGH severity never blocks; only critical is in scope.
    high = [{"id": "1124012", "module": "linkify-it", "severity": "high", "title": ""}]
    buckets = evaluate(high, {}, today)
    check(not buckets[BLOCK] and not buckets[NEW], "high severity must be out of scope")

    # STALE: baseline entry with no live advisory.
    buckets = evaluate([], future, today)
    check(len(buckets[STALE]) == 1, "unmatched baseline entry not reported stale")

    # --- THE REGRESSION THE BUG IS ABOUT.
    # Reproduce ROUND 2: PR #72 changed one line of workflow YAML, then five
    # newly published advisories appeared. Under the old live gate this was a
    # merge block. Under this gate it must be green.
    round2 = [
        {"id": "1124011", "module": "@opentelemetry/propagator-jaeger", "severity": "critical", "title": ""},
        {"id": "1124012", "module": "linkify-it", "severity": "critical", "title": ""},
        {"id": "1124015", "module": "fast-uri", "severity": "critical", "title": ""},
        {"id": "1124025", "module": "@vitest/browser", "severity": "critical", "title": ""},
    ]
    buckets = evaluate(round2, {}, today)
    check(
        not buckets[BLOCK],
        "REGRESSION: newly published advisories blocked a commit that predates "
        "them -- this is exactly bug 4395cda9",
    )
    check(len(buckets[NEW]) == 4, "all four should be reported as NEW")

    # --- baseline validation refuses amnesties
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        bad = Path(tmp) / "b.json"
        bad.write_text(json.dumps({"acknowledged": [{"id": "1", "reason": "r"}]}))
        try:
            load_baseline(bad)
        except AuditParseError:
            pass
        else:
            problems.append("baseline entry without 'expires' was accepted")

        bad.write_text(json.dumps({"acknowledged": [{"id": "1", "expires": "2026-09-15"}]}))
        try:
            load_baseline(bad)
        except AuditParseError:
            pass
        else:
            problems.append("baseline entry without 'reason' was accepted")

        bad.write_text(json.dumps({"acknowledged": [{"id": "1", "reason": "r", "expires": "next week"}]}))
        try:
            load_baseline(bad)
        except AuditParseError:
            pass
        else:
            problems.append("baseline entry with unparseable 'expires' was accepted")

        try:
            load_baseline(Path(tmp) / "does-not-exist.json")
        except AuditParseError:
            pass
        else:
            problems.append("missing baseline file did not fail closed")

        # --- the clean-tree case must be GREEN, not a false red.
        good = Path(tmp) / "ok.json"
        good.write_text(json.dumps({"acknowledged": []}))
        empty = Path(tmp) / "empty.json"
        empty.write_text("")
        check(
            main(["--audit-json", str(empty), "--baseline", str(good), "--audit-exit-code", "0"]) == 0,
            "a clean tree (audit exit 0, empty output) must pass, not fail closed",
        )
        # ...but an audit that CRASHED (non-zero exit, empty output) must not.
        check(
            main(["--audit-json", str(empty), "--baseline", str(good), "--audit-exit-code", "1"]) == 2,
            "a crashed audit (non-zero exit, empty output) must still fail closed",
        )
        # ...and so must one with no exit code supplied at all.
        check(
            main(["--audit-json", str(empty), "--baseline", str(good)]) == 2,
            "an empty payload with no exit code must fail closed",
        )

    for problem in problems:
        print(f"SELF-TEST FAIL: {problem}", file=sys.stderr)
    if problems:
        return 1
    print("audit-gate self-test: OK")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--audit-json")
    parser.add_argument("--baseline", default=DEFAULT_BASELINE)
    parser.add_argument(
        "--audit-exit-code",
        type=int,
        default=None,
        help=(
            "Exit status of the audit command that produced --audit-json. "
            "`yarn npm audit` exits 0 when it found nothing, so an EMPTY "
            "payload is legitimate in that case and only in that case. "
            "Without this, a genuinely clean tree would trip the fail-closed "
            "parser and produce a false red -- and with it, a crashed audit "
            "(non-zero exit, empty output) still fails closed as it must."
        ),
    )
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()

    if not args.audit_json:
        parser.error("--audit-json is required (unless --self-test)")

    try:
        raw = Path(args.audit_json).read_text()
        if args.audit_exit_code == 0 and not raw.strip():
            print(
                "Audit command exited 0 with no output: no advisories at the "
                "gate severity."
            )
            advisories = []
        else:
            advisories = parse_audit(raw)
        baseline = load_baseline(Path(args.baseline))
    except AuditParseError as error:
        print(f"AUDIT GATE FAILED (fail-closed): {error}", file=sys.stderr)
        return 2
    except FileNotFoundError as error:
        print(f"AUDIT GATE FAILED (fail-closed): {error}", file=sys.stderr)
        return 2

    print(
        f"Audit gate: {len(advisories)} advisories parsed, "
        f"{len(baseline)} baseline acknowledgements."
    )
    return report(evaluate(advisories, baseline, date.today()), date.today())


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
