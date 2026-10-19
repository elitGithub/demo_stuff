<?php

use Elsewhere\Icon;

/** @var \Elsewhere\SiteCatalog $catalog */
?>
<section class="page-intro container"><p class="eyebrow">YOUR NEXT SOMEWHERE</p><h1>So many places.<br><em>So many possibilities.</em></h1><p>From a quiet corner of the Mediterranean to the wild heart of Africa.<br>Let your curiosity point the way.</p></section><section class="container section-bottom" data-filter-group="destinations"><div class="filter-bar"><div class="filter-chips" aria-label="Filter destinations by region"><button class="filter-chip active" data-region-filter="" aria-pressed="true">All destinations</button><?php foreach ($catalog->regions() as $region): ?>
<button class="filter-chip " data-region-filter="<?= htmlspecialchars($region) ?>" aria-pressed="false"><?= htmlspecialchars($region) ?></button><?php endforeach ?>
</div><label class="search-field"><?= Icon::Search->svg() ?><input id="destination-search" type="search" placeholder="Find your somewhere" aria-label="Search destinations"></label></div><p class="results-count" aria-live="polite"><?= htmlspecialchars((string) count($catalog->destinations)) ?> places to begin</p><div class="destination-grid all-destinations"><?php foreach ($catalog->destinations as $destination): ?>
<?php require dirname(__DIR__).'/destination-card.php' ?>
<?php endforeach ?>
</div><div class="empty-state" hidden><h3>A little further off the map.</h3><p>No destinations match that search. Try another place or clear your filters.</p><button class="button" data-reset-filters>Explore all destinations <span aria-hidden="true">↗</span></button></div></section><section class="soft-section"><div class="container compact-split"><h2>Have somewhere<br>else <em>in mind?</em></h2><div><p>Sometimes the most exciting journey begins with an idea we haven’t thought of yet. Tell us what you’re dreaming about.</p><a class="text-link" href="contact.php">Let’s talk about it <span aria-hidden="true">↗</span></a></div></div></section><?php require dirname(__DIR__).'/cta.php' ?>
