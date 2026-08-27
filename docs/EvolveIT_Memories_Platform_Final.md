EvolveIT

MEMORIES NIGHT CLUB  ·  CAPE COAST, GHANA  ·  AUGUST 2026
Digital Operations Platform
Complete System Specification for AI-Assisted Development
This document is the complete, final specification for the EvolveIT Digital Operations Platform at Memories Night Club. It is written to the level of detail required for an AI coding agent to implement every screen, every function, and every database table exactly as intended. Every design decision, every interaction, every business rule, and every deployment step is specified here. Nothing is left for interpretation.



Client
Memories Night Club, Cape Coast, Ghana
Project
EvolveIT Digital Operations Platform
Version
2.0  —  Final Specification
Status
Approved for AI-Assisted Development
Initial Deployment
2 August 2026 (5-day AI build sprint)
Rollout Model
Progressive — live from day one, iterated under real operating conditions
Prepared by
EvolveIT Engineering Team


CONTENTS
In this document

Section
Title
01
The Business Case
02
Platform Overview and Module Summary
03
Ticketing and Entry Management — Detailed Specification
04
Food and Beverage Ordering — Detailed Specification
05
Cash Policy and Waiter Accountability
06
Financial Accounting and the Transaction Ledger
07
Event Organiser Portal
08
Venue Operations — Tables, Reservations, Capacity
09
Design System and Screen Specifications
10
Database and Technical Architecture
11
Security and Data Protection
12
Deployment Plan and Rollout Strategy
13
Industry Comparisons and EvolveIT Improvements
Appendix A
Locked Technical Decisions
Appendix B
AI Builder Contract



SECTION 01
The Business Case
WHY THIS SYSTEM EXISTS
Certain revenue. Cashless operations. Full accountability.
Memories Night Club is a successful entertainment venue in Cape Coast. The gap between what the club earns on a busy night and what management can confidently verify is the problem this platform solves. The solution is not merely adding technology: it is replacing a manual, trust-dependent operation with a verified, digital one.
The Situation Today
Tickets are sold via WhatsApp messages, cash at the door, and informal arrangements. When a sold-out night ends, the owner has no verified figure for how many tickets were sold, at what price, or through whom. Drinks and food are ordered verbally, served without a system record, and paid for in cash. A bartender's shift close is a manual exercise: count what's left in the till, estimate what was sold, and hope the difference is close enough.
For event organisers who bring their own crowd and expect a 30% gate share, there is no independent figure they can trust. The settlement is a negotiation, not a computation. For customers, the experience is analogue: queue at the door, carry cash, hope their screenshot of a WhatsApp message gets them in.

What the Platform Changes
Every ticket sold online creates an immutable database record the moment Paystack confirms the payment. Every drink ordered at a counter QR is paid for before the bartender is notified. Every cash transaction at a table is recorded when the waiter marks it as collected. At midnight, the owner can open the dashboard from any phone and see the verified night's revenue: 248 tickets sold at GHS 80, GHS 12,400 in gate revenue, GHS 4,200 in bar sales, 3 comps at GHS 150 each, and a cash reconciliation variance of zero.
This is not an improvement on the current system. It is a different model of operation.

The Four Core Outcomes
Outcome
For whom
How the system delivers it
Revenue certainty
Owner and investors
Every transaction is recorded at the moment it occurs. The nightly report is a sum of verified ledger entries, not an estimate built from staff reports.
Cashless convenience for customers
Ticket buyers, bar customers
Tickets purchased on the phone via MoMo. Counter orders paid via Paystack QR. No need to carry or handle cash at the bar.
Staff accountability without friction
Bartenders, waiters, door staff
Bar staff serve against a display that only shows paid orders. Waiters account for table cash directly. Door staff scan without guessing. Every action is attributed to a specific person.
Organiser confidence
Event promoters
Revenue split is computed automatically from verified ledger figures. The settlement statement arrives without negotiation.

SECTION 02
Platform Overview
SIX MODULES, ONE PLATFORM
Each module is a complete, independently deployable piece of the system.
Module Summary
Module
What it covers
Primary users
Feature flag
Ticketing
Online sales, MoMo payment, digital rotating QR, door scanning, anti-fraud, recovery, transfer, installments
Customers, door staff, management
ticketing
Counter Ordering
Bar station QR codes, MoMo-only payment, real-time bar display queue
Customers, bartenders
ordering.counter
Table Service
Table QR menus, MoMo or waiter-collected cash, running order history, waiter interface, kitchen display
Customers, waiters, kitchen staff
ordering.table
Financial Ledger
Append-only transaction log, shift close, cash reconciliation, nightly reports, owner dashboard
Management, owner, accountant
accounting
Organiser Portal
Event submission, management review, organiser live view, automatic settlement
Event organisers, management
organiser
Venue Operations
Table management, reservations with deposits, no-show enforcement, capacity tracking
Reception, door staff, management
venue

 
MULTI-VENUE ARCHITECTURE
Memories Night Club is the first venue on the platform. Every module is built for a configurable, multi-tenant system from day one. A second venue joins by creating a new tenant record and configuring its feature flags. No code changes required. No data from Memories is accessible to any other venue.

SECTION 03
Ticketing and Entry Management
COMPLETE SPECIFICATION — PURCHASE THROUGH DOOR
A ticket that cannot be copied, verified in under a second, and working when the internet drops.
This section specifies every aspect of the ticketing module in sufficient detail for an AI agent to implement it without further clarification. References are drawn from DICE (rotating QR anti-fraud), Eventbrite (checkout flow), and pretix (offline door coordination).
Ticket Purchase Flow
The customer arrives at the Memories event page on any phone browser. The page lists upcoming events with artwork, date, time, venue, and available ticket types. The customer selects a ticket type, chooses a quantity (maximum 6 per phone number per event), enters their name, phone number in E.164 format (+233...), and email address. Both phone and email are required.
On proceeding to payment, the system creates a payment record with status "initialized" and generates a unique Paystack reference. No ticket exists yet and no stock is decremented. The customer is redirected to Paystack's hosted payment page where they select MTN MoMo, Vodafone/Telecel Cash, AirtelTigo Money, or card, and complete the payment on their own handset.
If the customer closes their browser at any point after MoMo approve, the system still issues the ticket when Paystack sends its webhook. The customer's browser state is irrelevant to ticket issuance.

Payment Webhook and Ticket Issuance
Paystack sends a signed POST request to /api/v1/webhooks/paystack with the x-paystack-signature header. The platform verifies HMAC-SHA512 of the raw request body against the header before processing anything. This happens before JSON parsing. A failed signature check returns 401 with no side effects and logs the attempt.
If the signature passes: the system inserts a row into webhook_events with the Paystack event ID as a unique key. If that insert fails due to a duplicate key, the webhook has already been processed and the handler returns 200 immediately with no further action. This is the idempotency guarantee.
For a charge.success event: the system runs an atomic stock decrement (UPDATE ticket_types SET remaining = remaining - qty WHERE remaining >= qty RETURNING id). If zero rows are returned, stock is exhausted and an immediate refund is triggered. If the decrement succeeds, ticket rows are created, ledger entries are written, and delivery is enqueued. All writes happen in a single database transaction.

The Rotating QR — Technical Detail
The QR code on the live ticket page is not a static image. It is a computed string that changes every 30 seconds. The format is:

