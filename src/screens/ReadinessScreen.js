import React, { useCallback, useEffect, useState } from "react";
import { Alert, Linking, ScrollView, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useIsFocused } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { fetchRoster, ping } from "../api/kiosk";
import { Button, Icon, IconButton, colors, createStyles, ui } from "../components/ScannerUI";
import { pendingCount } from "../db/queue";
import { rosterMeta, saveRoster } from "../db/roster";
import { loadActiveSession, loadConfig } from "../db/storage";

export default function ReadinessScreen({ navigation }) {
  const isFocused = useIsFocused();
  const [, requestPermission, getPermission] = useCameraPermissions();
  const [preview, setPreview] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [server, setServer] = useState("Checking connection…");
  const [reachable, setReachable] = useState(false);
  const [roster, setRoster] = useState(null);
  const [session, setSession] = useState(null);
  const [pending, setPending] = useState(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    setServer("Checking connection…");
    setReachable(false);
    async function checkServer() {
      try {
        const { baseUrl, token } = await loadConfig();
        if (!baseUrl || !token) {
          setServer("Connect the scanner in Setup.");
          return;
        }
        await ping(baseUrl, token);
        setServer("UniOrg accepted this scanner’s credentials.");
        setReachable(true);
      } catch (error) {
        setServer([401, 403].includes(error.status) ? "Check the scanner token in Setup." : "UniOrg could not be reached.");
      }
    }
    await Promise.allSettled([
      checkServer(),
      rosterMeta().then(setRoster),
      loadActiveSession().then(setSession),
      pendingCount().then(setPending),
    ]);
    setChecking(false);
  }, []);

  useEffect(() => { if (isFocused) void check(); }, [check, isFocused]);

  async function testCamera() {
    setCameraReady(false);
    setCameraError("");
    try {
      const permission = await getPermission();
      if (!permission.granted && !permission.canAskAgain) {
        await Linking.openSettings();
        return;
      }
      const access = permission?.granted ? permission : await requestPermission();
      setPreview(access.granted);
      if (!access.granted) setCameraError("Camera access is needed to run this check.");
    } catch (_) {
      setCameraError("Could not open camera settings.");
    }
  }

  async function refreshRoster() {
    setDownloading(true);
    try {
      const { baseUrl, token } = await loadConfig();
      if (!baseUrl || !token) throw new Error("Connect the scanner in Setup first.");
      const response = await fetchRoster(baseUrl, token);
      await saveRoster(response.students || []);
      setRoster(await rosterMeta());
    } catch (error) {
      Alert.alert("Roster refresh failed", error.message);
    } finally {
      setDownloading(false);
    }
  }

  const rosterDate = roster?.at ? new Date(roster.at) : null;
  const updatedAt = rosterDate && !Number.isNaN(rosterDate.getTime())
    ? rosterDate.toLocaleString() : "";
  const hasRoster = Number(roster?.count) > 0;

  return (
    <SafeAreaView style={ui.root}>
      <View style={[ui.headerRow, styles.header]}>
        <IconButton name="back" label="Back to sessions" onPress={() => navigation.goBack()} />
        <Text style={ui.screenTitle}>Ready Check</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <ReadinessRow label="Camera" ok={cameraReady} detail={cameraError || (cameraReady ? "Rear camera is working." : "Open the rear camera to check the preview.")} />
        {isFocused && preview && !cameraError && (
          <View style={styles.preview}>
            <CameraView style={styles.camera} facing="back" onCameraReady={() => setCameraReady(true)} onMountError={() => setCameraError("The rear camera could not start.")} />
          </View>
        )}
        <Button secondary label={preview && !cameraError ? "Close preview" : "Test camera"} icon="scan" onPress={preview && !cameraError ? () => setPreview(false) : testCamera} />
        <ReadinessRow label="UniOrg" ok={reachable} detail={server} />
        <ReadinessRow label="Offline roster" ok={hasRoster} detail={hasRoster ? `${Number(roster.count).toLocaleString()} students · Updated ${updatedAt || "at an unknown time"}` : "Download the student roster for offline lookup."} />
        <Button secondary label="Refresh roster" icon="sync" onPress={refreshRoster} busy={downloading} disabled={checking} />
        <ReadinessRow label="Saved session" ok={!!session?.id} detail={session?.id ? session.title || session.session_name || `Session #${session.id}` : "Choose an open session while connected to UniOrg."} />
        <ReadinessRow label="Pending uploads" ok={pending === 0} detail={pending == null ? "Checking device queue…" : pending ? `${pending} waiting to sync on this device.` : "Device queue is empty."} />
        <Button label="Check again" onPress={check} busy={checking} disabled={downloading} />
      </ScrollView>
    </SafeAreaView>
  );
}

function ReadinessRow({ label, ok, detail }) {
  return (
    <View style={styles.row} accessibilityLiveRegion="polite">
      <View style={[styles.badge, ok && styles.badgeReady]}>
        <Icon name={ok ? "check" : "info"} color={ok ? colors.green : colors.muted} size={19} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.detail}>{detail}</Text>
      </View>
    </View>
  );
}

const styles = createStyles({
  header: { paddingHorizontal: 12 },
  content: { padding: 20, gap: 12 },
  row: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  badge: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.graySoft },
  badgeReady: { backgroundColor: colors.greenSoft },
  copy: { flex: 1 },
  label: { color: colors.navy, fontSize: 14, fontWeight: "700" },
  detail: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 3 },
  preview: { height: 180, borderRadius: 14, overflow: "hidden", backgroundColor: colors.navy },
  camera: { flex: 1 },
});
