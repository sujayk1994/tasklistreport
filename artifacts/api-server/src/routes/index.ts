import { Router, type IRouter } from "express";
import healthRouter from "./health";
import configRouter from "./config";
import tasksRouter from "./tasks";
import settingsRouter from "./settings";
import adminRouter from "./admin";
import diagnosticsRouter from "./diagnostics";

const router: IRouter = Router();

router.use(healthRouter);
router.use(configRouter);
router.use(tasksRouter);
router.use(settingsRouter);
router.use(adminRouter);
router.use(diagnosticsRouter);

export default router;
