export function resolveAppUrl(rawAppUrl: string): {
  appUrl: string;
  returnOrigin: string;
  returnUrl: string;
} {
  let appUrl: URL;
  try {
    appUrl = new URL(rawAppUrl);
  } catch {
    throw new Error("APP_URL must be a valid HTTP or HTTPS URL.");
  }
  if (appUrl.protocol !== "http:" && appUrl.protocol !== "https:") {
    throw new Error("APP_URL must be a valid HTTP or HTTPS URL.");
  }

  return {
    appUrl: appUrl.toString(),
    returnOrigin: appUrl.origin,
    returnUrl: new URL("/connect/return", appUrl.origin).toString(),
  };
}
