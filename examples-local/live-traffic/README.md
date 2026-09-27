# New York traffic

This focused Babylon.js Mapping demo displays three transport feeds around New York City:

| Layer | Provider | Meaning |
| --- | --- | --- |
| Roads | [NYC DOT Traffic Speeds](https://data.cityofnewyork.us/Transportation/DOT-Traffic-Speeds/i4gi-tjb9) | Measured speed on road links; there are no individual car positions. Gray means a reading is unavailable. |
| Aircraft | [OpenSky state vectors](https://openskynetwork.github.io/opensky-api/rest.html) | Recently reported aircraft positions, altitude, and heading. |
| Ships | [AISStream](https://aisstream.io/documentation) | Recent AIS vessel position reports. |

The **Sample scene** is available without credentials and is illustrative. Select **Live sources** to request current provider data. Provider coverage and refresh frequency vary. The backend keeps credentials out of the browser. It refreshes road and aircraft data at most once every five minutes with anonymous OpenSky access, or once per minute with OpenSky credentials, and expires ship reports after ten minutes. The longer anonymous interval stays within OpenSky's published daily credit allowance for one running server.

## Run

From the repository root, build the library first:

```sh
npm ci
npm run build
cd examples-local/live-traffic
npm ci
npm run build
npm start
```

Open <http://localhost:4173>. The NYC DOT and anonymous OpenSky requests need no key. To enable more OpenSky credits, set both `OPENSKY_CLIENT_ID` and `OPENSKY_CLIENT_SECRET` before starting the server. To receive ship reports, set `AISSTREAM_API_KEY`. OpenSky uses OAuth2 client credentials. AISStream requires a server side WebSocket connection and a geographic subscription; its key must stay on the server. Example:

```sh
AISSTREAM_API_KEY=your_key OPENSKY_CLIENT_ID=your_id OPENSKY_CLIENT_SECRET=your_secret npm start
```

The server also exposes `GET /api/traffic`, returning normalized `roads`, `aircraft`, `ships`, source names, and any provider errors. The globe mode demo can use this endpoint.
