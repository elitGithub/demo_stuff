<?php
$value = fn($key, $default = '') => is_string($old[$key] ?? null) ? $old[$key] : ($food[$key] ?? $default); ?>
<div class="page-heading"><a class="text-link" href="/admin/menu">← Back to menu</a>
    <h1><?= $food ? 'A little fine-tuning' : 'Something new' ?><span class="accent-dot">.</span></h1>
    <p><?= $food ? 'Update this dish. Existing orders keep their original prices.' : 'Give your next customer a new favorite.' ?></p>
</div>
<section class="panel editor-panel">
    <form method="post" action="/admin/menu/save" class="stack-form submit-once"><?= csrfField() ?><input type="hidden"
                                                                                                          name="food_id"
                                                                                                          value="<?= $food ? (int)$food['id'] : '' ?>">
        <div class="form-grid"><label>Dish name<input name="name" minlength="2" maxlength="100" required
                                                      value="<?= e($value('name')) ?>" placeholder="A name to remember"></label><label>Category<select
                        name="category_id" required>
                    <option value="">Choose a category</option><?php
                    foreach ($categories as $category): ?>
                        <option value="<?= (int)$category['id'] ?>" <?= (string)$value(
                            'category_id'
                    ) === (string)$category['id'] ? 'selected' : '' ?>><?= e($category['name']) ?></option><?php
                    endforeach; ?></select></label></div><?php
        if (!$categories): ?><p class="error-text">Add a category from the menu page before creating a dish.</p><?php
        endif; ?><label>Description<textarea name="description" minlength="5" maxlength="500" rows="3" required
                                             placeholder="What makes this dish special?"><?= e(
                        $value('description')
                ) ?></textarea></label>
        <div class="form-grid"><label>Price (<?= e($config['currency']) ?>)<input name="price" type="number" min="0.01"
                                                                                  max="9999.99" step="0.01" required
                                                                                  value="<?= e(
                                                                                          is_string(
                                                                                                  $old['price'] ?? null
                                                                                          ) ? $old['price'] : ($food ? number_format(
                                                                                                  $food['price_cents'] / 100,
                                                                                                  2,
                                                                                                  '.',
                                                                                                  ''
                                                                                          ) : '')
                                                                                  ) ?>"
                                                                                  placeholder="12.90"></label><label>Short
                label<input name="tag" maxlength="40" value="<?= e($value('tag', 'House favorite')) ?>"
                            placeholder="Bestseller, Vegetarian…"></label></div>
        <label>Menu photo<select name="image"><?php
                foreach (Store::IMAGES as $photo): ?>
                    <option value="<?= e($photo) ?>" <?= $value(
                                                                 'image',
                                                                 'bowl.jpg'
                                                         ) === $photo ? 'selected' : '' ?>><?= e(
                        ucfirst(str_replace('.jpg', '', $photo))
                ) ?></option><?php
                endforeach; ?></select></label><label class="checkbox-label"><input type="checkbox" name="available"
                                                                                    value="1" <?= ($old ? isset($old['available']) : ($food['available'] ?? true)) ? 'checked' : '' ?>><span>Available to order<small>Turn off to keep this dish on the menu as unavailable.</small></span></label>
        <div class="editor-actions"><a class="button secondary" href="/admin/menu">Cancel</a>
            <button class="button" type="submit">Save dish ✓</button>
        </div>
    </form>
</section>
