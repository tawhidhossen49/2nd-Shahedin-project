<?php
/**
 * Every request to api.shahedin.com arrives here (server/public/index.php).
 *
 *   POST /rest            the data API (rest.php)
 *   POST /rpc/<name>      database functions (rpc.php)
 *   POST /auth/otp        send an SMS login code
 *   POST /auth/verify     check it and log in
 *   POST /auth/token      admin email + password login
 *   GET  /auth/user       who am I        PUT /auth/user   change name / password
 *   POST /auth/logout     end this login
 *   GET  /auth/settings   which login methods are on
 *   GET  /auth/google     start Google login   GET /auth/google/callback  finish it
 *   POST /functions/bkash-payment | admin-users    GET /functions/bkash-callback  (functions.php)
 *   POST /storage/upload  an admin uploads a picture or file (storage.php)
 */
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';
require __DIR__ . '/auth.php';
require __DIR__ . '/policies.php';
require __DIR__ . '/rest.php';
require __DIR__ . '/rpc.php';

set_exception_handler(function (Throwable $e) {
    if ($e instanceof ApiError) send_error($e);
    if ($e instanceof PDOException) send_error(db_error($e));
    error_log('api: ' . get_class($e) . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    send_error(new ApiError('Something went wrong on the server.', 500, 'XX000'));
});

cors();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = rtrim(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/', '/') ?: '/';

if ($method === 'POST' && $path === '/rest') send_json(rest_handle(request_json()));
if ($method === 'POST' && preg_match('#^/rpc/([a-z_]+)$#', $path, $m)) send_json(rpc_handle($m[1], request_json()));
if ($method === 'POST' && $path === '/storage/upload') {
    require __DIR__ . '/storage.php';
    storage_upload();
}
if (preg_match('#^/functions/([a-z-]+)(?:/(\d{1,2}))?$#', $path, $m)) {
    require __DIR__ . '/functions.php';
    functions_handle($m[1], $m[2] ?? null);
}

switch ("$method $path") {
    case 'POST /auth/otp':        send_json(auth_send_otp(request_json()));
    case 'POST /auth/verify':     send_json(auth_verify_otp(request_json()));
    case 'POST /auth/token':      send_json(auth_password(request_json()));
    case 'GET /auth/user':        send_json(auth_get_user());
    case 'PUT /auth/user':        send_json(auth_update_user(request_json()));
    case 'POST /auth/logout':     send_json(auth_logout());
    case 'GET /auth/settings':
    case 'GET /auth/v1/settings': send_json(auth_settings());   // the old address js/auth.js asks
    case 'GET /auth/google':      auth_google_start();
    case 'GET /auth/google/callback': auth_google_callback();
    case 'GET /':                 send_json(['ok' => true, 'service' => 'shahedin-api']);
}

send_error(new ApiError('Not found', 404, 'PGRST000'));
