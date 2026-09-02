import {
  PluginEmbed as BasePluginEmbed,
  normalizePluginEmbedAttributes,
  type PluginEmbedAttributes,
} from "@edgeever/shared";
import type { PluginEmbedInstance } from "@edgeever/plugin-api";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { EdgeEverPluginHost } from "@/lib/plugins/plugin-host";

const toPluginEmbedInstance = (attributes: PluginEmbedAttributes): PluginEmbedInstance => ({
  id: attributes.id,
  pluginId: attributes.pluginId,
  type: attributes.type,
  resourceId: attributes.resourceId,
  previewResourceId: attributes.previewResourceId,
  title: attributes.title,
  data: JSON.parse(attributes.dataJson) as PluginEmbedInstance["data"],
});

const PluginEmbedNodeView = ({ node, host }: NodeViewProps & { host: EdgeEverPluginHost }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mountError, setMountError] = useState<string | null>(null);
  const snapshot = useSyncExternalStore(host.subscribe, host.getSnapshot, host.getSnapshot);
  const attributes = normalizePluginEmbedAttributes(node.attrs);
  const registered = attributes
    ? snapshot.embeds.some((embed) => embed.pluginId === attributes.pluginId && embed.type === attributes.type)
    : false;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !attributes || !registered) return;
    let disposed = false;
    let disposeEmbed: (() => void) | null = null;
    setMountError(null);
    container.replaceChildren();
    void host.mountEmbed(
      attributes.pluginId,
      attributes.type,
      container,
      toPluginEmbedInstance(attributes),
    ).then((dispose) => {
      if (disposed) dispose();
      else disposeEmbed = dispose;
    }).catch((error: unknown) => {
      if (!disposed) setMountError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      disposed = true;
      disposeEmbed?.();
      container.replaceChildren();
    };
  }, [attributes?.dataJson, attributes?.id, attributes?.pluginId, attributes?.previewResourceId, attributes?.resourceId, attributes?.title, attributes?.type, host, registered]);

  const fallbackTitle = attributes?.title || attributes?.type || "Plugin embed";
  return (
    <NodeViewWrapper className="edgeever-plugin-embed-node" contentEditable={false}>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {registered ? <div ref={containerRef} className="min-h-32" /> : (
          <div className="flex min-h-24 items-center justify-center bg-slate-50 px-4 text-sm font-medium text-slate-500">
            {fallbackTitle}
          </div>
        )}
        {mountError ? <div role="alert" className="border-t border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">{mountError}</div> : null}
      </div>
    </NodeViewWrapper>
  );
};

export const createPluginEmbedExtension = (host: EdgeEverPluginHost) => BasePluginEmbed.extend({
  addNodeView() {
    return ReactNodeViewRenderer((props) => <PluginEmbedNodeView {...props} host={host} />);
  },
});
