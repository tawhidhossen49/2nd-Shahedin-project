<?php
/**
 * The database functions the website calls with supabase.rpc(name, args),
 * rewritten from the live Postgres definitions (2026-11-07).
 */
declare(strict_types=1);

const ADMIN_PAGE_KEYS = ['home', 'portfolio', 'courses', 'reviews', 'submissions', 'students',
                         'products', 'orders', 'coupons', 'analytics', 'community', 'legal', 'settings', 'ads'];

function rpc_handle(string $name, stdClass $a)
{
    $ctx = current_ctx();
    return match ($name) {
        'validate_coupon' => validate_coupon((string)($a->p_code ?? ''), (int)($a->p_subtotal ?? 0), isset($a->p_kind) ? (string)$a->p_kind : null),
        'admin_add_existing' => admin_add_existing($ctx, $a),
        'admin_set_access' => admin_set_access($ctx, $a),
        'admin_remove' => admin_remove($ctx, (string)($a->p_admin_id ?? '')),
        default => throw new ApiError("Could not find the function public.$name in the schema cache", 404, 'PGRST202'),
    };
}

/** Is this coupon usable, and how much does it take off? Never guesses in the buyer's favour. */
function validate_coupon(string $code, int $subtotal, ?string $kind): array
{
    $code = strtoupper(trim($code));
    if ($code === '') return ['valid' => false, 'reason' => 'empty'];
    $v = q('SELECT * FROM coupons WHERE code = ?', [$code])->fetch();
    if (!$v) return ['valid' => false, 'reason' => 'not_found'];
    if (!$v['is_active']) return ['valid' => false, 'reason' => 'inactive'];
    if ($v['expires_at'] !== null && strtotime($v['expires_at'] . ' UTC') < time()) return ['valid' => false, 'reason' => 'expired'];
    if ($v['max_uses'] !== null && (int)$v['used_count'] >= (int)$v['max_uses']) return ['valid' => false, 'reason' => 'used_up'];
    // A code for courses only (or products only) needs to be told what is being bought.
    if ($v['applies_to'] !== 'all' && $v['applies_to'] !== $kind) {
        return ['valid' => false, 'reason' => 'wrong_scope', 'applies_to' => $v['applies_to']];
    }
    if ($subtotal < (int)$v['min_order_bdt']) return ['valid' => false, 'reason' => 'min_order', 'min_order_bdt' => (int)$v['min_order_bdt']];

    $off = $v['discount_type'] === 'percent'
        ? (int)floor($subtotal * min((int)$v['discount_value'], 100) / 100)
        : (int)$v['discount_value'];
    $off = max(0, min($off, $subtotal));
    return ['valid' => true, 'code' => $v['code'], 'applies_to' => $v['applies_to'],
            'discount_type' => $v['discount_type'], 'discount_value' => (int)$v['discount_value'], 'discount_bdt' => $off];
}

function clean_permissions($list): array
{
    $list = is_array($list) ? $list : [];
    return array_values(array_unique(array_filter($list, fn($x) => is_string($x) && in_array($x, ADMIN_PAGE_KEYS, true))));
}

function admin_out(array $row): array
{
    $row = row_out($row, 'admins');
    return $row;
}

function require_main(Ctx $ctx, string $what): void
{
    if (!$ctx->isMain()) throw new ApiError("Only a main admin can $what.", 403, '42501');
}

function admin_add_existing(Ctx $ctx, stdClass $a): array
{
    require_main($ctx, 'add an admin');
    $role = (string)($a->p_role ?? '');
    if (!in_array($role, ['main', 'partial'], true)) throw new ApiError('Role must be main or partial.', 400, '22023');
    $email = strtolower(trim((string)($a->p_email ?? '')));
    return in_transaction(function () use ($a, $role, $email) {
        $user = q('SELECT id FROM users WHERE email = ?', [$email])->fetch();
        if (!$user) throw new ApiError('No login exists for that email yet.', 404, 'P0002');
        if (q('SELECT 1 FROM admins WHERE id = ?', [$user['id']])->fetchColumn()) throw new ApiError('That person is already an admin.', 409, '23505');
        $name = trim((string)($a->p_full_name ?? ''));
        q('INSERT INTO admins (id, email, full_name, role, permissions) VALUES (?, ?, ?, ?, ?)',
          [$user['id'], $email, $name === '' ? null : $name, $role, json_encode(clean_permissions($a->p_permissions ?? []))]);
        return admin_out(q('SELECT * FROM admins WHERE id = ?', [$user['id']])->fetch());
    });
}

function admin_set_access(Ctx $ctx, stdClass $a): array
{
    require_main($ctx, 'change who has access');
    $role = (string)($a->p_role ?? '');
    if (!in_array($role, ['main', 'partial'], true)) throw new ApiError('Role must be main or partial.', 400, '22023');
    $id = (string)($a->p_admin_id ?? '');
    return in_transaction(function () use ($ctx, $a, $role, $id) {
        // Locks every admin row, so two main admins demoting each other at once cannot leave nobody in charge.
        $all = q('SELECT id, role FROM admins FOR UPDATE')->fetchAll();
        $target = null;
        foreach ($all as $r) if ($r['id'] === $id) $target = $r;
        if (!$target) throw new ApiError('That admin no longer exists.', 404, 'P0002');
        if ($id === $ctx->uid() && $role !== $target['role']) throw new ApiError('You cannot change your own role. Ask another main admin.', 400, '22023');
        $mains = count(array_filter($all, fn($r) => $r['role'] === 'main'));
        if ($target['role'] === 'main' && $role !== 'main' && $mains <= 1) throw new ApiError('There must always be at least one main admin.', 400, '22023');
        $name = trim((string)($a->p_full_name ?? ''));
        q('UPDATE admins SET role = ?, permissions = ?, full_name = COALESCE(?, full_name) WHERE id = ?',
          [$role, json_encode(clean_permissions($a->p_permissions ?? [])), $name === '' ? null : $name, $id]);
        return admin_out(q('SELECT * FROM admins WHERE id = ?', [$id])->fetch());
    });
}

function admin_remove(Ctx $ctx, string $id)
{
    require_main($ctx, 'remove an admin');
    if ($id === $ctx->uid()) throw new ApiError('You cannot remove yourself.', 400, '22023');
    return in_transaction(function () use ($id) {
        $all = q('SELECT id, role FROM admins FOR UPDATE')->fetchAll();
        $target = null;
        foreach ($all as $r) if ($r['id'] === $id) $target = $r;
        if (!$target) return null;
        $mains = count(array_filter($all, fn($r) => $r['role'] === 'main'));
        if ($target['role'] === 'main' && $mains <= 1) throw new ApiError('There must always be at least one main admin.', 400, '22023');
        q('DELETE FROM admins WHERE id = ?', [$id]);
        return null;
    });
}
