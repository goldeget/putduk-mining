import { createEconomyStateHandler } from "../../../../../../lib/economy/handler";
import { economyDependencies } from "../../../../../../lib/economy/server";

export const dynamic = "force-dynamic";
export const POST = createEconomyStateHandler(economyDependencies);
