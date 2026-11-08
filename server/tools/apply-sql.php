<?php
/**
 * Runs SQL files against the API's database, in order.
 *
 *   php apply-sql.php schema.sql triggers.sql
 *
 * Command line only.
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

$c = require getenv('HOME') . '/shahedin-private/db.php';
$m = new mysqli($c['host'], $c['user'], $c['pass'], $c['name']);
$m->set_charset('utf8mb4');
foreach (array_slice($argv, 1) as $file) {
    if (!$m->multi_query(file_get_contents($file))) { fwrite(STDERR, "$file: {$m->error}\n"); exit(1); }
    do {
        if ($r = $m->store_result()) $r->free();
        if ($m->errno) { fwrite(STDERR, "$file: {$m->error}\n"); exit(1); }
    } while ($m->more_results() && $m->next_result());
    if ($m->errno) { fwrite(STDERR, "$file: {$m->error}\n"); exit(1); }
    echo "applied $file\n";
}
