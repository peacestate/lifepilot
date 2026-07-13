/**
 * CameraSheet — full-screen camera modal for receipt scanning.
 *
 * Uses react-native-vision-camera v4:
 *   • Requests camera permission inline (first-use prompt)
 *   • Shows live viewfinder + shutter button + close
 *   • takePhoto() → file:// URI → passed to onCapture
 *
 * PRIVACY: photos stay in app cache only; they are never uploaded.
 * The URI is passed directly to react-native-mlkit-ocr (on-device).
 */
import React, { useRef } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
} from 'react-native';

import { color, space } from '../../theme/tokens';

// VisionCamera types — dynamic import keeps bundler from erroring before native build
type CameraRef = { takePhoto: (opts: { flash: 'off' | 'on' }) => Promise<{ path: string }> };
type CameraDevice = { id: string };

// ── Dynamic camera loader ────────────────────────────────────────────────────
// Loaded once; null until `npm install` + `expo prebuild` runs.
let _cameraModule: {
  Camera: React.ComponentType<{
    ref: React.Ref<CameraRef>;
    device: CameraDevice;
    isActive: boolean;
    photo: boolean;
    style: object;
  }>;
  useCameraDevice: (pos: 'back' | 'front') => CameraDevice | undefined;
  useCameraPermission: () => { hasPermission: boolean; requestPermission: () => Promise<boolean> };
} | null = null;

function loadCameraModule() {
  if (_cameraModule) return _cameraModule;
  try {
    _cameraModule = require('react-native-vision-camera');
  } catch {
    _cameraModule = null;
  }
  return _cameraModule;
}

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  visible: boolean;
  onCapture: (uri: string) => void;
  onClose: () => void;
};

// ── Component ─────────────────────────────────────────────────────────────────

export function CameraSheet({ visible, onCapture, onClose }: Props) {
  const mod = loadCameraModule();

  if (!mod) {
    // Native build not ready — show a fallback message inside the modal
    return (
      <Modal visible={visible} animationType="slide" statusBarTranslucent>
        <View style={styles.fallback}>
          <Text style={styles.fallbackTitle}>Camera not available</Text>
          <Text style={styles.fallbackSub}>
            Run <Text style={styles.code}>expo prebuild</Text> then rebuild the app to enable the camera.
          </Text>
          <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={12} accessibilityRole="button">
            <Text style={styles.closeBtnText}>Close</Text>
          </Pressable>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent>
      <CameraBody
        mod={mod}
        onCapture={onCapture}
        onClose={onClose}
      />
    </Modal>
  );
}

// ── Inner camera body (only rendered when mod is available) ───────────────────

function CameraBody({
  mod,
  onCapture,
  onClose,
}: {
  mod: NonNullable<ReturnType<typeof loadCameraModule>>;
  onCapture: (uri: string) => void;
  onClose: () => void;
}) {
  const { Camera, useCameraDevice, useCameraPermission } = mod;
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const cameraRef = useRef<CameraRef>(null);
  const [capturing, setCapturing] = React.useState(false);

  React.useEffect(() => {
    if (!hasPermission) { void requestPermission(); }
  }, [hasPermission, requestPermission]);

  const capture = async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePhoto({ flash: 'off' });
      // VisionCamera returns a bare path on iOS; Android also bare
      const uri = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;
      onCapture(uri);
    } catch {
      // silently cancel — user stays on the same state
    } finally {
      setCapturing(false);
    }
  };

  if (!hasPermission) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>Camera permission needed</Text>
        <Text style={styles.fallbackSub}>LifePilot uses the camera to scan receipts on-device.</Text>
        <Pressable onPress={() => void requestPermission()} style={styles.permBtn} accessibilityRole="button">
          <Text style={styles.permBtnText}>Allow camera access</Text>
        </Pressable>
        <Pressable onPress={onClose} style={styles.closeLink} hitSlop={12} accessibilityRole="button">
          <Text style={styles.closeLinkText}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.fallback}>
        <ActivityIndicator color={color.accent} />
        <Text style={styles.fallbackSub}>Initialising camera…</Text>
        <Pressable onPress={onClose} style={styles.closeLink} hitSlop={12} accessibilityRole="button">
          <Text style={styles.closeLinkText}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Camera
        ref={cameraRef}
        device={device}
        isActive={true}
        photo
        style={StyleSheet.absoluteFill}
      />

      {/* Close button — top-left */}
      <Pressable
        onPress={onClose}
        hitSlop={16}
        accessibilityRole="button"
        accessibilityLabel="Close camera"
        style={styles.topClose}
      >
        <Text style={styles.topCloseText}>✕</Text>
      </Pressable>

      {/* Hint text */}
      <View style={styles.hint}>
        <Text style={styles.hintText} maxFontSizeMultiplier={1.2}>
          Point at receipt and tap
        </Text>
      </View>

      {/* Shutter button */}
      <View style={styles.shutterRow}>
        <Pressable
          onPress={() => void capture()}
          accessibilityRole="button"
          accessibilityLabel="Capture receipt"
          disabled={capturing}
          style={({ pressed }) => [
            styles.shutter,
            pressed && styles.shutterPressed,
            capturing && styles.shutterDisabled,
          ]}
        >
          {capturing
            ? <ActivityIndicator color={color.background} />
            : <View style={styles.shutterInner} />
          }
        </Pressable>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const SHUTTER_SIZE = 72;
const SHUTTER_INNER = 56;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  fallback: {
    flex: 1,
    backgroundColor: color.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: space[4],
  },
  fallbackTitle: { fontSize: 18, fontWeight: '600', color: color.textPrimary, textAlign: 'center' },
  fallbackSub: { fontSize: 14, color: color.textSecondary, textAlign: 'center', lineHeight: 20 },
  code: { fontFamily: 'monospace', color: color.accent },
  // top close
  topClose: {
    position: 'absolute',
    top: 56,
    left: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topCloseText: { fontSize: 18, color: '#fff' },
  // hint
  hint: {
    position: 'absolute',
    bottom: 140,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hintText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 12,
    overflow: 'hidden',
  },
  // shutter
  shutterRow: {
    position: 'absolute',
    bottom: 44,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  shutter: {
    width: SHUTTER_SIZE,
    height: SHUTTER_SIZE,
    borderRadius: SHUTTER_SIZE / 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 3,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterPressed: { opacity: 0.75, transform: [{ scale: 0.96 }] },
  shutterDisabled: { opacity: 0.5 },
  shutterInner: {
    width: SHUTTER_INNER,
    height: SHUTTER_INNER,
    borderRadius: SHUTTER_INNER / 2,
    backgroundColor: '#fff',
  },
  // permission
  permBtn: {
    backgroundColor: color.accent,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  permBtnText: { color: color.onAccent, fontWeight: '600', fontSize: 15 },
  closeBtn: {
    backgroundColor: color.surface,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: color.border,
  },
  closeBtnText: { color: color.textPrimary, fontSize: 15 },
  closeLink: { marginTop: space[2] },
  closeLinkText: { color: color.textSecondary, fontSize: 14 },
});
