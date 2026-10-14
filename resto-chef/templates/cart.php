<div class="page-heading">
    <div class="eyebrow">ONE STEP CLOSER TO SOMETHING GOOD</div>
    <h1>Your bag<span class="accent-dot">.</span></h1>
    <p>A little of what you love.</p></div>
<?php
if (!$lines): ?>
    <div class="empty-state"><span>＋</span>
        <h2>Something delicious belongs here.</h2>
        <p>Explore the menu and add your favorites to get started.</p><a class="button" href="/menu">Explore the menu
            ↗</a></div><?php
else: ?>
    <?php
    $subtotal = 0;
    $unavailable = false;
    foreach ($lines as $line) {
        $subtotal += $line['line_total_cents'];
        if (!$line['available']) {
            $unavailable = true;
        }
    } ?>
    <div class="two-column">
        <section class="panel cart-panel">
            <div class="panel-heading"><h2>Your picks</h2><span><?= cartCount() ?> items</span></div><?php
            foreach ($lines as $line): ?>
                <article class="cart-line"><img src="/assets/<?= e($line['image']) ?>" alt="">
                <div class="cart-line-main"><h3><?= e($line['name']) ?></h3>
                    <p><?= money((int)$line['price_cents']) ?> each<?php
                        if (!$line['available']): ?> · <span class="error-text">Unavailable — please remove</span><?php
                        endif; ?></p>
                    <div class="quantity-controls">
                        <form method="post" action="/cart/update"><?= csrfField() ?><input type="hidden" name="food_id"
                                                                                           value="<?= (int)$line['id'] ?>"><label
                                    class="sr-only" for="qty-<?= (int)$line['id'] ?>">Quantity for <?= e(
                                        $line['name']
                                ) ?></label><input id="qty-<?= (int)$line['id'] ?>" type="number" min="1" max="20"
                                                   name="quantity" value="<?= (int)$line['quantity'] ?>" required>
                            <button class="text-button" type="submit">Update</button>
                        </form>
                        <form action="/cart/update" method="post"><?= csrfField() ?><input type="hidden" name="food_id"
                                                                                           value="<?= (int)$line['id'] ?>"><input
                                    type="hidden" name="quantity" value="0">
                            <button type="submit" class="text-button muted">Remove</button>
                        </form>
                    </div>
                </div>
                <strong><?= money($line['line_total_cents']) ?></strong></article><?php
            endforeach; ?><a class="text-link" href="/menu">← Add something else</a></section>
        <aside class="panel summary-panel">
            <div class="eyebrow">THE GOOD STUFF</div>
            <h2>Order summary</h2>
            <dl class="summary-lines">
                <div>
                    <dt>Subtotal</dt>
                    <dd><?= money($subtotal) ?></dd>
                </div>
                <div>
                    <dt>Pickup</dt>
                    <dd>Free</dd>
                </div>
                <div>
                    <dt>Delivery, if selected</dt>
                    <dd><?= money($config['delivery_fee_cents']) ?></dd>
                </div>
            </dl>
            <p class="muted small">Your final total is shown at checkout. Pay when you receive your order.</p><?php
            if ($unavailable): ?><p class="notice notice-error">Please remove unavailable items to continue.</p><?php
            else: ?><a class="button full-width" href="/checkout">Continue to checkout <span>→</span></a><?php
            endif; ?><p class="summary-footnote">Freshly prepared, just for you.</p></aside>
    </div>
<?php
endif; ?>
