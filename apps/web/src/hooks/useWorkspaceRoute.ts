import { useCallback, useMemo } from "react";
import { useLocation, useNavigate, type NavigateOptions } from "react-router";
import { MOBILE_EDITOR_RETURN_PARAM } from "@/lib/mobile-editor";

export const WORKSPACE_SETTINGS_PATH = "/settings";
export const WORKSPACE_TEMPLATES_PATH = "/templates";
export const WORKSPACE_TRASH_SEARCH = "?view=trash";

export type WorkspaceRouteState = {
  pathname: string;
  search: string;
  isSettings: boolean;
  isTemplates: boolean;
  isTrash: boolean;
  mobileEditorReturnMemoId: string | null;
};

export const resolveWorkspaceRoute = (pathname: string, search: string): WorkspaceRouteState => ({
  pathname,
  search,
  isSettings: pathname === WORKSPACE_SETTINGS_PATH,
  isTemplates: pathname === WORKSPACE_TEMPLATES_PATH,
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

  const navigateTemplates = useCallback(() => {
    if (!route.isTemplates) navigate(WORKSPACE_TEMPLATES_PATH);
  }, [navigate, route.isTemplates]);

  return {
    route,
    navigateHome,
    navigateSettings,
    navigateTemplates,
    navigateTrash,
  };
};
