# Acceleration progress

Updated: 2026-10-26. Thread goal: active.

- [x] Inspect current CPU adapter and historical clean game acceptance.
- [x] Create PRD, SAD and SFDS with measurable acceptance and regression gates.
- [ ] M0: validate and commit the existing uncommitted browser baseline.
- [ ] M1: reproducible CPU baseline, current startup profile, architecture choice.
- [ ] M2: compiled blocks, interpreter fallback and differential tests.
- [ ] M3: full runtime integration and hot-path coverage.
- [ ] M4: real-time Training 01/Lesson 2 and startup target measurements.
- [ ] M5: regression/browser/device results, final documentation and source push.

## Evidence and decisions

2026-10-26: Historical clean interpreter run reached Lesson 2 SUCCESS. First
Play was at 3,394 s including manual navigation; no precise FPS or isolated
startup median exists. Working tree contains prior CPU/graphics/audio/input
integration, retained intact. Proposed first experiment reuses Unicorn TCI
semantics and compiles intermediate blocks; no implementation speedup claimed.

Next: inventory available SDK/test inputs, run baseline checks, inspect TCI block
format/helper interfaces and measure a representative translation prototype.