EV1.{ticket_uuid}.{totp_code}

ticket_uuid:  the ticket's UUID (e.g. 8f3c2a1e-7c44-4c2a-9b11-0c6d2f8a91ab)
totp_code:    6 digits, RFC 6238, SHA-1 HMAC, 30-second timestep
              computed from a per-ticket 160-bit random secret

Example:  EV1.8f3c2a1e-7c44-4c2a-9b11-0c6d2f8a91ab.483921

Table QR codes use a different prefix to prevent confusion:
              ET1.{96-bit-opaque-table-token}

The TOTP secret is stored encrypted in the database and in the hub's local snapshot. It is never sent to the customer's browser directly. The live ticket page fetches a short-lived session token after OTP verification, and the TOTP is computed in the browser using that session. If the customer's phone is offline, the page uses the cached session to continue computing TOTP locally for the duration of the event.
The scanner accepts the current 30-second window and the adjacent window on either side, allowing for up to 30 seconds of clock difference. A screenshot forwarded to a friend expires within 90 seconds at most. Reference: DICE uses the same principle on its rotating barcode, and this is why it has effectively eliminated ticket forwarding fraud on its platform.

Ticket Delivery
Channel
Sends
Does not send
When
WhatsApp (primary)
Event name, date/time, deep link to live ticket, last 4 of serial
QR image, TOTP code, secret
Within 60 seconds of webhook processing
SMS (fallback)
Same deep link, shorter message
Same exclusions
If WhatsApp delivery fails after 2 attempts
Email
Receipt, deep link, full serial
Live QR
Immediately after webhook processing
Live ticket page (in-app)
Rotating EV1 QR updating every 30s
Nothing sensitive
After OTP verification on the deep link
Apple/Google Wallet (Phase 2)
Native rotating barcode from same TOTP secret
Static pass image as sole factor
On request from live ticket page

Door Scanner Operation
Door staff open the EvolveIT Scanner PWA on their assigned phone. The app authenticates using a device credential (not a personal staff login). The device is pre-configured by management with the event ID it is allowed to scan for the current shift. A scanner assigned to tonight's event cannot scan a ticket from a different event.
The scanner interface shows a full-screen camera viewfinder. When a QR is detected, the app parses the EV1 prefix (rejects anything that does not match). It extracts the ticket UUID and the TOTP code. It sends these to the venue hub over the local network. The hub verifies the TOTP against its local copy of the secret, checks the revocation list, runs the atomic compare-and-swap against its local redemptions table, and returns the result. Total time on LAN: under 50 milliseconds. Total with camera recognition: under 800 milliseconds.
The result occupies the entire scanner screen. There is nothing else on the screen during a result display.

Scanner Result States — Exact Screen Specification
Result
Full-screen background colour
Icon
Primary text (40px bold)
Secondary text (24px)
Valid ticket
#1A5C2E (deep green)
White tick, 120×120px
ADMIT
Holder name + ticket type
Already used
#B86800 (amber)
Warning triangle, 120×120px
ALREADY USED
Scanned at HH:MM — Door N
Voided or expired
#B8122A (crimson)
White X, 120×120px
NOT VALID
Reason: voided / expired / wrong event
Invalid QR format
#B8122A (crimson)
White X, 120×120px
INVALID CODE
Try manual serial entry
Hub unreachable, scan accepted offline
#1A5C2E (deep green) with amber banner at top
White tick, 120×120px
ADMIT (OFFLINE)
Verify name: [holder name]. Hub unavailable.
Hub down, cloud also down
#3D4C6B (slate)
Warning icon, 120×120px
CANNOT VERIFY
Do not admit on screenshots. Contact manager.

 
DESIGN RATIONALE FOR FULL-SCREEN RESULT
This design is drawn directly from DICE's scanner app and the pretixSCAN interface, both of which use a full-viewport colour fill for scan results. The reason: at a busy door with multiple people queuing, the door supervisor 3 metres away needs to see the result without approaching the scanning phone. A small badge or icon on a neutral background is unreadable at distance in a dark room. The full-screen colour fill is a safety requirement, not a stylistic choice.

Offline Door Operation
The venue hub downloads the complete valid ticket set (IDs, TOTP secrets, holder names, revocation list) at shift start and syncs updates every 60 seconds when internet is available. If the internet connection at Memories drops, door scanning continues without any change to staff workflow. The hub runs all verification locally. Admissions are queued for sync.
When connectivity returns, the hub replays its queued redemptions to the cloud. A UNIQUE constraint on ticket_redemptions.ticket_id means a replay of an already-synced redemption is a no-op. No duplicate admission is possible.
The minimum guaranteed offline operation time is 30 minutes. After 45 minutes without sync, the hub displays a warning on the manager's interface but continues to operate. Tickets issued after the connection dropped (new online sales) cannot be verified until the hub syncs and receives them.

Lost and Stolen Tickets
Lost ticket (holder cannot access their phone or the link, no evidence of compromise): if the ticket has not been scanned, management voids the original and issues a replacement to the same phone number. If already scanned, no reissue. Holder is shown the scan timestamp and door number as a record.
Stolen ticket (holder believes phone or link was accessed by someone else): same process as lost, but additionally requires the holder's email OTP in addition to phone OTP before reissue is processed. If the stolen ticket was already scanned, the incident is logged with the scan details. The reissue count per ticket is capped at 1; a second reissue requires management authorisation in the dashboard.

Ticket Transfer
A ticket holder initiates a transfer from the live ticket page. They enter the recipient's phone number, confirm with their own OTP, and the recipient confirms receipt with their OTP. The original ticket is voided, a new ticket is issued to the recipient with a new UUID and a new TOTP secret, and the ownership history is recorded. One transfer per ticket. A transferred ticket cannot be transferred again.

Installment Payments
Memories can offer installment purchasing for high-value events. Minimum 30% paid immediately; balance paid at least 48 hours before the event starts. Ticket status is "reserved" until fully paid. A reserved ticket cannot be admitted at the door. When the balance is settled, the ticket moves to "issued" and the TOTP secrets are minted at that point.
Missed deadline: the reservation is automatically cancelled by a scheduled job. The customer receives a refund of all amounts paid minus 10% of the total ticket price. The 10% is recorded as forfeiture income in the ledger. The refund is processed via Paystack API with one refund call per payment reference. Each refund reference is stored; retry logic checks whether a reference already succeeded before calling Paystack again.

SECTION 04
Beverage Ordering
COUNTER ORDERING AND TABLE SERVICE — DETAILED SPECIFICATION
Counter: MoMo only. Table: MoMo or waiter-collected cash.
This section specifies the two distinct ordering contexts at Memories: the bar counter (cashless by design) and the table service area (flexible payment with waiter accountability). References are drawn from Toast POS (kitchen display, table management), Square for Restaurants (QR ordering), and the Lightspeed Restaurant floor management model.
Counter Ordering — Bar Stations
Each bar station at Memories has a printed QR card fixed to the counter. The QR code encodes the venue ID and the specific station ID (e.g. ET1.bar-main or ET1.bar-vip). When a customer at the counter scans the code, their phone browser opens the menu for that station. No app installation is required.
Counter ordering is MoMo-only. No cash is accepted at the counter bar. This is a deliberate operational policy, not a technical limitation. The counter is a high-volume, rapid-turnover environment. Handling cash at the bar counter introduces the same revenue opacity the platform is designed to eliminate. Customers who wish to pay cash may do so at a table with waiter service.
The menu shows items relevant to the bar station: drinks, snacks, any counter-sold items. Out-of-stock items are hidden in real time by management. The customer selects items, proceeds to checkout, enters their phone number (required for order status and any refunds), and pays via Paystack. The order is sent to the bar display only after Paystack confirms payment.

 
COUNTER PAYMENT POLICY
This approach is consistent with how modern cashless bars operate at major venues in Europe and North America. Fabric (London), Shelter (Glasgow), and equivalent festival operators have all moved to cashless counters. The rationale is identical: guaranteed payment verification, faster throughput, and elimination of till cash discrepancies. The customer experience improves: no waiting for change, no overpaying with a large note. The club's revenue recording is exact.

