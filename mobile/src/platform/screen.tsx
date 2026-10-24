import React from "react";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView, type ViewProps } from "react-native";
export function Screen({ children, ...props }: ViewProps) { return <SafeAreaView edges={["top"]} {...props}><KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>{children}</KeyboardAvoidingView></SafeAreaView>; }
export function useBottomSpace(minimum = 30) { return Math.max(minimum, useSafeAreaInsets().bottom); }
