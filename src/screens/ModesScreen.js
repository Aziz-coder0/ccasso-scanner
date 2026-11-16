import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import NetInfo from "@react-native-community/netinfo";
import { Brand, BottomNav, Icon, colors, createStyles, ui } from "../components/ScannerUI";
import { loadConfig } from "../db/storage";
import { pendingCount } from "../db/queue";

const MODES = [
  { id: "attendance", title: "Attendance", icon: "calendar", label: "ONLINE + OFFLINE", description: "Record student attendance for an open session.", action: "Choose a session", color: colors.blue, soft: colors.blueSoft },
  { id: "membership", title: "Membership", icon: "shield", label: "LIVE VERIFICATION", description: "Check the member's identity, academic year and current validity.", action: "Verify membership", color: "#a85800", soft: colors.amberSoft },
  { id: "enrollment", title: "Enrollment fee", icon: "file", label: "LIVE VERIFICATION", description: "Validate a receipt and confirm full payment for the selected academic year.", action: "Verify enrollment fee", color: "#1552a8", soft: "#e9f0ff" },
];

function networkStatus(state) {
  if (state.isConnected === false || state.isInternetReachable === false) return false;
  if (state.isConnected === true && state.isInternetReachable === true) return true;
  return null;
}

export default function ModesScreen({ navigation }) {
  const [config, setConfig] = useState(null);
  const [online, setOnline] = useState(null);
  const [pending, setPending] = useState(null);
  const [refreshing, setRefreshing] = useState(true);
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => NetInfo.addEventListener((state) => setOnline(networkStatus(state))), []);

  useFocusEffect(useCallback(() => {
    let active = true;
    setRefreshing(true);
    setNotice("");
    (async () => {
      const results = await Promise.allSettled([loadConfig(), pendingCount(), NetInfo.fetch()]);
      if (!active) return;
      const [configResult, queueResult, networkResult] = results;
      if (configResult.status === "fulfilled") {
        const saved = configResult.value;
        if (!saved.baseUrl || !saved.token) {
          navigation.replace("Setup");
          return;
        }
        setConfig(saved);
      } else {
        setNotice("Device setup could not be loaded. Pull down to retry or open Setup.");
      }
      if (queueResult.status === "fulfilled") setPending(queueResult.value);
      else setPending(null);
      if (networkResult.status === "fulfilled") setOnline(networkStatus(networkResult.value));
      setRefreshing(false);
    })();
    return () => { active = false; };
  }, [navigation, reload]));

  function openMode(mode) {
    if (!config) return;
    if (mode === "attendance") navigation.navigate("Sessions");
    else navigation.navigate("Verification", { mode });
  }

  const connectionLabel = online === null ? "Checking network" : online ? "Online" : "Offline";
  const connectionColor = online === null ? colors.muted : online ? colors.green : "#a85800";
  const connectionSoft = online === null ? colors.graySoft : online ? colors.greenSoft : colors.amberSoft;

  return (
    <SafeAreaView style={ui.root}>
      <View style={styles.header}>
        <Brand />
        <View testID="modes-connection" accessibilityLabel={`Network: ${connectionLabel}`} style={[styles.connection, { backgroundColor: connectionSoft }]}>
          {online === null ? <ActivityIndicator size="small" color={colors.muted} /> : <View style={[ui.dot, { backgroundColor: online ? colors.green : colors.orange }]} />}
          <Text style={[styles.connectionText, { color: connectionColor }]}>{connectionLabel}</Text>
        </View>
      </View>
      <ScrollView
        testID="scanner-modes"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => setReload((value) => value + 1)} tintColor={colors.blue} colors={[colors.blue]} />}
      >
        <Text style={styles.eyebrow}>SCAN & VERIFY</Text>
        <Text style={ui.heading}>Choose a scanner</Text>
        <Text style={[ui.body, styles.subtitle]}>Attendance, membership and enrollment fees in one connected device.</Text>
        <View style={styles.deviceRow}><Icon name="pin" size={16} color={colors.muted} /><Text style={styles.deviceText}>{config ? `${config.gateLabel} · ${config.deviceId}` : "Loading device setup…"}</Text></View>

        <TouchableOpacity testID="modes-attendance-queue" style={styles.queueCard} accessibilityRole="button" accessibilityLabel={pending === null ? "View attendance sync status" : `${pending} attendance uploads pending. Open Sync Center`} onPress={() => navigation.navigate("Queue")}>
          <View style={[styles.queueIcon, { backgroundColor: pending > 0 ? colors.amberSoft : colors.graySoft }]}><Icon name="cloudUpload" size={22} color={pending > 0 ? colors.orange : colors.blue} /></View>
          <View style={styles.queueCopy}><Text style={styles.queueTitle}>{pending === null ? "Attendance sync status" : pending > 0 ? `${pending} ${pending === 1 ? "attendance scan" : "attendance scans"} pending` : "No attendance uploads pending"}</Text><Text style={styles.queueText}>{pending === null ? "Open Sync Center for queue details" : "View uploads and scans that need review"}</Text></View>
          <Icon name="chevron" size={17} color={colors.muted} />
        </TouchableOpacity>

        {!!notice && <View style={styles.notice}><Icon name="info" size={17} color={colors.muted} /><Text style={styles.noticeText}>{notice}</Text></View>}
        {MODES.map((mode) => (
          <TouchableOpacity
            key={mode.id}
            testID={`mode-${mode.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${mode.title}. ${mode.description} ${mode.id === "attendance" ? "Supports saved sessions offline." : "Internet required."}`}
            accessibilityState={{ disabled: !config }}
            disabled={!config}
            onPress={() => openMode(mode.id)}
            activeOpacity={0.8}
            style={[styles.modeCard, !config && ui.disabled]}
          >
            <View style={styles.cardTop}>
              <View style={[styles.modeIcon, { backgroundColor: mode.soft }]}><Icon name={mode.icon} size={26} color={mode.color} /></View>
              <View style={styles.cardHeading}><Text style={styles.modeTitle}>{mode.title}</Text><Text style={[styles.modeLabel, { color: mode.color }]}>{mode.label}</Text></View>
              <Icon name="chevron" size={18} color={colors.muted} />
            </View>
            <Text style={styles.modeDescription}>{mode.description}</Text>
            <View style={styles.cardFooter}><Text style={[styles.action, { color: mode.color }]}>{mode.action}</Text><View style={styles.capability}><View style={[styles.smallDot, { backgroundColor: mode.id === "attendance" ? colors.blue : colors.orange }]} /><Text style={styles.capabilityText}>{mode.id === "attendance" ? "Session required" : "Internet required"}</Text></View></View>
          </TouchableOpacity>
        ))}

        <View style={styles.info}><Icon name="shield" size={20} color={colors.blue} /><Text style={styles.infoText}>{online === false ? "You are offline. Attendance can use a saved session and roster. Reconnect to verify memberships or enrollment receipts." : "Membership and enrollment checks use live UniOrg records. They do not record attendance or enter the offline queue."}</Text></View>
        <Text style={styles.footer}>One Admin-issued API token connects all three modes.</Text>
      </ScrollView>
      <BottomNav navigation={navigation} active="Modes" pending={pending || 0} />
    </SafeAreaView>
  );
}

