import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import { createGlobalStyle } from "styled-components";

import { App } from "./App";
import { CLERK_PUBLISHABLE_KEY, SIGN_IN_PATH } from "./lib/auth";

const GlobalStyle = createGlobalStyle`
  :root {
    --bg: #f4efe7;
    --bg-top: #f6f0e8;
    --bg-bottom: #efe6da;
    --bg-glow-left: rgba(201, 111, 59, 0.22);
    --bg-glow-right: rgba(73, 127, 162, 0.18);
    --panel: rgba(255, 251, 245, 0.92);
    --panel-strong: #fffdf9;
    --ink: #1f2937;
    --muted: #5d6b7b;
    --line: rgba(31, 41, 55, 0.14);
    --accent: #c96f3b;
    --accent-deep: #8f4320;
    --accent-soft: rgba(201, 111, 59, 0.14);
    --sidebar-bg: rgba(28, 34, 43, 0.96);
    --sidebar-card: rgba(255, 255, 255, 0.04);
    --sidebar-line: rgba(255, 255, 255, 0.1);
    --sidebar-ink: #f6efe6;
    --sidebar-muted: rgba(246, 239, 230, 0.72);
    --shadow: 0 20px 60px rgba(53, 39, 28, 0.12);
    --radius-xl: 28px;
    --radius-lg: 20px;
    --radius-md: 14px;
    --font-body: "Manrope", "Segoe UI", sans-serif;
    --font-display: "Fraunces", "Iowan Old Style", serif;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    min-width: 320px;
    min-height: 100vh;
    font-family: var(--font-body);
    font-size: 15px;
    color: var(--ink);
    background:
      radial-gradient(circle at top left, var(--bg-glow-left), transparent 28%),
      radial-gradient(circle at top right, var(--bg-glow-right), transparent 24%),
      linear-gradient(180deg, var(--bg-top) 0%, var(--bg-bottom) 100%);
    transition: background 240ms ease;
  }

  button,
  input,
  textarea {
    font: inherit;
  }

  #root {
    min-height: 100vh;
  }
`;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} afterSignOutUrl={SIGN_IN_PATH}>
      <GlobalStyle />
      <App />
    </ClerkProvider>
  </React.StrictMode>,
);
