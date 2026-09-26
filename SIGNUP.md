# Customer self-registration

Public URL: /signup. Owners submit salon name, owner name, email and phone, then receive a one-hour verification link. They set their password only after opening that link. Activation atomically creates an isolated salon, owner login, initial services/settings and Professional trial expiring exactly 14 days later. Generated salon code appears on completion. The provider admin salon list automatically includes it; existing manual invitation flow still works. No payment collection or automatic charging is added.

## Hostinger setup

Keep the existing persistent DATABASE_FILE, PUBLIC_ORIGIN and server/hostinger.mjs entry. In Resend, verify a sending domain you own using its DNS instructions and create a sending API key. Set these Hostinger environment variables (never commit secrets):

- SIGNUP_ENABLED=true
- RESEND_API_KEY=your private sending key
- MAIL_FROM=a sender address on your verified domain (optionally WiFi Palace <address>)

Save and redeploy. Visit /signup. Without all three settings the API and form stay disabled. Provider account creation and manual salon onboarding continue working. To pause new registrations set SIGNUP_ENABLED=false; this also pauses verification of pending links. Existing activated salons are unaffected. Email delivery uses the fixed Resend HTTPS API with a 10-second timeout. Configure sending-domain SPF/DKIM and verify inbox delivery before announcing signup. API acceptance is not proof of inbox delivery. Provider docs: https://resend.com/docs/api-reference/emails/send-email

## Operational checks

Use a fresh email you control: request a link, open it, choose password, save salon code and sign in. Confirm the trial and owner in /admin. Confirm another salon's data is inaccessible. Test email delivery failure and expiry messages. Complete/sync bills then close all old tabs and reopen for the login page's new signup link; do not clear pending data.

Tokens are random, stored only as hashes, never returned by APIs, and carried in URL fragments removed by the page. One activation consumes all pending links for that email. There is no account until verification. Duplicate activation cannot create another salon. Existing user emails and previously trialed emails cannot start another trial. Reusing another email is not prevented; this is not identity/business verification. Limits per email (3), connection IP (30) and global requests (100) per 15 minutes reduce spam; shared hosting proxy IPs can share a limit. Monitor delivery costs and registration abuse before broad marketing. No CAPTCHA, billing, password recovery or automatic subscription reminders added.

Expired pending requests are purged on the next registration request; verified email records remain to prevent repeat trials. Phone is stored in salon settings, not verified. Trial expiry/suspension uses the existing subscription checks; an already-authorized offline device can continue within its existing offline window. Failed/uncertain mail sends invalidate that request's token and permit later retry subject to limits. Prior successful resend links remain valid until one is used. Trial renewal is managed by WiFi Palace through /admin.

Automated tests use an injected fake mail transport: no real emails or external credentials. A production inbox and Hostinger redeployment still need verification by the operator.
