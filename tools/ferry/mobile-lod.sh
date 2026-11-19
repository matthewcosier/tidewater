#!/bin/sh
# Rebuild the phone render meshes from the full ferry assets. Colliders and joint pivots stay in metres.
set -eu
cd "$(dirname "$0")/../.."
mkdir -p public/ferry/mobile
for asset in terminal ferry parked_cars; do
	npm exec --yes --package=gltfpack@1.3.0 -- gltfpack \
		-i "public/ferry/$asset.glb" -o "public/ferry/mobile/$asset.glb" \
		-si 0.10 -sa -kn -km -noq -ke
done
