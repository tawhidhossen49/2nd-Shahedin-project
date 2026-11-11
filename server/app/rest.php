<?php
/**
 * The data API: what supabase.from("table")... did. The website's scripts send
 * a small JSON description of the query (built by js/api-client.js):
 *
 *   { table, method: select|insert|update|upsert|delete, columns: "*" | "a,b,courses(x)",
 *     filters: [[column, op, value]], order: [[column, ascending]], limit, offset,
 *     count: "exact", head: bool, values: {...} | [{...}], on_conflict: "a,b",
 *     returning: bool, single: "single" | "maybe" }
 *
 * Every table must have rules in policies.php, every column must exist in the
 * database, and every value is bound as a parameter, so nothing a visitor
 * sends is ever pasted into SQL.
 */
declare(strict_types=1);

const MAX_ROWS = 1000;   // Supabase's limit per request; the admin pages read in pages of 1000

/** Primary key column of each table. */
const PKS = ['home_content' => 'key', 'site_settings' => 'key', 'coupons' => 'code'];

/** The joins the website uses: a row with its course's title. */
const EMBEDS = [
    'enrollments' => ['courses' => 'course_id'],
    'orders' => ['courses' => 'item_id'],
    'course_reviews' => ['courses' => 'course_id'],
];

/** Column name => type ('bool' | 'json' | 'datetime' | 'int' | 'decimal' | 'text') for every table. */
function column_types(): array
{
    static $types = null;
    if ($types !== null) return $types;
    $cacheKey = 'shahedin_types_v2';
    if (function_exists('apcu_fetch')) {
        $cached = apcu_fetch($cacheKey, $ok);
        if ($ok) return $types = $cached;
    }
    $types = [];
    foreach (q("SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY ORDINAL_POSITION") as $r) {
        $t = match (true) {
            $r['COLUMN_TYPE'] === 'tinyint(1)' => 'bool',
            in_array($r['DATA_TYPE'], ['int', 'bigint', 'smallint'], true) => 'int',
            $r['DATA_TYPE'] === 'decimal' => 'decimal',
            $r['DATA_TYPE'] === 'datetime' => 'datetime',
            default => 'text',
        };
        $types[$r['TABLE_NAME']][$r['COLUMN_NAME']] = $t;
    }
    // MariaDB stores JSON as longtext with a json_valid() check named after the column.
    foreach (q("SELECT TABLE_NAME, CONSTRAINT_NAME FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CHECK_CLAUSE LIKE 'json_valid(%'") as $r) {
        $types[$r['TABLE_NAME']][$r['CONSTRAINT_NAME']] = 'json';
    }
    if (function_exists('apcu_store')) apcu_store($cacheKey, $types, 300);
    return $types;
}

function pk_of(string $table): string
{
    return PKS[$table] ?? 'id';
}

/** A value from the website, ready for MySQL. */
function to_db($value, string $type)
{
    if ($value === null) return null;
    switch ($type) {
        case 'bool': return $value === true || $value === 1 || $value === '1' || $value === 'true' ? 1 : 0;
        case 'json': return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
        case 'datetime':
            try {
                return (new DateTimeImmutable((string)$value))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s.u');
            } catch (Exception) {
                throw new ApiError('invalid input syntax for type timestamp with time zone: "' . substr((string)$value, 0, 40) . '"', 400, '22007');
            }
        case 'int': return is_bool($value) ? (int)$value : (is_numeric($value) ? (int)$value : $value);
        default: return is_scalar($value) ? (string)$value : json_encode($value, JSON_UNESCAPED_UNICODE);
    }
}

/** A value from MySQL, in the form Supabase would have sent it. */
function from_db($value, string $type)
{
    if ($value === null) return null;
    return match ($type) {
        'bool' => (bool)$value,
        'json' => json_decode((string)$value),
        'datetime' => iso((string)$value),
        'int' => (int)$value,
        'decimal' => (float)$value,
        default => $value,
    };
}

function row_out(array $row, string $table): array
{
    $types = column_types()[$table];
    foreach ($row as $k => $v) {
        if (isset($types[$k])) $row[$k] = from_db($v, $types[$k]);
    }
    return $row;
}

function no_column(string $table, string $col): ApiError
{
    return new ApiError("Could not find the '$col' column of '$table' in the schema cache", 400, 'PGRST204');
}

function qi(string $col): string
{
    return '`' . str_replace('`', '', $col) . '`';
}

