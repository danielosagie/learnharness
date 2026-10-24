import React from "react";
import { View } from "react-native";
export function useCameraPermissions() { return [{ granted: true }, async () => ({ granted: true })] as const; }
export function CameraView(_props: { style?: unknown; barcodeScannerSettings?: unknown; onBarcodeScanned?: (event: { data: string }) => void }) { return <div style={{ flex: 1, background: "linear-gradient(160deg, #262626 0%, #121212 70%)" }} />; }
