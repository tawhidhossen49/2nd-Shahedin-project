<?php
/**
 * bKash PGW Tokenized Checkout v2: every call this site makes to bKash.
 * A port of supabase/functions/_shared/bkash.ts; the rules are the same:
 *
 *  - Credentials come from ~/shahedin-private/config.php ('bkash') and never leave the server.
 *  - The base URL is pinned to https://*.bka.sh/v2, so a mistyped setting cannot send the
 *    merchant password anywhere else.
 *  - Grant Token is called at most once an hour; the token is stored in `bkash_token` and
 *    shared by every request. A MySQL lock lets only one request grant at a time.
 *  - Refresh Token is never called (bKash blocks the account on the third call in an hour).
 *  - Every call is logged to `bkash_api_log` with secrets replaced first.
 *  - 30-second timeout on every call, as the spec asks.
 */
declare(strict_types=1);

final class BkashError extends Exception
{
    public function __construct(string $message, public string $bkCode, public int $status) { parent::__construct($message); }
}

/** Codes made up here when bKash gave no answer: the only case where Query Payment is allowed as a fallback. */
const BKASH_NO_RESPONSE = ['timeout', 'network', 'malformed'];
const BKASH_SECRET_KEYS = ['app_secret', 'password', 'id_token', 'refresh_token', 'authorization'];

function bkash_config(): array
{
    $b = config('bkash') ?? [];
    foreach (['base_url', 'app_key', 'app_secret', 'username', 'password'] as $k) {
        if (empty($b[$k])) throw new RuntimeException("bKash is not configured: missing $k");
    }
    $base = rtrim($b['base_url'], '/');
    $u = parse_url($base);
    if (($u['scheme'] ?? '') !== 'https' || !preg_match('/(^|\.)bka\.sh$/i', $u['host'] ?? '')) {
        throw new RuntimeException('bKash base_url must be an https:// address on bka.sh.');
    }
    if (rtrim($u['path'] ?? '', '/') !== '/v2') throw new RuntimeException('bKash base_url must end in /v2.');
    $b['base_url'] = $base;
    $b['env'] = stripos($u['host'], 'sandbox') !== false ? 'sandbox' : 'live';
    return $b;
}

function bkash_redact($v)
{
    if (is_array($v)) {
        $out = [];
        foreach ($v as $k => $x) $out[$k] = is_string($k) && in_array(strtolower($k), BKASH_SECRET_KEYS, true) ? '[redacted]' : bkash_redact($x);
        return $out;
    }
    return $v;
}

function bkash_log(string $api, string $url, ?int $http, ?string $code, ?string $error, int $ms, $req, $res): void
{
    try {
        $pid = null;
        foreach ([$req, $res] as $b) if (is_array($b) && is_string($b['paymentID'] ?? $b['paymentId'] ?? null)) { $pid = $b['paymentID'] ?? $b['paymentId']; break; }
        $enc = fn($x) => $x === null ? null : json_encode(bkash_redact($x), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        q('INSERT INTO bkash_api_log (api, url, http_status, response_code, error_message, duration_ms, payment_id, request_body, response_body)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [$api, $url, $http, $code, $error, $ms, $pid ?: null, $enc($req), $enc($res)]);
    } catch (Throwable $e) {
        // A failed log write must never fail a payment.
        error_log('bkash: could not write the API log: ' . $e->getMessage());
    }
}

function bkash_post(string $api, string $url, array $headers, array $body): array
{
    $h = ['Content-Type: application/json', 'Accept: application/json'];
    foreach ($headers as $k => $v) $h[] = "$k: $v";
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_HTTPHEADER => $h, CURLOPT_POSTFIELDS => json_encode($body, JSON_UNESCAPED_SLASHES),
    ]);
    $start = microtime(true);
    $raw = curl_exec($ch);
    $errno = curl_errno($ch);
    $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $ms = (int)round((microtime(true) - $start) * 1000);

    if ($raw === false) {
        $timedOut = $errno === CURLE_OPERATION_TIMEDOUT;
        $msg = $timedOut ? 'bKash did not respond in time.' : 'Could not reach bKash.';
        bkash_log($api, $url, null, $timedOut ? 'timeout' : 'network', $msg, $ms, $body, null);
        throw new BkashError($msg, $timedOut ? 'timeout' : 'network', 504);
    }
    $parsed = $raw === '' ? [] : json_decode($raw, true);
    if (!is_array($parsed)) {
        bkash_log($api, $url, $http, 'malformed', 'Response was not valid JSON.', $ms, $body, ['raw' => substr($raw, 0, 2000)]);
        throw new BkashError('bKash returned a response that could not be read.', 'malformed', 502);
    }
    $ok = $http >= 200 && $http < 300;
    $code = (string)($parsed['errorCode'] ?? $parsed['externalCode'] ?? $parsed['statusCode'] ?? ($ok ? '0000' : (string)$http));
    $failed = !$ok || ($code !== '' && $code !== '0000');
    $msg = $failed ? (string)($parsed['errorMessageEn'] ?? $parsed['errorMessage'] ?? $parsed['statusMessage'] ?? 'bKash refused the request.') : null;
    bkash_log($api, $url, $http, $code, $msg, $ms, $body, $parsed);
    if ($failed) throw new BkashError($msg, $code, $http);
    return $parsed;
}

