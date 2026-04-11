import { Router, type IRouter } from "express";
import healthRouter from "./health";
import casesRouter from "./cases";
import memosRouter from "./memos";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/cases", casesRouter);
router.use("/cases", memosRouter);
router.use("/dashboard", dashboardRouter);

export default router;
