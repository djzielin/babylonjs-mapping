# Traffic proxy

Live aircraft come from [adsb.lol](https://api.adsb.lol)'s open ADS-B API, which does not answer cross-origin requests. The dev servers proxy it at `/adsb`, but a static site such as GitHub Pages cannot do that. This Cloudflare Worker can take the dev server's place for the hosted demos. It forwards `/v2/point/{latitude}/{longitude}/{radius}`, adds CORS headers for the allowed origins (`ALLOWED_ORIGINS` in `wrangler.toml`; localhost is always allowed), and caches each answer for 4 s.

Roads (Mapbox traffic tiles) and ships (Finland's Digitraffic AIS, which covers the Baltic) are already served with CORS, so they need no proxy.

## Deploy

```sh
cd examples-npm/traffic-proxy
npx wrangler login
npx wrangler deploy
```

Wrangler prints the worker's URL. Set it as the repository variable `DEMO_AIRCRAFT_URL`:

```sh
gh variable set DEMO_AIRCRAFT_URL --body https://babylonjs-mapping-traffic.<account>.workers.dev
```

The next Pages deploy builds it into the demos. Without the variable, the hosted demos leave aircraft out.

To try it locally, run `npx wrangler dev`, then request `http://localhost:8787/v2/point/40.75/-73.98/40`.
