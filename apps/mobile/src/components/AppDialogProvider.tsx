import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Modal, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AlertTriangle, GitHub, GooglePlay, ShieldCheck, X } from "./icons";
import { Pressable, Text } from "./LocalizedText";
import { registerAppDialogPresenter, type AppDialogButton, type AppDialogRequest } from "./app-dialog-controller";
import { translateCurrentMobileText } from "../lib/mobile-locale";
import { resolveMobileThemeStyles, useMobileTheme } from "../lib/mobile-theme";

export const AppDialogProvider = ({ children }: { children: ReactNode }) => {
  const { resolvedTheme } = useMobileTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => resolveMobileThemeStyles(baseStyles, resolvedTheme), [resolvedTheme]);
  const [request, setRequest] = useState<AppDialogRequest | null>(null);

  useEffect(() => registerAppDialogPresenter(setRequest), []);

  const buttons = useMemo(() => {
    if (!request) {
      return [];
    }
    return request.buttons?.length
      ? request.buttons
      : [{ text: translateCurrentMobileText("确定") } satisfies AppDialogButton];
  }, [request]);
  const cancelButton = buttons.find((button) => button.style === "cancel");
  const destructive = buttons.some((button) => button.style === "destructive");
  const primary = !destructive && Boolean(request?.buttons?.some((button) => button.style !== "cancel"));

  const dismiss = useCallback((invokeCancel = false) => {
    const activeRequest = request;
    setRequest(null);
    if (invokeCancel) {
      cancelButton?.onPress?.();
    }
    activeRequest?.options?.onDismiss?.();
  }, [cancelButton, request]);

  const selectButton = (button: AppDialogButton) => {
    setRequest(null);
    button.onPress?.();
  };

  return (
    <>
      {children}
      <Modal
        animationType="fade"
        onRequestClose={() => dismiss(Boolean(cancelButton))}
        transparent
        visible={Boolean(request)}
      >
        <View style={[styles.backdrop, { paddingBottom: Math.max(20, insets.bottom + 12), paddingTop: Math.max(20, insets.top + 12) }]}>
          <Pressable
            accessibilityLabel="关闭对话框"
            accessibilityRole="button"
            onPress={() => {
              if (request?.options?.cancelable !== false) {
                dismiss(Boolean(cancelButton));
              }
            }}
            style={StyleSheet.absoluteFill}
          />
          <View accessibilityViewIsModal style={styles.dialog}>
            <Pressable
              accessibilityLabel="关闭"
              accessibilityRole="button"
              onPress={() => dismiss(Boolean(cancelButton))}
              style={styles.closeButton}
            >
              <X color="#64748b" size={18} />
            </Pressable>
            <View style={styles.header}>
              <View style={[
                styles.iconCircle,
                destructive ? styles.iconCircleDanger : primary ? styles.iconCirclePrimary : styles.iconCircleNeutral,
              ]}>
                {destructive
                  ? <AlertTriangle color="#be123c" size={20} />
                  : <ShieldCheck color={primary ? "#047857" : "#64748b"} size={20} />}
              </View>
              <View style={styles.copy}>
                <Text accessibilityRole="header" style={styles.title}>{request?.title ?? ""}</Text>
                {request?.message ? <Text style={styles.description}>{request.message}</Text> : null}
              </View>
            </View>
            <View style={styles.footer}>
              {[...buttons].reverse().map((button, index) => {
                const isDestructive = button.style === "destructive";
                const isCancel = button.style === "cancel";
                const iconColor = isCancel ? "#0f172a" : "#ffffff";
                return (
                  <Pressable
                    accessibilityRole="button"
                    key={`${button.text ?? "button"}-${index}`}
                    onPress={() => selectButton(button)}
                    style={[
                      styles.button,
                      isDestructive ? styles.buttonDanger : isCancel ? styles.buttonOutline : styles.buttonPrimary,
                    ]}
                  >
                    {button.icon === "google-play"
                      ? <GooglePlay accessibilityElementsHidden color={iconColor} size={19} />
                      : button.icon === "github"
                        ? <GitHub accessibilityElementsHidden color={iconColor} size={18} />
                        : null}
                    <Text style={[
                      styles.buttonText,
                      isDestructive ? styles.buttonTextDanger : isCancel ? styles.buttonTextOutline : styles.buttonTextPrimary,
                    ]}>
                      {button.text ?? translateCurrentMobileText("确定")}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};

const baseStyles = StyleSheet.create({
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(15, 23, 42, 0.42)",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  dialog: {
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 12,
    borderWidth: 1,
    elevation: 16,
    maxWidth: 448,
    overflow: "hidden",
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 24,
    width: "100%",
  },
  header: {
    alignItems: "flex-start",
    borderBottomColor: "#e2e8f0",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 16,
    paddingBottom: 20,
    paddingLeft: 20,
    paddingRight: 52,
    paddingTop: 20,
  },
  closeButton: {
    alignItems: "center",
    borderRadius: 6,
    height: 36,
    justifyContent: "center",
    position: "absolute",
    right: 10,
    top: 10,
    width: 36,
    zIndex: 2,
  },
  iconCircle: {
    alignItems: "center",
    borderRadius: 999,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  iconCircleDanger: {
    backgroundColor: "#fff1f2",
  },
  iconCircleNeutral: {
    backgroundColor: "#f1f5f9",
  },
  iconCirclePrimary: {
    backgroundColor: "#ecfdf5",
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: "#0f172a",
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  description: {
    color: "#64748b",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  footer: {
    backgroundColor: "#f8fafc",
    borderTopColor: "#f1f5f9",
    borderTopWidth: 1,
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  button: {
    alignItems: "center",
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 16,
  },
  buttonPrimary: {
    backgroundColor: "#0f172a",
    borderColor: "#0f172a",
  },
  buttonDanger: {
    backgroundColor: "#e11d48",
    borderColor: "#e11d48",
  },
  buttonOutline: {
    backgroundColor: "#ffffff",
    borderColor: "#cbd5e1",
  },
  buttonText: {
    fontSize: 14,
    fontWeight: "700",
  },
  buttonTextPrimary: {
    color: "#ffffff",
  },
  buttonTextDanger: {
    color: "#ffffff",
  },
  buttonTextOutline: {
    color: "#0f172a",
  },
});
