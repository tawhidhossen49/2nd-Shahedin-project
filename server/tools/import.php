<?php
/**
 * Loads the JSON made by export-supabase.sh into the MySQL database.
 *
 *   php import.php <export.json>
 *
 * Empties every table first, so running it again gives an exact fresh copy.
 * Command line only: it must never be reachable from the web.
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

$file = $argv[1] ?? '';
if ($file === '' || !is_file($file)) { fwrite(STDERR, "usage: php import.php <export.json>\n"); exit(1); }
$data = json_decode(file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);

$c = require getenv('HOME') . '/shahedin-private/db.php';
$db = new PDO("mysql:host={$c['host']};dbname={$c['name']};charset=utf8mb4", $c['user'], $c['pass'], [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
]);
$db->exec("SET time_zone = '+00:00'");
$db->exec('SET @app_import = 1'); // tells the coupon trigger not to count these orders again

// Parents before children, so every foreign key finds its row.
$order = ['users', 'profiles', 'admins', 'courses', 'products', 'coupons', 'enrollments', 'course_reviews',
          'orders', 'order_refunds', 'bkash_api_log', 'home_content', 'site_settings', 'contact_submissions',
          'page_views', 'activity_log'];

// Column types straight from MySQL, so each value is converted the right way.
$types = [];
foreach ($db->query("SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()") as $r) {
    $types[$r['TABLE_NAME']][$r['COLUMN_NAME']] = $r['COLUMN_TYPE'] === 'tinyint(1)' ? 'bool' : $r['DATA_TYPE'];
}
// MariaDB reports JSON columns as longtext; their CHECK(json_valid) marks them.
foreach ($db->query("SELECT TABLE_NAME, CONSTRAINT_NAME FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CHECK_CLAUSE LIKE 'json_valid(%'") as $r) {
    $types[$r['TABLE_NAME']][$r['CONSTRAINT_NAME']] = 'json';
}

function convert($value, string $type) {
    if ($value === null) return null;
    switch ($type) {
        case 'json':     return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
        case 'bool':     return $value ? 1 : 0;
        case 'datetime': return (new DateTimeImmutable((string)$value))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s.u');
        default:         return is_array($value) ? json_encode($value, JSON_UNESCAPED_UNICODE) : $value;
    }
}

// One transaction: if anything fails, the database is left exactly as it was.
$db->beginTransaction();
try {
    $db->exec('SET FOREIGN_KEY_CHECKS = 0');
    foreach (array_reverse($order) as $t) $db->exec("DELETE FROM `$t`");
    $db->exec('SET FOREIGN_KEY_CHECKS = 1');

    foreach ($order as $t) {
        $rows = $data[$t] ?? [];
        $n = 0;
        foreach ($rows as $row) {
            $cols = array_values(array_filter(array_keys($row), fn($k) => isset($types[$t][$k])));
            // REPLACE: a new user's profile is already made by a trigger; the copied one wins.
            $sql = sprintf('REPLACE INTO `%s` (%s) VALUES (%s)', $t,
                implode(',', array_map(fn($k) => "`$k`", $cols)), implode(',', array_fill(0, count($cols), '?')));
            $db->prepare($sql)->execute(array_map(fn($k) => convert($row[$k], $types[$t][$k]), $cols));
            $n++;
        }
        $have = (int)$db->query("SELECT COUNT(*) FROM `$t`")->fetchColumn();
        printf("%-20s %6d copied %s\n", $t, $n, $have === count($rows) ? 'ok' : "MISMATCH ($have in db)");
    }
    $db->commit();
} catch (Throwable $e) {
    $db->rollBack();
    fwrite(STDERR, "FAILED, nothing was saved: " . $e->getMessage() . "\n");
    exit(1);
}
