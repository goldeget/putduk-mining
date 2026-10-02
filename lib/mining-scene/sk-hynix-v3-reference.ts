/**
 * SK하이닉스 V3 정밀 원본의 해시 계약.
 * REFERENCE_APPROVED 이며 PRODUCTION_ASSET_APPROVED 가 아니다.
 * 바이트와 해시를 바꾸지 않고, 프로덕션 장면으로 켜지 않는다.
 * 이미지 Base64 는 이 파일에 두지 않는다.
 */

export const SK_HYNIX_V3_REFERENCE = {
  referenceApproval: "REFERENCE_APPROVED",
  productionAssetApproval: "NOT_APPROVED",
  activatesProductionScene: false,
  htmlByteLength: 493313,
  htmlSha256:
    "2f33d6b021f642e043e9068f353c3d279540d9c370b2478ef3173f2d9535ecd7",
  embeddedJpegCount: 1,
  embeddedJpegByteLength: 355879,
  embeddedJpegWidth: 1024,
  embeddedJpegHeight: 680,
  backgroundSha256:
    "9c0ae9234b747d71e7ea81bfb43190cad7fd4ac1358c1b673bdc4ed13c3a881c",
} as const;
