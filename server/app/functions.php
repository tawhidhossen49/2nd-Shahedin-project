<?php
/**
 * What the Supabase Edge Functions did, now on this server:
 *
 *   POST /functions/bkash-payment   { action: create | status | refund }
 *   GET  /functions/bkash-callback  where bKash sends the customer back
 *   POST /functions/admin-users     a main admin creates a new admin login
 *   POST /functions/meta-ads        Admin -> Facebook ads (meta_ads.php)
 *
 * Ported from supabase/functions/*; the rules and messages are the same.
 * These run with full database access (like the service role), so every
 * permission is checked here in code. Errors reach the browser as { error }.
 */
declare(strict_types=1);

require_once __DIR__ . '/bkash.php';
require_once __DIR__ . '/meta.php';
require_once __DIR__ . '/meta_ads.php';

const PAY_MSG = [
    'auth' => 'অর্ডার করতে হলে আগে লগইন করুন।',
    'item' => 'এই আইটেমটি এখন আর পাওয়া যাচ্ছে না।',
    'soldOut' => 'এই প্রোডাক্টটি স্টকে নেই।',
    'stock' => 'স্টকে এত পিস নেই।',
    'enrolled' => 'আপনি ইতিমধ্যে এই কোর্সে ভর্তি আছেন।',
    'closed' => 'এই কোর্সে এখন নতুন ভর্তি বন্ধ আছে।',
    'gateway' => 'পেমেন্ট শুরু করা যায়নি, একটু পরে আবার চেষ্টা করুন।',
    'coupon' => 'কুপনটি যাচাই করা যায়নি, একটু পরে আবার চেষ্টা করুন।',
    'notFound' => 'অর্ডারটি পাওয়া যায়নি।',
    'tooMany' => 'অল্প সময়ে অনেকবার চেষ্টা করা হয়েছে। কয়েক মিনিট পর আবার চেষ্টা করুন।',
];

function fn_fail(string $message, int $status = 400, array $extra = []): never
{
    send_json(['error' => $message] + $extra, $status);
}

function functions_handle(string $name): never
{
    if ($name === 'bkash-callback') bkash_callback();
    if (!in_array($name, ['bkash-payment', 'admin-users', 'meta-ads'], true)) fn_fail('Function not found.', 404);
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fn_fail('Method not allowed.', 405);
    try {
        $ctx = current_ctx();
    } catch (ApiError $e) {
        $ctx = new Ctx();   // an expired login is treated as no login: "please log in"
    }
    $body = request_json();
    match ($name) {
        'bkash-payment' => bkash_payment($ctx, $body),
        'admin-users' => admin_users($ctx, $body),
        'meta-ads' => meta_ads($ctx, $body),
        default => fn_fail('Function not found.', 404),
    };
}

/* ---------------- orders ---------------- */

/** Enrolment is what opens the course; a repeat is harmless. */
function grant_course(string $userId, string $courseId): void
{
    try {
        q('INSERT INTO enrollments (id, user_id, course_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE user_id = user_id', [uuid4(), $userId, $courseId]);
    } catch (Throwable $e) {
        error_log("bkash: payment taken but enrolment failed for user $userId: " . $e->getMessage());
    }
}

