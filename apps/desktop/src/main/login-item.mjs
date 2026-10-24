// Windows can disable a Run value from Task Manager without deleting it.
// macOS login items cannot carry a start-hidden argument, so a tray launch is
// decided from the saved mode when this process was opened at login.

export const LOGIN_ITEM_NAME = "EdgeEver";
export const START_HIDDEN_ARG = "--start-hidden";

export const loginItemSupported = ({ platform, packaged }) =>
  packaged === true && (platform === "win32" || platform === "darwin");

export const normalizeLaunchMode = (value) => (value === "tray" ? "tray" : "window");

export const parseLoginItemPreference = (raw) => {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      value = null;
    }
  }
  if (!value || typeof value !== "object") return { openAtLogin: false, launchMode: "window" };
  return {
    openAtLogin: value.openAtLogin === true,
    launchMode: normalizeLaunchMode(value.launchMode),
  };
};

export const loginItemArgs = (launchMode) => (
  normalizeLaunchMode(launchMode) === "tray" ? [START_HIDDEN_ARG] : []
);

export const normalizeLoginItemArgs = (args, executablePath) => {
  if (!Array.isArray(args)) return [];
  const cleaned = [];
  for (const arg of args) {
    if (typeof arg !== "string") continue;
    const stripped = arg.trim().replace(/^"(.*)"$/, "$1");
    if (!stripped || stripped === "--" || stripped === executablePath) continue;
    cleaned.push(stripped);
  }
  return cleaned;
};

const sameArgs = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);

export const findWindowsLoginItem = (settings, { name, executablePath }) => {
  const items = Array.isArray(settings?.launchItems) ? settings.launchItems : [];
  return items.find((item) => item?.name === name)
    ?? items.find((item) => item?.path === executablePath)
    ?? null;
};

export const commandLineOpensContent = (argv, { isAssociatedFile } = {}) => {
  if (!Array.isArray(argv)) return false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (typeof value !== "string") continue;
    if (value.startsWith("edgeever://")) return true;
    if (value === "--share-file") {
      const filePath = argv[index + 1];
      if (typeof filePath === "string" && filePath.length > 0 && !filePath.startsWith("-")) return true;
    }
    if (!value.startsWith("-") && isAssociatedFile?.(value)) return true;
  }
  return false;
};

export const shouldStartHidden = ({
  argv,
  wasOpenedAtLogin = false,
  launchMode = "window",
  opensContent = false,
} = {}) => {
  if (opensContent) return false;
  if (Array.isArray(argv) && argv.includes(START_HIDDEN_ARG)) return true;
  return wasOpenedAtLogin === true && normalizeLaunchMode(launchMode) === "tray";
};

const unavailablePlan = () => ({
  supported: false,
  openAtLogin: false,
  launchMode: "window",
  action: "none",
  status: "unavailable",
});

export const startupLoginItemPlan = ({
  platform,
  packaged,
  saved,
  os,
  osReadable = true,
  executablePath,
}) => {
  if (!loginItemSupported({ platform, packaged })) return unavailablePlan();
  const launchMode = normalizeLaunchMode(saved?.launchMode);
  const wanted = saved?.openAtLogin === true;
  if (!osReadable) {
    return {
      supported: true,
      openAtLogin: wanted,
      launchMode,
      action: "none",
      status: wanted ? "enabled" : "disabled",
    };
  }

  if (platform === "win32") {
    const item = findWindowsLoginItem(os, { name: LOGIN_ITEM_NAME, executablePath });
    if (!wanted) {
      return {
        supported: true,
        openAtLogin: false,
        launchMode,
        action: item ? "remove" : "none",
        status: "disabled",
      };
    }
    if (item && item.enabled === false) {
      return {
        supported: true,
        openAtLogin: false,
        launchMode,
        action: "persist-off",
        status: "disabled-by-system",
      };
    }
    const desiredArgs = loginItemArgs(launchMode);
    const actualArgs = normalizeLoginItemArgs(item?.args, executablePath);
    const current = Boolean(item)
      && item.enabled === true
      && item.path === executablePath
      && sameArgs(actualArgs, desiredArgs);
    return {
      supported: true,
      openAtLogin: true,
      launchMode,
      action: current ? "none" : "apply",
      status: "enabled",
    };
  }

  const status = os?.status;
  const registered = os?.openAtLogin === true || status === "enabled" || status === "requires-approval";
  if (!wanted) {
    return {
      supported: true,
      openAtLogin: false,
      launchMode,
      action: registered ? "remove" : "none",
      status: "disabled",
    };
  }
  if (status === "not-found") {
    return { supported: true, openAtLogin: true, launchMode, action: "apply", status: "not-found" };
  }
  if (!registered) {
    return {
      supported: true,
      openAtLogin: false,
      launchMode,
      action: "persist-off",
      status: "disabled-by-system",
    };
  }
  return {
    supported: true,
    openAtLogin: true,
    launchMode,
    action: "none",
    status: status === "requires-approval" ? "requires-approval" : "enabled",
  };
};

