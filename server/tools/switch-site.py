"""Points the website at the Stellar API instead of Supabase. Run once, from the project folder:

    python server/tools/switch-site.py

What it changes (safe to run again; it only changes what still needs it):
  - every page loads /js/api-client.js instead of the supabase-js library
  - js/supabase-config.js points at https://api.shahedin.com
  - the privacy policy and one admin hint stop saying "Supabase"
Undo with git (git checkout -- .) if it is run by mistake.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
CDN = '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>'
OURS = '<script src="/js/api-client.js"></script>'

TEXT = {
    "js/supabase-config.js": [
        (re.compile(r'window\.SUPABASE_URL = "[^"]*";'), 'window.SUPABASE_URL = "https://api.shahedin.com";'),
        # Not a secret and not checked by the server; the pages only test that it is set.
        (re.compile(r'window\.SUPABASE_ANON_KEY = "[^"]*";'), 'window.SUPABASE_ANON_KEY = "shahedin-api";'),
    ],
    "js/legal-defaults.js": [
        ("তথ্য Supabase-এ সংরক্ষিত থাকে, যা আমাদের ডেটাবেস ও হোস্টিং সেবা দেয়। ডেটাবেসে নিরাপত্তা নিয়ম (Row Level Security) চালু আছে, যার ফলে একজন ব্যবহারকারী শুধু নিজের তথ্যই দেখতে পান।",
         "তথ্য আমাদের নিজস্ব সার্ভারে (Namecheap হোস্টিং) সংরক্ষিত থাকে। সার্ভারে প্রতিটি তথ্যের জন্য নিরাপত্তা নিয়ম চালু আছে, যার ফলে একজন ব্যবহারকারী শুধু নিজের তথ্যই দেখতে পান। পাসওয়ার্ড ও লগইন টোকেন এনক্রিপ্ট করা আকারে রাখা হয়, এবং প্রতিদিন তথ্যের ব্যাকআপ নেওয়া হয়।"),
    ],
    "admin/js/admin-courses.js": [
        ("Uploaded files go to your own Supabase storage, which caps a single file at 50 MB on the free plan —",
         "Uploaded files go to the website's own server, which takes a single file of up to 50 MB —"),
    ],
}


def main() -> int:
    changed = []
    pages = sorted(ROOT.glob("*.html")) + sorted((ROOT / "admin").glob("*.html"))
    for page in pages:
        s = page.read_text(encoding="utf-8")
        if CDN in s:
            page.write_text(s.replace(CDN, OURS), encoding="utf-8", newline="")
            changed.append(page.relative_to(ROOT).as_posix())
    for rel, edits in TEXT.items():
        path = ROOT / rel
        s = before = path.read_text(encoding="utf-8")
        for old, new in edits:
            s = old.sub(new, s) if hasattr(old, "sub") else s.replace(old, new)
        if s != before:
            path.write_text(s, encoding="utf-8", newline="")
            changed.append(rel)

    left = [p.relative_to(ROOT).as_posix() for p in pages if "supabase-js" in p.read_text(encoding="utf-8")]
    print(f"changed {len(changed)} files")
    for c in changed:
        print("  " + c)
    if left:
        print("STILL LOADING SUPABASE: " + ", ".join(left))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
