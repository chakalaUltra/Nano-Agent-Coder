import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import reposRouter from "./repos";
import rollbacksRouter from "./rollbacks";
import chatRouter from "./chat";
import runRouter from "./run";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(reposRouter);
router.use(rollbacksRouter);
router.use(chatRouter);
router.use(runRouter);

export default router;
