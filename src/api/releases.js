const RELEASE_TIMEOUT_MS = 4500;

function parseVersion(value) {
  const match = typeof value === "string" && /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

export function requiredAndroidUpdate(release, installedVersion, repository) {
  if (!release || release.draft !== false || release.prerelease !== false) return null;
  const installed = parseVersion(installedVersion);
  const offered = parseVersion(release.tag_name);
  if (!installed || !offered) return null;
  const firstDifference = offered.findIndex((part, index) => part !== installed[index]);
  if (firstDifference === -1 || offered[firstDifference] < installed[firstDifference]) return null;

  const version = offered.join(".");
  const preferredName = `CCASSO-Scanner-${version}.apk`;
  const base = `https://github.com/${repository}/releases/download/${release.tag_name}/`;
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const downloads = assets.filter((asset) => typeof asset?.name === "string" &&
    /^[a-z0-9_.-]+\.apk$/i.test(asset.name) &&
    !/(?:^|[_.-])(?:debug|dev|development|local|test)(?:[_.-]|$)/i.test(asset.name) &&
    asset.state === "uploaded" && asset.size > 0 && asset.browser_download_url === base + asset.name);
  const apk = downloads.find((asset) => asset.name === preferredName) ||
    (downloads.length === 1 ? downloads[0] : null);
  return apk ? { version, url: apk.browser_download_url } : null;
}

export async function fetchLatestRelease(repository) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RELEASE_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
      signal: controller.signal,
      headers: { Accept: "application/vnd.github+json", "Cache-Control": "no-cache" },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("GitHub release check failed");
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}
