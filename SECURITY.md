# Security policy

dependabot-gaps reads repository files (`dependabot.yml` and manifest names; for a few ecosystems the manifest text, to see whether it declares any dependency or workspace). It makes no network requests and sends nothing anywhere.
`--fix` is the only command that writes, and it only appends entries to `.github/dependabot.yml` (or creates it).

Report vulnerabilities privately through GitHub: Security > Report a vulnerability on this repository.
Please do not open public issues for undisclosed vulnerabilities.
