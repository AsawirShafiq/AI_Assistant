/**
 * Prompt Template System for the WriterAgent
 *
 * ## Prompt Engineering Strategy
 *
 * Each email type gets its own *system prompt* and *user prompt builder*.
 * The design follows five principles:
 *
 * 1. **Role anchoring**        — open with a concrete persona ("You are a
 *    senior B2B sales copywriter …") so the model stays in character.
 *
 * 2. **Structured constraints** — bullet-list rules the model can check
 *    against (word count, forbidden phrases, format) rather than prose
 *    paragraphs it might skip.
 *
 * 3. **Persona injection**     — sender identity (name, title, company)
 *    is placed in the system prompt so it colours every generation, while
 *    lead-specific data goes in the user prompt (variable per call).
 *
 * 4. **Output format pinning** — the final line of every system prompt
 *    says "Output ONLY: Subject: … then body" to suppress markdown
 *    fences, explanations, and preamble.
 *
 * 5. **Negative examples**     — `avoidPhrases` are explicitly listed so
 *    the model treats them as hard constraints, not suggestions.
 *
 * ### Temperature guidance
 *
 * | Type             | Temperature | Why                                      |
 * |------------------|-------------|------------------------------------------|
 * | first_outreach   | 0.8         | Creative hook, varied openers            |
 * | follow_up        | 0.5         | Consistent with prior thread             |
 * | re_engagement    | 0.7         | Warmth + some creative latitude          |
 */

import { EmailRequest, EmailType, EmailLength } from "../types";

// ─── Public API ──────────────────────────────────────────

export interface PromptPair {
  systemPrompt: string;
  userPrompt: string;
  /** Suggested temperature for this email type. */
  temperature: number;
  /** Identifies which template was used (for traceability). */
  templateId: string;
}

/**
 * Build a matched system + user prompt pair for any email type.
 * This is the single entry-point the EmailService / WriterAgent calls.
 */
export function buildPromptPair(request: EmailRequest): PromptPair {
  const builder = TEMPLATE_REGISTRY[request.emailType];
  return builder(request);
}

/**
 * Return the list of available email types (for capability reporting).
 */
export function getAvailableTemplates(): EmailType[] {
  return Object.keys(TEMPLATE_REGISTRY) as EmailType[];
}

// ─── Template Registry ───────────────────────────────────

type TemplateBuilder = (req: EmailRequest) => PromptPair;

const TEMPLATE_REGISTRY: Record<EmailType, TemplateBuilder> = {
  first_outreach: buildFirstOutreach,
  follow_up: buildFollowUp,
  re_engagement: buildReEngagement,
};

// ─── Shared Helpers ──────────────────────────────────────

function wordLimit(length: EmailLength = "medium"): number {
  switch (length) {
    case "short":  return 80;
    case "medium": return 150;
    case "long":   return 250;
  }
}

/**
 * Resolve the effective email length for a request.
 * Priority: explicit `req.length` > memory `preferredLength` > "medium".
 */
function resolveLength(req: EmailRequest): EmailLength {
  if (req.length) return req.length;
  const memLen = req.preferences.preferredLength;
  if (memLen === "short" || memLen === "medium" || memLen === "long") {
    return memLen as EmailLength;
  }
  return "medium";
}

function avoidBlock(phrases: string[]): string {
  if (phrases.length === 0) return "";
  return `\n- NEVER use these phrases: ${phrases.map(p => `"${p}"`).join(", ")}`;
}

function styleNotesBlock(notes: string[] | undefined): string {
  if (!notes || notes.length === 0) return "";
  return `\n- Additional style rules: ${notes.join("; ")}`;
}

function signatureBlock(signature: string | undefined): string {
  if (!signature) return "";
  return `\n\nEmail signature to append after the sign-off:\n${signature}`;
}

function senderBlock(req: EmailRequest): string {
  const p = req.preferences;
  const parts = [`${p.senderName}`];
  if (p.senderTitle) parts.push(p.senderTitle);
  if (p.companyName) parts.push(`at ${p.companyName}`);
  return parts.join(", ");
}

function leadBlock(req: EmailRequest): string {
  const l = req.lead;
  const lines = [
    `- Company: ${l.company}`,
    `- Contact: ${l.contactName}${l.contactTitle ? ` (${l.contactTitle})` : ""}`,
    `- Email: ${l.contactEmail}`,
    `- Industry: ${l.industry}`,
    `- Location: ${l.location}`,
    `- Deal stage: ${l.dealStage}`,
    `- Company size: ${l.companySize}`,
  ];
  if (l.estimatedValue) {
    lines.push(`- Estimated deal value: $${l.estimatedValue.toLocaleString()}`);
  }
  if (l.tags.length > 0) {
    lines.push(`- Tags: ${l.tags.join(", ")}`);
  }
  if (l.notes) {
    lines.push(`- Notes / context: ${l.notes}`);
  }
  return lines.join("\n");
}

