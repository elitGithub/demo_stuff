<?php
declare(strict_types=1);

final class Database
{
    public static function connect(array $config): PDO
    {
        $options = [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC, PDO::ATTR_STRINGIFY_FETCHES=>false];
        if ($config['db_driver'] === 'sqlite') {
            $path = $config['db_path'];
            if ($path !== ':memory:' && (!str_starts_with($path, '/') || !is_dir(dirname($path)))) throw new RuntimeException('SQLite requires an absolute path in an existing private directory. Run bin/setup.php.');
            $db = new PDO('sqlite:' . $path, null, null, $options);
            $db->exec('PRAGMA foreign_keys=ON');
            $db->exec('PRAGMA busy_timeout=5000');
            return $db;
        }
        if ($config['db_driver'] !== 'mysql') throw new RuntimeException('Unsupported database driver.');
        if ($config['db_user'] === '' || strtolower($config['db_user']) === 'root' || $config['db_password'] === '') throw new RuntimeException('MySQL requires a dedicated non-root user and password.');
        if (!preg_match('/^[a-zA-Z0-9_.:-]+$/', $config['db_host']) || !preg_match('/^[a-zA-Z0-9_]+$/', $config['db_name']) || !ctype_digit($config['db_port'])) throw new RuntimeException('Invalid database configuration.');
        $options[PDO::ATTR_EMULATE_PREPARES] = false;
        $options[PDO::ATTR_PERSISTENT] = false;
        if ($config['db_ssl_ca'] !== '') {
            $options[PDO::MYSQL_ATTR_SSL_CA] = $config['db_ssl_ca'];
            $options[PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT] = true;
        }
        return new PDO('mysql:host=' . $config['db_host'] . ';port=' . $config['db_port'] . ';dbname=' . $config['db_name'] . ';charset=utf8mb4', $config['db_user'], $config['db_password'], $options);
    }

    // Invoked exclusively by the CLI setup command and isolated tests.
    public static function migrate(PDO $db): void
    {
        $mysql = $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
        $id = $mysql ? 'INTEGER PRIMARY KEY AUTO_INCREMENT' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
        $suffix = $mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';
        $tables = [
            "users (id $id, name VARCHAR(100) NOT NULL, email VARCHAR(190) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL, role VARCHAR(20) NOT NULL DEFAULT 'customer', created_at BIGINT NOT NULL, CHECK (role IN ('customer','admin')))",
            "categories (id $id, name VARCHAR(80) NOT NULL UNIQUE)",
            "food (id $id, category_id INTEGER NOT NULL, name VARCHAR(100) NOT NULL, description VARCHAR(500) NOT NULL, price_cents INTEGER NOT NULL, available INTEGER NOT NULL DEFAULT 1, image VARCHAR(60) NOT NULL DEFAULT 'bowl.jpg', tag VARCHAR(40) NOT NULL DEFAULT 'House favorite', FOREIGN KEY (category_id) REFERENCES categories(id), CHECK (price_cents > 0), CHECK (available IN (0,1)))",
            "orders (id $id, reference VARCHAR(24) NOT NULL UNIQUE, request_key CHAR(64) NOT NULL UNIQUE, user_id INTEGER NOT NULL, customer_name VARCHAR(100) NOT NULL, phone VARCHAR(30) NOT NULL, fulfillment VARCHAR(20) NOT NULL, address VARCHAR(500) NOT NULL, notes VARCHAR(500) NOT NULL, status VARCHAR(24) NOT NULL DEFAULT 'pending', subtotal_cents INTEGER NOT NULL, delivery_fee_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, completed_at BIGINT NULL, FOREIGN KEY (user_id) REFERENCES users(id), CHECK (fulfillment IN ('pickup','delivery')), CHECK (status IN ('pending','preparing','ready','out_for_delivery','completed','cancelled')), CHECK (total_cents = subtotal_cents + delivery_fee_cents))",
            "order_items (id $id, order_id INTEGER NOT NULL, food_id INTEGER NOT NULL, name VARCHAR(100) NOT NULL, unit_price_cents INTEGER NOT NULL, quantity INTEGER NOT NULL, line_total_cents INTEGER NOT NULL, FOREIGN KEY (order_id) REFERENCES orders(id), FOREIGN KEY (food_id) REFERENCES food(id), CHECK (quantity > 0), CHECK (line_total_cents = unit_price_cents * quantity))",
            "login_attempts (bucket CHAR(64) PRIMARY KEY, failures INTEGER NOT NULL, window_start BIGINT NOT NULL)",
        ];
        foreach ($tables as $table) $db->exec('CREATE TABLE IF NOT EXISTS ' . $table . $suffix);
        if (!$mysql) {
            $db->exec('CREATE INDEX IF NOT EXISTS orders_user_created ON orders(user_id, created_at)');
            $db->exec('CREATE INDEX IF NOT EXISTS orders_status_completed ON orders(status, completed_at)');
            $db->exec('CREATE INDEX IF NOT EXISTS order_items_order ON order_items(order_id)');
        } else {
            foreach (['orders_user_created'=>'orders(user_id, created_at)', 'orders_status_completed'=>'orders(status, completed_at)', 'order_items_order'=>'order_items(order_id)'] as $name=>$target) {
                $check = $db->prepare('SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND index_name=?');
                $check->execute([$name]);
                if (!(int)$check->fetchColumn()) $db->exec("CREATE INDEX $name ON $target");
            }
        }
    }
}
