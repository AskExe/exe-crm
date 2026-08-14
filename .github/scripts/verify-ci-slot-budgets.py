#!/usr/bin/env python3
"""Verify every self-hosted CI job can outlive the shared slot limiter.

Bug 9e92b1c7. The self-hosted runner host `build-my` installs a job-started
hook, /opt/ci-hooks/ci-slot-acquire.sh, which gates EVERY job behind a global
concurrency limiter shared across all repos on the host:

    SLOTS="${BUILD_MY_CI_SLOTS:-2}"        # two concurrent jobs, host-wide
    MAXWAIT="${BUILD_MY_CI_MAXWAIT:-1500}" # a job may block here for 25 minutes

`timeout-minutes` covers the WHOLE job, including that hook. So a job whose
budget is smaller than MAXWAIT can burn its entire allowance while still queued
and be cancelled with Checkout and every real step SKIPPED -- a required check
reporting failure without ever having run. That is not a hypothetical: it was
observed on PR #72 (Brand drift check, timeout-minutes: 5, 12m28s inside
ci-slot-acquire, all steps skipped) and again on PR #100 (6m32s).

The floor is therefore structural, not a guess: any self-hosted job MUST have
timeout-minutes strictly greater than MAXWAIT in minutes, or it is unsatisfiable
under the limiter. This script fails closed so the condition cannot silently
return the next time someone adds a job or trims a budget.

Usage:
    verify-ci-slot-budgets.py [WORKFLOW ...]   # default .github/workflows/ci.yml
    verify-ci-slot-budgets.py --self-test
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# BUILD_MY_CI_MAXWAIT=1500s. A job can legitimately sit this long in the hook
# before its first step runs, so a budget at or below it is unsatisfiable.
MAXWAIT_MINUTES = 25

_JOB_RE = re.compile(r"^  ([A-Za-z0-9_-]+):\s*$")
_RUNS_ON_RE = re.compile(r"^    runs-on:\s*(.*)$")
_TIMEOUT_RE = re.compile(r"^    timeout-minutes:\s*(\d+)")


def parse_jobs(text: str) -> list[dict]:
    """Extract (name, runs_on, timeout) for each top-level job.

    Deliberately a line parser rather than PyYAML: the runner image is not
    guaranteed to have PyYAML, and this only needs three keys at a fixed
    indentation that the repo's own workflow style already follows.
    """
    jobs: list[dict] = []
    current: dict | None = None
    in_jobs = False

    for lineno, line in enumerate(text.split("\n"), 1):
        if re.match(r"^jobs:\s*$", line):
            in_jobs = True
            continue
        if not in_jobs:
            continue
        # A non-indented, non-blank line ends the jobs block.
        if line and not line.startswith(" ") and not line.startswith("#"):
            break

        job_match = _JOB_RE.match(line)
        if job_match:
            current = {
                "name": job_match.group(1),
                "line": lineno,
                "runs_on": "",
                "timeout": None,
            }
            jobs.append(current)
            continue
        if current is None:
            continue
        runs_match = _RUNS_ON_RE.match(line)
        if runs_match:
            current["runs_on"] = runs_match.group(1).strip()
        timeout_match = _TIMEOUT_RE.match(line)
        if timeout_match:
            current["timeout"] = int(timeout_match.group(1))

    return jobs


def check(text: str, source: str) -> list[str]:
    failures = []
    for job in parse_jobs(text):
        if "self-hosted" not in job["runs_on"]:
            continue
        timeout = job["timeout"]
        if timeout is None:
            failures.append(
                f"{source}:{job['line']}: job '{job['name']}' runs on the "
                f"self-hosted limiter but declares no timeout-minutes"
            )
        elif timeout <= MAXWAIT_MINUTES:
            failures.append(
                f"{source}:{job['line']}: job '{job['name']}' has "
                f"timeout-minutes: {timeout}, which is not greater than the "
                f"{MAXWAIT_MINUTES}-minute BUILD_MY_CI_MAXWAIT slot wait. The "
                f"job can be cancelled while still queued, with every step "
                f"SKIPPED (bug 9e92b1c7)."
            )
    return failures


_SELF_TEST_BAD = """
jobs:
  brand-drift:
    runs-on: ${{ github.actor == 'dependabot[bot]' && 'ubuntu-latest' || fromJSON('["self-hosted", "linux", "x64"]') }}
    timeout-minutes: 20
    steps:
      - name: Checkout
"""

_SELF_TEST_GOOD = """
jobs:
  brand-drift:
    runs-on: ${{ github.actor == 'dependabot[bot]' && 'ubuntu-latest' || fromJSON('["self-hosted", "linux", "x64"]') }}
    timeout-minutes: 30
    steps:
      - name: Checkout
  hosted-job:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Checkout
  missing-budget:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
"""


def self_test() -> int:
    problems = []

    bad = check(_SELF_TEST_BAD, "<bad>")
    if len(bad) != 1 or "timeout-minutes: 20" not in bad[0]:
        problems.append(f"expected one budget violation, got {bad!r}")

    good = check(_SELF_TEST_GOOD, "<good>")
    if good:
        problems.append(f"expected no violations, got {good!r}")

    no_timeout = check(
        '\njobs:\n  x:\n    runs-on: fromJSON(\'["self-hosted"]\')\n    steps:\n      - run: true\n',
        "<none>",
    )
    if len(no_timeout) != 1 or "no timeout-minutes" not in no_timeout[0]:
        problems.append(f"expected a missing-budget violation, got {no_timeout!r}")

    boundary = check(
        f"\njobs:\n  x:\n    runs-on: fromJSON('[\"self-hosted\"]')\n    timeout-minutes: {MAXWAIT_MINUTES}\n    steps:\n      - run: true\n",
        "<boundary>",
    )
    if len(boundary) != 1:
        problems.append(
            f"a budget EQUAL to MAXWAIT must fail (it leaves zero time to run), got {boundary!r}"
        )

    for problem in problems:
        print(f"SELF-TEST FAIL: {problem}", file=sys.stderr)
    if problems:
        return 1
    print("verify-ci-slot-budgets self-test: OK")
    return 0


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        return self_test()

    targets = [a for a in argv if not a.startswith("-")] or [
        ".github/workflows/ci.yml"
    ]

    failures = []
    for target in targets:
        path = Path(target)
        if not path.is_file():
            print(f"ERROR: no such workflow: {target}", file=sys.stderr)
            return 2
        failures.extend(check(path.read_text(), target))

    if failures:
        print(
            "CI slot-budget check FAILED -- these jobs can be cancelled while "
            "still queued behind the shared limiter:\n",
            file=sys.stderr,
        )
        for failure in failures:
            print(f"  {failure}", file=sys.stderr)
        print(
            f"\nRaise each budget above {MAXWAIT_MINUTES} minutes, or move the "
            f"job off the self-hosted runner.",
            file=sys.stderr,
        )
        return 1

    print(f"CI slot-budget check OK ({', '.join(targets)})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
