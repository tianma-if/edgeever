import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Image } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { expandImgBedFolder, imgBedFolderError, IMGBED_FOLDER_PLACEHOLDERS, IMGBED_NAME_TYPES, IMGBED_SAMPLE_MEMO_ID, IMGBED_UPLOAD_CHANNELS, type ImgBedNameType, type ImgBedUploadChannel } from "@/lib/imgbed";
import { hasImgBedBridge, hasPicGoBridge, readPicGoPreference, takePicGoServerKey, writePicGoPreference, type ImgBedPreference, type PicGoPreference } from "@/lib/picgo";
import { SETTINGS_ITEM_DESCRIPTION_CLASSNAME, SETTINGS_ITEM_TITLE_CLASSNAME } from "./settings-ui";

const picGoTargetId = (value: PicGoPreference) => value.provider === "imgbed"
  ? ["imgbed", value.imgbed.endpoint, value.imgbed.token, value.imgbed.uploadFolder, value.imgbed.nameType,
    value.imgbed.uploadChannel, String(value.imgbed.serverCompress)].join("\0")
  : `${value.endpoint}\0${value.serverKey}`;
const sameImgBed = (left: ImgBedPreference, right: ImgBedPreference) => picGoTargetId({ provider: "imgbed", endpoint: "", serverKey: "", imgbed: left })
  === picGoTargetId({ provider: "imgbed", endpoint: "", serverKey: "", imgbed: right });

