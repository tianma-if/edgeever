export type InstanceAuthMode = "required" | "disabled" | "unconfigured";

export const isUnauthenticatedAccessEnabled = (value: string | undefined) =>
  value?.trim().toLowerCase() === "true";

export const resolveInstanceAuthMode = ({
  allowUnauthenticated,
  hasBootstrapCredential,
  hasEnabledUser,
}: {
  allowUnauthenticated: boolean;
  hasBootstrapCredential: boolean;
  hasEnabledUser: boolean;
}): InstanceAuthMode => {
  if (allowUnauthenticated) {
    return "disabled";
  }

  if (hasBootstrapCredential || hasEnabledUser) {
    return "required";
  }

  return "unconfigured";
};

export const isDatabaseNotReadyError = (error: unknown) => {
  const messages: string[] = [];
  const visited = new Set<unknown>();
  let current: unknown = error;

  while (current !== undefined && current !== null && !visited.has(current)) {
    visited.add(current);
    if (current instanceof Error) {
      messages.push(current.message);
      current = current.cause;
      continue;
    }
    messages.push(String(current));
    break;
  }

  return messages.some((message) =>
    /\b(?:no such table|no such column|D1_COLUMN_NOTFOUND)\b/i.test(message)
  );
};
