<?php

use Illuminate\Filesystem\Filesystem;
use Illuminate\View\Compilers\BladeCompiler;

require $argv[1].'/vendor/autoload.php';

$fixtureDirectory = $argv[2];
$extension = $argv[3];
$filesystem = new Filesystem;
$source = $fixtureDirectory.'/release.blade.php';
$oldCompiler = new BladeCompiler($filesystem, $fixtureDirectory);
$oldPath = $oldCompiler->getCompiledPath($source);
file_put_contents($source, '@if (true)New {{ "<release>" }}@endif');
file_put_contents($oldPath, 'Old compiled view');
touch($oldPath, time() + 86400);
$newCompiler = new BladeCompiler($filesystem, $fixtureDirectory, '', true, $extension);
$newPath = $newCompiler->getCompiledPath($source);
if ($oldPath === $newPath || $oldCompiler->isExpired($source) || ! $newCompiler->isExpired($source)) {
    throw new RuntimeException('Release must bypass the future-dated old compiled view.');
}
$newCompiler->compile($source);
ob_start();
include $newPath;
$rendered = ob_get_clean();
if ($rendered !== 'New &lt;release&gt;' || file_get_contents($oldPath) !== 'Old compiled view') {
    throw new RuntimeException('Fresh Blade output and old-cache preservation are required.');
}
echo "Future-dated old cache preserved; new release Blade output compiled and rendered.\n";
