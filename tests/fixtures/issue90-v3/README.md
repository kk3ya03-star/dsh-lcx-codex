# Issue #90 v3 checkpoint fixture

`session.v3.jsonl.zstd` is a sanitized cross-platform regeneration of the
Step 0(a) fixture, written by the **real DSH 0.1.6-alpha.2 v3 writer** from the
same synthetic event construction and fixed fake opaque payload. Regeneration
creates a fresh header timestamp; the deliberate portability change is the
header `cwd`, now `/issue90-fixture/cwd`. Node treats that path as absolute
under both Win32 and POSIX path semantics, so the real DSH 0.2 migrator can
exercise the artifact on Windows and Linux CI.

SHA-256: `a2b36e94e8b603deba56eea89982db5a7cbd043140caf1a54457bd0e5160e128`

The only `encrypted_content` values are the fixed string
`FAKE-OPAQUE-PLACEHOLDER-NOT-REAL-STATE`; no provider state is present.
`tests/wp5-session-v4.test.mjs` copies the artifact into a temporary directory,
asserts the source bytes stay unchanged, and migrates that copy using the
installed DSH 0.2 session persistence service.
