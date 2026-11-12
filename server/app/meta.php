<?php
/**
 * Meta (Facebook) Conversions API: the server half of the Pixel.
 *
 * The browser Pixel (js/meta-pixel.js) and this file report the same three events
 * with the same event_id, so Meta keeps one copy and an ad blocker cannot hide them:
 *
 *   InitiateCheckout      ic_<random>     the "কিনুন" click   (POST /functions/meta-event)
 *   CompleteRegistration  reg_<user id>   a new account       (auth.php)
 *   Purchase              order_<id>      bKash confirmed      (functions.php settle_order)
 *
 * Customer details go SHA-256 hashed (em, ph, fn, ln, external_id); the _fbp/_fbc
 * cookies, IP and browser go as they are, as Meta's rules require.
 *
 * Pixel id + on/off: site_settings "meta_pixel" (Admin -> Facebook ads).
 * Access token: config.php 'meta' => ['capi_token' => ...], never in the database or a browser.
 *
 * Nothing here may break a page or a payment: every event is sent after the reply
 * has gone out, with a 6-second limit, and every error is swallowed.
 */
declare(strict_types=1);

const META_GRAPH = 'https://graph.facebook.com/v25.0';

function meta_settings(): array
{
    $v = json_decode((string)q("SELECT value FROM site_settings WHERE `key` = 'meta_pixel'")->fetchColumn(), true) ?: [];
    $pixel = trim((string)($v['pixel_id'] ?? ''));
    $account = trim(preg_replace('/^act_/', '', (string)($v['ad_account_id'] ?? '')));
    return [
        'enabled' => ($v['enabled'] ?? false) === true && (bool)preg_match('/^\d{6,20}$/', $pixel),
        'pixel_id' => $pixel,
        'token' => trim((string)(config('meta')['capi_token'] ?? '')),
        'ad_account_id' => preg_match('/^\d{5,25}$/', $account) ? $account : '',
    ];
}

/** Meta's phone rule: digits only, country code included; 01XXXXXXXXX becomes 8801XXXXXXXXX. */
function meta_phone(?string $raw): string
{
    $d = ltrim(preg_replace('/\D/', '', (string)$raw), '0');
    if (preg_match('/^1\d{9}$/', $d)) $d = '880' . $d;
    return strlen($d) >= 8 ? $d : '';
}

/** A _fbp / _fbc value as the Pixel writes it ("fb.1.<ms>.<id>"), or null. */
function meta_cookie(?string $v): ?string
{
    $v = trim((string)$v);
    return preg_match('/^fb\.[0-9]\.\d{10,13}\.[A-Za-z0-9_.\-]{1,200}$/', $v) ? $v : null;
}

/** "Kamrul Hasan Shahedin" -> ['kamrul', 'shahedin']: lower case, letters only (any script). */
function meta_name_parts(?string $full): array
{
    $clean = trim(preg_replace('/[^\p{L}\p{M}\s]+/u', '', mb_strtolower((string)$full, 'UTF-8')));
    $parts = $clean === '' ? [] : preg_split('/\s+/u', $clean);
    return [$parts[0] ?? '', count($parts) > 1 ? end($parts) : ''];
}

/**
 * user_data for one event. $u: email, phone, name, external_id (hashed here),
 * fbp, fbc, ip, ua (sent as they are).
 */