/** The shared id_token: reused for its hour by every request, granted by one request at a time. */
function bkash_token(array $cfg): string
{
    $fp = hash('sha256', "{$cfg['base_url']}|{$cfg['app_key']}|{$cfg['username']}");
    $fresh = fn() => q('SELECT id_token FROM bkash_token WHERE id = 1 AND fingerprint = ? AND expires_at > UTC_TIMESTAMP(6)', [$fp])->fetchColumn();
    if ($t = $fresh()) return $t;

    if ((int)q("SELECT GET_LOCK('shahedin_bkash_token', 10)")->fetchColumn() !== 1) {
        throw new BkashError('Timed out waiting for a bKash access token.', 'token_busy', 503);
    }
    try {
        if ($t = $fresh()) return $t;   // another request granted it while this one waited
        $body = bkash_post('grant-token', "{$cfg['base_url']}/tokenized-checkout/auth/grant-token",
            ['username' => $cfg['username'], 'password' => $cfg['password']],
            ['app_key' => $cfg['app_key'], 'app_secret' => $cfg['app_secret']]);
        $t = $body['id_token'] ?? '';
        if (!is_string($t) || $t === '') throw new BkashError('bKash did not return an access token.', 'no_token', 502);
        // Renew 3 minutes early so a token never dies in the middle of a request.
        $life = max(60, ((int)($body['expires_in'] ?? 3600)) - 180);
        q('REPLACE INTO bkash_token (id, id_token, expires_at, obtained_at, fingerprint)
           VALUES (1, ?, UTC_TIMESTAMP(6) + INTERVAL ? SECOND, UTC_TIMESTAMP(6), ?)', [$t, $life, $fp]);
        return $t;
    } finally {
        q("SELECT RELEASE_LOCK('shahedin_bkash_token')");
    }
}

function bkash_authed(array $cfg, string $api, string $path, array $body): array
{
    // The raw id_token, not "Bearer ...": bKash rejects the prefix.
    return bkash_post($api, $cfg['base_url'] . $path, ['Authorization' => bkash_token($cfg), 'X-App-Key' => $cfg['app_key']], $body);
}

function bkash_create(array $cfg, int $amount, string $invoice, string $callbackUrl, string $payerReference): array
{
    $b = bkash_authed($cfg, 'create-payment', '/tokenized-checkout/payment/create', [
        'payerReference' => $payerReference, 'callbackURL' => $callbackUrl, 'amount' => number_format($amount, 2, '.', ''),
        'currency' => 'BDT', 'intent' => 'sale', 'merchantInvoiceNumber' => $invoice,
    ]);
    $url = $b['bkashURL'] ?? $b['bKashURL'] ?? null;
    $pid = $b['paymentID'] ?? $b['paymentId'] ?? null;
    if (!is_string($url) || !is_string($pid)) throw new BkashError('bKash did not return a payment URL.', 'no_payment_url', 502);
    return ['paymentId' => $pid, 'bkashURL' => $url, 'signature' => (string)($b['signature'] ?? '')];
}

function bkash_result(array $b): array
{
    return [
        'paymentId' => (string)($b['paymentID'] ?? $b['paymentId'] ?? ''),
        'trxId' => (string)($b['trxId'] ?? ''),
        'transactionStatus' => (string)($b['transactionStatus'] ?? ''),
        'amount' => (float)($b['amount'] ?? 0),
        'payerAccount' => (string)($b['payerAccount'] ?? ''),
        'message' => (string)($b['errorMessageEn'] ?? $b['statusMessage'] ?? ''),
    ];
}

function bkash_execute(array $cfg, string $paymentId): array
{
    return bkash_result(bkash_authed($cfg, 'execute-payment', '/tokenized-checkout/payment/execute', ['paymentId' => $paymentId]));
}

function bkash_query(array $cfg, string $paymentId): array
{
    return bkash_result(bkash_authed($cfg, 'query-payment', '/tokenized-checkout/query/payment', ['paymentId' => $paymentId]));
}

function bkash_refund(array $cfg, string $paymentId, string $trxId, int $amount, string $reason, string $sku): array
{
    $b = bkash_authed($cfg, 'refund', '/tokenized-checkout/refund/payment/transaction', [
        'paymentId' => $paymentId, 'trxId' => $trxId, 'refundAmount' => number_format($amount, 2, '.', ''), 'reason' => $reason, 'sku' => $sku,
    ]);
    return ['refundTrxId' => (string)($b['refundTrxId'] ?? ''), 'status' => (string)($b['refundTransactionStatus'] ?? '')];
}
