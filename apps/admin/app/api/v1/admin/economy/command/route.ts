import { createEconomyCommandHandler } from "../../../../../../lib/economy/handler";
import { economyDependencies } from "../../../../../../lib/economy/server";

export const dynamic = "force-dynamic";
export const POST = createEconomyCommandHandler(economyDependencies);
