import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth";
import { getEmailEnvStatus, getLastEmailAttempt } from "../lib/email";

// ---------------------------------------------------------------------------
// Temporary diagnostics endpoint — used by Settings > Diagnostics panel so
// the user can see exactly what happened on the last email send attempt
// (auth missing, recipients invalid, SMTP rejected, timed out, etc.) without
// needing access to server logs. Remove this file (and the matching panel
// in artifacts/task-manager/src/pages/settings.tsx) once email is verified
// working in production.
// ---------------------------------------------------------------------------

const router: IRouter = Router();

router.get("/diagnostics/email", requireAuth, (_req, res) => {
  res.json({
    serverTime: new Date().toISOString(),
    env: getEmailEnvStatus(),
    lastAttempt: getLastEmailAttempt(),
  });
});

export default router;
