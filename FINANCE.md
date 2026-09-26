# Salon owner finance features

Owners now have a Finance tab. Reports, expenses and closing use the live server and require internet. Cashiers cannot access these endpoints. All records are scoped to the signed-in salon and writes require the existing CSRF check. Existing sales, accounts and provider features remain in place; two additive tables store expenses and closings.

## Commissions

In Services & staff, Edit a stylist and set a percentage (0–100%, two decimal places). Each new sale from the updated client supplies the stylist ID and rate. The server validates the rate and computes a rounded commission in integer fils on the subtotal after discount, before tax. It saves this snapshot with the sale. Later rate changes do not rewrite history. A refund reverses the original amount on the refund's UAE business date. A stale offline rate pauses sync for explicit review. Older/unassigned sales without a snapshot are excluded and counted in the report; this update does not invent historical rates or pay wages.

## Expenses

Record date, category, description, amount and payment method. Cash means money taken from the salon drawer. Bank/card expenses reduce the reported balance but not drawer cash. Duplicate retries use a stable ID. Owners can void mistakes with a reason; records and audit entries remain. Do not also expense commission amounts deducted by this report.

The displayed balance is discounted sales before tax, less refunds, recorded expenses and accrued commissions. It is not an accounting profit statement and excludes unrecorded costs and inventory valuation. Expense values are used as entered; there is no recoverable-input-tax accounting.

## Daily cash closing

This release supports one combined cash drawer per salon per UAE calendar day (UTC+4), not individual till shifts. Sync all devices before counting. Owners enter opening float, other cash in/out, actual counted cash and notes. Expected cash is opening float + cash sales - cash refunds - cash expenses + other cash in - other cash out. Change given is already reflected in sale totals. Card collections are excluded. Refunds are assumed to use the original payment method.

The server rejects closing if underlying activity changed after the report was loaded. A saved closing is immutable and duplicate closing requests cannot overwrite it. Later offline sales, refunds or expense changes remain accepted; the report flags changed activity and shows current expected cash and the adjustment since closing. It cannot know another offline device's unsent sales. Late adjustments require owner reconciliation; reopening, cash movement ledgers and multi-till shifts are not implemented.

Daily reports export CSV. Finance dates use UAE time even if a viewing device is elsewhere; the pre-existing dashboard still uses the device's local time.

## Deployment and verification

Take a normal server database backup. Deploy all code together, including finance.js and the updated service worker. Finish and sync any active bills, then close all app tabs/windows and reopen so the updated offline shell can activate. Do not clear browser storage or pending sales. Set staff rates and verify a demo sale/refund, expense/void and closing before real use.

Automated coverage includes owner permissions, CSRF, tenant isolation, money validation, commission snapshots/refunds, replay safety, concurrent closing and late adjustments. Client form checks execute the real scripts with a simulated DOM; physical-device and visual browser verification remain required.
