import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.iaforeveryone.sortboxemail",
  appName: "SortBox E-Mail",
  webDir: "dist",
  android: {
    allowMixedContent: false,
  },
};

export default config;
