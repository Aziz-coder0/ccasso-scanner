import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Vibration, Share, AppState, ScrollView, Alert, Modal, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, useWindowDimensions,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { SafeAreaView } from "react-native-safe-area-context";
import { StackActions, useIsFocused } from "@react-navigation/native";
import { Button, ConnectionBadge, Icon, IconButton, MetricStrip, colors, createStyles, ui } from "../components/ScannerUI";
import {
  Lineicons,
  ArrowLeftStroke, Bolt2Stroke, RefreshCircle1ClockwiseStroke,
  FileMultipleStroke, MenuHamburger1Stroke, MenuMeatballs1Stroke,
  Download1Stroke,
} from "../components/Lineicons";
import NetInfo from "@react-native-community/netinfo";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { loadConfig, saveLastSync, loadLastSync, loadQuietMode, saveQuietMode, loadFastMode, saveFastMode, loadContinuousMode, saveContinuousMode, loadForceOffline, saveForceOffline, loadSessionPin, saveSessionPin, loadQrPattern, loadCooldownMs } from "../db/storage";
import {
  scanStudent, fetchSessionStats, scanBatch, fetchRoster, fetchSessionDetail,
  failReasonLabel, isAcceptedScanResult, isRetryableScanResult, isRetryableApiError,
} from "../api/kiosk";
import {
  enqueueScan, pendingCount, queueAsBatchPayload, removeSynced,
  acquireQueueSync, addFailed, recordUploadedScans, pushHistory, getQueue, getHistory, getFailed,
} from "../db/queue";
import { saveRoster, lookupRoster, rosterMeta, searchRoster, normalizeStudentCode } from "../db/roster";
import { exportKioskBundle } from "../utils/exportXlsx";
import { initBeeps, playSuccessBeep, playErrorBeep } from "../utils/beep";
import { classifyQr } from "../utils/verification";

function normalizeCode(raw) {
  return normalizeStudentCode(raw);
}

