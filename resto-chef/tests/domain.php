<?php
declare(strict_types=1);
require __DIR__ . '/../app/Database.php';
require __DIR__ . '/../app/Auth.php';
require __DIR__ . '/../app/Store.php';

$passed = 0;
function check(bool $ok, string $message): void {
    global $passed;
    if (!$ok) throw new RuntimeException($message);
    $passed++;
    echo "PASS $message\n";
}
function rejects(callable $fn, string $message): void {
    try { $fn(); } catch (InvalidArgumentException|DomainException $e) { check(true, $message); return; }
    throw new RuntimeException("Expected rejection: $message");
}
$db = new PDO('sqlite::memory:');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$db->exec('PRAGMA foreign_keys=ON');
Database::migrate($db);
Database::migrate($db);
$auth = new Auth($db);
$user = $auth->register('Demo Customer', 'customer@example.test', 'Sensible-password-238!');
$other = $auth->register('Other Customer', 'other@example.test', 'Another-password-279!');
check($user['role'] === 'customer', 'registration never grants staff access');
check(!isset($user['password_hash']), 'public user result excludes password hash');
$hash = $db->query('SELECT password_hash FROM users LIMIT 1')->fetchColumn();
check(password_verify('Sensible-password-238!', $hash), 'passwords stored as verifiable hashes');
check($auth->login('CUSTOMER@example.test', 'Sensible-password-238!', '127.0.0.1')['id'] === $user['id'], 'login normalizes email');
check($auth->login("x' OR 1=1 --", 'bad-password', '127.0.0.1') === null, 'SQL injection cannot authenticate');
rejects(fn() => $auth->register('Someone', 'customer@example.test', 'Another-password-279!'), 'duplicate email handled');
rejects(fn() => $auth->register('Someone', 'bad-email', '123'), 'invalid registration rejected');
$db->exec("INSERT INTO categories(name) VALUES ('Bowls')");
$db->exec("INSERT INTO food(category_id,name,description,price_cents,available,image) VALUES
(1,'Curry bowl','Spiced curry and rice',1290,1,'bowl.jpg'),
(1,'Crispy bites','A crunchy side',450,1,'bites.jpg')");
$now = (new DateTimeImmutable('2026-10-14 10:00:00', new DateTimeZone('UTC')))->getTimestamp();
$store = new Store($db, 350, 'UTC', function() use (&$now) { return $now; });
$cart = [1 => 2, 2 => 1];
$quote = $store->quote($cart, 'pickup');
check($quote['subtotal_cents'] === 3030 && $quote['total_cents'] === 3030, 'multi-item quote uses server prices and quantities');
check($store->quote($cart, 'delivery')['total_cents'] === 3380, 'delivery fee included exactly once');
rejects(fn() => $store->quote([], 'pickup'), 'empty cart rejected');
rejects(fn() => $store->quote([1 => -1], 'pickup'), 'negative quantity rejected');
rejects(fn() => $store->quote([1 => 21], 'pickup'), 'oversized quantity rejected');
rejects(fn() => $store->quote([1 => '1.5'], 'pickup'), 'fractional quantity rejected');
rejects(fn() => $store->quote([999 => 1], 'pickup'), 'unknown food rejected');
rejects(fn() => $store->quote($cart, 'invalid'), 'unknown fulfillment rejected');
$details = ['fulfillment'=>'pickup','customer_name'=>'Demo Customer','phone'=>'+1 555 010 1000','address'=>'','notes'=>'No cutlery'];
$key = bin2hex(random_bytes(32));
$order = $store->placeOrder($user['id'], $cart, $details, $key, $quote['fingerprint']);
check($order['total_cents'] === 3030 && $order['status'] === 'pending', 'checkout stores pending server-priced order');
check(count($store->orderForUser($order['id'], $user['id'])['items']) === 2, 'order contains both item snapshots');
check($store->orderForUser($order['id'], $other['id']) === null, 'order ownership enforced');
$again = $store->placeOrder($user['id'], [], $details, $key, $quote['fingerprint']);
check($again['id'] === $order['id'] && (int)$db->query('SELECT COUNT(*) FROM orders')->fetchColumn() === 1, 'duplicate checkout returns original order');
rejects(fn() => $store->placeOrder($other['id'], $cart, $details, $key, $quote['fingerprint']), 'another customer cannot replay an order key');
$db->exec('UPDATE food SET price_cents=1590 WHERE id=1');
rejects(fn() => $store->placeOrder($user['id'], $cart, $details, bin2hex(random_bytes(32)), $quote['fingerprint']), 'stale quoted prices require new review');
check($store->orderForUser($order['id'], $user['id'])['items'][0]['unit_price_cents'] === 1290, 'historical price survives menu changes');
$db->exec('UPDATE food SET available=0 WHERE id=1');
rejects(fn() => $store->quote($cart, 'pickup'), 'unavailable food rejected');
check((int)$db->query('SELECT COUNT(*) FROM orders')->fetchColumn() === 1, 'failed checkout leaves no partial order');
$db->exec('UPDATE food SET available=1 WHERE id=1');
$delivery = $store->quote($cart, 'delivery');
$deliveryDetails = array_replace($details, ['fulfillment'=>'delivery']);
rejects(fn() => $store->placeOrder($user['id'], $cart, $deliveryDetails, bin2hex(random_bytes(32)), $delivery['fingerprint']), 'delivery address required');
$deliveryDetails['address'] = '15 Market Street, Suite 3';
$deliveryOrder = $store->placeOrder($user['id'], $cart, $deliveryDetails, bin2hex(random_bytes(32)), $delivery['fingerprint']);
rejects(fn() => $store->transition($order['id'], 'pending', 'completed'), 'cannot skip preparation stages');
$store->transition($order['id'], 'pending', 'preparing');
rejects(fn() => $store->transition($order['id'], 'pending', 'cancelled'), 'stale staff update rejected');
$store->transition($order['id'], 'preparing', 'ready');
rejects(fn() => $store->transition($order['id'], 'ready', 'out_for_delivery'), 'pickup cannot become delivery');
$store->transition($order['id'], 'ready', 'completed');
rejects(fn() => $store->transition($order['id'], 'completed', 'cancelled'), 'completed orders cannot be rewritten');
$store->transition($deliveryOrder['id'], 'pending', 'preparing');
$store->transition($deliveryOrder['id'], 'preparing', 'ready');
rejects(fn() => $store->transition($deliveryOrder['id'], 'ready', 'completed'), 'delivery must be dispatched before completion');
$store->transition($deliveryOrder['id'], 'ready', 'out_for_delivery');
$now += 86400;
$store->transition($deliveryOrder['id'], 'out_for_delivery', 'completed');
$report = $store->sales('2026-10-14', '2026-10-14');
check($report['revenue_cents'] === 3030 && $report['completed_count'] === 1, 'sales use completion date, not creation date');
check($store->sales('2026-10-15', '2026-10-15')['revenue_cents'] === 3980, 'delivery sales include fee');
check($report['popular'][0]['quantity'] === 2, 'popular items aggregate completed quantities');
rejects(fn() => $store->sales('2026-02-31','2026-03-01'), 'invalid calendar dates rejected');
rejects(fn() => $store->sales('2026-10-15','2026-10-14'), 'reversed report dates rejected');
$cancelled = $store->placeOrder($user['id'], [2=>1], $details, bin2hex(random_bytes(32)), $store->quote([2=>1],'pickup')['fingerprint']);
$store->transition($cancelled['id'], 'pending', 'cancelled');
check($store->sales('2026-10-14','2026-10-15')['revenue_cents'] === 7010, 'cancelled orders excluded from revenue');
$tzStore = new Store($db,350,'America/New_York');
check($tzStore->sales('2026-10-14','2026-10-14')['revenue_cents'] === 3030, 'sales support configured local timezone');
for ($i=0;$i<10;$i++) $auth->login('locked@example.test','wrong','192.0.2.1');
rejects(fn() => $auth->login('locked@example.test','wrong','192.0.2.1'), 'repeated login failures are throttled');
echo "\n$passed domain checks passed.\n";
