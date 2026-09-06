import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Linking, Modal, Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Camera, FileText, Image as ImageIcon, X } from "../components/icons";
import { Alert, Pressable, Text } from "../components/LocalizedText";
import type { MobileImageUploadAsset } from "../lib/mobile-image-upload";
import { normalizeMobileImagePickerAssets } from "../lib/mobile-image-picker";
import { resolveMobileThemeStyles, useMobileTheme } from "../lib/mobile-theme";

type MobileEditorUploadSource = "camera" | "file" | "library";
type SourceResolver = (source: MobileEditorUploadSource | null) => void;
const NATIVE_PICKER_PRESENTATION_DELAY_MS = 120;

const getImagePickerAssets = normalizeMobileImagePickerAssets;

const requestCameraAccess = async () => {
  const current = await ImagePicker.getCameraPermissionsAsync();
  const permission = current.granted ? current : await ImagePicker.requestCameraPermissionsAsync();
  if (permission.granted) {
    return true;
  }

  Alert.alert(
    "需要相机权限",
    permission.canAskAgain
      ? "允许 EdgeEver 使用相机后，才能直接拍照插入笔记。"
      : "相机权限已被关闭。请前往系统设置允许 EdgeEver 使用相机。",
    permission.canAskAgain
      ? [{ text: "确定", style: "cancel" }]
      : [
          { text: "取消", style: "cancel" },
          { text: "前往设置", onPress: () => void Linking.openSettings() },
        ]
  );
  return false;
};

const pickWithImagePicker = async (source: "camera" | "library") => {
  if (source === "camera" && !(await requestCameraAccess())) {
    return [];
  }
  const options: ImagePicker.ImagePickerOptions = {
    allowsEditing: false,
    mediaTypes: ["images"],
    quality: 1,
    ...(source === "library" ? { allowsMultipleSelection: true, selectionLimit: 20, orderedSelection: true } : {}),
  };
  const result = source === "camera"
    ? await ImagePicker.launchCameraAsync(options)
    : await ImagePicker.launchImageLibraryAsync(options);
  return getImagePickerAssets(result);
};

const pickWithDocumentPicker = async (): Promise<MobileImageUploadAsset | null> => {
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: false,
    type: "*/*",
  });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) {
    return null;
  }
  return {
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType,
  };
};

const getPendingAndroidImage = async () => {
  if (Platform.OS !== "android") {
    return null;
  }
  const pending = await ImagePicker.getPendingResultAsync();
  if (!pending) {
    return null;
  }
  if ("canceled" in pending) {
    return getImagePickerAssets(pending);
  }
  throw new Error(pending.message || "系统未能恢复上次选择的图片，请重试");
};

const SourceRow = ({
  icon,
  label,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
}) => {
  const { resolvedTheme } = useMobileTheme();
  const styles = useMemo(() => resolveMobileThemeStyles(baseStyles, resolvedTheme), [resolvedTheme]);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.sourceRow}>
      <View style={styles.sourceIcon}>{icon}</View>
      <Text style={styles.sourceLabel}>{label}</Text>
    </Pressable>
  );
};

const MobileEditorUploadSourcePicker = ({
  onClose,
  onSelect,
  visible,
}: {
  onClose: () => void;
  onSelect: (source: MobileEditorUploadSource) => void;
  visible: boolean;
}) => {
  const { resolvedTheme } = useMobileTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => resolveMobileThemeStyles(baseStyles, resolvedTheme), [resolvedTheme]);
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable accessibilityLabel="关闭图片来源选择" onPress={onClose} style={styles.backdrop}>
        <Pressable
          accessibilityRole="none"
          onPress={(event) => event.stopPropagation()}
          style={[styles.sheet, { paddingBottom: Math.max(24, insets.bottom + 12) }]}
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <View>
              <Text accessibilityRole="header" style={styles.title}>添加图片或附件</Text>
              <Text style={styles.subtitle}>选择拍照、相册或设备文件</Text>
            </View>
            <Pressable accessibilityLabel="关闭" accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
              <X color="#64748b" size={19} />
            </Pressable>
          </View>
          <View style={styles.content}>
            <SourceRow icon={<Camera color="#0f172a" size={20} />} label="拍照" onPress={() => onSelect("camera")} />
            <SourceRow icon={<ImageIcon color="#0f172a" size={20} />} label="从相册选择" onPress={() => onSelect("library")} />
            <SourceRow icon={<FileText color="#0f172a" size={20} />} label="选择文件" onPress={() => onSelect("file")} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

export const useMobileEditorUploadAsset = () => {
  const [sourcePickerVisible, setSourcePickerVisible] = useState(false);
  const sourceResolverRef = useRef<SourceResolver | null>(null);

  const settleSource = useCallback((source: MobileEditorUploadSource | null) => {
    const resolve = sourceResolverRef.current;
    sourceResolverRef.current = null;
    setSourcePickerVisible(false);
    resolve?.(source);
  }, []);

  useEffect(() => () => {
    sourceResolverRef.current?.(null);
    sourceResolverRef.current = null;
  }, []);

  const chooseSource = useCallback(() => new Promise<MobileEditorUploadSource | null>((resolve) => {
    sourceResolverRef.current?.(null);
    sourceResolverRef.current = resolve;
    setSourcePickerVisible(true);
  }), []);

  const pickUploadAssets = useCallback(async (): Promise<MobileImageUploadAsset[]> => {
    const pendingImage = await getPendingAndroidImage();
    if (pendingImage) {
      return pendingImage;
    }
    const source = await chooseSource();
    if (!source) {
      return [];
    }
    // Let the native source sheet finish dismissing before presenting another
    // native controller. This avoids intermittent "already presenting" errors.
    await new Promise((resolve) => setTimeout(resolve, NATIVE_PICKER_PRESENTATION_DELAY_MS));
    if (source !== "file") return pickWithImagePicker(source);
    const asset = await pickWithDocumentPicker();
    return asset ? [asset] : [];
  }, [chooseSource]);

  return {
    pickUploadAssets,
    uploadSourcePicker: (
      <MobileEditorUploadSourcePicker
        onClose={() => settleSource(null)}
        onSelect={settleSource}
        visible={sourcePickerVisible}
      />
    ),
  };
};

const baseStyles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(15, 23, 42, 0.42)",
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    paddingBottom: 24,
  },
  handle: {
    alignSelf: "center",
    backgroundColor: "#cbd5e1",
    borderRadius: 999,
    height: 4,
    marginTop: 8,
    width: 42,
  },
  header: {
    alignItems: "center",
    borderBottomColor: "#e2e8f0",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  title: {
    color: "#0f172a",
    fontSize: 17,
    fontWeight: "700",
    lineHeight: 23,
  },
  subtitle: {
    color: "#64748b",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  closeButton: {
    alignItems: "center",
    borderRadius: 8,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  content: {
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  sourceRow: {
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderColor: "#e2e8f0",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 54,
    paddingHorizontal: 14,
  },
  sourceIcon: {
    alignItems: "center",
    backgroundColor: "#ecfdf5",
    borderRadius: 8,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  sourceLabel: {
    color: "#0f172a",
    fontSize: 15,
    fontWeight: "600",
  },
});
