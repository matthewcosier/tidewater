# Mac-rendered LAN play

The Mac opens Tidewater in a private Chromium instance. The phone receives the game tab, its menus and its audio, draws a 2D canvas and sends touch input. The Mac owns the island simulation and vehicles.

The transport targets 960 × 540 and up to 30 JPEG pictures per second. One LAN WebSocket carries pictures and stereo PCM. The Mac skips stale pictures on congested connections. The phone keeps one decode in flight and bounds scheduled audio. World distances, inputs and physics use the original game.

Use **Edit character** to choose your appearance. Select a car and starting location, then tap **Drive**, or choose **Walk instead** to arrive on foot at that location. Hold the direction controls, drag on the view to look, and tap the view to use game menus. Lifting a finger, hiding the page or disconnecting releases the controls. One phone controls each host. Rejoining preserves the island. The host pauses simulation and game audio when its controller disconnects.

Verify sustained pictures on a phone profile with WebGPU unavailable, audible game samples, simultaneous steering and throttle, release on disconnect and reconnection.

## Running the host

Install the project dependencies and the Chromium browser with `npm ci` and `npx playwright install chromium`. Build with `npm run build`, then run `npm start` to serve the game on loopback. In another terminal run the following, substituting the Mac's LAN address and certificate paths.

```sh
HOST=LAN_ADDRESS PORT=5193 HTTPS_CERT=path/to/site.pem HTTPS_KEY=path/to/site-key.pem npm run play:lan
```

Open the resulting HTTPS address on the phone. `GAME_URL` can point the renderer at a different local Tidewater server. The default is `http://127.0.0.1:5189/`. The Mac must stay awake. To stop a foreground host, press Control-C. Run `npm run test:lan-play` to exercise the stream and touch controls on isolated local hosts with Chromium and Playwright WebKit installed.
