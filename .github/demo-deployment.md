# Demo deployment

The [demo workflow](workflows/deploy-demos.yml) builds all five applications in
`examples-npm/` for pushes to `main`, pull requests, and manual runs:

- OpenStreetMap-Endless
- OpenStreetMap-HelloWorld
- OpenStreetMap-UserData-RealScale
- mapbox-terrain
- gebco-bathymetry

Each application installs a tarball built from the current checkout. The workflow
combines their output with `.github/pages/index.html` into one GitHub Pages
artifact. Successful pushes and manual runs on `main` deploy that artifact through
the `github-pages` environment. Pull requests build without deploying.

Configure the repository's Pages source as **GitHub Actions**. The deployment job
uses `pages: write` and `id-token: write`; no separate deployment token is needed.

Optional repository secrets `OSMB_ACCESS_TOKEN` and `MAPBOX_ACCESS_TOKEN` provide
keys to the browser demos. These values become public files in the deployed site,
so use public client tokens with appropriate provider restrictions. Missing keys
leave the corresponding authenticated demo features unavailable. Never use a
server secret in these fields.
