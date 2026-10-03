# Contributing

```bash
npm ci
npm test          # builds, typechecks, runs node:test (no network needed)
npm run bundle    # regenerate action/index.mjs; commit it with your change (CI checks it is up to date)
```

* Tests use in-memory repositories (`test/helpers.ts`): add the files you need and assert on the findings.
* New findings need a rule id in `src/types.ts`, a row in the README rules table and a test.
* A false positive/negative report is most useful with the `dependabot.yml` entry and the tree listing (`git ls-tree -r --name-only HEAD`) that triggered it.
* Dependabot semantics come from the documented options reference and `dependabot-core` (`file_fetcher_command.rb` for `directories` globbing, the per-ecosystem file fetchers for workspaces). Link the source when you change a rule.
* Keep the action free of other actions (`test/action-metadata.test.ts` enforces it).
* Releasing: bump the version and the README pins in a PR, merge when green, then run **Actions > Release gate** with the new tag (for example `v1.2.3`) *before* you create the tag. The same check runs again on the tag, and a weekly job (`claims-latest.yml`) fails when the README pins an older release than the newest tag.
