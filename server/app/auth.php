<?php
/**
 * Logins. Replaces Supabase Auth:
 *   - phone + SMS code (students), sent through BulkSMSBD
 *   - email + password (admins; the bcrypt hashes copied from Supabase still work)
 *   - Google
 *
 * A login gives the browser a random token. Only its sha256 is stored, so a
 * copy of the database cannot be used to log in as anyone.
 */
declare(strict_types=1);

const SESSION_DAYS = 30;
const OTP_MINUTES = 5;
const OTP_MAX_TRIES = 5;

final class Ctx
{
    /** @param array|null $admin the admins row, or null */
    public function __construct(public ?array $user = null, public ?array $admin = null) {}

    public function uid(): ?string { return $this->user['id'] ?? null; }
    public function isAdmin(): bool { return $this->admin !== null; }
    public function isMain(): bool { return ($this->admin['role'] ?? '') === 'main'; }

    /** Supabase's admin_can(page): a main admin may do everything, a partial admin only their pages. */
    public function can(string $page): bool
    {
        if (!$this->admin) return false;
        return $this->isMain() || in_array($page, $this->admin['permissions'], true);
    }
}

/** Who is calling, from the "Authorization: Bearer <token>" header. */
function current_ctx(): Ctx
{
    static $ctx = null;
    if ($ctx) return $ctx;
    $token = bearer_token();
    if ($token === null) return $ctx = new Ctx();

    $row = q('SELECT s.user_id, s.last_used_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id
              WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP(6)', [hash('sha256', $token)])->fetch();
    // A token that was sent but is unknown or expired is an error, not a visitor:
    // the browser then drops it and the page shows the person as logged out.
    if (!$row) throw new ApiError('Invalid or expired session', 401, 'bad_jwt');

    // Note when a session was last used, at most once an hour, and keep it alive.
    if ($row['last_used_at'] === null || strtotime($row['last_used_at'] . ' UTC') < time() - 3600) {
        q('UPDATE sessions SET last_used_at = UTC_TIMESTAMP(6), expires_at = UTC_TIMESTAMP(6) + INTERVAL ? DAY WHERE token_hash = ?',
          [SESSION_DAYS, hash('sha256', $token)]);
    }
    unset($row['user_id'], $row['last_used_at']);
    $admin = q('SELECT * FROM admins WHERE id = ?', [$row['id']])->fetch() ?: null;
    if ($admin) $admin['permissions'] = json_decode($admin['permissions'], true) ?: [];

    // Database triggers read these to know who is making a change.
    q('SET @app_user_id = ?, @app_is_admin = ?', [$row['id'], $admin ? 1 : 0]);
    return $ctx = new Ctx($row, $admin);
}

function bearer_token(): ?string
{
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (!preg_match('/^Bearer\s+([A-Za-z0-9_-]{40,})$/', trim($h), $m)) return null;
    return $m[1];
}

/** The user object the website reads (same fields as Supabase's). */
function public_user(array $u): array
{
    return [
        'id' => $u['id'],
        'aud' => 'authenticated',
        'role' => 'authenticated',
        'email' => $u['email'] ?? '',
        'phone' => $u['phone'] ?? '',
        'user_metadata' => json_decode((string)($u['user_metadata'] ?? '{}')) ?: new stdClass(),
        'app_metadata' => new stdClass(),
        'phone_confirmed_at' => iso($u['phone_confirmed_at'] ?? null),
        'email_confirmed_at' => iso($u['email_confirmed_at'] ?? null),
        'last_sign_in_at' => iso($u['last_sign_in_at'] ?? null),
        'created_at' => iso($u['created_at'] ?? null),
        'updated_at' => iso($u['updated_at'] ?? null),
    ];
}

function iso(?string $mysqlUtc): ?string
{
    if ($mysqlUtc === null || $mysqlUtc === '') return null;
    return str_replace(' ', 'T', $mysqlUtc) . '+00:00';
}

/** Log a user in: a new session, and the reply the website stores. */
function start_session(string $userId): array
{
    $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    q('INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES (?, ?, UTC_TIMESTAMP(6) + INTERVAL ? DAY, ?)',
      [hash('sha256', $token), $userId, SESSION_DAYS, substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255)]);
    q('UPDATE users SET last_sign_in_at = UTC_TIMESTAMP(6) WHERE id = ?', [$userId]);
    // Old expired sessions are tidied up now and then rather than by a cron job.
    if (random_int(1, 50) === 1) q('DELETE FROM sessions WHERE expires_at < UTC_TIMESTAMP(6)');
    $user = q('SELECT * FROM users WHERE id = ?', [$userId])->fetch();
    return [
        'access_token' => $token,
        'token_type' => 'bearer',
        'expires_in' => SESSION_DAYS * 86400,
        'expires_at' => time() + SESSION_DAYS * 86400,
        'user' => public_user($user),
    ];
}

