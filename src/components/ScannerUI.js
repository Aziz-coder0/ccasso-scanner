import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

export const colors = {
  background: "#f9fcff", surface: "#ffffff", navy: "#071638", muted: "#49617f",
  blue: "#075ce5", blueSoft: "#edf5ff", border: "#e0e9f3", orange: "#ff8500",
  amberSoft: "#fff1db", green: "#13823b", greenSoft: "#e8f7ef",
  red: "#c63f36", redSoft: "#fff0ee", graySoft: "#eff4f9",
};

export function createStyles(definitions) {
  const families = { "400": "Inter_400Regular", "500": "Inter_500Medium", "600": "Inter_600SemiBold", "700": "Inter_700Bold", "800": "Inter_800ExtraBold", "900": "Inter_800ExtraBold" };
  return StyleSheet.create(Object.fromEntries(Object.entries(definitions).map(([name, style]) => [
    name, style.fontSize || style.fontWeight ? { ...style, fontFamily: families[style.fontWeight || "400"], fontWeight: "normal" } : style,
  ])));
}

// Small, code-native UI glyphs keep the Expo Go bundle light.
const paths = {
  back: "M19 12H5m6-6-6 6 6 6",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  chevron: "m9 6 6 6-6 6",
  down: "m6 9 6 6 6-6",
  sync: "M20 7v5h-5M4 17v-5h5M19.4 8a8 8 0 0 0-13.7-2L4 8m16 8-1.7 2A8 8 0 0 1 4.6 16",
  check: "m6 12 4 4 8-8",
  flash: "m13 2-8 12h6l-1 8 9-12h-6l1-8Z",
  upload: "M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5",
  cloudUpload: "M6 18a4 4 0 0 1-1-7.9A7 7 0 0 1 18.7 8a5 5 0 0 1 .3 10M12 21V10m-4 4 4-4 4 4",
  warning: "m10.3 4-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0ZM12 9v4m0 4v.1",
  close: "m6 6 12 12M6 18 18 6",
  shield: "m12 2 8 3v6c0 5-4 8-8 11-4-3-8-6-8-11V5l8-3Zm-4 10 3 3 5-6",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M8 12h8m-8 4h8",
  scan: "M8 3H4a1 1 0 0 0-1 1v4m13-5h4a1 1 0 0 1 1 1v4M3 16v4a1 1 0 0 0 1 1h4m8 0h4a1 1 0 0 0 1-1v-4M7 12h10M8 7h1v2H7V7h1Zm8 0h1v2h-2V7h1ZM8 15h1v2H7v-2h1Zm7 0h2v2",
  pin: "M19 9c0 5-7 12-7 12S5 14 5 9a7 7 0 0 1 14 0Z",
};

export function Icon({ name, size = 22, color = colors.navy, strokeWidth = 1.8, filled = false }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden={true}>
      {paths[name] && <Path d={paths[name]} fill={filled ? color : "none"} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />}
      {name === "clock" && <><Circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeWidth={strokeWidth} /><Path d="M12 6v6l4 3" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" /></>}
      {name === "info" && <><Circle cx="12" cy="12" r="10" fill={color} /><Path d="M12 11v6m0-10v.2" stroke="white" strokeWidth="2" strokeLinecap="round" /></>}
      {name === "pin" && <Circle cx="12" cy="9" r="2" fill="none" stroke={color} strokeWidth={strokeWidth} />}
      {name === "calendar" && <><Rect x="4" y="5" width="16" height="16" rx="2" fill={filled ? color : "none"} stroke={color} strokeWidth={strokeWidth} /><Path d="M8 3v4m8-4v4M4 10h16" stroke={filled ? colors.background : color} strokeWidth={strokeWidth} strokeLinecap="round" /><Path d="M8 14h2m4 0h2m-8 4h2" stroke={filled ? colors.background : color} strokeWidth="2" /></>}
      {name === "keyboard" && <><Rect x="2" y="5" width="20" height="14" rx="2" fill="none" stroke={color} strokeWidth={strokeWidth} /><Path d="M5 9h1m3 0h1m3 0h1m3 0h1M5 12h1m3 0h1m3 0h1m3 0h1M7 16h10" stroke={color} strokeWidth="2" strokeLinecap="round" /></>}
      {name === "more" && <>{[5, 12, 19].map((cx) => <Circle key={cx} cx={cx} cy="12" r="1.7" fill={color} />)}</>}
      {name === "settings" && <><Path d="m10 2-1 3-3-1-2 3 2 2-1 3-3 1 1 4 3 .2 2 2-.7 3 4 1 1-3 3-1 2 2 3-3-2-2 1-3 3-1-1-4-3-.2-2-2 .7-3-4-1Z" fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" /><Circle cx="12" cy="12" r="3" fill="none" stroke={color} strokeWidth="1.7" /></>}
    </Svg>
  );
}

export function IconButton({ name, label, onPress, disabled, color = colors.muted }) {
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled} style={[ui.iconButton, disabled && ui.disabled]}><Icon name={name} color={color} /></TouchableOpacity>;
}

export function Brand() {
  return <View><Text style={ui.brand}>CCASSO</Text><Text style={ui.brandSub}>SCANNER</Text></View>;
}

