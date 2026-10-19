# touchHLE-web development

Build a client-side iPhone OS emulator. The server serves static files only;
IPAs, execution, audio, graphics, and saves stay on the user's device.

- Keep Rust and existing compatibility fixes. No speculative rewrites.
- Prefer small, tested changes and minimal dependencies (YAGNI).
- Keep native builds working as a correctness reference.
- AI-assisted contributions are allowed in this independent fork. Review and
  test them; never submit them upstream contrary to upstream policy.
- Preserve MPL-2.0 notices, dependency licenses, and attribution.
- Never commit proprietary IPAs, extracted game assets, saves, or credentials.
- Do not describe an upload UI or CPU demo as a working game emulator.
- Record exact tests, limitations, and next steps in dev-docs/browser.md.
- Run formatting and relevant tests before committing; do not hide failures.
