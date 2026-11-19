# Experimental island builds

The default branch contains the playable expansion, the COSIER GT3 RS and Mac-rendered LAN play. These earlier experimental snapshots preserve alternate versions of the disaster, crowd and rendering work. Each can be checked out and built independently with `npm ci` and `npm run build`.

| Branch | Scope |
|---|---|
| [breakup](https://github.com/matthewcosier/tidewater/tree/experiments/breakup) | Water loading, pile failures and structural breakup |
| [breakup-preview](https://github.com/matthewcosier/tidewater/tree/experiments/breakup-preview) | Integrated preview of breakup and debris |
| [crowd](https://github.com/matthewcosier/tidewater/tree/experiments/crowd) | Townsfolk, ferry passengers and evacuation |
| [crowd-integration](https://github.com/matthewcosier/tidewater/tree/experiments/crowd-integration) | Crowd and evacuation integration |
| [crowd-integration-latest](https://github.com/matthewcosier/tidewater/tree/experiments/crowd-integration-latest) | Later integrated crowd, ferry and evacuation changes |
| [crowd-performance](https://github.com/matthewcosier/tidewater/tree/experiments/crowd-performance) | Performance of large crowds |
| [crowd-performance-integration](https://github.com/matthewcosier/tidewater/tree/experiments/crowd-performance-integration) | Integrated crowd performance changes |
| [disaster-sound](https://github.com/matthewcosier/tidewater/tree/experiments/disaster-sound) | Disaster sound, sirens and camera response |
| [flood-debris](https://github.com/matthewcosier/tidewater/tree/experiments/flood-debris) | Flood-driven rigid debris |
| [flood-spray](https://github.com/matthewcosier/tidewater/tree/experiments/flood-spray) | Foam, spray and flood-front rendering |
| [integration](https://github.com/matthewcosier/tidewater/tree/experiments/integration) | Combined island simulation and disaster sound |
| [island-preview](https://github.com/matthewcosier/tidewater/tree/experiments/island-preview) | Integrated flood visuals and performance preview |
| [render-performance](https://github.com/matthewcosier/tidewater/tree/experiments/render-performance) | Renderer and simulation performance |
| [sound-integration-a](https://github.com/matthewcosier/tidewater/tree/experiments/sound-integration-a) | Disaster sound integration, first candidate |
| [sound-integration-b](https://github.com/matthewcosier/tidewater/tree/experiments/sound-integration-b) | Disaster sound integration, second candidate |
| [storm-sky](https://github.com/matthewcosier/tidewater/tree/experiments/storm-sky) | Storm clouds and sky lighting |
| [tornado](https://github.com/matthewcosier/tidewater/tree/experiments/tornado) | Tornado lifecycle, dust and debris |
| [tsunami](https://github.com/matthewcosier/tidewater/tree/experiments/tsunami) | Tsunami propagation and coastal inundation |
| [tsunami-visuals](https://github.com/matthewcosier/tidewater/tree/experiments/tsunami-visuals) | Tsunami water, sediment and the advancing front |

The pier on `experiments/breakup` loses 51 of its 208 pile-cap connections in the 2 m surge test. That test expects all connections to hold.