/** Marks an order paid and hands over what was bought, exactly once (a repeat call changes nothing). */
function settle_order(array $order, string $trxId, string $payerAccount): bool
{
    $n = q("UPDATE orders SET status = 'completed', bkash_trx_id = ?, bkash_payer_account = ?, paid_at = UTC_TIMESTAMP(6), failure_reason = NULL
            WHERE id = ? AND status <> 'completed'", [$trxId ?: null, $payerAccount ?: null, $order['id']])->rowCount();
    if ($n === 0) return false;
    if ($order['kind'] === 'course') grant_course($order['user_id'], $order['item_id']);
    meta_report_purchase_later($order['id']);
    return true;
}

function order_fail(string $id, string $status, ?string $reason): void
{
    q("UPDATE orders SET status = ?, failure_reason = COALESCE(?, failure_reason) WHERE id = ? AND status = 'pending'", [$status, $reason, $id]);
}

/* ---------------- bkash-payment ---------------- */

function bkash_payment(Ctx $ctx, stdClass $b): never
{
    if (!$ctx->uid()) fn_fail(PAY_MSG['auth'], 401);
    match ((string)($b->action ?? '')) {
        'create' => pay_create($ctx->uid(), $b),
        'status' => pay_status($ctx->uid(), $b),
        'refund' => pay_refund($ctx, $b),
        default => fn_fail('Unknown action.', 400),
    };
}

/** bKash fills its wallet box from this when it looks like a Bangladeshi mobile number. */
function payer_reference(?string $phone, string $invoice): string
{
    $d = preg_replace('/^880/', '', preg_replace('/\D/', '', (string)$phone));
    return preg_match('/^01\d{9}$/', $d) ? $d : $invoice;
}

function pay_create(string $userId, stdClass $b): never
{
    // 5 checkouts in 10 minutes per account: far above a real buyer, far below abuse
    // that could get the live merchant account throttled.
    $recent = (int)q('SELECT COUNT(*) FROM orders WHERE user_id = ? AND created_at > UTC_TIMESTAMP(6) - INTERVAL 10 MINUTE', [$userId])->fetchColumn();
    if ($recent >= 5) fn_fail(PAY_MSG['tooMany'], 429);

    $kind = ($b->kind ?? '') === 'course' ? 'course' : 'product';
    $slug = trim((string)($b->slug ?? ''));
    if ($slug === '') fn_fail(PAY_MSG['item'], 404);
    $qty = 1;

    // Price, title and availability come from the database, never from the browser.
    if ($kind === 'course') {
        $c = q('SELECT * FROM courses WHERE slug = ?', [$slug])->fetch();
        if (!$c || !$c['is_published']) fn_fail(PAY_MSG['item'], 404);
        $itemId = $c['id'];
        $title = $c['title_bn'] ?: ($c['title_en'] ?: $slug);
        $unit = $c['is_free'] ? 0 : max(0, (int)$c['price_bdt']);
        if (q('SELECT 1 FROM enrollments WHERE user_id = ? AND course_id = ?', [$userId, $itemId])->fetch()) fn_fail(PAY_MSG['enrolled'], 409);
        $deadlinePassed = $c['enrollment_deadline'] !== null && strtotime($c['enrollment_deadline'] . ' UTC') <= time();
        if ((string)$c['enrollment_open'] === '0' || $deadlinePassed) fn_fail(PAY_MSG['closed'], 409);
    } else {
        $p = q('SELECT id, name_bn, name_en, price_bdt, stock, is_published FROM products WHERE slug = ?', [$slug])->fetch();
        if (!$p || !$p['is_published']) fn_fail(PAY_MSG['item'], 404);
        $itemId = $p['id'];
        $title = $p['name_bn'] ?: ($p['name_en'] ?: $slug);
        $unit = max(0, (int)$p['price_bdt']);
        $qty = min(99, max(1, (int)floor((float)($b->qty ?? 1))));
        if ($p['stock'] !== null) {
            if ((int)$p['stock'] <= 0) fn_fail(PAY_MSG['soldOut'], 409);
            if ($qty > (int)$p['stock']) fn_fail(PAY_MSG['stock'], 409);
        }
    }

    $subtotal = $unit * $qty;
    $discount = 0;
    $coupon = null;
    $asked = trim((string)($b->coupon_code ?? ''));
    if ($asked !== '') {
        // The same check the checkout page previews with, so shown and charged discounts agree.
        try {
            $v = validate_coupon($asked, $subtotal, $kind);
        } catch (Throwable $e) {
            error_log('bkash-payment: coupon validation failed: ' . $e->getMessage());
            fn_fail(PAY_MSG['coupon'], 502);
        }
        if (!empty($v['valid'])) {
            $discount = max(0, min((int)$v['discount_bdt'], $subtotal));
            $coupon = $v['code'];
        }
    }
    $total = max(0, $subtotal - $discount);
    $buyer = $b->buyer ?? new stdClass();
    $field = fn($k) => ($x = trim((string)($buyer->$k ?? ''))) === '' ? null : $x;
    $invoice = 'SHD' . strtoupper(base_convert((string)(int)(microtime(true) * 1000), 10, 36)) . strtoupper(base_convert((string)random_int(0, 4095), 10, 36));
    $orderId = uuid4();

    try {
        q('INSERT INTO orders (id, user_id, kind, item_id, item_title, qty, subtotal_bdt, discount_bdt, coupon_code, amount_bdt,
                               payment_method, status, paid_at, bkash_invoice, buyer_name, buyer_phone, buyer_email, shipping_address)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
            $orderId, $userId, $kind, $itemId, $title, $qty, $subtotal, $discount, $coupon, $total,
            $total === 0 ? 'free' : 'bKash', $total === 0 ? 'completed' : 'pending', $total === 0 ? now_utc() : null,
            $invoice, $field('name'), $field('phone'), $field('email'), $field('address'),
        ]);
    } catch (Throwable $e) {
        error_log('bkash-payment: could not write the order: ' . $e->getMessage());
        fn_fail(PAY_MSG['gateway'], 500);
    }

    if ($total === 0) {
        if ($kind === 'course') grant_course($userId, $itemId);
        send_json(['free' => true, 'orderId' => $orderId]);
    }

    try {
        $cfg = bkash_config();
        // No query string: bKash appends "?paymentID=...", and the order is found by that id.
        $pay = bkash_create($cfg, $total, $invoice, config('api_url') . '/functions/bkash-callback', payer_reference($field('phone'), $invoice));
        q('UPDATE orders SET bkash_payment_id = ?, bkash_signature = ?, bkash_env = ? WHERE id = ?', [$pay['paymentId'], $pay['signature'] ?: null, $cfg['env'], $orderId]);
        send_json(['bkashURL' => $pay['bkashURL'], 'orderId' => $orderId]);
    } catch (BkashError | RuntimeException $e) {
        $msg = $e instanceof BkashError ? $e->getMessage() : PAY_MSG['gateway'];
        error_log('bkash-payment: create failed: ' . $e->getMessage());
        q("UPDATE orders SET status = 'failed', failure_reason = ? WHERE id = ?", [$msg, $orderId]);
        fn_fail($msg, 502);
    }
}

