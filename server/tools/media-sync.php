<?php
/**
 * Copies the uploaded files from Supabase Storage to this server, then points
 * the database at the copies. Safe to run again (at the final switch, after the
 * last data import): files already here are skipped, links already moved stay.
 *
 *   php media-sync.php media-list.txt
 *
 * media-list.txt holds one storage path per line (folder/name.ext), from
 *   select name from storage.objects where bucket_id = 'media'
 * Command line only.
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

const FROM = 'https://vkpokhjltfaclyeurxux.supabase.co/storage/v1/object/public/media/';
const TO = 'https://api.shahedin.com/media/';
$dir = getenv('HOME') . '/api.shahedin.com/media/';

$paths = array_filter(array_map('trim', file($argv[1] ?? '') ?: []));
if (!$paths) { fwrite(STDERR, "usage: php media-sync.php media-list.txt\n"); exit(1); }

$copied = $skipped = $failed = 0;
foreach ($paths as $p) {
    if (!preg_match('#^[a-z0-9-]+/[A-Za-z0-9][A-Za-z0-9._-]*$#', $p) || str_contains($p, '..')) { echo "  odd name, skipped: $p\n"; $failed++; continue; }
    $dest = $dir . $p;
    if (is_file($dest) && filesize($dest) > 0) { $skipped++; continue; }
    if (!is_dir(dirname($dest))) mkdir(dirname($dest), 0755, true);
    $ch = curl_init(FROM . $p);
    $fh = fopen("$dest.part", 'wb');
    curl_setopt_array($ch, [CURLOPT_FILE => $fh, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 300, CURLOPT_FAILONERROR => true]);
    $ok = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);
    fclose($fh);
    if ($ok && filesize("$dest.part") > 0) { rename("$dest.part", $dest); chmod($dest, 0644); $copied++; }
    else { @unlink("$dest.part"); echo "  FAILED $p: $err\n"; $failed++; }
}
echo "files: $copied copied, $skipped already here, $failed failed\n";
if ($failed) exit(1);   // never point the database at files that are not here

// Point every text column at the copies. Both spellings: plain, and JSON's escaped "\/".
$c = require getenv('HOME') . '/shahedin-private/db.php';
$db = new PDO("mysql:host={$c['host']};dbname={$c['name']};charset=utf8mb4", $c['user'], $c['pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$db->exec('SET @app_import = 1');   // a bulk fix, not an admin's edit
$skip = ['activity_log', 'bkash_api_log', 'page_views', 'sessions'];   // history stays as it happened
$cols = $db->query("SELECT table_name t, column_name c FROM information_schema.columns
                    WHERE table_schema = DATABASE() AND data_type IN ('text','mediumtext','longtext','varchar','json')")->fetchAll(PDO::FETCH_ASSOC);
$hasUpdated = [];
foreach ($db->query("SELECT table_name FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name = 'updated_at'") as $r) $hasUpdated[$r[0]] = true;
$pairs = [[FROM, TO], [str_replace('/', '\/', FROM), str_replace('/', '\/', TO)]];
$changed = 0;
foreach ($cols as $x) {
    if (in_array($x['t'], $skip, true)) continue;
    foreach ($pairs as [$from, $to]) {
        // updated_at kept as it was: moving a file is not an edit to the course.
        $keep = isset($hasUpdated[$x['t']]) ? ', updated_at = updated_at' : '';
        $st = $db->prepare("UPDATE `{$x['t']}` SET `{$x['c']}` = REPLACE(`{$x['c']}`, ?, ?)$keep WHERE INSTR(`{$x['c']}`, ?) > 0");
        $st->execute([$from, $to, $from]);
        if ($n = $st->rowCount()) { echo "  {$x['t']}.{$x['c']}: $n row(s)\n"; $changed += $n; }
    }
}
$left = 0;
foreach ($cols as $x) {
    if (in_array($x['t'], $skip, true)) continue;
    $left += (int)$db->query("SELECT COUNT(*) FROM `{$x['t']}` WHERE INSTR(`{$x['c']}`, 'supabase.co') > 0")->fetchColumn();
}
echo "links moved: $changed; links to supabase.co left outside history tables: $left\n";
