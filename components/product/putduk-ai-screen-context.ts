import { aiScreenContextSchema, type AiScreenContext } from "@/domain/ai/chat";

type SearchParamsReader = Pick<URLSearchParams, "get">;

export type PutdukAiExplicitScreenContext = Omit<
  AiScreenContext,
  "currentRoute"
>;

type BuildPutdukAiScreenContextInput = {
  explicitContext?: PutdukAiExplicitScreenContext;
  pathname: string;
  searchParams?: SearchParamsReader;
};

const QUERY_KEY_BY_CONTEXT_FIELD = {
  currentProduct: "currentProduct",
  currentWorld: "currentWorld",
  selectedEvent: "selectedEvent",
  selectedTransaction: "selectedTransaction",
} as const;

type QueryContextField = keyof typeof QUERY_KEY_BY_CONTEXT_FIELD;

function validContextValue<Key extends keyof AiScreenContext>(
  key: Key,
  value: unknown,
): AiScreenContext[Key] | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const parsed = aiScreenContextSchema.safeParse({ [key]: value });
  return parsed.success ? parsed.data[key] : undefined;
}

function readContextValue<Key extends QueryContextField>(
  key: Key,
  explicitContext: PutdukAiExplicitScreenContext | undefined,
  searchParams: SearchParamsReader | undefined,
): AiScreenContext[Key] | undefined {
  const hasExplicitValue =
    explicitContext !== undefined &&
    Object.prototype.hasOwnProperty.call(explicitContext, key);
  const value = hasExplicitValue
    ? explicitContext[key]
    : searchParams?.get(QUERY_KEY_BY_CONTEXT_FIELD[key]);

  return validContextValue(key, value);
}

/**
 * Builds the smallest server-approved screen hint for PUTDUK AI.
 *
 * Only the current path and four explicitly allowlisted query/prop values are
 * considered. The full URL, arbitrary query values, and caller identity are
 * never copied into the request.
 */
export function buildPutdukAiScreenContext({
  explicitContext,
  pathname,
  searchParams,
}: BuildPutdukAiScreenContextInput): AiScreenContext | undefined {
  const currentRoute = validContextValue("currentRoute", pathname);
  if (!currentRoute) {
    return undefined;
  }

  const context: AiScreenContext = { currentRoute };
  const currentProduct = readContextValue(
    "currentProduct",
    explicitContext,
    searchParams,
  );
  const currentWorld = readContextValue(
    "currentWorld",
    explicitContext,
    searchParams,
  );
  const selectedEvent = readContextValue(
    "selectedEvent",
    explicitContext,
    searchParams,
  );
  const selectedTransaction = readContextValue(
    "selectedTransaction",
    explicitContext,
    searchParams,
  );

  if (currentProduct) {
    context.currentProduct = currentProduct;
  }
  if (currentWorld) {
    context.currentWorld = currentWorld;
  }
  if (selectedEvent) {
    context.selectedEvent = selectedEvent;
  }
  if (selectedTransaction) {
    context.selectedTransaction = selectedTransaction;
  }

  const parsed = aiScreenContextSchema.safeParse(context);
  return parsed.success ? parsed.data : undefined;
}
