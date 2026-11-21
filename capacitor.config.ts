import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.atulpatildbz.chessfsrs",
  appName: "chessfsrs",
  webDir: "dist",
  // Transparent until the page paints, so start-up shows the window background, which follows the
  // device's day/night setting (res/values-night/colors.xml) instead of always flashing dark.
  android: { backgroundColor: "#00000000" },
  plugins: {
    // index.html asks for viewport-fit=cover; saying so up front avoids a relayout at start-up.
    SystemBars: { initialViewportFitValueHint: "cover" },
  },
};

export default config;
