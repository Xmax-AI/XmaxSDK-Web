import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@fontsource-variable/dm-sans";
import "./styles.css";

async function startApp() {
  if (new URLSearchParams(window.location.search).get("vconsole") === "true") {
    try {
      const { default: VConsole } = await import("vconsole");
      // Load the log panel before mounting so it captures startup errors.
      new VConsole({ defaultPlugins: [], log: { showTimestamps: true } });
    } catch (error) {
      console.warn("Unable to start vConsole", error);
    }
  }

  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void startApp();