/** "a, b, courses(x, y)" -> [['a','b'], ['courses' => ['x','y']]] */
function parse_columns(string $spec, string $table, array $types): array
{
    $cols = [];
    $embeds = [];
    $spec = trim($spec) === '' ? '*' : $spec;
    if (!preg_match_all('/\s*([A-Za-z_][A-Za-z0-9_]*|\*)\s*(?:\(([^()]*)\))?\s*(?:,|$)/', $spec, $m, PREG_SET_ORDER)) {
        throw new ApiError("Could not parse the select list", 400, 'PGRST100');
    }
    foreach ($m as $part) {
        $name = $part[1];
        if (isset($part[2]) && $part[2] !== '') {
            if (!isset(EMBEDS[$table][$name])) throw new ApiError("Could not find a relationship between '$table' and '$name'", 400, 'PGRST200');
            $embeds[$name] = array_map('trim', explode(',', $part[2]));
        } elseif ($name === '*') {
            $cols = array_merge($cols, array_keys($types));
        } else {
            if (!isset($types[$name])) throw new ApiError("column $table.$name does not exist", 400, '42703');
            $cols[] = $name;
        }
    }
    return [array_values(array_unique($cols)), $embeds];
}

/** WHERE clause from the filters plus the caller's row rule. */
function build_where(array $filters, array $types, ?array $policy, string $table): array
{
    if ($policy === NONE) return ['0', []];
    $sql = [$policy[0]];
    $params = $policy[1];
    foreach ($filters as $f) {
        [$col, $op, $val] = array_pad((array)$f, 3, null);
        if (!is_string($col) || !isset($types[$col])) throw new ApiError("column $table." . (string)$col . " does not exist", 400, '42703');
        $type = $types[$col];
        $c = 't.' . qi($col);
        switch ($op) {
            case 'eq': case 'neq': case 'gt': case 'gte': case 'lt': case 'lte':
                if ($val === null) throw new ApiError("Use .is() to compare with null", 400, 'PGRST100');
                $sql[] = $c . ['eq' => ' = ?', 'neq' => ' <> ?', 'gt' => ' > ?', 'gte' => ' >= ?', 'lt' => ' < ?', 'lte' => ' <= ?'][$op];
                $params[] = to_db($val, $type);
                break;
            case 'in':
                $list = array_values((array)$val);
                if (!$list) { $sql[] = '0'; break; }
                $sql[] = "$c IN (" . implode(',', array_fill(0, count($list), '?')) . ')';
                foreach ($list as $v) $params[] = to_db($v, $type);
                break;
            case 'is':
                $sql[] = $val === null ? "$c IS NULL" : ($val ? "$c = 1" : "$c = 0");
                break;
            case 'like': case 'ilike':
                // MySQL's comparison here is already case-insensitive (utf8mb4_unicode_ci).
                $sql[] = "$c LIKE ?";
                $params[] = (string)$val;
                break;
            default:
                throw new ApiError("Unsupported filter: " . (string)$op, 400, 'PGRST100');
        }
    }
    return [implode(' AND ', array_map(fn($s) => "($s)", $sql)), $params];
}

function rest_handle(stdClass $req): array
{
    $ctx = current_ctx();
    $name = (string)($req->table ?? '');
    $rules = policies()[$name] ?? null;
    if (!$rules) throw new ApiError("Could not find the table 'public.$name' in the schema cache", 404, 'PGRST205');
    $table = $rules['view'] ?? $name;
    $types = column_types()[$table] ?? [];
    $method = (string)($req->method ?? 'select');
    $filters = is_array($req->filters ?? null) ? $req->filters : [];

    if (isset($rules['view']) && $method !== 'select') throw new ApiError("cannot change view $name", 405, '42501');

    return match ($method) {
        'select' => rest_select($ctx, $name, $table, $rules, $types, $req, $filters),
        'insert', 'upsert' => rest_write_rows($ctx, $name, $rules, $types, $req, $method === 'upsert'),
        'update' => rest_update($ctx, $name, $rules, $types, $req, $filters),
        'delete' => rest_delete($ctx, $name, $rules, $types, $req, $filters),
        default => throw new ApiError("Unknown method $method", 400, 'PGRST100'),
    };
}