Bar Display — What Bartenders See
The bar display is a tablet mounted in the bar area showing the active order queue for that station. It runs the EvolveIT Bar Display PWA in a dedicated kiosk mode. The display connects to the venue hub over the local network and receives orders in real time via the hub's event stream.
Each order card on the display shows: the order token number (a 4-digit number displayed large for the customer to reference), the time the order was placed, and each item with its quantity. There is one action on each item: a button labelled READY. When all items in an order are marked READY, the order is automatically moved to SERVED status.
There is no payment confirmation button on the bar display. Bartenders do not confirm that payment was received. Payment is confirmed by Paystack before the order appears. This is the fundamental design principle from which the anti-fraud value of the system derives. Any alternative that gives bar staff a payment confirmation control removes the guarantee.

Table Ordering — The Complete Flow
Each table has a laminated card with the table QR code. The code is in format ET1.{96-bit-random-token}. The token maps to the table record in the database. Customers scan, browse, order, and pay via Paystack. This is identical to counter ordering in mechanism.
The difference is what happens after checkout. At the counter, the customer collects their order. At the table, a waiter delivers it. The waiter's interface shows all orders for their assigned tables, including the order status and the items. When a waiter marks an item as delivered, the order status updates.

Table Cash Payment
After a customer has completed their QR order checkout, if they inform the waiter they wish to settle with cash, the waiter handles this directly. This applies only to table service, not counter bar orders.
The waiter's interface includes a Cash Received button on any table order. When tapped, the waiter enters the cash amount received, and the system records: the order ID, the amount, the waiter ID, and the timestamp. This creates a cash_movements ledger entry attributed to the specific waiter. The waiter is responsible for holding this cash until shift close.
At shift close, the cash each waiter collected during their shift is shown in the reconciliation report. The expected amount is the sum of all cash_movements entries attributed to that waiter. The physical cash they hand in is compared against this figure. Any discrepancy is flagged for management review and attributed to the specific waiter by name.
No manager PIN is required for a waiter to mark a cash payment at a table. The accountability comes from attribution, not from approval. Every cash transaction is recorded against the waiter who handled it. The shift close reconciliation identifies the responsible person. This is analogous to how Toast POS handles cash tips and cash table settlements: the server is responsible for their own cash, and the system provides the audit trail.

Waiter Interface — Detailed Specification
The waiter PWA is a mobile-optimised interface installed on the waiter's own phone or a provided device. It shows:
My Tables view: a list of tables assigned to this waiter for the current shift. Each table shows how many active orders it has and a colour indicator (grey = no orders, yellow = orders pending, green = orders complete). Tap to expand.
Table detail: all orders for the table in chronological order. Each order shows items, their status (pending, preparing, ready, delivered), and the payment method (QR/MoMo shown automatically; Cash Received button for cash collection).
All Tables view (manager-only): a live view of all tables across the floor, their status, and the waiter assigned to each.
Notifications: a push notification and sound alert when a new paid order arrives for the waiter's table. The notification shows the table number and the item count.

Kitchen and Additional Display Stations
Food items in the menu are tagged with a station attribute: bar (drinks), kitchen (food), or bar (other items served at the bar). When an order is paid, the system routes items to the appropriate display: drink items to the bar display, food items to the kitchen display. A waiter sees all items for their table.
The kitchen display is identical in design to the bar display: dark background, large order cards, item-level READY button, no payment information. This design is directly modelled on Toast's Kitchen Display System (KDS), which uses the same philosophy: the kitchen sees only what it needs to action, and the confirmation is fulfilment, not payment.

Fallback If Hub or Network Fails During Service
If the hub is unreachable, the waiter app falls back to polling the cloud API every 4 seconds. This is slower but functional. The bar display does the same. If both hub and cloud are unreachable, the bar display shows its last known queue from the cached state. Orders that arrive during the outage appear when connectivity returns. Staff are notified of the degraded state with a banner, not a blocking error.

SECTION 05
Cash Policy and Waiter Accountability
HOW CASH WORKS IN THE PLATFORM
Recorded, attributed, and reconciled — not eliminated.
Cash Policy Summary
Context
Cash accepted
Who handles it
Recorded how
Reconciled against
Bar counter (QR order)
No — MoMo only
Not applicable
Not applicable
Not applicable
Table service (QR order, waiter-served)
Yes — waiter collects after order checkout
Waiter who served the table
cash_movements entry attributed to the waiter, by the waiter
Shift close: waiter's cash total vs physical cash handed in
Ticket purchase
No — online MoMo/card only
Not applicable
Not applicable
Not applicable
Reservation deposit
No — Paystack only
Not applicable
Not applicable
Not applicable
Management void or comp
System-recorded only
Manager authorises via dashboard
Ledger contra-entry
Management report — visible to owner

Shift Close Cash Reconciliation
At the end of each operating night, the shift close report shows each waiter who collected cash during the shift, the total cash amount attributed to them from their cash_movements entries, and a field for the physical cash they are handing in. The manager enters the physical amount received from each waiter. If the physical amount differs from the system record, the discrepancy is flagged and recorded with the waiter's name, the shift date, and the amounts.
This model is consistent with how Square for Restaurants handles server cash accountability: each server is responsible for their own cash, the POS records every cash transaction against the server, and the end-of-night report is a per-server reconciliation rather than a single till count.
Persistent discrepancies for a specific waiter over multiple shifts become visible in the management reporting view, allowing the owner to identify patterns that would be invisible in a single-till cash model.

SECTION 06
Financial Accounting and the Transaction Ledger
THE FINANCIAL FOUNDATION
Every financial event creates an immutable record. The nightly report is a SQL sum.
The Append-Only Ledger
The ledger_entries table is the financial foundation of the platform. Every financial event — ticket sale, bar payment, cash collection, comp, void, refund, settlement accrual — creates a new row. No row is ever modified or deleted. The database enforces this with a trigger that raises an exception if any UPDATE or DELETE is attempted on ledger_entries, even by the system administrator.
If a mistake is made (a comp was entered at the wrong amount), a correcting entry is created with the reverse amount. Both the original and the correction remain permanently visible. This is the same model used by Stripe's accounting system, and it is the standard for any financial platform that needs to withstand audit. The nightly report, the monthly statement, and the organiser settlement are all computed by SQL aggregation over this table.

