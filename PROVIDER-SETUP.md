# WiFi Palace provider console — 2.1

This upgrade adds a separate software-provider console at `/admin`, customer activation at `/activate`, and subscription access management. Existing salon data is preserved through additive SQLite tables. Existing salons without a subscription remain accessible until assigned one.

## Hosting and first administrator

The backend must run Node 24 with `npm start` from the repository root. Publishing only HTML files does not run the API. Confirm `/health` returns `{"ok":true}`. Hostinger currently displays the website but its backend and persistent storage have not been verified.

Set `PUBLIC_ORIGIN` to the actual HTTPS origin (for this deployment, `https://wifipalace.in`). Set `HOST=0.0.0.0` if required by the hosting runtime. Use the hosting-assigned PORT. Set DATABASE_FILE to a confirmed writable persistent SQLite location outside the public web directory; do not guess a Hostinger path. Both the app and management command must use the same DATABASE_FILE. Back up the database before upgrading. Confirm data survives an app restart AND redeployment before onboarding real customers.

Run once in the deployed application's server terminal:

```sh
node server/manage.mjs create-provider
```

Enter your administrator name, email and a unique 12–128-character password at the prompts. There are no default credentials and no public administrator-registration endpoint. A second bootstrap is refused. If the host offers no suitable terminal or durable SQLite support, hosting compatibility must be resolved before activation. Running this on a laptop creates a laptop account, not the hosted account.

## Daily operation

1. Open `/admin` and sign in as WiFi Palace.
2. Choose Add salon. Enter salon name, unique code, owner name/email, plan label, access status and expiry date.
3. Copy the private activation link and send it to the intended owner using your normal channel. This release does not send email automatically.
4. The owner opens the link, sets their password and signs in at `/` using their salon code and invited email.
5. The owner configures their logo, TRN, services, prices and staff. Their Team screen creates salon staff accounts.
6. Use Manage to renew, change status or suspend. New invite replaces a pending invitation; it cannot reset an already activated account.

Links expire after 48 hours, are single-use, and only token hashes are stored. Tokens are carried in URL fragments, removed from the address bar on page load, and are never included in the administrator audit log. Keep invitation links private. Reopen the original link if the activation page was refreshed before submission.

Provider sessions are separate from salon sessions, last eight hours, and use HttpOnly/SameSite cookies with Secure on HTTPS. Provider writes require CSRF validation. Provider administrators see salon account metadata, not customer records or receipts. Subscription updates revoke current online salon sessions. Expiry dates end at 23:59:59 UTC. Offline devices may continue until their existing 12-hour offline authorization expires; remote suspension cannot instantly disable an offline device. Pending offline changes are retained for reconciliation after access renewal.

## Scope and remaining work

Starter, Professional and Enterprise are administrative labels, not different feature entitlements. No prices, automatic charging, payment gateway, tax subscription invoices, public signup, automated email, provider password recovery UI or provider MFA are included. Manual subscription status does not establish that a customer has paid. Schedule and verify database backups separately. The Android APK still requires a live backend URL, compilation and POS/printer testing.

Run `npm test` for regression and provider authorization/onboarding tests. Browser rendering and real hosting verification must also be completed before commercial rollout.