export const loginItemUpdatePayload = ({ openAtLogin, launchMode, executablePath, platform }) => {
  const enabled = openAtLogin === true;
  const payload = { openAtLogin: enabled };
  if (platform === "win32") {
    payload.path = executablePath;
    payload.name = LOGIN_ITEM_NAME;
    payload.args = loginItemArgs(launchMode);
    if (enabled) payload.enabled = true;
  }
  return payload;
};

export const publicLoginItemState = (plan) => ({
  supported: plan.supported === true,
  openAtLogin: plan.openAtLogin === true,
  launchMode: normalizeLaunchMode(plan.launchMode),
  status: plan.status || (plan.openAtLogin ? "enabled" : "disabled"),
});

export const normalizeLoginItemPatch = (current, patch) => {
  if (!patch || typeof patch !== "object") return null;
  const hasOpen = Object.hasOwn(patch, "openAtLogin");
  const hasMode = Object.hasOwn(patch, "launchMode");
  if (!hasOpen && !hasMode) return null;
  if (hasOpen && typeof patch.openAtLogin !== "boolean") return null;
  if (hasMode && patch.launchMode !== "window" && patch.launchMode !== "tray") return null;
  return {
    openAtLogin: hasOpen ? patch.openAtLogin : current.openAtLogin === true,
    launchMode: hasMode ? patch.launchMode : normalizeLaunchMode(current.launchMode),
  };
};

export const createLoginItemController = ({
  platform,
  packaged,
  executablePath,
  preferencePath,
  readFile,
  writeFile,
  rename,
  unlink,
  getLoginItemSettings,
  setLoginItemSettings,
}) => {
  let saved = { openAtLogin: false, launchMode: "window" };
  let state = publicLoginItemState(unavailablePlan());
  let openedAtLogin = false;
  let chain = Promise.resolve();

  const enqueue = (task) => {
    const run = chain.then(task, task);
    chain = run.then(() => {}, () => {});
    return run;
  };

  const readOs = () => {
    try {
      const settings = platform === "win32"
        ? getLoginItemSettings({ path: executablePath, args: loginItemArgs(saved.launchMode) })
        : getLoginItemSettings();
      return { ok: true, settings };
    } catch {
      return { ok: false, settings: null };
    }
  };

  const persist = async (preference) => {
    const temporaryPath = `${preferencePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(preference), { mode: 0o600 });
    try {
      await rename(temporaryPath, preferencePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      throw error;
    }
    saved = preference;
  };

  const apply = (preference) => {
    setLoginItemSettings(loginItemUpdatePayload({ ...preference, executablePath, platform }));
  };

  return {
    reconcileAtStartup() {
      return enqueue(async () => {
        try {
          saved = parseLoginItemPreference(await readFile(preferencePath, "utf8"));
        } catch {
          saved = { openAtLogin: false, launchMode: "window" };
        }
        if (platform === "darwin") {
          try {
            openedAtLogin = getLoginItemSettings().wasOpenedAtLogin === true;
          } catch {
            openedAtLogin = false;
          }
        }
        const os = loginItemSupported({ platform, packaged }) ? readOs() : { ok: true, settings: null };
        let plan = startupLoginItemPlan({
          platform,
          packaged,
          saved,
          os: os.settings,
          osReadable: os.ok,
          executablePath,
        });
        if (plan.action === "apply") apply({ openAtLogin: true, launchMode: plan.launchMode });
        else if (plan.action === "remove") apply({ openAtLogin: false, launchMode: plan.launchMode });
        else if (plan.action === "persist-off") plan = { ...plan, openAtLogin: false };
        state = publicLoginItemState(plan);
        if (plan.action === "persist-off") {
          await persist({ openAtLogin: false, launchMode: plan.launchMode });
        }
        return state;
      });
    },
    current() {
      return state;
    },
    wasOpenedAtLogin() {
      return openedAtLogin;
    },
    update(patch) {
      return enqueue(async () => {
        if (!state.supported) return state;
        const next = normalizeLoginItemPatch(saved, patch);
        if (!next) return { ...state, error: "invalid" };
        try {
          apply(next);
          await persist(next);
        } catch {
          return { ...state, error: "saveFailed" };
        }
        const os = readOs();
        let status = next.openAtLogin ? "enabled" : "disabled";
        if (next.openAtLogin && platform === "darwin" && os.settings?.status === "requires-approval") {
          status = "requires-approval";
        }
        if (next.openAtLogin && platform === "win32" && os.ok) {
          const item = findWindowsLoginItem(os.settings, { name: LOGIN_ITEM_NAME, executablePath });
          if (item && item.enabled === false) {
            try {
              apply({ openAtLogin: false, launchMode: next.launchMode });
              await persist({ openAtLogin: false, launchMode: next.launchMode });
            } catch {
              saved = { openAtLogin: false, launchMode: next.launchMode };
            }
            state = {
              supported: true,
              openAtLogin: false,
              launchMode: next.launchMode,
              status: "disabled-by-system",
              error: "saveFailed",
            };
            return state;
          }
        }
        state = {
          supported: true,
          openAtLogin: next.openAtLogin,
          launchMode: next.launchMode,
          status,
        };
        return state;
      });
    },
  };
};
