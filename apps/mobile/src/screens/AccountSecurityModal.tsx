import { ApiRequestError } from "@edgeever/client";
import { useMutation } from "@tanstack/react-query";
import { KeyRound } from "../components/icons";
import { useEffect, useState } from "react";
import {
  StyleSheet,
  View,
} from "react-native";
import { Pressable, Text, TextInput } from "../components/LocalizedText";
import { resolveMobileThemeStyles, useMobileTheme, type MobileResolvedTheme } from "../lib/mobile-theme";
import { useSession } from "../lib/session";

export const AccountSecurityPanel = ({
  active,
}: {
  active: boolean;
}) => {
  const { resolvedTheme } = useMobileTheme();
  refreshAccountSecurityThemeStyles(resolvedTheme);
  const { client } = useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const passwordMutation = useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("Client is not ready");
      if (newPassword.length < 8) throw new Error("新密码至少需要 8 个字符");
      if (newPassword !== confirmPassword) throw new Error("两次输入的新密码不一致");
      return client.changePassword({ currentPassword, newPassword, confirmPassword });
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
  });

  useEffect(() => {
    if (!active) {
      passwordMutation.reset();
    }
  }, [active]);

  const errorMessage = (error: unknown) => {
    if (error instanceof ApiRequestError && error.code === "invalid_current_password") return "当前密码不正确";
    return error instanceof Error ? error.message : "操作失败，请稍后再试";
  };

  return (
    <View style={styles.content}>
      <View style={styles.hero}>
        <KeyRound color="#15803d" size={22} />
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>修改密码</Text>
          <Text style={styles.help}>修改后会保留当前设备登录，并退出其他设备上的登录会话。</Text>
        </View>
      </View>
      <Field label="当前密码" onChangeText={setCurrentPassword} value={currentPassword} />
      <Field label="新密码" onChangeText={setNewPassword} value={newPassword} />
      <Field label="确认新密码" onChangeText={setConfirmPassword} value={confirmPassword} />
      {passwordMutation.error ? <Text style={styles.error}>{errorMessage(passwordMutation.error)}</Text> : null}
      {passwordMutation.isSuccess ? <Text accessibilityLiveRegion="polite" style={styles.success}>密码已修改成功。</Text> : null}
      <PrimaryButton
        disabled={passwordMutation.isPending}
        label={passwordMutation.isPending ? "正在修改…" : "修改密码"}
        onPress={() => passwordMutation.mutate()}
      />
    </View>
  );
};

const Field = ({ help, label, onChangeText, placeholder, secure = true, value }: {
  help?: string;
  label: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secure?: boolean;
  value: string;
}) => (
  <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput
      autoCapitalize="none"
      autoCorrect={false}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#94a3b8"
      secureTextEntry={secure}
      style={styles.input}
      value={value}
    />
    {help ? <Text style={styles.help}>{help}</Text> : null}
  </View>
);

const PrimaryButton = ({ disabled, label, onPress }: { disabled: boolean; label: string; onPress: () => void }) => (
  <Pressable disabled={disabled} onPress={onPress} style={[styles.primaryButton, disabled && styles.disabled]}>
    <Text style={styles.primaryButtonText}>{label}</Text>
  </Pressable>
);

const baseAccountSecurityStyles = StyleSheet.create({
  content: { gap: 14, padding: 16, paddingBottom: 40 },
  hero: { alignItems: "flex-start", backgroundColor: "transparent", flexDirection: "row", gap: 10 },
  flex: { flex: 1 },
  cardTitle: { color: "#17211a", fontSize: 16, fontWeight: "800" },
  help: { color: "#64748b", fontSize: 12, lineHeight: 18, marginTop: 3 },
  field: { gap: 7 },
  label: { color: "#334155", fontSize: 13, fontWeight: "700" },
  input: { backgroundColor: "#ffffff", borderColor: "#cad8cc", borderRadius: 10, borderWidth: 1, color: "#17211a", minHeight: 48, paddingHorizontal: 13 },
  primaryButton: { alignItems: "center", backgroundColor: "#15803d", borderRadius: 10, minHeight: 48, justifyContent: "center", paddingHorizontal: 16 },
  primaryButtonText: { color: "#ffffff", fontSize: 14, fontWeight: "800" },
  disabled: { opacity: 0.45 },
  error: { color: "#be123c", fontSize: 13, lineHeight: 19 },
  success: { color: "#15803d", fontSize: 13, fontWeight: "700", lineHeight: 19 },
});

let styles = baseAccountSecurityStyles;
let accountSecurityStylesTheme: MobileResolvedTheme = "light";

const refreshAccountSecurityThemeStyles = (theme: MobileResolvedTheme) => {
  if (accountSecurityStylesTheme !== theme) {
    styles = resolveMobileThemeStyles(baseAccountSecurityStyles, theme);
    accountSecurityStylesTheme = theme;
  }
};
