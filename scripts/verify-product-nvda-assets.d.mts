export function productNvdaMetadataFailures(
  asset: Record<string, unknown>,
): string[];
export function productNvdaEncodedDimensions(
  contents: Buffer,
  mimeType: string,
): { width: number; height: number } | null;
export function verifyProductNvdaAssets(root: string): Promise<string[]>;
