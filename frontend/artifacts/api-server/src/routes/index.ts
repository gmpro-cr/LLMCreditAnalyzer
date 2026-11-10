import { Router, type IRouter } from "express";
import healthRouter from "./health";
import casesRouter from "./cases";
import memosRouter from "./memos";
import dashboardRouter from "./dashboard";
import companiesRouter from "./companies";
import dataRoomRouter from "./data-room";
import bankStatementRouter from "./bank-statement";
import gstRouter from "./gst";
import agentRouter from "./agent";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/cases", casesRouter);
router.use("/cases", memosRouter);
router.use("/cases", dataRoomRouter);
router.use("/cases", agentRouter);
router.use("/dashboard", dashboardRouter);
router.use("/companies", companiesRouter);
router.use("/bank-statement", bankStatementRouter);
router.use("/gst", gstRouter);

export default router;
