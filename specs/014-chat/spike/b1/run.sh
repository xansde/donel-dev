#!/bin/bash
# usage: ./run.sh scenarios/<name>.js
cd "$(dirname "$0")"
ELECTRON_RUN_AS_NODE=1 /c/Users/xansd/seazone/donel-dev/node_modules/electron/dist/electron.exe driver.js "$1"
