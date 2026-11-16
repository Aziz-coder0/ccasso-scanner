import React, { useCallback, useState } from "react";
import { FlatList, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { IconButton, colors, createStyles, localTime, ui } from "../components/ScannerUI";
import { getFailed, getHistory, getQueue } from "../db/queue";

const statuses = {
  PRESENT: { label: "Present", color: colors.green },
  LATE: { label: "Late", color: colors.green },
  CONFIRMED: { label: "Confirmed", color: colors.green },
  ALREADY: { label: "Already marked", color: colors.muted },
  QUEUED: { label: "Pending", color: "#a85800" },
  REVIEW: { label: "Needs review", color: colors.red },
  ERROR: { label: "Rejected", color: colors.red },
};

export default function ScanHistoryScreen({ navigation, route }) {
  const sessionId = route.params?.sessionId;
  const [records, setRecords] = useState([]);
  const [query, setQuery] = useState("");
  const [allSessions, setAllSessions] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [history, pending, rejected] = await Promise.all([getHistory(), getQueue(), getFailed()]);
      const historyById = new Map(history.map((row) => [row.client_uid, row]));
      const activeScans = [
        ...pending.map((row) => ({ ...row, status: "QUEUED" })),
        ...rejected.map((row) => ({ ...row, status: "REVIEW" })),
      ];
      const activeById = new Map(activeScans.map((row) => [row.client_uid, row]));
      const rows = [
        ...history.filter((row) => row.status !== "QUEUED" && !activeById.has(row.client_uid)),
        ...Array.from(activeById.values(), (row) => ({
          ...historyById.get(row.client_uid), ...row, at: row.scanned_at,
        })),
      ];
      setRecords(rows.sort((a, b) => String(b.at || "").localeCompare(String(a.at || ""))));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  const search = query.trim().toLowerCase();
  const visible = records.filter((row) =>
    (allSessions || !sessionId || String(row.session_id) === String(sessionId)) &&
    `${row.name || ""} ${row.student_code || ""}`.toLowerCase().includes(search));

  return (
    <SafeAreaView style={ui.root}>
      <View style={[ui.headerRow, styles.header]}>
        <IconButton name="back" label="Back to scanner" onPress={() => navigation.goBack()} />
        <Text style={ui.screenTitle}>Scan history</Text>
        <IconButton name="sync" label="Refresh scan history" onPress={reload} disabled={loading} />
      </View>
      <View style={styles.filters}>
        <TextInput accessibilityLabel="Search scans" placeholder="Name or student number" placeholderTextColor={colors.muted} style={styles.search} value={query} onChangeText={setQuery} autoCorrect={false} returnKeyType="search" />
        {!!sessionId && <View style={styles.tabs}>
          {[{ all: false, label: "This session" }, { all: true, label: "All on device" }].map(({ all, label }) => (
            <TouchableOpacity key={label} style={[styles.tab, allSessions === all && styles.selected]} accessibilityRole="tab" accessibilityState={{ selected: allSessions === all }} onPress={() => setAllSessions(all)}>
              <Text style={[styles.tabText, allSessions === all && styles.selectedText]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>}
      </View>
      <FlatList
        data={visible}
        keyExtractor={(row, index) => row.client_uid || `${row.at}:${row.student_code}:${index}`}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        refreshing={loading}
        onRefresh={reload}
        ListEmptyComponent={!loading && <Text style={styles.empty}>{search ? "No matching scans." : "No scans saved here yet."}</Text>}
        renderItem={({ item }) => {
          const status = statuses[item.status] || { color: colors.muted, label: item.status || "Recorded" };
          const details = [item.name && item.name !== item.student_code ? item.student_code : "", item.session_id ? `Session #${item.session_id}` : "Session unavailable", localTime(item.at)].filter(Boolean).join(" · ");
          return (
            <View style={styles.row}>
              <View style={styles.rowCopy}>
                <Text style={styles.name}>{item.name || item.student_code}</Text>
                <Text style={styles.meta}>{details}</Text>
              </View>
              <Text style={[styles.status, { color: status.color }]}>{status.label}</Text>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = createStyles({
  header: { paddingHorizontal: 12 },
  filters: { paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
  search: { minHeight: 46, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 13, fontSize: 14, color: colors.navy },
  tabs: { flexDirection: "row", backgroundColor: colors.graySoft, borderRadius: 10, padding: 3 },
  tab: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  selected: { backgroundColor: colors.blue },
  tabText: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  selectedText: { color: colors.surface },
  list: { paddingHorizontal: 20, paddingBottom: 16 },
  empty: { color: colors.muted, fontSize: 14, padding: 20, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 14, gap: 10 },
  rowCopy: { flex: 1 },
  name: { color: colors.navy, fontSize: 14, fontWeight: "600" },
  meta: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  status: { fontSize: 12, fontWeight: "600", maxWidth: "43%" },
});
