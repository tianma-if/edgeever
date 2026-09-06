type DevelopmentProfile = "" | "local" | "demo";

const existingEnvironmentPrefix = /^\[(?:DEV|DEMO|LOCAL|LOCAL DEMO)\]\s*/;

export const withEnvironmentTitlePrefix = (
  title: string,
  options: { development: boolean; profile: DevelopmentProfile },
) => {
  if (!options.development) return title;
  const label = options.profile === "demo" ? "DEMO" : "DEV";
  return `[${label}] ${title.replace(existingEnvironmentPrefix, "")}`;
};
