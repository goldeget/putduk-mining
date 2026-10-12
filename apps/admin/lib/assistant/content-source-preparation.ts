import "server-only";
import { CONTENT_SOURCE_PINS,CONTENT_SOURCE_REVISION,CONTENT_SOURCE_REPOSITORY } from "../../../../domain/content/source-preview";
import { HIGH_IMPACT_ROLES } from "../auth/policy";
import { CONTENT_SOURCE_PREVIEW_MAX_BODY_BYTES } from "../content/source-preview-handler";

/**
 * Machine-readable read/draft preparation port for operator AI.
 * It reuses the existing authorized endpoint and strict input unchanged.
 * This catalog grants no permission and registers no executor.
 */
export const ASSISTANT_CONTENT_SOURCE_PREPARATIONS = Object.freeze(
  CONTENT_SOURCE_PINS.filter(pin=>["EVENT","NOTICE","FAQ"].includes(pin.kind)).map(pin=>Object.freeze({
    operation:"content-source-"+pin.kind.toLowerCase()+"-prepare",
    kind:pin.kind,method:"POST" as const,endpoint:"/api/content/source/preview",
    allowedRoles:Object.freeze([...HIGH_IMPACT_ROLES]),requiredAal:"aal2" as const,
    repository:CONTENT_SOURCE_REPOSITORY,sourceRevision:CONTENT_SOURCE_REVISION,
    sourcePath:pin.path,sourceSha256:pin.sha256,sourceBytes:pin.bytes,
    sourceItemCount:pin.itemCount,maxBodyBytes:CONTENT_SOURCE_PREVIEW_MAX_BODY_BYTES,
    inputFields:Object.freeze(["sourceRevision","sourcePath","sourceSha256","rawSourceText"]),
    inputTaskFieldAllowed:false as const,
    inputShapeOwner:"domain/content/source-preview.ts",
    handlerOwner:"apps/admin/lib/content/source-preview-handler.ts",
    successState:"DRAFT_ONLY" as const,canPublish:false as const,canExecute:false as const,
    providerCalled:false as const,registrationExecuted:false as const,
    economicPolicyApproval:false as const,
    errorContract:Object.freeze({invalidRequest:400,unknownPin:400,authorizationDenied:"EXISTING_AUTH_STATUS",
      unconfirmedAuthority:503,sourceHashOrShapeMismatch:409,payloadTooLarge:413}),
  })),
);
export type AssistantContentSourcePreparation = (typeof ASSISTANT_CONTENT_SOURCE_PREPARATIONS)[number];
export function findAssistantContentSourcePreparation(operation:string):AssistantContentSourcePreparation|null {
  return ASSISTANT_CONTENT_SOURCE_PREPARATIONS.find(item=>item.operation===operation)??null;
}
