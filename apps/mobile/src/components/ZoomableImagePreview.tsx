import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { PixelRatio, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { ChevronLeft, ChevronRight } from "./icons";
import {
  clampImageTranslation,
  fitPreviewImage,
  previewResizeMultiplier,
  resolveNextPreviewIndex,
  resolveSwipeDirection,
  zoomImageTranslation,
  type ImageSize,
  type PreviewImageItem,
} from "../lib/mobile-image-zoom";

type Props = {
  accessibilityHint: string;
  accessibilityLabel: string;
  currentIndex?: number;
  images?: PreviewImageItem[];
  nextImageLabel?: string;
  onIndexChange?: (index: number) => void;
  previousImageLabel?: string;
  onLongPress: () => void;
  renderImage: (onDimensions: (size: ImageSize) => void, resizeMultiplier: number) => ReactNode;
  showNavigationArrows?: boolean;
};

export const ZoomableImagePreview = ({
  accessibilityHint,
  accessibilityLabel,
  currentIndex = 0,
  images,
  nextImageLabel,
  onIndexChange,
  onLongPress,
  previousImageLabel,
  renderImage,
  showNavigationArrows = false,
}: Props) => {
  const [viewport, setViewport] = useState<ImageSize>({ width: 0, height: 0 });
  const [image, setImage] = useState<ImageSize>({ width: 0, height: 0 });

  const total = images && images.length > 0 ? images.length : 1;
  const activeIndex = Math.max(0, Math.min(total - 1, currentIndex));
  const currentItem = images && images.length > activeIndex ? images[activeIndex] : null;
  const currentSource = currentItem?.source ?? "";

  const onDimensions = useCallback((size: ImageSize) => {
    // Android reports decoded dimensions, which can change after requesting more detail.
    // Capture the aspect once so that this reload never resets an ongoing gesture.
    if (size.width > 0 && size.height > 0) {
      setImage((previous) => (previous.width > 0 ? previous : size));
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
  const opacity = useSharedValue(1);
  const maxScale = 32;

  useLayoutEffect(() => {
    setImage({ width: 0, height: 0 });
    scale.value = 1;
    x.value = 0;
    y.value = 0;
    pinching.value = false;
    // A completed swipe hides the outgoing image before this commit.
    // Reveal only after the new source is in place.
    opacity.value = 1;
  }, [currentSource, activeIndex]);

  useEffect(() => {
    scale.value = 1;
    x.value = 0;
    y.value = 0;
    pinching.value = false;
  }, [viewport.width, viewport.height]);

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
    .onStart(() => {
      startX.value = x.value;
      startY.value = y.value;
    })
    .onChange((event) => {
      if (pinching.value || event.numberOfPointers !== 1) return;

      if (scale.value > 1) {
        x.value = clampImageTranslation(x.value + event.changeX, fitted.width, viewport.width, scale.value);
        y.value = clampImageTranslation(y.value + event.changeY, fitted.height, viewport.height, scale.value);
        return;
      }

      if (total <= 1) {
        x.value = event.translationX * 0.2;
        y.value = event.translationY * 0.2;
        return;
      }

      const absX = Math.abs(event.translationX);
      const absY = Math.abs(event.translationY);
      const hasPrev = activeIndex > 0;
      const hasNext = activeIndex < total - 1;

      if (absX >= absY) {
        const isBoundary = (event.translationX > 0 && !hasPrev) || (event.translationX < 0 && !hasNext);
        x.value = isBoundary ? event.translationX * 0.25 : event.translationX;
        y.value = 0;
      } else {
        const isBoundary = (event.translationY > 0 && !hasPrev) || (event.translationY < 0 && !hasNext);
        y.value = isBoundary ? event.translationY * 0.25 : event.translationY;
        x.value = 0;
      }
    })
    .onEnd((event) => {
      if (pinching.value || scale.value > 1) return;

      if (total <= 1 || !onIndexChange) {
        x.value = withTiming(0, { duration: 200 });
        y.value = withTiming(0, { duration: 200 });
        return;
      }

      const dir = resolveSwipeDirection(event.translationX, event.translationY, event.velocityX, event.velocityY);
      const nextIndex = resolveNextPreviewIndex(activeIndex, total, dir);

      if (nextIndex !== activeIndex && onIndexChange) {
        const isHorizontal = Math.abs(event.translationX) >= Math.abs(event.translationY);
        // Hide first, then recenter. Resetting while visible paints the
        // outgoing image in the middle before React swaps the source.
        if (isHorizontal) {
          const targetX = dir === "next" ? -viewport.width : viewport.width;
          x.value = withTiming(targetX, { duration: 150 }, (finished) => {
            if (finished === false) return;
            opacity.value = 0;
            x.value = 0;
            y.value = 0;
            runOnJS(onIndexChange)(nextIndex);
          });
        } else {
          const targetY = dir === "next" ? -viewport.height : viewport.height;
          y.value = withTiming(targetY, { duration: 150 }, (finished) => {
            if (finished === false) return;
            opacity.value = 0;
            x.value = 0;
            y.value = 0;
            runOnJS(onIndexChange)(nextIndex);
          });
        }
      } else {
        x.value = withSpring(0, { damping: 20, stiffness: 200 });
        y.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
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
    opacity: opacity.value,
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  const fullAccessibilityLabel = total > 1
    ? `${accessibilityLabel} (${activeIndex + 1} / ${total})`
    : accessibilityLabel;

  return (
    <GestureHandlerRootView style={styles.root}>
      {total > 1 ? (
        <View pointerEvents="none" style={styles.counterContainer}>
          <View style={styles.counterBadge}>
            <Text style={styles.counterText}>
              {`${activeIndex + 1} / ${total}`}
            </Text>
          </View>
        </View>
      ) : null}

      {showNavigationArrows && total > 1 && onIndexChange ? (
        <>
          {activeIndex > 0 && previousImageLabel ? (
            <Pressable
              accessibilityLabel={previousImageLabel}
              accessibilityRole="button"
              onPress={() => onIndexChange(activeIndex - 1)}
              style={[styles.navButton, styles.navButtonLeft]}
            >
              <ChevronLeft color="#ffffff" size={24} />
            </Pressable>
          ) : null}
          {activeIndex < total - 1 && nextImageLabel ? (
            <Pressable
              accessibilityLabel={nextImageLabel}
              accessibilityRole="button"
              onPress={() => onIndexChange(activeIndex + 1)}
              style={[styles.navButton, styles.navButtonRight]}
            >
              <ChevronRight color="#ffffff" size={24} />
            </Pressable>
          ) : null}
        </>
      ) : null}

      <GestureDetector gesture={gesture}>
        <View
          accessible
          accessibilityHint={accessibilityHint}
          accessibilityLabel={fullAccessibilityLabel}
          accessibilityRole="image"
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }, { name: "longpress" }]}
          onAccessibilityAction={({ nativeEvent }) => {
            if (nativeEvent.actionName === "longpress") {
              onLongPress();
              return;
            }
            if (nativeEvent.actionName !== "increment" && nativeEvent.actionName !== "decrement") return;
            const next = nativeEvent.actionName === "increment"
              ? Math.min(maxScale, scale.value * 2)
              : Math.max(1, scale.value / 2);
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
  counterContainer: {
    alignItems: "center",
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 58,
    zIndex: 10,
  },
  counterBadge: {
    backgroundColor: "rgba(15, 23, 42, 0.78)",
    borderColor: "rgba(255, 255, 255, 0.15)",
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  counterText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  navButton: {
    alignItems: "center",
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    borderColor: "rgba(255, 255, 255, 0.15)",
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    height: 44,
    justifyContent: "center",
    marginTop: -22,
    position: "absolute",
    top: "50%",
    width: 44,
    zIndex: 10,
  },
  navButtonLeft: {
    left: 12,
  },
  navButtonRight: {
    right: 12,
  },
});
