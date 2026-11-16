import React, { useCallback, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity,
  Alert, ActivityIndicator, RefreshControl, Share, Modal, Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import NetInfo from "@react-native-community/netinfo";
import { BottomNav, Button, Icon, IconButton, colors, createStyles, localTime, ui } from "../components/ScannerUI";
import { loadConfig, loadLastSync, saveLastSync } from "../db/storage";
import {
  getQueue, queueAsBatchPayload, removeSynced, clearQueue, pendingCount,
  getFailed, failedAsBatchPayload, removeFailed, clearFailed, addFailed,
  acquireQueueSync, recordUploadedScans,
} from "../db/queue";
import {
  scanBatch, failReasonLabel, isAcceptedScanResult, isRetryableScanResult,
} from "../api/kiosk";
import { exportKioskBundle } from "../utils/exportXlsx";

function compactTime(value) {
  if (!value) return "Time unavailable";
  try { return localTime(value) || "Time unavailable"; } catch (_) { return String(value); }
}

function reviewGuidance(code) {
  switch (String(code || "").toUpperCase()) {
    case "SESSION_CLOSED":
    case "SESSION_NOT_FOUND":
      return { label: "Open Sessions", route: "Sessions", detail: "Ask the organizer to verify the correct session in UniOrg before scanning again." };
    case "STUDENT_NOT_FOUND":
    case "BAD_REQUEST":
    case "BAD_ITEM":
    case "INVALID_QR":
      return { label: "Open Sessions", route: "Sessions", detail: "Check the student’s attendance QR or enter their correct student number in the intended session." };
    case "NOT_ENROLLED_FOR_PERIOD":
      return { label: "Retry this scan", detail: "Ask a UniOrg administrator to verify the enrollment for this period before retrying." };
    default:
      return { label: "Retry this scan", detail: "Verify the session and student details in UniOrg before retrying." };
  }
}

export default function QueueScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [failed, setFailed] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("pending");
  const [lastSync, setLastSync] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedScan, setSelectedScan] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [queue, review, syncedAt] = await Promise.all([getQueue(), getFailed(), loadLastSync()]);
      setItems(queue);
      setFailed(review);
      setLastSync(syncedAt || "");
    } catch (error) {
      Alert.alert("Unable to load scans", error.message || String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  async function runSync(onlyFailed, uid = null) {
    const releaseSync = acquireQueueSync();
    if (!releaseSync) {
      Alert.alert("Sync in progress", "Wait for the current sync to finish, then try again.");
      return;
    }
    setBusy(true);
    try {
      const net = await NetInfo.fetch();
      if (!net.isConnected || net.isInternetReachable === false) {
        Alert.alert("Still offline", "Connect to the internet, then try syncing again.");
        return;
      }
      const cfg = await loadConfig();
      if (!cfg.baseUrl || !cfg.token) {
        Alert.alert("Setup required", "Connect this scanner to UniOrg first.");
        navigation.navigate("Setup");
        return;
      }
      const queue = onlyFailed ? await failedAsBatchPayload() : await queueAsBatchPayload();
      const scans = uid ? queue.filter((row) => row.client_uid === uid) : queue;
      if (!scans.length) {
        Alert.alert("Nothing to sync", onlyFailed ? "There are no failed scans." : "The pending queue is empty.");
        return;
      }

      try {
        const data = await scanBatch(cfg.baseUrl, cfg.token, scans, cfg.deviceId);
        const results = data.results || [];
        const acceptedIds = [];
        const accepted = [];
        const terminal = [];
        let retryableCount = 0;

        for (const [index, scan] of scans.entries()) {
          const result = results.find((row) => row.client_uid && row.client_uid === scan.client_uid)
            || results.find((row) => row.index === index)
            || results[index];
          if (isAcceptedScanResult(result)) {
            accepted.push({ scan, result });
            acceptedIds.push(scan.client_uid);
          } else if (!result || isRetryableScanResult(result)) {
            retryableCount += 1;
          } else {
            terminal.push({
              ...scan,
              code: result.code,
              error: failReasonLabel(result.code, result.message),
            });
          }
        }

        await recordUploadedScans(accepted);
        for (const row of terminal) await addFailed(row);
        if (onlyFailed) {
          // Keep rejected rows visible for correction; remove only rows UniOrg
          // explicitly accepted on this retry.
          await removeFailed(acceptedIds);
        } else {
          const terminalIds = terminal.map((row) => row.client_uid);
          await removeSynced([...acceptedIds, ...terminalIds]);
        }

        if (acceptedIds.length > 0) await saveLastSync(new Date().toISOString());
        await refresh();
        Alert.alert(
          "Sync complete",
          `Accepted: ${acceptedIds.length}\nNeeds review: ${terminal.length}\nRetry later: ${retryableCount}\nPending: ${await pendingCount()}`
        );
      } catch (e) {
        Alert.alert("Sync paused", `${e.message || String(e)}\n\nNo pending scan was deleted.`);
      }
    } catch (error) {
      Alert.alert("Unable to sync", error.message || String(error));
    } finally {
      releaseSync();
      setBusy(false);
    }
  }

  const guidance = selectedScan?.needsReview ? reviewGuidance(selectedScan.code) : null;

  function followGuidance() {
    setDetailOpen(false);
    if (guidance.route) navigation.navigate(guidance.route);
    else void runSync(true, selectedScan.client_uid);
  }

  async function shareQueueSummary() {
    const text =
      `UniOrg Scanner Sync Center\n` +
      `Pending: ${items.length}\nNeeds review: ${failed.length}\n\n` +
      items.slice(0, 50).map((item) => `• ${item.student_code} · Session ${item.session_id}`).join("\n") +
      (items.length > 50 ? `\n… and ${items.length - 50} more` : "");
    try { await Share.share({ message: text }); } catch (_) {}
  }

  async function exportQueue() {
    try {
      const cfg = await loadConfig();
      await exportKioskBundle({
        session: { id: "queue", title: "Offline queue export" },
        gate: cfg.gateLabel,
        operator: cfg.operatorName,
        pending: items,
        failed,
        history: [],
        online: true,
        stats: {},
      });
    } catch (e) {
      Alert.alert("Export failed", e.message || String(e));
    }
  }

  const rows = tab === "failed" ? failed : items;

  function clearRecords() {
    setMenuOpen(false);
    Alert.alert("Clear device records?", "Choose which local list to clear. This cannot undo attendance already synced to UniOrg.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear pending", style: "destructive", onPress: async () => { await clearQueue(); refresh(); } },
      { text: "Clear review", style: "destructive", onPress: async () => { await clearFailed(); refresh(); } },
    ]);
  }

  return (
    <SafeAreaView style={ui.root}>
      <View style={styles.header}>
        <View style={ui.headerRow}>
          <IconButton name="back" label="Back to sessions" onPress={() => navigation.navigate("Sessions")} disabled={busy} />
          <Text style={ui.screenTitle}>Sync Center</Text>
          <IconButton name="sync" label="Refresh sync center" onPress={refresh} disabled={busy || loading} />
          <IconButton name="more" label="More sync actions" onPress={() => setMenuOpen(true)} disabled={busy} />
        </View>
        <Text style={styles.heading}>Keep attendance in sync</Text>
        <Text style={[ui.body, styles.subtitle]}>Your scans are saved on this device.</Text>
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}><View style={styles.summaryIcon}><Icon name="cloudUpload" size={28} color={colors.orange} /></View><View style={styles.summaryCopy}><Text style={styles.summaryValue}>{items.length}</Text><Text style={styles.summaryLabel}>Pending upload</Text></View></View>
          <View style={styles.summaryCard}><View style={[styles.summaryIcon, styles.reviewIcon]}><Icon name="warning" size={28} color="#f96527" /></View><View style={styles.summaryCopy}><Text style={styles.summaryValue}>{failed.length}</Text><Text style={styles.summaryLabel}>Needs review</Text></View></View>
        </View>
        <View style={styles.info}><Icon name="info" size={18} color="#5b6f86" /><Text style={styles.infoText}>Pending scans await server verification.</Text></View>
        <View style={styles.tabs}>
          {[{ key: "pending", label: "Pending", count: items.length }, { key: "failed", label: "Needs review", count: failed.length }].map((item) => (
            <TouchableOpacity key={item.key} accessibilityRole="tab" accessibilityState={{ selected: tab === item.key }} style={[styles.tab, tab === item.key && styles.tabActive]} onPress={() => { setTab(item.key); setExpanded(false); }}>
              <Text style={[styles.tabText, tab === item.key && styles.tabTextActive]}>{item.label}</Text><View style={styles.countBadge}><Text style={styles.countText}>{item.count}</Text></View>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <FlatList
        data={expanded ? rows : rows.slice(0, 3)}
        keyExtractor={(item) => String(item.client_uid)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.blue} colors={[colors.blue]} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<View style={styles.empty}><Icon name={tab === "failed" ? "shield" : "check"} size={34} color={colors.green} /><Text style={styles.emptyTitle}>{tab === "failed" ? "No scan needs review" : "Everything is synced"}</Text><Text style={styles.emptyText}>{tab === "failed" ? "Rejected scans appear here with a clear reason." : "Offline scans are uploaded when a connection is available."}</Text></View>}
        ListFooterComponent={rows.length > 3 ? <TouchableOpacity accessibilityRole="button" onPress={() => setExpanded(!expanded)} style={styles.showMore}><Icon name="down" size={16} color={colors.muted} /><Text style={styles.showMoreText}>{expanded ? "Show fewer scans" : `${rows.length - 3} more ${tab === "failed" ? (rows.length === 4 ? "scan to review" : "scans to review") : (rows.length === 4 ? "pending scan" : "pending scans")}`}</Text></TouchableOpacity> : null}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} accessibilityRole="button" accessibilityLabel={`View scan ${item.student_code}`} onPress={() => { setSelectedScan({ ...item, needsReview: tab === "failed" }); setDetailOpen(true); }}>
            <View style={[styles.rowIcon, tab === "failed" && styles.reviewIcon]}><Icon name={tab === "failed" ? "warning" : "clock"} size={25} color={tab === "failed" ? colors.red : colors.muted} /></View>
            <View style={styles.rowCopy}><Text style={styles.studentCode} numberOfLines={1}>{item.student_code}</Text><Text style={styles.rowMeta}>Session #{item.session_id} · {compactTime(item.scanned_at)}</Text>{!!item.error && <Text style={styles.rowError}>{item.error}</Text>}</View>
            <View style={[styles.waitingBadge, tab === "failed" && styles.reviewIcon]}><Text style={[styles.waitingText, tab === "failed" && { color: colors.red }]}>{tab === "failed" ? "Review" : "Waiting"}</Text></View>
            <Icon name="chevron" size={14} color={colors.muted} />
          </TouchableOpacity>
        )}
      />
      <View style={styles.actions}>
        <Button label={tab === "failed" ? "Retry reviewed scans" : "Sync all pending"} icon="sync" onPress={() => runSync(tab === "failed")} busy={busy} disabled={!rows.length} />
        <Button secondary label="Export records" icon="upload" onPress={exportQueue} disabled={busy} style={styles.export} />
        <Text style={styles.lastSync}>{lastSync ? `Last synced at ${localTime(lastSync)}` : "No scans synced from this device yet"}</Text>
      </View>
      <BottomNav navigation={navigation} active="Queue" pending={items.length} disabled={busy} />
      <Modal visible={detailOpen} transparent animationType="slide" onRequestClose={() => setDetailOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setDetailOpen(false)}><Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.sheetTitle}>Scan details</Text>
          <Text style={styles.detailCode}>{selectedScan?.student_code}</Text>
          <Text style={styles.detailMeta}>Session #{selectedScan?.session_id} · {compactTime(selectedScan?.scanned_at)}</Text>
          <View style={[styles.detailNotice, selectedScan?.needsReview && styles.reviewIcon]}><Text style={[styles.detailNoticeText, selectedScan?.needsReview && { color: colors.red }]}>{selectedScan?.needsReview ? selectedScan.error || "This scan needs review before it can be accepted." : "Saved on this device. Attendance is pending UniOrg verification."}</Text></View>
          {guidance && <>
            <Text style={ui.body}>{guidance.detail}</Text>
            <Button label={guidance.label} onPress={followGuidance} disabled={busy} />
          </>}
          <Button label="Close details" secondary onPress={() => setDetailOpen(false)} />
        </Pressable></Pressable>
      </Modal>
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)}><Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.sheetTitle}>Sync actions</Text>
          <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); shareQueueSummary(); }}><Text style={styles.menuText}>Share queue summary</Text></TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={clearRecords}><Text style={[styles.menuText, { color: colors.red }]}>Clear device records</Text></TouchableOpacity>
          <Button label="Close" secondary onPress={() => setMenuOpen(false)} />
        </Pressable></Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = createStyles({
  header: { paddingHorizontal: 20, paddingTop: 4 },
  heading: { color: colors.navy, fontSize: 23, fontWeight: "700", letterSpacing: -0.4, marginTop: 18 },
  subtitle: { marginTop: 4 },
  summaryRow: { flexDirection: "row", gap: 10, marginTop: 17 },
  summaryCard: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 15, flexDirection: "row", alignItems: "center", paddingHorizontal: 11, paddingVertical: 17, gap: 9, backgroundColor: colors.surface },
  summaryIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#fff5e7", alignItems: "center", justifyContent: "center" },
  reviewIcon: { backgroundColor: "#fff1eb" },
  summaryCopy: { flex: 1 },
  summaryValue: { color: colors.navy, fontSize: 24, fontWeight: "800" },
  summaryLabel: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  info: { backgroundColor: colors.graySoft, borderRadius: 11, flexDirection: "row", alignItems: "center", gap: 9, padding: 11, marginTop: 10 },
  infoText: { flex: 1, color: colors.muted, fontSize: 11, lineHeight: 16 },
  tabs: { flexDirection: "row", backgroundColor: colors.graySoft, borderRadius: 11, marginTop: 16, marginBottom: 7 },
  tab: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 4, borderRadius: 10 },
  tabActive: { backgroundColor: colors.blue },
  tabText: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  tabTextActive: { color: "white" },
  countBadge: { minWidth: 19, height: 19, paddingHorizontal: 5, backgroundColor: colors.orange, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  countText: { color: "white", fontSize: 11, fontWeight: "600" },
  list: { paddingHorizontal: 20, paddingBottom: 12 },
  row: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, minHeight: 72, padding: 11, backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", gap: 11, marginBottom: 2 },
  rowIcon: { width: 42, height: 42, borderRadius: 22, backgroundColor: colors.graySoft, alignItems: "center", justifyContent: "center" },
  rowCopy: { flex: 1 },
  studentCode: { color: colors.navy, fontSize: 14, fontWeight: "700" },
  rowMeta: { color: colors.muted, fontSize: 11, marginTop: 5 },
  rowError: { color: colors.red, fontSize: 11, lineHeight: 16, marginTop: 5 },
  waitingBadge: { backgroundColor: colors.amberSoft, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  waitingText: { color: "#c56800", fontSize: 10, fontWeight: "500" },
  showMore: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 43 },
  showMoreText: { color: colors.muted, fontSize: 11 },
  actions: { paddingHorizontal: 20, paddingBottom: 13, paddingTop: 6 },
  export: { marginTop: 8 },
  lastSync: { color: colors.muted, fontSize: 11, textAlign: "center", marginTop: 12 },
  empty: { alignItems: "center", paddingHorizontal: 10, paddingVertical: 30 },
  emptyTitle: { color: colors.navy, fontSize: 17, fontWeight: "700", marginTop: 12 },
  emptyText: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 8 },
  backdrop: { flex: 1, backgroundColor: "rgba(7,22,56,0.3)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 36 },
  sheetTitle: { color: colors.navy, fontWeight: "800", fontSize: 21, marginBottom: 10 },
  menuItem: { paddingVertical: 18, borderBottomWidth: 1, borderColor: colors.border, marginBottom: 10 },
  menuText: { color: colors.navy, fontSize: 15 },
  detailCode: { color: colors.navy, fontSize: 20, fontWeight: "700", marginTop: 12 },
  detailMeta: { color: colors.muted, fontSize: 12, marginTop: 6 },
  detailNotice: { padding: 14, backgroundColor: colors.amberSoft, borderRadius: 12, marginVertical: 18 },
  detailNoticeText: { color: "#ad6000", fontSize: 13, lineHeight: 20 },
});
