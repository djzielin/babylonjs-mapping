# Demo deployment setup

The [`deploy-demos.yml`](workflows/deploy-demos.yml) workflow builds the four
deployable projects in `examples-npm/` on every push to `main`. It also runs on
pull requests so the demo builds are checked before merging, and it can be run
manually with `workflow_dispatch`.

Each demo is uploaded as a separate seven-day GitHub Actions artifact:

- `demo-OpenStreetMap-Endless`
- `demo-OpenStreetMap-HelloWorld`
- `demo-OpenStreetMap-UserData-RealScale`
- `demo-mapbox-terrain`

The final deployment job is intentionally disabled until the hosting provider
is selected. When the host and authentication are available:

1. Create the `demos` GitHub Environment.
2. Add the repository variable `DEMO_DEPLOY_ENABLED=true`.
3. Add the host as `DEMO_DEPLOY_HOST` and the credential as the environment
   secret `DEMO_DEPLOY_TOKEN`.
4. Replace the provider hook in the workflow with the host-specific deploy
   command. It receives the demo name in `DEMO_NAME` and the built files in
   `DEMO_DIST`.

No host or credential is committed to the repository.