Accounts at Memories Night Club
Account
Type
Created by
momo_clearing
Asset — Paystack-confirmed payments in flight
Paystack charge.success webhook
cash_drawer
Asset — physical cash
Waiter cash_movements entry
ticket_revenue
Income — face value of tickets sold
Webhook: charge.success, ticket context
fb_revenue
Income — food and drink sales
Webhook: charge.success, order context
deposit_liability
Liability — reservation deposits not yet applied
Webhook: charge.success, reservation context
forfeiture_income
Income — no-show and installment cancellation fees
Scheduled job: no-show and installment deadline
refunds
Contra-income — refunds processed via Paystack
Refund API call confirmed
comps
Contra-income — items given at no charge
Management action in dashboard
paystack_fees
Expense — processor fees
Webhook: charge.success, fee component
organiser_payable
Liability — organiser share awaiting disbursement
Settlement draft approval

Shift Close Report
The shift close report is generated by the manager at the end of each operating night. It shows: total revenue by category (tickets, bar, reservations), total MoMo receipts, total cash collected per waiter, voids and comps with the authorising person and reason, expected cash per waiter, actual cash handed in per waiter, and any variance. The report takes no more than 5 minutes to complete because all figures are pre-computed from the ledger.
The owner can view the shift close report for any past night from the owner dashboard. Reports cannot be edited after the shift is closed. An owner who suspects a discrepancy can drill down to individual ledger entries, each of which shows the actor, the device, the timestamp, and the Paystack reference (for digital payments).

Organiser Settlement Computation
After each event closes, the system computes the organiser settlement as follows:
net_ticket_revenue = SUM(ledger_entries WHERE account = "ticket_revenue" AND event_id = X)
                   - SUM(ledger_entries WHERE account = "refunds" AND event_id = X)

organiser_gate_share = ROUND(net_ticket_revenue * (1 - gate_split_club_bps / 10000))
-- gate_split_club_bps = 7000 at Memories (club keeps 70%, organiser gets 30%)

