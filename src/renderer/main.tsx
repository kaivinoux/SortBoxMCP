import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.js";
import { I18nProvider } from "./i18n/I18nContext.js";
import "./index.css";
import { installPlatformBridge } from "./platform/androidBridge.js";

installPlatformBridge();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);
