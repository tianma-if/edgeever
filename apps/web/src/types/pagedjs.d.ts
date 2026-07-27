declare module "pagedjs" {
  export type PagedFlow = {
    total: number;
    performance: number;
    pages: unknown[];
  };

  export class Previewer {
    preview(
      content?: DocumentFragment | Element | string,
      stylesheets?: Array<string | Record<string, string>>,
      renderTo?: Element
    ): Promise<PagedFlow>;
  }
}
