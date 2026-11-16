/**
 * Scan beeps — play on media stream without needing a volume-button "unlock".
 */
import { Audio } from "expo-av";

let successSound = null;
let errorSound = null;
let ready = false;
let initPromise = null;

export async function initBeeps() {
  if (ready) return true;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const mode = {
        playsInSilentModeIOS: true,
        allowsRecordingIOS: false,
        staysActiveInBackground: false,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      };
      // SDK variants for interruption mode
      try {
        if (Audio.InterruptionModeAndroid != null) {
          mode.interruptionModeAndroid = Audio.InterruptionModeAndroid.DuckOthers;
        }
        if (Audio.InterruptionModeIOS != null) {
          mode.interruptionModeIOS = Audio.InterruptionModeIOS.DuckOthers;
        }
      } catch (_) {}
      await Audio.setAudioModeAsync(mode);

      const s = await Audio.Sound.createAsync(
        require("../../assets/beep.wav"),
        { shouldPlay: false, volume: 1.0, isLooping: false }
      );
      successSound = s.sound;
      const e = await Audio.Sound.createAsync(
        require("../../assets/beep_error.wav"),
        { shouldPlay: false, volume: 1.0, isLooping: false }
      );
      errorSound = e.sound;

      // Warm-up play at near-zero volume so Android media session is active
      try {
        await successSound.setVolumeAsync(0.01);
        await successSound.playAsync();
        await successSound.stopAsync();
        await successSound.setPositionAsync(0);
        await successSound.setVolumeAsync(1.0);
      } catch (_) {
        try {
          await successSound.setVolumeAsync(1.0);
        } catch (__) {}
      }

      ready = true;
      return true;
    } catch (err) {
      console.warn("Beep init failed", err);
      ready = false;
      initPromise = null;
      return false;
    }
  })();
  return initPromise;
}

async function play(sound) {
  if (!sound) return;
  try {
    await sound.setVolumeAsync(1.0);
  } catch (_) {}
  try {
    const st = await sound.getStatusAsync();
    if (st.isLoaded) {
      if (st.isPlaying) {
        try {
          await sound.stopAsync();
        } catch (_) {}
      }
      await sound.setPositionAsync(0);
      await sound.playAsync();
      return;
    }
  } catch (_) {}
  try {
    await sound.replayAsync();
  } catch (_) {
    try {
      await sound.playAsync();
    } catch (__) {}
  }
}

export async function playSuccessBeep() {
  await initBeeps();
  await play(successSound);
}

export async function playErrorBeep() {
  await initBeeps();
  await play(errorSound);
}
