# Contributing to touchHLE-web

This independent fork accepts reviewed AI-assisted work. This policy does not
apply to upstream touchHLE; do not send AI-generated changes there.

Keep changes small, preserve native compatibility, and include reproduction
steps and actual test results. Prefer public API documentation and appropriately
licensed dependencies. Do not include proprietary game assets, leaked source,
credentials, or code you lack permission to distribute.

Preserve existing copyright and license notices. Source files remain under
MPL-2.0 unless their existing notices specify otherwise. See LICENSE and the
individual dependency licenses. Run cargo fmt --check, git diff --check, and
tests relevant to the changed components. Browser support is tracked in
[the implementation plan](dev-docs/browser.md).
