import React from "react";
import { View, Image, StyleSheet, Dimensions } from "react-native";

const { width, height } = Dimensions.get("window");
const size = Math.min(width, height) * 0.72;

/**
 * Low-opacity CCASSO logo centered behind screen content.
 */
export default function LogoBackdrop({ opacity = 0.08, style }) {
  return (
    <View pointerEvents="none" style={[styles.wrap, style]}>
      <Image
        source={require("../../assets/adaptive-icon.png")}
        style={{ width: size, height: size, opacity }}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 0,
  },
});
