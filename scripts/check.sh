#!/usr/bin/env bash
# 运行固定验收件 check/check.mjs，原样透传参数（如 --only <组名> / -list）。
set -e
cd "$(dirname "$0")/.."
exec node check/check.mjs "$@"
