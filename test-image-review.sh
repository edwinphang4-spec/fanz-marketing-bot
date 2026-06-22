#!/bin/bash
set -e
cd "$(dirname "$0")"
node test-image-review.js
echo "All image-review tests passed!"