function customBlock(req: EmailRequest): string {
  if (!req.customInstructions) return "";
  return `\nAdditional instructions from the user:\n${req.customInstructions}`;
}

// ─── Template: First Outreach ────────────────────────────

function buildFirstOutreach(req: EmailRequest): PromptPair {
  const effectiveLength = resolveLength(req);
  const limit = wordLimit(effectiveLength);
  const p = req.preferences;

  const systemPrompt = `You are a senior B2B sales copywriter who specialises in personalised cold outreach.

Your sender identity:
  ${senderBlock(req)}

Style rules:
- Tone: ${p.tone}
- Keep the email under ${limit} words
- Open with something specific to the lead's company or industry — NO generic openers like "I hope this email finds you well"
- Include exactly ONE clear, low-friction call to action (e.g. "Would a 15-min call next week work?")
- End with: ${p.signOff}${avoidBlock(p.avoidPhrases)}${styleNotesBlock(p.styleNotes)}${signatureBlock(p.signature)}

Output format (strict):
Line 1: Subject: <subject line>
Line 2+: email body (plain text, no markdown)
Do NOT include any explanation or commentary.`;

  const userPrompt = `Write a first-outreach cold email for this lead:

${leadBlock(req)}
${customBlock(req)}`;

  return {
    systemPrompt,
    userPrompt,
    temperature: 0.8,
    templateId: "first_outreach_v1",
  };
}

// ─── Template: Follow-Up ─────────────────────────────────

function buildFollowUp(req: EmailRequest): PromptPair {
  const effectiveLength = resolveLength(req) === "medium" ? "short" : resolveLength(req);
  const limit = wordLimit(effectiveLength);
  const p = req.preferences;
  const days = req.daysSinceLastContact ?? 7;

  const prevSubjectLine = req.previousSubject
    ? `\n- Reference the previous email with subject: "${req.previousSubject}"`
    : "\n- Reference your previous email naturally without quoting a specific subject";

  const systemPrompt = `You are a senior B2B sales copywriter crafting a concise follow-up email.

Your sender identity:
  ${senderBlock(req)}

Style rules:
- Tone: ${p.tone}
- Keep the email under ${limit} words — follow-ups must be shorter than the original
- Do NOT repeat the full pitch — add ONE new piece of value (stat, case study, insight)${prevSubjectLine}
- It has been approximately ${days} day(s) since the last email
- Include exactly ONE call to action
- End with: ${p.signOff}${avoidBlock(p.avoidPhrases)}${styleNotesBlock(p.styleNotes)}${signatureBlock(p.signature)}

Output format (strict):
Line 1: Subject: Re: <original or new subject>
Line 2+: email body (plain text, no markdown)
Do NOT include any explanation or commentary.`;

  const userPrompt = `Write a follow-up email for this lead:

${leadBlock(req)}
${customBlock(req)}`;

  return {
    systemPrompt,
    userPrompt,
    temperature: 0.5,
    templateId: "follow_up_v1",
  };
}

// ─── Template: Re-Engagement ─────────────────────────────

function buildReEngagement(req: EmailRequest): PromptPair {
  const effectiveLength = resolveLength(req);
  const limit = wordLimit(effectiveLength);
  const p = req.preferences;
  const days = req.daysSinceLastContact ?? 30;

  const systemPrompt = `You are a senior B2B sales copywriter writing a re-engagement email to a lead who has gone cold.

Your sender identity:
  ${senderBlock(req)}

Style rules:
- Tone: ${p.tone}, but warmer and more empathetic than a standard cold email
- Keep the email under ${limit} words
- Acknowledge the gap (≈${days} days) without guilt-tripping
- Lead with a NEW reason to reconnect: a product update, industry trend, or relevant insight
- Make it easy to say "not interested" — reduces friction and increases reply rates
- Include exactly ONE soft call to action
- End with: ${p.signOff}${avoidBlock(p.avoidPhrases)}${styleNotesBlock(p.styleNotes)}${signatureBlock(p.signature)}

Output format (strict):
Line 1: Subject: <subject line>
Line 2+: email body (plain text, no markdown)
Do NOT include any explanation or commentary.`;

  const userPrompt = `Write a re-engagement email for this lead who has been unresponsive for ~${days} days:

${leadBlock(req)}
${customBlock(req)}`;

  return {
    systemPrompt,
    userPrompt,
    temperature: 0.7,
    templateId: "re_engagement_v1",
  };
}
