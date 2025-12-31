import path from "path";

export function resolveMediaAssetPath(mediaRoot: string, assetId: string): string | null {
  const root = path.resolve(mediaRoot);
  const filePath = path.resolve(root, assetId);
  if (!filePath.startsWith(root + path.sep) && filePath !== root) {
    return null;
  }
  return filePath;
}