net_table_revenue = SUM(fb_revenue for tables assigned to this organiser's event)
organiser_table_share = ROUND(net_table_revenue * (1 - table_split_club_bps / 10000))
-- table_split_club_bps = 9000 (club keeps 90%)

comps_used = SUM(comps WHERE event_id = X)
comps_over_allowance = MAX(0, comps_used - organiser.comp_allowance)

organiser_total = organiser_gate_share + organiser_table_share - comps_over_allowance

The settlement draft is created automatically 12 hours after event end to allow for late Paystack webhooks. Management approves the draft in the dashboard. Once approved, the organiser can view the statement in their portal. Disbursement is processed manually by management in the first version.

SECTION 07
Event Organiser Portal
ONLINE SUBMISSION, MANAGEMENT REVIEW, LIVE TRACKING
Organisers book online. Management reviews in a structured queue.
Organiser Account
An organiser registers with their name, phone number, and email address. Phone OTP is the login mechanism. An organiser account has access only to their own events. They cannot see other organisers' events, financial data from nights they did not organise, or any system configuration.

Event Submission Flow
1.  Organiser logs in and selects a date from the availability calendar. Available dates show in white; dates under review show in grey with "Pending"; confirmed dates show in blue; past dates are locked.
2.  Organiser completes the event proposal form: event name, host name for public display, event description (shown on the tickets page), estimated attendance, DJ and act details, requested complimentary allowance (default 0; management can approve or reduce), any special venue requirements.
3.  Organiser submits the form. The date moves to "Under Review." The organiser receives a WhatsApp confirmation with their submission details.
4.  Management receives a notification in the dashboard and reviews the proposal. They can approve (with configurable revenue split and comp allowance), or decline (with a written reason).
5.  On approval: the event is created in the system, the date is reserved, and the organiser is notified. Management then creates ticket types and sets the sale window.
6.  On confirmation for public sale: the event appears on the Memories website with the event name, host name, and artwork.

Organiser Dashboard During and After the Event
An approved event gives the organiser a read-only dashboard showing: tickets sold by type, current total revenue, and for confirmed events in progress, a live count of admissions. After the event closes, the settlement statement appears in the same dashboard with the full breakdown.

SECTION 08
Venue Operations
TABLES, RESERVATIONS, AND CAPACITY
SevenRooms-inspired table management for a nightclub context.
Table Configuration
Management creates venue tables in the platform with a label (Table 1, VIP Booth A, etc.), zone (main floor, VIP, terrace), seating capacity, and minimum spend where applicable. Each table is assigned a unique QR token when created. The QR is printed on the table card. If a table card is damaged or lost, management generates a new token and prints a new card. The old token is immediately invalidated.

Table Reservations
Customers can reserve a table online. The reservation requires a deposit paid via Paystack. The deposit amount is configured per table or per zone by management. When the deposit is confirmed by webhook, the table is blocked for the reserved date and time, and the reservation is recorded.
Reception staff see a live floor map view showing reserved, arrived, available, and occupied tables. When a reserved party arrives, reception checks them in and the table status moves from reserved to occupied. If the party does not arrive within 60 minutes of the reserved time, a scheduled job releases the table and the deposit is forfeited to forfeiture_income in the ledger. The customer receives a notification of the no-show.
Walk-in customers are assigned available tables by reception or door staff through the same floor map view. No deposit is required for walk-ins.

Capacity Tracking
The hub maintains a live count of admitted guests: every successful door scan increments the count, every exit (if exits are tracked) decrements it. The current occupancy is shown on the manager's dashboard and on the door staff interface. When occupancy reaches 90% of the configured venue capacity, an alert is displayed on all management screens. When capacity is reached, the scanner shows a warning and management makes the admission decision.

SECTION 09
Design System and Screen Specifications
COMPLETE VISUAL AND INTERACTION SPECIFICATIONS
Every screen described in sufficient detail for an AI to implement it exactly.
This section specifies the complete design system and every screen in the platform. An AI implementing these screens should not need to make any design decisions. Every colour, every font size, every component, every interaction state, and every layout is defined here. References are drawn from the DICE app (ticket display, scanner), Toast POS (bar display, KDS), Square (floor plan, order management), and Stripe Dashboard (financial reporting).
Colour System
Token
Hex value
Usage
--ev-bg
#0A0B0C
Staff PWA background (bar display, scanner, waiter app)
--ev-bg-elevated
#121416
Cards and panels on dark surfaces
--ev-bg-page
#F8F9FA
Customer-facing pages (ticket purchase, event list)
--ev-bg-card
#FFFFFF
Cards on light surfaces (customer checkout, organiser portal)
--ev-text-primary
#ECECE8
Primary text on dark backgrounds
--ev-text-secondary
#9A9E9F
Secondary text, metadata, labels on dark
--ev-text-dark
#111111
Primary text on light backgrounds
--ev-text-muted
#6B7380
Secondary text on light backgrounds
--ev-brand-navy
#0B1F4B
EvolveIT brand — headers, nav, primary actions on light
--ev-brand-crimson
#B8122A
EvolveIT brand — accents, destructive actions, key labels
--ev-accent
#C8CCD4
Primary interactive elements on dark surfaces (near-white)
--ev-success
#1A5C2E
Scanner PASS, confirmed states
--ev-success-bg
#EBF5EE
Success background tint on light surfaces
--ev-warning
#B86800
Offline/degraded states, already-used ticket
--ev-error
#B8122A
Scanner FAIL, error states
--ev-border
#D8DCE2
Borders and dividers on light surfaces
--ev-border-dark
#2A2D32
Borders on dark surfaces
--ev-momo-yellow
#FFCB05
MTN MoMo brand colour — used only on MoMo payment button

Typography
Token
Font
Size
Weight
Usage
--ev-font-display
Georgia, Times New Roman, serif
var per use
700
Event names, page titles, document headings. Not used in staff PWA.
--ev-font-body
Calibri, Arial, sans-serif
var per use
400 / 600
All body copy, labels, navigation, buttons
--ev-font-mono
Courier New, monospace
var per use
400
Ticket serials, order IDs, financial figures, code
Display XL
--ev-font-display
40px
700
Hero headline on event pages
Display L
--ev-font-display
28px
700
Page titles (event name, section headings)
Heading 1
--ev-font-body
24px
700
Section headings
Heading 2
--ev-font-body
18px
700
Sub-section headings
Heading 3
--ev-font-body
14px
600
Card titles, group labels
Body L
--ev-font-body
16px
400
Primary body text
Body M
--ev-font-body
14px
400
Secondary body, descriptions
Label
--ev-font-body
12px / uppercase / letter-spacing 0.08em
600
Form labels, column headers, status badges
Micro
--ev-font-body
11px
400
Timestamps, footnotes — minimum size in the system
Data
--ev-font-mono
14px
400
Any number or code displayed to users
Scanner Result
--ev-font-body
40px / 24px
700 / 400
ADMIT/FAIL (40px) and holder name (24px) on scanner screen

Spacing and Radius System
Spacing scale: 4px, 8px, 12px, 16px, 24px, 32px, 48px, 64px. No values outside this scale.
Radius scale: 4px (inputs, small chips), 8px (buttons, small cards), 12px (standard cards), 16px (large cards, modals), 24px (bottom sheets), full (pills and badges).
Motion: 150ms ease for hover and focus states. 200ms ease-out for entering elements. 150ms ease-in for exiting. prefers-reduced-motion: all durations become 0ms.
Shadow scale: none (flat cards), sm (0 1px 3px rgba(0,0,0,0.08)), md (0 4px 12px rgba(0,0,0,0.12)), lg (0 12px 32px rgba(0,0,0,0.18)).
Minimum tap target: 48×48px on all interactive elements. 56×56px on primary action buttons in staff interfaces.

Component Specifications
Button
Primary: background --ev-brand-navy, text white, 600 weight, 14px, radius 8px, padding 12px 24px. Hover: darken 10%. Disabled: opacity 40%, cursor not-allowed.
Danger: background --ev-brand-crimson, otherwise identical to primary.
Ghost: border 1.5px --ev-brand-navy, text --ev-brand-navy, transparent background. Hover: background at 8% opacity of navy.
MoMo Payment: background #FFCB05 (MTN yellow), text black, 700 weight. This button must display the MTN MoMo wordmark or logo if licensing allows; otherwise show "Pay with MoMo" with the yellow background.
Loading state: spinner replaces label text. Button width is fixed to prevent layout shift. Never show a spinner for more than 30 seconds without showing a timeout message.

Input Field
Border 1px --ev-border, radius 8px, padding 10px 14px, background white.
Focus state: border 2px --ev-brand-navy, no additional shadow.
Error state: border 2px --ev-brand-crimson, error message below the field in --ev-brand-crimson at 12px. Never use an alert() or toast for a form field error.
Phone input: prefix selector showing GH flag and +233, fixed. The input accepts 9 or 10 digit local numbers and normalises to E.164 on blur. A phone number starting with 0 has the 0 removed and +233 prepended.
Currency input: GHS prefix fixed, accepts integers only, displays with two decimal places. Stored as integer pesewas.

Order Card — Bar and Kitchen Display
Dark card: background --ev-bg-elevated, border 1px --ev-border-dark, radius 12px.
Token number: 48px bold, --ev-accent (near-white), top-left of card.
Time since order: 12px, --ev-text-secondary, top-right, auto-updating.
Table or station label: 14px, --ev-text-secondary.
Each item: 16px, --ev-text-primary, with quantity in bold prefix. One item per row.
READY button per item: full width of card, background transparent, border 1px --ev-accent, text --ev-accent, 14px bold. On tap: background turns --ev-success, text turns white, button label changes to DONE. No confirmation dialog.
When all items are READY: card border turns --ev-success (green) and a "All Ready" banner appears at top.

Scanner Screen
The scanner screen is the only screen in the system where no other UI is visible while a result is displayed. The camera viewfinder fills the full screen in idle state. On a scan result:
The entire viewport transitions to the result colour in 150ms linear.
The icon (tick or X) is centred vertically at 60% of the viewport height, 120×120px.
Primary text (ADMIT / ALREADY USED / NOT VALID) at 40px bold, white, centred below the icon.
Secondary text (holder name or reason) at 24px, white at 80% opacity, centred below primary.
After 4 seconds, the screen transitions back to the camera viewfinder.
A sound plays on every result: a clear tone for ADMIT, a lower buzz for any failure state. Sound plays even if the device is on silent mode, because door staff cannot watch the screen continuously.

Screen-by-Screen Specification
Customer: Event List Page
URL: /events. Light background (#F8F9FA). Page header: EvolveIT logo left, Memories Night Club name right, in --ev-brand-navy. Hero section: upcoming events displayed as cards in a single-column scroll on mobile. Each event card: full-width artwork image (16:9 ratio, fill), event name in Display L below, date and time in Body M in --ev-text-muted, ticket price range in Data font in --ev-brand-navy, single CTA button "Get Tickets" in Primary style. Sold-out events show a greyed card with "Sold Out" badge instead of the CTA.

Customer: Checkout Page
URL: /events/{id}/checkout. Step indicator at top (3 steps: Tickets, Details, Pay). Step 1: ticket type cards with quantity steppers. Step 2: name (text input), phone (phone input with +233 prefix, validated), email (email input, validated). Step 3: Paystack redirect. On Paystack return: if success, show "Confirming payment..." with a spinner. Poll the server every 5 seconds for up to 2 minutes. When confirmed, redirect to /tickets/{id}. If 2 minutes pass without confirmation: show "Payment is being processed. Check your WhatsApp for your ticket, or contact the venue."

Customer: Live Ticket Page
URL: /tickets/{id} (after OTP). Dark background (--ev-bg). Memories Night Club logo at top (white). Event name in Display L (white). Event date and time in Body L (--ev-text-secondary). QR code: centred, 280×280px, white modules on dark background, 2×2 quiet zone. QR updates every 30 seconds without page refresh (React state, no flicker). Ticket serial below QR in Data font at 14px (--ev-text-secondary). Ticket type and holder name in Body M below serial. "Add to Wallet" button at bottom (ghost style, white border). The QR computation happens in the browser using the TOTP secret from the session; no network call is required for QR rotation.

Door Staff: Scanner Screen
Installed as a PWA on the door phone. Full-screen camera viewfinder in idle state with a subtle animated scan line. Device label (Door 1, Door 2) and event name shown in 12px label at the top corners. Hub connection status indicator (green dot = connected, amber = degraded, red = offline) at top right. Manual entry option: small "Type serial" link at bottom. On tap: a bottom sheet appears with a serial number input field. This is the fallback when a customer's screen is too dark or scratched for the camera to read.

Bar Staff: Bar Display
Full-screen dark interface (--ev-bg). No navigation. No login screen visible. Title bar: station name (Bar Main, Bar VIP) in 16px label, hub connection status. Order cards in a responsive grid (2 columns on tablet, 1 on phone). Orders sorted by time placed (oldest first). Completed orders slide out with a 300ms ease animation. If the order queue is empty: a large centred message "No pending orders" in --ev-text-secondary.

Waiter: Waiter App
Light background. Navigation: two tabs at bottom — "My Tables" and "All Orders" (manager only). My Tables tab: a card per assigned table showing table label, zone, order count, and status colour. Tap opens the table detail. Table detail: scrollable list of all orders for the table. Each order has a timestamp, payment method badge (MoMo or Cash), and expandable item list. Items show their status. Cash Received button appears on MoMo-paid orders that the waiter can convert (this is not a feature — remove). Cash Received button appears only on orders that have not yet been marked as paid, as a separate button next to each unpaid table order. Tapping it opens a bottom sheet with an amount field and a confirmation.

Owner: Dashboard
Desktop-optimised (also functional on mobile). Left sidebar navigation: Tonight, Reports, Events, Organisers, Configuration. Tonight view: key metrics grid at the top — Tickets Sold (count), Gate Revenue (GHS), Bar Revenue (GHS), Active Guests (count from hub). Each metric as a prominent card. Below: a real-time activity feed showing the last 20 transactions. Reports view: date range selector, revenue breakdown by category, per-waiter cash reconciliation, voids and comps list. All figures computed from ledger_entries. Export to CSV available on every table.

Memories Night Club Brand Application
The Memories brand applies to customer-facing interfaces. The primary brand colour is crimson (#B8122A). The secondary is a near-black surface (#08070D) for the hero and navigation. Typography on the public site: Georgia for event names and headlines, Calibri for body text. All customer pages use the Memories colour scheme. Staff interfaces (scanner, bar display, waiter app, manager dashboard) use the EvolveIT platform colours and are not tenant-branded, because consistency of operational colour meaning across shift changes and different staff members is a safety requirement.

SECTION 10
Database and Technical Architecture
SCHEMA, CONSTRAINTS, AND MECHANISMS
Every constraint enforces a business rule. No business rule relies only on application code.
This section specifies the complete database schema and the technical mechanisms that implement the core guarantees of the platform. An AI implementing this system must use these exact table names, column names, and constraint definitions.
Architecture Overview
Layer
Technology
Version
Rationale
Programming language
TypeScript
5.x
Single language across customer site, staff PWAs, cloud functions, and hub service. Enables shared types and business logic.
Customer and staff UI
React, Progressive Web App
18.x
No app store required. Installs from browser. Offline-capable via service worker. Works on any Android 8+ or iOS 14+ phone.
Database
PostgreSQL
16
Relational model is required for financial accounting queries. Row Level Security enforces data isolation. Atomic UPDATE...RETURNING prevents race conditions.
Backend platform
Supabase
Latest
Managed Postgres + Auth + Storage + Realtime + Edge Functions in one platform. Eliminates operational overhead for a small team.
Hub runtime
Node.js with SQLite (better-sqlite3)
22.x + SQLite 3
Lightweight. No separate database server at the venue. Hub is a cache with its own local CAS for door operations.
Payments
Paystack
Latest
MTN MoMo, Vodafone/Telecel, AirtelTigo, and card in one integration. Settles in GHS. Webhook-based confirmation.
WhatsApp delivery
Meta WhatsApp Business API
Cloud API
Higher reliability and lower cost than bulk SMS for ticket delivery.
SMS fallback
Arkesel or Hubtel
Latest
Local Ghana routing for MTN and Vodafone networks.
Customer site hosting
Vercel
Latest
Edge CDN, preview deployments, Next.js native.

Database Schema — Complete Table List
Table
Purpose
Critical constraints
tenants
One row per venue. All other tables reference this.
UNIQUE(slug). All tenant-scoped tables have FORCE RLS.
tenant_features
Feature flags per venue.
PK: (tenant_id, feature_key). Enabled is a boolean.
users
All accounts (staff and customers). Linked to Supabase auth.
UNIQUE(tenant_id, phone). UNIQUE(tenant_id, email). token_version INTEGER for revocation.
user_roles
Role assignments. A user may hold multiple roles.
role IN (owner, manager, door, waiter, bartender, kitchen, cashier, organiser). PK: (user_id, tenant_id, role).
devices
Physical devices: hub, scanners, displays.
role IN (hub, door, bar_display, kitchen_display). event_ids UUID[] locks scanner to specific events. revoked_at: device is immediately locked if set.
shifts
Each operating night.
opened_by, closed_by, hub_device_id. One open shift per tenant at a time.
events
One event per night per venue.
check_in_from and check_in_until enforce the door time window. event_private_key_enc stores the TOTP signing key encrypted.
ticket_types
GA, VIP, Early Bird, etc.
remaining CHECK(>=0). Decrement only via webhook handler atomic UPDATE. Never from any other path.
tickets
One row per purchased ticket.
status IN (reserved, issued, used, voided). totp_secret_enc: encrypted, never in API responses or logs.
ticket_redemptions
The double-entry lock. One row per admission.
UNIQUE(ticket_id). INSERT only. Two concurrent scans: one inserts, one gets a unique constraint violation. This IS the anti-fraud mechanism.
ticket_payments
One row per payment or installment slice.
paystack_ref UNIQUE. refund_ref UNIQUE for idempotent refund processing.
ownership_history
All ownership changes: purchase, transfer, reissue.
Append-only. reason IN (purchase, transfer, reissue_lost, reissue_stolen, admin).
revocations
Voided tickets for offline rejection.
PK is ticket_id. Hub downloads on shift start and every 60 seconds.
webhook_events
Paystack webhook deduplication.
paystack_event_id UNIQUE. Insert before any business logic.
ledger_entries
Every financial event.
No UPDATE or DELETE privilege for any role. Enforced by database trigger BEFORE UPDATE OR DELETE.
payments
Paystack webhook outcomes.
paystack_ref UNIQUE. status set only by verified webhook, never by staff.
venue_tables
Physical tables. qr_token in the table QR code.
qr_token: 96-bit random. UNIQUE. Replaceable without data loss.
table_reservations
Bookings with deposits.
status IN (reserved, arrived, no_show, cancelled).
orders
One order per QR checkout session.
payment_source IN (momo, cash). status IN (pending_pay, paid, preparing, ready, complete, voided). local_ref UNIQUE for hub idempotency.
order_items
Individual items per order.
station IN (bar, kitchen). status per item.
cash_movements
Cash collected by waiters.
attributed_waiter_id FK users. shift_id FK shifts. Not nullable — every cash entry must have an owner.
settlement_statements
Organiser payouts.
status IN (draft, approved, paid). Computed from ledger. Not editable after approval.

Row Level Security Policies
-- All tenant-scoped tables have: ALTER TABLE {name} FORCE ROW LEVEL SECURITY;

-- Basic tenant isolation (applied to all tenant tables):
CREATE POLICY tenant_isolation ON {table}
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Tickets: customers see only their own
CREATE POLICY customer_own_tickets ON tickets
  FOR SELECT USING (buyer_user_id = auth.uid());

-- Ticket issuance: service role only (no staff can INSERT tickets)
CREATE POLICY service_role_insert_tickets ON tickets
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Redemptions: hub device and scanner devices only
CREATE POLICY scanner_can_redeem ON ticket_redemptions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM devices
            WHERE id = current_setting('app.device_id')::uuid
            AND role IN ('hub', 'door')
            AND revoked_at IS NULL)
  );

-- Ledger: append-only enforced by trigger
CREATE FUNCTION prevent_ledger_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Ledger entries are immutable. Create a correcting entry.';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_immutable
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

-- Cash movements: waiter can only see and insert their own
CREATE POLICY waiter_own_cash ON cash_movements
  USING (attributed_waiter_id = auth.uid());

SECTION 11
Security and Data Protection
AUTHENTICATION, INTEGRITY, AND LEGAL COMPLIANCE
Authentication
Customers: phone OTP via Supabase Auth SMS to access the live ticket page. No password. Session scoped to the event day.
Staff: email and password for initial account setup. Phone OTP available as second factor. Sessions expire after 12 hours and require re-authentication.
Devices (scanner, bar display): device credential (API key stored as argon2 hash in the devices table). Device credentials are not user-linked. A lost device is revoked from the management interface, invalidating the credential immediately.
EvolveIT admin: email and password with mandatory phone OTP second factor.

Payment Security
All payment confirmation is via Paystack webhook with HMAC-SHA512 signature verification on the raw request body. The signature is verified before any JSON parsing. A failed signature returns 401 immediately. The platform does not have a payment confirmation button available to any staff member. Staff interaction with payments is limited to viewing verified records.

Ghana Data Protection Act 843 (2012)
Memories Night Club is the data controller for all guest data. EvolveIT is the data processor. Data collected: name, phone, email, payment references, scan event records. Purpose: fulfilment, fraud prevention, legal retention. No additional use. Guest right of access and deletion applies; financial ledger entries cannot be deleted but personal identifiers can be anonymised after the retention window.
Scan logs: retained 2 years.
Financial ledger: retained 7 years.
TOTP secrets: stored encrypted at rest. Never in logs. Never in API responses.
Biometric data: not collected in this version.

SECTION 12
Deployment Plan and Rollout Strategy
FIVE-DAY AI BUILD SPRINT, LIVE ON 2 AUGUST, PROGRESSIVE ROLLOUT
Ship early. Iterate under real operating conditions.
The platform is built with AI coding assistance. The initial development sprint is 5 days. The system goes live at Memories on 2 August 2026 in a limited capacity. Full operational use is progressive, with the system running alongside existing processes until it is stable enough to be the primary operating system.
Five-Day Build Sprint
Day
Deliverable
Done when
Day 1
Database schema, RLS policies, Supabase auth, device registration, tenant config, hub hello-world connecting to Supabase, monitoring skeleton
A manager can sign in. RLS blocks cross-tenant reads. Hub connects and receives a test snapshot.
Day 2
Paystack webhook handler with HMAC, atomic ticket issuance, rotating TOTP live ticket page, WhatsApp delivery, basic scanner PWA, hub local CAS for redemptions
A test Paystack payment issues a real ticket. Two simultaneous test scans admit exactly one. Ticket QR rotates every 30 seconds in the browser.
Day 3
Counter QR ordering (MoMo only), bar display PWA, table QR ordering, waiter app with cash collection, basic ledger entries for all payment events
A counter QR order reaches the bar display only after payment confirmation. Waiter cash entry creates a ledger row attributed to the waiter.
Day 4
Lost/stolen recovery, ticket transfer, installment payment with deadline job, reservation deposits and no-show job, organiser portal (submit and review), settlement computation
Installment deadline fires correctly and refunds proportionally. Organiser sees their event's live ticket count.
Day 5
Owner dashboard, shift close report, waiter reconciliation report, full offline drill (30 min WAN unplugged), second test tenant, deployment to production
Shift close report matches manually computed totals. 30 minutes offline: no scan interruption. Second tenant has no access to Memories data.

Progressive Rollout at Memories Night Club
Phase
When
Scope
What stays manual
Phase 1 — Ticketing live
2 August 2026
Online ticket sales and door scanning. Hub installed. Two scanner phones configured.
Walk-in cash sales at the door continue as before. Bar and table service unchanged.
Phase 2 — Counter ordering
First Friday after Phase 1 stable
Bar counter QR ordering active at the main bar. Bar display tablet installed.
VIP bar and table service unchanged.
Phase 3 — Table service
Following week
Waiter app active. Table QR cards in place. Cash collection via waiter interface.
None — table service is fully on the platform.
Phase 4 — Full operations
When Phase 3 is stable for 2 events
Organiser portal. Settlement computation. Owner dashboard. Full shift close reports.
None — all operations on the platform.

 
ROLLOUT PRINCIPLE
Every phase adds capability without removing anything. The staff continue operating exactly as they did before, with a new digital layer added on top. This approach is modelled on how Square for Restaurants conducts restaurant go-lives: the system is introduced for one station or one function at a time, staff build confidence, and expansion happens when the team is ready.

Hardware Required at Memories for Phase 1
Item
Quantity
Specification
Purpose
Venue hub mini PC
1 (plus 1 spare)
Fanless, Ethernet port, 4GB RAM, 32GB storage. NUC or Brix-class.
LAN hub for offline scanning and order routing
UPS
1
Minimum 30-minute runtime for hub + switch + 2 phones.
Power continuity during outages
Network switch
1
8-port, Ethernet.
LAN for hub-to-device communication
Door scanning phones
2
Any Android 8+ with a working camera and data connection.
One per door entrance
Bar display tablet
1 (Phase 2)
10-inch Android tablet. Wall or stand-mount.
Bar order queue display
Table QR cards
Per table (Phase 3)
Laminated card with QR code printed. Replace if damaged.
Table ordering QR codes

SECTION 13
Industry Comparisons and EvolveIT Improvements
REFERENCE SYSTEMS AND HOW EVOLVEIT GOES FURTHER
What the best systems in the world do, and what we do differently for Cape Coast.
This section documents the specific design decisions drawn from established systems, and the improvements EvolveIT makes on those systems for the Memories context.
Reference Systems
System
What it does well
What EvolveIT takes from it
Where EvolveIT goes further
DICE
Rotating QR codes that prevent ticket forwarding. Phone-bound tickets. Anti-touting design. Dark, editorial app aesthetic.
The rotating TOTP QR concept. The phone-first ticket model. The dark scanner UI with full-screen result.
DICE requires a smartphone app. EvolveIT works in any phone browser. DICE has no MoMo payment rail. EvolveIT is built for the Ghana market from the ground up.
pretix
Open-source event ticketing with the pretixSCAN Proxy: a local hub that lets door scanners work offline and prevents double-entry across multiple scanners.
The venue hub concept. The local CAS (compare-and-swap) for door operations. The offline sync with unique constraint replay.
pretix is built for conferences and markets, not nightclubs. EvolveIT adds bar ordering, table service, organiser settlement, and financial accounting in the same platform.
Toast POS
Kitchen Display System with real-time order routing. Table QR ordering. Pay-at-table. Strong floor management.
The KDS design (dark, large cards, item-level READY button). The pay-first-then-display model. The per-station order routing.
Toast is designed for restaurants with reliable US internet infrastructure. EvolveIT's hub model keeps operations running through Cape Coast outages. Toast has no event ticketing. EvolveIT is a unified venue platform.
Square for Restaurants
Per-server cash accountability. Floor plan view. Shift close with per-server reconciliation.
The per-waiter cash attribution model for shift close. The floor map view for table status.
Square does not handle event ticketing, organiser portals, or mobile money payments. EvolveIT is purpose-built for the Ghanaian entertainment venue context.
Stripe Dashboard
Clean financial reporting. Drill-down from totals to individual transactions. Export everything. Audit trail on every action.
The reporting philosophy: totals are computed from raw transactions, not stored separately. Drill-down to individual ledger entries. CSV export on every view.
Stripe is a payment processor. EvolveIT is a venue operating system that includes payments as one component of a larger financial accountability model.
SevenRooms
Sophisticated reservation management. Guest profiles. VIP recognition at the door.
The floor map view for table reservations and walk-ins. The reservation lifecycle (reserved, arrived, no-show).
SevenRooms is designed for high-end restaurants and hotels. EvolveIT is designed for nightclub events with a focus on ticketed capacity, organiser management, and bar operations.

EvolveIT Improvements on the Baseline Ideas
The following improvements to the original Memories brief come from industry experience and analysis of what similar systems have learned over time.

Counter bar cashless policy: The original brief anticipated cash at all points of sale. Analysis of bar operations at high-volume nightclubs shows that cash at the counter is the primary source of revenue leakage, not because staff are dishonest, but because cash transactions at speed under noise and crowd pressure are impossible to audit reliably. Cashless counter with MoMo-only aligns Memories with the direction that major UK and European clubs (Fabric, Fabric London, Berghain) have moved. Customer friction is minimal because the majority of Memories customers already use Mobile Money routinely.
Waiter accountability model instead of manager PIN for cash: The original brief suggested manager PIN approval for all cash transactions. Industry experience shows that requiring a manager for every table cash payment creates bottlenecks in service and shifts accountability to a person who was not present for the transaction. The per-waiter attribution model — where each waiter accounts for their own cash at shift close — is more operationally efficient and creates stronger individual accountability. This is the model Square and Toast use for server cash handling.
Installment ticket payments: No major competitor in the Ghana market currently offers this for nightclub ticketing. The instalment model is novel and commercially significant. It lowers the barrier to purchase for high-value events (GHS 200+ tickets), increases advance sales, and the 10% forfeiture provides a meaningful commitment mechanism. The implementation must handle multi-reference refunds correctly, which requires explicit Paystack API calls per payment slice.
Hub as Phase 1, not Phase 6: The original student architectures placed offline support as a later addition. This is the most common mistake in venue technology deployments in markets with intermittent connectivity. Building the hub into the foundation means every subsequent feature (bar display, waiter app, kitchen display) runs over LAN from day one and benefits from the offline guarantee without additional engineering.
Organiser portal replacing informal WhatsApp booking: Most venues in Cape Coast coordinate with event organisers entirely via WhatsApp. The portal formalises this: the organiser submits through a structured form, management reviews in a logged system, and the settlement is computed from verified figures rather than negotiated verbally. This alone eliminates the most common source of organiser disputes.
Rolling deployment under real conditions: The 5-day build followed by progressive rollout is deliberate. The alternative (build for 3 months, deploy once) has a higher risk of discovering operational failures on a live night with a full crowd. Progressive rollout means the system earns trust module by module and failures, when they occur, affect a limited scope.

APPENDIX A
Technical Design Decisions
RATIONALE FOR KEY ARCHITECTURAL CHOICES
Decision
Chosen approach
Alternative considered
Reasoning
QR format
Rotating TOTP, 30-second window, EV1 prefix
Static signed URL
Static URL can be screenshot and shared. TOTP expires. Screenshots are useless within 90 seconds.
Door architecture
Venue hub on LAN as primary scan coordinator
Direct cloud API only
Cape Coast internet drops during events. Cloud-only scanning stops immediately. The hub means the door never goes dark.
Payment confirmation
Paystack webhook with HMAC-SHA512
Browser success callback
Browser closes after MoMo approve. Webhook arrives regardless of device state.
Double entry prevention
UNIQUE constraint on ticket_redemptions plus atomic UPDATE...RETURNING
Application-level check then insert
Two concurrent requests both pass an application-level check. Database constraints are atomic by definition.
Financial ledger
Append-only, trigger-enforced immutability
Status columns updated on change
Mutable records can be quietly altered. Append-only shows every correction permanently.
Counter payment
MoMo only — no cash at counter
Cash accepted at all points
Cash at a high-volume counter cannot be reliably audited. Cashless eliminates the primary revenue opacity point.
Table cash
Waiter-collected, waiter-attributed
Manager PIN approval for each transaction
Manager approval creates bottlenecks. Per-waiter attribution creates stronger individual accountability with less friction.
Tab model
Pay at order time via Paystack
Open running tab settled at end of visit
MoMo has no pre-authorisation hold. An open tab is unsecured credit at a nightclub where guests may leave.
Database platform
PostgreSQL on Supabase
Firebase Firestore
Financial reconciliation requires SQL aggregation across joined tables. Firestore cannot do this without client-side computation. Row Level Security at the database layer is not available in Firestore.
Deployment approach
5-day AI sprint, 2 August go-live, progressive rollout
Full build before any deployment
Progressive rollout discovers real operational issues on limited scope. Full build before deployment delays learning and risks a big-bang failure on a live event night.

APPENDIX B
AI Builder Contract
RULES THAT APPLY TO EVERY LINE OF CODE
Eight prohibitions. No exceptions.
An AI coding agent implementing this system must follow these rules on every line of code. These are not guidelines — they are constraints. Code that violates them is incorrect regardless of whether it appears to work in testing.

#
Prohibition
What breaks if violated
1
Never write tickets.status = "used" from anywhere other than the redeem_ticket function
The compare-and-swap and unique constraint are the entire double-entry mechanism. Bypassing them with a direct UPDATE creates a race condition that allows two simultaneous admissions.
2
Never verify the Paystack webhook signature on parsed JSON — always verify on the raw Buffer before parsing
Re-serialised JSON can have different byte order or whitespace. The signature is over the original bytes. A parser-first implementation may silently accept forged webhooks.
3
Never issue a ticket from a browser success callback or a redirect return
The browser may close, back-navigate, or be network-interrupted between MoMo approve and the callback. The webhook is the only reliable confirmation.
4
Never UPDATE or DELETE from ledger_entries under any circumstances
The trigger will refuse it. If application code attempts it, it is a bug. Corrections are new rows with reversal amounts.
5
Never store monetary amounts as floats or decimals
All amounts are integer pesewas. Float rounding errors are invisible in testing and visible in reconciliation. GHS 1.50 is stored as 150.
6
Never include totp_secret, totp_secret_enc, or any ticket secret in API responses, logs, or error messages
The secret is what makes the rotating QR work. Exposing it in a log makes every ticket with that secret forgeable for its remaining lifetime.
7
Never use sequential integer IDs on any customer-facing table
Sequential IDs allow enumeration: a guest with order ID 1042 can infer order 1041 exists and attempt to access it. All external-facing IDs are UUIDs.
8
Never implement a second version of the redeem logic for the hub — share the same module as cloud
Two implementations will diverge within weeks. The invariants (TOTP window, revocation check, CAS) must be identical on hub and cloud. One function, called from both.



EvolveIT  ·  Memories Night Club Digital Operations Platform  ·  Version 2.0  ·  August 2026
This is the complete and final specification. It supersedes all previous drafts. Implementation questions should reference this document before asking for clarification.