/* ---------------- phone + SMS code ---------------- */

/** "+8801712345678", "01712345678" ... -> "8801712345678" (how Supabase stored phones). */
function normalize_phone(string $raw): ?string
{
    $d = preg_replace('/\D/', '', $raw);
    if (str_starts_with($d, '880')) $d = substr($d, 3);
    if (str_starts_with($d, '0')) $d = substr($d, 1);
    return preg_match('/^1[3-9]\d{8}$/', $d) ? '880' . $d : null;
}

function otp_hash(string $phone, string $code): string
{
    return hash_hmac('sha256', "$phone|$code", config('app_secret'));
}

function auth_send_otp(stdClass $b): array
{
    $phone = normalize_phone((string)($b->phone ?? ''));
    if (!$phone) throw new ApiError('Invalid phone number format', 400, 'validation_failed');

    // Limits, so nobody can use the form to burn the SMS balance:
    // one code per number every 30 seconds, 5 an hour; 20 an hour per address.
    $recent = q('SELECT
        SUM(sent_at > UTC_TIMESTAMP(6) - INTERVAL 30 SECOND AND phone = ?) AS last30,
        SUM(sent_at > UTC_TIMESTAMP(6) - INTERVAL 1 HOUR AND phone = ?) AS phoneHour,
        SUM(sent_at > UTC_TIMESTAMP(6) - INTERVAL 1 HOUR AND ip = ?) AS ipHour
        FROM otp_sends WHERE sent_at > UTC_TIMESTAMP(6) - INTERVAL 1 HOUR', [$phone, $phone, client_ip()])->fetch();
    if ((int)$recent['last30'] > 0 || (int)$recent['phoneHour'] >= 5 || (int)$recent['ipHour'] >= 20) {
        throw new ApiError('For security purposes, you can only request this after some time. Too many requests, rate limit exceeded.', 429, 'over_sms_send_rate_limit');
    }

    $code = sprintf('%06d', random_int(0, 999999));
    $name = isset($b->options->data->full_name) ? trim((string)$b->options->data->full_name) : null;
    q('REPLACE INTO otp_codes (phone, code_hash, full_name, attempts, sent_at, expires_at)
       VALUES (?, ?, ?, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) + INTERVAL ? MINUTE)',
      [$phone, otp_hash($phone, $code), $name ?: null, OTP_MINUTES]);
    q('INSERT INTO otp_sends (phone, ip) VALUES (?, ?)', [$phone, client_ip()]);

    send_sms($phone, "Shahedin OTP: $code\nকোডটি কারও সাথে শেয়ার করবেন না।");
    return [];
}

/** BulkSMSBD. Code 202 is the only "sent"; anything else is a failure the visitor must hear about. */
function send_sms(string $number, string $message): void
{
    $sms = config('bulksmsbd');
    if (empty($sms['api_key']) || empty($sms['sender_id'])) {
        error_log('send_sms: BulkSMSBD is not configured');
        throw new ApiError('Error sending sms: provider is not configured', 500, 'sms_send_failed');
    }
    $ch = curl_init('https://bulksmsbd.net/api/smsapi');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query(['api_key' => $sms['api_key'], 'senderid' => $sms['sender_id'], 'number' => $number, 'message' => $message]),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
    ]);
    $raw = (string)curl_exec($ch);
    $http = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $parsed = json_decode($raw, true);
    $code = is_array($parsed) ? (int)($parsed['response_code'] ?? 0) : (int)(preg_match('/\d{3,4}/', $raw, $m) ? $m[0] : 0);
    if ($code !== 202) {
        // BulkSMSBD's reply holds no code and no key, and it is the only way to tell
        // "no balance" from "sender id disabled" from "address not whitelisted".
        error_log("send_sms: BulkSMSBD rejected the message. HTTP $http, code $code, raw: " . substr($raw, 0, 300));
        throw new ApiError('Error sending sms: the SMS provider did not accept the message', 502, 'sms_send_failed');
    }
}

