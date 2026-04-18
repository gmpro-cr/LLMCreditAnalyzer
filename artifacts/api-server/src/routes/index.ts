import { Router, type IRouter } from "express";
import healthRouter from "./health";
import casesRouter from "./cases";
import memosRouter from "./memos";
import dashboardRouter from "./dashboard";
import companiesRouter from "./companies";
import dataRoomRouter from "./data-room";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/cases", casesRouter);
router.use("/cases", memosRouter);
router.use("/cases", dataRoomRouter);
router.use("/dashboard", dashboardRouter);
router.use("/companies", companiesRouter);

export default router;
