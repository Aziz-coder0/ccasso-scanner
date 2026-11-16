import React, { useCallback, useState } from "react";
import { AppState, RefreshControl, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { fetchSessionStats } from "../api/kiosk";
import { Icon, IconButton, MetricStrip, colors, createStyles, localTime, ui } from "../components/ScannerUI";
import { getQueue } from "../db/queue";
import { loadConfig } from "../db/storage";

export default function SessionTotalsScreen({ navigation, route }) {
  const { session } = route.params;
  const [snapshot, setSnapshot] = useState(null);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const queue = await getQueue();
      setPending(queue.filter((row) => String(row.session_id) === String(session.id)).length);
      const { baseUrl, token } = await loadConfig();
      const stats = await fetchSessionStats(baseUrl, token, session.id);
      if (stats?.success === false || stats?.present == null || stats?.late == null ||
          ![stats.present, stats.late].map(Number).every((n) => Number.isSafeInteger(n) && n >= 0)) {
        throw new Error("Session totals are unavailable.");
      }
      const present = Number(stats.present);
      const late = Number(stats.late);
      setSnapshot({ present, late, at: new Date().toISOString() });
      setError("");
    } catch (_) {
      setError("Could not refresh totals from UniOrg.");
    } finally {
      setLoading(false);
    }
  }, [session.id]);

  useFocusEffect(useCallback(() => {
    void refresh();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void refresh();
    }, 30000);
    return () => clearInterval(timer);
  }, [refresh]));

  return (
    <SafeAreaView style={ui.root}>
      <View style={[ui.headerRow, styles.header]}>
        <IconButton name="back" label="Back" onPress={() => navigation.goBack()} />
        <Text style={ui.screenTitle}>Live session totals</Text>
        <IconButton name="sync" label="Refresh session totals" onPress={refresh} disabled={loading} />
      </View>
      <ScrollView contentContainerStyle={styles.body} refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.blue} colors={[colors.blue]} />}>
        <Text style={ui.heading}>{session.title || session.session_name || `Session #${session.id}`}</Text>
        <Text style={ui.body}>Confirmed across all gates · Session #{session.id}</Text>
        <MetricStrip bordered metrics={[
          { value: snapshot?.present ?? "—", label: "Present" },
          { value: snapshot?.late ?? "—", label: "Late" },
          { value: snapshot ? snapshot.present + snapshot.late : "—", label: "Confirmed", labelColor: colors.green },
        ]} />
        {!!snapshot && <Text style={styles.updated}>Last updated at {localTime(snapshot.at)}</Text>}
        {!!error && <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>}
        <View style={styles.device}>
          <Icon name="clock" color={colors.muted} />
          <Text style={ui.body}>{pending ?? "—"} pending on this device</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = createStyles({
  header: { paddingHorizontal: 12 },
  body: { padding: 20, gap: 12 },
  updated: { color: colors.muted, fontSize: 12 },
  error: { color: colors.red, fontSize: 13 },
  device: { backgroundColor: colors.graySoft, borderRadius: 12, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 },
});
