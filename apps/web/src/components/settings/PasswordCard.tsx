import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiRequestError, api } from "@/lib/api";

interface PasswordCardProps {
  authRequired: boolean;
}

export const PasswordCard = ({ authRequired }: PasswordCardProps) => {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

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
      setFeedback({ type: "success", message: t("password.changed") });
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
      <CardHeader className="p-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <KeyRound className="h-4 w-4 text-emerald-700" />
          {t("password.title")}
        </CardTitle>
        <CardDescription>{t("password.description")}</CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <form className="grid gap-3" onSubmit={handleSubmit}>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            {t("password.currentPassword")}
            <Input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
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
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
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
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p
              className={feedback?.type === "error" ? "text-xs font-medium text-rose-600" : "text-xs font-medium text-emerald-700"}
              role={feedback ? "status" : undefined}
            >
              {feedback?.message}
            </p>
            <Button className="w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto" type="submit" disabled={isSubmitting}>
              {isSubmitting ? t("password.changing") : t("password.change")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
