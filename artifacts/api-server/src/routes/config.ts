import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/config", (_req, res) => {
  res.json({
    clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY ?? "",
    clerkProxyUrl: process.env.CLERK_PROXY_URL ?? "",
  });
});

export default router;
