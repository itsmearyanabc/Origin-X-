import { z } from "zod";

/**
 * Public website chatbot ("Ask about ORIGINX"): a local keyword rule engine — no external AI API,
 * no API key, no per-message cost. Replies are fixed, ORIGINX-authored HTML snippets (the widgets
 * render HTML); visitor text is never echoed back. The route is rate-limited (chatLimiter).
 */
const OFF_TOPIC_REPLY = "I do not have a response for this , you can ask ur doubts about the origin x";
const messageSchema = z.object({ message: z.string().trim().min(1, "Message required").max(1000, "Please keep questions under 1000 characters.") });

const RULES: Array<{ keywords: string[]; reply: string }> = [
  {
    keywords: ["price", "cost", "plan", "free", "pay"],
    reply: "<p><b>Pricing:</b></p><ul><li><b>Free Plan:</b> 100 products, 3 team members. Organizations are reviewed before showing as verified.</li><li><b>Paid Plans:</b> Billed per organization. Contact us for volume or regulated-industry needs.</li></ul>",
  },
  {
    keywords: ["blockchain", "crypto", "hoodi", "hash", "rewrite"],
    reply: "<p><b>Proof no one can rewrite:</b> Original hashes are anchored on a blockchain (ethereum-hoodi). Even a full database rewrite gets caught. Nothing private ever goes on-chain.</p>",
  },
  {
    keywords: ["trust", "score"],
    reply: "<p><b>Trust Score:</b> Products receive a Trust Score out of 100 based on their origin, custody history, cryptographic proofs, and incidents.</p>",
  },
  {
    keywords: ["counterfeit", "fake", "verify", "scan", "customer"],
    reply: "<p><b>Every scan tells the truth:</b> Consumers can verify products via QR code for free. They see verified, recalled, or counterfeit statuses—never a misleading green tick.</p>",
  },
  {
    keywords: ["custody", "transfer", "factory", "logistics"],
    reply: "<p><b>Verified Custody:</b> Ownership only moves when the receiving company accepts it (e.g., Factory &rarr; Logistics &rarr; Distributor). Both sides sign the transfer.</p>",
  },
  {
    keywords: ["what is", "about", "origin x", "origin-x", "do", "how"],
    reply: "<p><b>Origin-X</b> is the verifiable identity layer for physical products.</p><p>It gives every physical product a verifiable digital identity (Digital Product Passports) to verify authenticity, inspect lifecycle evidence, detect suspicious identity activity, and manage inventory.</p>",
  },
];

export class ChatService {
  reply(input: unknown): { reply: string } {
    const q = messageSchema.parse(input).message.toLowerCase();
    const rule = RULES.find((r) => r.keywords.some((k) => q.includes(k)));
    return { reply: rule?.reply ?? OFF_TOPIC_REPLY };
  }
}

export const chatService = new ChatService();
