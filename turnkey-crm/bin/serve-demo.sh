#!/usr/bin/env bash
set -eu

cd "$(dirname "$0")/../public"
exec php -S 127.0.0.1:8081 ../vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php
