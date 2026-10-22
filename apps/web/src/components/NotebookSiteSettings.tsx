import { useMutation, useQuery } from "@tanstack/react-query";
import { getMemoDisplayTitle, readNotebookSiteSettings, type NotebookShare } from "@edgeever/shared";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiRequestError, getConfiguredDesktopApiBaseUrl } from "@/lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { NotebookSiteMemoBrowser } from "./NotebookSiteMemoBrowser";
import { memoNotebookSitesQueryKey } from "./MemoNotebookSites";

export const NotebookSiteSettings = ({ notebookId, share, onSaved }: {
  notebookId: string; share: NotebookShare; onSaved: (data: { share: NotebookShare }) => void;
}) => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(() => share.siteSettings ?? readNotebookSiteSettings());
  const [slug, setSlug] = useState(share.siteSlug ?? "");
  const [choosingHome, setChoosingHome] = useState(false);
  const selectedHome = useQuery({
    queryKey: ["notebook-site-home-title", getConfiguredDesktopApiBaseUrl(), notebookId, settings.homeMemoId],
    queryFn: () => api.getMemo(settings.homeMemoId!),
    enabled: Boolean(settings.homeMemoId),
    retry: false,
  });
  const homeSites = useQuery({
    queryKey: memoNotebookSitesQueryKey(settings.homeMemoId ?? ""),
    queryFn: () => api.getMemoNotebookSites(settings.homeMemoId!),
    enabled: Boolean(settings.homeMemoId),
    retry: false,
    staleTime: 0,
  });
  const homeUnavailable = Boolean(settings.homeMemoId) && (
    [selectedHome.error, homeSites.error].some((error) => error instanceof ApiRequestError && error.status === 404)
    || (homeSites.isSuccess && !homeSites.data.sites.some((site) => site.notebookId === notebookId && !site.excluded))
  );
  const homeError = Boolean(settings.homeMemoId) && !homeUnavailable && (selectedHome.isError || homeSites.isError);
  const save = useMutation({
    mutationFn: () => {
      const { homeMemoId, ...otherSettings } = settings;
      return api.updateNotebookSite(notebookId, { siteSlug: slug || null, settings: {
        ...otherSettings,
        ...(homeMemoId !== share.siteSettings?.homeMemoId ? { homeMemoId } : {}),
      } });
    },
    onSuccess: onSaved,
  });
  const label = (key: string) => t(`notebookSite.${key}`);
  const submit = (event: FormEvent) => { event.preventDefault(); save.mutate(); };
  const edit = (patch: Partial<typeof settings>) => { setSettings((previous) => ({ ...previous, ...patch })); save.reset(); };
  return <Dialog open={choosingHome} onOpenChange={setChoosingHome}>
      <form onSubmit={submit} className="space-y-6">
        <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
          <h2 className="font-semibold">{label("homepage")}</h2>
          <p className="break-words text-sm text-muted-foreground">{settings.homeMemoId && !homeUnavailable ? (selectedHome.data?.memo ? getMemoDisplayTitle(selectedHome.data.memo.title, t("common.untitledMemo")) : label("homepageSelected")) : label("directory")}</p>
          {homeUnavailable && <p role="status" className="text-xs text-muted-foreground">{label("homepageFallback")}</p>}
          {homeError && <div className="space-y-2"><p role="alert" className="text-xs text-destructive">{t("sharing.error")}</p><Button type="button" size="sm" variant="outline" onClick={() => { void selectedHome.refetch(); void homeSites.refetch(); }}>{t("sharing.retry")}</Button></div>}
          <div className="flex flex-wrap gap-2">
            <DialogTrigger asChild><Button type="button" variant="outline">{label("chooseHomepage")}</Button></DialogTrigger>
            <Button type="button" variant="ghost" disabled={!settings.homeMemoId} onClick={() => edit({ homeMemoId: null })}>{label("useDirectory")}</Button>
          </div>
        </section>
        <section className="grid gap-5 rounded-xl border bg-card p-4 sm:grid-cols-2 sm:p-6">
          <label className="space-y-2 text-sm">{label("slug")}<Input value={slug} onChange={(event) => { setSlug(event.target.value); save.reset(); }} autoCapitalize="none" /></label>
          <label className="space-y-2 text-sm">{label("logo")}<Input type="url" value={settings.logoUrl ?? ""} onChange={(event) => edit({ logoUrl: event.target.value || null })} /></label>
          <div className="space-y-2 text-sm"><label htmlFor="notebook-site-order">{label("sort")}</label><Select value={settings.sortMode} onValueChange={(value) => edit({ sortMode: value as "existing" | "title" })}><SelectTrigger id="notebook-site-order"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="existing">{label("existingOrder")}</SelectItem><SelectItem value="title">{label("titleOrder")}</SelectItem></SelectContent></Select></div>
          <div className="space-y-2 text-sm"><label className="flex items-center gap-2"><input type="checkbox" disabled={share.passwordProtected} checked={!share.passwordProtected && settings.allowIndexing} onChange={(event) => edit({ allowIndexing: event.target.checked })} />{label("indexing")}</label><p className="text-xs text-muted-foreground">{label("indexingHint")}</p></div>
          <label className="space-y-2 text-sm sm:col-span-2">{label("footer")}<Textarea value={settings.footerText} onChange={(event) => edit({ footerText: event.target.value })} /></label>
          <fieldset className="space-y-3 sm:col-span-2"><legend className="mb-2 text-sm">{label("headerLinks")}</legend>
            {settings.headerLinks.map((link, index) => <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]" key={index}>
              <Input aria-label={label("label")} placeholder={label("label")} value={link.label} required onChange={(event) => edit({ headerLinks: settings.headerLinks.map((item, i) => i === index ? { ...item, label: event.target.value } : item) })} />
              <Input aria-label={label("url")} placeholder={label("url")} type="url" required value={link.url} onChange={(event) => edit({ headerLinks: settings.headerLinks.map((item, i) => i === index ? { ...item, url: event.target.value } : item) })} />
              <Button type="button" variant="outline" onClick={() => edit({ headerLinks: settings.headerLinks.filter((_, i) => i !== index) })}>{label("remove")}</Button>
            </div>)}
            <Button type="button" variant="outline" onClick={() => edit({ headerLinks: [...settings.headerLinks, { label: "", url: "" }] })}>{label("addLink")}</Button>
          </fieldset>
        </section>
        <div className="flex flex-wrap items-center gap-4 pb-2">
          <Button type="submit" variant="solid" disabled={save.isPending}>{label("save")}</Button><span className="text-xs text-muted-foreground">{label("saveHint")}</span>
          {save.isSuccess && <p role="status" className="text-sm">{label("saved")}</p>}
          {save.isError && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
        </div>
      </form>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-2xl">
        <DialogHeader><DialogTitle>{label("chooseHomepage")}</DialogTitle><DialogDescription>{label("homepageHint")}</DialogDescription></DialogHeader>
        <div className="min-h-0 overflow-y-auto"><NotebookSiteMemoBrowser notebookId={notebookId} token={share.token} selectedId={settings.homeMemoId} onSelect={(memo) => { edit({ homeMemoId: memo.id }); setChoosingHome(false); }} /></div>
      </DialogContent>
  </Dialog>;
};
