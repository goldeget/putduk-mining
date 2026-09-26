import http from "k6/http";
import { check, sleep } from "k6";

const baseUrl = __ENV.BASE_URL || "http://127.0.0.1:3000";

export const options = {
  scenarios: {
    steady_public_reads: {
      executor: "constant-arrival-rate",
      duration: "2m",
      preAllocatedVUs: 20,
      rate: 25,
      timeUnit: "1s",
    },
    readiness_spike: {
      executor: "ramping-arrival-rate",
      preAllocatedVUs: 25,
      stages: [
        { duration: "20s", target: 10 },
        { duration: "20s", target: 100 },
        { duration: "20s", target: 10 },
      ],
      startRate: 1,
      startTime: "2m",
      timeUnit: "1s",
    },
  },
  thresholds: {
    checks: ["rate>0.99"],
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    http_req_failed: ["rate<0.01"],
  },
};

export default function coreApiScenario() {
  const health = http.get(`${baseUrl}/api/v1/health`, {
    tags: { endpoint: "health" },
  });
  check(health, { "health is 200": (response) => response.status === 200 });

  const facts = http.get(`${baseUrl}/api/v1/public/facts`, {
    tags: { endpoint: "public-facts" },
  });
  check(facts, {
    "facts are cache-safe success": (response) => response.status === 200,
  });
  sleep(0.1);
}
