<?php
/**
 * Who may read and change what. These are the Supabase database's row level
 * security policies (72 of them, read from the live database on 2026-11-07),
 * written out per table. The API refuses any table that is not listed here.
 *
 * For each table:
 *   select  fn(Ctx): ?array   [SQL condition, params] for the rows this caller may read;
 *                             null = none. Columns are written as t.col.
 *   insert  fn(Ctx, array $row): bool     may this caller add this row?
 *   update  fn(Ctx): ?array               which rows may this caller change?
 *   check   fn(Ctx, array $row): bool     is the row still allowed after the change?
 *   delete  fn(Ctx): ?array               which rows may this caller delete?
 *   insert_cols / update_cols  fn(Ctx): ?array   columns a caller may set (null = any)
 *   view    the real table behind a read-only view (courses_safe, products_safe)
 *   log     true to record every change in activity_log (Supabase's log_activity)
 *
 * A rule that is missing means "nobody", exactly as in Postgres.
 */
declare(strict_types=1);

const ALL = ['1', []];
const NONE = null;

function own(string $col = 'user_id'): Closure
{
    return fn(Ctx $c) => $c->uid() ? ["t.$col = ?", [$c->uid()]] : NONE;
}

function admin_page(string $page): Closure
{
    return fn(Ctx $c) => $c->can($page) ? ALL : NONE;
}

/** Either rule's rows: Postgres combines several policies for one action with OR. */
function any_of(Closure ...$rules): Closure
{
    return function (Ctx $c) use ($rules) {
        $sql = [];
        $params = [];
        foreach ($rules as $r) {
            $w = $r($c);
            if ($w === NONE) continue;
            if ($w[0] === '1') return ALL;
            $sql[] = '(' . $w[0] . ')';
            array_push($params, ...$w[1]);
        }
        return $sql ? [implode(' OR ', $sql), $params] : NONE;
    };
}

