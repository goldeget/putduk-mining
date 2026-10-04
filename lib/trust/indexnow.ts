import {
  PUBLIC_DISCOVERY_PATHS,
  PUBLIC_SITE_ORIGIN,
  toPublicUrl,
} from "@/lib/trust/public-discovery";

/** 공개 검증 키. 비밀값이 아니며 루트 텍스트 파일로 제공한다. */
export const INDEXNOW_KEY = "putduk-mining-indexnow-v1";

export const INDEXNOW_KEY_PATH = `/${INDEXNOW_KEY}.txt`;

export type IndexNowSubmission = {
  host: string;
  key: string;
  keyLocation: string;
  urlList: readonly string[];
};

/** 공개 페이지 주소만 IndexNow 제출 본문으로 만든다. 외부로 전송하지 않는다. */
export function buildIndexNowSubmission(): IndexNowSubmission {
  return {
    host: new URL(PUBLIC_SITE_ORIGIN).host,
    key: INDEXNOW_KEY,
    keyLocation: `${PUBLIC_SITE_ORIGIN}${INDEXNOW_KEY_PATH}`,
    urlList: PUBLIC_DISCOVERY_PATHS.map((path) => toPublicUrl(path)),
  };
}
