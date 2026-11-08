<?php
/**
 * Checks the live API on the server against the security rules, as three
 * people: a visitor, a student and a main admin. Run on the server:
 *
 *   php selftest.php
 *
 * It talks to the API through the server's own web server (its own address,
 * so nothing crosses the internet unencrypted), makes
 * temporary logins straight in the database, and removes them, and every
 * test change, when it finishes. Command line only.
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

$c = require getenv('HOME') . '/shahedin-private/db.php';
$db = new PDO("mysql:host={$c['host']};dbname={$c['name']};charset=utf8mb4", $c['user'], $c['pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$db->exec("SET time_zone = '+00:00'");

// The server's own address for api.shahedin.com: requests never leave this machine.
define('LOCAL', 'api.shahedin.com:443:' . gethostbyname('api.shahedin.com'));   // this server's shared address
$fails = 0;
function ok(bool $cond, string $what): void { global $fails; echo ($cond ? "  ok    " : "  FAIL  ") . "$what\n"; if (!$cond) $fails++; }

function api(string $method, string $path, $body = null, ?string $token = null): array
{
    $ch = curl_init("https://api.shahedin.com$path");
    curl_setopt($ch, CURLOPT_RESOLVE, [LOCAL]);
    $h = ['Content-Type: application/json', 'Origin: https://www.shahedin.com'];
    if ($token) $h[] = "Authorization: Bearer $token";
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $h, CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    $raw = (string)curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $hsize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    return ['status' => $status, 'headers' => substr($raw, 0, $hsize), 'json' => json_decode(substr($raw, $hsize), true)];
}
function rest(array $req, ?string $t = null): array { return api('POST', '/rest', $req, $t); }

// Temporary logins.
$tokens = [];
function login_as(string $userId): string
{
    global $db, $tokens;
    $t = bin2hex(random_bytes(24));
    $db->prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, UTC_TIMESTAMP() + INTERVAL 1 HOUR)')->execute([hash('sha256', $t), $userId]);
    $tokens[] = $t;
    return $t;
}

$main = $db->query("SELECT id FROM admins WHERE role = 'main' ORDER BY created_at LIMIT 1")->fetchColumn();
$studentRow = $db->query("SELECT e.user_id, e.course_id, e.id FROM enrollments e JOIN courses c ON c.id = e.course_id
                          WHERE c.is_free = 0 AND e.user_id NOT IN (SELECT id FROM admins) LIMIT 1")->fetch();
$student = $studentRow['user_id'];
$paidCourse = $studentRow['course_id'];
$admin = login_as($main);
$stu = login_as($student);
$courseBefore = $db->query("SELECT updated_at, title_bn FROM courses WHERE id = " . $db->quote($paidCourse))->fetch();

try {
    echo "Visitor (not logged in)\n";
    $r = api('GET', '/');
    ok($r['status'] === 200 && $r['json']['ok'] === true, 'API answers');
    ok(stripos($r['headers'], 'Access-Control-Allow-Origin: https://www.shahedin.com') !== false, 'the website is allowed to call it (CORS)');
    $r2 = (function () { $ch = curl_init('https://api.shahedin.com/'); curl_setopt_array($ch, [CURLOPT_RESOLVE => [LOCAL], CURLOPT_HTTPHEADER => ['Origin: https://evil.example'], CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true]); $raw = (string)curl_exec($ch); curl_close($ch); return $raw; })();
    ok(stripos($r2, 'Access-Control-Allow-Origin') === false && stripos($r2, '"ok":true') !== false, 'another website is not allowed (CORS)');

    $r = rest(['table' => 'courses_safe', 'method' => 'select', 'columns' => '*', 'order' => [['sort_order', true]]]);
    ok($r['status'] === 200 && count($r['json']['data']) >= 1, 'sees published courses');
    $paid = array_values(array_filter($r['json']['data'], fn($x) => $x['id'] === $paidCourse))[0] ?? null;
    $locked = $paid ? array_filter($paid['content_blocks'], fn($b) => empty($b['locked']) && !(($b['type'] ?? '') === 'video' && !empty($b['free_preview']))) : [1];
    ok($paid !== null && !$locked, 'paid lessons are locked (only free previews open)');
    ok(is_bool($paid['is_free'] ?? null) && is_string($paid['created_at'] ?? null) && str_ends_with($paid['created_at'], '+00:00'), 'true/false and dates come back as Supabase sent them');

    foreach (['courses', 'orders', 'profiles', 'admins', 'enrollments', 'contact_submissions', 'page_views', 'bkash_api_log', 'coupons', 'activity_log'] as $t) {
        $r = rest(['table' => $t, 'method' => 'select', 'columns' => '*']);
        ok($r['status'] === 200 && $r['json']['data'] === [], "cannot read $t");
    }
    $r = rest(['table' => 'site_settings', 'method' => 'select', 'columns' => 'key,value']);
    ok(count($r['json']['data'] ?? []) >= 1, 'can read site settings');
    $r = rest(['table' => 'users', 'method' => 'select']);
    ok($r['status'] === 404, 'the users table does not exist for the API');
    $r = rest(['table' => 'courses', 'method' => 'select', 'columns' => 'id,password_hash']);
    ok($r['status'] === 400, 'unknown column refused');
    $r = rest(['table' => 'courses_safe', 'method' => 'select', 'filters' => [['slug', 'eq', "x' OR '1'='1"]]]);
    ok($r['status'] === 200 && $r['json']['data'] === [], 'SQL injection in a value does nothing');
    $r = rest(['table' => 'courses_safe', 'method' => 'select', 'order' => [['sort_order; DROP TABLE x', true]]]);
    ok($r['status'] === 400, 'SQL injection in a column name refused');

    $r = rest(['table' => 'page_views', 'method' => 'insert', 'values' => ['page_path' => 'selftest.html', 'lang' => 'bn']]);
    ok($r['status'] === 200, 'can record a page view');
    $r = rest(['table' => 'page_views', 'method' => 'insert', 'values' => ['page_path' => 'selftest.html', 'id' => 1]]);
    ok($r['status'] === 403, 'cannot set other page-view fields');
    $r = rest(['table' => 'courses', 'method' => 'update', 'values' => ['title_bn' => 'hacked'], 'filters' => [['id', 'eq', $paidCourse]]]);
    $title = $db->query("SELECT title_bn FROM courses WHERE id = " . $db->quote($paidCourse))->fetchColumn();
    ok($title === $courseBefore['title_bn'], 'cannot change a course');
    $r = rest(['table' => 'courses', 'method' => 'delete', 'filters' => [['id', 'eq', $paidCourse]]]);
    ok((bool)$db->query("SELECT 1 FROM courses WHERE id = " . $db->quote($paidCourse))->fetchColumn(), 'cannot delete a course');
    $r = rest(['table' => 'enrollments', 'method' => 'insert', 'values' => ['user_id' => $student, 'course_id' => $paidCourse]]);
    ok($r['status'] === 403, 'cannot enrol someone without logging in');
    $r = api('POST', '/rpc/validate_coupon', ['p_code' => 'NO-SUCH-CODE', 'p_subtotal' => 1000, 'p_kind' => 'course']);
    ok(($r['json']['valid'] ?? null) === false && ($r['json']['reason'] ?? '') === 'not_found', 'coupon check works');
    $r = api('POST', '/rpc/admin_remove', ['p_admin_id' => $main]);
    ok($r['status'] === 403, 'cannot remove an admin');
    $r = api('GET', '/auth/user');
    ok($r['status'] === 401, 'not logged in = no user');
    $r = api('GET', '/auth/user', null, str_repeat('a', 43));
    ok($r['status'] === 401, 'a made-up token is refused');

    echo "Password login (a throwaway test account)\n";
    $tmpId = bin2hex(random_bytes(4)) . '-0000-4000-8000-' . bin2hex(random_bytes(6));
    $db->prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)')->execute([$tmpId, 'selftest@example.invalid', password_hash('selftest-pass-123', PASSWORD_BCRYPT)]);
    $r = api('POST', '/auth/token', ['email' => 'selftest@example.invalid', 'password' => 'wrong-password']);
    ok($r['status'] === 400 && ($r['json']['code'] ?? '') === 'invalid_credentials', 'wrong password refused');
    $r = api('POST', '/auth/token', ['email' => 'SelfTest@example.invalid', 'password' => 'selftest-pass-123']);
    $tmpToken = $r['json']['access_token'] ?? '';
    ok($r['status'] === 200 && strlen($tmpToken) >= 40 && ($r['json']['user']['id'] ?? '') === $tmpId, 'right password logs in (email in any case)');
    ok(!array_key_exists('password_hash', $r['json']['user'] ?? []), 'the password hash is never sent out');
    ok((bool)$db->query("SELECT 1 FROM profiles WHERE id = " . $db->quote($tmpId))->fetchColumn(), 'a new account gets a profile (trigger)');
    $r = api('POST', '/auth/logout', null, $tmpToken);
    $r = api('GET', '/auth/user', null, $tmpToken);
    ok($r['status'] === 401, 'after logging out the token no longer works');
    $db->prepare('DELETE FROM users WHERE id = ?')->execute([$tmpId]);
    $db->exec("DELETE FROM auth_failures WHERE scope = 'email:selftest@example.invalid' OR (scope LIKE 'ip:%' AND failed_at > UTC_TIMESTAMP() - INTERVAL 5 MINUTE)");

    echo "Student\n";
    $r = api('GET', '/auth/user', null, $stu);
    ok(($r['json']['id'] ?? '') === $student, 'logged in as the student');
    $r = rest(['table' => 'enrollments', 'method' => 'select', 'columns' => '*'], $stu);
    ok(count($r['json']['data']) >= 1 && !array_filter($r['json']['data'], fn($e) => $e['user_id'] !== $student), 'sees only their own enrolments');
    $r = rest(['table' => 'orders', 'method' => 'select', 'columns' => 'user_id'], $stu);
    ok(!array_filter($r['json']['data'], fn($o) => $o['user_id'] !== $student), 'sees only their own orders');
    $r = rest(['table' => 'courses_safe', 'method' => 'select', 'filters' => [['id', 'eq', $paidCourse]], 'single' => 'single'], $stu);
    ok($r['status'] === 200 && !array_filter($r['json']['data']['content_blocks'], fn($b) => !empty($b['locked'])), 'their paid course is fully open');
    $r = rest(['table' => 'enrollments', 'method' => 'select', 'columns' => 'id, courses(title_bn)'], $stu);
    ok(array_key_exists('courses', $r['json']['data'][0] ?? []) && $r['json']['data'][0]['courses'] === null, 'joined course title hidden from a student, as in Supabase');
    $other = $db->query("SELECT id FROM courses WHERE id <> " . $db->quote($paidCourse) . " LIMIT 1")->fetchColumn();
    if ($other) {
        $r = rest(['table' => 'enrollments', 'method' => 'update', 'values' => ['course_id' => $other], 'filters' => [['id', 'eq', $studentRow['id']]]], $stu);
        ok($r['status'] === 403, 'cannot switch their enrolment to another course (the gap Supabase had)');
    }
    $before = $db->query("SELECT completed_blocks FROM enrollments WHERE id = " . $db->quote($studentRow['id']))->fetchColumn();
    $r = rest(['table' => 'enrollments', 'method' => 'update', 'values' => ['completed_blocks' => ['selftest']], 'filters' => [['id', 'eq', $studentRow['id']]], 'returning' => true], $stu);
    ok($r['status'] === 200 && ($r['json']['data'][0]['completed_blocks'] ?? null) === ['selftest'], 'can save their own progress');
    $db->prepare('UPDATE enrollments SET completed_blocks = ? WHERE id = ?')->execute([$before, $studentRow['id']]);
    $r = rest(['table' => 'profiles', 'method' => 'update', 'values' => ['full_name' => 'x'], 'filters' => [['id', 'eq', $student]]], $stu);
    ok($r['status'] === 403, 'cannot rename themselves through the profile (name follows the login)');
    $r = rest(['table' => 'orders', 'method' => 'update', 'values' => ['status' => 'completed'], 'filters' => [['user_id', 'eq', $student]]], $stu);
    ok($r['status'] === 403, 'cannot mark their own order as paid');
    $r = rest(['table' => 'courses', 'method' => 'select', 'columns' => 'id'], $stu);
    ok($r['json']['data'] === [], 'cannot read the raw course table');

    echo "Main admin\n";
    $r = rest(['table' => 'orders', 'method' => 'select', 'columns' => '*', 'count' => 'exact', 'head' => true], $admin);
    ok(($r['json']['count'] ?? 0) === (int)$db->query('SELECT COUNT(*) FROM orders')->fetchColumn(), 'counts every order');
    $r = rest(['table' => 'orders', 'method' => 'select', 'columns' => 'id', 'offset' => 0, 'limit' => 5000], $admin);
    ok(count($r['json']['data']) <= 1000, 'one request returns at most 1000 rows, like Supabase');
    $r = rest(['table' => 'admins', 'method' => 'select', 'columns' => 'id,email,role,permissions'], $admin);
    ok(count($r['json']['data']) === (int)$db->query('SELECT COUNT(*) FROM admins')->fetchColumn() && is_array($r['json']['data'][0]['permissions']), 'sees every admin, permissions as a list');
    $r = rest(['table' => 'enrollments', 'method' => 'select', 'columns' => 'id, courses(title_bn)', 'limit' => 1], $admin);
    ok(is_array($r['json']['data'][0]['courses'] ?? null), 'joined course title shown to an admin');
    $val = $db->query("SELECT value FROM site_settings WHERE `key` = 'meta_pixel'")->fetchColumn();
    $r = rest(['table' => 'site_settings', 'method' => 'upsert', 'values' => ['key' => 'meta_pixel', 'value' => json_decode($val)]], $admin);
    ok($r['status'] === 200 && $db->query("SELECT value FROM site_settings WHERE `key` = 'meta_pixel'")->fetchColumn() === $val, 'can save a setting (same value written back)');
    $r = rest(['table' => 'courses', 'method' => 'update', 'values' => ['title_bn' => $courseBefore['title_bn']], 'filters' => [['id', 'eq', $paidCourse]], 'returning' => true], $admin);
    ok($r['status'] === 200 && count($r['json']['data']) === 1, 'can save a course');
    $logged = $db->query("SELECT COUNT(*) FROM activity_log WHERE record_id = " . $db->quote($paidCourse) . " AND changed_by = " . $db->quote($main) . " AND created_at > UTC_TIMESTAMP() - INTERVAL 1 MINUTE")->fetchColumn();
    ok($logged >= 1, 'the change is in the activity log');
    $r = rest(['table' => 'courses', 'method' => 'update', 'values' => ['no_such_column' => 1], 'filters' => [['id', 'eq', $paidCourse]]], $admin);
    ok($r['status'] === 400 && ($r['json']['code'] ?? '') === 'PGRST204' && str_contains($r['json']['message'], 'no_such_column'), 'unknown column reported the way the course editor expects');
    $r = rest(['table' => 'courses', 'method' => 'delete', 'filters' => []], $admin);
    ok($r['status'] === 400, 'a delete with no filter is refused');
    $r = api('POST', '/rpc/admin_remove', ['p_admin_id' => $main], $admin);
    ok($r['status'] === 400, 'cannot remove themselves');
} finally {
    // Undo every test change and end the temporary logins.
    foreach ($tokens as $t) $db->prepare('DELETE FROM sessions WHERE token_hash = ?')->execute([hash('sha256', $t)]);
    $db->exec("DELETE FROM page_views WHERE page_path = 'selftest.html'");
    $db->prepare("DELETE FROM activity_log WHERE record_id = ? AND changed_by = ? AND created_at > UTC_TIMESTAMP() - INTERVAL 5 MINUTE")->execute([$paidCourse, $main]);
    $db->prepare('UPDATE courses SET title_bn = ?, updated_at = ? WHERE id = ?')->execute([$courseBefore['title_bn'], $courseBefore['updated_at'], $paidCourse]);
}
echo $fails ? "\n$fails FAILED\n" : "\nall passed\n";
exit($fails ? 1 : 0);
