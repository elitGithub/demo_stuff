<?php

namespace Tests\Support;

use FilesystemIterator;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use RuntimeException;

final class TemporaryRuntime
{
    private readonly string $root;

    /**
     * @param  string  $root
     * @return void
     */
    private function __construct(string $root)
    {
        $this->root = $root;
    }

    /**
     * @return self
     *
     * @throws RuntimeException
     */
    public static function create(): self
    {
        $base = dirname(__DIR__, 2).'/storage/framework/testing';

        if (realpath($base) !== $base || ! is_dir($base)) {
            throw new RuntimeException('The test runtime parent must be a real local directory.');
        }

        $root = $base.'/'.bin2hex(random_bytes(16));

        if (! mkdir($root, 0700)) {
            throw new RuntimeException('Cannot create the isolated test runtime.');
        }

        return new self(root: $root);
    }

    /**
     * @param  string  $relative
     * @return string
     *
     * @throws RuntimeException
     */
    public function path(string $relative): string
    {
        if ($relative === '' || preg_match('/\A[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*\z/', $relative) !== 1) {
            throw new RuntimeException('A test path must be relative to its generated runtime.');
        }

        if (realpath($this->root) !== $this->root) {
            throw new RuntimeException('The generated runtime root has changed.');
        }

        $path = $this->root;

        foreach (explode('/', $relative) as $segment) {
            if ($segment === '.' || $segment === '..') {
                throw new RuntimeException('Test path traversal is forbidden.');
            }

            $path .= '/'.$segment;

            if (is_link($path) || (file_exists($path) && realpath($path) !== $path)) {
                throw new RuntimeException('Test paths must not contain symbolic links.');
            }
        }

        return $path;
    }

    /**
     * @param  string  $path
     * @return void
     *
     * @throws RuntimeException
     */
    public function assertOwnedPath(string $path): void
    {
        $prefix = $this->root.'/';

        if (! str_starts_with($path, $prefix) || $this->path(substr($path, strlen($prefix))) !== $path) {
            throw new RuntimeException('Test paths must remain beneath the generated runtime.');
        }
    }

    /**
     * @return void
     *
     * @throws RuntimeException
     */
    public function destroy(): void
    {
        if (! file_exists($this->root) && ! is_link($this->root)) {
            return;
        }

        if (realpath($this->root) !== $this->root || is_link($this->root)) {
            throw new RuntimeException('Refusing to clean a replaced test runtime.');
        }

        $entries = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($this->root, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::CHILD_FIRST,
        );

        foreach ($entries as $entry) {
            $removed = $entry->isDir() && ! $entry->isLink()
                ? rmdir($entry->getPathname())
                : unlink($entry->getPathname());

            if (! $removed) {
                throw new RuntimeException('Cannot remove a generated test fixture.');
            }
        }

        if (! rmdir($this->root)) {
            throw new RuntimeException('Cannot remove the generated test runtime.');
        }
    }
}
