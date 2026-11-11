<?php
/**
 * What Admin -> Facebook ads asks the server. Port of supabase/functions/meta-ads
 * and _shared/meta_insights.ts.
 *
 *   POST /functions/meta-ads  { action: "status" }                   is tracking on, is the token valid
 *   POST /functions/meta-ads  { action: "test", test_event_code }    one test event, visible in Events Manager
 *   POST /functions/meta-ads  { action: "results", period }          ad results beside the site's own sales
 *
 * Two tokens in config.php 'meta': capi_token (sends events) and ads_read_token
 * (ads_read only: cannot change an ad or spend money). Neither leaves the server.
 * Main admins, or a limited admin with the "ads" page.
 */
declare(strict_types=1);

const META_PERIODS = ['today', 'last_7d', 'last_30d', 'this_month', 'maximum'];
const META_INSIGHT_FIELDS = 'spend,impressions,reach,clicks,inline_link_clicks,actions,action_values';
// Most specific first, so one sale is counted once.
const META_PICK = [
    'purchase' => ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'],
    'checkout' => ['omni_initiated_checkout', 'initiate_checkout', 'offsite_conversion.fb_pixel_initiate_checkout'],
    'registration' => ['omni_complete_registration', 'complete_registration', 'offsite_conversion.fb_pixel_complete_registration'],
    'lead' => ['lead', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped'],
];

function meta_read_token(): string { return trim((string)(config('meta')['ads_read_token'] ?? '')); }

/** GET from the Graph API with the read token. Never throws: returns the body or ['error' => ['message' => ...]]. */
function graph_get(string $path, array $params): array
{
    $token = meta_read_token();
    if ($token === '') return ['error' => ['message' => 'no read token']];
    $ch = curl_init(META_GRAPH . "/$path?" . http_build_query($params + ['access_token' => $token]));
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 12]);
    $raw = curl_exec($ch);
    $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($raw === false) return ['error' => ['message' => $err ?: 'Facebook did not answer.']];
    return json_decode($raw, true) ?: ['error' => ['message' => "HTTP $http"]];
}

function graph_error(array $b): ?string { return $b['error']['message'] ?? null; }

function meta_pick(?array $rows, array $names): float
{
    foreach ($names as $n) foreach ($rows ?? [] as $r) if (($r['action_type'] ?? '') === $n) return (float)($r['value'] ?? 0);
    return 0.0;
}

function meta_summary(?array $r): array
{
    $r = $r ?? [];
    $spend = (float)($r['spend'] ?? 0);
    $purchases = meta_pick($r['actions'] ?? null, META_PICK['purchase']);
    $value = meta_pick($r['action_values'] ?? null, META_PICK['purchase']);
    return [
        'spend' => $spend, 'impressions' => (float)($r['impressions'] ?? 0), 'reach' => (float)($r['reach'] ?? 0),
        'clicks' => (float)($r['clicks'] ?? 0), 'linkClicks' => (float)($r['inline_link_clicks'] ?? 0),
        'purchases' => $purchases, 'purchaseValue' => $value,
        'checkouts' => meta_pick($r['actions'] ?? null, META_PICK['checkout']),
        'registrations' => meta_pick($r['actions'] ?? null, META_PICK['registration']),
        'leads' => meta_pick($r['actions'] ?? null, META_PICK['lead']),
        // null, not 0: "no sales yet" is not "free sales".
        'costPerPurchase' => $purchases > 0 ? $spend / $purchases : null,
        'roas' => $spend > 0 && $value > 0 ? $value / $spend : null,
    ];
}

