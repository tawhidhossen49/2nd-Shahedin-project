<?php
/**
 * Shared foundation for the Shahedin API: settings, the database connection,
 * JSON replies and errors in the shape the website's scripts already expect
 * from Supabase ({ message, code, details, hint }).
 *
 * Layout on the server:
 *   ~/shahedin-app/        this folder (server/app). Not reachable from the web.
 *   ~/shahedin-private/    config.php with passwords and keys. Never in git.
 *   ~/api.shahedin.com/    server/public: only index.php, .htaccess and media/.
 */
declare(strict_types=1);

const APP_DIR = __DIR__;
define('PRIVATE_DIR', dirname(__DIR__) . '/shahedin-private');

final class ApiError extends Exception
{
    public function __construct(string $message, public int $status = 400, public string $codeName = '', public ?string $details = null)
    {
        parent::__construct($message);
    }
}

function config(?string $key = null)
{
    static $cfg = null;
    if ($cfg === null) {
        $cfg = require PRIVATE_DIR . '/config.php';
        $cfg['db'] = $cfg['db'] ?? require PRIVATE_DIR . '/db.php';
    }
    return $key === null ? $cfg : ($cfg[$key] ?? null);
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $c = config('db');
        $pdo = new PDO("mysql:host={$c['host']};dbname={$c['name']};charset=utf8mb4", $c['user'], $c['pass'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,   // real prepared statements, native int types back
            PDO::ATTR_STRINGIFY_FETCHES => false,
        ]);
        $pdo->exec("SET time_zone = '+00:00'");
    }
    return $pdo;
}

/** Run a query with parameters and return the statement. */
function q(string $sql, array $params = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute(array_values($params));
    return $st;
}

function now_utc(): string
{
    return gmdate('Y-m-d H:i:s') . '.' . sprintf('%06d', (int)(fmod(microtime(true), 1) * 1e6));
}

function uuid4(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
}

function client_ip(): string
{
    return substr((string)($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45);
}

/** The request body as JSON. Objects stay objects, so {} is never turned into []. */
function request_json(): stdClass
{
    static $body = null;
    if ($body === null) {
        $raw = file_get_contents('php://input') ?: '';
        if ($raw === '') return $body = new stdClass();
        $body = json_decode($raw, false, 64);
        if (!$body instanceof stdClass) throw new ApiError('The request body must be a JSON object.', 400, 'PGRST102');
    }
    return $body;
}

function send_json($data, int $status = 200, array $headers = []): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    foreach ($headers as $k => $v) header("$k: $v");
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
    exit;
}

function send_error(ApiError $e): never
{
    send_json(['message' => $e->getMessage(), 'code' => $e->codeName, 'details' => $e->details, 'hint' => null], $e->status);
}

/**
 * Database errors in Postgres's codes, because the website checks for them:
 * 23505 = that value is already taken, 23503 = still in use / missing parent,
 * 23514 = a value outside the allowed range, 42703 = no such column.
 */
function db_error(PDOException $e): ApiError
{
    $mysql = (int)($e->errorInfo[1] ?? 0);
    return match ($mysql) {
        1062 => new ApiError('duplicate key value violates unique constraint', 409, '23505', $e->errorInfo[2] ?? null),
        1451, 1452 => new ApiError('violates foreign key constraint', 409, '23503'),
        4025, 3819 => new ApiError('new row violates check constraint', 400, '23514'),
        1054 => new ApiError('column does not exist', 400, '42703'),
        1048 => new ApiError('null value violates not-null constraint', 400, '23502'),
        1406 => new ApiError('value too long for column', 400, '22001'),
        default => new ApiError('Database error.', 500, 'XX000'),
    };
}

/** CORS: only the website's own addresses may call the API from a browser. */
function cors(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '' && in_array($origin, config('allowed_origins'), true)) {
        header("Access-Control-Allow-Origin: $origin");
        header('Vary: Origin');
        header('Access-Control-Allow-Headers: authorization, content-type, apikey, x-client-info, prefer, x-meta-test-code');
        header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
        header('Access-Control-Max-Age: 86400');
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}
