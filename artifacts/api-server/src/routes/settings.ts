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

const DEFAULT_WORK_DAYS = "1,2,3,4,5";

function parseWorkDays(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n >= 0 && n <= 6);
}

function validateWorkDays(raw: unknown): { valid: boolean; cleaned: string; error?: string } {
  if (typeof raw !== "string") return { valid: false, cleaned: "", error: "workDays must be a string." };
  const days = parseWorkDays(raw);
  if (days.length === 0 && raw.trim() !== "") {
    return { valid: false, cleaned: "", error: "workDays must be comma-separated day numbers 0–6." };
  }
  return { valid: true, cleaned: days.join(",") };
}

router.get("/settings", requireAuth, async (req, res) => {
  const userId = getUserId(req);

  const [settings] = await db
    .select()
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId))
    .limit(1);

  res.json({
    recipientEmails: settings?.recipientEmails ?? "",
    autoCheckIn: settings?.autoCheckIn ?? true,
    autoSubmit: settings?.autoSubmit ?? true,
    workDays: settings?.workDays ?? DEFAULT_WORK_DAYS,
  });
});

router.patch("/settings", requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const body = req.body as {
    recipientEmails?: unknown;
    autoCheckIn?: unknown;
    autoSubmit?: unknown;
    workDays?: unknown;
  };

  const updates: Record<string, unknown> = { updatedAt: new Date() };

  // recipientEmails — optional field
  if (body.recipientEmails !== undefined) {
    if (typeof body.recipientEmails !== "string") {
      res.status(400).json({ error: "recipientEmails must be a string." });
      return;
    }
    const validation = validateRecipientEmails(body.recipientEmails);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }
    updates.recipientEmails = validation.cleaned;
  }

  // autoCheckIn — optional boolean
  if (body.autoCheckIn !== undefined) {
    if (typeof body.autoCheckIn !== "boolean") {
      res.status(400).json({ error: "autoCheckIn must be a boolean." });
      return;
    }
    updates.autoCheckIn = body.autoCheckIn;
  }

  // autoSubmit — optional boolean
  if (body.autoSubmit !== undefined) {
    if (typeof body.autoSubmit !== "boolean") {
      res.status(400).json({ error: "autoSubmit must be a boolean." });
      return;
    }
    updates.autoSubmit = body.autoSubmit;
  }

  // workDays — optional string
  if (body.workDays !== undefined) {
    const wdValidation = validateWorkDays(body.workDays);
    if (!wdValidation.valid) {
      res.status(400).json({ error: wdValidation.error });
      return;
    }
    updates.workDays = wdValidation.cleaned;
  }

  const [existing] = await db
    .select()
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId))
    .limit(1);

  let saved;
  if (existing) {
    [saved] = await db
      .update(userSettingsTable)
      .set(updates as any)
      .where(eq(userSettingsTable.userId, userId))
      .returning();
  } else {
    [saved] = await db
      .insert(userSettingsTable)
      .values({
        userId,
        recipientEmails: (updates.recipientEmails as string) ?? "",
        autoCheckIn: (updates.autoCheckIn as boolean) ?? true,
        autoSubmit: (updates.autoSubmit as boolean) ?? true,
        workDays: (updates.workDays as string) ?? DEFAULT_WORK_DAYS,
      })
      .returning();
  }

  res.json({
    recipientEmails: saved?.recipientEmails ?? "",
    autoCheckIn: saved?.autoCheckIn ?? true,
    autoSubmit: saved?.autoSubmit ?? true,
    workDays: saved?.workDays ?? DEFAULT_WORK_DAYS,
  });
});

export default router;
