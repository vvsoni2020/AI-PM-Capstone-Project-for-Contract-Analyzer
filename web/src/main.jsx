import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { initAbbrTooltips } from "./glossary.js";

const root = document.getElementById("root");
createRoot(root).render(<App />);
initAbbrTooltips(root);
