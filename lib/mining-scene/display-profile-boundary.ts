/**
 * mining_products.display_profile JSON 은 장면 소스가 아니다.
 * 좌표, 스크립트, URL 이 들어 있어도 읽지 않고 실행하지 않는다.
 */
export const DISPLAY_PROFILE_SCENE_REJECTION =
  "DISPLAY_PROFILE_NOT_A_SCENE_SOURCE" as const;

export function readSceneFromDisplayProfile(profile: unknown): null {
  void profile;
  return null;
}