function rest_select(Ctx $ctx, string $name, string $table, array $rules, array $types, stdClass $req, array $filters): array
{
    [$cols, $embeds] = parse_columns((string)($req->columns ?? '*'), $table, $types);
    $policy = isset($rules['select']) ? $rules['select']($ctx) : NONE;
    [$where, $params] = build_where($filters, $types, $policy, $name);

    $count = null;
    if (($req->count ?? null) === 'exact') {
        $count = (int)q("SELECT COUNT(*) FROM `$table` t WHERE $where", $params)->fetchColumn();
        if (!empty($req->head)) return ['data' => null, 'count' => $count];
    }

    // The views need these to decide what to hide, even when not asked for.
    $need = $name === 'courses_safe' ? ['id', 'is_free'] : ($name === 'products_safe' ? ['id', 'type'] : []);
    foreach (array_keys($embeds) as $e) $need[] = EMBEDS[$table][$e];
    $sqlCols = array_values(array_unique(array_merge($cols, $need)));

    $order = [];
    foreach ((array)($req->order ?? []) as $o) {
        [$col, $asc] = array_pad((array)$o, 2, true);
        if (!is_string($col) || !isset($types[$col])) throw new ApiError("column $name.$col does not exist", 400, '42703');
        $order[] = 't.' . qi($col) . ($asc === false ? ' DESC' : ' ASC');
    }
    $limit = min(MAX_ROWS, max(0, (int)($req->limit ?? MAX_ROWS)));
    $offset = max(0, (int)($req->offset ?? 0));

    $sql = 'SELECT ' . implode(',', array_map(fn($c) => 't.' . qi($c), $sqlCols)) . " FROM `$table` t WHERE $where"
         . ($order ? ' ORDER BY ' . implode(', ', $order) : '') . " LIMIT $limit OFFSET $offset";
    $rows = array_map(fn($r) => row_out($r, $table), q($sql, $params)->fetchAll());

    foreach ($embeds as $embed => $embedCols) $rows = attach_embed($ctx, $rows, $table, $embed, $embedCols);
    if (isset($rules['view'])) $rows = array_map(fn($r) => apply_view($name, $r, $ctx), $rows);

    $drop = array_diff($need, $cols);
    if ($drop) $rows = array_map(fn($r) => array_diff_key($r, array_flip($drop)), $rows);
    return ['data' => single_or_list($rows, $req), 'count' => $count];
}

/** enrolments -> courses(title...). The course comes back as null when the caller may not read it, as in Supabase. */
function attach_embed(Ctx $ctx, array $rows, string $table, string $embed, array $embedCols): array
{
    $fk = EMBEDS[$table][$embed];
    $etypes = column_types()[$embed];
    foreach ($embedCols as $c) {
        if ($c !== '*' && !isset($etypes[$c])) throw new ApiError("column $embed.$c does not exist", 400, '42703');
    }
    $cols = in_array('*', $embedCols, true) ? array_keys($etypes) : $embedCols;
    $ids = array_values(array_unique(array_filter(array_column($rows, $fk))));
    $found = [];
    if ($ids) {
        $policy = policies()[$embed]['select']($ctx);
        [$where, $params] = build_where([['id', 'in', $ids]], $etypes, $policy, $embed);
        foreach (q('SELECT t.id AS __id,' . implode(',', array_map(fn($c) => 't.' . qi($c), $cols)) . " FROM `$embed` t WHERE $where", $params) as $r) {
            $id = $r['__id'];
            unset($r['__id']);
            $found[$id] = row_out($r, $embed);
        }
    }
    foreach ($rows as &$row) $row[$embed] = $found[$row[$fk] ?? ''] ?? null;
    return $rows;
}

function single_or_list(array $rows, stdClass $req)
{
    $mode = $req->single ?? null;
    if ($mode === 'single') {
        if (count($rows) !== 1) throw new ApiError('JSON object requested, multiple (or no) rows returned', 406, 'PGRST116', 'The result contains ' . count($rows) . ' rows');
        return $rows[0];
    }
    if ($mode === 'maybe') {
        if (count($rows) > 1) throw new ApiError('JSON object requested, multiple (or no) rows returned', 406, 'PGRST116', 'The result contains ' . count($rows) . ' rows');
        return $rows[0] ?? null;
    }
    return $rows;
}

/** Only known columns, and only the ones this caller may set. */
function clean_values(stdClass|array $values, string $table, array $types, ?array $allowed): array
{
    $row = [];
    foreach ((array)$values as $k => $v) {
        if (!isset($types[$k])) throw no_column($table, (string)$k);
        if ($allowed !== null && !in_array($k, $allowed, true)) throw new ApiError("permission denied for table $table", 403, '42501');
        $row[$k] = $v;
    }
    return $row;
}

