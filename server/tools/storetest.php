<?php
/**
 * Checks file uploads and the media folder on the server: who may upload, what
 * may be uploaded, and that nothing in media/ can ever run. Run on the server:
 *
 *   php storetest.php
 *
 * Every test file and temporary login is removed at the end. Command line only.
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

$c = require getenv('HOME') . '/shahedin-private/db.php';
$db = new PDO("mysql:host={$c['host']};dbname={$c['name']};charset=utf8mb4", $c['user'], $c['pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
define('LOCAL', 'api.shahedin.com:443:' . gethostbyname('api.shahedin.com'));
$media = getenv('HOME') . '/api.shahedin.com/media/';
$tmp = sys_get_temp_dir() . '/storetest-' . bin2hex(random_bytes(4));
mkdir($tmp);
$fails = 0;
function ok(bool $cond, string $what, $extra = null): void
{
    global $fails;
    echo ($cond ? "  ok    " : "  FAIL  ") . $what . ($cond || $extra === null ? '' : '  -> ' . substr(json_encode($extra), 0, 300)) . "\n";
    if (!$cond) $fails++;
}
function get(string $path): array
{
    $ch = curl_init("https://api.shahedin.com$path");
    curl_setopt_array($ch, [CURLOPT_RESOLVE => [LOCAL], CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true]);
    $raw = (string)curl_exec($ch);
    $hs = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $r = ['status' => curl_getinfo($ch, CURLINFO_HTTP_CODE), 'headers' => substr($raw, 0, $hs), 'body' => substr($raw, $hs)];
    curl_close($ch);
    return $r;
}
function upload(string $file, string $path, ?string $token, string $bucket = 'media'): array
{
    $ch = curl_init('https://api.shahedin.com/storage/upload');
    $h = ['Origin: https://www.shahedin.com'];
    if ($token) $h[] = "Authorization: Bearer $token";
    curl_setopt_array($ch, [CURLOPT_RESOLVE => [LOCAL], CURLOPT_POST => true, CURLOPT_HTTPHEADER => $h, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POSTFIELDS => ['bucket' => $bucket, 'path' => $path, 'file' => new CURLFile($file)]]);
    $raw = (string)curl_exec($ch);
    $r = ['status' => curl_getinfo($ch, CURLINFO_HTTP_CODE), 'json' => json_decode($raw, true)];
    curl_close($ch);
    return $r;
}
function login_as(string $id): string
{
    global $db;
    $t = bin2hex(random_bytes(24));
    $db->prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, UTC_TIMESTAMP() + INTERVAL 1 HOUR)')->execute([hash('sha256', $t), $id]);
    return $t;
}

$adminId = $db->query("SELECT id FROM admins ORDER BY created_at LIMIT 1")->fetchColumn();
$studentId = $db->query("SELECT id FROM users WHERE id NOT IN (SELECT id FROM admins) LIMIT 1")->fetchColumn();
$tAdmin = login_as($adminId);
$tStudent = login_as($studentId);

// Test files: a real tiny PNG, a PHP script, and a PHP script named like a picture.
$png = "$tmp/pic.png";
file_put_contents($png, base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='));
$php = "$tmp/evil.php";
file_put_contents($php, '<?php echo "RAN-" . (6*7);');
$fakeJpg = "$tmp/evil.jpg";
copy($php, $fakeJpg);
$name = 'storetest/' . time() . '-ok.png';
$planted = [];

try {
    echo "Serving files\n";
    $first = trim(explode("\n", shell_exec('cd ' . escapeshellarg($media) . ' && ls courses | head -1'))[0]);
    $r = get("/media/courses/$first");
    ok($r['status'] === 200 && strlen($r['body']) > 1000, 'a copied course picture loads');
    ok(stripos($r['headers'], 'nosniff') !== false && stripos($r['headers'], 'max-age=31536000') !== false, 'served with nosniff and a one-year cache');
    $r = get('/media/');
    ok($r['status'] === 403 || $r['status'] === 404, 'the folder cannot be listed');
    $r = get('/media/.htaccess');
    ok($r['status'] === 403 || $r['status'] === 404, 'the folder rules cannot be read');

    echo "Uploads\n";
    $r = upload($png, $name, null);
    ok($r['status'] === 401 || $r['status'] === 403, 'a visitor cannot upload', $r);
    $r = upload($png, $name, $tStudent);
    ok($r['status'] === 403, 'a student cannot upload', $r);
    $r = upload($png, $name, $tAdmin);
    ok($r['status'] === 200 && ($r['json']['path'] ?? '') === $name, 'an admin uploads a picture', $r);
    $planted[] = $name;
    $r = get("/media/$name");
    ok($r['status'] === 200 && stripos($r['headers'], 'image/png') !== false, 'the upload is served as a picture');
    $r = upload($png, $name, $tAdmin);
    ok($r['status'] === 409, 'an existing file is never overwritten');
    $r = upload($php, 'storetest/' . time() . '-evil.php', $tAdmin);
    ok($r['status'] === 415, 'a .php file is refused', $r);
    $r = upload($fakeJpg, 'storetest/' . time() . '-evil.jpg', $tAdmin);
    ok($r['status'] === 415, 'a script renamed to .jpg is refused (contents checked)', $r);
    $r = upload($png, 'storetest/' . time() . '-x.svg', $tAdmin);
    ok($r['status'] === 415, 'SVG (can carry scripts) is refused', $r);
    foreach (['../evil.png', 'storetest/../../evil.png', '/etc/evil.png', 'storetest/.hidden.png', 'a/b/c.png', 'storetest/ok.png%00.php'] as $bad) {
        $r = upload($png, $bad, $tAdmin);
        ok($r['status'] === 400, "path trick refused: $bad", $r);
    }
    $r = upload($png, 'storetest/' . time() . '-b.png', $tAdmin, 'other');
    ok($r['status'] === 404, 'only the media bucket exists');
    ok(!file_exists(dirname($media) . '/evil.png') && !file_exists(getenv('HOME') . '/evil.png'), 'nothing was written outside media/');

    echo "Nothing in media/ can run\n";
    // Planted directly (as if an upload check ever failed): must still never run or show its code.
    foreach (['php', 'phtml', 'php7', 'phar', 'html', 'js', 'svg'] as $ext) {
        $f = "storetest/planted.$ext";
        file_put_contents($media . $f, '<?php echo "RAN-" . (6*7); ?><script>x</script>');
        $planted[] = $f;
        $r = get("/media/$f");
        ok(!str_contains($r['body'], 'RAN-42') && $r['status'] >= 400, ".$ext file in media/ is refused, not run");
    }
    file_put_contents($media . 'storetest/.htaccess', "AddHandler application/x-httpd-php .png\n");
    $planted[] = 'storetest/.htaccess';
    file_put_contents($media . 'storetest/trick.png', '<?php echo "RAN-" . (6*7);');
    $planted[] = 'storetest/trick.png';
    $r = get('/media/storetest/trick.png');
    ok(!str_contains($r['body'], 'RAN-42'), 'a planted .htaccess cannot make a picture run as code (report only: needs file access first)');
} finally {
    foreach (array_reverse($planted) as $f) @unlink($media . $f);
    @rmdir($media . 'storetest');
    array_map('unlink', glob("$tmp/*"));
    @rmdir($tmp);
    $db->exec('DELETE FROM sessions WHERE token_hash IN (' . $db->quote(hash('sha256', $tAdmin)) . ',' . $db->quote(hash('sha256', $tStudent)) . ')');
    ok(!is_dir($media . 'storetest'), 'clean-up: test files removed');
}
echo $fails ? "\n$fails FAILED\n" : "\nall passed\n";
exit($fails ? 1 : 0);
