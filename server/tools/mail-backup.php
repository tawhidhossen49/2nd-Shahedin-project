<?php
/**
 * The off-server copy: locks a backup with a password and emails it.
 * backup.sh runs this once a week (Sundays).
 *
 *   php mail-backup.php <backup.sql.gz>
 *
 * The password is in ~/shahedin-private/.backup-pass (made once, kept by the
 * site owner too). Without it the emailed file is useless to anyone else.
 * To open a copy:
 *   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in FILE.enc -out FILE.sql.gz -pass pass:'THE PASSWORD'
 * Command line only.
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit(1);

$src = $argv[1] ?? '';
$pass = getenv('HOME') . '/shahedin-private/.backup-pass';
$cfg = require getenv('HOME') . '/shahedin-private/config.php';
$to = (string)($cfg['backup_email'] ?? '');
if (!is_file($src) || !is_file($pass) || !filter_var($to, FILTER_VALIDATE_EMAIL)) { fwrite(STDERR, "mail-backup: missing backup file, password file or backup_email\n"); exit(1); }

$enc = $src . '.enc';
exec('openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in ' . escapeshellarg($src) . ' -out ' . escapeshellarg($enc) . ' -pass file:' . escapeshellarg($pass), $out, $code);
if ($code !== 0 || !is_file($enc)) { fwrite(STDERR, "mail-backup: encryption failed\n"); exit(1); }

$name = basename($enc);
$boundary = 'b' . bin2hex(random_bytes(12));
$date = gmdate('Y-m-d');
$size = round(filesize($enc) / 1024) . ' KB';
$body = "--$boundary\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n"
    . "Weekly database backup of shahedin.com ($date, $size).\r\n\r\n"
    . "Keep this email. The file is locked with the backup password; it is only needed if the server is ever lost.\r\n"
    . "Nightly copies are also kept on the server for 14 days.\r\n\r\n"
    . "--$boundary\r\nContent-Type: application/octet-stream; name=\"$name\"\r\nContent-Transfer-Encoding: base64\r\n"
    . "Content-Disposition: attachment; filename=\"$name\"\r\n\r\n"
    . chunk_split(base64_encode(file_get_contents($enc))) . "--$boundary--\r\n";
$headers = "From: Shahedin Backups <backup@api.shahedin.com>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"$boundary\"";
$sent = mail($to, "Shahedin weekly backup $date", $body, $headers);
unlink($enc);
if (!$sent) { fwrite(STDERR, "mail-backup: the email could not be sent\n"); exit(1); }
echo "mailed $name ($size) to $to\n";
