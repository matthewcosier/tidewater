# GT3RS ZRY

The GT3RS ZRY is millZach's own Blender model of a 992 GT3 RS, in a white gloss clearcoat with the red GT3 RS side graphic, red wheels and red callipers. It carries no number plates. The glass is clear, so the modelled cabin shows through it. Its key is `gt3rszry`, and it shares the COSIER GT3 RS's 2.457 m wheelbase and 1.630/1.582 m tracks.

Choose **GT3RS ZRY** and **Coastal road** in the vehicle picker. The controls are the same as the [COSIER GT3 RS](gt3-rs.md): W accelerates, S brakes or reverses, A/D steer, Space applies the rear handbrake and E enters or leaves. R recovers the car and T repairs it.

## Physics

The car drives on the COSIER GT3 RS's physics kind 6 without changes: the same seven-speed gearbox, 1,450 kg mass, 9,000 rpm redline, aero and wing damage. It has its own GT3 RS engine recording. Its row in `src/rally/Vehicles.js` repeats the COSIER figures, and `test/vehicle-parity.mjs` holds both rows to `vehicle.rs`. The wheel hubs sit on kind 6's contact patches at the model's own loaded radius. The callipers stay on the steering carriers while the discs and tyres roll.

## Assets and verification

The game mesh has 229,859 triangles in 165 material and motion batches. It uses the COSIER node layout (`BodyStatic` with `GlassPanels`, `InteriorAssembly` and `RearWing`, and `Camber` and `Roll` under each wheel), so the damage rig, lamps and glass work the same way. The side graphic is one texture on `BodyPaintVinyl`. The perforated grille and vent sheets are left out, and the drilled brake discs are drawn solid.

The model is stored losslessly as `assets/distribution/rally/gt3rs_zry.glb.br`. `npm ci`, `npm run dev` and `npm run build` unpack it to `public/rally/gt3rs_zry.glb`, which Git ignores. `npm run assets:prepare` unpacks it directly, and `node tools/distribution-assets.mjs pack zry` packs it again.

To rebuild, run `node tools/rally/import_gt3rs_zry.mjs PATH_TO_BLEND PATH_TO_SIDE_GRAPHIC` with Blender 5.2 on the path (or in `BLENDER`) and `npm install --no-save meshoptimizer@1.3.0`. Blender runs headless on `tools/rally/gt3rs_zry_export.py`, which only reads the blend. The import step writes the GLB and packs it. Normal play uses the included distribution asset.

`test/gt3rs-zry.mjs` checks the picker row against the COSIER car, the hubs over kind 6's contact patches, 0–100 km/h, round rolling tyres and discs with fixed callipers, the node layout, the missing plates, the side-graphic texture, the triangle budget and the damage rig's lamps, glass, paint and wing.
