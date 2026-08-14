#!/usr/bin/env python3
"""Release run health checker (bug 615c14d9).

The "Release stack image" workflow runs on a self-hosted runner
(`runs-on: [self-hosted, linux, x64]`). Between 2026-06-11 and 2026-06-22,
five consecutive release runs (v0.9.48 .. v0.9.51) were never assigned a
runner because no self-hosted runner existed for the repo at the time. Each
run sat QUEUED for exactly 24 hours and then GitHub expired it with
conclusion `cancelled` (e.g. run 27935301901, created 2026-06-22T06:59:57Z,
updated 2026-06-23T06:59:59Z, job `release-image` with an empty runner
name). Because a cancelled queued job produces no failure notification,
nobody noticed for six weeks: version tags were pushed and images appeared
in the registry via some other hand-built path while the actual release
pipeline was silently dead.

This script exists so that a release which never gets a runner pages
someone instead of expiring silently 24 hours later. It alerts on exactly
two SILENT failure modes:

  REASON_CANCELLED     — a run with status `completed` and conclusion
                         `cancelled`. This is the 24-hour silent-expiry
                         mode from the bug.
  REASON_STUCK_QUEUED  — a run still in a non-terminal state (`queued`,
                         `waiting`, `requested`) whose created_at is more
                         than N minutes old (default 30). This catches the
                         failure EARLY — within ~15 minutes via the
                         scheduled `release-run-health.yml` sweep — rather
                         than 24 hours later.

`failure` is deliberately NOT an alert reason: a failed release is already
loud (red X, author email, chat notifications). This bug is specifically
about silent modes, and re-paging on ordinary failures would train people
to ignore this alerter. Likewise `success`, `in_progress`, and
recently-queued runs produce no alert.

Standard library only — the runner that executes this may not have PyYAML,
requests, or any pip packages installed.
"""

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone

REASON_CANCELLED = "cancelled"
REASON_STUCK_QUEUED = "stuck_queued"

# Non-terminal statuses that mean "waiting for a runner" (or for a pending
# one to pick the job up). `in_progress` is deliberately absent: a run that
# HAS a runner is healthy by definition.
QUEUED_STATUSES = ("queued", "waiting", "requested")

DEFAULT_QUEUED_ALERT_MINUTES = 30


def parse_created_at(value):
    # GitHub returns e.g. "2026-06-22T06:59:57Z". Do NOT use fromisoformat
    # for the Z suffix: it only handles it on Python 3.11+, and the runner
    # may run an older Python.
    parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    return parsed.replace(tzinfo=timezone.utc)


def classify_runs(runs, now, queued_alert_minutes=DEFAULT_QUEUED_ALERT_MINUTES):
    """Return a list of alert dicts for runs that need to page someone."""
    alerts = []
    for run in runs:
        run_id = run.get("id")
        status = run.get("status")
        conclusion = run.get("conclusion")
        display_title = run.get("display_title") or "(no title)"
        html_url = run.get("html_url") or ""

        if status == "completed" and conclusion == "cancelled":
            alerts.append(
                {
                    "run_id": run_id,
                    "reason": REASON_CANCELLED,
                    "detail": (
                        f"run {run_id} ('{display_title}') completed as "
                        "cancelled — this is how a release that never got a "
                        "self-hosted runner expires silently after 24h"
                    ),
                    "html_url": html_url,
                    "display_title": display_title,
                }
            )
            continue

        if status in QUEUED_STATUSES:
            created_at = parse_created_at(run.get("created_at"))
            queued_minutes = (now - created_at).total_seconds() / 60.0
            if queued_minutes > queued_alert_minutes:
                alerts.append(
                    {
                        "run_id": run_id,
                        "reason": REASON_STUCK_QUEUED,
                        "detail": (
                            f"run {run_id} ('{display_title}') has been in "
                            f"status '{status}' for {queued_minutes:.0f} "
                            f"minutes (threshold: {queued_alert_minutes}) — "
                            "likely no self-hosted runner available"
                        ),
                        "html_url": html_url,
                        "display_title": display_title,
                    }
                )

    return alerts


def format_alert_body(alerts):
    lines = [
        "The release pipeline health check found "
        f"{len(alerts)} problem run(s):",
        "",
    ]
    for alert in alerts:
        lines.append(
            f"- **{alert['reason']}** — [{alert['display_title']}]"
            f"({alert['html_url']}) (run `{alert['run_id']}`): {alert['detail']}"
        )
    return "\n".join(lines)


def write_github_output(path, alerts):
    # $GITHUB_OUTPUT format: append-only; multiline values use a heredoc
    # with a unique delimiter.
    with open(path, "a") as handle:
        handle.write(f"alert_count={len(alerts)}\n")
        handle.write("alert_body<<RELEASE_RUN_HEALTH_EOF\n")
        handle.write(format_alert_body(alerts))
        handle.write("\nRELEASE_RUN_HEALTH_EOF\n")


