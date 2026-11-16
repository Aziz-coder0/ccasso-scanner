import React, { useEffect, useState } from "react";
import { ActivityIndicator, AppState, Linking, Platform, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { SafeAreaView } from "react-native-safe-area-context";
import { fetchLatestRelease, requiredAndroidUpdate } from "../api/releases";
import { Button, Icon, colors, createStyles, ui } from "./ScannerUI";

const repository = "Aziz-coder0/ccasso-scanner";
const cacheKey = `ccas_required_update:${repository}`;
const checkIntervalMs = 5 * 60 * 1000;
const installedVersion = Constants.expoConfig?.version;
const enabled = Platform.OS === "android" && !__DEV__ &&
  Constants.executionEnvironment !== "storeClient" &&
  process.env.EXPO_PUBLIC_CCASSO_GITHUB_UPDATES === "1" && !!installedVersion;

export default function RequiredUpdate({ children }) {
  const [checking, setChecking] = useState(enabled);
  const [update, setUpdate] = useState(null);
  const [opening, setOpening] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    let running = false;

    async function check(initial = false) {
      if (running) return;
      running = true;
      try {
        if (initial) {
          try {
            const cached = JSON.parse(await AsyncStorage.getItem(cacheKey));
            if (mounted) setUpdate(requiredAndroidUpdate(cached, installedVersion, repository));
          } catch (_) {}
        }
        const release = await fetchLatestRelease(repository);
        if (!mounted) return;
        const available = requiredAndroidUpdate(release, installedVersion, repository);
        setUpdate(available);
        try {
          if (available) {
            const { draft, prerelease, tag_name, assets } = release;
            await AsyncStorage.setItem(cacheKey, JSON.stringify({ draft, prerelease, tag_name, assets }));
          } else {
            await AsyncStorage.removeItem(cacheKey);
          }
        } catch (_) {}
      } catch (_) {
        // Keep the last verified decision when the connection is unavailable.
      } finally {
        running = false;
        if (mounted) setChecking(false);
      }
    }

    void check(true);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void check();
    }, checkIntervalMs);
    return () => {
      mounted = false;
      subscription.remove();
      clearInterval(timer);
    };
  }, []);

  async function download() {
    setOpening(true);
    setMessage("");
    try {
      await Linking.openURL(update.url);
    } catch (_) {
      setMessage("Could not open the download. Connect to the internet and try again.");
    } finally {
      setOpening(false);
    }
  }

  if (checking && !update) {
    return <View style={styles.checking}><ActivityIndicator color={colors.blue} accessibilityLabel="Checking for updates" /></View>;
  }
  if (!update) return children;
  return (
    <SafeAreaView style={styles.backdrop}>
      <View style={styles.dialog} accessibilityViewIsModal>
        <View style={styles.icon}><Icon name="sync" size={26} color={colors.blue} /></View>
        <Text style={styles.title} accessibilityRole="header">Update required</Text>
        <Text style={ui.body}>Install CCASSO Scanner {update.version} to continue. You’re currently on {installedVersion}.</Text>
        <Text style={styles.instructions}>Download the APK and install it over your current app to keep scan records and settings.</Text>
        <Button label="Download update" iconEnd="arrow" onPress={download} busy={opening} />
        {!!message && <Text style={styles.error} accessibilityLiveRegion="polite">{message}</Text>}
      </View>
    </SafeAreaView>
  );
}

const styles = createStyles({
  checking: { flex: 1, backgroundColor: colors.background, justifyContent: "center" },
  backdrop: { flex: 1, backgroundColor: "#e8eff8", alignItems: "center", justifyContent: "center", padding: 24 },
  dialog: { backgroundColor: colors.surface, width: "100%", maxWidth: 420, borderColor: colors.border, borderWidth: 1, padding: 24, borderRadius: 20, gap: 12 },
  icon: { alignItems: "center", justifyContent: "center", width: 48, height: 48, borderRadius: 14, backgroundColor: colors.blueSoft },
  title: { color: colors.navy, fontSize: 24, fontWeight: "700" },
  instructions: { color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 6 },
  error: { color: colors.red, fontSize: 13, lineHeight: 18 },
});
