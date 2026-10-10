import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import { WorkbenchApp } from "./workbench/WorkbenchApp.js";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><WorkbenchApp /></React.StrictMode>,
);