export default function ScannerScreen({ route, navigation }) {
  const session = route.params?.session;
  const isFocused = useIsFocused();
  const { height } = useWindowDimensions();
  const [manualOpen, setManualOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [lastResult, setLastResult] = useState(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [cfg, setCfg] = useState(null);
  const [manual, setManual] = useState("");
  const [torch, setTorch] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [fast, setFast] = useState(false);
  const [continuous, setContinuous] = useState(false);
  const fastRef = useRef(false);
  const continuousRef = useRef(false);
  const [stats, setStats] = useState({ present: 0, late: 0, marked: 0 });
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const [forceOffline, setForceOffline] = useState(false);
  const forceOfflineRef = useRef(false);
  const cooldownMap = useRef(new Map());
  const cooldownMsRef = useRef(3000);
  const qrPatternRef = useRef("");
  const [queueWarn, setQueueWarn] = useState("");
  const [pinPrompt, setPinPrompt] = useState(null); // { resolve }
  const [pinInput, setPinInput] = useState("");
  const sessionPinRef = useRef("");
  const allowSessionExit = useRef(false);
  const [frameColor, setFrameColor] = useState(colors.blue);
  const [lastSync, setLastSync] = useState("");
  const [sessionClosed, setSessionClosed] = useState(false);
  const [rosterCount, setRosterCount] = useState(0);
  const [rosterAt, setRosterAt] = useState("");
  const [rosterDownloading, setRosterDownloading] = useState(false);
  const [syncChip, setSyncChip] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [flash, setFlash] = useState(null); // full screen { type, title, sub }
  const [menuOpen, setMenuOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [manualHits, setManualHits] = useState([]);
  const lock = useRef(false);
  const rosterLock = useRef(false);
  const lastCode = useRef({ code: "", at: 0 });
  const lastCameraRead = useRef({ raw: "", at: 0 });
  const pendingKeys = useRef(new Set());
  const confirmedKeys = useRef(new Set());
  const flashTimer = useRef(null);
  const mounted = useRef(true);
  const quietRef = useRef(false);

  const rebuildPendingKeys = useCallback(async () => {
    const queue = await getQueue();
    const next = new Set();
    queue
      .filter((row) => String(row.session_id) === String(session?.id))
      .forEach((row) => next.add(String(row.student_code || "").trim().toUpperCase()));
    pendingKeys.current = next;
    return queue;
  }, [session?.id]);

  function beepOk() {
    try { Vibration.vibrate(quietRef.current ? 40 : 80); } catch (_) {}
    if (!quietRef.current) {
      try { playSuccessBeep(); } catch (_) {}
    }
  }
  function beepErr() {
    try { Vibration.vibrate(quietRef.current ? [0, 40, 30, 40] : [0, 50, 40, 50]); } catch (_) {}
    if (!quietRef.current) {
      try { playErrorBeep(); } catch (_) {}
    }
  }

  const refreshStats = useCallback(async (c) => {
    const conf = c || cfg;
    if (!conf?.baseUrl || !conf?.token || !session?.id) return;
    try {
      const s = await fetchSessionStats(conf.baseUrl, conf.token, session.id);
      if (!mounted.current) return;
      setStats({
        present: Number(s.present || 0),
        late: Number(s.late || 0),
        marked: Number(s.marked || (s.present || 0) + (s.late || 0)),
      });
    } catch (_) {}
  }, [cfg, session?.id]);

  const downloadRoster = useCallback(async (c, { toast, force = false } = {}) => {
    const conf = c || cfg;
    if (!conf?.baseUrl || !conf?.token) return 0;
    if (rosterLock.current) return 0;
    if (!force) {
      const cached = await rosterMeta();
      const age = cached?.at ? Date.now() - new Date(cached.at).getTime() : Infinity;
      if (Number.isFinite(age) && age < 5 * 60 * 1000) {
        if (mounted.current) {
          setRosterCount(Number(cached.count || 0));
          setRosterAt(cached.at || "");
        }
        return Number(cached.count || 0);
      }
    }
    rosterLock.current = true;
    if (mounted.current) {
      setRosterDownloading(true);
      setSyncChip("Downloading roster…");
    }
    try {
      const ros = await fetchRoster(conf.baseUrl, conf.token);
      const n = await saveRoster(ros.students || []);
      const meta = await rosterMeta();
      if (mounted.current) {
        setRosterCount(n);
        setRosterAt(meta.at || new Date().toISOString());
        setSyncChip(`Roster ready · ${n}`);
      }
      if (toast) Alert.alert("Roster ready", `${n} students are cached for online and offline scanning.`);
      return n;
    } catch (e) {
      if (toast) {
        let msg = e.message || String(e);
        if (/404|Not Found|DOCTYPE|html/i.test(msg)) {
          msg = "Roster API not on server yet.\n\nDeploy /api/kiosk/roster to Vercel, or scanning still works (shows student number only offline).";
        }
        Alert.alert("Roster failed", msg);
      }
      return 0;
    } finally {
      rosterLock.current = false;
      if (mounted.current) setRosterDownloading(false);
    }
  }, [cfg]);

  const tryAutoSync = useCallback(async (c, { silent } = {}) => {
    const conf = c || cfg;
    if (!conf?.baseUrl || !conf?.token) return null;
    const releaseSync = acquireQueueSync();
    if (!releaseSync) return null;
    if (mounted.current) setSyncing(true);
    try {
      const scans = await queueAsBatchPayload();
      if (!scans.length) {
        if (mounted.current) {
          setPending(0);
          setSyncChip("Up to date");
        }
        await rebuildPendingKeys();
        return { accepted: 0, already: 0, review: 0, retry: 0, pending: 0 };
      }
      const chunkSize = 40;
      const allResults = [];
      for (let i = 0; i < scans.length; i += chunkSize) {
        const chunk = scans.slice(i, i + chunkSize);
        try {
          const data = await scanBatch(conf.baseUrl, conf.token, chunk, conf.deviceId);
          const results = data.results || [];
          chunk.forEach((scan, idx) => {
            let r = results.find((x) => x.client_uid && x.client_uid === scan.client_uid);
            if (!r) r = results.find((x) => x.index === idx);
            if (!r && results[idx]) r = results[idx];
            allResults.push({ scan, r: r || null });
          });
        } catch (error) {
          chunk.forEach((scan) => allResults.push({ scan, r: null, error }));
        }
      }
      let acceptedN = 0, alreadyN = 0, reviewN = 0, retryN = 0;
      const finishedIds = [];
      const accepted = [];
      for (const { scan, r, error } of allResults) {
        if (error || !r || isRetryableScanResult(r)) {
          retryN += 1;
          continue;
        }
        const msg = String(r.message || "");
        const code = String(r.code || "").toUpperCase();
        const isAlready = r.already_present === true || code === "ALREADY" || /already marked present/i.test(msg);
        if (isAcceptedScanResult(r)) {
          accepted.push({ scan, result: r });
          finishedIds.push(scan.client_uid);
          if (String(scan.session_id) === String(session?.id)) {
            confirmedKeys.current.add(String(scan.student_code || "").trim().toUpperCase());
          }
          if (isAlready) alreadyN += 1;
          else acceptedN += 1;
        } else {
          if (code === "SESSION_CLOSED" && String(scan.session_id) === String(session?.id)) {
            if (mounted.current) setSessionClosed(true);
          }
          await addFailed({
            ...scan,
            error: failReasonLabel(code, msg),
            code: code || undefined,
          });
          finishedIds.push(scan.client_uid);
          reviewN += 1;
        }
      }
      await recordUploadedScans(accepted);
      if (finishedIds.length) await removeSynced(finishedIds);
      const iso = new Date().toISOString();
      await saveLastSync(iso);
      const pend = await pendingCount();
      await rebuildPendingKeys();
      if (!mounted.current) return null;
      setLastSync(iso);
      setPending(pend);
      const chip = `Accepted ${acceptedN} · Already ${alreadyN} · Review ${reviewN} · Retry ${retryN}`;
      setSyncChip(chip);
      await refreshStats(conf);
      if (!silent) Alert.alert("Sync summary", chip.replace(/ · /g, "\n"));
      return { accepted: acceptedN, already: alreadyN, review: reviewN, retry: retryN, pending: pend };
    } catch (e) {
      if (!silent) Alert.alert("Sync failed", e.message || String(e));
      return null;
    } finally {
      releaseSync();
      if (mounted.current) setSyncing(false);
    }
  }, [cfg, rebuildPendingKeys, refreshStats, session?.id]);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      try { await activateKeepAwakeAsync("ccas-scanner"); } catch (_) {}
      try { await initBeeps(); } catch (_) {}
      try {
        const c = await loadConfig();
        const q = await loadQuietMode();
        const f = await loadFastMode();
        const cont = await loadContinuousMode();
        const fo = await loadForceOffline();
        const pin = await loadSessionPin();
        const pat = await loadQrPattern();
        const cd = await loadCooldownMs();
        sessionPinRef.current = pin || "";
        qrPatternRef.current = pat || "";
        cooldownMsRef.current = cd;

        quietRef.current = q;
        fastRef.current = f;
        continuousRef.current = cont;
        forceOfflineRef.current = fo;
        if (!mounted.current) return;
        setCfg(c);
        setQuiet(q);
        setFast(f);
        setContinuous(cont);
        setForceOffline(fo);
        refreshStats(c);
        setPending(await pendingCount());
        setLastSync(await loadLastSync());
        const meta = await rosterMeta();
        setRosterCount(meta.count || 0);
        setRosterAt(meta.at || "");
        await rebuildPendingKeys();
        const net = await NetInfo.fetch();
        const on = !!(net.isConnected && net.isInternetReachable !== false);
        setOnline(on);
        if (on && c?.baseUrl && c?.token) {
          await downloadRoster(c);
          if (session?.id) {
            try {
              const det = await fetchSessionDetail(c.baseUrl, c.token, session.id);
              if (det.session?.closed || String(det.session?.status || "").toUpperCase() === "CLOSED") {
                setSessionClosed(true);
              }
            } catch (_) {}
          }
        }
      } catch (_) {}
    })();
    return () => {
      mounted.current = false;
      if (flashTimer.current) clearTimeout(flashTimer.current);
      try { deactivateKeepAwake("ccas-scanner"); } catch (_) {}
    };
  }, [session?.id]);

  useEffect(() => {
    if (permission && !permission.granted) requestPermission();
  }, [permission]);

  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", (e) => {
      const pin = sessionPinRef.current;
      if (!pin || allowSessionExit.current) {
        allowSessionExit.current = false;
        return;
      }
      e.preventDefault();
      setPinInput("");
      setPinPrompt({ action: e.data.action });
    });
    return unsub;
  }, [navigation]);


  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      const on = !!(state.isConnected && state.isInternetReachable !== false);
      if (mounted.current) setOnline(on);
      if (on && !forceOfflineRef.current) {
        tryAutoSync(null, { silent: true });
        downloadRoster(null);
      }
    });
    return () => unsub();
  }, [tryAutoSync, downloadRoster]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") {
        refreshStats();
        tryAutoSync(null, { silent: true });
      }
    });
    return () => sub.remove();
  }, [refreshStats, tryAutoSync]);

  function showFlash(type, title, sub, studentCode = "") {
    if (!mounted.current) return;
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setLastResult({ type, title, sub, studentCode: studentCode || lastCode.current.code });
    const color = type === "PRESENT" ? colors.green : type === "ERROR" ? colors.red : colors.orange;
    setFrameColor(color);

    // Continuous / Fast: chip only, no full-screen block
    if (continuousRef.current || fastRef.current) {
      setFlash({ type, title, sub, mini: true });
      const ms = continuousRef.current ? 280 : 400;
      flashTimer.current = setTimeout(() => {
        if (mounted.current) {
          setFlash(null);
          setFrameColor(colors.blue);
        }
      }, type === "ERROR" ? ms + 200 : ms);
      return;
    }

    setFlash({ type, title, sub, mini: false });
    const ms = type === "ERROR" || type === "ALREADY" ? 1600 : 1200;
    flashTimer.current = setTimeout(() => {
      if (mounted.current) {
        setFlash(null);
        setFrameColor(colors.blue);
      }
    }, ms);
  }


  // Auto-sync when ONLINE (not force offline)
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (!alive || forceOfflineRef.current) return;
      try {
        const net = await NetInfo.fetch();
        const on = !!(net.isConnected && net.isInternetReachable !== false);
        if (on) await tryAutoSync(null, { silent: true });
      } catch (_) {}
      try {
        const n = await pendingCount();
        if (mounted.current) {
          setPending(n);
          if (n >= 25) setQueueWarn(n + " scans waiting to sync — tap Sync");
          else if (n >= 10) setQueueWarn(n + " in offline queue");
          else setQueueWarn("");
        }
      } catch (_) {}
    };
    const id = setInterval(tick, 60000);
    tick();
    return () => { alive = false; clearInterval(id); };
  }, [tryAutoSync]);

  // Faster live stats (shared present count across gates when online)
  useEffect(() => {
    const id = setInterval(() => {
      if (online && !forceOfflineRef.current) refreshStats();
    }, 4000);
    return () => clearInterval(id);
  }, [online, refreshStats]);

  async function processCode(code, { source = "manual" } = {}) {
    try {
      // Verification credentials must never reach attendance recording or its
      // offline queue, including codes pasted through manual student entry.
      const rawMode = classifyQr(code);
      const studentCode = normalizeCode(code);
      const normalizedMode = classifyQr(studentCode);
      const verificationMode = [rawMode, normalizedMode].find((mode) => mode === "membership" || mode === "enrollment");
      if (verificationMode) {
        showFlash("ERROR", "Wrong scanner mode", verificationMode === "membership"
          ? "Choose Membership from Scanner modes to verify this card."
          : "Choose Enrollment Fee from Scanner modes to verify this receipt.");
        beepErr();
        return;
      }
      if (sessionClosed) {
        showFlash("ERROR", "Session closed", "Scanning locked");
        beepErr();
        return;
      }
      if (!studentCode) return;
      const studentKey = studentCode.toUpperCase();
      if (source === "camera" && confirmedKeys.current.has(studentKey)) return;
      if (studentCode.length < 3 || studentCode.length > 2048) {
        showFlash("ERROR", "Invalid QR", "The decoded value is incomplete or unsupported");
        beepErr();
        return;
      }

      // Optional QR / student-number pattern whitelist
      const pat = (qrPatternRef.current || "").trim();
      if (pat) {
        try {
          const re = new RegExp(pat, "i");
          if (!re.test(studentCode)) {
            showFlash("ERROR", "Invalid QR", "Code does not match allowed pattern");
            beepErr();
            return;
          }
        } catch (_) {}
      }

      const now = Date.now();
      // Per-student cooldown (default 3s)
      const cdMs = cooldownMsRef.current || 3000;
      const lastStu = cooldownMap.current.get(studentCode.toUpperCase()) || 0;
      if (cdMs > 0 && now - lastStu < cdMs) {
        // Camera libraries report the same visible QR many times per second.
        // Ignore those callbacks silently; ALREADY is reserved for a response
        // confirmed by UniOrg or an actual row already in the offline queue.
        return;
      }
      const dedupeMs = continuousRef.current ? 900 : fastRef.current ? 1200 : 2000;
      if (lastCode.current.code === studentCode && now - lastCode.current.at < dedupeMs) return;
      if (lock.current) return;
      lock.current = true;
      setProcessing(true);
      lastCode.current = { code: studentCode, at: now };

      const sessionId = session?.id;
      if (!sessionId) {
        lock.current = false;
        return;
      }

      const rosterHit = await lookupRoster(studentCode);
      const displayName = rosterHit?.full_name || studentCode;
      const programLine = rosterHit
        ? [rosterHit.program, rosterHit.year_level, rosterHit.section].filter(Boolean).join(" · ")
        : "";

      const scanned_at = new Date().toISOString();
      let isOnline = false;
      try {
        const net = await NetInfo.fetch();
        isOnline = !forceOfflineRef.current && !!(net.isConnected && net.isInternetReachable !== false);
      } catch (_) {
        isOnline = false;
      }

      if (isOnline && cfg?.baseUrl && cfg?.token) {
        try {
          const data = await scanStudent(cfg.baseUrl, cfg.token, {
            session_id: sessionId,
            student_code: studentCode,
            scanned_at,
            device_id: cfg.deviceId,
            gate: cfg.gateLabel,
            operator: cfg.operatorName,
          });
          const name = data.student?.full_name || displayName;
          const program =
            [data.student?.program, data.student?.year_level, data.student?.section]
              .filter(Boolean)
              .join(" · ") || programLine;
          cooldownMap.current.set(studentCode.toUpperCase(), Date.now());
          confirmedKeys.current.add(studentKey);
          if (data.already_present) {
            const when = data.marked_at || data.attendance_time || data.previous_time || "";
            const gateInfo = data.gate || data.device_id || "";
            const detail = [when ? ("at " + String(when).replace("T", " ").slice(0, 16)) : "", gateInfo ? ("· " + gateInfo) : "", program || "Already marked"]
              .filter(Boolean).join(" ");
            showFlash("ALREADY", name, detail || "Already marked present");
            beepErr();
          } else {
            const status = String(data.status || "PRESENT").toUpperCase();
            showFlash(status === "LATE" ? "LATE" : "PRESENT", name, program || data.message || "", data.student?.student_number || rosterHit?.student_number || studentCode);
            beepOk();
          }
          await pushHistory({
            name,
            status: data.already_present ? "ALREADY" : String(data.status || "PRESENT").toUpperCase(),
            student_code: studentCode,
            session_id: sessionId,
            at: scanned_at,
          });
          refreshStats();
        } catch (e) {
          const codeErr = e.code || e.payload?.code;
          if (codeErr === "SESSION_CLOSED" || /closed/i.test(String(e.message || ""))) {
            setSessionClosed(true);
            showFlash("ERROR", "Session closed", failReasonLabel(codeErr, e.message));
            beepErr();
          } else if (isRetryableApiError(e)) {
            await offlineEnqueue(sessionId, studentCode, scanned_at, displayName, programLine);
          } else {
            showFlash("ERROR", displayName, failReasonLabel(codeErr, e.message || e.payload?.message));
            beepErr();
          }
        }
      } else {
        await offlineEnqueue(sessionId, studentCode, scanned_at, displayName, programLine);
      }
    } catch (err) {
      showFlash("ERROR", "Scan error", String(err?.message || err));
      beepErr();
    } finally {
      const lockMs = continuousRef.current ? 320 : fastRef.current ? 450 : 750;
      setTimeout(() => {
        lock.current = false;
        if (mounted.current) setProcessing(false);
      }, lockMs);
    }
  }

  async function offlineEnqueue(sessionId, studentCode, scanned_at, displayName, programLine) {
    const key = studentCode.trim().toUpperCase();
    const label = displayName || studentCode;
    if (pendingKeys.current.has(key)) {
      showFlash("ALREADY", label, programLine || "Already waiting in the offline queue");
      beepErr();
      return;
    }
    const qres = await enqueueScan({ sessionId, studentCode, scannedAt: scanned_at });
    if (qres && qres.duplicate) {
      pendingKeys.current.add(key);
      showFlash("ALREADY", label, "Already in offline queue");
      beepErr();
      return;
    }
    pendingKeys.current.add(key);
    setPending(await pendingCount());
    cooldownMap.current.set(studentCode.toUpperCase(), Date.now());
    showFlash("QUEUED", label, programLine || "Saved safely · UniOrg verification pending");
    beepOk();
    await pushHistory({ name: label, status: "QUEUED", student_code: studentCode, session_id: sessionId, client_uid: qres.client_uid, at: scanned_at });
  }

  function handleBarcodeScanned({ data }) {
    const raw = String(data || "").trim();
    if (!raw || lock.current || sessionClosed) return;
    const now = Date.now();
    // A QR that stays inside the frame must create only one user-visible
    // result. This is the main guard against a successful scan being
    // immediately overwritten by a false-looking ALREADY message.
    if (lastCameraRead.current.raw === raw && now - lastCameraRead.current.at < 5000) return;
    lastCameraRead.current = { raw, at: now };
    processCode(raw, { source: "camera" });
  }

  async function onManualChange(text) {
    setManual(text);
    if (String(text).trim().length >= 2) {
      setManualHits(await searchRoster(text, 8));
    } else {
      setManualHits([]);
    }
  }

  async function doExport() {
    try {
      await exportKioskBundle({
        session,
        gate: cfg?.gateLabel,
        operator: cfg?.operatorName,
        pending: await queueAsBatchPayload(),
        failed: await getFailed(),
        history: await getHistory(),
        online,
        stats,
      });
    } catch (e) {
      Alert.alert("Export failed", e.message || String(e));
    }
  }

  async function toggleQuiet() {
    const next = !quiet;
    setQuiet(next);
    quietRef.current = next;
    await saveQuietMode(next);
    setMenuOpen(false);
  }

  const result = lastResult;
  const resultTone = result?.type === "PRESENT" ? "success" : result?.type === "ERROR" ? "error" : result ? "pending" : "ready";
  const resultColor = resultTone === "success" ? colors.green : resultTone === "error" ? colors.red : resultTone === "pending" ? "#ad6000" : colors.blue;
  const resultLabel = { PRESENT: "Present", LATE: "Late", QUEUED: "Queued", ALREADY: "Already scanned", ERROR: "Scan not accepted" }[result?.type] || "Ready to scan";
  const resultDetail = result?.type === "PRESENT" || result?.type === "LATE"
    ? [result.studentCode, "Confirmed by UniOrg"].filter(Boolean).join(" · ")
    : result?.type === "QUEUED" ? [result.studentCode, "Pending UniOrg verification"].filter(Boolean).join(" · ")
    : result?.sub || "Scan a student QR code to record attendance.";

  function submitManual(code = manual) {
    if (!String(code || "").trim() || processing || lock.current) return;
    setManualOpen(false);
    processCode(code);
    setManual("");
    setManualHits([]);
  }

  function chooseScannerMode() {
    setMenuOpen(false);
    navigation.dispatch(StackActions.popTo("Modes"));
  }

  return (
    <SafeAreaView style={ui.root}>
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={ui.headerRow}>
            <IconButton name="back" label="Back to sessions" onPress={() => navigation.goBack()} />
            <Text style={ui.screenTitle}>QR Scanner</Text>
            <ConnectionBadge online={online && !forceOffline} />
            <IconButton name="more" label="Scanner controls" onPress={() => setMenuOpen(true)} />
          </View>
          <Text style={styles.session} numberOfLines={2}>{session?.title || session?.session_name || `Session #${session?.id}`}</Text>
          <Text style={styles.sessionMeta}>{cfg?.gateLabel || "Gate A"} · Session #{session?.id}</Text>
          <MetricStrip metrics={[
            { value: stats.present, label: "Present", labelColor: colors.blue },
            { value: stats.late, label: "Late" },
            { value: pending, label: "Pending", warning: pending > 0, onPress: () => navigation.navigate("Queue") },
          ]} />
          {sessionClosed && <View style={[styles.notice, styles.errorNotice]}><Text style={styles.errorText}>Session closed · scanning locked</Text></View>}
          {!sessionClosed && (forceOffline || !online) && <View style={styles.notice}><Text style={styles.noticeText}>Offline · scans are saved pending verification</Text></View>}
        </View>
        <View style={[styles.cameraWrap, { height: Math.max(220, Math.min(350, height * 0.37)) }]}>
          {permission?.granted && !cameraError ? (isFocused && !manualOpen && !endOpen && (
            <CameraView
              style={styles.camera}
              facing="back"
              active={isFocused && !manualOpen && !endOpen && !menuOpen}
              enableTorch={torch}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={sessionClosed || manualOpen || menuOpen ? undefined : handleBarcodeScanned}
              onMountError={(error) => setCameraError(error.message || "Unable to open this device camera.")}
            />
          )) : (
            <View style={styles.cameraFallback}>
              <Icon name="calendar" size={35} color="white" />
              <Text style={styles.cameraFallbackTitle}>{cameraError ? "Camera unavailable" : "Camera access needed"}</Text>
              <Text style={styles.cameraFallbackText}>{cameraError || "Allow camera access to scan student QR codes."}</Text>
              <Button label={cameraError ? "Try camera again" : "Allow camera"} onPress={() => { setCameraError(""); requestPermission(); }} />
            </View>
          )}
          {!!permission?.granted && !cameraError && <View pointerEvents="none" style={styles.frameOverlay}>
            <View style={[styles.corner, styles.tl, { borderColor: frameColor }]} /><View style={[styles.corner, styles.tr, { borderColor: frameColor }]} />
            <View style={[styles.corner, styles.bl, { borderColor: frameColor }]} /><View style={[styles.corner, styles.br, { borderColor: frameColor }]} />
            <View style={styles.scanLine} />
          </View>}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={torch ? "Turn flash off" : "Turn flash on"} onPress={() => setTorch(!torch)} style={styles.cameraFlash}><Icon name="flash" color="white" size={23} /></TouchableOpacity>
          {(processing || syncing) && <View style={styles.activityChip}><ActivityIndicator color="white" size="small" /><Text style={styles.activityText}>{processing ? (forceOffline || !online ? "Saving scan…" : "Verifying with UniOrg…") : "Syncing queue…"}</Text></View>}
          {sessionClosed && <View style={styles.lockOverlay}><Icon name="shield" color="white" size={36} /><Text style={styles.lockTitle}>Scanning locked</Text><Button label="Back to sessions" onPress={() => navigation.goBack()} /></View>}
        </View>
        <Text style={styles.scanPrompt}>Align QR code inside the frame</Text>
        <TouchableOpacity style={[styles.resultCard, resultTone === "success" ? styles.resultSuccess : resultTone === "error" ? styles.resultError : resultTone === "pending" ? styles.resultPending : styles.resultReady]} accessibilityLiveRegion="polite" accessibilityRole="button" accessibilityLabel={`${resultLabel}. Open scan history`} onPress={() => navigation.navigate("History", { sessionId: session?.id })}>
          <View style={[styles.resultIcon, { backgroundColor: resultColor }]}><Icon name={resultTone === "error" ? "close" : resultTone === "pending" ? "clock" : resultTone === "ready" ? "calendar" : "check"} size={26} color="white" strokeWidth={2.3} /></View>
          <View style={styles.resultCopy}><Text style={[styles.resultLabel, { color: resultColor }]}>{resultLabel}</Text>{!!result && <Text style={styles.resultName} numberOfLines={2}>{result.title}</Text>}<Text style={[styles.resultDetail, resultTone === "success" && { color: "#287662" }]} numberOfLines={2}>{resultDetail}</Text></View>
          <Icon name="chevron" size={17} color={resultColor} />
        </TouchableOpacity>
        <Button secondary icon="keyboard" label="Enter student number" onPress={() => setManualOpen(true)} disabled={sessionClosed || processing} style={styles.manualButton} />
        <View style={styles.toolbar}>
          <TouchableOpacity style={[styles.toolBtn, torch && styles.toolOn]} accessibilityRole="button" onPress={() => setTorch(!torch)}><Icon name="flash" size={21} color={torch ? colors.blue : colors.navy} /><Text style={styles.toolText}>{torch ? "Flash on" : "Flash"}</Text></TouchableOpacity>
          <TouchableOpacity style={styles.toolBtn} accessibilityRole="button" onPress={() => tryAutoSync(null, { silent: false })} disabled={syncing}>{syncing ? <ActivityIndicator color={colors.blue} /> : <Icon name="sync" size={21} />}<Text style={styles.toolText}>Sync</Text></TouchableOpacity>
          <TouchableOpacity style={styles.toolBtn} accessibilityRole="button" onPress={() => setMenuOpen(true)}><Icon name="more" size={21} /><Text style={styles.toolText}>More</Text></TouchableOpacity>
        </View>
        <TouchableOpacity accessibilityRole="button" onPress={() => navigation.navigate("Queue")} style={styles.pendingLine}><View style={[ui.dot, { backgroundColor: pending ? colors.orange : colors.green }]} /><Text style={styles.pendingText}>{pending ? `${pending} ${pending === 1 ? "scan" : "scans"} pending upload` : "All scans are synced"}{queueWarn && pending ? " · View queue" : ""}</Text></TouchableOpacity>
      </ScrollView>

      <Modal visible={manualOpen} transparent animationType="slide" onRequestClose={() => setManualOpen(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={styles.modalDismiss} onPress={() => setManualOpen(false)} accessibilityLabel="Close manual entry" />
          <SafeAreaView edges={["bottom"]} style={styles.manualSheet}>
            <View style={styles.sheetHeader}><Text style={styles.menuTitle}>Enter student number</Text><IconButton name="close" label="Close manual entry" onPress={() => setManualOpen(false)} /></View>
            <Text style={styles.modalDescription}>Enter a student number or search the offline roster.</Text>
            <View style={styles.manual}>
              <TextInput style={styles.input} placeholder="Name or student number" placeholderTextColor="#7d8fa3" value={manual} onChangeText={onManualChange} autoCapitalize="characters" autoFocus onSubmitEditing={() => submitManual()} returnKeyType="go" />
              <Button label="Mark" onPress={() => submitManual()} disabled={!manual.trim() || processing || sessionClosed} />
            </View>
            <ScrollView style={styles.hits} keyboardShouldPersistTaps="handled">
              {manualHits.map((student) => <TouchableOpacity key={student.student_id || student.student_number} style={styles.hitRow} onPress={() => submitManual(student.qr_payload || student.student_number || student.student_id)}><Text style={styles.hitName}>{student.full_name}</Text><Text style={styles.hitMeta}>{student.student_number || student.student_id} · {[student.program, student.section].filter(Boolean).join(" ")}</Text></TouchableOpacity>)}
            </ScrollView>
            <Button secondary label="Scan history" icon="clock" style={styles.historyButton} onPress={() => { setManualOpen(false); navigation.navigate("History", { sessionId: session?.id }); }} />
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
      {/* More menu */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
          <Pressable style={styles.menuSheet} onPress={() => {}}>
            <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.menuTitle}>Scanner controls</Text>
            <TouchableOpacity style={styles.menuItem} onPress={chooseScannerMode}><Text style={styles.menuItemText}>Choose scanner mode</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); doExport(); }}><Text style={styles.menuItemText}>Export attendance records</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); navigation.navigate("Queue"); }}><Text style={styles.menuItemText}>Open Sync Center</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); navigation.navigate("History", { sessionId: session?.id }); }}><Text style={styles.menuItemText}>Scan history</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); navigation.navigate("SessionTotals", { session }); }}><Text style={styles.menuItemText}>Live session totals</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => {
              setMenuOpen(false);
              Alert.alert(
                "Session lock PIN",
                "Protect leaving scanner / changing session.",
                [
                  { text: "Clear PIN", onPress: async () => { sessionPinRef.current = ""; await saveSessionPin(""); Alert.alert("PIN cleared"); } },
                  {
                    text: "Set 1234",
                    onPress: async () => {
                      sessionPinRef.current = "1234";
                      await saveSessionPin("1234");
                      Alert.alert("PIN set to 1234");
                    },
                  },
                  { text: "Cancel", style: "cancel" },
                ]
              );
            }}>
              <Text style={styles.menuItemText}>Session lock PIN</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={async () => {
              const next = !forceOffline;
              setForceOffline(next);
              forceOfflineRef.current = next;
              await saveForceOffline(next);
              setMenuOpen(false);
              if (!next && online) {
                try { await tryAutoSync(null, { silent: false }); } catch (_) {}
              }
            }}>
              <Text style={[styles.menuItemText, { fontWeight: "800", color: forceOffline ? "#a85800" : colors.green }]}>
                {forceOffline ? "Mode: OFFLINE (switch to Online)" : "Mode: ONLINE (switch to Offline)"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={toggleQuiet}>
              <Text style={styles.menuItemText}>{quiet ? "Loud mode (beep on)" : "Quiet mode (vibrate only)"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={async () => {
              const next = !fast;
              setFast(next);
              fastRef.current = next;
              await saveFastMode(next);
              setMenuOpen(false);
            }}>
              <Text style={styles.menuItemText}>{fast ? "Normal speed" : "Fast mode (shorter lock)"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={async () => {
              const next = !continuous;
              setContinuous(next);
              continuousRef.current = next;
              await saveContinuousMode(next);
              if (next) {
                setFast(true);
                fastRef.current = true;
                await saveFastMode(true);
              }
              setMenuOpen(false);
            }}>
              <Text style={styles.menuItemText}>{continuous ? "Turn off continuous scanning" : "Continuous scanning"}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.menuItem, rosterDownloading && { opacity: 0.6 }]}
              disabled={rosterDownloading}
              onPress={async () => {
                setMenuOpen(false);
                await downloadRoster(null, { toast: true, force: true });
              }}
            >
              <View style={styles.menuItemRow}>
                {rosterDownloading ? (
                  <ActivityIndicator size="small" color={colors.blue} />
                ) : (
                  <Lineicons icon={Download1Stroke} size={18} color={colors.blue} strokeWidth={2} />
                )}
                <Text style={styles.menuItemText}>{rosterDownloading ? "Downloading roster…" : "Download roster now"}</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                setEndOpen(true);
              }}
            >
              <Text style={styles.menuItemText}>End event summary</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={async () => {
                setMenuOpen(false);
                const text =
                  `${cfg?.gateLabel || "Gate"} · ${cfg?.operatorName || ""}\n` +
                  `${session?.title || session?.session_name} #${session?.id}\n` +
                  `Present ${stats.present} · Late ${stats.late} · Queue ${pending}\n` +
                  `Roster ${rosterCount} · ${new Date().toLocaleString()}`;
                try {
                  await Share.share({ message: text });
                } catch (_) {}
              }}
            >
              <Text style={styles.menuItemText}>Share text summary</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => setMenuOpen(false)}>
              <Text style={[styles.menuItemText, { color: "#94a3b8" }]}>Close</Text>
            </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>


      <Modal visible={!!pinPrompt} transparent animationType="fade" onRequestClose={() => setPinPrompt(null)}>
        <KeyboardAvoidingView style={styles.centeredBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.pinCard}>
            <Text style={styles.menuTitle}>Enter session PIN</Text><Text style={styles.modalDescription}>Unlock this scanner to leave the session.</Text>
            <TextInput style={[styles.input, { marginVertical: 16 }]} value={pinInput} onChangeText={setPinInput} keyboardType="number-pad" secureTextEntry placeholder="Session PIN" placeholderTextColor="#7d8fa3" autoFocus />
            <View style={styles.pinActions}><Button secondary label="Cancel" onPress={() => setPinPrompt(null)} style={{ flex: 1 }} /><Button label="Unlock" style={{ flex: 1 }} onPress={() => { if (String(pinInput) === String(sessionPinRef.current)) { const action = pinPrompt?.action; setPinPrompt(null); if (action) { allowSessionExit.current = true; navigation.dispatch(action); } } else Alert.alert("Wrong PIN"); }} /></View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={endOpen} animationType="slide" onRequestClose={() => setEndOpen(false)}>
        <SafeAreaView style={ui.root}><ScrollView contentContainerStyle={styles.summaryPage}>
          <View style={styles.sheetHeader}><Text style={styles.menuTitle}>Event summary</Text><IconButton name="close" label="Close event summary" onPress={() => setEndOpen(false)} /></View>
          <Text style={styles.session}>{session?.title || session?.session_name}</Text>
          <Text style={styles.sessionMeta}>{cfg?.gateLabel || "Gate"} · {cfg?.operatorName || cfg?.deviceId || ""}</Text>
          <View style={styles.endGrid}>{[{ label: "Present", value: stats.present }, { label: "Late", value: stats.late }, { label: "Marked", value: stats.marked }, { label: "Pending", value: pending }].map((item) => <View style={styles.endCard} key={item.label}><Text style={[styles.endNum, item.label === "Pending" && { color: colors.orange }]}>{item.value}</Text><Text style={styles.endLabel}>{item.label}</Text></View>)}</View>
          <Text style={styles.modalDescription}>{online && !forceOffline ? "Confirmed totals include all gates in this session." : "Showing last downloaded session totals. Pending scans await verification."}</Text>
          <Text style={styles.modalDescription}>{rosterCount.toLocaleString()} students in offline roster</Text>
          <Button icon="upload" label="Export attendance records" onPress={doExport} style={{ marginTop: 20 }} />
          <Button secondary label="Close summary" onPress={() => setEndOpen(false)} style={{ marginTop: 10 }} />
        </ScrollView></SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = createStyles({
  page: { flexGrow: 1, paddingBottom: 6 },
  header: { paddingHorizontal: 20, paddingTop: 2 },
  session: { color: colors.navy, fontSize: 24, lineHeight: 29, fontWeight: "800", letterSpacing: -0.5, marginTop: 12 },
  sessionMeta: { color: colors.muted, fontSize: 14, marginTop: 4, marginBottom: 12 },
  cameraWrap: { marginTop: 12, marginHorizontal: 16, borderRadius: 18, overflow: "hidden", position: "relative", backgroundColor: "#20252d" },
  camera: { flex: 1 },
  frameOverlay: { ...StyleSheet.absoluteFillObject },
  corner: { position: "absolute", width: 29, height: 29, borderColor: colors.blue },
  tl: { top: "18%", left: "20%", borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 9 },
  tr: { top: "18%", right: "20%", borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 9 },
  bl: { bottom: "12%", left: "20%", borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 9 },
  br: { bottom: "12%", right: "20%", borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 9 },
  scanLine: { position: "absolute", top: "50%", left: "20%", right: "20%", height: 1, backgroundColor: "#65adff" },
  cameraFlash: { position: "absolute", right: 12, bottom: 12, width: 45, height: 45, borderRadius: 24, backgroundColor: "rgba(7,13,23,0.85)", alignItems: "center", justifyContent: "center" },
  scanPrompt: { color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 8, marginBottom: 12 },
  activityChip: { position: "absolute", top: 12, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, backgroundColor: "rgba(7,22,56,0.9)" },
  activityText: { color: "white", fontSize: 12 },
  cameraFallback: { flex: 1, justifyContent: "center", alignItems: "center", padding: 26, gap: 11 },
  cameraFallbackTitle: { color: "white", fontSize: 18, fontWeight: "700" },
  cameraFallbackText: { color: "#dce6f3", textAlign: "center", fontSize: 12, lineHeight: 18 },
  lockOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(7,22,56,0.95)", justifyContent: "center", alignItems: "center", gap: 16 },
  lockTitle: { color: "white", fontSize: 22, fontWeight: "700" },
  resultCard: { marginHorizontal: 20, borderRadius: 13, paddingHorizontal: 15, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 14, minHeight: 79 },
  resultSuccess: { backgroundColor: "#e4f6ef" },
  resultPending: { backgroundColor: colors.amberSoft },
  resultError: { backgroundColor: colors.redSoft },
  resultReady: { backgroundColor: colors.blueSoft },
  resultIcon: { width: 45, height: 45, borderRadius: 25, justifyContent: "center", alignItems: "center" },
  resultCopy: { flex: 1 },
  resultLabel: { fontSize: 17, fontWeight: "700" },
  resultName: { color: colors.navy, fontSize: 14, fontWeight: "600", marginTop: 2 },
  resultDetail: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  manualButton: { marginHorizontal: 20, marginTop: 12, minHeight: 46 },
  toolbar: { flexDirection: "row", gap: 8, marginHorizontal: 20, marginTop: 10 },
  toolBtn: { flex: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 13, paddingVertical: 9, alignItems: "center", justifyContent: "center", minHeight: 57, gap: 5 },
  toolOn: { backgroundColor: colors.blueSoft, borderColor: "#b2d3ff" },
  toolText: { color: colors.navy, fontSize: 11 },
  pendingLine: { minHeight: 45, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 20, marginTop: "auto" },
  pendingText: { color: colors.muted, fontSize: 11, flexShrink: 1 },
  notice: { padding: 9, borderRadius: 10, backgroundColor: colors.amberSoft, marginTop: 10 },
  noticeText: { color: "#ad6000", fontSize: 11, textAlign: "center" },
  errorNotice: { backgroundColor: colors.redSoft },
  errorText: { color: colors.red, fontSize: 12, textAlign: "center" },
  menuBackdrop: { flex: 1, backgroundColor: "rgba(7,22,56,0.3)", justifyContent: "flex-end" },
  menuSheet: { backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 34, maxHeight: "85%" },
  menuTitle: { color: colors.navy, fontSize: 21, fontWeight: "800" },
  menuItem: { paddingVertical: 15, borderBottomWidth: 1, borderColor: colors.border },
  menuItemText: { color: colors.navy, fontSize: 14 },
  menuItemRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(7,22,56,0.3)", justifyContent: "flex-end" },
  modalDismiss: { flex: 1 },
  manualSheet: { backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 22, paddingTop: 14, maxHeight: "75%" },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalDescription: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 8 },
  manual: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 15, marginBottom: 10 },
  input: { flex: 1, minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 10, fontSize: 14, color: colors.navy, backgroundColor: colors.surface },
  hits: { maxHeight: 300 },
  hitRow: { paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.border },
  hitName: { color: colors.navy, fontSize: 13, fontWeight: "600" },
  hitMeta: { color: colors.muted, fontSize: 11, marginTop: 4 },
  historyButton: { marginVertical: 10 },
  centeredBackdrop: { flex: 1, backgroundColor: "rgba(7,22,56,0.4)", justifyContent: "center", padding: 24 },
  pinCard: { backgroundColor: colors.background, borderRadius: 22, padding: 22 },
  pinActions: { flexDirection: "row", gap: 10 },
  summaryPage: { padding: 22 },
  endGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 18, marginBottom: 12 },
  endCard: { width: "47%", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 15, padding: 20 },
  endNum: { color: colors.navy, fontSize: 28, fontWeight: "800" },
  endLabel: { color: colors.muted, fontSize: 12, marginTop: 4 },
});
