/**
 * Owner rulings, 4 Nov 2026: "Nexeo will not read whatsapp message receiving from others"; "whatsapp will
 * only be used to connect user with Nexeo or Suzi, where user can ask anything or Suzi/Nexeo can inform or
 * update user".
 *
 * So, by default:
 *  - a message from anyone who is not a registered user is not read, relayed, triaged, captured as a
 *    delegation reply or put in the feed. Their number is still kept (owner ruling 2026-09-02), never the
 *    words;
 *  - the user's other WhatsApp chats are not read, and their replies there are not captured;
 *  - Nexeo sends WhatsApp only to a registered user. Other people are reached by email.
 *
 * A user's own messages to Nexeo, their dictation, and Nexeo's replies and updates to them are not affected.
 * The env var exists only so the dormant paths stay tested.
 */
import { resolveRegisteredWhatsAppUser } from './inboundIdentity';

export const whatsappWithOthers = (): boolean => process.env.WHATSAPP_WITH_OTHERS === '1';

export const WHATSAPP_USER_ONLY = "WhatsApp only connects the user with Nexeo or Suzi, so it can't message other people. Email can.";

/** May Nexeo send this number a WhatsApp message? If the lookup fails, no: this path only reaches other people. */
export async function mayWhatsApp(clientNumber: string, phone: string): Promise<boolean> {
  if (whatsappWithOthers()) return true;
  return !!(await resolveRegisteredWhatsAppUser(clientNumber, phone).catch(() => null));
}
