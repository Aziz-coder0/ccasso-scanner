import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, AppState, Keyboard, KeyboardAvoidingView, Linking,
  Platform, ScrollView, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { SafeAreaView } from "react-native-safe-area-context";
import { useIsFocused } from "@react-navigation/native";
import NetInfo from "@react-native-community/netinfo";
import { BottomNav, Button, Icon, colors, createStyles, ui } from "../components/ScannerUI";
import { loadConfig, loadVerificationAcademicYear, saveVerificationAcademicYear } from "../db/storage";
import { verifyEnrollmentReceipt, verifyMembership } from "../api/kiosk";
import { isValidAcademicYear, presentVerificationResult, validateVerificationQr } from "../utils/verification";

const MODE_LABELS = { membership: "Membership", enrollment: "Enrollment fee" };
const TONES = {
  success: { color: colors.green, background: colors.greenSoft, icon: "check" },
  warning: { color: "#995400", background: colors.amberSoft, icon: "warning" },
  danger: { color: colors.red, background: colors.redSoft, icon: "close" },
  unknown: { color: colors.muted, background: colors.graySoft, icon: "info" },
};

function networkStatus(state) {
  if (state?.isConnected === false || state?.isInternetReachable === false) return false;
  return state?.isConnected === true ? true : null;
}

function localResult(title, message, tone = "unknown") {
  return { title, message, tone, verified: false, details: [], student: null, checkedAt: null };
}

function checkedTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