const styles = createStyles({
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  connection: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20 },
  connectionText: { fontSize: 11, fontWeight: "600" },
  content: { paddingHorizontal: 20, paddingBottom: 22 },
  eyebrow: { color: colors.blue, fontSize: 10, fontWeight: "700", letterSpacing: 1.5, marginBottom: 7 },
  subtitle: { marginTop: 7 },
  deviceRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 13, marginBottom: 19 },
  deviceText: { flex: 1, fontSize: 11, color: colors.muted },
  queueCard: { flexDirection: "row", alignItems: "center", padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.surface, gap: 10, marginBottom: 19 },
  queueIcon: { width: 39, height: 39, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  queueCopy: { flex: 1 },
  queueTitle: { color: colors.navy, fontSize: 12, lineHeight: 17, fontWeight: "700" },
  queueText: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  modeCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 20, padding: 17, marginBottom: 13 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  modeIcon: { width: 49, height: 49, alignItems: "center", justifyContent: "center", borderRadius: 15 },
  cardHeading: { flex: 1 },
  modeTitle: { color: colors.navy, fontSize: 18, fontWeight: "800", letterSpacing: -0.5 },
  modeLabel: { fontSize: 8, fontWeight: "700", letterSpacing: 0.7, marginTop: 5 },
  modeDescription: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 12, marginBottom: 13 },
  cardFooter: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  action: { fontSize: 11, fontWeight: "700" },
  capability: { flexDirection: "row", alignItems: "center", gap: 5 },
  smallDot: { width: 5, height: 5, borderRadius: 3 },
  capabilityText: { color: colors.muted, fontSize: 9 },
  info: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 13, borderRadius: 13, backgroundColor: colors.blueSoft, marginTop: 2 },
  infoText: { flex: 1, color: colors.muted, fontSize: 11, lineHeight: 17 },
  footer: { textAlign: "center", color: colors.muted, fontSize: 10, lineHeight: 16, marginTop: 16 },
  notice: { flexDirection: "row", gap: 8, padding: 12, backgroundColor: colors.graySoft, borderRadius: 12, marginBottom: 14 },
  noticeText: { flex: 1, color: colors.muted, fontSize: 11, lineHeight: 17 },
});
