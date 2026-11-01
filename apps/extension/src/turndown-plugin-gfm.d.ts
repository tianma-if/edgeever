declare module "@joplin/turndown-plugin-gfm" {
  import type TurndownService from "turndown";
  export const tables: TurndownService.Plugin;
  export const taskListItems: TurndownService.Plugin;
}
