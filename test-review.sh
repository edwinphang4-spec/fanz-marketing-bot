#!/bin/bash
set -e
cd "$(dirname "$0")"
node test-review.js
echo "All review tests passed!"