/** The same period as Facebook's, in Dhaka days (UTC+6), as UTC datetimes; from = null for "maximum". */
function meta_period_range(string $period, ?int $now = null): array
{
    $now ??= time();
    $local = $now + 6 * 3600;
    $todayStart = gmmktime(0, 0, 0, (int)gmdate('n', $local), (int)gmdate('j', $local), (int)gmdate('Y', $local)) - 6 * 3600;
    [$from, $to] = match ($period) {
        'today' => [$todayStart, $now],
        'last_7d' => [$todayStart - 7 * 86400, $todayStart],   // the 7 full days before today
        'last_30d' => [$todayStart - 30 * 86400, $todayStart],
        'this_month' => [gmmktime(0, 0, 0, (int)gmdate('n', $local), 1, (int)gmdate('Y', $local)) - 6 * 3600, $now],
        default => [null, $now],
    };
    return [$from === null ? null : gmdate('Y-m-d H:i:s', $from), gmdate('Y-m-d H:i:s', $to)];
}

/** Is the events token still good? Asks Meta without sending an event. */
function meta_token_check(string $token): array
{
    if ($token === '') return ['valid' => false, 'expires' => '', 'message' => 'No access token is saved on the server.'];
    $ch = curl_init(META_GRAPH . '/debug_token?' . http_build_query(['input_token' => $token, 'access_token' => $token]));
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 12]);
    $b = json_decode((string)curl_exec($ch), true);
    curl_close($ch);
    $d = $b['data'] ?? null;
    if (!$d) return ['valid' => false, 'expires' => '', 'message' => $b['error']['message'] ?? 'Facebook did not answer.'];
    $valid = ($d['is_valid'] ?? false) === true;
    $out = ['valid' => $valid, 'expires' => !empty($d['expires_at']) ? gmdate('Y-m-d\TH:i:s.000\Z', (int)$d['expires_at']) : 'never'];
    if (!$valid) $out['message'] = $d['error']['message'] ?? 'Facebook says this token is no longer valid.';
    return $out;
}

