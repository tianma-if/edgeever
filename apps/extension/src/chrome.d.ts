declare const chrome: any;

declare module "@mixmark-io/domino" {
  export function createDocument(html?: string, force?: boolean): Document;
}