/** Supabase's course_is_free(): free (or ৳0), open, and before any deadline. */
function course_is_free(?string $courseId): bool
{
    if (!$courseId) return false;
    return (bool)q('SELECT 1 FROM courses WHERE id = ? AND (is_free = 1 OR price_bdt <= 0) AND enrollment_open = 1
                    AND (enrollment_deadline IS NULL OR enrollment_deadline > UTC_TIMESTAMP(6))', [$courseId])->fetchColumn();
}

/** site_settings keys belong to different admin pages. */
function settings_page(string $key): string
{
    return match ($key) { 'community' => 'community', 'legal' => 'legal', 'meta_pixel' => 'ads', default => 'settings' };
}

function home_content_allowed(Ctx $c, string $key): bool
{
    return $c->can('home') || ($c->can('portfolio') && ($key === 'stats' || str_starts_with($key, 'portfolio')));
}

function policies(): array
{
    $isAdmin = fn(Ctx $c) => $c->isAdmin() ? ALL : NONE;
    $everyone = fn(Ctx $c) => ALL;

    return [
        'activity_log' => [
            'select' => $isAdmin,
        ],

        'admins' => [
            // Your own row, or every row for a main admin. Changes go through
            // the admin_* functions in rpc.php, never straight to the table.
            'select' => any_of(own('id'), fn(Ctx $c) => $c->isMain() ? ALL : NONE),
        ],

        'bkash_api_log' => [
            'select' => admin_page('orders'),
        ],

        'contact_submissions' => [
            'insert' => fn(Ctx $c, array $r) => true,                // anyone may send the contact form
            'insert_cols' => fn(Ctx $c) => $c->can('submissions') ? null
                : ['name', 'email', 'inquiry_type', 'message', 'preferred_date', 'source_page'],
            'select' => admin_page('submissions'),
            'update' => admin_page('submissions'),
            'check' => fn(Ctx $c, array $r) => $c->can('submissions'),
            'delete' => admin_page('submissions'),
        ],

        'coupons' => [
            'select' => admin_page('coupons'),
            'insert' => fn(Ctx $c, array $r) => $c->can('coupons'),
            'update' => admin_page('coupons'),
            'check' => fn(Ctx $c, array $r) => $c->can('coupons'),
            'delete' => admin_page('coupons'),
        ],

        'course_reviews' => [
            'select' => any_of(fn(Ctx $c) => ['t.is_approved = 1', []], own(), $isAdmin, admin_page('reviews')),
            // A student may review a course they finished, as themselves.
            'insert' => fn(Ctx $c, array $r) => $c->can('reviews') || (
                $c->uid() !== null && ($r['user_id'] ?? null) === $c->uid()
                && (bool)q('SELECT 1 FROM enrollments WHERE user_id = ? AND course_id = ? AND completed = 1', [$c->uid(), $r['course_id'] ?? ''])->fetchColumn()
            ),
            'insert_cols' => fn(Ctx $c) => $c->can('reviews') ? null : ['course_id', 'user_id', 'student_name', 'rating', 'review_text'],
            'update' => any_of(own(), admin_page('reviews')),
            'update_cols' => fn(Ctx $c) => $c->can('reviews') ? null : ['student_name', 'rating', 'review_text'],
            'check' => fn(Ctx $c, array $r) => $c->can('reviews') || ($r['user_id'] ?? null) === $c->uid(),
            'delete' => any_of(own(), admin_page('reviews')),
        ],

        // The raw table is for the admin panel. Visitors read courses_safe.
        'courses' => [
            'select' => $isAdmin,
            'insert' => fn(Ctx $c, array $r) => $c->can('courses'),
            'update' => admin_page('courses'),
            'check' => fn(Ctx $c, array $r) => $c->can('courses'),
            'delete' => admin_page('courses'),
            'log' => true,
        ],
        'courses_safe' => [
            'view' => 'courses',
            'select' => fn(Ctx $c) => $c->isAdmin() ? ALL : ['t.is_published = 1', []],
        ],

        'enrollments' => [
            'select' => any_of(own(), admin_page('students')),
            // A student may enrol themselves in a free, open course; an admin
            // may give anyone any course.
            'insert' => fn(Ctx $c, array $r) => $c->can('students')
                || ($c->uid() !== null && ($r['user_id'] ?? null) === $c->uid() && course_is_free($r['course_id'] ?? null)),
            'update' => own(),
            // Progress only. Supabase let a student change course_id here, which
            // could swap a free enrolment for a paid course; that is closed.
            'update_cols' => fn(Ctx $c) => ['completed_blocks', 'block_progress', 'completed', 'completed_at'],
            'check' => fn(Ctx $c, array $r) => ($r['user_id'] ?? null) === $c->uid(),
            'delete' => admin_page('students'),
        ],

        'home_content' => [
            'select' => $everyone,
            'insert' => fn(Ctx $c, array $r) => home_content_allowed($c, (string)($r['key'] ?? '')),
            'update' => fn(Ctx $c) => $c->can('home') ? ALL
                : ($c->can('portfolio') ? ["(t.`key` = 'stats' OR t.`key` LIKE 'portfolio%')", []] : NONE),
            'check' => fn(Ctx $c, array $r) => home_content_allowed($c, (string)($r['key'] ?? '')),
            'delete' => fn(Ctx $c) => $c->can('home') ? ALL
                : ($c->can('portfolio') ? ["(t.`key` = 'stats' OR t.`key` LIKE 'portfolio%')", []] : NONE),
        ],

        'order_refunds' => [
            'select' => admin_page('orders'),
        ],

        // Orders are only ever written by the bKash code on the server.
        'orders' => [
            'select' => any_of(own(), admin_page('orders'), admin_page('students')),
        ],

        'page_views' => [
            'insert' => fn(Ctx $c, array $r) => true,
            'insert_cols' => fn(Ctx $c) => ['page_path', 'referrer', 'lang'],
            'select' => admin_page('analytics'),
        ],

        'products' => [
            'select' => $isAdmin,
            'insert' => fn(Ctx $c, array $r) => $c->can('products'),
            'update' => admin_page('products'),
            'check' => fn(Ctx $c, array $r) => $c->can('products'),
            'delete' => admin_page('products'),
            'log' => true,
        ],
        'products_safe' => [
            'view' => 'products',
            'select' => fn(Ctx $c) => $c->isAdmin() ? ALL : ['t.is_published = 1', []],
        ],

        'profiles' => [
            'select' => any_of(own('id'), admin_page('students')),
            'update' => own('id'),
            // Name and phone follow the login itself; the rest is the student's to edit.
            'update_cols' => fn(Ctx $c) => ['email', 'city', 'address', 'institution', 'profession', 'bio'],
            'check' => fn(Ctx $c, array $r) => ($r['id'] ?? null) === $c->uid(),
        ],

        'site_settings' => [
            'select' => $everyone,
            'insert' => fn(Ctx $c, array $r) => $c->can(settings_page((string)($r['key'] ?? ''))),
            'update' => fn(Ctx $c) => settings_where($c),
            'check' => fn(Ctx $c, array $r) => $c->can(settings_page((string)($r['key'] ?? ''))),
            'delete' => fn(Ctx $c) => settings_where($c),
        ],
    ];
}

/** The site_settings rows this admin's pages cover. */
function settings_where(Ctx $c): ?array
{
    if (!$c->isAdmin()) return NONE;
    if ($c->isMain()) return ALL;
    $keys = [];
    foreach (['community' => 'community', 'legal' => 'legal', 'meta_pixel' => 'ads'] as $key => $page) {
        if ($c->can($page)) $keys[] = $key;
    }
    $special = "t.`key` IN ('community','legal','meta_pixel')";
    $parts = [];
    $params = [];
    if ($keys) {
        $parts[] = 't.`key` IN (' . implode(',', array_fill(0, count($keys), '?')) . ')';
        $params = $keys;
    }
    if ($c->can('settings')) $parts[] = "NOT $special";
    return $parts ? [implode(' OR ', $parts), $params] : NONE;
}

/**
 * What a visitor may see of a course or product row (the two "_safe" views).
 * Paid lessons are reduced to their title and a lock until the course is bought;
 * a digital product's download link only shows to someone who bought it.
 */
function apply_view(string $view, array $row, Ctx $c): array
{
    if ($view === 'courses_safe' && array_key_exists('content_blocks', $row)) {
        $open = !empty($row['is_free']) || $c->isAdmin()
            || ($c->uid() && isset($row['id']) && q('SELECT 1 FROM enrollments WHERE user_id = ? AND course_id = ?', [$c->uid(), $row['id']])->fetchColumn());
        if (!$open) {
            $blocks = is_array($row['content_blocks']) ? $row['content_blocks'] : [];
            $row['content_blocks'] = array_map(function ($b) {
                $b = (object)$b;
                if (($b->type ?? null) === 'video' && (($b->free_preview ?? null) === true || ($b->free_preview ?? null) === 'true')) return $b;
                return (object)['id' => $b->id ?? null, 'type' => $b->type ?? null, 'title' => $b->title ?? null, 'locked' => true];
            }, $blocks);
        }
    }
    if ($view === 'products_safe') {
        $owns = ($row['type'] ?? null) === 'digital' && ($c->isAdmin() || ($c->uid() && isset($row['id'])
            && q("SELECT 1 FROM orders WHERE user_id = ? AND kind = 'product' AND item_id = ? AND status = 'completed'", [$c->uid(), $row['id']])->fetchColumn()));
        if (!$owns) {
            if (array_key_exists('delivery_url', $row)) $row['delivery_url'] = null;
            if (array_key_exists('delivery_note', $row)) $row['delivery_note'] = null;
        }
    }
    return $row;
}
