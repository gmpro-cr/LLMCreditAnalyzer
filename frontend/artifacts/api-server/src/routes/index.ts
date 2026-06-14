import { Router, type IRouter } from "express";
import healthRouter from "./health";
import casesRouter from "./cases";
import memosRouter from "./memos";
import dashboardRouter from "./dashboard";
import companiesRouter from "./companies";
import dataRoomRouter from "./data-room";
import bankStatementRouter from "./bank-statement";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

// Public — liveness/wakeup probes only, no data access.
router.use(healthRouter);

// Everything below requires a valid Supabase session.
router.use(requireAuth);
router.use("/cases", casesRouter);
router.use("/cases", memosRouter);
router.use("/cases", dataRoomRouter);
router.use("/dashboard", dashboardRouter);
router.use("/companies", companiesRouter);
router.use("/bank-statement", bankStatementRouter);

export default router;
