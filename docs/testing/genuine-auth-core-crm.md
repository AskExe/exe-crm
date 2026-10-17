# Genuine Auth/Core/CRM fixture

Prerequisites: exact Auth148/Core42/CRM215 source roots; already-local digest-pinned GoTrue, PostgreSQL, Redis and admitted CRM server-only ARM64 image; Docker; 20 GiB free disk. No native-image rebuild, host dependency install, supplier fallback or limiter change. Stock Core42 locked dependency build deliberately uses default build networking for npm/official Prisma acquisition; Auth build uses network none. Runtime services use owned private networks. This does not claim a build hostname firewall.

Run from the Auth fixture checkout with `AUTH_COMPANY_CORE_ROOT`, `AUTH_COMPANY_CRM_ROOT` and `AUTH_COMPANY_CRM_MANIFEST` pointing at the exact reviewed roots and native images manifest:

```sh
node scripts/test-crm-real-chain.mjs
```

A single shared planning end is 900 seconds; work uses 840 seconds, preserving a one-minute reserve. Finally cleanup has one separate shared 60-second budget, native first then Auth. Commands and retained output remain bounded; application 9-second requests, eight active requests and 30 reads per credential/minute are unchanged. No credential rotation or retry of rate denial.

Observed ninth invocation: 9/9 named groups, exit0, four Source pins stable, native result no primary/secondary cleanup errors, Auth cleanup successful. The operator never adopts an email-matching bootstrap admin: it creates distinct users from genuine current opaque-target identity, disables native passwords and sets explicit native permissions. Real native APIs remove only the exact five verified stock seeds; final two-ID datasets are checked independently before genuine requests.

Coverage: real emailed confirmation/Auth parents; A owner/member callbacks and native ACL/row predicate; B separate database; foreign-parent refusal; A-at-B opaque-session refusal bracketed by B positives and fresh unchanged A authority; native role removal/restoration; Core membership revocation with Auth parent still current; actual parent logout.

Limitations: controlled commerce/technical state; parent TTL3600 with expiry untested; direct HTTP rather than browser; no MCP, capacity, production packaging, public onboarding or deploy. Native runtime is a stock compiled server-only development artifact. Eight prior failures are retained outside the checkouts and not relabeled as successful. Private raw credentials/logs are not PR attachments.
