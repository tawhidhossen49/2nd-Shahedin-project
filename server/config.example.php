<?php
/**
 * The API's settings. The real file is ~/shahedin-private/config.php on the
 * server, outside the website folder and never in git. This copy shows its
 * shape only. Every value here is a placeholder.
 */
return [
    // The addresses allowed to use the API from a browser. The first one is
    // where a login lands when no other page is given.
    'allowed_origins' => [
        'https://www.shahedin.com',
        'https://shahedin.com',
        'https://2nd-shahedin-project.vercel.app',
    ],
    'api_url' => 'https://api.shahedin.com',
    'media_url' => 'https://api.shahedin.com/media',

    // Random, long, made once on the server. Signs SMS codes and the Google login cookie.
    'app_secret' => 'CHANGE-ME',

    // Where bKash sends the customer back to (payment-status page).
    'site_url' => 'https://www.shahedin.com',

    'bulksmsbd' => ['api_key' => '', 'sender_id' => ''],
    'google' => ['client_id' => '', 'client_secret' => ''],
    // base_url must be https://tokenized.pay.bka.sh/v2 (bKash's sheet says v1.2.0-beta; this code speaks v2).
    'bkash' => ['base_url' => '', 'app_key' => '', 'app_secret' => '', 'username' => '', 'password' => ''],
    'meta' => ['capi_token' => '', 'ads_read_token' => ''],
];
