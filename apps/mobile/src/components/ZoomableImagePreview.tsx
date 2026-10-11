import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PixelRatio, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { clampImageTranslation, fitPreviewImage, previewResizeMultiplier, zoomImageTranslation, type ImageSize } from "../lib/mobile-image-zoom";

type Props = {
  accessibilityHint: string;
  accessibilityLabel: string;
  onLongPress: () => void;
  renderImage: (onDimensions: (size: ImageSize) => void, resizeMultiplier: number) => ReactNode;
};

export const ZoomableImagePreview = ({ accessibilityHint, accessibilityLabel, onLongPress, renderImage }: Props) => {
  const [viewport, setViewport] = useState<ImageSize>({ width: 0, height: 0 });
  const [image, setImage] = useState<ImageSize>({ width: 0, height: 0 });
  const onDimensions = useCallback((size: ImageSize) => {
    // Android reports decoded dimensions, which can change after requesting more detail.
    // Capture the aspect once so that this reload never resets an ongoing gesture.
    if (size.width > 0 && size.height > 0) {
      setImage((previous) => previous.width > 0 ? previous : size);
    }
  }, []);
  const fitted = fitPreviewImage(image, viewport);
  const scale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const anchorX = useSharedValue(0);
  const anchorY = useSharedValue(0);
  const pinching = useSharedValue(false);
  const maxScale = 32;

  useEffect(() => {
    scale.value = 1;
    x.value = 0;
    y.value = 0;
    pinching.value = false;
  }, [viewport.width, viewport.height, image.width, image.height, scale, x, y, pinching]);

  const pinch = Gesture.Pinch()
    .onStart((event) => {
      pinching.value = true;
      startScale.value = scale.value;
      startX.value = x.value;
      startY.value = y.value;
      anchorX.value = event.focalX - viewport.width / 2;
      anchorY.value = event.focalY - viewport.height / 2;
    })
    .onUpdate((event) => {
      const next = Math.max(1, Math.min(maxScale, startScale.value * event.scale));
      x.value = clampImageTranslation(
        zoomImageTranslation(startX.value, anchorX.value, startScale.value, next) + event.focalX - viewport.width / 2 - anchorX.value,
        fitted.width, viewport.width, next,
      );
      y.value = clampImageTranslation(
        zoomImageTranslation(startY.value, anchorY.value, startScale.value, next) + event.focalY - viewport.height / 2 - anchorY.value,
        fitted.height, viewport.height, next,
      );
      scale.value = next;
    })
    .onFinalize(() => { pinching.value = false; });
  const pan = Gesture.Pan().minDistance(8)
    .onChange((event) => {
      if (pinching.value || event.numberOfPointers !== 1 || scale.value <= 1) return;
      x.value = clampImageTranslation(x.value + event.changeX, fitted.width, viewport.width, scale.value);
      y.value = clampImageTranslation(y.value + event.changeY, fitted.height, viewport.height, scale.value);
    });
  const doubleTap = Gesture.Tap().numberOfTaps(2).maxDistance(8)
    .onEnd((event, success) => {
      if (!success) return;
      const next = scale.value > 1 ? 1 : Math.min(3, maxScale);
      x.value = clampImageTranslation(zoomImageTranslation(x.value, event.x - viewport.width / 2, scale.value, next), fitted.width, viewport.width, next);
      y.value = clampImageTranslation(zoomImageTranslation(y.value, event.y - viewport.height / 2, scale.value, next), fitted.height, viewport.height, next);
      scale.value = next;
    });
  const longPress = Gesture.LongPress().minDuration(400).maxDistance(8).numberOfPointers(1)
    .runOnJS(true).onStart(onLongPress);
  const gesture = Gesture.Race(Gesture.Simultaneous(pinch, pan), doubleTap, longPress);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  return (
    <GestureHandlerRootView style={styles.root}>
      <GestureDetector gesture={gesture}>
        <View
          accessible
          accessibilityHint={accessibilityHint}
          accessibilityLabel={accessibilityLabel}
          accessibilityRole="image"
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }, { name: "longpress" }]}
          onAccessibilityAction={({ nativeEvent }) => {
            if (nativeEvent.actionName === "longpress") {
              onLongPress();
              return;
            }
            if (nativeEvent.actionName !== "increment" && nativeEvent.actionName !== "decrement") return;
            const next = nativeEvent.actionName === "increment"
              ? Math.min(maxScale, scale.value * 2) : Math.max(1, scale.value / 2);
            x.value = clampImageTranslation(x.value * next / scale.value, fitted.width, viewport.width, next);
            y.value = clampImageTranslation(y.value * next / scale.value, fitted.height, viewport.height, next);
            scale.value = next;
          }}
          onLayout={(event) => setViewport(event.nativeEvent.layout)}
          style={styles.viewport}
        >
          {viewport.width > 0 && viewport.height > 0 ? (
            <Animated.View style={[{ width: fitted.width, height: fitted.height }, animatedStyle]}>
              {renderImage(onDimensions, previewResizeMultiplier(fitted, viewport, PixelRatio.get()))}
            </Animated.View>
          ) : null}
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, width: "100%" },
  viewport: { flex: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
});
