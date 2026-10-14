<div class="page-heading heading-row">
    <div>
        <div class="eyebrow">YOUR KITCHEN. YOUR CREATIONS.</div>
        <h1>Your menu<span class="accent-dot">.</span></h1>
        <p>Keep your dishes, prices and availability up to date.</p></div>
    <a href="/admin/menu/edit" class="button">Add a dish ＋</a></div>
<section class="panel table-panel">
    <div class="panel-heading"><h2>All dishes <span class="count-label"><?= count($foods) ?></span></h2><span
                class="muted small">Price changes apply to new orders.</span></div>
    <div class="table-scroll">
        <table>
            <thead>
            <tr>
                <th>Dish</th>
                <th>Category</th>
                <th>Price</th>
                <th>Availability</th>
                <th><span class="sr-only">Actions</span></th>
            </tr>
            </thead>
            <tbody><?php
            foreach ($foods as $food): ?>
                <tr>
                <td>
                    <div class="table-dish"><img src="/assets/<?= e($food['image']) ?>" alt="">
                        <div><strong><?= e($food['name']) ?></strong><small><?= e($food['tag']) ?></small></div>
                    </div>
                </td>
                <td><?= e($food['category']) ?></td>
                <td class="price-cell"><?= money((int)$food['price_cents']) ?></td>
                <td>
                    <form method="post" action="/admin/menu/availability"><?= csrfField() ?><input type="hidden"
                                                                                                   name="food_id"
                                                                                                   value="<?= (int)$food['id'] ?>"><input
                                type="hidden" name="available" value="<?= $food['available'] ? '0' : '1' ?>">
                        <button class="availability <?= $food['available'] ? 'is-available' : '' ?>" type="submit"
                                aria-label="<?= $food['available'] ? 'Mark unavailable: ' : 'Make available: ' ?><?= e(
                                        $food['name']
                                ) ?>"><span></span><?= $food['available'] ? 'Available' : 'Unavailable' ?></button>
                    </form>
                </td>
                <td><a class="text-link" href="/admin/menu/edit?id=<?= (int)$food['id'] ?>">Edit ↗</a></td></tr><?php
            endforeach; ?></tbody>
        </table>
    </div><?php
    if (!$foods): ?><p class="empty-state">Your menu is waiting for its first dish.</p><?php
    endif; ?></section>
<section class="panel categories-panel">
    <div>
        <div class="eyebrow">A PLACE FOR EVERY DISH</div>
        <h2>Categories</h2>
        <div class="category-tags"><?php
            foreach ($categories as $category): ?><span class="pill"><?= e($category['name']) ?></span><?php
            endforeach; ?></div>
    </div>
    <form method="post" action="/admin/categories" class="inline-form"><?= csrfField() ?><label>New category<input
                    name="name" minlength="2" maxlength="80" required placeholder="e.g. Sides & extras"></label>
        <button class="button secondary" type="submit">Add category ＋</button>
    </form>
</section>
