import { useCallback, useMemo } from "react";
import { useLocation, useNavigate, type NavigateOptions } from "react-router";
import { MOBILE_EDITOR_RETURN_PARAM } from "@/lib/mobile-editor";

export const WORKSPACE_SETTINGS_PATH = "/settings";
export const WORKSPACE_PLUGINS_PATH = "/plugins";
export const WORKSPACE_TEMPLATES_PATH = "/templates";
export const WORKSPACE_AI_PROMPTS_PATH = "/ai-prompts";
export const WORKSPACE_COMPANION_PATH = "/companion";
export const WORKSPACE_EXECUTION_CENTER_PATH = "/execution-center";
export const WORKSPACE_TRASH_SEARCH = "?view=trash";

export type WorkspaceRouteState = {
  pathname: string;
  search: string;
  isSettings: boolean;
  isPlugins: boolean;
  isTemplates: boolean;
  isAiPrompts: boolean;
  isCompanion: boolean;
  isExecutionCenter: boolean;
  isTrash: boolean;
  mobileEditorReturnMemoId: string | null;
};

export const resolveWorkspaceRoute = (pathname: string, search: string): WorkspaceRouteState => ({
  pathname,
  search,
  isSettings: pathname === WORKSPACE_SETTINGS_PATH,
  isPlugins: pathname === WORKSPACE_PLUGINS_PATH || pathname.startsWith(`${WORKSPACE_PLUGINS_PATH}/`),
  isTemplates: pathname === WORKSPACE_TEMPLATES_PATH,
  isAiPrompts: pathname === WORKSPACE_AI_PROMPTS_PATH,
  isCompanion: pathname === WORKSPACE_COMPANION_PATH,
  isExecutionCenter: pathname === WORKSPACE_EXECUTION_CENTER_PATH,
  isTrash: pathname === "/" && search === WORKSPACE_TRASH_SEARCH,
  mobileEditorReturnMemoId: new URLSearchParams(search).get(MOBILE_EDITOR_RETURN_PARAM),
});

export const useWorkspaceRoute = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const route = useMemo(
    () => resolveWorkspaceRoute(location.pathname, location.search),
    [location.pathname, location.search],
  );

  const navigateHome = useCallback((options?: NavigateOptions) => {
    if (route.pathname !== "/" || route.search) navigate("/", options);
  }, [navigate, route.pathname, route.search]);

  const navigateTrash = useCallback(() => {
    if (!route.isTrash) navigate(`/${WORKSPACE_TRASH_SEARCH}`);
  }, [navigate, route.isTrash]);

  const navigateSettings = useCallback(() => {
    if (!route.isSettings) navigate(WORKSPACE_SETTINGS_PATH);
  }, [navigate, route.isSettings]);

  const navigatePlugins = useCallback(() => {
    if (!route.isPlugins) navigate(WORKSPACE_PLUGINS_PATH);
  }, [navigate, route.isPlugins]);

  const navigateTemplates = useCallback(() => {
    if (!route.isTemplates) navigate(WORKSPACE_TEMPLATES_PATH);
  }, [navigate, route.isTemplates]);

  const navigateAiPrompts = useCallback(() => {
    if (!route.isAiPrompts) navigate(WORKSPACE_AI_PROMPTS_PATH);
  }, [navigate, route.isAiPrompts]);

  const navigateExecutionCenter = useCallback(() => {
    if (!route.isExecutionCenter) navigate(WORKSPACE_EXECUTION_CENTER_PATH);
  }, [navigate, route.isExecutionCenter]);

  const navigateCompanion = useCallback(() => {
    if (!route.isCompanion) navigate(WORKSPACE_COMPANION_PATH);
  }, [navigate, route.isCompanion]);

  return {
    route,
    navigateHome,
    navigateSettings,
    navigatePlugins,
    navigateTemplates,
    navigateAiPrompts,
    navigateCompanion,
    navigateExecutionCenter,
    navigateTrash,
  };
};
