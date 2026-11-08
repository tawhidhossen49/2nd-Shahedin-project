<?php
/**
 * File uploads from the admin panel (what Supabase Storage's "media" bucket did).
 *
 *   POST /storage/upload   multipart: bucket=media, path=<folder>/<name>.<ext>, file
 *
 * Files land in ~/api.shahedin.com/media/<path> and are served from
 * https://api.shahedin.com/media/<path>. Safety rules, because an upload folder
 * is the classic way into a PHP server:
 *  - admins only (the same rule Supabase had);
 *  - a fixed list of picture, video and document types, checked by name AND by
 *    the file's real contents, so a script renamed to .jpg is refused;
 *  - the path is checked character by character: no "..", no hidden files;
 *  - never overwrites (every upload already gets a new name);
 *  - media/.htaccess refuses to run or serve anything script-like in that folder.
 */
declare(strict_types=1);

const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;   // the same limit admin-common.js tells the admin about

/** Allowed extension => the content types its real contents may have. */
const UPLOAD_TYPES = [
    'jpg' => ['image/jpeg'], 'jpeg' => ['image/jpeg'], 'png' => ['image/png'], 'webp' => ['image/webp'],
    'gif' => ['image/gif'], 'avif' => ['image/avif'],
    'mp4' => ['video/mp4'], 'm4v' => ['video/mp4', 'video/x-m4v'], 'webm' => ['video/webm'], 'mov' => ['video/quicktime'],
    'pdf' => ['application/pdf'],
    'zip' => ['application/zip'], 'epub' => ['application/epub+zip', 'application/zip'],
];

function storage_upload(): never
{
    $ctx = current_ctx();
    if (!$ctx->isAdmin()) throw new ApiError('new row violates row-level security policy', 403, '42501');

    if (($_POST['bucket'] ?? '') !== 'media') throw new ApiError('Bucket not found', 404, 'NoSuchBucket');
    $path = (string)($_POST['path'] ?? '');
    if (!preg_match('#^[a-z0-9-]{1,40}/[A-Za-z0-9][A-Za-z0-9._-]{0,150}$#', $path) || str_contains($path, '..')) {
        throw new ApiError('Invalid file name.', 400, 'InvalidKey');
    }
    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    if (!isset(UPLOAD_TYPES[$ext])) throw new ApiError("Files of type .$ext cannot be uploaded.", 415, 'invalid_mime_type');

    $f = $_FILES['file'] ?? null;
    if (!$f || ($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) {
        $tooBig = in_array($f['error'] ?? 0, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true);
        throw new ApiError($tooBig ? 'The file is too big.' : 'The file did not arrive. Try again.', $tooBig ? 413 : 400, $tooBig ? 'EntityTooLarge' : 'upload_failed');
    }
    if ($f['size'] > UPLOAD_MAX_BYTES) throw new ApiError('The file is too big (the limit is 50 MB).', 413, 'EntityTooLarge');

    // What the file really is, from its first bytes, not from its name.
    $real = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']) ?: '';
    if (!in_array($real, UPLOAD_TYPES[$ext], true)) {
        throw new ApiError("This file is not really a .$ext file.", 415, 'invalid_mime_type');
    }

    $dest = dirname(__DIR__) . '/api.shahedin.com/media/' . $path;
    if (file_exists($dest)) throw new ApiError('The resource already exists', 409, 'Duplicate');
    if (!is_dir(dirname($dest)) && !mkdir(dirname($dest), 0755, true)) throw new ApiError('Could not save the file.', 500, 'upload_failed');
    if (!move_uploaded_file($f['tmp_name'], $dest)) throw new ApiError('Could not save the file.', 500, 'upload_failed');
    chmod($dest, 0644);
    send_json(['path' => $path, 'Key' => "media/$path"]);
}
