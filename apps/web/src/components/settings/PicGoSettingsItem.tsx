import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image } from "lucide-react";
import { ComboboxInput } from "@/components/ComboboxInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { expandImgBedFolder, imgBedAutoRetry, imgBedFolderError, imgBedSiteKey, IMGBED_FOLDER_PLACEHOLDERS, IMGBED_MAX_CHANNEL_NAME_LENGTH, IMGBED_NAME_TYPES, isImgBedChannelNameValid, IMGBED_SAMPLE_MEMO_ID, IMGBED_UPLOAD_CHANNELS, type ImgBedNameType, type ImgBedUploadChannel } from "@/lib/imgbed";
import { canUseImgBed, canListImgBedChannels, isBrowserImgBed, testImgBedConnection, listImgBedChannels, hasPicGoBridge, readPicGoPreference, takePicGoServerKey, writePicGoPreference, type ImgBedPreference, type PicGoPreference } from "@/lib/picgo";
import { SETTINGS_ITEM_DESCRIPTION_CLASSNAME, SETTINGS_ITEM_TITLE_CLASSNAME } from "./settings-ui";

const picGoTargetId = (value: PicGoPreference) => value.provider === "imgbed"
  ? ["imgbed", value.imgbed.endpoint, value.imgbed.token, value.imgbed.uploadFolder, value.imgbed.nameType,
    // Saving trims the channel name, so edge spaces do not change the target.
    value.imgbed.uploadChannel, value.imgbed.channelName.trim(), String(value.imgbed.serverCompress),
    String(imgBedAutoRetry(value.imgbed.autoRetry, value.imgbed.channelName))].join("\0")
  : `${value.endpoint}\0${value.serverKey}`;
type ImgBedChannelList = { source: string; channels: Record<ImgBedUploadChannel, string[]>; skipped: Record<ImgBedUploadChannel, number> };
const channelListSource = (imgbed: ImgBedPreference) => `${imgBedSiteKey(imgbed.endpoint)}\0${imgbed.token.trim()}`;
// Electron wraps main-process errors, so markers are matched anywhere in the text.
// Both buttons share this mapping, so the same failure reads the same way.
const imgBedFailureKey = (error: unknown, unsupportedKey: string, fallbackKey: string) => {
  const message = String(error);
  // Desktop hosts from #823 send the token rejection without a marker.
  if (message.includes("IMGBED_TOKEN_REJECTED:") || message.includes("ImgBed rejected the API token")) return "settings.picgo.imgbed.tokenRejected";
  // Desktop hosts from before IMGBED_CHANNELS_UNSUPPORTED report an old ImgBed with
  // only IMGBED_CHANNEL_NAME and this fixed text, which a newer page may receive.
  if (message.includes("IMGBED_CHANNELS_UNSUPPORTED:") || message.includes("IMGBED_CHANNEL_NAME: this ImgBed version does not support channel names")) {
    return unsupportedKey;
  }
  if (message.includes("IMGBED_CHANNEL_NAME:")) return "settings.picgo.imgbed.channelNameNotFound";
  if (isBrowserImgBed() && (message.includes("IMGBED_BROWSER_HTTPS") || message.includes("IMGBED_BROWSER_ADDRESS") || message.includes("Use a CloudFlare ImgBed address"))) return "settings.picgo.imgbed.browserAddress";
  if (message.includes("IMGBED_BROWSER_NETWORK") || message.includes("IMGBED_BROWSER_RESPONSE")) return "settings.picgo.imgbed.browserNetwork";
  return fallbackKey;
};
const sameImgBed = (left: ImgBedPreference, right: ImgBedPreference) => picGoTargetId({ provider: "imgbed", endpoint: "", serverKey: "", imgbed: left })
  === picGoTargetId({ provider: "imgbed", endpoint: "", serverKey: "", imgbed: right });