function auth_verify_otp(stdClass $b): array
{
    $phone = normalize_phone((string)($b->phone ?? ''));
    $code = preg_replace('/\D/', '', (string)($b->token ?? ''));
    if (!$phone || strlen($code) !== 6) throw new ApiError('Token has expired or is invalid', 403, 'otp_expired');

    $row = q('SELECT * FROM otp_codes WHERE phone = ?', [$phone])->fetch();
    if (!$row || strtotime($row['expires_at'] . ' UTC') < time() || (int)$row['attempts'] >= OTP_MAX_TRIES) {
        throw new ApiError('Token has expired or is invalid', 403, 'otp_expired');
    }
    if (!hash_equals($row['code_hash'], otp_hash($phone, $code))) {
        q('UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = ?', [$phone]);
        throw new ApiError('Token has expired or is invalid', 403, 'otp_expired');
    }
    q('DELETE FROM otp_codes WHERE phone = ?', [$phone]);

    $user = q('SELECT id FROM users WHERE phone = ?', [$phone])->fetch();
    if ($user) {
        q('UPDATE users SET phone_confirmed_at = COALESCE(phone_confirmed_at, UTC_TIMESTAMP(6)) WHERE id = ?', [$user['id']]);
        $id = $user['id'];
    } else {
        $id = uuid4();
        $meta = $row['full_name'] ? ['full_name' => $row['full_name']] : new stdClass();
        q('INSERT INTO users (id, phone, user_metadata, phone_confirmed_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6))',
          [$id, $phone, json_encode($meta, JSON_UNESCAPED_UNICODE)]);
    }
    return start_session($id);
}

/* ---------------- email + password (admin panel) ---------------- */

function auth_password(stdClass $b): array
{
    $email = strtolower(trim((string)($b->email ?? '')));
    $password = (string)($b->password ?? '');
    $ip = client_ip();

    // 10 failures in 15 minutes from one address, or against one email, locks it for a while.
    $fails = q("SELECT
        SUM(scope = ?) AS ip, SUM(scope = ?) AS email
        FROM auth_failures WHERE failed_at > UTC_TIMESTAMP(6) - INTERVAL 15 MINUTE", ["ip:$ip", "email:$email"])->fetch();
    if ((int)$fails['ip'] >= 10 || (int)$fails['email'] >= 10) {
        throw new ApiError('Too many login attempts. Please wait 15 minutes and try again.', 429, 'over_request_rate_limit');
    }

    $user = $email !== '' ? q('SELECT id, password_hash FROM users WHERE email = ?', [$email])->fetch() : false;
    // Checked even when there is no such user, so the reply takes the same time either way.
    $hash = $user['password_hash'] ?? '$2y$10$abcdefghijklmnopqrstuuJ5tdEw0d3oZfHk6b9jWdP0pK1G0q8xK';
    if (!password_verify($password, $hash) || !$user) {
        q('INSERT INTO auth_failures (scope) VALUES (?), (?)', ["ip:$ip", "email:$email"]);
        throw new ApiError('Invalid login credentials', 400, 'invalid_credentials');
    }
    return start_session($user['id']);
}

/* ---------------- the logged-in user ---------------- */

function auth_get_user(): array
{
    $ctx = current_ctx();
    if (!$ctx->user) throw new ApiError('Invalid or expired session', 401, 'bad_jwt');
    return public_user($ctx->user);
}

/** auth.updateUser({ data, password }) */
function auth_update_user(stdClass $b): array
{
    $ctx = current_ctx();
    if (!$ctx->user) throw new ApiError('Invalid or expired session', 401, 'bad_jwt');
    if (isset($b->data) && $b->data instanceof stdClass) {
        $meta = json_decode((string)$ctx->user['user_metadata']) ?: new stdClass();
        foreach ($b->data as $k => $v) $meta->$k = $v;
        q('UPDATE users SET user_metadata = ? WHERE id = ?', [json_encode($meta, JSON_UNESCAPED_UNICODE), $ctx->uid()]);
    }
    if (isset($b->password)) {
        $pw = (string)$b->password;
        if (strlen($pw) < 8) throw new ApiError('Password should be at least 8 characters.', 422, 'weak_password');
        q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($pw, PASSWORD_BCRYPT), $ctx->uid()]);
        // Every other login of this account is ended; this one stays.
        q('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [$ctx->uid(), hash('sha256', (string)bearer_token())]);
    }
    return public_user(q('SELECT * FROM users WHERE id = ?', [$ctx->uid()])->fetch());
}

/** signOut(): ends this login only. */
function auth_logout(): array
{
    $t = bearer_token();
    if ($t !== null) q('DELETE FROM sessions WHERE token_hash = ?', [hash('sha256', $t)]);
    return [];
}

function auth_settings(): array
{
    $g = config('google');
    return ['external' => ['phone' => true, 'email' => true, 'google' => !empty($g['client_id']) && !empty($g['client_secret'])]];
}

/* ---------------- Google ---------------- */

/** Only back to the website's own pages, never to an address someone slipped in. */
function safe_redirect(string $url): string
{
    $parts = parse_url($url);
    $origin = isset($parts['scheme'], $parts['host']) ? $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '') : '';
    return in_array($origin, config('allowed_origins'), true) ? $url : config('allowed_origins')[0] . '/';
}

