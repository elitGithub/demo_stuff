<div class="page-heading"><a class="text-link" href="/cart">← Back to your bag</a>
    <h1>Make it yours<span class="accent-dot">.</span></h1>
    <p>A few details, then we’ll get cooking.</p></div>
<div class="two-column">
    <section class="panel">
        <div class="step-heading"><span>01</span>
            <h2>How would you like it?</h2></div>
        <div class="fulfillment-options"><a href="/checkout?fulfillment=pickup"
                                            class="fulfillment-option <?= $type === 'pickup' ? 'chosen' : '' ?>" <?= $type === 'pickup' ? 'aria-current="true"' : '' ?>><span>⌂</span><strong>Pick
                    it up</strong><small>Collect from the restaurant ·
                    Free</small><i><?= $type === 'pickup' ? '●' : '○' ?></i></a><a href="/checkout?fulfillment=delivery"
                                                                                   class="fulfillment-option <?= $type === 'delivery' ? 'chosen' : '' ?>" <?= $type === 'delivery' ? 'aria-current="true"' : '' ?>><span>↗</span><strong>Bring
                    it to me</strong><small>Delivered to your door · <?= money($config['delivery_fee_cents']) ?></small><i><?= $type === 'delivery' ? '●' : '○' ?></i></a>
        </div>
        <form method="post" action="/checkout" class="stack-form submit-once"><?= csrfField() ?><input type="hidden"
                                                                                                       name="checkout_key"
                                                                                                       value="<?= e(
                                                                                                               $checkoutKey
                                                                                                       ) ?>"><input
                    type="hidden" name="fulfillment" value="<?= e($type) ?>">
            <div class="step-heading"><span>02</span>
                <h2>Your details</h2></div>
            <div class="form-grid"><label>Name on the order<input name="customer_name" autocomplete="name" minlength="2"
                                                                  maxlength="100" required value="<?= e(
                            is_string($old['customer_name'] ?? null) ? $old['customer_name'] : $user['name']
                    ) ?>"></label><label>Phone number<input name="phone" type="tel" autocomplete="tel" minlength="7"
                                                            maxlength="30" required placeholder="+1 202 555 0123"
                                                            value="<?= e(
                                                                    is_string(
                                                                            $old['phone'] ?? null
                                                                    ) ? $old['phone'] : ''
                                                            ) ?>"></label></div><?php
            if ($type === 'delivery'): ?><label>Delivery address<textarea name="address" autocomplete="street-address"
                                                                          minlength="10" maxlength="500" rows="3"
                                                                          required
                                                                          placeholder="Street, building, apartment, city and postal code"><?= e(
                            is_string($old['address'] ?? null) ? $old['address'] : ''
                    ) ?></textarea></label><?php
            else: ?><input type="hidden" name="address" value="">
                <div class="info-box"><strong>Pickup at the restaurant</strong>
                    <p>Your order history will show when it’s ready to collect.</p></div><?php
            endif; ?><label>Anything we should know? <span class="optional">optional</span><textarea name="notes"
                                                                                                     maxlength="500"
                                                                                                     rows="2"
                                                                                                     placeholder="Delivery instructions or a note for the kitchen"><?= e(
                            is_string($old['notes'] ?? null) ? $old['notes'] : ''
                    ) ?></textarea></label>
            <div class="step-heading"><span>03</span>
                <h2>Payment</h2></div>
            <div class="info-box"><strong>Pay on <?= $type === 'pickup' ? 'pickup' : 'delivery' ?></strong>
                <p>No online charge. Pay <?= money($quote['total_cents']) ?> when you receive your food.</p></div>
            <button class="button full-width" type="submit">Place order · <?= money($quote['total_cents']) ?>
                <span>→</span></button>
        </form>
    </section>
    <aside class="panel summary-panel">
        <div class="eyebrow">A VERY GOOD CHOICE</div>
        <h2>Your order</h2><?php
        foreach ($quote['items'] as $item): ?>
            <div class="checkout-item"><span><b><?= $item['quantity'] ?>×</b> <?= e(
                        $item['name']
                ) ?></span><strong><?= money($item['line_total_cents']) ?></strong></div><?php
        endforeach; ?>
        <dl class="summary-lines">
            <div>
                <dt>Subtotal</dt>
                <dd><?= money($quote['subtotal_cents']) ?></dd>
            </div>
            <div>
                <dt><?= $type === 'delivery' ? 'Delivery' : 'Pickup' ?></dt>
                <dd><?= $quote['delivery_fee_cents'] ? money($quote['delivery_fee_cents']) : 'Free' ?></dd>
            </div>
            <div class="summary-total">
                <dt>Total</dt>
                <dd><?= money($quote['total_cents']) ?></dd>
            </div>
        </dl>
        <p class="summary-footnote">Prepared after you place your order.<br>Follow its progress in My orders.</p>
    </aside>
</div>