export const PicGoSettingsItem = () => {
  const { t } = useTranslation();
  const [saved, setSaved] = useState(readPicGoPreference);
  const [draft, setDraft] = useState(saved);
  const [testedTarget, setTestedTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const desktopAvailable = draft.provider === "imgbed" ? hasImgBedBridge() : hasPicGoBridge();
  const dirty = draft.provider !== saved.provider || draft.endpoint !== saved.endpoint || draft.serverKey !== saved.serverKey
    || !sameImgBed(draft.imgbed, saved.imgbed);
  const folderError = imgBedFolderError(draft.imgbed.uploadFolder);
  const imgBedReady = Boolean(draft.imgbed.endpoint.trim() && draft.imgbed.token.trim()) && !folderError;
  const canTest = desktopAvailable && (draft.provider !== "imgbed" || imgBedReady);
  const canSave = dirty && (draft.provider === "edgeever" || (desktopAvailable && testedTarget === picGoTargetId(draft)));
  const updateImgBed = (patch: Partial<ImgBedPreference>) => {
    setDraft({ ...draft, imgbed: { ...draft.imgbed, ...patch } });
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
        await window.edgeeverDesktop!.testImgBedConnection!({
          endpoint: draft.imgbed.endpoint, token: draft.imgbed.token, nameType: draft.imgbed.nameType,
          uploadChannel: draft.imgbed.uploadChannel, serverCompress: draft.imgbed.serverCompress,
          uploadFolder: expandImgBedFolder(draft.imgbed.uploadFolder),
        });
      } else {
        await window.edgeeverDesktop!.testPicGoConnection({ endpoint: draft.endpoint, serverKey: draft.serverKey });
      }
      setTestedTarget(picGoTargetId(draft));
      setStatus(t(`${prefix}.connected`));
    } catch {
      setStatus(t(`${prefix}.connectionFailed`));
    } finally { setBusy(false); }
  };
  const save = () => {
    try {
      writePicGoPreference(draft);
      setSaved(draft);
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
        <Select value={draft.provider} disabled={busy} onValueChange={(provider) => {
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
          {!desktopAvailable ? <p className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{t("settings.picgo.webPreview")}</p> : null}
          <p className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{t("settings.picgo.description")}</p>
          <label htmlFor="picgo-endpoint" className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.picgo.endpoint")}</label>
          <Input id="picgo-endpoint" value={draft.endpoint} disabled={busy} onChange={(event) => {
            const next = takePicGoServerKey(event.target.value);
            setDraft({ ...draft, endpoint: next.endpoint, serverKey: next.serverKey ?? draft.serverKey });
            setTestedTarget(null);
            setStatus("");
          }} spellCheck={false} inputMode="url" autoComplete="off" />
          <label htmlFor="picgo-server-key" className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.picgo.serverKey")}</label>
          <Input id="picgo-server-key" name="picgo-server-key" type="password" value={draft.serverKey} disabled={busy} onChange={(event) => {
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
          {!desktopAvailable ? <p className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{t("settings.picgo.webPreview")}</p> : null}
          <p className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{t("settings.picgo.imgbed.description")}</p>
          <label htmlFor="imgbed-endpoint" className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.picgo.imgbed.endpoint")}</label>
          <Input id="imgbed-endpoint" value={draft.imgbed.endpoint} disabled={busy} placeholder="https://img.example.com"
            onChange={(event) => updateImgBed({ endpoint: event.target.value.trim() })} spellCheck={false} inputMode="url" autoComplete="off" />
          <p className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{t("settings.picgo.imgbed.endpointDescription")}</p>
          <label htmlFor="imgbed-token" className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.picgo.imgbed.token")}</label>
          <Input id="imgbed-token" name="imgbed-token" type="password" value={draft.imgbed.token} disabled={busy}
            onChange={(event) => updateImgBed({ token: event.target.value.trim() })} spellCheck={false} autoComplete="new-password" maxLength={1024} />
          <p className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{t("settings.picgo.imgbed.tokenDescription")}</p>
          <label htmlFor="imgbed-folder" className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.picgo.imgbed.folder")}</label>
          <Input id="imgbed-folder" value={draft.imgbed.uploadFolder} disabled={busy} placeholder="notes/{Y}/{m}" aria-invalid={folderError ? true : undefined}
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
          <Select value={draft.imgbed.nameType} disabled={busy} onValueChange={(nameType) => updateImgBed({ nameType: nameType as ImgBedNameType })}>
            <SelectTrigger id="imgbed-name-type" className="h-9 w-full sm:w-80"><SelectValue /></SelectTrigger>
            <SelectContent>
              {IMGBED_NAME_TYPES.map((nameType) => (
                <SelectItem key={nameType} value={nameType}>{t(`settings.picgo.imgbed.nameTypes.${nameType}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label htmlFor="imgbed-channel" className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.picgo.imgbed.channel")}</label>
          <Select value={draft.imgbed.uploadChannel} disabled={busy} onValueChange={(uploadChannel) => updateImgBed({ uploadChannel: uploadChannel as ImgBedUploadChannel })}>
            <SelectTrigger id="imgbed-channel" className="h-9 w-full sm:w-80"><SelectValue /></SelectTrigger>
            <SelectContent>
              {IMGBED_UPLOAD_CHANNELS.map((channel) => (
                <SelectItem key={channel} value={channel}>{t(`settings.picgo.imgbed.channels.${channel}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="imgbed-compress" className={SETTINGS_ITEM_TITLE_CLASSNAME}>{t("settings.picgo.imgbed.serverCompress")}</label>
            <Switch id="imgbed-compress" checked={draft.imgbed.serverCompress} disabled={busy}
              onCheckedChange={(serverCompress) => updateImgBed({ serverCompress })} />
          </div>
          <p className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{t("settings.picgo.imgbed.serverCompressDescription")}</p>
          <p className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{t("settings.picgo.imgbed.testDescription")}</p>
          <p className={SETTINGS_ITEM_DESCRIPTION_CLASSNAME}>{t("settings.picgo.externalImages")}</p>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 sm:ml-7">
        {draft.provider !== "edgeever" ? <Button variant="outline" size="sm" disabled={busy || !canTest} onClick={() => void testConnection()}>
          {t(busy ? "settings.picgo.testing" : "settings.picgo.test")}
        </Button> : null}
        {dirty ? <Button size="sm" disabled={busy || !canSave} onClick={save}>{t("settings.picgo.save")}</Button> : null}
        <span role="status" className="text-xs text-slate-500">{status}</span>
      </div>
    </div>
  );
};