export default function VerificationScreen({ route, navigation }) {
  const mode = route.params?.mode;
  const validMode = mode === "membership" || mode === "enrollment";
  const membership = mode === "membership";
  const label = MODE_LABELS[mode] || "QR verification";
  const isFocused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [armed, setArmed] = useState(true);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState("");
  const [torch, setTorch] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [yearInput, setYearInput] = useState("");
  const [academicYear, setAcademicYear] = useState("");
  const [yearSaving, setYearSaving] = useState(false);
  const [yearNotice, setYearNotice] = useState("");
  const mounted = useRef(false);
  const focused = useRef(isFocused);
  const active = useRef(appActive);
  const currentMode = useRef(mode);
  const generation = useRef(0);
  const configGeneration = useRef(0);
  const latched = useRef(false);
  const yearSaveGeneration = useRef(0);
  const yearWrites = useRef(Promise.resolve());
  const verificationContext = useRef(null);
  const scroll = useRef(null);

  // These refs change during render, before effects or a pending fetch resolve.
  focused.current = isFocused;
  currentMode.current = mode;

  const reset = useCallback(() => {
    generation.current += 1;
    latched.current = false;
    if (!mounted.current) return;
    setBusy(false);
    setResult(null);
    setArmed(true);
    setTorch(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener("change", (state) => {
      active.current = state === "active";
      setAppActive(active.current);
      if (!active.current) {
        reset();
        setManual("");
        setManualOpen(false);
      }
    });
    const unsubscribe = NetInfo.addEventListener((state) => {
      const status = networkStatus(state);
      if (mounted.current) setOnline(status);
      if (status === false) reset();
    });
    return () => {
      mounted.current = false;
      generation.current += 1;
      configGeneration.current += 1;
      yearSaveGeneration.current += 1;
      latched.current = false;
      subscription.remove();
      unsubscribe();
    };
  }, [reset]);

  useEffect(() => {
    reset();
    setManual("");
    setManualOpen(false);
    setCameraError("");
    setYearNotice("");
    yearSaveGeneration.current += 1;
    setYearSaving(false);
    if (!isFocused) return undefined;
    setLoading(true);
    const id = ++configGeneration.current;
    Promise.all([loadConfig(), yearWrites.current.catch(() => {}).then(() => loadVerificationAcademicYear())]).then(([savedConfig, savedYear]) => {
      if (!mounted.current || !focused.current || configGeneration.current !== id) return;
      setConfig(savedConfig);
      const year = isValidAcademicYear(savedYear) ? String(savedYear).trim() : "";
      setYearInput(year);
      setAcademicYear(year);
      setLoading(false);
    }).catch(() => {
      if (!mounted.current || !focused.current || configGeneration.current !== id) return;
      setConfig(null);
      setLoading(false);
      setResult(localResult("Setup unavailable", "Open Setup and check the server URL and API token, then return here."));
    });
    return () => { generation.current += 1; configGeneration.current += 1; };
  }, [isFocused, mode, reset]);

  useEffect(() => {
    const remove = navigation.addListener?.("beforeRemove", () => {
      reset();
      setManual("");
      setManualOpen(false);
    });
    return remove;
  }, [navigation, reset]);

  useEffect(() => {
    if (result) scroll.current?.scrollToEnd({ animated: true });
  }, [result]);

  const configured = !!config?.baseUrl && !!config?.token;
  const yearReady = mode !== "enrollment" || isValidAcademicYear(academicYear);
  const canRead = validMode && configured && !loading && !yearSaving && yearReady;
  const cameraActive = isFocused && appActive && !manualOpen && !busy && armed && canRead;
  verificationContext.current = { mode, academicYear, config, canRead };

  async function verify(raw) {
    const context = verificationContext.current;
    if (!mounted.current || !focused.current || !active.current || latched.current || !context?.canRead) return;
    latched.current = true; // Lock synchronously so duplicate camera frames cannot start requests.
    setArmed(false);
    setResult(null);
    setTorch(false);
    setManualOpen(false);
    setManual("");
    Keyboard.dismiss();
    const id = ++generation.current;
    const requestedMode = context.mode;
    const requestedYear = context.academicYear;
    const requestConfig = context.config;
    const isCurrent = () => mounted.current && focused.current && active.current
      && generation.current === id && currentMode.current === requestedMode;
    const finish = (next) => {
      if (!isCurrent()) return;
      setResult(next);
      setBusy(false);
    };

    if (requestedMode !== "membership" && requestedMode !== "enrollment") {
      finish(localResult("Choose a scanner mode", "Return to Home and select Membership or Enrollment fee verification."));
      return;
    }
    const validation = validateVerificationQr(raw, requestedMode);
    if (!validation.valid) {
      finish(localResult("QR cannot be verified here", validation.message, "danger"));
      return;
    }
    if (!requestConfig?.baseUrl || !requestConfig?.token) {
      finish(localResult("Setup required", "Use the same server URL and Admin Panel API token in Setup."));
      return;
    }
    if (requestedMode === "enrollment" && !isValidAcademicYear(requestedYear)) {
      finish(localResult("Select an academic year", "Enter and apply the academic year before checking an enrollment receipt.", "warning"));
      return;
    }
    setBusy(true);
    try {
      const state = await NetInfo.fetch();
      if (!isCurrent()) return;
      const reachable = networkStatus(state);
      setOnline(reachable);
      if (reachable === false) {
        finish(localResult("Online check required", "Connect to the internet and scan again. Membership and receipt validity cannot be confirmed offline."));
        return;
      }
      const device = { deviceId: requestConfig.deviceId, gateLabel: requestConfig.gateLabel, operatorName: requestConfig.operatorName };
      const response = requestedMode === "membership"
        ? await verifyMembership(requestConfig.baseUrl, requestConfig.token, validation.payload, device)
        : await verifyEnrollmentReceipt(requestConfig.baseUrl, requestConfig.token, validation.payload, requestedYear, device);
      if (!isCurrent()) return;
      setOnline(true);
      finish(presentVerificationResult(requestedMode, response, requestedYear));
    } catch (error) {
      if (!isCurrent()) return;
      if ([401, 403].includes(Number(error?.status))) {
        finish(localResult("API token needs attention", "Verification was not authorized. Check the Admin Panel API token in Setup, then scan again."));
      } else if (Number(error?.status) === 404) {
        finish(localResult("Verification API unavailable", "Check the server URL in Setup and deploy the UniSystem membership and enrollment verification API, then scan again."));
      } else {
        finish(localResult("Verification unavailable", "The server could not confirm this QR. Check your connection and server, then scan again."));
      }
    }
  }

  function changeYear(value) {
    reset();
    if (verificationContext.current) verificationContext.current = { ...verificationContext.current, academicYear: "", canRead: false };
    yearSaveGeneration.current += 1;
    setYearSaving(false);
    setYearInput(value);
    setAcademicYear("");
    setYearNotice("");
  }

  async function applyYear() {
    const year = yearInput.trim();
    reset();
    if (!isValidAcademicYear(year)) {
      setYearNotice("Use consecutive years in YYYY-YYYY format, for example 2026-2027.");
      return;
    }
    const id = ++yearSaveGeneration.current;
    if (verificationContext.current) verificationContext.current = { ...verificationContext.current, canRead: false };
    setYearSaving(true);
    setYearNotice("");
    // Serialize preference writes if a year is edited while an earlier save is pending.
    const write = yearWrites.current.catch(() => {}).then(() => saveVerificationAcademicYear(year));
    yearWrites.current = write;
    try {
      await write;
      if (!mounted.current || !focused.current || yearSaveGeneration.current !== id) return;
      setAcademicYear(year);
      setYearInput(year);
      setYearNotice(`Checking receipts for A.Y. ${year}.`);
      Keyboard.dismiss();
    } catch (_) {
      if (mounted.current && yearSaveGeneration.current === id) setYearNotice("Could not save this academic year. Please try again.");
    } finally {
      if (mounted.current && yearSaveGeneration.current === id) setYearSaving(false);
    }
  }

  function scanAgain() {
    reset();
    setManual("");
    setManualOpen(false);
  }

  async function allowCamera() {
    setCameraError("");
    try {
      if (permission?.canAskAgain === false) await Linking.openSettings();
      else await requestPermission();
    } catch (_) {
      if (mounted.current) setCameraError("Camera access is unavailable. You can paste the full QR payload below.");
    }
  }

  const tone = TONES[result?.tone] || TONES.unknown;
  const student = result?.student;
  const studentMeta = student ? [student.student_number, student.program, student.year_level && `Year ${student.year_level}`, student.section].filter(Boolean).join(" · ") : "";
  const checked = checkedTime(result?.checkedAt);

  return (
    <SafeAreaView style={ui.root} testID="verification-screen">
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView ref={scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={ui.headerRow}>
            <TouchableOpacity testID="verification-back" accessibilityRole="button" accessibilityLabel="Back to scanner modes" style={ui.iconButton} onPress={() => { reset(); navigation.navigate("Modes", undefined, { pop: true }); }}><Icon name="back" /></TouchableOpacity>
            <Text style={ui.screenTitle}>Verify QR</Text>
            <View style={[styles.connection, { backgroundColor: online === true ? colors.greenSoft : online === false ? colors.amberSoft : colors.graySoft }]} testID="verification-connection">
              <View style={[ui.dot, { backgroundColor: online === true ? colors.green : online === false ? colors.orange : colors.muted }]} />
              <Text style={[styles.connectionText, { color: online === true ? colors.green : online === false ? "#995400" : colors.muted }]}>{online === true ? "Online" : online === false ? "Offline" : "Checking"}</Text>
            </View>
          </View>
          <View style={styles.headingRow}>
            <View style={[styles.modeIcon, !membership && { backgroundColor: colors.amberSoft }]}><Icon name={membership ? "shield" : "file"} size={25} color={membership ? colors.blue : "#b45e00"} /></View>
            <View style={styles.flex}><Text style={styles.heading}>{label}</Text><Text style={styles.subtitle}>Live verification with UniSystem</Text></View>
          </View>
          <Text style={styles.intro}>{membership ? "Scan the QR on a CCASSO membership card to check its current validity." : "Scan an enrollment fee receipt to check authenticity and the current payment balance."}</Text>

          {mode === "enrollment" && <View style={styles.yearCard}>
            <Text style={styles.fieldLabel}>Academic year to verify</Text>
            <View style={styles.yearRow}>
              <TextInput testID="verification-academic-year" accessibilityLabel="Academic year to verify" value={yearInput} onChangeText={changeYear} placeholder="YYYY-YYYY" placeholderTextColor="#7d8fa3" autoCapitalize="none" autoCorrect={false} maxLength={9} editable={!loading} onSubmitEditing={applyYear} returnKeyType="done" style={[styles.input, styles.yearInput]} />
              <View testID="verification-apply-year"><Button label="Use year" onPress={applyYear} busy={yearSaving} disabled={loading || !yearInput.trim()} style={styles.yearButton} /></View>
            </View>
            <Text style={[styles.helper, yearNotice && !academicYear && { color: "#995400" }]} testID="verification-year-status">{yearNotice || (academicYear ? `Selected: A.Y. ${academicYear}` : "Choose the exact academic year before scanning. This choice is saved on this device.")}</Text>
          </View>}

          {!loading && !configured && <View style={styles.notice}><Icon name="settings" size={19} color={colors.blue} /><Text style={styles.noticeText}>Set the server URL and API token to start verification.</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Open Setup" onPress={() => { reset(); navigation.navigate("Setup", undefined, { pop: true }); }}><Text style={styles.link}>Setup</Text></TouchableOpacity></View>}
          {online === false && <View style={styles.notice}><Icon name="info" size={19} color={colors.muted} /><Text style={styles.noticeText}>An internet connection is required for every verification.</Text></View>}

          <View style={styles.cameraWrap}>
            {permission?.granted && !cameraError && cameraActive ? <CameraView testID="verification-camera" style={styles.camera} facing="back" active={cameraActive} enableTorch={torch} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={({ data }) => verify(data)} onMountError={(error) => { if (mounted.current) setCameraError(error.message || "Unable to open this device camera."); }} /> : <View style={styles.cameraFallback}>
              {loading || busy ? <ActivityIndicator color="white" size="large" /> : <Icon name={result ? tone.icon : "shield"} color="white" size={32} />}
              <Text style={styles.cameraFallbackTitle}>{loading ? "Preparing scanner…" : busy ? "Checking with UniSystem…" : result ? "Scan paused" : manualOpen ? "Manual QR entry" : !validMode ? "Select a scanner mode" : !yearReady ? "Select an academic year" : !configured ? "Setup required" : cameraError ? "Camera unavailable" : !permission?.granted ? "Camera access needed" : "Ready when you return"}</Text>
              <Text style={styles.cameraFallbackText}>{busy ? "Waiting for the server to confirm this QR." : result ? "Review the result below, then tap Scan again." : cameraError || (!yearReady ? "Apply the year above to enable receipt scanning." : "You can also paste the complete signed QR payload below.")}</Text>
              {!result && !busy && !loading && canRead && (!permission?.granted || cameraError) && <Button label={cameraError ? "Try camera again" : permission?.canAskAgain === false ? "Open camera settings" : "Allow camera"} onPress={allowCamera} style={styles.permissionButton} />}
            </View>}
            {cameraActive && permission?.granted && !cameraError && <View pointerEvents="none" style={styles.frameOverlay}><View style={[styles.corner, styles.tl]} /><View style={[styles.corner, styles.tr]} /><View style={[styles.corner, styles.bl]} /><View style={[styles.corner, styles.br]} /><Text style={styles.cameraLabel}>{membership ? "MEMBERSHIP CARD · UM1" : "ENROLLMENT RECEIPT · UE1"}</Text></View>}
            {cameraActive && permission?.granted && !cameraError && <TouchableOpacity testID="verification-torch" accessibilityRole="button" accessibilityLabel={torch ? "Turn flash off" : "Turn flash on"} accessibilityState={{ selected: torch }} style={[styles.torch, torch && { backgroundColor: colors.blue }]} onPress={() => setTorch((value) => !value)}><Icon name="flash" color="white" size={22} /></TouchableOpacity>}
          </View>
          <Text style={styles.scanPrompt}>{busy ? "Live server check in progress" : membership ? "Use the QR printed on the membership card" : `Receipt check${academicYear ? ` · A.Y. ${academicYear}` : " · academic year required"}`}</Text>

          {result && <View testID="verification-result" accessibilityLiveRegion="polite" style={[styles.resultCard, { backgroundColor: tone.background, borderColor: tone.color }]}>
            <View style={styles.resultHeading}><View style={[styles.resultIcon, { backgroundColor: tone.color }]}><Icon name={tone.icon} color="white" size={22} /></View><View style={styles.flex}><Text testID="verification-result-status" style={[styles.resultLabel, { color: tone.color }]}>{result.verified === true ? "SERVER CONFIRMED" : "NOT CONFIRMED"}</Text><Text style={styles.resultTitle}>{result.title}</Text></View></View>
            <Text style={styles.resultMessage}>{result.message}</Text>
            {!!student?.full_name && <Text testID="verification-student-name" style={styles.studentName}>{student.full_name}</Text>}
            {!!studentMeta && <Text style={styles.studentMeta}>{studentMeta}</Text>}
            {(result.details || []).map((detail, index) => <View key={`${detail.label}-${index}`} style={styles.detailRow}><Text style={styles.detailLabel}>{detail.label}</Text><Text style={styles.detailValue}>{detail.value == null || detail.value === "" ? "—" : String(detail.value)}</Text></View>)}
            {!!checked && <Text style={styles.checkedAt}>Checked by UniSystem · {checked}</Text>}
          </View>}

          {(!armed || result) && <View testID="verification-scan-again"><Button label="Scan again" icon="sync" onPress={scanAgain} busy={busy} style={styles.action} /></View>}
          <TouchableOpacity testID="verification-manual-toggle" accessibilityRole="button" accessibilityLabel={manualOpen ? "Close QR entry" : "Paste QR payload"} accessibilityState={{ expanded: manualOpen, disabled: busy || loading }} disabled={busy || loading} style={[styles.manualToggle, (busy || loading) && ui.disabled]} onPress={() => { reset(); setManualOpen((value) => !value); setManual(""); }}><Icon name={manualOpen ? "close" : "keyboard"} size={21} color={colors.blue} /><Text style={styles.manualToggleText}>{manualOpen ? "Close QR entry" : "Paste QR payload"}</Text></TouchableOpacity>
          {manualOpen && <View style={styles.manualCard}>
            <Text style={styles.fieldLabel}>Complete {membership ? "membership card" : "enrollment receipt"} QR payload</Text>
            <TextInput testID="verification-manual-input" accessibilityLabel="Signed QR payload" style={[styles.input, styles.payloadInput]} value={manual} onChangeText={setManual} placeholder={membership ? "UM1:…" : "UE1:…"} placeholderTextColor="#7d8fa3" autoCapitalize="none" autoCorrect={false} multiline maxLength={4096} textAlignVertical="top" />
            <Text style={styles.helper}>Paste the entire QR content. A student number alone cannot verify a card or receipt.</Text>
            <View testID="verification-manual-submit"><Button label="Verify QR online" icon="shield" onPress={() => verify(manual)} disabled={!manual.trim() || !canRead} busy={busy} style={styles.action} /></View>
          </View>}
          <View style={styles.privacyNote}><Icon name="shield" color={colors.muted} size={17} /><Text style={styles.privacyText}>This check does not record attendance. Verification results are cleared when you leave this screen.</Text></View>
        </ScrollView>
      </KeyboardAvoidingView>
      <BottomNav navigation={navigation} active="Verification" />
    </SafeAreaView>
  );
}

const styles = createStyles({
  flex: { flex: 1 },
  page: { paddingHorizontal: 18, paddingTop: 4, paddingBottom: 22 },
  connection: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 18, paddingHorizontal: 9, paddingVertical: 6 },
  connectionText: { fontSize: 11, fontWeight: "600" },
  headingRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 15 },
  modeIcon: { height: 49, width: 49, borderRadius: 15, backgroundColor: colors.blueSoft, alignItems: "center", justifyContent: "center" },
  heading: { color: colors.navy, fontSize: 25, fontWeight: "800", letterSpacing: -0.7 },
  subtitle: { color: colors.muted, fontSize: 11, marginTop: 4 },
  intro: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 12, marginBottom: 14 },
  yearCard: { borderRadius: 14, padding: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: 14 },
  fieldLabel: { color: colors.navy, fontSize: 12, fontWeight: "700", marginBottom: 8 },
  yearRow: { flexDirection: "row", gap: 9, alignItems: "center" },
  input: { color: colors.navy, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 12, minHeight: 46, fontSize: 14, fontFamily: "Inter_400Regular" },
  yearInput: { flex: 1, minWidth: 0 },
  yearButton: { paddingHorizontal: 14 },
  helper: { fontSize: 11, lineHeight: 17, color: colors.muted, marginTop: 8 },
  notice: { flexDirection: "row", alignItems: "center", gap: 8, padding: 11, backgroundColor: colors.blueSoft, borderRadius: 10, marginBottom: 12 },
  noticeText: { color: colors.muted, fontSize: 11, lineHeight: 17, flex: 1 },
  link: { color: colors.blue, fontSize: 12, fontWeight: "700", paddingVertical: 8 },
  cameraWrap: { height: 240, borderRadius: 23, overflow: "hidden", backgroundColor: "#102343" },
  camera: { width: "100%", height: "100%" },
  cameraFallback: { flex: 1, justifyContent: "center", alignItems: "center", padding: 22, gap: 9 },
  cameraFallbackTitle: { color: "white", fontSize: 16, fontWeight: "700", textAlign: "center" },
  cameraFallbackText: { color: "#d0dced", fontSize: 11, lineHeight: 17, textAlign: "center" },
  permissionButton: { marginTop: 2, minHeight: 40, paddingVertical: 9 },
  frameOverlay: { position: "absolute", top: 32, left: "21%", right: "21%", bottom: 37 },
  corner: { position: "absolute", width: 28, height: 28, borderColor: "#74aaff" },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 12 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 12 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 12 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 12 },
  cameraLabel: { position: "absolute", bottom: -24, alignSelf: "center", color: "white", fontSize: 8, fontWeight: "700", letterSpacing: 0.8 },
  torch: { position: "absolute", right: 13, top: 13, width: 38, height: 38, borderRadius: 12, backgroundColor: "#071638aa", alignItems: "center", justifyContent: "center" },
  scanPrompt: { color: colors.muted, fontSize: 11, textAlign: "center", marginTop: 10, marginBottom: 13, lineHeight: 16 },
  resultCard: { borderWidth: 1, borderRadius: 17, padding: 16, marginBottom: 12 },
  resultHeading: { flexDirection: "row", gap: 10, alignItems: "center" },
  resultIcon: { height: 37, width: 37, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  resultLabel: { fontSize: 8, fontWeight: "800", letterSpacing: 1 },
  resultTitle: { color: colors.navy, fontSize: 16, fontWeight: "800", marginTop: 4 },
  resultMessage: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 12 },
  studentName: { color: colors.navy, fontSize: 18, lineHeight: 25, fontWeight: "800", marginTop: 15 },
  studentMeta: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 3, marginBottom: 7 },
  detailRow: { flexDirection: "row", alignItems: "flex-start", paddingTop: 9, marginTop: 8, borderTopWidth: 1, borderTopColor: "#49617f22", gap: 12 },
  detailLabel: { color: colors.muted, fontSize: 11, lineHeight: 17, flex: 1 },
  detailValue: { color: colors.navy, fontSize: 11, fontWeight: "600", lineHeight: 17, flex: 1.3, textAlign: "right" },
  checkedAt: { color: colors.muted, fontSize: 9, lineHeight: 15, marginTop: 13 },
  action: { marginTop: 2 },
  manualToggle: { alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, minHeight: 46, marginTop: 8 },
  manualToggleText: { color: colors.blue, fontSize: 13, fontWeight: "600" },
  manualCard: { borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 14, marginTop: 5, marginBottom: 9 },
  payloadInput: { minHeight: 90, paddingTop: 12, paddingBottom: 12, fontSize: 12 },
  privacyNote: { flexDirection: "row", gap: 7, marginTop: 13, alignItems: "flex-start", paddingHorizontal: 3 },
  privacyText: { flex: 1, color: colors.muted, fontSize: 10, lineHeight: 16 },
});
