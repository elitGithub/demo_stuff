<?php

/** @var \Elsewhere\Article $article */
/** @var bool $featured */
?>
<article class="article-card <?php if ($featured): ?>article-featured<?php endif ?>"><button class="article-image" data-dialog="article-<?= htmlspecialchars($article->id) ?>" aria-label="Read <?= htmlspecialchars($article->title) ?>"><img src="assets/images/<?= htmlspecialchars($article->image) ?>.jpg" alt="<?= htmlspecialchars($article->imageAlt) ?>" width="900" height="600" loading="lazy"></button><div class="article-body"><p class="eyebrow"><?= htmlspecialchars($article->category) ?> <span>· <?= htmlspecialchars($article->time) ?></span></p><h3><button data-dialog="article-<?= htmlspecialchars($article->id) ?>"><?= htmlspecialchars($article->title) ?></button></h3><p><?= htmlspecialchars($article->excerpt) ?></p><button class="text-link" data-dialog="article-<?= htmlspecialchars($article->id) ?>">Read the story <span aria-hidden="true">↗</span></button></div></article>