/**
 * payment-status calls this on load. Query Payment runs only for an order still
 * pending, which only happens when Execute never answered: bKash's one allowed use.
 */
function pay_status(string $userId, stdClass $b): never
{
    $id = trim((string)($b->orderId ?? ''));
    $o = $id === '' ? false : q('SELECT * FROM orders WHERE id = ?', [$id])->fetch();
    // Someone else's order is just "not found".
    if (!$o || $o['user_id'] !== $userId) fn_fail(PAY_MSG['notFound'], 404);

    if ($o['status'] === 'pending' && $o['bkash_payment_id']) {
        try {
            $cfg = bkash_config();
            if (($o['bkash_env'] ?? 'sandbox') === $cfg['env']) {
                $r = bkash_query($cfg, $o['bkash_payment_id']);
                if ($r['transactionStatus'] === 'Completed') {
                    settle_order($o, $r['trxId'], $r['payerAccount']);
                    $o['status'] = 'completed';
                    $o['bkash_trx_id'] = $r['trxId'];
                } elseif ($r['transactionStatus'] !== '' && $r['transactionStatus'] !== 'Initiated') {
                    $reason = $r['message'] ?: "bKash returned status {$r['transactionStatus']}.";
                    order_fail($o['id'], 'failed', $reason);
                    $o['status'] = 'failed';
                    $o['failure_reason'] = $reason;
                }
            }
        } catch (Throwable $e) {
            // Leave it pending; the next page load asks again.
            error_log('bkash-payment: status lookup failed: ' . $e->getMessage());
        }
    }
    $table = $o['kind'] === 'course' ? 'courses' : 'products';
    $slug = q("SELECT slug FROM `$table` WHERE id = ?", [$o['item_id']])->fetchColumn();
    send_json(['order' => [
        'id' => $o['id'], 'kind' => $o['kind'], 'slug' => $slug ?: null, 'title' => $o['item_title'],
        'amount' => (int)$o['amount_bdt'], 'status' => $o['status'], 'trxId' => $o['bkash_trx_id'], 'reason' => $o['failure_reason'],
    ]]);
}

