# W.D.D's MAME-for-the-browser builder: Emscripten (pinned) + MAME's own build needs.
# build.sh builds this image and runs itself inside it; see README.md.
# The emsdk release next to MAME 0.289 (July 2026); pinned by digest too, so a re-tag can't change it.
FROM emscripten/emsdk:6.0.5@sha256:76a44fff907397784decc435115d07fcb9587a4f1504977f39f3745e538e3a1e

# the image already has gcc/g++ (MAME's host tools: genie), make, python3, git and node
ENV IN_MAME_BUILDER=1 \
    PYTHON_EXECUTABLE=python3

WORKDIR /recipe
COPY Dockerfile build.sh drivers.txt manifest.mjs systems.mjs ./
COPY patches ./patches
ENTRYPOINT ["/recipe/build.sh"]
