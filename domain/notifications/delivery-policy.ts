export type NotificationChannel = "IN_APP" | "PUSH";
export type NotificationPriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

export type NotificationDeliveryInput = {
  allowedDeepLinkPrefixes: readonly string[];
  dailyNonCriticalCap: number;
  deepLink: string;
  deliveredToday: number;
  enabledChannels: Readonly<Record<NotificationChannel, boolean>>;
  lastNonCriticalDeliveryAt?: Date;
  nonCriticalCooldownMinutes: number;
  now: Date;
  priority: NotificationPriority;
  quietHours?: { endHour: number; startHour: number };
  timezoneOffsetMinutes: number;
};

export type NotificationDeliveryDecision = {
  channels: readonly NotificationChannel[];
  deliverAt: Date;
  reason: "DELIVER" | "DAILY_CAP" | "COOLDOWN" | "QUIET_HOURS";
};

export function isAllowedNotificationDeepLink(
  deepLink: string,
  allowedPrefixes: readonly string[],
): boolean {
  return (
    deepLink.startsWith("/") &&
    !deepLink.startsWith("//") &&
    !deepLink.includes("\\") &&
    allowedPrefixes.some(
      (prefix) => deepLink === prefix || deepLink.startsWith(`${prefix}/`),
    )
  );
}

function nextQuietHoursEnd(
  now: Date,
  offsetMinutes: number,
  endHour: number,
): Date {
  const localNow = new Date(now.getTime() + offsetMinutes * 60_000);
  const localEnd = new Date(localNow);
  localEnd.setUTCHours(endHour, 0, 0, 0);
  if (localEnd <= localNow) {
    localEnd.setUTCDate(localEnd.getUTCDate() + 1);
  }
  return new Date(localEnd.getTime() - offsetMinutes * 60_000);
}

export function decideNotificationDelivery(
  input: NotificationDeliveryInput,
): NotificationDeliveryDecision {
  if (
    !isAllowedNotificationDeepLink(
      input.deepLink,
      input.allowedDeepLinkPrefixes,
    )
  ) {
    throw new Error(
      "Notification deep link is outside the protected allowlist.",
    );
  }
  if (
    !Number.isSafeInteger(input.deliveredToday) ||
    input.deliveredToday < 0 ||
    !Number.isSafeInteger(input.dailyNonCriticalCap) ||
    input.dailyNonCriticalCap < 0 ||
    input.dailyNonCriticalCap > 100 ||
    !Number.isSafeInteger(input.nonCriticalCooldownMinutes) ||
    input.nonCriticalCooldownMinutes < 0
  ) {
    throw new RangeError("Notification counters and cooldowns must be valid.");
  }

  const channels = (["IN_APP", "PUSH"] as const).filter(
    (channel) => input.enabledChannels[channel],
  );
  const isCritical = input.priority === "CRITICAL";
  if (!isCritical && input.deliveredToday >= input.dailyNonCriticalCap) {
    return { channels: [], deliverAt: input.now, reason: "DAILY_CAP" };
  }

  if (!isCritical && input.lastNonCriticalDeliveryAt) {
    const nextAllowedAt = new Date(
      input.lastNonCriticalDeliveryAt.getTime() +
        input.nonCriticalCooldownMinutes * 60_000,
    );
    if (nextAllowedAt > input.now) {
      return { channels: [], deliverAt: nextAllowedAt, reason: "COOLDOWN" };
    }
  }

  if (!isCritical && input.quietHours) {
    const { endHour, startHour } = input.quietHours;
    if (
      !Number.isInteger(startHour) ||
      !Number.isInteger(endHour) ||
      startHour < 0 ||
      startHour > 23 ||
      endHour < 0 ||
      endHour > 23
    ) {
      throw new RangeError("Quiet hours must use 0 through 23.");
    }
    const localHour = new Date(
      input.now.getTime() + input.timezoneOffsetMinutes * 60_000,
    ).getUTCHours();
    const inQuietHours =
      startHour < endHour
        ? localHour >= startHour && localHour < endHour
        : localHour >= startHour || localHour < endHour;
    if (inQuietHours) {
      return {
        channels: [],
        deliverAt: nextQuietHoursEnd(
          input.now,
          input.timezoneOffsetMinutes,
          endHour,
        ),
        reason: "QUIET_HOURS",
      };
    }
  }

  return { channels, deliverAt: input.now, reason: "DELIVER" };
}

export type NotificationFanoutMember = {
  categoryEnabled: boolean;
  dailyNonCriticalCap: number;
  deliveredToday: number;
  enabledChannels: Readonly<Record<NotificationChannel, boolean>>;
  lastNonCriticalDeliveryAt?: Date;
  userId: string;
};

export type NotificationFanoutPlan = {
  channels: readonly NotificationChannel[];
  deduplicationKey: string;
  deliverAt: Date;
  userId: string;
};

export function planPublishedNotificationFanout({
  allowedDeepLinkPrefixes,
  deepLink,
  deliveredDeduplicationKeys,
  members,
  nonCriticalCooldownMinutes,
  notificationId,
  now,
  priority,
  timezoneOffsetMinutes,
}: {
  allowedDeepLinkPrefixes: readonly string[];
  deepLink: string;
  deliveredDeduplicationKeys: ReadonlySet<string>;
  members: readonly NotificationFanoutMember[];
  nonCriticalCooldownMinutes: number;
  notificationId: string;
  now: Date;
  priority: NotificationPriority;
  timezoneOffsetMinutes: number;
}): readonly NotificationFanoutPlan[] {
  if (!notificationId.trim()) {
    throw new Error("Published notifications require an identifier.");
  }

  const plans: NotificationFanoutPlan[] = [];
  for (const member of members) {
    const deduplicationKey = `notification:${notificationId}:${member.userId}`;
    if (
      !member.categoryEnabled ||
      deliveredDeduplicationKeys.has(deduplicationKey)
    ) {
      continue;
    }

    const optionalLastDelivery = member.lastNonCriticalDeliveryAt
      ? { lastNonCriticalDeliveryAt: member.lastNonCriticalDeliveryAt }
      : {};
    const decision = decideNotificationDelivery({
      allowedDeepLinkPrefixes,
      dailyNonCriticalCap: member.dailyNonCriticalCap,
      deepLink,
      deliveredToday: member.deliveredToday,
      enabledChannels: member.enabledChannels,
      nonCriticalCooldownMinutes,
      now,
      priority,
      timezoneOffsetMinutes,
      ...optionalLastDelivery,
    });
    if (decision.channels.length === 0) {
      continue;
    }
    plans.push({
      channels: decision.channels,
      deduplicationKey,
      deliverAt: decision.deliverAt,
      userId: member.userId,
    });
  }

  return plans;
}