function pay_refund(Ctx $ctx, stdClass $b): never
{
    // A main admin, or a partial admin with the Orders page.
    if (!$ctx->can('orders')) fn_fail('Not allowed.', 403);

    $id = trim((string)($b->orderId ?? ''));
    // One refund per order at a time, so two clicks cannot both refund the same remaining amount.
    // Not a transaction: bKash's call log must be kept even when the refund fails.
    // MySQL releases the lock when this request ends.
    if ((int)q('SELECT GET_LOCK(?, 5)', ['shahedin_refund_' . $id])->fetchColumn() !== 1) fn_fail('Another refund for this order is in progress.', 409);
    $o = q('SELECT * FROM orders WHERE id = ?', [$id])->fetch();
    if (!$o) fn_fail('Order not found.', 404);
    if ($o['status'] !== 'completed' || !$o['bkash_payment_id'] || !$o['bkash_trx_id']) fn_fail('Only a completed bKash payment can be refunded.', 409);
    $already = (int)$o['refunded_bdt'];
    $remaining = (int)$o['amount_bdt'] - $already;
    $amount = (int)floor((float)($b->amount ?? 0));
    if ($amount <= 0 || $amount > $remaining) fn_fail("Refund must be between 1 and $remaining BDT.", 400);

    try {
        $cfg = bkash_config();
    } catch (RuntimeException $e) {
        error_log('bkash-payment: refund refused, bKash is misconfigured: ' . $e->getMessage());
        fn_fail('bKash is not configured on the server.', 500);
    }
    $env = $o['bkash_env'] ?? 'sandbox';
    if ($env !== $cfg['env']) fn_fail("This was a $env test payment and cannot be refunded with the {$cfg['env']} bKash account.", 409);

    $reason = trim((string)($b->reason ?? ''));
    $sku = trim((string)($b->sku ?? ''));
    try {
        $r = bkash_refund($cfg, $o['bkash_payment_id'], $o['bkash_trx_id'], $amount, $reason ?: 'Merchant refund', $sku ?: mb_substr($o['item_title'], 0, 40));
    } catch (BkashError $e) {
        error_log('bkash-payment: refund failed: ' . $e->getMessage());
        fn_fail($e->getMessage(), 502);
    }

    // The money has left the wallet. From here a failure is reported, never thrown.
    $total = $already + $amount;
    try {
        q('INSERT INTO order_refunds (id, order_id, refund_trx_id, amount_bdt, reason, sku, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [uuid4(), $o['id'], $r['refundTrxId'] ?: null, $amount, $reason ?: null, $sku ?: null, $r['status'] ?: 'Completed', $ctx->uid()]);
    } catch (Throwable $e) {
        error_log("bkash-payment: refund {$r['refundTrxId']} succeeded but the history row failed: " . $e->getMessage());
    }
    try {
        q('UPDATE orders SET refunded_bdt = ?, status = ? WHERE id = ?', [$total, $total >= (int)$o['amount_bdt'] ? 'refunded' : 'completed', $o['id']]);
    } catch (Throwable $e) {
        error_log("bkash-payment: REFUND {$r['refundTrxId']} SUCCEEDED AT BKASH but order {$o['id']} was not updated: " . $e->getMessage());
        send_json(['refundTrxId' => $r['refundTrxId'], 'refunded' => $total, 'recordFailed' => true]);
    }
    send_json(['refundTrxId' => $r['refundTrxId'], 'refunded' => $total]);
}

/* ---------------- bkash-callback ---------------- */

function landing(?string $orderId, string $outcome): never
{
    $p = ['status' => $outcome];
    if ($orderId) $p['order'] = $orderId;
    header('Location: ' . rtrim((string)config('site_url'), '/') . '/payment-status?' . http_build_query($p), true, 302);
    exit;
}

/**
 * The customer's browser lands here from bKash with ?paymentID=&status=&signature=.
 * "success" only means the PIN was right; Execute is what takes the money, and its
 * answer, not anything in the address, settles the order.
 */
function bkash_callback(): never
{
    try {
        $pid = (string)($_GET['paymentID'] ?? $_GET['paymentId'] ?? '');
        $status = strtolower((string)($_GET['status'] ?? ''));
        $sig = (string)($_GET['signature'] ?? '');
        if ($pid === '') landing(null, 'unknown');

        $o = q('SELECT * FROM orders WHERE bkash_payment_id = ?', [$pid])->fetch();
        if (!$o) { error_log("bkash-callback: no order matches payment $pid."); landing(null, 'unknown'); }

        // The signature is required: a payment id is not secret, so without it anyone
        // could mark a customer's pending order cancelled. A bad one changes nothing.
        if ($o['bkash_signature'] && ($sig === '' || !hash_equals($o['bkash_signature'], $sig))) {
            error_log("bkash-callback: " . ($sig === '' ? 'missing' : 'wrong') . " signature on order {$o['id']}; nothing changed.");
            landing($o['id'], 'unknown');
        }
        $cfg = bkash_config();
        if (($o['bkash_env'] ?? 'sandbox') !== $cfg['env']) landing($o['id'], 'unknown');

        // Each outcome only ever moves an order OUT of pending, so a repeat cannot undo a payment.
        if ($status === 'cancel') { order_fail($o['id'], 'cancelled', null); landing($o['id'], 'cancelled'); }
        if ($status === 'failure') { order_fail($o['id'], 'failed', 'bKash reported the payment as failed.'); landing($o['id'], 'failed'); }
        if ($status !== 'success') landing($o['id'], 'unknown');

        try {
            $r = bkash_execute($cfg, $pid);
        } catch (BkashError $e) {
            if (in_array($e->bkCode, BKASH_NO_RESPONSE, true)) {
                // No answer at all: the one case bKash allows Query Payment.
                try {
                    $r = bkash_query($cfg, $pid);
                } catch (Throwable $q) {
                    // Still nothing: leave it pending; payment-status asks again.
                    landing($o['id'], 'unknown');
                }
            } elseif ($e->bkCode === '2117') {
                // Already executed (a refreshed tab): report what was recorded the first time.
                landing($o['id'], $o['status'] === 'completed' ? 'success' : 'unknown');
            } else {
                order_fail($o['id'], 'failed', $e->getMessage());
                landing($o['id'], 'failed');
            }
        }

        if ($r['transactionStatus'] !== 'Completed') {
            order_fail($o['id'], 'failed', $r['message'] ?: 'bKash returned status ' . ($r['transactionStatus'] ?: 'unknown') . '.');
            landing($o['id'], 'failed');
        }
        if ((int)round($r['amount']) !== (int)$o['amount_bdt']) {
            error_log("bkash-callback: order {$o['id']} expected {$o['amount_bdt']} BDT but bKash settled {$r['amount']}.");
        }
        settle_order($o, $r['trxId'], $r['payerAccount']);
        landing($o['id'], 'success');
    } catch (Throwable $e) {
        // Never strand a customer on an error page holding a payment: the status page asks bKash.
        error_log('bkash-callback: ' . $e->getMessage());
        landing(isset($o['id']) ? $o['id'] : null, 'unknown');
    }
}

/* ---------------- admin-users ---------------- */

/** A main admin makes a new email + password login with admin access. Never touches an existing login. */
function admin_users(Ctx $ctx, stdClass $b): never
{
    if (!$ctx->uid()) fn_fail('Please log in again.', 401);
    if (!$ctx->isMain()) fn_fail('Only a main admin can add an admin.', 403);

    $email = strtolower(trim((string)($b->email ?? '')));
    $password = (string)($b->password ?? '');
    $name = trim((string)($b->full_name ?? ''));
    $role = (string)($b->role ?? '');
    $perms = clean_permissions(is_array($b->permissions ?? null) ? $b->permissions : []);
    if (!preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/', $email)) fn_fail('Enter a valid email address.', 400);
    if (strlen($password) < 8) fn_fail('The password must be at least 8 characters.', 400);
    if ($role !== 'main' && $role !== 'partial') fn_fail('Choose a role.', 400);
    if (q('SELECT 1 FROM users WHERE email = ?', [$email])->fetch()) fn_fail('That email already has a login.', 409, ['code' => 'exists']);

    $id = uuid4();
    try {
        // Both rows or neither: never a login that is not an admin of anything.
        in_transaction(function () use ($id, $email, $password, $name, $role, $perms) {
            q('INSERT INTO users (id, email, password_hash, user_metadata, email_confirmed_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6))',
              [$id, $email, password_hash($password, PASSWORD_BCRYPT), json_encode($name !== '' ? ['full_name' => $name] : new stdClass(), JSON_UNESCAPED_UNICODE)]);
            q('INSERT INTO admins (id, email, full_name, role, permissions) VALUES (?, ?, ?, ?, ?)',
              [$id, $email, $name ?: null, $role, json_encode($perms)]);
        });
    } catch (ApiError $e) {
        if ($e->codeName === '23505') fn_fail('That email already has a login.', 409, ['code' => 'exists']);
        fn_fail('The admin could not be saved, so no login was created. Try again.', 500);
    }
    $row = q('SELECT id, email, full_name, role, permissions, created_at FROM admins WHERE id = ?', [$id])->fetch();
    send_json(['admin' => row_out($row, 'admins')]);
}
