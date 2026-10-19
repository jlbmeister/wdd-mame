# MAME for the browser (WebAssembly), as used by W.D.D

Builds of [MAME](https://www.mamedev.org/) compiled to WebAssembly (with SIMD, threads and WebGL2), for the
MAME widget of W.D.D (World Domination Dashboard). A W.D.D server downloads a release from here when an
administrator presses **Install MAME**, checks it against its manifest, and serves it to its browsers.

Each release has one zip: `mame.js`, `mame.wasm`, `manifest.json` (the systems, their parents, BIOS and device
ROM sets, and every file's SHA-256), MAME's licence, the exact source it was built from (`SOURCE.md`) and
the build recipe (`recipe/`).

## Licence and source

MAME is free software under the GNU General Public License, version 2 ([LICENSE.txt](LICENSE.txt)),
copyright the MAME team and contributors. These builds are MAME's own source at the tag and commit named in
[SOURCE.md](SOURCE.md), with the small patch in [recipe/patches/](recipe/patches/), built by
[recipe/build.sh](recipe/build.sh) in the Docker image from [recipe/Dockerfile](recipe/Dockerfile). To
rebuild one: `recipe/build.sh` (needs Docker).

**No ROMs or other copyrighted game data are here.** You provide your own, for games you have the right to use.
