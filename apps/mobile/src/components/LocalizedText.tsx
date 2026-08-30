import { Children, forwardRef, isValidElement, type ComponentRef, type ReactNode } from "react";
import {
  Alert as NativeAlert,
  Pressable as NativePressable,
  Text as NativeText,
  TextInput as NativeTextInput,
  type AlertOptions,
  type PressableProps,
  type TextInputProps,
  type TextProps,
} from "react-native";
import { translateCurrentMobileText, useMobileLocale } from "../lib/mobile-locale";
import { presentAppDialog, type AppDialogButton } from "./app-dialog-controller";

const translateChildren = (children: ReactNode, translate: (value: string) => string): ReactNode =>
  Children.map(children, (child) => {
    if (typeof child === "string") {
      return translate(child);
    }
    // Keep numeric/boolean leaves as plain strings so Fabric's AttributedString
    // cache never receives mixed non-text host children under Text.
    if (typeof child === "number" || typeof child === "boolean") {
      return String(child);
    }
    if (isValidElement(child) && child.type === NativeText) {
      return child;
    }
    return child;
  });

export const Text = forwardRef<ComponentRef<typeof NativeText>, TextProps>(({ children, ...props }, ref) => {
  const { translate } = useMobileLocale();
  return (
    <NativeText allowFontScaling {...props} ref={ref}>
      {translateChildren(children, translate)}
    </NativeText>
  );
});

Text.displayName = "LocalizedText";

export const TextInput = forwardRef<ComponentRef<typeof NativeTextInput>, TextInputProps>(({ accessibilityHint, accessibilityLabel, placeholder, ...props }, ref) => {
  const { translate } = useMobileLocale();
  return (
    <NativeTextInput
      {...props}
      accessibilityHint={typeof accessibilityHint === "string" ? translate(accessibilityHint) : accessibilityHint}
      accessibilityLabel={typeof accessibilityLabel === "string" ? translate(accessibilityLabel) : accessibilityLabel}
      placeholder={placeholder ? translate(placeholder) : placeholder}
      ref={ref}
    />
  );
});

TextInput.displayName = "LocalizedTextInput";

export const Pressable = forwardRef<ComponentRef<typeof NativePressable>, PressableProps>(
  ({ accessibilityHint, accessibilityLabel, ...props }, ref) => (
    <NativePressable
      {...props}
      accessibilityHint={typeof accessibilityHint === "string" ? translateCurrentMobileText(accessibilityHint) : accessibilityHint}
      accessibilityLabel={typeof accessibilityLabel === "string" ? translateCurrentMobileText(accessibilityLabel) : accessibilityLabel}
      ref={ref}
    />
  )
);

Pressable.displayName = "LocalizedPressable";

type AppAlertParameters = [
  title: string,
  message?: string,
  buttons?: AppDialogButton[],
  options?: AlertOptions,
];

export const Alert = {
  alert: (...[title, message, buttons, options]: AppAlertParameters) => {
    const translatedTitle = translateCurrentMobileText(title);
    const translatedMessage = message ? translateCurrentMobileText(message) : message;
    const translatedButtons = buttons?.map((button) => ({
      ...button,
      text: button.text ? translateCurrentMobileText(button.text) : button.text,
    }));
    if (presentAppDialog({ title: translatedTitle, message: translatedMessage, buttons: translatedButtons, options })) {
      return;
    }
    NativeAlert.alert(translatedTitle, translatedMessage, translatedButtons, options);
  },
};
