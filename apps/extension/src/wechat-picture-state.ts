/** Read the declared gallery, not the partially rendered carousel or its cover. */
export function readWechatPictureStateInPage() {
  // Closure-free: scripting.executeScript serializes this function into MAIN.
  if (new URL(location.href).origin !== "https://mp.weixin.qq.com"
    || !document.querySelector("#js_content #js_image_content")) return null;
  const data = (window as unknown as { cgiDataNew?: unknown }).cgiDataNew;
  if (!data || typeof data !== "object") return null;
  const post = data as Record<string, unknown>;
  if (typeof post.link !== "string" || !Array.isArray(post.picture_page_info_list)) return null;
  const pictures: string[] = [];
  for (const value of post.picture_page_info_list) {
    if (!value || typeof value !== "object" || typeof value.cdn_url !== "string") return null;
    pictures.push(value.cdn_url);
  }
  return { pageUrl: location.href, url: post.link, pictures };
}
