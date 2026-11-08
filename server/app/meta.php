<?php
/**
 * Meta (Facebook) Conversions API: reports a paid order as a Purchase.
 * Port of supabase/functions/_shared/meta.ts.
 *
 * Pixel id + on/off: site_settings "meta_pixel" (Admin -> Facebook ads).
 * Access token: config.php 'meta' => ['capi_token' => ...], never in the database or a browser.
 *
 * Nothing here may break a payment: it runs after the reply has been sent,
 * with a 6-second limit, and swallows every error.
 */
declare(strict_types=1);

const META_GRAPH = 'https://graph.facebook.com/v25.0';

function meta_settings(): array
{
    $v = json_decode((string)q("SELECT value FROM site_settings WHERE `key` = 'meta_pixel'")->fetchColumn(), true) ?: [];
    $pixel = trim((string)($v['pixel_id'] ?? ''));
    $account = trim(preg_replace('/^act_/', '', (string)($v['ad_account_id'] ?? '')));
    return [
        'enabled' => ($v['enabled'] ?? false) === true && preg_match('/^\d{6,20}$/', $pixel),
        'pixel_id' => $pixel,
        'token' => trim((string)(config('meta')['capi_token'] ?? '')),
        'ad_account_id' => preg_match('/^\d{5,25}$/', $account) ? $account : '',
    ];
}

/** Meta's rule: digits only, country code included; 01XXXXXXXXX becomes 8801XXXXXXXXX. */
function meta_phone(?string $raw): string
{
    $d = ltrim(preg_replace('/\D/', '', (string)$raw), '0');
    if (preg_match('/^1\d{9}$/', $d)) $d = '880' . $d;
    return strlen($d) >= 8 ? $d : '';
}

/** One event to Meta. Returns what happened instead of throwing. */
function meta_send(array $s, array $e, ?string $testCode = null): array
{
    if (!$s['enabled']) return ['ok' => false, 'skipped' => 'tracking is switched off'];
    if ($s['token'] === '') return ['ok' => false, 'skipped' => 'no access token on the server'];

    $user = [];
    $email = strtolower(trim((string)($e['email'] ?? '')));
    if (preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/', $email)) $user['em'] = [hash('sha256', $email)];
    if ($p = meta_phone($e['phone'] ?? null)) $user['ph'] = [hash('sha256', $p)];
    if (!empty($e['external_id'])) $user['external_id'] = [hash('sha256', (string)$e['external_id'])];
    if (!empty($e['ip'])) $user['client_ip_address'] = $e['ip'];
    if (!empty($e['ua'])) $user['client_user_agent'] = $e['ua'];

    $payload = ['data' => [[
        'event_name' => $e['event_name'], 'event_time' => $e['event_time'] ?? time(), 'event_id' => $e['event_id'],
        'action_source' => 'website', 'event_source_url' => $e['event_source_url'] ?? null,
        'user_data' => $user ?: new stdClass(), 'custom_data' => $e['custom_data'] ?? new stdClass(),
    ]]];
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

/** The Purchase for a paid order. Only real money: sandbox, free and ৳0 orders are skipped. */
function meta_purchase(string $orderId, ?string $ip, ?string $ua): ?array
{
    $o = q('SELECT * FROM orders WHERE id = ?', [$orderId])->fetch();
    if (!$o || $o['bkash_env'] !== 'live' || (int)$o['amount_bdt'] <= 0) return null;
    return [
        'event_name' => 'Purchase', 'event_id' => 'order_' . $o['id'],
        'event_time' => $o['paid_at'] ? strtotime($o['paid_at'] . ' UTC') : null,
        'event_source_url' => rtrim((string)config('site_url'), '/') . '/payment-status',
        'email' => $o['buyer_email'], 'phone' => $o['buyer_phone'], 'external_id' => $o['user_id'], 'ip' => $ip, 'ua' => $ua,
        'custom_data' => [
            'currency' => 'BDT', 'value' => (int)$o['amount_bdt'], 'content_ids' => [(string)$o['item_id']], 'content_type' => 'product',
            'content_name' => $o['item_title'], 'content_category' => $o['kind'], 'num_items' => (int)$o['qty'] ?: 1, 'order_id' => (string)$o['id'],
        ],
    ];
}

/** Sends the Purchase after the customer's reply is on its way, so they never wait for Meta. */
function meta_report_purchase_later(string $orderId): void
{
    // The request came from the buyer's own browser (bKash redirected it, or the status page asked).
    $ip = client_ip();
    $ua = (string)($_SERVER['HTTP_USER_AGENT'] ?? '');
    register_shutdown_function(function () use ($orderId, $ip, $ua) {
        try {
            if (function_exists('litespeed_finish_request')) litespeed_finish_request();
            elseif (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
            $s = meta_settings();
            if (!$s['enabled'] || $s['token'] === '') return;
            if ($e = meta_purchase($orderId, $ip, $ua)) meta_send($s, $e);
        } catch (Throwable $e) {
            error_log('meta: purchase report failed: ' . $e->getMessage());
        }
    });
}
