import { recordMockCall } from "../safety";
export async function trackAnalyticsEvent() {
  recordMockCall("analytics:blocked");
}