function meta_ads(Ctx $ctx, stdClass $b): never
{
    if (!$ctx->uid()) fn_fail('Please log in again.', 401);
    if (!$ctx->can('ads')) fn_fail('You do not have access to the Facebook ads page.', 403);
    $s = meta_settings();
    $action = (string)($b->action ?? '');

    if ($action === 'status') {
        $acc = ['connected' => false, 'reason' => 'no_account'];
        if (meta_read_token() === '') $acc = ['connected' => false, 'reason' => 'no_token'];
        elseif ($s['ad_account_id']) {
            $a = graph_get("act_{$s['ad_account_id']}", ['fields' => 'name,currency,account_status']);
            $acc = ($e = graph_error($a))
                ? ['connected' => false, 'reason' => 'error', 'message' => $e, 'id' => $s['ad_account_id']]
                : ['connected' => true, 'id' => $s['ad_account_id'], 'name' => $a['name'] ?? null, 'currency' => $a['currency'] ?? null, 'active' => ($a['account_status'] ?? 0) === 1];
        }
        send_json(['enabled' => (bool)$s['enabled'], 'pixelId' => $s['pixel_id'], 'tokenSaved' => $s['token'] !== '', 'token' => meta_token_check($s['token']), 'adAccount' => $acc]);
    }

    if ($action === 'results') {
        $period = in_array((string)($b->period ?? ''), META_PERIODS, true) ? (string)$b->period : 'last_7d';
        if (meta_read_token() === '') send_json(['connected' => false, 'reason' => 'no_token']);
        if (!$s['ad_account_id']) send_json(['connected' => false, 'reason' => 'no_account']);
        $act = "act_{$s['ad_account_id']}";
        $account = graph_get($act, ['fields' => 'name,currency,account_status']);
        if ($e = graph_error($account)) send_json(['connected' => false, 'reason' => 'error', 'message' => $e]);
        $total = graph_get("$act/insights", ['date_preset' => $period, 'fields' => META_INSIGHT_FIELDS]);
        if ($e = graph_error($total)) send_json(['connected' => true, 'account' => ['name' => $account['name'] ?? null, 'currency' => $account['currency'] ?? null], 'error' => $e]);
        $campaigns = graph_get("$act/insights", ['date_preset' => $period, 'level' => 'campaign', 'limit' => '25',
            'fields' => 'campaign_id,campaign_name,' . META_INSIGHT_FIELDS, 'sort' => 'spend_descending']);

        // The site's own paid live orders over the same days, every sale from ads or not.
        [$from, $to] = meta_period_range($period);
        $sql = "SELECT COUNT(*) n, COALESCE(SUM(amount_bdt), 0) total FROM orders
                WHERE status = 'completed' AND bkash_env = 'live' AND amount_bdt > 0 AND paid_at < ?" . ($from ? ' AND paid_at >= ?' : '');
        $site = q($sql, $from ? [$to, $from] : [$to])->fetch();
        $row = $total['data'][0] ?? null;
        send_json([
            'connected' => true, 'period' => $period,
            'account' => ['id' => $s['ad_account_id'], 'name' => $account['name'] ?? null, 'currency' => $account['currency'] ?? null, 'active' => ($account['account_status'] ?? 0) === 1],
            'total' => meta_summary($row), 'hasData' => $row !== null,
            'campaigns' => array_map(fn($r) => ['id' => $r['campaign_id'] ?? null, 'name' => $r['campaign_name'] ?? null] + meta_summary($r), $campaigns['data'] ?? []),
            'campaignsError' => graph_error($campaigns),
            'site' => ['orders' => (int)$site['n'], 'revenue' => (int)$site['total']],
        ]);
    }

    if ($action === 'test') {
        $code = trim((string)($b->test_event_code ?? ''));
        // Without a code a "test" would land in the real data as a genuine visit.
        if (!preg_match('/^TEST\w{2,}$/i', $code)) fn_fail('Copy the test code from Events Manager → Test events. It starts with TEST.', 400);
        if ($s['pixel_id'] === '') fn_fail('Save a Pixel ID first.', 400);
        if ($s['token'] === '') fn_fail('The server has no access token yet. Ask your developer.', 400);
        $live = ['enabled' => true] + $s;   // a test goes out even while tracking is off

        // Every server event, built exactly as the real ones are, but always with the
        // ADMIN's own details: a test has no business sending a customer's.
        $me = meta_account($ctx->uid()) + ['fbp' => $b->fbp ?? null, 'fbc' => $b->fbc ?? null] + meta_request_user();
        $site = rtrim((string)config('site_url'), '/');
        $events = [['event_name' => 'PageView', 'event_id' => 'test_' . uuid4(), 'event_source_url' => "$site/", 'user' => $me]];
        $course = q('SELECT id, title_bn, title_en, price_bdt, is_free FROM courses WHERE is_published = 1 ORDER BY sort_order LIMIT 1')->fetch();
        if ($course) {
            $item = ['id' => $course['id'], 'kind' => 'course', 'title' => $course['title_bn'] ?: $course['title_en'], 'price' => $course['is_free'] ? 0 : (int)$course['price_bdt']];
            $events[] = ['event_id' => 'test_' . uuid4()] + meta_initiate_checkout('x', $item, 1, $me, "$site/");
        }
        $events[] = ['event_id' => 'test_' . uuid4(), 'user' => $me] + meta_registration($ctx->uid(), [], "$site/");
        $last = q("SELECT id FROM orders WHERE status = 'completed' AND bkash_env = 'live' AND amount_bdt > 0 ORDER BY paid_at DESC LIMIT 1")->fetchColumn();
        if ($last && ($e = meta_purchase($last, []))) $events[] = ['event_id' => 'test_' . uuid4(), 'user' => $me] + $e;

        $out = [];
        foreach ($events as $e) {
            $r = meta_send($live, $e, $code);
            $out[] = ['name' => $e['event_name'], 'ok' => $r['ok'], 'error' => $r['body']['error']['message'] ?? ($r['skipped'] ?? null)];
        }
        send_json(['events' => $out]);
    }
    fn_fail('Unknown action.', 400);
}