function signed(string $data): string
{
    return $data . '.' . hash_hmac('sha256', $data, config('app_secret'));
}

function unsigned(string $value): ?string
{
    $i = strrpos($value, '.');
    if ($i === false) return null;
    $data = substr($value, 0, $i);
    return hash_equals(hash_hmac('sha256', $data, config('app_secret')), substr($value, $i + 1)) ? $data : null;
}

function auth_google_start(): never
{
    $g = config('google');
    if (empty($g['client_id'])) throw new ApiError('Google sign-in is not switched on.', 400, 'provider_disabled');
    $redirect = safe_redirect((string)($_GET['redirect_to'] ?? ''));
    $state = bin2hex(random_bytes(16));
    // The state travels in a signed cookie, so the reply from Google can only finish a login this browser started.
    setcookie('g_state', signed(base64_encode(json_encode(['s' => $state, 'r' => $redirect, 't' => time()]))), [
        'expires' => time() + 600, 'path' => '/auth/google', 'secure' => true, 'httponly' => true, 'samesite' => 'Lax',
    ]);
    header('Location: https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query([
        'client_id' => $g['client_id'],
        'redirect_uri' => config('api_url') . '/auth/google/callback',
        'response_type' => 'code',
        'scope' => 'openid email profile',
        'state' => $state,
        'prompt' => 'select_account',
    ]));
    exit;
}

function auth_google_callback(): never
{
    $g = config('google');
    $cookie = unsigned((string)($_COOKIE['g_state'] ?? ''));
    $saved = $cookie ? json_decode(base64_decode($cookie), true) : null;
    setcookie('g_state', '', ['expires' => 1, 'path' => '/auth/google', 'secure' => true, 'httponly' => true, 'samesite' => 'Lax']);
    $back = $saved['r'] ?? config('allowed_origins')[0] . '/';
    $fail = function (string $why) use ($back): never {
        error_log("google login: $why");
        header('Location: ' . strtok($back, '#') . '#error=google_login_failed');
        exit;
    };
    if (!$saved || !hash_equals((string)$saved['s'], (string)($_GET['state'] ?? '')) || time() - (int)$saved['t'] > 600) $fail('state mismatch');
    if (empty($_GET['code'])) $fail('no code (' . substr((string)($_GET['error'] ?? ''), 0, 50) . ')');

    $ch = curl_init('https://oauth2.googleapis.com/token');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query([
            'code' => $_GET['code'], 'client_id' => $g['client_id'], 'client_secret' => $g['client_secret'],
            'redirect_uri' => config('api_url') . '/auth/google/callback', 'grant_type' => 'authorization_code',
        ]),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
    ]);
    $tok = json_decode((string)curl_exec($ch), true);
    curl_close($ch);
    // The id_token came straight from Google over HTTPS in exchange for our secret,
    // so its contents can be trusted without checking the signature (OpenID Connect 3.1.3.7).
    $parts = explode('.', (string)($tok['id_token'] ?? ''));
    $claims = count($parts) === 3 ? json_decode(base64_decode(strtr($parts[1], '-_', '+/')), true) : null;
    if (!$claims || ($claims['aud'] ?? '') !== $g['client_id'] || !in_array($claims['iss'] ?? '', ['https://accounts.google.com', 'accounts.google.com'], true)) $fail('bad id_token');

    $sub = (string)$claims['sub'];
    $email = strtolower((string)($claims['email'] ?? ''));
    $verified = !empty($claims['email_verified']);
    $user = q('SELECT id FROM users WHERE google_sub = ?', [$sub])->fetch();
    if (!$user && $email !== '' && $verified) {
        // Same person, already known by email: link Google to that account.
        $user = q('SELECT id FROM users WHERE email = ?', [$email])->fetch();
        if ($user) q('UPDATE users SET google_sub = ? WHERE id = ?', [$sub, $user['id']]);
    }
    if ($user) {
        $id = $user['id'];
    } else {
        $id = uuid4();
        $meta = ['full_name' => $claims['name'] ?? '', 'name' => $claims['name'] ?? '', 'avatar_url' => $claims['picture'] ?? '', 'email' => $email, 'email_verified' => $verified];
        q('INSERT INTO users (id, email, google_sub, user_metadata, email_confirmed_at) VALUES (?, ?, ?, ?, ?)',
          [$id, $email ?: null, $sub, json_encode($meta, JSON_UNESCAPED_UNICODE), $verified ? now_utc() : null]);
    }
    $s = start_session($id);
    // The token goes in the #fragment: browsers never send that part to any server or log.
    header('Location: ' . strtok($back, '#') . '#' . http_build_query([
        'access_token' => $s['access_token'], 'expires_at' => $s['expires_at'], 'token_type' => 'bearer', 'type' => 'google',
    ]));
    exit;
}