def self_test():
    now = datetime(2026, 6, 22, 12, 0, 0, tzinfo=timezone.utc)

    def make_run(run_id, status, conclusion=None, minutes_before=0):
        created = now - timedelta(minutes=minutes_before)
        return {
            "id": run_id,
            "status": status,
            "conclusion": conclusion,
            "created_at": created.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "html_url": f"https://example.com/runs/{run_id}",
            "display_title": f"run {run_id}",
            "head_sha": "0" * 40,
        }

    def assert_no_alert(runs, minutes=30, label=""):
        result = classify_runs(runs, now, queued_alert_minutes=minutes)
        assert result == [], f"{label}: expected no alerts, got {result}"

    def assert_alerts(runs, expected_reasons, minutes=30, label=""):
        result = classify_runs(runs, now, queued_alert_minutes=minutes)
        reasons = [alert["reason"] for alert in result]
        assert reasons == expected_reasons, (
            f"{label}: expected reasons {expected_reasons}, got {reasons}"
        )
        for alert in result:
            for key in ("run_id", "reason", "detail", "html_url", "display_title"):
                assert key in alert, f"{label}: alert missing key '{key}'"

    # A cancelled run alerts.
    assert_alerts(
        [make_run(1, "completed", conclusion="cancelled")],
        [REASON_CANCELLED],
        label="cancelled run",
    )
    # A success run does not.
    assert_no_alert(
        [make_run(2, "completed", conclusion="success")], label="success run"
    )
    # A failure run does not (failures are already loud).
    assert_no_alert(
        [make_run(3, "completed", conclusion="failure")], label="failure run"
    )
    # A timed_out run does not either — it already notified.
    assert_no_alert(
        [make_run(4, "completed", conclusion="timed_out")], label="timed_out run"
    )
    # A run queued 31 minutes alerts as stuck_queued.
    assert_alerts(
        [make_run(5, "queued", minutes_before=31)],
        [REASON_STUCK_QUEUED],
        label="queued 31 min",
    )
    # A run queued 5 minutes does not.
    assert_no_alert(
        [make_run(6, "queued", minutes_before=5)], label="queued 5 min"
    )
    # A run in_progress for hours does not — it has a runner.
    assert_no_alert(
        [make_run(7, "in_progress", minutes_before=600)],
        label="in_progress 10h",
    )
    # The exact boundary (queued for precisely the threshold) does NOT
    # alert — strictly greater than only.
    assert_no_alert(
        [make_run(8, "queued", minutes_before=30)],
        label="queued exactly 30 min",
    )
    # `waiting` and `requested` count as queued for threshold purposes.
    assert_alerts(
        [make_run(9, "waiting", minutes_before=45)],
        [REASON_STUCK_QUEUED],
        label="waiting 45 min",
    )
    assert_alerts(
        [make_run(10, "requested", minutes_before=45)],
        [REASON_STUCK_QUEUED],
        label="requested 45 min",
    )
    # An empty input list yields no alerts.
    assert_no_alert([], label="empty list")
    # Mixed input only flags the problem runs, preserving input order.
    assert_alerts(
        [
            make_run(11, "completed", conclusion="success"),
            make_run(12, "queued", minutes_before=5),
            make_run(13, "completed", conclusion="cancelled"),
            make_run(14, "queued", minutes_before=31),
        ],
        [REASON_CANCELLED, REASON_STUCK_QUEUED],
        label="mixed",
    )
    # Threshold override works.
    assert_alerts(
        [make_run(15, "queued", minutes_before=11)],
        [REASON_STUCK_QUEUED],
        minutes=10,
        label="threshold override",
    )


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Alert on release runs that expired cancelled or are stuck queued."
    )
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--input", dest="input_file")
    parser.add_argument(
        "--queued-alert-minutes",
        type=int,
        default=DEFAULT_QUEUED_ALERT_MINUTES,
    )
    parser.add_argument("--github-output", dest="github_output")
    args = parser.parse_args(argv)

    if args.self_test:
        try:
            self_test()
        except AssertionError as error:
            print(f"SELF-TEST FAILED: {error}")
            return 1
        print("SELF-TEST PASSED: all release run health assertions hold.")
        return 0

    if not args.input_file:
        parser.error("--input is required (unless --self-test)")

    with open(args.input_file) as handle:
        payload = json.load(handle)
    # The GitHub API returns {"workflow_runs": [...]}; a bare list is also
    # accepted for local testing.
    if isinstance(payload, dict):
        runs = payload.get("workflow_runs", [])
    else:
        runs = payload

    now = datetime.now(timezone.utc)
    alerts = classify_runs(runs, now, queued_alert_minutes=args.queued_alert_minutes)

    if args.github_output:
        write_github_output(args.github_output, alerts)

    if alerts:
        print(f"ALERT: {len(alerts)} release run health problem(s):")
        for alert in alerts:
            print(f"  - [{alert['reason']}] {alert['detail']}")
            print(f"    {alert['html_url']}")
        return 1

    print(
        f"OK: {len(runs)} release run(s) checked, no silent failures "
        f"(threshold: {args.queued_alert_minutes} min queued)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
