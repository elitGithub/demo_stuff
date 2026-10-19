<?php

use Elsewhere\Icon;
use Elsewhere\SitePage;

/** @var \Elsewhere\Page $page */
?>
<a class="skip-link" href="#main">Skip to content</a><header class="site-header"><div class="header-inner"><a class="brand" href="index.php" aria-label="Elsewhere home"><?= Icon::Compass->svg() ?><span>elsewhere<span class="brand-dot">.</span></span></a><nav class="desktop-nav" aria-label="Main navigation"><?php foreach (SitePage::navigation() as $link): ?>
<a href="<?= htmlspecialchars($link->value) ?>"<?php if ($link === $page->file): ?> aria-current="page"<?php endif ?>><?= htmlspecialchars($link->label()) ?></a><?php endforeach ?>
</nav><a class="button button-small header-cta" href="contact.php">Plan your journey <span aria-hidden="true">↗</span></a><button class="menu-toggle" aria-label="Open navigation" aria-expanded="false" aria-controls="mobile-nav"><?= Icon::Menu->svg() ?></button></div><nav id="mobile-nav" class="mobile-nav" aria-label="Mobile navigation" hidden><?php foreach (SitePage::navigation() as $link): ?>
<a href="<?= htmlspecialchars($link->value) ?>"<?php if ($link === $page->file): ?> aria-current="page"<?php endif ?>><?= htmlspecialchars($link->label()) ?> <span aria-hidden="true">↗</span></a><?php endforeach ?>
</nav></header>