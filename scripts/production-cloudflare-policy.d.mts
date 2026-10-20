type ProductionRole = "landing" | "member" | "admin";
export function productionTarget(
  mode: string | undefined,
  app: "member" | "admin",
): { role: ProductionRole; name: string; origin: string } | undefined;
export function productionValues(
  key: string | undefined,
  role: ProductionRole,
): Record<string, string>;
