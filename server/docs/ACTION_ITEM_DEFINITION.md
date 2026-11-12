# What goes into the Action Center — agreed definition

Agreed by the owner on 2026-11-12 (CL-074): *"i agreed with your definition"*. This is the rule every
path that creates an open item must meet: the email, chat and calendar consumer, meeting digests,
commitments, Brain, Suzi and the portal. One gate enforces it (`openItemGate.ts`), never one check per
path.

**An action item is something the owner has to do — decide, approve, reply, pay, provide, review, or
attend with preparation — that someone asked of him or he committed to, and that is not done yet.**

## In

1. **Asked of him.** He is on the To line and the ask is to him (by name, as "you", or he is the only
   recipient), or the message escalates it to him by name.
2. **From a real person**, inside TMC or outside, or **from a business system that needs his approval**
   (a timesheet approval, an invoice to pay).
3. **His own commitment**, made in a meeting, chat or email ("I'll send it tomorrow").
4. **Created by him or by Suzi.**

## Out

- He is only copied, or the ask is to someone else.
- His own sent mail. An ask he sent is not his task.
- Newsletters, notifications, receipts, plain meeting invites.
- System alerts (for example "Assistant cannot reach its AI provider"). These go to system health as
  one notice, never as tasks.
- Nexeo's own reminders, never read back in as new tasks.
- Support requests to a product or shared mailbox (for example Vision Metric staff questions). These go
  to that product's support owner.

## Each item

- **One item per conversation.** A later message in the thread adds a note, changes the due date, or
  closes the item. It never creates a second one.
- **Due date:** taken from the message when it names one. Otherwise the item still shows, marked
  "no date". Nothing is held back out of sight.
- **Priority:** medium by default. High when due within 3 days or a client, money or a contract is
  involved. Critical when due today, or money or a deal is at risk now.
- **Closes when** he marks it Done or Wrong, when his reply answers it, or when the thread shows it
  done.
- **"Wrong" teaches.** The same kind of message from the same sender stops becoming an item.

## Still open (asked 2026-11-12, not yet answered)

1. Asks he sent to others: a separate "Waiting on others" list, or nothing?
2. Emails he is copied on: nothing, or a short "For your information" list?
3. Vision Metric support mail: who owns it?
4. No activity for 14 days: a "Still relevant?" list, or open until he closes it (his earlier rule,
   "silence never closes work", the default until he says otherwise)?

Anything here that changes what Suzi receives (a "no date" marker, extra lists) is agreed with Suzi
Master in `NEXEO_SUZI_AGREEMENT.md` before it is built.
