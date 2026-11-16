import React, { useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Brand, BottomNav, Button, Icon, colors, createStyles, ui } from "../components/ScannerUI";
import { pendingCount } from "../db/queue";
import {
  loadConfig, saveConfig, loadSessionPin, saveSessionPin, loadQrPattern, saveQrPattern,
} from "../db/storage";
import { ping } from "../api/kiosk";

export default function SetupScreen({ navigation }) {
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [deviceId, setDeviceId] = useState("rn-kiosk-1");
  const [gateLabel, setGateLabel] = useState("Gate A");
  const [operatorName, setOperatorName] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionPin, setSessionPin] = useState("");
  const [qrPattern, setQrPattern] = useState("");
  const [configured, setConfigured] = useState(false);
  const [pending, setPending] = useState(0);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    (async () => {
      const cfg = await loadConfig();
      setConfigured(!!(cfg.baseUrl && cfg.token));
      setPending(await pendingCount());
      if (cfg.baseUrl) setBaseUrl(cfg.baseUrl);
      if (cfg.token) setToken(cfg.token);
      if (cfg.deviceId) setDeviceId(cfg.deviceId);
      if (cfg.gateLabel) setGateLabel(cfg.gateLabel);
      if (cfg.operatorName) setOperatorName(cfg.operatorName);
      try { setSessionPin(await loadSessionPin()); } catch (_) {}
      try { setQrPattern(await loadQrPattern()); } catch (_) {}
    })();
  }, []);

  async function onSave() {
    if (busy) return;
    if (!baseUrl.trim() || !token.trim()) {
      Alert.alert("Setup incomplete", "Enter the UniOrg URL and Scanner API token.");
      return;
    }
    setBusy(true);
    try {
      const url = baseUrl.trim().replace(/\/+$/, "");
      await ping(url, token.trim());
      await saveSessionPin(sessionPin);
      await saveQrPattern(qrPattern);
      await saveConfig({
        baseUrl: url,
        token: token.trim(),
        deviceId: deviceId.trim() || "rn-kiosk-1",
        gateLabel: gateLabel.trim() || "Gate A",
        operatorName: operatorName.trim(),
      });
      navigation.reset({ index: 0, routes: [{ name: "Modes" }] });
    } catch (e) {
      Alert.alert("Connection failed", e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={ui.root}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.brandRow}><Brand /><View style={styles.setupPill}><Text style={styles.setupPillText}>Device setup</Text></View></View>
          <Text style={ui.heading}>Connect this device</Text>
          <Text style={[ui.body, styles.subtitle]}>Connect to UniOrg for attendance, membership and enrollment fee verification.</Text>
          <View style={styles.trustRow}><View style={styles.trustItem}><Icon name="shield" color={colors.green} size={17} /><Text style={styles.trustText}>One device token</Text></View><View style={styles.trustItem}><Icon name="cloudUpload" color={colors.blue} size={17} /><Text style={styles.trustText}>Offline attendance</Text></View></View>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>UniOrg connection</Text><Text style={styles.sectionSub}>Use the Scanner API token generated in the Admin Panel. This device reuses the same saved token for all three scanner modes.</Text>
            <Text style={styles.label}>Server URL</Text>
            <TextInput accessibilityLabel="Server URL" style={styles.input} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://ccasso.azizomar.tech" placeholderTextColor="#7d8fa3" value={baseUrl} onChangeText={setBaseUrl} editable={!busy} />
            <Text style={styles.label}>Scanner API token</Text>
            <TextInput accessibilityLabel="Scanner API token" style={styles.input} autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder="Paste your kiosk API token" placeholderTextColor="#7d8fa3" value={token} onChangeText={setToken} editable={!busy} />
            <Text style={styles.sectionSub}>Membership and enrollment receipts are checked live and require internet. Only attendance supports the offline queue.</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Device identity</Text><Text style={styles.sectionSub}>Identify this scanner in attendance records.</Text>
            <View style={styles.twoCol}>
              <View style={styles.col}><Text style={styles.label}>Gate</Text><TextInput accessibilityLabel="Gate" style={styles.input} placeholder="Gate A" placeholderTextColor="#7d8fa3" value={gateLabel} onChangeText={setGateLabel} editable={!busy} /></View>
              <View style={styles.col}><Text style={styles.label}>Device ID</Text><TextInput accessibilityLabel="Device ID" style={styles.input} autoCapitalize="none" placeholder="Scanner 01" placeholderTextColor="#7d8fa3" value={deviceId} onChangeText={setDeviceId} editable={!busy} /></View>
            </View>
            <Text style={styles.label}>Operator name</Text><TextInput accessibilityLabel="Operator name" style={styles.input} placeholder="Assigned officer" placeholderTextColor="#7d8fa3" value={operatorName} onChangeText={setOperatorName} editable={!busy} />
          </View>
          <View style={styles.card}>
            <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: advanced }} style={styles.advancedToggle} onPress={() => setAdvanced(!advanced)}><Text style={styles.sectionTitle}>Attendance controls</Text><Icon name={advanced ? "down" : "chevron"} size={18} color={colors.muted} /></TouchableOpacity>
            {advanced && <><Text style={styles.label}>Session lock PIN</Text><TextInput accessibilityLabel="Session lock PIN" style={styles.input} keyboardType="number-pad" secureTextEntry placeholder="Optional PIN" placeholderTextColor="#7d8fa3" value={sessionPin} onChangeText={setSessionPin} editable={!busy} /><Text style={styles.label}>QR whitelist pattern</Text><TextInput accessibilityLabel="QR whitelist pattern" style={styles.input} autoCapitalize="none" placeholder="Optional regular expression" placeholderTextColor="#7d8fa3" value={qrPattern} onChangeText={setQrPattern} editable={!busy} /></>}
          </View>
          <Button label="Verify & continue" iconEnd="arrow" onPress={onSave} busy={busy} style={styles.continueButton} />
          <Text style={styles.footer}>CCASSO · Scan & verify</Text>
        </ScrollView>
      </KeyboardAvoidingView>
      {configured && <BottomNav navigation={navigation} active="Setup" pending={pending} disabled={busy} />}
    </SafeAreaView>
  );
}

const styles = createStyles({
  flex: { flex: 1 },
  inner: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 },
  brandRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 27 },
  setupPill: { backgroundColor: colors.blueSoft, borderRadius: 20, paddingVertical: 7, paddingHorizontal: 12 },
  setupPillText: { fontSize: 11, color: colors.blue, fontWeight: "600" },
  subtitle: { marginTop: 7 },
  trustRow: { flexDirection: "row", gap: 16, marginTop: 17, marginBottom: 22 },
  trustItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  trustText: { color: colors.muted, fontSize: 11 },
  card: { padding: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 17, backgroundColor: colors.surface, marginBottom: 13 },
  sectionTitle: { color: colors.navy, fontSize: 16, fontWeight: "700" },
  sectionSub: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 5 },
  label: { color: colors.navy, fontSize: 12, fontWeight: "600", marginTop: 17, marginBottom: 7 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.background, color: colors.navy, minHeight: 46, paddingHorizontal: 12, paddingVertical: 11, fontSize: 13 },
  twoCol: { flexDirection: "row", gap: 10 },
  col: { flex: 1 },
  advancedToggle: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 32 },
  continueButton: { marginTop: 2, minHeight: 48 },
  footer: { color: colors.muted, fontSize: 11, textAlign: "center", marginTop: 19 },
});
