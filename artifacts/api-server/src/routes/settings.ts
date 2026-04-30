import { Router } from "express";
import { db, userSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, getUserId } from "../lib/auth";

const router = Router();

const MAX_RECIPIENTS = 10;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRecipientEmails(raw: string): { valid: boolean; cleaned: string; error?: string } {
  if (typeof raw !== "string") return { valid: false, cleaned: "", error: "Invalid input." };

  const emails = raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  if (emails.length > MAX_RECIPIENTS) {
    return { valid: false, cleaned: "", error: `Maximum ${MAX_RECIPIENTS} recipient emails allowed.` };
  }

  const invalid = emails.find((e) => !EMAIL_REGEX.test(e));
  if (invalid) {
    return { valid: false, cleaned: "", error: `Invalid email address: ${invalid}` };
  }

  return { valid: true, cleaned: emails.join(", ") };
}

router.get("/settings", requireAuth, async (req, res) => {
  const userId = getUserId(req);

  const [settings] = await db
    .select()
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId))
    .limit(1);

  res.json({ recipientEmails: settings?.recipientEmails ?? "" });
});

router.patch("/settings", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const { recipientEmails } = req.body as { recipientEmails?: unknown };

  if (typeof recipientEmails !== "string") {
    res.status(400).json({ error: "recipientEmails must be a string." });
    return;
  }

  const validation = validateRecipientEmails(recipientEmails);
  if (!validation.valid) {
    res.status(400).json({ error: validation.error });
    return;
  }

  const [existing] = await db
    .select()
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId))
    .limit(1);

  if (existing) {
    await db
      .update(userSettingsTable)
      .set({ recipientEmails: validation.cleaned, updatedAt: new Date() })
      .where(eq(userSettingsTable.userId, userId));
  } else {
    await db
      .insert(userSettingsTable)
      .values({ userId, recipientEmails: validation.cleaned });
  }

  res.json({ recipientEmails: validation.cleaned });
});

export default router;
