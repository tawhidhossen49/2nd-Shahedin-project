<?php
/**
 * Checks the payment and admin-team functions on the server. Run on the server:
 *
 *   php paytest.php
 *
 * Uses throwaway accounts made straight in the database and removes them, and
 * every order they made, at the end. It starts ONE real bKash checkout for the
 * cheapest paid course and never pays it, then cancels it the way bKash would.
 * No money moves. Command line only.
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

$c = require getenv('HOME') . '/shahedin-private/db.php';
$db = new PDO("mysql:host={$c['host']};dbname={$c['name']};charset=utf8mb4", $c['user'], $c['pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$db->exec("SET time_zone = '+00:00'");
define('LOCAL', 'api.shahedin.com:443:' . gethostbyname('api.shahedin.com'));
$fails = 0;
function ok(bool $cond, string $what, $extra = null): void
{
    global $fails;
    echo ($cond ? "  ok    " : "  FAIL  ") . $what . ($cond || $extra === null ? '' : '  -> ' . substr(json_encode($extra, JSON_UNESCAPED_UNICODE), 0, 300)) . "\n";
    if (!$cond) $fails++;
}
function api(string $method, string $path, $body = null, ?string $token = null): array
{
    $ch = curl_init("https://api.shahedin.com$path");
    $h = ['Content-Type: application/json', 'Origin: https://www.shahedin.com'];
    if ($token) $h[] = "Authorization: Bearer $token";
    curl_setopt_array($ch, [CURLOPT_RESOLVE => [LOCAL], CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $h, CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true, CURLOPT_TIMEOUT => 60]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    $raw = (string)curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $hs = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    return ['status' => $status, 'headers' => substr($raw, 0, $hs), 'json' => json_decode(substr($raw, $hs), true)];
}
function pay(array $body, ?string $t): array { return api('POST', '/functions/bkash-payment', $body, $t); }
function new_user(string $email): string
{
    global $db;
    $id = bin2hex(random_bytes(4)) . '-0000-4000-8000-' . bin2hex(random_bytes(6));
    $db->prepare('INSERT INTO users (id, email) VALUES (?, ?)')->execute([$id, $email]);
    return $id;
}
function login_as(string $userId): string
{
    global $db;
    $t = bin2hex(random_bytes(24));
    $db->prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, UTC_TIMESTAMP() + INTERVAL 1 HOUR)')->execute([hash('sha256', $t), $userId]);
    return $t;
}
function location(array $r): string { return preg_match('/^location:\s*(\S+)/mi', $r['headers'], $m) ? $m[1] : ''; }
function order_row(string $id): array { global $db; return $db->query('SELECT * FROM orders WHERE id = ' . $db->quote($id))->fetch() ?: []; }

$open = "is_published = 1 AND (enrollment_open IS NULL OR enrollment_open = 1) AND (enrollment_deadline IS NULL OR enrollment_deadline > UTC_TIMESTAMP())";
$paid = $db->query("SELECT id, slug, price_bdt FROM courses WHERE $open AND is_free = 0 AND price_bdt > 0 ORDER BY price_bdt LIMIT 1")->fetch();
$free = $db->query("SELECT id, slug, students_count FROM courses WHERE $open AND is_free = 1 LIMIT 1")->fetch();
$main = $db->query("SELECT id FROM admins WHERE role = 'main' ORDER BY created_at LIMIT 1")->fetchColumn();

$buyer = new_user('paytest-buyer@example.invalid');
$partial = new_user('paytest-partial@example.invalid');
$db->prepare("INSERT INTO admins (id, email, role, permissions) VALUES (?, 'paytest-partial@example.invalid', 'partial', '[\"courses\"]')")->execute([$partial]);
$tBuyer = login_as($buyer);
$tPartial = login_as($partial);
$tMain = login_as($main);
$newAdminEmail = 'paytest-new-admin@example.invalid';

try {
    echo "Without a login\n";
    $r = pay(['action' => 'create', 'kind' => 'course', 'slug' => $paid['slug']], null);
    ok($r['status'] === 401 && ($r['json']['error'] ?? '') === 'অর্ডার করতে হলে আগে লগইন করুন।', 'checkout asks to log in');
    $r = pay(['action' => 'create', 'kind' => 'course', 'slug' => $paid['slug']], str_repeat('a', 48));
    ok($r['status'] === 401, 'an expired login also asks to log in');
    $r = api('POST', '/functions/no-such-function', [], null);
    ok($r['status'] === 404 && isset($r['json']['error']), 'unknown function: 404 with { error }');

    echo "Buyer\n";
    $r = pay(['action' => 'create', 'kind' => 'course', 'slug' => 'no-such-course-xyz'], $tBuyer);
    ok($r['status'] === 404, 'unknown course refused');
    if ($free) {
        $r = pay(['action' => 'create', 'kind' => 'course', 'slug' => $free['slug']], $tBuyer);
        ok($r['status'] === 200 && ($r['json']['free'] ?? false) === true, 'free course: done at once, no bKash', $r['json']);
        ok((bool)$db->query('SELECT 1 FROM enrollments WHERE user_id = ' . $db->quote($buyer) . ' AND course_id = ' . $db->quote($free['id']))->fetchColumn(), 'free course: enrolled');
        $r = pay(['action' => 'create', 'kind' => 'course', 'slug' => $free['slug']], $tBuyer);
        ok($r['status'] === 409, 'cannot buy a course twice');
    } else {
        echo "  (no free course to test with)\n";
    }

    $r = pay(['action' => 'create', 'kind' => 'course', 'slug' => $paid['slug'], 'buyer' => ['name' => 'Pay Test', 'phone' => '01700000000'],
              'amount' => 1, 'amount_bdt' => 1, 'price_bdt' => 1], $tBuyer);
    $orderId = $r['json']['orderId'] ?? '';
    ok($r['status'] === 200 && str_starts_with($r['json']['bkashURL'] ?? '', 'https://') && $orderId !== '', 'paid course: bKash checkout page returned', $r['json']);
    $o = order_row($orderId);
    ok(($o['amount_bdt'] ?? null) == $paid['price_bdt'], "price comes from the database (৳{$paid['price_bdt']}), not the browser");
    ok(($o['status'] ?? '') === 'pending' && ($o['bkash_env'] ?? '') === 'live' && !empty($o['bkash_payment_id']) && !empty($o['bkash_signature']), 'order is pending, tied to live bKash, signature kept');

    $r = pay(['action' => 'status', 'orderId' => $orderId], $tBuyer);
    ok($r['status'] === 200 && ($r['json']['order']['status'] ?? '') === 'pending', 'status: an unpaid checkout stays pending', $r['json']);
    $r = pay(['action' => 'status', 'orderId' => $orderId], $tPartial);
    ok($r['status'] === 404, "someone else's order is 'not found'");

    $pid = rawurlencode($o['bkash_payment_id']);
    $r = api('GET', "/functions/bkash-callback?paymentID=$pid&status=cancel");
    ok(str_contains(location($r), 'status=unknown') && order_row($orderId)['status'] === 'pending', 'callback without the signature changes nothing');
    $r = api('GET', "/functions/bkash-callback?paymentID=$pid&status=success&signature=wrong");
    ok(str_contains(location($r), 'status=unknown') && order_row($orderId)['status'] === 'pending', 'callback with a wrong signature changes nothing');
    $sig = rawurlencode($o['bkash_signature']);
    $r = api('GET', "/functions/bkash-callback?paymentID=$pid&status=cancel&signature=$sig");
    ok(str_starts_with(location($r), rtrim((string)(require getenv('HOME') . '/shahedin-private/config.php')['site_url'], '/') . '/payment-status?status=cancelled&order=') && order_row($orderId)['status'] === 'cancelled', 'cancel from bKash: order cancelled, customer sent to the status page', location($r));
    $r = api('GET', "/functions/bkash-callback?paymentID=$pid&status=failure&signature=$sig");
    ok(order_row($orderId)['status'] === 'cancelled', 'a later callback cannot change a finished order');
    $r = api('GET', '/functions/bkash-callback?paymentID=TR-NO-SUCH&status=success');
    ok(str_contains(location($r), 'status=unknown'), 'unknown payment: sent to the status page as unknown');
    $r = api('GET', '/functions/bkash-callback/0?paymentID=TR-NO-SUCH&status=success');
    ok(str_starts_with(location($r), 'https://www.shahedin.com/payment-status?'), 'a buyer from www.shahedin.com is sent back there', location($r));
    $r = api('GET', '/functions/bkash-callback/2?paymentID=TR-NO-SUCH&status=success');
    ok(str_starts_with(location($r), 'https://2nd-shahedin-project.vercel.app/payment-status?'), 'a buyer from the test site is sent back to the test site', location($r));
    $r = api('GET', '/functions/bkash-callback/9?paymentID=TR-NO-SUCH&status=success');
    ok(str_starts_with(location($r), rtrim((string)(require getenv('HOME') . '/shahedin-private/config.php')['site_url'], '/') . '/payment-status?'), 'an unknown site number falls back to the default, never anywhere else', location($r));
    $cb = $db->query("SELECT JSON_UNQUOTE(JSON_EXTRACT(request_body, '$.callbackURL')) FROM bkash_api_log WHERE api = 'create-payment' ORDER BY id DESC LIMIT 1")->fetchColumn();
    ok($cb === 'https://api.shahedin.com/functions/bkash-callback/0', 'bKash was told to return the buyer to the site they came from', $cb);

    echo "Refunds\n";
    $r = pay(['action' => 'refund', 'orderId' => $orderId, 'amount' => 1], $tBuyer);
    ok($r['status'] === 403, 'a buyer cannot refund');
    $r = pay(['action' => 'refund', 'orderId' => $orderId, 'amount' => 1], $tPartial);
    ok($r['status'] === 403, 'an admin without the Orders page cannot refund');
    $r = pay(['action' => 'refund', 'orderId' => $orderId, 'amount' => 1], $tMain);
    ok($r['status'] === 409, 'only a completed payment can be refunded');

    echo "Checkout limit\n";
    for ($i = 0; $i < 6; $i++) $db->prepare("INSERT INTO orders (id, user_id, kind, item_id, item_title, amount_bdt, status) VALUES (UUID(), ?, 'course', ?, 'limit test', 0, 'failed')")->execute([$buyer, $paid['id']]);
    $r = pay(['action' => 'create', 'kind' => 'course', 'slug' => $paid['slug']], $tBuyer);
    ok($r['status'] === 429, 'more than 5 checkouts in 10 minutes is refused (protects the merchant account)');

    echo "Adding admins\n";
    $r = api('POST', '/functions/admin-users', ['email' => $newAdminEmail, 'password' => 'long-enough-1', 'role' => 'partial', 'permissions' => ['orders']], $tPartial);
    ok($r['status'] === 403, 'a partial admin cannot add admins');
    $r = api('POST', '/functions/admin-users', ['email' => 'not-an-email', 'password' => 'long-enough-1', 'role' => 'partial'], $tMain);
    ok($r['status'] === 400, 'bad email refused');
    $r = api('POST', '/functions/admin-users', ['email' => $newAdminEmail, 'password' => 'short', 'role' => 'partial'], $tMain);
    ok($r['status'] === 400, 'short password refused');
    $r = api('POST', '/functions/admin-users', ['email' => $newAdminEmail, 'password' => 'long-enough-1', 'full_name' => 'New Admin', 'role' => 'partial', 'permissions' => ['orders', 'hack']], $tMain);
    ok($r['status'] === 200 && ($r['json']['admin']['permissions'] ?? null) === ['orders'], 'main admin adds an admin (unknown page names dropped)', $r['json']);
    $r = api('POST', '/auth/token', ['email' => $newAdminEmail, 'password' => 'long-enough-1']);
    ok($r['status'] === 200, 'the new admin can log in');
    $r = api('POST', '/functions/admin-users', ['email' => $newAdminEmail, 'password' => 'long-enough-1', 'role' => 'partial'], $tMain);
    ok($r['status'] === 409 && ($r['json']['code'] ?? '') === 'exists', 'an email that already has a login: code "exists"');

    echo "Facebook ads page
";
    $r = api('POST', '/functions/meta-ads', ['action' => 'status'], $tBuyer);
    ok($r['status'] === 403, 'a student cannot open it');
    $r = api('POST', '/functions/meta-ads', ['action' => 'status'], $tPartial);
    ok($r['status'] === 403, 'an admin without the ads page cannot open it');
    $r = api('POST', '/functions/meta-ads', ['action' => 'status'], $tMain);
    ok($r['status'] === 200 && array_key_exists('tokenSaved', $r['json'] ?? []) && !str_contains(json_encode($r['json']), 'access_token'), 'main admin sees the status, never a token', $r['json']);
    $r = api('POST', '/functions/meta-ads', ['action' => 'test', 'test_event_code' => 'nope'], $tMain);
    ok($r['status'] === 400, 'a test needs a TEST... code');
    $r = api('POST', '/functions/meta-ads', ['action' => 'results', 'period' => "last_7d' OR 1=1"], $tMain);
    ok($r['status'] === 200 && isset($r['json']['connected']), 'results answer (odd period ignored)', $r['json']);

    echo "Ad results maths
";
    require_once getenv('HOME') . '/shahedin-app/bootstrap.php';
    require_once getenv('HOME') . '/shahedin-app/meta.php';
    require_once getenv('HOME') . '/shahedin-app/meta_ads.php';
    $sum = meta_summary(['spend' => '100', 'actions' => [['action_type' => 'purchase', 'value' => '9'], ['action_type' => 'omni_purchase', 'value' => '4']],
                         'action_values' => [['action_type' => 'omni_purchase', 'value' => '2000']]]);
    ok($sum['purchases'] == 4 && $sum['costPerPurchase'] == 25 && $sum['roas'] == 20, 'a sale counted once (omni first), cost per sale and return worked out');
    ok(meta_summary([])['costPerPurchase'] === null, 'no sales: cost per sale is empty, not zero');
    $t = gmmktime(20, 0, 0, 3, 10, 2026);   // 10 Mar 20:00 UTC = 11 Mar 02:00 in Dhaka
    ok(meta_period_range('today', $t) === ['2026-03-10 18:00:00', '2026-03-10 20:00:00'], 'today = since midnight Dhaka time');
    ok(meta_period_range('last_7d', $t) === ['2026-03-03 18:00:00', '2026-03-10 18:00:00'], 'last 7 days = the 7 full Dhaka days before today');
    ok(meta_period_range('this_month', $t)[0] === '2026-02-28 18:00:00', 'this month starts on the 1st in Dhaka');
    ok(meta_period_range('maximum', $t)[0] === null, 'maximum has no start');
} finally {
    // Enrolments first, so the course's student count is recounted by its trigger.
    $ids = [$buyer, $partial];
    $newId = $db->query('SELECT id FROM users WHERE email = ' . $db->quote($newAdminEmail))->fetchColumn();
    if ($newId) $ids[] = $newId;
    $in = implode(',', array_map([$db, 'quote'], $ids));
    $db->exec("DELETE FROM enrollments WHERE user_id IN ($in)");
    $db->exec("DELETE FROM orders WHERE user_id IN ($in)");
    $db->exec("DELETE FROM admins WHERE id IN ($in)");
    $db->exec("DELETE FROM users WHERE id IN ($in)");
    $db->exec('DELETE FROM sessions WHERE token_hash = ' . $db->quote(hash('sha256', $tMain)));
    $db->exec("DELETE FROM auth_failures WHERE failed_at > UTC_TIMESTAMP() - INTERVAL 10 MINUTE");
    if ($free) ok((int)$db->query('SELECT students_count FROM courses WHERE id = ' . $db->quote($free['id']))->fetchColumn() === (int)$free['students_count'], 'clean-up: student count back as it was');
    ok(!$db->query("SELECT 1 FROM users WHERE email LIKE 'paytest-%@example.invalid'")->fetchColumn(), 'clean-up: test accounts removed');
}
echo $fails ? "\n$fails FAILED\n" : "\nall passed\n";
exit($fails ? 1 : 0);
