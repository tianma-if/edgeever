/** Public App Review / marketing demo. Never use a fake example host as the login placeholder. */
export const PUBLIC_DEMO_INSTANCE_URL = "https://demo.edgeever.org";

const publicDemoAliasHost = (value: string) =>
  value
    .trim()
    .replace(/\/+$/, "")
    .replace(/^https?:\/\//i, "")
    .toLowerCase();

/** Map the App Review typo "demo" (and https://demo) to the real public instance. */
export const resolveInstanceUrlInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  return publicDemoAliasHost(trimmed) === "demo" ? PUBLIC_DEMO_INSTANCE_URL : trimmed;
};
