<?php

spl_autoload_register(function (string $class): void {
    if (preg_match('/^Elsewhere\\\\([A-Za-z][A-Za-z0-9]*)$/D', $class, $matches) === 1) {
        $path = __DIR__.'/classes/'.$matches[1].'.php';
        if (is_file($path)) {
            require $path;
        }
    }
});
