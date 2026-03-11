import React from "react";
import ReactDOM from "react-dom/client";
import { createGlobalStyle } from "styled-components";

import { App } from "./App";

const GlobalStyle = createGlobalStyle`
  :root {
    --bg: #f4efe7;
    --panel: rgba(255, 251, 245, 0.92);
    --panel-strong: #fffdf9;
    --ink: #1f2937;
    --muted: #5d6b7b;
    --line: rgba(31, 41, 55, 0.14);
    --accent: #c96f3b;
    --accent-deep: #8f4320;
    --accent-soft: rgba(201, 111, 59, 0.14);
    --shadow: 0 20px 60px rgba(53, 39, 28, 0.12);
    --radius-xl: 28px;
    --radius-lg: 20px;
    --radius-md: 14px;
    --font-body: "Segoe UI", "Helvetica Neue", sans-serif;
    --font-display: "Georgia", "Times New Roman", serif;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    min-width: 320px;
    min-height: 100vh;
    font-family: var(--font-body);
    color: var(--ink);
    background:
      radial-gradient(circle at top left, rgba(201, 111, 59, 0.22), transparent 28%),
      radial-gradient(circle at top right, rgba(73, 127, 162, 0.18), transparent 24%),
      linear-gradient(180deg, #f6f0e8 0%, #efe6da 100%);
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
    <GlobalStyle />
    <App />
  </React.StrictMode>,
);
