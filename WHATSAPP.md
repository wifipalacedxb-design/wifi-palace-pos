# Manual appointment WhatsApp

Appointments now offer WhatsApp for Booked and Cancelled entries. Booked entries provide Confirmation and Reminder templates; Cancelled entries provide a cancellation message. Completed bookings do not offer the action. Owners and cashiers who already have appointment access can use it.

Staff review/edit the phone and message, click Review WhatsApp link, then Open WhatsApp and manually press Send in WhatsApp. The sender is whichever WhatsApp account is signed in on that device. Use the salon's business account. No API key, automatic delivery, scheduling or delivery-status tracking is involved. Opening the link does not update appointment status or claim the message was sent. Message includes the booked date/time as entered, labelled salon local time, service, stylist, duration and salon address/phone where present.

New bookings store a tenant-validated customer ID so the current saved phone can be suggested. Legacy bookings or deleted linked customers require manual number entry; names are never used to guess a recipient. Review every number before opening the link. Editing the number here does not update the customer record. UAE 05 mobile numbers normalize to 971; other numbers must include their country code. Formatting validation cannot confirm a number belongs to the customer or has WhatsApp.

The offline shell includes the message helper, but WhatsApp sending needs connectivity. Deploy the whole change, sync outstanding work, then close every salon app tab/window and reopen to activate the updated shell. Do not clear storage. Test a booking with a phone number you control before customer use. Native Android wrapper handling of external links has not been tested; this change targets the hosted web/installed web app.

38 automated tests pass, including phone/message encoding, manual preview behavior, no status mutation, customer tenant validation and existing POS/signup/finance flows. UI tests use a simulated DOM. Real WhatsApp delivery is performed by staff and was not sent during development.

Click-to-chat reference: https://faq.whatsapp.com/5913398998672934/
