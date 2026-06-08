import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@algorisys/zen-ui-react/styles";
import "./index.css";
import { App } from "./app";

// Project base theme: "hacker". We re-bind zen-ui's --zen-* tokens under
// :root[data-theme="hacker"] in index.css, so setting the attribute before
// first paint themes every zen-ui component + our shell. (No flash.)
document.documentElement.setAttribute("data-theme", "hacker");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
