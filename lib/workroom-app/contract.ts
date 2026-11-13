import { z } from "zod";

const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
const body = z.string().trim().min(1).max(2000);
const requestKey = z.string().regex(/^[A-Za-z0-9_-]{8,200}$/);
const page = {
  cursor: uuid.optional(),
  limit: z.number().int().min(1).max(50).optional(),
};
export const SupportReadInputSchema = z
  .object({
    ...page,
    threadId: uuid.optional(),
    filter: z.enum(["ALL", "UNANSWERED", "MINE", "RESOLVED"]).optional(),
  })
  .strict();
export const NotificationsReadInputSchema = z.object(page).strict();
const threadInput = z.object({ threadId: uuid }).strict();
const read = <N extends string, S extends z.ZodTypeAny>(name: N, input: S) =>
  z
    .object({
      operation: z.literal(name),
      requestKey: requestKey.nullish(),
      input,
    })
    .strict();
const write = <N extends string, S extends z.ZodTypeAny>(name: N, input: S) =>
  z.object({ operation: z.literal(name), requestKey, input }).strict();
const mediaType = z.enum(["image/jpeg", "image/png", "image/webp"]);
const attachmentIds = z.array(uuid).min(1).max(3).optional();
const shared = [
  write(
    "ATTACHMENT_PREPARE",
    z
      .object({ mediaType, sizeBytes: z.number().int().min(1).max(5242880) })
      .strict(),
  ),
  write("ATTACHMENT_COMMIT", z.object({ id: uuid }).strict()),
  read("ATTACHMENT_READ", z.object({ id: uuid }).strict()),
  read("SUPPORT_READ", SupportReadInputSchema),
  read("NOTIFICATIONS_READ", NotificationsReadInputSchema),
  write("NOTIFICATION_READ", z.object({ id: uuid }).strict()),
  write("SUPPORT_SEEN", threadInput.extend({ messageId: uuid })),
] as const;
export const WorkroomAppMemberCommandSchema = z.discriminatedUnion(
  "operation",
  [
    write("PUSH_BIND_MEMBER", z.object({ subscriptionId: uuid }).strict()),
    ...shared,
    write(
      "SUPPORT_SEND",
      z.object({ threadId: uuid.optional(), body, attachmentIds }).strict(),
    ),
  ],
);
export const WorkroomAppAdminCommandSchema = z.discriminatedUnion("operation", [
  ...shared,
  write("SUPPORT_REPLY", threadInput.extend({ body, attachmentIds })),
  write("SUPPORT_ASSIGN", threadInput),
  write("SUPPORT_RESOLVE", threadInput),
  write("PUSH_BIND_ADMIN", z.object({ subscriptionId: uuid }).strict()),
]);
export const WorkroomAppMessageSchema = z
  .object({
    id: uuid,
    threadId: uuid,
    senderRole: z.enum(["MEMBER", "ADMIN"]),
    body: z.string(),
    createdAt: instant,
    attachments: z
      .array(
        z
          .object({
            id: uuid,
            mediaType,
            sizeBytes: z.number().int().positive(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export const WorkroomAppThreadSchema = z
  .object({
    id: uuid,
    memberId: uuid,
    memberLoginId: z.string().nullable(),
    memberName: z.string(),
    status: z.enum(["OPEN", "ASSIGNED", "ANSWERED", "RESOLVED"]),
    assignedAdminId: uuid.nullable(),
    updatedAt: instant,
    unreadCount: z.number().int().nonnegative(),
    messages: z.array(WorkroomAppMessageSchema),
  })
  .strict();
export const WorkroomAppSupportPageSchema = z
  .object({
    items: z.array(WorkroomAppThreadSchema),
    nextCursor: uuid.nullable(),
  })
  .strict();
export const WorkroomAppThreadResultSchema = z
  .object({ thread: WorkroomAppThreadSchema })
  .strict();
export const WorkroomAppNotificationSchema = z
  .object({
    id: uuid,
    type: z.string(),
    title: z.string(),
    body: z.string(),
    route: z.string(),
    createdAt: instant,
    readAt: instant.nullable(),
  })
  .strict();
export const WorkroomAppInboxPageSchema = z
  .object({
    items: z.array(WorkroomAppNotificationSchema),
    unreadCount: z.number().int().nonnegative(),
    nextCursor: uuid.nullable(),
  })
  .strict();
export const WorkroomAppNotificationResultSchema = z
  .object({ item: WorkroomAppNotificationSchema })
  .strict();
export type SupportMessage = z.infer<typeof WorkroomAppMessageSchema>;
export type Thread = z.infer<typeof WorkroomAppThreadSchema>;
export type ThreadResult = z.infer<typeof WorkroomAppThreadResultSchema>;
export type SupportPage = z.infer<typeof WorkroomAppSupportPageSchema>;
export type NotificationItem = z.infer<typeof WorkroomAppNotificationSchema>;
export type InboxPage = z.infer<typeof WorkroomAppInboxPageSchema>;
export const WorkroomAppAttachmentPreparedSchema = z
  .object({ id: uuid, path: z.string() })
  .strict();
export const WorkroomAppAttachmentCommittedSchema = z
  .object({ id: uuid })
  .strict();
export const WorkroomAppAttachmentReadSchema = z
  .object({
    id: uuid,
    path: z.string(),
    mediaType,
    sizeBytes: z.number().int().min(1).max(5242880),
  })
  .strict();
