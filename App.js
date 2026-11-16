import React, { useEffect, useState } from "react";
import { ActivityIndicator, View, Image } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import { loadConfig } from "./src/db/storage";
import SetupScreen from "./src/screens/SetupScreen";
import ModesScreen from "./src/screens/ModesScreen";
import SessionsScreen from "./src/screens/SessionsScreen";
import ScannerScreen from "./src/screens/ScannerScreen";
import VerificationScreen from "./src/screens/VerificationScreen";
import QueueScreen from "./src/screens/QueueScreen";
import ReadinessScreen from "./src/screens/ReadinessScreen";
import ScanHistoryScreen from "./src/screens/ScanHistoryScreen";
import SessionTotalsScreen from "./src/screens/SessionTotalsScreen";
import { colors } from "./src/components/ScannerUI";
import RequiredUpdate from "./src/components/RequiredUpdate";

const Stack = createNativeStackNavigator();

const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.surface,
    primary: colors.blue,
    text: colors.navy,
    border: colors.border,
  },
};

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular: require("@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf"),
    Inter_500Medium: require("@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf"),
    Inter_600SemiBold: require("@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf"),
    Inter_700Bold: require("@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf"),
    Inter_800ExtraBold: require("@expo-google-fonts/inter/800ExtraBold/Inter_800ExtraBold.ttf"),
  });
  const [ready, setReady] = useState(false);
  const [initial, setInitial] = useState("Setup");

  useEffect(() => {
    (async () => {
      try {
        const cfg = await loadConfig();
        if (cfg.baseUrl && cfg.token) setInitial("Modes");
      } catch (_) {
        setInitial("Setup");
      } finally {
        setReady(true);
      }
    })();
  }, []);

  if (!ready || (!fontsLoaded && !fontError)) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Image
          source={require("./assets/adaptive-icon-square.png")}
          style={{ width: 180, height: 180, opacity: 0.2, position: "absolute" }}
          resizeMode="contain"
        />
        <ActivityIndicator color={colors.blue} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <RequiredUpdate>
        <NavigationContainer theme={theme}>
          <Stack.Navigator initialRouteName={initial} screenOptions={{ headerShown: false, animation: "fade_from_bottom" }}>
            <Stack.Screen name="Setup" component={SetupScreen} />
            <Stack.Screen name="Modes" component={ModesScreen} />
            <Stack.Screen name="Sessions" component={SessionsScreen} />
            <Stack.Screen name="Scanner" component={ScannerScreen} />
            <Stack.Screen name="Verification" component={VerificationScreen} />
            <Stack.Screen name="Queue" component={QueueScreen} />
            <Stack.Screen name="Readiness" component={ReadinessScreen} />
            <Stack.Screen name="History" component={ScanHistoryScreen} />
            <Stack.Screen name="SessionTotals" component={SessionTotalsScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </RequiredUpdate>
    </SafeAreaProvider>
  );
}
