<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#254c3b">
    <title><?= e($pageTitle) ?> · <?= e($config['name']) ?></title>
    <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
    <link rel="stylesheet" href="/assets/app.css">
    <script src="/assets/app.js" defer></script>
</head>
<body class="<?= $staff?'staff-mode':'customer-mode' ?>">
<a class="skip-link" href="#main">Skip to content</a>
<div class="announcement"><span><?= $staff?'THE KITCHEN, CONNECTED':'A LITTLE COMFORT. A LOT OF FLAVOR.' ?></span><span><?= $staff?'Restaurant workspace':'Freshly prepared · Pickup & delivery' ?></span></div>
<header class="site-header">
    <a class="brand" href="<?= $staff?'/admin':'/' ?>" aria-label="<?= e($config['name']) ?> home"><span class="brand-mark">rc<span>·</span></span><span><?= e($config['name']) ?><small><?= $staff?'STAFF WORKSPACE':'YOUR NEIGHBORHOOD KITCHEN' ?></small></span></a>
    <nav aria-label="Main navigation">
        <?php if($staff): ?>
            <a href="/admin" class="<?= $pageTitle==='Overview'?'current':'' ?>">Overview</a><a href="/admin/orders" class="<?= $pageTitle==='Order desk'?'current':'' ?>">Orders</a><a href="/admin/menu" class="<?= in_array($pageTitle,['Your menu','Edit dish','Add a dish'])?'current':'' ?>">Menu</a>
            <a href="/menu" class="subtle-link">View storefront ↗</a>
        <?php else: ?>
            <a href="/menu" class="<?= in_array($pageTitle,['Made fresh. Made for you.'])?'current':'' ?>">Our menu</a>
            <?php if($user): ?><a href="/orders">My orders</a><?php endif; ?>
            <?php if($user && $user['role']==='admin'): ?><a href="/admin">Staff dashboard</a><?php endif; ?>
        <?php endif; ?>
        <?php if($user): ?><form action="/logout" method="post" class="nav-form"><?= csrfField() ?><button class="text-button" type="submit">Sign out</button></form><?php else: ?><a href="/login">Sign in</a><?php endif; ?>
        <?php if(!$staff): ?><a class="bag-button" href="/cart"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12l1 14H5L6 7Zm3 0V5a3 3 0 0 1 6 0v2"/></svg> Your bag <span><?= cartCount() ?></span></a><?php endif; ?>
    </nav>
</header>
<main id="main" class="page-shell">
<?php if($notice): ?><div class="notice notice-<?= e($notice['type']) ?>" role="<?= $notice['type']==='error'?'alert':'status' ?>"><span><?= $notice['type']==='error'?'!':'✓' ?></span><p><?= e($notice['message']) ?></p></div><?php endif; ?>
<?= $content ?>
</main>
<footer class="site-footer"><div><strong><?= e($config['name']) ?><span>·</span></strong><p>Good food brings us together.</p></div><div><p>Proposal demo · Example menu & orders</p><small><?= $staff?'Sales reflect completed orders.':'Pay on pickup or delivery. Menu photography is illustrative.' ?> · <?= e($config['currency']) ?></small></div></footer>
</body></html>
