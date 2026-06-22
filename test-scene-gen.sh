#!/bin/bash
set -e
cd "$(dirname "$0")"
node test-scene-gen.js
echo "All scene-gen tests passed!"