function rls_error(string $table): ApiError
{
    return new ApiError("new row violates row-level security policy for table \"$table\"", 403, '42501');
}

function fetch_by_pk(string $table, array $pks): array
{
    if (!$pks) return [];
    $pk = pk_of($table);
    return q("SELECT * FROM `$table` WHERE " . qi($pk) . ' IN (' . implode(',', array_fill(0, count($pks), '?')) . ')', $pks)->fetchAll();
}

/** activity_log, for courses and products (Supabase's log_activity trigger). */
function log_change(Ctx $ctx, string $table, string $action, ?array $old, ?array $new): void
{
    $id = $new['id'] ?? $old['id'] ?? null;
    $enc = fn($r) => $r === null ? null : json_encode(row_out($r, $table), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    q('INSERT INTO activity_log (table_name, record_id, action, changed_by, changed_by_email, old_data, new_data) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [$table, $id, $action, $ctx->uid(), $ctx->user['email'] ?? null, $enc($old), $enc($new)]);
}

function in_transaction(callable $fn)
{
    $db = db();
    $db->beginTransaction();
    try {
        $result = $fn();
        $db->commit();
        return $result;
    } catch (Throwable $e) {
        $db->rollBack();
        if ($e instanceof PDOException) throw db_error($e);
        throw $e;
    }
}

function rest_write_rows(Ctx $ctx, string $table, array $rules, array $types, stdClass $req, bool $upsert): array
{
    $values = $req->values ?? null;
    $list = is_array($values) ? $values : [$values];
    if (!$list || in_array(null, $list, true)) throw new ApiError('Nothing to save.', 400, 'PGRST102');
    $pk = pk_of($table);
    $conflict = $upsert ? array_filter(array_map('trim', explode(',', (string)($req->on_conflict ?? $pk)))) : [];
    foreach ($conflict as $c) if (!isset($types[$c])) throw no_column($table, $c);

    $saved = in_transaction(function () use ($ctx, $table, $rules, $types, $list, $pk, $conflict) {
        $saved = [];
        foreach ($list as $values) {
            if (!$values instanceof stdClass) throw new ApiError('Each row must be an object.', 400, 'PGRST102');
            $row = (array)$values;

            // Upsert: a row that already exists is an update, with update's rules.
            if ($conflict) {
                $match = [];
                foreach ($conflict as $c) {
                    if (!array_key_exists($c, $row)) { $match = null; break; }
                    $match[] = [$c, 'eq', $row[$c]];
                }
                if ($match) {
                    [$w, $p] = build_where($match, $types, ALL, $table);
                    $existing = q("SELECT * FROM `$table` t WHERE $w FOR UPDATE", $p)->fetch();
                    if ($existing) {
                        $changes = array_diff_key($row, array_flip($conflict));
                        if ($changes) {
                            $done = update_rows($ctx, $table, $rules, $types, [$existing], (object)$changes);
                            if (!$done) throw rls_error($table);   // the row exists but is not this caller's to change
                            $saved[] = $done[0];
                        } else {
                            // Nothing to change, but like Postgres the row must still be the caller's
                            // to update, or an upsert would read back someone else's row.
                            $policy = isset($rules['update']) ? $rules['update']($ctx) : NONE;
                            [$w2, $p2] = build_where([[$pk, 'eq', $existing[$pk]]], $types, $policy, $table);
                            if (!q("SELECT 1 FROM `$table` t WHERE $w2", $p2)->fetch()) throw rls_error($table);
                            $saved[] = $existing;
                        }
                        continue;
                    }
                }
            }

            $allowed = isset($rules['insert_cols']) ? $rules['insert_cols']($ctx) : null;
            $row = clean_values($row, $table, $types, $allowed);
            if (!isset($rules['insert']) || !$rules['insert']($ctx, $row)) throw rls_error($table);
            if ($pk === 'id' && empty($row['id']) && ($types['id'] ?? '') === 'text') $row['id'] = uuid4();

            $cols = array_keys($row);
            q("INSERT INTO `$table` (" . implode(',', array_map('qi', $cols)) . ') VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ')',
              array_map(fn($c) => to_db($row[$c], $types[$c]), $cols));
            $key = $row[$pk] ?? db()->lastInsertId();
            $new = fetch_by_pk($table, [$key])[0] ?? null;
            if (!empty($rules['log']) && $new) log_change($ctx, $table, 'insert', null, $new);
            $saved[] = $new;
        }
        return $saved;
    });

    if (empty($req->returning)) return ['data' => null, 'count' => null];
    return ['data' => single_or_list(array_map(fn($r) => row_out($r, $table), array_filter($saved)), $req), 'count' => null];
}

/** Apply $changes to rows already selected FOR UPDATE, checking the rules for each. */
function update_rows(Ctx $ctx, string $table, array $rules, array $types, array $rows, stdClass $changes): array
{
    $allowed = isset($rules['update_cols']) ? $rules['update_cols']($ctx) : null;
    $set = clean_values($changes, $table, $types, $allowed);
    if (!$set) return $rows;
    if (!isset($rules['update'])) throw rls_error($table);
    // The row must be one this caller may change at all...
    $policy = $rules['update']($ctx);
    $pk = pk_of($table);
    $keys = array_column($rows, $pk);
    [$w, $p] = build_where([[$pk, 'in', $keys]], $types, $policy, $table);
    $mayChange = array_flip(array_column(q("SELECT t." . qi($pk) . " AS k FROM `$table` t WHERE $w", $p)->fetchAll(), 'k'));

    $out = [];
    foreach ($rows as $old) {
        if (!isset($mayChange[$old[$pk]])) continue;
        // ...and must still be allowed after the change.
        $merged = array_merge(row_out($old, $table), $set);
        if (isset($rules['check']) && !$rules['check']($ctx, $merged)) throw rls_error($table);
        $cols = array_keys($set);
        q("UPDATE `$table` SET " . implode(',', array_map(fn($c) => qi($c) . ' = ?', $cols)) . ' WHERE ' . qi($pk) . ' = ?',
          [...array_map(fn($c) => to_db($set[$c], $types[$c]), $cols), $old[$pk]]);
        $new = fetch_by_pk($table, [$old[$pk]])[0];
        if (!empty($rules['log'])) log_change($ctx, $table, 'update', $old, $new);
        $out[] = $new;
    }
    return $out;
}

function rest_update(Ctx $ctx, string $table, array $rules, array $types, stdClass $req, array $filters): array
{
    // Supabase refuses an update or delete with no filter at all; so do we.
    if (!$filters) throw new ApiError('UPDATE requires a WHERE clause', 400, '21000');
    if (!($req->values ?? null) instanceof stdClass) throw new ApiError('Nothing to save.', 400, 'PGRST102');
    $policy = isset($rules['update']) ? $rules['update']($ctx) : NONE;
    [$where, $params] = build_where($filters, $types, $policy, $table);
    $rows = in_transaction(function () use ($ctx, $table, $rules, $types, $req, $where, $params) {
        $rows = q("SELECT * FROM `$table` t WHERE $where FOR UPDATE", $params)->fetchAll();
        return update_rows($ctx, $table, $rules, $types, $rows, $req->values);
    });
    if (empty($req->returning)) return ['data' => null, 'count' => null];
    return ['data' => single_or_list(array_map(fn($r) => row_out($r, $table), $rows), $req), 'count' => null];
}

function rest_delete(Ctx $ctx, string $table, array $rules, array $types, stdClass $req, array $filters): array
{
    if (!$filters) throw new ApiError('DELETE requires a WHERE clause', 400, '21000');
    $policy = isset($rules['delete']) ? $rules['delete']($ctx) : NONE;
    [$where, $params] = build_where($filters, $types, $policy, $table);
    $rows = in_transaction(function () use ($ctx, $table, $rules, $where, $params) {
        $rows = q("SELECT * FROM `$table` t WHERE $where FOR UPDATE", $params)->fetchAll();
        if ($rows) {
            $pk = pk_of($table);
            $keys = array_column($rows, $pk);
            q("DELETE FROM `$table` WHERE " . qi($pk) . ' IN (' . implode(',', array_fill(0, count($keys), '?')) . ')', $keys);
            if (!empty($rules['log'])) foreach ($rows as $old) log_change($ctx, $table, 'delete', $old, null);
        }
        return $rows;
    });
    if (empty($req->returning)) return ['data' => null, 'count' => null];
    return ['data' => single_or_list(array_map(fn($r) => row_out($r, $table), $rows), $req), 'count' => null];
}
