export type DemoAttachmentSeed = {
  id: string;
  memoId: string;
  filename: string;
  mimeType: string;
  content: string;
  encoding: "utf8" | "base64";
};

export const DEMO_ATTACHMENT_RESOURCES: DemoAttachmentSeed[] = [
  {
    id: "res_demo_product_brief_pdf",
    memoId: "memo_demo_overview",
    filename: "edgeever-product-brief.pdf",
    mimeType: "application/pdf",
    encoding: "base64",
    content:
      "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCA+PiA+PgplbmRvYmoKNCAwIG9iago8PCAvTGVuZ3RoIDQ0ID4+CnN0cmVhbQpCVCAvRjEgMTggVGYgNzIgNzIwIFRkIChFZGdlRXZlciBkZW1vIFBERikgVGogRVQKZW5kc3RyZWFtCmVuZG9iagp0cmFpbGVyCjw8IC9Sb290IDEgMCBSID4+CiUlRU9GCg==",
  },
  {
    id: "res_demo_feature_matrix_csv",
    memoId: "memo_demo_overview",
    filename: "feature-matrix.csv",
    mimeType: "text/csv",
    encoding: "utf8",
    content: "Feature,Web,Mobile,Demo\nImage upload,Yes,Yes,Yes\nFile attachments,Yes,Yes,Yes\nDownload,Yes,Yes,Yes\n",
  },
  {
    id: "res_demo_attachment_bundle_zip",
    memoId: "memo_demo_overview",
    filename: "edgeever-attachment-demo.zip",
    mimeType: "application/zip",
    encoding: "base64",
    content:
      "UEsDBBQAAAAIADRz91yTz0LqIwAAACEAAAAKAAAAUkVBRE1FLnR4dHNNSU91LUstUkgsKUlMzshNzStRSEnNzVdILErOyCxL5QIAUEsBAhQDFAAAAAgANHP3XJPPQuojAAAAIQAAAAoAAAAAAAAAAAAAAIABAAAAAFJFQURNRS50eHRQSwUGAAAAAAEAAQA4AAAASwAAAAAA",
  },
];

export const decodeDemoAttachment = (resource: DemoAttachmentSeed): Uint8Array => {
  if (resource.encoding === "utf8") {
    return new TextEncoder().encode(resource.content);
  }

  const binary = atob(resource.content);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export const DEMO_ATTACHMENT_MARKDOWN_ZH = "";

export const DEMO_ATTACHMENT_MARKDOWN_EN = "";