export const PicGoSettingsItem = () => {
  const { t } = useTranslation();
  const [saved, setSaved] = useState(readPicGoPreference);
  const [draft, setDraft] = useState(saved);
  const [testedTarget, setTestedTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [channelList, setChannelList] = useState<ImgBedChannelList | null>(null);
  const [channelListError, setChannelListError] = useState("");
  const [loadingChannels, setLoadingChannels] = useState(false);
  const hostAvailable = draft.provider === "imgbed" ? canUseImgBed() : hasPicGoBridge();
  const dirty = draft.provider !== saved.provider || draft.endpoint !== saved.endpoint || draft.serverKey !== saved.serverKey
    || !sameImgBed(draft.imgbed, saved.imgbed);
  const folderError = imgBedFolderError(draft.imgbed.uploadFolder);
  const channelNameValid = isImgBedChannelNameValid(draft.imgbed.channelName);
  const imgBedReady = Boolean(draft.imgbed.endpoint.trim() && draft.imgbed.token.trim()) && !folderError && channelNameValid;
  // A list loaded for another address or token no longer applies.
  const source = channelListSource(draft.imgbed);
  const loadedChannels = channelList?.source === source ? channelList.channels[draft.imgbed.uploadChannel] : null;
  const channelOptions = useMemo(() => (loadedChannels ?? []).map((name) => ({ value: name })), [loadedChannels]);
  const skippedChannels = loadedChannels ? channelList!.skipped[draft.imgbed.uploadChannel] : 0;
  // Judged only while the list is closed, so typing toward a listed name does not flash a warning.
  const [channelListOpen, setChannelListOpen] = useState(false);
  const savedNameMissing = Boolean(loadedChannels && !channelListOpen && channelNameValid && draft.imgbed.channelName.trim()
    && !loadedChannels.includes(draft.imgbed.channelName.trim()));
  const canLoadChannels = canListImgBedChannels() && Boolean(draft.imgbed.endpoint.trim() && draft.imgbed.token.trim()) && !busy && !loadingChannels;
  // While the list loads, testing, saving and every setting except the channel name are
  // locked, so the source of a pending request cannot change and needs no staleness
  // check. The channel name stays editable so a focused field keeps its focus.
  const locked = busy || loadingChannels;
  const canTest = hostAvailable && (draft.provider !== "imgbed" || imgBedReady);
  const canSave = dirty && (draft.provider === "edgeever" || (hostAvailable && testedTarget === picGoTargetId(draft)));
  const updateImgBed = (patch: Partial<ImgBedPreference>) => {
    setDraft({ ...draft, imgbed: { ...draft.imgbed, ...patch } });
    if ("endpoint" in patch || "token" in patch) setChannelListError("");
    setTestedTarget(null);
    setStatus("");
  };

  const testConnection = async () => {
    setBusy(true);
    setTestedTarget(null);
    setStatus("");
    const prefix = draft.provider === "imgbed" ? "settings.picgo.imgbed" : "settings.picgo";
    try {
      if (draft.provider === "imgbed") {
        await testImgBedConnection({
          endpoint: draft.imgbed.endpoint, token: draft.imgbed.token, nameType: draft.imgbed.nameType,
          uploadChannel: draft.imgbed.uploadChannel, channelName: draft.imgbed.channelName, serverCompress: draft.imgbed.serverCompress,
          // With a channel name the main process tests without retry regardless.
          autoRetry: imgBedAutoRetry(draft.imgbed.autoRetry, draft.imgbed.channelName),
          uploadFolder: expandImgBedFolder(draft.imgbed.uploadFolder),
        });
      } else {
        await window.edgeeverDesktop!.testPicGoConnection({ endpoint: draft.endpoint, serverKey: draft.serverKey });
      }
      setTestedTarget(picGoTargetId(draft));
      setStatus(t(`${prefix}.connected`));
    } catch (error) {
      setStatus(t(draft.provider === "imgbed"
        ? imgBedFailureKey(error, "settings.picgo.imgbed.channelNameUnsupported", `${prefix}.connectionFailed`)
        : `${prefix}.connectionFailed`));
    } finally { setBusy(false); }
  };
  const loadChannels = async () => {
    const requested = source;
    setLoadingChannels(true);
    setChannelListError("");
    try {
      const list = await listImgBedChannels({ endpoint: draft.imgbed.endpoint, token: draft.imgbed.token });
      setChannelList({ source: requested, ...list });
    } catch (error) {
      // A failed reload keeps a list that is still valid for this address and token.
      setChannelListError(imgBedFailureKey(error, "settings.picgo.imgbed.channelListUnsupported", "settings.picgo.imgbed.channelListFailed"));
    } finally { setLoadingChannels(false); }
  };
  const save = () => {
    try {
      const stored = writePicGoPreference(draft);
      setSaved(stored);
      setDraft(stored);
      setStatus(t("settings.picgo.saved"));
    } catch { setStatus(t("settings.picgo.saveFailed")); }
  };

  return (
    <div className="grid gap-3 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Image className="h-4 w-4 shrink-0 text-slate-500" />
          <div className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.picgo.title")}</div>
        </div>
        <Select value={draft.provider} disabled={locked} onValueChange={(provider) => {
          setDraft({ ...draft, provider: provider as PicGoPreference["provider"] });
          setStatus("");
        }}>
          <SelectTrigger className="h-9 w-full sm:w-80" aria-label={t("settings.picgo.title")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="edgeever">{t("settings.picgo.builtin")}</SelectItem>
            <SelectItem value="picgo">{t("settings.picgo.external")}</SelectItem>
            <SelectItem value="imgbed">{t("settings.picgo.imgbed.option")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {draft.provider === "picgo" ? (
        <div className="grid gap-2 sm:ml-7">
          {!hostAvailable ? <p className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{t("settings.picgo.webPreview")}</p> : null}
          <p className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{t("settings.picgo.description")}</p>
          <label htmlFor="picgo-endpoint" className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.picgo.endpoint")}</label>
          <Input id="picgo-endpoint" value={draft.endpoint} disabled={locked} onChange={(event) => {
            const next = takePicGoServerKey(event.target.value);
            setDraft({ ...draft, endpoint: next.endpoint, serverKey: next.serverKey ?? draft.serverKey });
            setTestedTarget(null);
            setStatus("");
          }} spellCheck={false} inputMode="url" autoComplete="off" />
          <label htmlFor="picgo-server-key" className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.picgo.serverKey")}</label>
          <Input id="picgo-server-key" name="picgo-server-key" type="password" value={draft.serverKey} disabled={locked} onChange={(event) => {
            setDraft({ ...draft, serverKey: event.target.value.trim() });
            setTestedTarget(null);
            setStatus("");
          }} spellCheck={false} autoComplete="new-password" maxLength={512} />
          <p className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{t("settings.picgo.serverKeyDescription")}</p>
          <p className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{t("settings.picgo.externalImages")}</p>
        </div>
      ) : null}
      {draft.provider === "imgbed" ? (
        <div className="grid gap-2 sm:ml-7">
          {!hostAvailable ? <p className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{t("settings.picgo.webPreview")}</p> : null}
          <p className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{t("settings.picgo.imgbed.description")}</p>
          {isBrowserImgBed() ? <p className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{t("settings.picgo.imgbed.browserDescription")}</p> : null}
          <label htmlFor="imgbed-endpoint" className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.picgo.imgbed.endpoint")}</label>
          <Input id="imgbed-endpoint" value={draft.imgbed.endpoint} disabled={locked} placeholder="https://img.example.com"
            onChange={(event) => updateImgBed({ endpoint: event.target.value.trim() })} spellCheck={false} inputMode="url" autoComplete="off" />
          <p className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{t("settings.picgo.imgbed.endpointDescription")}</p>
          <label htmlFor="imgbed-token" className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.picgo.imgbed.token")}</label>
          <Input id="imgbed-token" name="imgbed-token" type="password" value={draft.imgbed.token} disabled={locked}
            onChange={(event) => updateImgBed({ token: event.target.value.trim() })} spellCheck={false} autoComplete="new-password" maxLength={1024} />
          <p className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{t(isBrowserImgBed() ? "settings.picgo.imgbed.browserTokenDescription" : "settings.picgo.imgbed.tokenDescription")}</p>
          <label htmlFor="imgbed-folder" className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.picgo.imgbed.folder")}</label>
          <Input id="imgbed-folder" value={draft.imgbed.uploadFolder} disabled={locked} placeholder="notes/{Y}/{m}" aria-invalid={folderError ? true : undefined}
            onChange={(event) => updateImgBed({ uploadFolder: event.target.value })} spellCheck={false} autoComplete="off" maxLength={200} />
          <p className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{t("settings.picgo.imgbed.folderDescription")}</p>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs text-slate-500">
            {IMGBED_FOLDER_PLACEHOLDERS.map(({ token, key }) => (
              <div key={key} className="contents">
                <dt><code className="font-mono text-slate-700">{token}</code></dt>
                <dd>{t(`settings.picgo.imgbed.placeholders.${key}`)}</dd>
              </div>
            ))}
          </dl>
          <p className={folderError ? "text-xs text-rose-700" : SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>
            {folderError
              ? t(`settings.picgo.imgbed.folderInvalid.${folderError}`)
              : t("settings.picgo.imgbed.folderPreview", { folder: expandImgBedFolder(draft.imgbed.uploadFolder, new Date(), { memoId: IMGBED_SAMPLE_MEMO_ID }) || "/" })}
          </p>
          <label htmlFor="imgbed-name-type" className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.picgo.imgbed.nameType")}</label>
          <Select value={draft.imgbed.nameType} disabled={locked} onValueChange={(nameType) => updateImgBed({ nameType: nameType as ImgBedNameType })}>
            <SelectTrigger id="imgbed-name-type" className="h-9 w-full sm:w-80"><SelectValue /></SelectTrigger>
            <SelectContent>
              {IMGBED_NAME_TYPES.map((nameType) => (
                <SelectItem key={nameType} value={nameType}>{t(`settings.picgo.imgbed.nameTypes.${nameType}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label htmlFor="imgbed-channel" className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.picgo.imgbed.channel")}</label>
          <Select value={draft.imgbed.uploadChannel} disabled={locked} onValueChange={(uploadChannel) => updateImgBed({ uploadChannel: uploadChannel as ImgBedUploadChannel })}>
            <SelectTrigger id="imgbed-channel" className="h-9 w-full sm:w-80"><SelectValue /></SelectTrigger>
            <SelectContent>
              {IMGBED_UPLOAD_CHANNELS.map((channel) => (
                <SelectItem key={channel} value={channel}>{t(`settings.picgo.imgbed.channels.${channel}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Names the combobox through aria-labelledby; it cannot take an id for htmlFor. */}
          <span id="imgbed-channel-name-label" className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.picgo.imgbed.channelName")}</span>
          <div className="flex items-stretch gap-2">
            {/* Type any name, or pick from the list once "Load channels" has read it from ImgBed. */}
            <ComboboxInput labelledBy="imgbed-channel-name-label" className="min-w-0 flex-1" value={draft.imgbed.channelName}
              options={channelOptions} onValueChange={(channelName) => updateImgBed({ channelName })} onOpenChange={setChannelListOpen}
              placeholder={t("settings.picgo.imgbed.channelNamePlaceholder")} disabled={busy} invalid={!channelNameValid} maxLength={IMGBED_MAX_CHANNEL_NAME_LENGTH} />
            {canListImgBedChannels() ? (
              <Button variant="outline" size="sm" className="h-auto shrink-0" disabled={!canLoadChannels} onClick={() => void loadChannels()}>
                {t(loadingChannels ? "settings.picgo.imgbed.channelListLoading" : "settings.picgo.imgbed.channelListLoad")}
              </Button>
            ) : null}
          </div>
          {channelListError ? <p role="status" className="text-xs text-rose-700">{t(channelListError)}</p> : null}
          {savedNameMissing ? (
            <p role="status" className="text-xs text-rose-700">{t("settings.picgo.imgbed.channelMissingDescription")}</p>
          ) : null}
          {/* Unusable names may be why a saved name is missing, so this stays visible with it. */}
          {skippedChannels > 0 ? (
            <p role="status" className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{t("settings.picgo.imgbed.channelListSkipped", { count: skippedChannels })}</p>
          ) : loadedChannels?.length === 0 ? (
            <p role="status" className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{t("settings.picgo.imgbed.channelListEmpty")}</p>
          ) : null}
          <p className={channelNameValid ? SETTINGS_ITEM_DESCRIPTION_CLASSNAME : "text-xs text-rose-700"}>
            {t(channelNameValid ? "settings.picgo.imgbed.channelNameDescription" : "settings.picgo.imgbed.channelNameInvalid")}
          </p>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="imgbed-compress" className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.picgo.imgbed.serverCompress")}</label>
            <Switch id="imgbed-compress" checked={draft.imgbed.serverCompress} disabled={locked}
              onCheckedChange={(serverCompress) => updateImgBed({ serverCompress })} />
          </div>
          <p className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{t("settings.picgo.imgbed.serverCompressDescription")}</p>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="imgbed-auto-retry" className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.picgo.imgbed.autoRetry")}</label>
            <Switch id="imgbed-auto-retry" checked={imgBedAutoRetry(draft.imgbed.autoRetry, draft.imgbed.channelName)} disabled={locked}
              onCheckedChange={(autoRetry) => updateImgBed({ autoRetry })} />
          </div>
          <p className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{t("settings.picgo.imgbed.autoRetryDescription")}</p>
          <p className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{t("settings.picgo.imgbed.testDescription")}</p>
          <p className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{t("settings.picgo.externalImages")}</p>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 sm:ml-7">
        {draft.provider !== "edgeever" ? <Button variant="outline" size="sm" disabled={locked || !canTest} onClick={() => void testConnection()}>
          {t(busy ? "settings.picgo.testing" : "settings.picgo.test")}
        </Button> : null}
        {dirty ? <Button size="sm" disabled={locked || !canSave} onClick={save}>{t("settings.picgo.save")}</Button> : null}
        <span role="status" className="text-xs text-slate-500">{status}</span>
      </div>
    </div>
  );
};
