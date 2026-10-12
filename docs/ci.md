# CI and release procedures

## Workflow ownership

| Workflow | Responsibility | Trigger |
| --- | --- | --- |
| `workflows.yml` | Validate GitHub Actions with actionlint | Pull requests and main pushes affecting `.github/`; manual |
| `lint.yml` | Independent formatting and lint checks | Pull requests, main pushes, manual, reusable release validation |
| `typecheck.yml` | Workspace type checks | Pull requests, main pushes, manual, reusable release validation |
| `test.yml` | Parallel app, UI, and provider coverage tests | Pull requests, main pushes, manual, reusable release validation |
| `e2e.yml` | Source regression and internal packaged smoke on Windows and macOS | Pull requests, main pushes, manual |
| `provider-checks.yml` | Tests against configured paid provider endpoints | Manual only |
| `release.yml` | Validate a version tag, build signed installers, verify applications, and publish assets | Version-tag pushes; manual for an existing tag |

The workflows live in [`.github/workflows`](../.github/workflows).
Dependency installation uses the shared `setup-workspace` action. Executable
development commands remain defined in [`package.json`](../package.json).

## Change selection and required checks

The shared `select-scope` action examines changed paths. Documentation-only
changes skip expensive steps while allowing required jobs to finish successfully.
Unit-test and lint configuration changes run source checks without packaging.
E2E scenarios, application sources, build inputs, and workflow changes also run
packaged smoke. Manual runs and unavailable change ranges run all checks.
Release validation always checks the resolved tag commit in full.

Replace the former combined `Static checks` requirement in branch protection with
`Formatting`, `Lint`, and `Typecheck`. Require `Tests` for the aggregate result of
all three coverage projects. If E2E or packaging jobs were required previously,
update those requirements to the job names displayed by the new E2E workflow.
Removing a workflow does not update repository rules automatically.

Coverage projects run independently and upload their own reports. Coverage
thresholds and source scopes belong to each project's Vitest configuration.
Pinned Action revisions are maintained through Dependabot.

## Internal application verification

The E2E workflow builds Windows x64 and macOS arm64 applications for smoke tests.
These internal builds are not releases. Windows builds are unsigned; macOS builds
use ad hoc signing without notarization and disable hardened runtime for this
verification path. See [E2E procedures](../tests/e2e/README.md) for test behavior,
artifacts, and local execution.

The manual Provider checks workflow uses the `e2e` environment. Configure
`MICO_E2E_API_KEY` as a secret and at least one complete endpoint/model variable
pair: `MICO_E2E_OPENAI_BASE_URL` with `MICO_E2E_OPENAI_MODEL`, or
`MICO_E2E_ANTHROPIC_BASE_URL` with `MICO_E2E_ANTHROPIC_MODEL`.
These checks can incur provider charges.

## Signed release prerequisites

Create the repository's `release` environment and configure its signing secrets:

| Secret | Purpose |
| --- | --- |
| `WIN_CSC_LINK` | Windows signing certificate supported by electron-builder |
| `WIN_CSC_KEY_PASSWORD` | Windows certificate password, if encrypted |
| `MAC_CSC_LINK` | macOS signing certificate supported by electron-builder |
| `MAC_CSC_KEY_PASSWORD` | macOS certificate password, if encrypted |
| `APPLE_ID` | Apple account used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization |
| `APPLE_TEAM_ID` | Apple developer team for notarization |

Signing secrets are exposed only to signing steps. Missing signing credentials
fail the release rather than producing unsigned release assets.
[`electron-builder.release.cjs`](../electron-builder.release.cjs) inherits the
application's base build configuration, requires signing, enables macOS hardened
runtime and notarization, and derives GitHub update metadata from the repository.

## Publishing a version

1. Update `package.json` to the intended version and commit the release inputs.
2. Create and push the matching tag, such as `v1.0.0` or `v1.0.0-beta.1`.
3. Alternatively, dispatch Release with an existing matching version tag.
4. Review workflow results and the published release assets.

Release resolves the existing tag to an immutable commit and requires the tag to
match that commit's package version. Formatting, lint, type checks, and coverage
must pass before signed Windows NSIS and macOS DMG/ZIP builds run. Each platform
also runs source regression and smoke tests against the signed application.

Only the final publishing job has repository write permission. It downloads the
current run's verified assets, checks that the tag still resolves to the validated
commit, creates a draft, uploads assets, and publishes it. A retry can resume a
draft targeting the same commit; it rejects an already published release.
Prereleases are marked accordingly and do not replace the latest stable release.
Runs for the same tag are serialized without cancellation.

Application smoke tests verify startup and exercised application behavior. They
do not establish installer behavior or downloaded-file Gatekeeper/SmartScreen
acceptance. Signed macOS builds, notarization, and GitHub publication require
verification in the configured release environment.
