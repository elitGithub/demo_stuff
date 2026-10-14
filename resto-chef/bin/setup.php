<?php

declare(strict_types=1);
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__ . '/../app/Database.php';
require __DIR__ . '/../app/Auth.php';
require __DIR__ . '/../app/Store.php';
$config = require __DIR__ . '/../app/config.php';
$demo = in_array('--demo', $argv, true);
$json = in_array('--json', $argv, true);
try {
    if ($config['db_driver'] === 'sqlite') {
        $dir = dirname($config['db_path']);
        if (!is_dir($dir) && !mkdir($dir, 0700, true)) {
            throw new RuntimeException('Cannot create private database directory.');
        }
    }
    $db = Database::connect($config);
    Database::migrate($db);
    if ((int)$db->query('SELECT COUNT(*) FROM users')->fetchColumn() > 0) {
        throw new RuntimeException(
            'Database already initialized; no data changed. Use a new DB_PATH/DB_NAME for a fresh demo.'
        );
    }
    if ($config['db_driver'] === 'sqlite') {
        chmod($config['db_path'], 0600);
    }
    $auth = new Auth($db);
    $adminEmail = getenv('ADMIN_EMAIL') ?: 'staff@resto-chef.test';
    $accounts = ['admin' => ['email' => $adminEmail, 'password' => bin2hex(random_bytes(10)) . '!']];
    $db->beginTransaction();
    try {
        $admin = $auth->register('Kitchen team', $adminEmail, $accounts['admin']['password']);
        $db->prepare("UPDATE users SET role='admin' WHERE id=?")->execute([$admin['id']]);
        if ($demo) {
            $accounts['customer'] = [
                'email' => 'customer@resto-chef.test',
                'password' => bin2hex(random_bytes(10)) . '!'
            ];
            $customer = $auth->register(
                'Alex Morgan',
                $accounts['customer']['email'],
                $accounts['customer']['password']
            );
            foreach (['House bowls', 'Street food', 'Noodles & more'] as $category) {
                $db->prepare('INSERT INTO categories(name) VALUES (?)')->execute([$category]);
            }
            $menu = [
                [
                    1,
                    'Butter chicken bowl',
                    'Slow-simmered tomato curry, tender chicken, basmati rice and warm naan.',
                    1490,
                    1,
                    'bowl.jpg',
                    'Bestseller'
                ],
                [
                    2,
                    'Crispy vegetable bites',
                    'Golden vegetable pakoras with fresh herbs and our tangy house chutney.',
                    650,
                    1,
                    'bites.jpg',
                    'Vegetarian'
                ],
                [
                    3,
                    'Wok-tossed noodles',
                    'Springy noodles, crisp seasonal vegetables and a savory sesame-soy sauce.',
                    1190,
                    1,
                    'noodles.jpg',
                    'Kitchen favorite'
                ],
                [
                    2,
                    'Masala dosa',
                    'Crisp rice crepe filled with spiced potatoes, served with coconut chutney.',
                    1090,
                    1,
                    'dosa.jpg',
                    'Vegetarian'
                ],
                [
                    2,
                    'Steamed momos',
                    'Hand-folded vegetable dumplings with a warm, spicy tomato dipping sauce.',
                    890,
                    1,
                    'momos.jpg',
                    'Made fresh'
                ],
                [
                    1,
                    'Paneer tikka bowl',
                    'Charred paneer, fragrant rice, crunchy greens and a cooling mint dressing.',
                    1390,
                    1,
                    'platter.jpg',
                    'Vegetarian'
                ],
                [
                    3,
                    'Chilli garlic noodles',
                    'Wok-fired noodles with garlic, fresh chilli, scallions and a little heat.',
                    1290,
                    1,
                    'noodles.jpg',
                    'A little spicy'
                ],
                [
                    1,
                    'The sharing platter',
                    'A generous selection of curry, rice, breads and house sides for two.',
                    2690,
                    0,
                    'platter.jpg',
                    'Back soon'
                ],
            ];
            $q = $db->prepare(
                'INSERT INTO food(category_id,name,description,price_cents,available,image,tag) VALUES (?,?,?,?,?,?,?)'
            );
            foreach ($menu as $item) {
                $q->execute($item);
            }
        }
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }
    if ($demo) {
        $now = time();
        $store = new Store($db, $config['delivery_fee_cents'], $config['timezone'], function () use (&$now) {
            return $now;
        });
        for ($i = 11; $i >= 0; $i--) {
            $now = time() - intdiv($i, 2) * 86400 - ($i % 2) * 3600;
            $type = $i % 3 === 0 ? 'delivery' : 'pickup';
            $cart = [1 => 1 + ($i % 2), 2 => 1];
            $quote = $store->quote($cart, $type);
            $order = $store->placeOrder(
                $customer['id'],
                $cart,
                [
                    'customer_name' => 'Alex Morgan',
                    'phone'         => '+1 202 555 0142',
                    'fulfillment'   => $type,
                    'address'       => $type === 'delivery' ? '24 Market Street, Apartment 2' : '',
                    'notes'         => 'Example order for the proposal demo.'
                ],
                bin2hex(random_bytes(32)),
                $quote['fingerprint']
            );
            if ($i === 0) {
                continue;
            }
            $store->transition($order['id'], 'pending', 'preparing');
            if ($i === 1) {
                continue;
            }
            $store->transition($order['id'], 'preparing', 'ready');
            if ($type === 'delivery') {
                $store->transition($order['id'], 'ready', 'out_for_delivery');
            }
            $store->transition($order['id'], $type === 'delivery' ? 'out_for_delivery' : 'ready', 'completed');
        }
    }
    if ($json) {
        echo json_encode($accounts, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n";
    } else {
        echo "Database initialized" . ($demo ? ' with an example menu and orders' : '') . ".\n\n";
        foreach ($accounts as $role => $account) {
            echo ucfirst($role) . "\nEmail: " . $account['email'] . "\nPassword: " . $account['password'] . "\n\n";
        }
        echo "Keep these randomly generated credentials private.\nStart: php -S 127.0.0.1:8080 -t public public/router.php\n";
    }
} catch (Throwable $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}
