import { recordMockCall } from "../safety";

const router = {
  refresh: () => recordMockCall("router:refresh"),
  replace: (path) => recordMockCall(`router:replace:${path}`),
  push: (path) => recordMockCall(`router:push:${path}`),
};
export function useRouter() {
  return router;
}
export function usePathname() {
  return "/local-component-fixture";
}
