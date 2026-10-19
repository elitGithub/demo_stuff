<?php

use Elsewhere\Asset;
use Elsewhere\SitePage;

/** @var \Elsewhere\Page $page */
?>
<!doctype html>
<html lang="en"><head><meta name="api-endpoint" content="api.php"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="<?= htmlspecialchars($page->description) ?>"><meta name="theme-color" content="#223c33"><meta name="robots" content="noindex, nofollow"><meta property="og:title" content="<?= htmlspecialchars($page->title) ?> | Elsewhere"><meta property="og:description" content="<?= htmlspecialchars($page->description) ?>"><meta property="og:type" content="website"><meta property="og:image" content="assets/images/hero-lake.jpg"><title><?= htmlspecialchars($page->title) ?> | Elsewhere</title><link rel="icon" href="assets/favicon.svg" type="image/svg+xml"><link rel="preload" href="assets/fonts/dm-serif.ttf" as="font" type="font/ttf" crossorigin><link rel="stylesheet" href="<?= htmlspecialchars(Asset::Styles->url()) ?>"><?php foreach ($page->scripts as $script): ?>
<script src="<?= htmlspecialchars($script->url()) ?>" defer></script><?php endforeach ?>
</head><body data-page="<?= htmlspecialchars($page->file->slug()) ?>"><?php require __DIR__.'/header.php' ?>
<main id="main"><?php require __DIR__.'/pages/'.$page->file->slug().'.php' ?>
</main><?php require __DIR__.'/footer.php' ?>
<?php if ($page->file !== SitePage::Admin): ?>
<?php require __DIR__.'/dialogs.php' ?>
<?php endif ?>
</body></html>