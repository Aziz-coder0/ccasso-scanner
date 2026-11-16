import React, { useCallback, useState } from "react";
import { View, Text, FlatList, TouchableOpacity, RefreshControl, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import NetInfo from "@react-native-community/netinfo";
import { Brand, BottomNav, Button, ConnectionBadge, Icon, IconButton, MetricStrip, colors, createStyles, sessionDate, ui } from "../components/ScannerUI";
import { loadConfig, saveActiveSession, loadActiveSession } from "../db/storage";
import { fetchOpenSessions, fetchRoster } from "../api/kiosk";
import { saveRoster, rosterMeta } from "../db/roster";
import { pendingCount } from "../db/queue";

export default function SessionsScreen({ navigation }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(0);
  const [rosterCount, setRosterCount] = useState(0);
  const [cfg, setCfg] = useState(null);
  const [online, setOnline] = useState(null);
  const [notice, setNotice] = useState("");
  const [rosterBusy, setRosterBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setNotice("");
    try {
      const c = await loadConfig();
      setCfg(c);
      if (!c.baseUrl || !c.token) {
        navigation.replace("Setup");
        return;
      }

      const net = await NetInfo.fetch();
      const reachable = !!(net.isConnected && net.isInternetReachable !== false);
      setOnline(reachable);
      const active = await loadActiveSession();

      if (reachable) {
        try {
          const list = await fetchOpenSessions(c.baseUrl, c.token);
          setSessions(list);
          try {
            const cached = await rosterMeta();
            const age = cached?.at ? Date.now() - new Date(cached.at).getTime() : Infinity;
            if (!Number.isFinite(age) || age >= 5 * 60 * 1000) {
              const ros = await fetchRoster(c.baseUrl, c.token);
              await saveRoster(ros.students || []);
            }
          } catch (rosterError) {
            setNotice(`Sessions loaded, but roster download failed: ${rosterError.message || "please retry"}`);
          }
        } catch (error) {
          setOnline(false);
          if (active?.id) {
            setSessions([active]);
            setNotice("Server unavailable · showing the last active session for offline scanning");
          } else {
            setSessions([]);
            setNotice(error.message || "Cannot reach UniOrg right now");
          }
        }
      } else if (active?.id) {
        setSessions([active]);
        setNotice("Offline mode · showing the last active session saved on this device");
      } else {
        setSessions([]);
        setNotice("Connect once to download an open session and student roster");
      }

      const meta = await rosterMeta();
      setRosterCount(Number(meta.count || 0));
      setPending(await pendingCount());
    } catch (e) {
      Alert.alert("Unable to load sessions", e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [navigation]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function pick(session) {
    await saveActiveSession(session);
    navigation.navigate("Scanner", { session });
  }

  async function downloadRosterNow() {
    if (rosterBusy) return;
    setRosterBusy(true);
    try {
      const c = cfg || await loadConfig();
      const net = await NetInfo.fetch();
      if (!net.isConnected || net.isInternetReachable === false) {
        throw new Error("Connect to the internet once to refresh the offline roster.");
      }
      const response = await fetchRoster(c.baseUrl, c.token);
      const count = await saveRoster(response.students || []);
      setRosterCount(count);
      setNotice("");
      Alert.alert("Roster ready", `${count} students are available for online and offline scanning.`);
    } catch (error) {
      Alert.alert("Roster download failed", error.message || String(error));
    } finally {
      setRosterBusy(false);
    }
  }

  return (
    <SafeAreaView style={ui.root}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Brand />
          <View style={styles.headerActions}>
            <ConnectionBadge online={online} />
            <IconButton name="settings" label="Scanner setup" onPress={() => navigation.navigate("Setup")} />
          </View>
        </View>
        <Text style={ui.heading}>Sessions</Text>
        <Text style={[ui.body, styles.subtitle]}>Choose a session to start scanning</Text>
        <View style={styles.deviceRow}>
          <Icon name="pin" size={17} color={colors.muted} />
          <Text style={styles.device}>{cfg?.gateLabel || "Gate A"} · {cfg?.deviceId || "Scanner device"}</Text>
        </View>
        <MetricStrip bordered metrics={[
          { value: sessions.length, label: "Open" },
          { value: pending, label: "Pending", warning: pending > 0, onPress: () => navigation.navigate("Queue") },
          { value: rosterCount.toLocaleString(), label: "Roster", onPress: downloadRosterNow },
        ]} />
      </View>
      {!!notice && <View style={styles.notice}><Icon name="info" size={16} color={colors.muted} /><Text style={styles.noticeText}>{notice}</Text></View>}
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>{online ? "Open sessions" : "Saved session"}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh sessions" onPress={load} disabled={loading} style={styles.refresh}>
          {loading ? <ActivityIndicator size="small" color={colors.blue} /> : <Icon name="sync" size={16} color={colors.blue} />}
          <Text style={styles.refreshText}>Refresh</Text>
        </TouchableOpacity>
      </View>
      {loading && !sessions.length ? (
        <View style={styles.loading}><ActivityIndicator color={colors.blue} size="large" /><Text style={styles.emptyText}>Connecting to UniOrg…</Text></View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.blue} colors={[colors.blue]} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<View style={styles.empty}><Icon name="calendar" size={36} color={colors.muted} /><Text style={styles.emptyTitle}>No session available</Text><Text style={styles.emptyText}>Open a session in UniOrg, then refresh.</Text></View>}
          renderItem={({ item, index }) => {
            const details = (
              <View style={styles.cardRow}>
                <View style={[styles.calendar, index === 0 && styles.calendarPrimary]}><Icon name="calendar" size={25} color={colors.blue} filled /></View>
                <View style={styles.cardCopy}>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.cardTitle} numberOfLines={2}>{item.title || item.session_name || `Session #${item.id}`}</Text>
                    <View style={[styles.openBadge, !online && styles.savedBadge]}><Text style={[styles.openText, !online && { color: "#a85800" }]}>{online ? "Open" : "Saved"}</Text></View>
                  </View>
                  <Text style={styles.cardMeta}>{sessionDate(item.session_date)}{item.start_time ? ` · ${item.start_time}` : item.activity_type ? ` · ${item.activity_type}` : ""}</Text>
                  <Text style={styles.sessionId}>Session #{item.id}</Text>
                </View>
                {index > 0 && <Icon name="chevron" size={18} color={colors.muted} />}
              </View>
            );
            return index === 0 ? (
              <View style={[styles.card, styles.primaryCard]}>
                {details}
                <Button label="Start scanning" iconEnd="arrow" onPress={() => pick(item)} style={styles.startButton} />
                <TouchableOpacity style={styles.totalsLink} accessibilityRole="button" onPress={() => navigation.navigate("SessionTotals", { session: item })}>
                  <Text style={styles.totalsText}>View live totals</Text>
                  <Icon name="chevron" size={16} color={colors.blue} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.card} onPress={() => pick(item)} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={`Scan ${item.title || item.session_name || "session"}`}>{details}</TouchableOpacity>
            );
          }}
        />
      )}
      <TouchableOpacity style={[styles.roster, !rosterCount && styles.rosterMissing]} onPress={() => navigation.navigate("Readiness")} accessibilityRole="button" accessibilityLabel="Open Ready Check">
        <View style={styles.rosterIcon}><Icon name="shield" size={25} color={rosterCount ? colors.green : colors.orange} /></View>
        <View style={styles.rosterCopy}><Text style={styles.rosterTitle}>{rosterBusy ? "Downloading roster…" : rosterCount ? "Roster ready for offline use" : "Offline roster needed"}</Text><Text style={styles.rosterText}>Ready Check · Camera, UniOrg and roster</Text></View>
        <Icon name="chevron" size={17} color={colors.muted} />
      </TouchableOpacity>
      <BottomNav navigation={navigation} active="Sessions" pending={pending} />
    </SafeAreaView>
  );
}

