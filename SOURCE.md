# MAME 0.289-wdd.2 for W.D.D

MAME is free software under the GNU General Public License, version 2 (LICENSE.txt); copyright the
MAME team and contributors. This is MAME built for web browsers, unmodified except for the patch in
recipe/patches/ (lets MAME use threads when built with Emscripten pthreads, exports Emscripten's FS).

- Source: https://github.com/mamedev/mame.git, tag mame0289, commit f34f02505e32c1993c6a782b6814232cbfc74e36
  (https://github.com/mamedev/mame/tree/f34f02505e32c1993c6a782b6814232cbfc74e36)
- Built with Emscripten 6.0.5 (1db513782be24469589d7cb8a1f1834e9a33f271) in the image from recipe/Dockerfile
- Recipe: recipe/build.sh, the driver selection recipe/drivers.txt

No ROMs or other copyrighted game data are part of this build.