export function ConnectionBadge({ online }) {
  if (online == null) return <View style={[ui.connection, { backgroundColor: colors.graySoft }]}><ActivityIndicator size="small" color={colors.muted} /><Text style={[ui.connectionText, { color: colors.muted }]}>Checking network</Text></View>;
  return <View style={[ui.connection, !online && ui.connectionOffline]}><View style={[ui.dot, { backgroundColor: online ? colors.green : colors.orange }]} /><Text style={[ui.connectionText, !online && { color: "#a85800" }]}>{online ? "Online" : "Offline"}</Text></View>;
}

export function MetricStrip({ metrics, bordered = false }) {
  return <View style={[ui.metrics, bordered && ui.metricsBorder]}>{metrics.map(({ value, label, warning, labelColor, onPress }, index) => {
    const contents = <><Text style={[ui.metricValue, warning && { color: colors.orange }]}>{value}</Text><Text style={[ui.metricLabel, labelColor && { color: labelColor }, warning && { color: "#ba6100" }]}>{label}</Text></>;
    return <View key={label} style={[ui.metric, index > 0 && ui.metricDivider]}>{onPress ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${value} ${label}`} onPress={onPress} style={ui.metricTouch}>{contents}</TouchableOpacity> : contents}</View>;
  })}</View>;
}

export function Button({ label, icon, iconEnd, onPress, busy = false, disabled = false, secondary = false, style }) {
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || busy, busy }} onPress={onPress} disabled={disabled || busy} activeOpacity={0.8} style={[ui.button, secondary && ui.secondaryButton, (disabled || busy) && ui.disabled, style]}>{busy ? <ActivityIndicator color={secondary ? colors.blue : "white"} /> : <>{icon && <Icon name={icon} size={21} color={secondary ? colors.blue : "white"} />}<Text style={[ui.buttonText, secondary && { color: colors.blue }]}>{label}</Text>{iconEnd && <Icon name={iconEnd} size={19} color={secondary ? colors.blue : "white"} />}</>}</TouchableOpacity>;
}

export function BottomNav({ navigation, active, pending = 0, disabled = false }) {
  return <View style={ui.nav}>{[{ route: "Modes", label: "Home", icon: "scan" }, { route: "Sessions", label: "Attendance", icon: "calendar" }, { route: "Queue", label: "Sync", icon: "sync" }, { route: "Setup", label: "Setup", icon: "settings" }].map((item) => {
    const selected = active === item.route;
    return <TouchableOpacity key={item.route} testID={`nav-${item.route.toLowerCase()}`} accessibilityRole="tab" accessibilityLabel={item.route === "Modes" ? "Home, choose scanner mode" : item.label} accessibilityState={{ selected, disabled }} onPress={() => { if (!selected) navigation.navigate(item.route, undefined, { pop: true }); }} disabled={disabled} style={ui.navItem}><View><Icon name={item.icon} color={selected ? colors.blue : colors.muted} filled={selected && item.icon === "calendar"} />{item.route === "Queue" && pending > 0 && <View style={ui.navBadge}><Text style={ui.navBadgeText}>{pending > 99 ? "99+" : pending}</Text></View>}</View><Text style={[ui.navLabel, selected && { color: colors.blue }]}>{item.label}</Text></TouchableOpacity>;
  })}</View>;
}

export function sessionDate(value) {
  if (!value) return "Date not set";
  const date = new Date(String(value).length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function localTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export const ui = createStyles({
  root: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: "row", alignItems: "center", minHeight: 48 },
  screenTitle: { color: colors.navy, fontSize: 16, fontWeight: "700", flex: 1, marginLeft: 7 },
  heading: { color: colors.navy, fontSize: 28, fontWeight: "800", letterSpacing: -0.7 },
  body: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  iconButton: { width: 42, height: 44, justifyContent: "center", alignItems: "center" },
  brand: { color: "#07388b", fontSize: 23, fontWeight: "900", letterSpacing: -0.7 },
  brandSub: { color: "#7992b0", fontSize: 9, letterSpacing: 5, fontWeight: "600", marginTop: 1 },
  connection: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#e2fbe7", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  connectionOffline: { backgroundColor: colors.amberSoft },
  connectionText: { color: colors.green, fontSize: 11, fontWeight: "600" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  metrics: { flexDirection: "row", paddingVertical: 13, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  metricsBorder: { borderWidth: 1, borderRadius: 15, backgroundColor: colors.surface, paddingVertical: 14 },
  metric: { flex: 1, justifyContent: "center", alignItems: "center" },
  metricDivider: { borderLeftWidth: 1, borderColor: colors.border },
  metricTouch: { alignItems: "center", width: "100%" },
  metricValue: { fontSize: 23, fontWeight: "800", color: colors.navy, letterSpacing: -0.5 },
  metricLabel: { fontSize: 12, color: colors.navy, marginTop: 3 },
  button: { minHeight: 46, borderRadius: 10, backgroundColor: colors.blue, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  secondaryButton: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.blue },
  buttonText: { color: "white", fontSize: 14, fontWeight: "700" },
  disabled: { opacity: 0.5 },
  nav: { flexDirection: "row", borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.background, paddingTop: 9, paddingBottom: 4 },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 55, gap: 5 },
  navLabel: { color: colors.muted, fontSize: 11, fontWeight: "500" },
  navBadge: { position: "absolute", left: 18, top: -4, backgroundColor: colors.orange, minWidth: 20, paddingHorizontal: 4, height: 17, borderRadius: 9, borderWidth: 1.5, borderColor: colors.background, alignItems: "center", justifyContent: "center" },
  navBadgeText: { color: "white", fontSize: 9, fontWeight: "700" },
});