const styles = createStyles({
  header: { paddingHorizontal: 20, paddingTop: 8 },
  brandRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  subtitle: { marginTop: 4 },
  deviceRow: { flexDirection: "row", gap: 6, alignItems: "center", marginTop: 14, marginBottom: 14 },
  device: { color: colors.muted, fontSize: 13, flex: 1 },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: 20, marginTop: 12, marginBottom: 5 },
  sectionTitle: { color: colors.navy, fontSize: 16, fontWeight: "700" },
  refresh: { minHeight: 44, flexDirection: "row", gap: 6, alignItems: "center", paddingLeft: 8 },
  refreshText: { fontSize: 12, color: colors.blue, fontWeight: "500" },
  list: { paddingHorizontal: 20, paddingBottom: 10 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 14, marginBottom: 10, backgroundColor: colors.surface },
  primaryCard: { backgroundColor: colors.blueSoft, borderColor: "#d4e5ff" },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 11 },
  calendar: { width: 45, height: 45, borderRadius: 24, backgroundColor: "#e8f2ff", alignItems: "center", justifyContent: "center" },
  calendarPrimary: { width: 51, height: 51, borderRadius: 27, backgroundColor: "#d6e8ff" },
  cardCopy: { flex: 1 },
  cardTitleRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  cardTitle: { flex: 1, color: colors.navy, fontSize: 15, lineHeight: 20, fontWeight: "700", letterSpacing: -0.3 },
  cardMeta: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  sessionId: { color: colors.muted, fontSize: 11, marginTop: 3 },
  openBadge: { backgroundColor: "#d4f4df", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  savedBadge: { backgroundColor: colors.amberSoft },
  openText: { color: "#086529", fontSize: 10, fontWeight: "600" },
  startButton: { marginTop: 13 },
  totalsLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, minHeight: 44, marginBottom: -6 },
  totalsText: { color: colors.blue, fontSize: 13, fontWeight: "600" },
  roster: { marginHorizontal: 20, marginBottom: 12, marginTop: 6, padding: 13, borderRadius: 13, backgroundColor: colors.greenSoft, flexDirection: "row", alignItems: "center", gap: 10 },
  rosterMissing: { backgroundColor: colors.amberSoft },
  rosterIcon: { width: 29, alignItems: "center" },
  rosterCopy: { flex: 1 },
  rosterTitle: { color: colors.navy, fontSize: 12, fontWeight: "700" },
  rosterText: { color: colors.muted, fontSize: 11, marginTop: 3, lineHeight: 15 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  empty: { alignItems: "center", paddingVertical: 30, paddingHorizontal: 15 },
  emptyTitle: { fontSize: 17, color: colors.navy, fontWeight: "700", marginTop: 12 },
  emptyText: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 8 },
  notice: { flexDirection: "row", alignItems: "center", gap: 8, padding: 11, backgroundColor: colors.graySoft, borderRadius: 10, marginHorizontal: 20, marginTop: 12 },
  noticeText: { flex: 1, color: colors.muted, fontSize: 11, lineHeight: 16 },
});