function meta_user_data(array $u): array
{
    $h = fn(string $x) => [hash('sha256', $x)];
    $out = [];
    $email = strtolower(trim((string)($u['email'] ?? '')));
    if (preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/', $email)) $out['em'] = $h($email);
    if ($p = meta_phone($u['phone'] ?? null)) $out['ph'] = $h($p);
    [$fn, $ln] = meta_name_parts($u['name'] ?? null);
    if ($fn !== '') $out['fn'] = $h($fn);
    if ($ln !== '') $out['ln'] = $h($ln);
    if (!empty($u['external_id'])) $out['external_id'] = $h((string)$u['external_id']);
    if ($v = meta_cookie($u['fbp'] ?? null)) $out['fbp'] = $v;
    if ($v = meta_cookie($u['fbc'] ?? null)) $out['fbc'] = $v;
    if (!empty($u['ip'])) $out['client_ip_address'] = (string)$u['ip'];
    if (!empty($u['ua'])) $out['client_user_agent'] = substr((string)$u['ua'], 0, 500);
    return $out;
}

/** One event to Meta. Returns what happened instead of throwing. */
function meta_send(array $s, array $e, ?string $testCode = null): array
{
    if (!$s['enabled']) return ['ok' => false, 'skipped' => 'tracking is switched off'];
    if ($s['token'] === '') return ['ok' => false, 'skipped' => 'no access token on the server'];

    $payload = ['data' => [array_filter([
        'event_name' => $e['event_name'], 'event_time' => $e['event_time'] ?? time(), 'event_id' => $e['event_id'],
        'action_source' => 'website', 'event_source_url' => $e['event_source_url'] ?? null,
        'user_data' => meta_user_data($e['user'] ?? []) ?: new stdClass(),
        'custom_data' => $e['custom_data'] ?? new stdClass(),
    ], fn($v) => $v !== null)]];
    if ($testCode) $payload['test_event_code'] = $testCode;

    $ch = curl_init(META_GRAPH . '/' . rawurlencode($s['pixel_id']) . '/events?access_token=' . rawurlencode($s['token']));
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 6,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'], CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
    $raw = curl_exec($ch);
    $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($raw === false) { error_log("meta: {$e['event_name']} {$e['event_id']} could not be sent"); return ['ok' => false, 'skipped' => 'network error or timeout']; }
    $body = json_decode($raw, true);
    // Meta's message only; the token is in the URL and never logged.
    if ($http < 200 || $http >= 300) error_log("meta: {$e['event_name']} {$e['event_id']} was refused: " . ($body['error']['message'] ?? "HTTP $http"));
    return ['ok' => $http >= 200 && $http < 300, 'status' => $http, 'body' => $body];
}

/** A page address from the browser, kept only if it is on one of the site's own addresses. */
function meta_source_url(?string $url): string
{
    $url = (string)$url;
    foreach (config('allowed_origins') as $o) if (str_starts_with($url, $o . '/')) return substr($url, 0, 500);
    return rtrim((string)config('site_url'), '/') . '/';
}

/** The visitor making this request: their IP and browser, which Meta never wants hashed. */
function meta_request_user(): array
{
    return ['ip' => client_ip(), 'ua' => (string)($_SERVER['HTTP_USER_AGENT'] ?? '')];
}

/** email, phone, name and id of an account, for user_data. */
function meta_account(?string $userId): array
{
    if (!$userId) return [];
    $u = q('SELECT id, email, phone, user_metadata FROM users WHERE id = ?', [$userId])->fetch();
    if (!$u) return [];
    $meta = json_decode((string)$u['user_metadata'], true) ?: [];
    return ['email' => $u['email'], 'phone' => $u['phone'], 'name' => $meta['full_name'] ?? ($meta['name'] ?? null), 'external_id' => $u['id']];
}

/** Purchase for a paid order. Only real money: sandbox, free and ৳0 orders are skipped. */
function meta_purchase(string $orderId, array $visitor): ?array
{
    $o = q('SELECT * FROM orders WHERE id = ?', [$orderId])->fetch();
    if (!$o || $o['bkash_env'] !== 'live' || (int)$o['amount_bdt'] <= 0) return null;
    $acc = meta_account($o['user_id']);
    return [
        'event_name' => 'Purchase', 'event_id' => 'order_' . $o['id'],
        'event_time' => $o['paid_at'] ? strtotime($o['paid_at'] . ' UTC') : null,
        'event_source_url' => rtrim((string)config('site_url'), '/') . '/payment-status',
        // What the buyer typed at checkout first, their account second.
        'user' => [
            'email' => $o['buyer_email'] ?: ($acc['email'] ?? null), 'phone' => $o['buyer_phone'] ?: ($acc['phone'] ?? null),
            'name' => $o['buyer_name'] ?: ($acc['name'] ?? null), 'external_id' => $o['user_id'],
            'fbp' => $o['meta_fbp'], 'fbc' => $o['meta_fbc'],
        ] + $visitor,
        'custom_data' => [
            'currency' => 'BDT', 'value' => (int)$o['amount_bdt'], 'content_ids' => [(string)$o['item_id']], 'content_type' => 'product',
            'content_name' => $o['item_title'], 'content_category' => $o['kind'], 'num_items' => (int)$o['qty'] ?: 1, 'order_id' => (string)$o['id'],
        ],
    ];
}

/** CompleteRegistration for an account created just now. */
function meta_registration(string $userId, array $visitor, ?string $sourceUrl = null): array
{
    return [
        'event_name' => 'CompleteRegistration', 'event_id' => 'reg_' . $userId,
        'event_source_url' => meta_source_url($sourceUrl),
        'user' => meta_account($userId) + $visitor,
        'custom_data' => ['content_name' => 'রেজিস্ট্রেশন', 'status' => 'completed', 'currency' => 'BDT', 'value' => 0],
    ];
}

/** InitiateCheckout for a course or product, priced from the database. */
function meta_initiate_checkout(string $eventId, array $item, int $qty, array $user, ?string $sourceUrl): array
{
    return [
        'event_name' => 'InitiateCheckout', 'event_id' => $eventId,
        'event_source_url' => meta_source_url($sourceUrl),
        'user' => $user,
        'custom_data' => [
            'currency' => 'BDT', 'value' => $item['price'] * $qty, 'content_ids' => [(string)$item['id']], 'content_type' => 'product',
            'content_name' => $item['title'], 'content_category' => $item['kind'], 'num_items' => $qty,
        ],
    ];
}

/**
 * Sends an event after the reply is on its way, so nobody waits for Meta.
 * $build runs then and returns the event, or null to send nothing.
 */
function meta_later(callable $build): void
{
    // A request marked "X-Meta-Test-Code: TEST..." (the automatic tests) sends its events as
    // test events, which Facebook shows only under Test events and never counts.
    $test = (string)($_SERVER['HTTP_X_META_TEST_CODE'] ?? '');
    $test = preg_match('/^TEST\w{2,40}$/', $test) ? $test : null;
    register_shutdown_function(function () use ($build, $test) {
        try {
            if (function_exists('litespeed_finish_request')) litespeed_finish_request();
            elseif (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
            $s = meta_settings();
            if (!$s['enabled'] || $s['token'] === '') return;
            if ($e = $build()) meta_send($s, $e, $test);
        } catch (Throwable $e) {
            error_log('meta: event failed: ' . $e->getMessage());
        }
    });
}

function meta_report_purchase_later(string $orderId): void
{
    // The request came from the buyer's own browser (bKash redirected it, or the status page asked).
    $visitor = meta_request_user();
    meta_later(fn() => meta_purchase($orderId, $visitor));
}
