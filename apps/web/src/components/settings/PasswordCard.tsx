import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SETTINGS_CARD_HEADER_CLASSNAME,
  SETTINGS_CARD_ICON_CLASSNAME,
  SETTINGS_CARD_TITLE_CLASSNAME,
} from "./settings-ui";
import { Input } from "@/components/ui/input";
import { ApiRequestError, api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface PasswordCardProps {
  authRequired: boolean;
  demoMode: boolean;
}

export const PasswordCard = ({ authRequired, demoMode }: PasswordCardProps) => {
  const { t } = useTranslation();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!authRequired) {
    return null;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);

    if (newPassword.length < 8) {
      setFeedback({ type: "error", message: t("password.newPasswordTooShort") });
      return;
    }

    if (newPassword !== confirmPassword) {
      setFeedback({ type: "error", message: t("password.passwordMismatch") });
      return;
    }

    setIsSubmitting(true);

    try {
      await api.changePassword({ currentPassword, newPassword, confirmPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setIsDialogOpen(false);
      setNotice(t("password.changed"));
    } catch (error) {
      const message =
        error instanceof ApiRequestError && error.code === "invalid_current_password"
          ? t("password.currentPasswordIncorrect")
          : t("password.changeFailed");
      setFeedback({ type: "error", message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full min-w-0 overflow-hidden shadow-none">
      <CardHeader className={cn(SETTINGS_CARD_HEADER_CLASSNAME, "flex-row flex-wrap items-center justify-between gap-3")}>
        <div className="min-w-0 flex-1 basis-80">
          <CardTitle className={SETTINGS_CARD_TITLE_CLASSNAME}>
            <KeyRound className={SETTINGS_CARD_ICON_CLASSNAME} />
            {t("password.title")}
          </CardTitle>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">
            {demoMode ? t("password.demoReadOnly") : t("password.description")}
          </p>
        </div>
        {!demoMode ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setNotice(null);
              setFeedback(null);
              setCurrentPassword("");
              setNewPassword("");
              setConfirmPassword("");
              setIsDialogOpen(true);
            }}
          >
            {t("password.change")}
          </Button>
        ) : null}
      </CardHeader>
      {notice ? (
        <CardContent className="p-4 pt-0">
          <p role="status" className="text-xs font-medium text-emerald-700">
            {notice}
          </p>
        </CardContent>
      ) : null}

      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            setFeedback(null);
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <form onSubmit={handleSubmit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t("password.change")}</DialogTitle>
              <DialogDescription>{t("password.dialogDescription")}</DialogDescription>
            </DialogHeader>

            <div className="grid gap-3">
              <label className="grid gap-1.5 text-xs font-normal leading-5 text-slate-700">
                {t("password.currentPassword")}
                <Input
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  required
                />
              </label>
              <label className="grid gap-1.5 text-xs font-normal leading-5 text-slate-700">
                {t("password.newPassword")}
                <Input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                />
              </label>
              <label className="grid gap-1.5 text-xs font-normal leading-5 text-slate-700">
                {t("password.confirmPassword")}
                <Input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </label>

              {feedback ? (
                <p
                  className={cn(
                    "text-xs font-medium",
                    feedback.type === "error" ? "text-rose-600" : "text-emerald-700",
                  )}
                  role="status"
                >
                  {feedback.message}
                </p>
              ) : null}
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsDialogOpen(false)}
                disabled={isSubmitting}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant="solid"
                disabled={isSubmitting}
              >
                {isSubmitting ? t("password.changing") : t("password.change")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
