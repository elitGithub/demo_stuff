<?php

/** @var \Elsewhere\SiteCatalog $catalog */
?>
<section class="page-intro container"><p class="eyebrow">POSTCARDS, PERSPECTIVES &amp; POSSIBILITIES</p><h1>The Elsewhere<br><em>journal.</em></h1><p>Stories to spark your curiosity. Ideas to take with you.<br>A little daydreaming, encouraged.</p></section><section class="container section-bottom journal-layout"><?php $article = $catalog->articles[0] ?>
<?php $featured = true ?>
<?php require dirname(__DIR__).'/article-card.php' ?>
<div class="journal-subheading"><p class="eyebrow">A LITTLE MORE TO EXPLORE</p><span>Notes for the curious traveller</span></div><div class="article-grid two-columns"><?php $featured = false ?>
<?php foreach (array_slice($catalog->articles, 1) as $article): ?>
<?php require dirname(__DIR__).'/article-card.php' ?>
<?php endforeach ?>
</div></section><section class="soft-section"><div class="container compact-split"><h2>Found a spark?<br><em>Follow it somewhere.</em></h2><div><p>The best travel stories often start with one small idea. Explore our journeys and see where yours might lead.</p><a class="text-link" href="journeys.php">Explore the possibilities <span aria-hidden="true">↗</span></a></div></div></section><?php require dirname(__DIR__).'/cta.php' ?>
